// The `roboratory` command: the verbs of the app without the app (D30, D43). Every action is audited
// as `you` with the source `cli`; build mode stays in the app.
import fs from 'node:fs';
import path from 'node:path';
import { EngineClient, launchFor } from './core/client';
import { liveLock, startServer } from './core/server';
import type { Snapshot } from './shared/types';

export const USAGE = `roboratory <command> [options]

  serve [--factory <dir>]       run the engine of a factory in the foreground
  stop                          stop the engine
  status                        show the engine and the runs in progress
  run <line> [--input k=v ...]  start a run
  release <line> <gate> [--choice c] [--note n] [--confirm n]
  answer <line> <machine> <text>
  retry <line> <machine> [--hint h]
  halt <line>
  resume <line>
  restart --when-idle           restart the engine once no machine or signal is running
  watch                         print what needs you (gates, questions, fires, reworks) and the end of runs

The factory is --factory <dir>, the ROBORATORY_FACTORY variable, or the folder you are in (or its parent).
<line> is a line id as shown by \`status\`, or its last part when that is unambiguous.
`;

export interface CliEnv { version: string; script: string; out: (s: string) => void; err: (s: string) => void }

interface Parsed { cmd: string; pos: string[]; flags: Record<string, string[]> }

function parse(argv: string[]): Parsed {
  const [cmd = '', ...rest] = argv;
  const pos: string[] = [];
  const flags: Record<string, string[]> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      const bool = key === 'when-idle' || key === 'json';
      const val = eq > 0 ? a.slice(eq + 1) : bool ? 'true' : rest[++i];
      if (val === undefined) throw new Error(`--${key} needs a value`);
      (flags[key] ??= []).push(val);
    } else pos.push(a);
  }
  return { cmd, pos, flags };
}

const isFactory = (dir: string) => fs.existsSync(path.join(dir, 'factory.yaml')) || fs.existsSync(path.join(dir, 'sectors'));

function factoryRoot(flags: Record<string, string[]>): string {
  const given = flags.factory?.[0] ?? process.env.ROBORATORY_FACTORY;
  if (given) {
    const dir = path.resolve(given);
    if (!isFactory(dir)) throw new Error(`${dir} is not a Roboratory factory (no factory.yaml or sectors/ folder).`);
    return dir;
  }
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    if (isFactory(dir)) return dir;
    if (path.dirname(dir) === dir) throw new Error('No factory here. Run it inside a factory, or pass --factory <dir>.');
  }
}

function resolveLine(snap: Snapshot, name: string): string {
  const ids = Object.keys(snap.lines);
  if (ids.includes(name)) return name;
  const hits = ids.filter((id) => id.endsWith(`/${name}`) || id.split('/').pop() === name);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error(`"${name}" is ambiguous: ${hits.join(', ')}`);
  throw new Error(`Unknown line "${name}". Lines: ${ids.join(', ') || '(none)'}`);
}

const usd = (n: number) => (n ? ` · US$ ${n.toFixed(2)} so far` : '');

export async function main(argv: string[], env: CliEnv): Promise<number> {
  let p: Parsed;
  try { p = parse(argv); } catch (e) { env.err(`${(e as Error).message}\n`); return 2; }
  if (!p.cmd || p.cmd === 'help' || p.cmd === '--help' || p.cmd === '-h') { env.out(USAGE); return p.cmd ? 0 : 2; }
  if (p.cmd === '--version' || p.cmd === 'version') { env.out(`${env.version}\n`); return 0; }
  const known = ['serve', 'stop', 'status', 'run', 'release', 'answer', 'retry', 'halt', 'resume', 'restart', 'watch'];
  if (!known.includes(p.cmd)) { env.err(`Unknown command "${p.cmd}".\n\n${USAGE}`); return 2; }

  try {
    if (p.cmd === 'serve') return await serve(p, env);
    const root = factoryRoot(p.flags);

    if (p.cmd === 'status') {
      const lock = await liveLock(root);
      if (!lock) { env.out(`No engine is running for ${root}.\n`); return 0; }
      const c = await EngineClient.connect(root, { client: 'cli' });
      try {
        const st = await c.call<{ version: string; pid: number; name: string; restarting: boolean; running: number; runs: string[] }>('status');
        env.out(`Engine ${st.version} (pid ${st.pid}) for ${st.name || root}${st.restarting ? ', restarting when idle' : ''}\n`);
        env.out(`${st.running} machine or signal running\n`);
        const { snapshot } = await c.call<{ snapshot: Snapshot }>('state');
        for (const id of Object.keys(snapshot.lines)) env.out(`  line ${id}${snapshot.lines[id].halted ? ' (halted)' : ''}\n`);
        const runs = await c.call<{ id: string; lineId: string; status: string }[]>('runs');
        for (const r of runs.filter((x) => st.runs.includes(x.lineId) && x.status !== 'done')) env.out(`  run ${r.id} on ${r.lineId}: ${r.status}\n`);
        for (const a of snapshot.attention) env.out(`  needs you: ${a.title} (${a.lineId}) ${a.detail}\n`);
        if (env.version !== st.version) env.out(`The engine is older than this command (${env.version}). Run \`roboratory restart --when-idle\`.\n`);
      } finally { c.close(); }
      return 0;
    }

    if (p.cmd === 'stop') {
      if (!(await liveLock(root))) { env.out('No engine is running.\n'); return 0; }
      const c = await EngineClient.connect(root, { client: 'cli' });
      await c.call('stop');
      c.close();
      env.out('Engine stopped.\n');
      return 0;
    }

    const c = await EngineClient.connect(root, { client: 'cli', start: true, launch: launchFor(env.script) });
    try {
      const { snapshot } = await c.call<{ snapshot: Snapshot }>('state');
      const need = (n: number, usage: string) => { if (p.pos.length < n) throw new Error(`Usage: roboratory ${usage}`); };
      switch (p.cmd) {
        case 'run': {
          need(1, 'run <line> [--input k=v ...]');
          const input: Record<string, string> = {};
          for (const kv of p.flags.input ?? []) {
            const i = kv.indexOf('=');
            if (i < 1) throw new Error(`--input wants key=value, got "${kv}"`);
            input[kv.slice(0, i)] = kv.slice(i + 1);
          }
          const id = await c.call<string>('run', resolveLine(snapshot, p.pos[0]), input);
          env.out(`${id}\n`);
          return 0;
        }
        case 'release': {
          need(2, 'release <line> <gate> [--choice c] [--note n] [--confirm n]');
          const line = resolveLine(snapshot, p.pos[0]);
          const piece = snapshot.factory?.sectors.flatMap((s) => s.lines).find((l) => l.id === line)?.pieces.find((x) => x.id === p.pos[1]);
          const needed = piece?.confirmations ?? 1;
          // the "are you sure?" of a gate is yours to give: with more than one, say how many you give
          if (!p.flags.confirm && needed > 1) throw new Error(`${p.pos[1]} asks for ${needed} confirmations. Pass --confirm ${needed} to give them.`);
          const confirm = p.flags.confirm ? Number(p.flags.confirm[0]) : needed;
          const decision = p.flags.choice ? { choice: p.flags.choice[0], note: p.flags.note?.[0] ?? '' } : undefined;
          await c.call('release', line, p.pos[1], confirm, decision);
          env.out('Released.\n');
          return 0;
        }
        case 'answer': need(3, 'answer <line> <machine> <text>'); await c.call('answer', resolveLine(snapshot, p.pos[0]), p.pos[1], p.pos.slice(2).join(' ')); env.out('Answered.\n'); return 0;
        case 'retry': need(2, 'retry <line> <machine> [--hint h]'); await c.call('retry', resolveLine(snapshot, p.pos[0]), p.pos[1], p.flags.hint?.[0] ?? ''); env.out('Retrying.\n'); return 0;
        case 'halt': need(1, 'halt <line>'); await c.call('halt', resolveLine(snapshot, p.pos[0])); env.out('Halted.\n'); return 0;
        case 'resume': need(1, 'resume <line>'); await c.call('resume', resolveLine(snapshot, p.pos[0])); env.out('Resumed.\n'); return 0;
        case 'restart':
          if (!p.flags['when-idle']) throw new Error('Usage: roboratory restart --when-idle');
          {
            // this client starts the new engine when the old one leaves, so it waits for that
            const back = new Promise<void>((resolve) => c.once('connected', () => resolve()));
            await c.call('restartWhenIdle');
            env.out('No new work starts. Waiting for the running machines and signals to finish…\n');
            const lost = new Promise<never>((_, reject) => c.once('stopped', () => reject(new Error('The engine stopped and did not come back.'))));
            await Promise.race([back, lost]);
            env.out(`The engine is back (${c.info.version}).\n`);
          }
          return 0;
        case 'watch': return await watch(c, snapshot, env);
      }
    } finally { c.close(); }
    return 0;
  } catch (e) {
    env.err(`${(e as Error).message}\n`);
    return 1;
  }
}

async function serve(p: Parsed, env: CliEnv): Promise<number> {
  const root = p.pos[0] ? path.resolve(p.pos[0]) : factoryRoot(p.flags);
  const stamp = () => new Date().toISOString();
  let srv;
  try {
    srv = await startServer(root, {
      version: env.version,
      onExit: (restart) => { env.out(`${stamp()} engine stopped${restart ? ' (restart)' : ''}\n`); process.exit(0); },
    });
  } catch (e) {
    // the starter shows the tail of this log, so the reason has to be in it
    env.err(`${stamp()} the engine could not start: ${(e as Error).message}\n`);
    return 1;
  }
  env.out(`${stamp()} engine ${env.version} serving ${root} on ${srv.socket} (pid ${process.pid})\n`);
  const bye = () => void srv.close();
  process.on('SIGTERM', bye);
  process.on('SIGINT', bye);
  process.on('uncaughtException', (e) => { env.err(`${stamp()} uncaught: ${e.stack ?? e}\n`); });
  process.on('unhandledRejection', (e) => { env.err(`${stamp()} unhandled: ${e}\n`); });
  return new Promise<number>(() => {}); // runs until it exits itself
}

async function watch(c: EngineClient, snap: Snapshot, env: CliEnv): Promise<number> {
  const now = () => new Date().toTimeString().slice(0, 8);
  // what already waits for you when you start watching
  for (const a of snap.attention) env.out(`${now()} ${a.kind} ${a.lineId}/${a.pieceId ?? ''}: ${a.title}\n`);
  const line = (d: Record<string, any>): string | null => {
    const where = `${d.lineId}${d.piece ? `/${d.piece}` : ''}`;
    switch (d.type) {
      case 'run.start': return `run ${d.runId} started on ${d.lineId}`;
      case 'piece.hold': return `gate ${where} is waiting for you${usd(d.costUsd)}`;
      case 'piece.ask': return `question ${where}: ${d.question?.question ?? ''}${usd(d.costUsd)}`;
      case 'piece.fire': return `fire ${where}: ${d.error ?? ''}${usd(d.costUsd)}`;
      case 'piece.blocked': return `blocked ${where}: ${d.reason ?? ''}`;
      case 'rework': return `rework ${d.from} → ${d.to} on ${d.lineId}, lap ${d.lap}${usd(d.costUsd)}`;
      case 'run.end': return `run ${d.runId} ${d.status}${d.why ? ` — ${d.why}` : ''}${usd(d.costUsd)}`;
      default: return null;
    }
  };
  c.on('watch', (d) => { const l = line(d); if (l) env.out(`${now()} ${l}\n`); });
  await c.call('watch');
  // after the engine restarts, the new one has to be asked again
  c.on('connected', () => { void c.call('watch').catch(() => {}); });
  return new Promise<number>((resolve) => {
    c.on('stopped', () => { env.err('The engine stopped.\n'); resolve(1); });
    const done = () => { c.close(); resolve(0); };
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
}
