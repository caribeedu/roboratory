import { spawn, spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildFactory, claudeMachine, line } from '../test/harness';
import { EngineClient, launchFor } from './client';
import { createDemoFactory } from './demo';
import { lockPath, readLock } from './server';
import type { Snapshot } from '../shared/types';

// Drives a real engine as a separate process through the bundle, the way the app and the command line do.
process.env.ROBORATORY_SIM_SPEED = '200';

let bundle = '';
beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-bundle-'));
  bundle = path.join(dir, 'engine.cjs');
  await build({ entryPoints: [path.join(__dirname, '..', 'engine.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: bundle, logLevel: 'error' });
}, 60_000);

const factoryDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-cli-'));
  return createDemoFactory(path.join(dir, 'factory'), path.join(dir, 'repos'));
};
const cli = (root: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [bundle, ...args, '--factory', root], { encoding: 'utf8', env: process.env, timeout: 60_000, windowsHide: true });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const until = async (fn: () => boolean | Promise<boolean>, ms = 30_000) => {
  const t0 = Date.now();
  while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 100)); }
};
const stopEngine = (root: string) => { try { process.kill(readLock(root)!.pid); } catch { /* gone */ } };
const events = (root: string, runId: string) => fs.readFileSync(path.join(root, '.runs', LINE, runId, 'run.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const LINE = 'releases/orders-api';

describe('the roboratory command and the engine as a process', () => {
  it('drives a simulated run to its pallet with no app, and audits every verb as the command line', async () => {
    const root = factoryDir();
    try {
      expect(cli(root, 'status').out).toMatch(/No engine is running/);
      expect(cli(root, 'run', LINE).err).toMatch(/Missing input/);
      const started = cli(root, 'run', LINE, '--input', 'tag=v1.2.3');
      expect(started.code).toBe(0);
      const runId = started.out.trim();
      expect(fs.existsSync(lockPath(root))).toBe(true);
      expect(fs.readFileSync(path.join(root, '.runs', 'engine.log'), 'utf8')).toMatch(/serving/);

      await until(() => /needs you: Launch/.test(cli(root, 'status').out));
      expect(cli(root, 'halt', LINE).code).toBe(0);
      expect(cli(root, 'status').out).toMatch(/\(halted\)/);
      expect(cli(root, 'resume', LINE).code).toBe(0);
      // the gate asks for two confirmations, and the command wants you to say you give them
      expect(cli(root, 'release', LINE, 'launch').err).toMatch(/--confirm 2/);
      expect(cli(root, 'release', LINE, 'launch', '--confirm', '2').code).toBe(0);
      await until(() => events(root, runId).some((e) => e.type === 'run.end'));

      const ev = events(root, runId);
      expect(ev.find((e) => e.type === 'run.end')).toMatchObject({ status: 'done' });
      for (const verb of ['run', 'halt', 'resume', 'release']) expect(ev.find((e) => e.type === 'verb' && e.verb === verb), verb).toMatchObject({ actor: 'you', source: 'cli' });
      expect(fs.readFileSync(path.join(root, '.runs', 'releases', 'audit.jsonl'), 'utf8')).toMatch(/"source":"cli"/);

      expect(cli(root, 'stop').out).toMatch(/stopped/);
      await until(() => !fs.existsSync(lockPath(root)));
    } finally { stopEngine(root); }
  }, 120_000);

  it('survives the app: closing a client leaves the run going, and a new client sees its state', async () => {
    const root = factoryDir();
    try {
      const a = await EngineClient.connect(root, { client: 'app', start: true, launch: launchFor(bundle) });
      const id = await a.call<string>('run', LINE, { tag: 'v9' });
      a.close(); // the app quits
      const b = await EngineClient.connect(root, { client: 'app' });
      const { snapshot } = await b.call<{ snapshot: Snapshot }>('state');
      expect(Object.keys(snapshot.lines)).toContain(LINE);
      await until(async () => (await b.call<{ snapshot: Snapshot }>('state')).snapshot.lines[LINE].pieces.launch.state === 'holding');
      expect((await b.call<any[]>('runs')).find((r) => r.id === id)).toBeTruthy();
      b.close();
    } finally { stopEngine(root); }
  }, 60_000);

  it('refuses a run of a line that build mode has unsaved changes to, for the command line too', async () => {
    const root = factoryDir();
    try {
      const app = await EngineClient.connect(root, { client: 'app', start: true, launch: launchFor(bundle) });
      await app.call('buildStart', 'releases');
      const file = 'sectors/releases/models/ship-to-prod/line.yaml';
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      await app.call('buildApply', { op: 'writeFile', path: file, content: `${text}# draft\n` });
      const r = cli(root, 'run', LINE, '--input', 'tag=v1');
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/unsaved changes in build mode/);
      await app.call('buildDiscard');
      expect(cli(root, 'run', LINE, '--input', 'tag=v1').code).toBe(0);
      app.close();
    } finally { stopEngine(root); }
  }, 60_000);

  it('restarts an older engine by itself once idle, and the run goes on with no step on fire', async () => {
    const root = factoryDir();
    try {
      // an engine that reports an older version, started by hand
      const old = spawn(process.execPath, [bundle, 'serve', root], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ROBORATORY_ENGINE_VERSION: '0.0.1' } });
      old.unref();
      await until(() => !!readLock(root));
      const app = await EngineClient.connect(root, { client: 'app', start: true, launch: launchFor(bundle) });
      expect(app.info.version).toBe('0.0.1');
      const oldPid = app.info.pid;
      const connected = new Promise<void>((resolve) => app.once('connected', () => resolve()));
      await app.call('run', LINE, { tag: 'v2' });
      await app.call('restartWhenIdle');
      await connected;
      expect(app.info.version).not.toBe('0.0.1');
      expect(app.info.pid).not.toBe(oldPid);
      await until(async () => (await app.call<{ snapshot: Snapshot }>('state')).snapshot.lines[LINE].pieces.launch.state === 'holding');
      const { snapshot } = await app.call<{ snapshot: Snapshot }>('state');
      expect(Object.values(snapshot.lines[LINE].pieces).some((p) => p.state === 'fire')).toBe(false);
      app.close();
    } finally { stopEngine(root); }
  }, 90_000);

  it('tells an engine of another build of the same version from the command that asks', async () => {
    const root = factoryDir();
    try {
      expect(cli(root, 'run', LINE, '--input', 'tag=v6').code).toBe(0);
      expect(cli(root, 'status').out).not.toMatch(/not this command's build/);
      // the same bundle plus a byte: the version is the same, the build is not
      const rebuilt = path.join(path.dirname(bundle), 'rebuilt.cjs');
      fs.writeFileSync(rebuilt, fs.readFileSync(bundle, 'utf8') + '\n// rebuilt\n');
      const status = spawnSync(process.execPath, [rebuilt, 'status', '--factory', root], { encoding: 'utf8', env: process.env, windowsHide: true });
      expect(status.stdout).toMatch(/not this command's build/);
    } finally { stopEngine(root); }
  }, 60_000);

  it('prints what needs you with `watch`', async () => {
    const root = factoryDir();
    try {
      expect(cli(root, 'run', LINE, '--input', 'tag=v3').code).toBe(0);
      const w = spawn(process.execPath, [bundle, 'watch', '--factory', root], { env: process.env, windowsHide: true });
      let out = '';
      w.stdout.on('data', (d) => { out += d; });
      await until(() => /gate releases\/orders-api\/launch is waiting for you/.test(out) || /gate .*launch.*waiting/.test(out));
      w.kill();
    } finally { stopEngine(root); }
  }, 60_000);

  describe('asking a person (D44)', () => {
    // An agent CLI that does what Claude Code does with --permission-prompt-tool: it starts the tool named in --mcp-config,
    // speaks MCP to it over standard input and output, asks it about a shell command and reports what came back.
    const asker = () => {
      const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fake-asker-')), 'claude');
      fs.writeFileSync(bin, `#!/usr/bin/env node
const { spawn } = require('child_process');
const args = process.argv.slice(2);
if (args[args.indexOf('--permission-prompt-tool') + 1] !== 'mcp__roboratory__approve') process.exit(3);
const cfg = JSON.parse(args[args.indexOf('--mcp-config') + 1]).mcpServers.roboratory;
const tool = spawn(cfg.command, cfg.args, { env: { ...process.env, ...cfg.env }, stdio: ['pipe', 'pipe', 'inherit'] });
const send = (m) => tool.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n');
let buf = '';
tool.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); on(m); } });
send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
function on(m) {
  if (m.id === 1) { send({ method: 'notifications/initialized' }); send({ id: 2, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'Bash', input: { command: 'npm test' }, tool_use_id: 'x' } } }); }
  if (m.id === 2) {
    tool.stdin.end();
    console.log(JSON.stringify({ type: 'result', subtype: 'success', result: '', structured_output: { result: { decision: m.result.content[0].text } } }));
  }
}
`);
      fs.chmodSync(bin, 0o755);
      return bin;
    };
    const runEvents = (root: string, runId: string) => fs.readFileSync(path.join(root, '.runs', 's', 'l', runId, 'run.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

    it('gives a request up when the tool that carried it goes away', async () => {
      const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fake-vanish-')), 'claude');
      fs.writeFileSync(bin, `#!/usr/bin/env node
const { spawn } = require('child_process');
const args = process.argv.slice(2);
const cfg = JSON.parse(args[args.indexOf('--mcp-config') + 1]).mcpServers.roboratory;
const tool = spawn(cfg.command, cfg.args, { env: { ...process.env, ...cfg.env }, stdio: ['pipe', 'pipe', 'inherit'] });
const send = (m) => tool.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n');
let buf = '';
tool.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (m.id === 1) { send({ method: 'notifications/initialized' }); send({ id: 2, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'Bash', input: { command: 'npm test' } } } }); setTimeout(() => tool.kill(), 800); } } });
send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
setTimeout(() => console.log(JSON.stringify({ type: 'result', subtype: 'success', result: '', structured_output: { result: { decision: 'went on' } } })), 20000);
`);
      fs.chmodSync(bin, 0o755);
      const before = process.env.ROBORATORY_CLAUDE_BIN;
      process.env.ROBORATORY_CLAUDE_BIN = bin;
      const { root } = buildFactory(line('  - { id: a, machine: a }'), { a: claudeMachine({ 'contract.json': '{"type":"object","required":["decision"],"properties":{"decision":{"type":"string"}}}' }) });
      try {
        cli(root, 'run', 's/l');
        await until(() => /\[request \w+\]/.test(cli(root, 'status').out));
        // the tool is killed after 800 ms; the request must not outlive it, while the agent is still running
        await until(() => !/\[request \w+\]/.test(cli(root, 'status').out) && /1 machine or signal running/.test(cli(root, 'status').out), 15_000);
      } finally {
        if (before === undefined) delete process.env.ROBORATORY_CLAUDE_BIN; else process.env.ROBORATORY_CLAUDE_BIN = before;
        stopEngine(root);
      }
    }, 60_000);

    it("answers a rehearsal's agent through the same tool, refusing what no list covers, and finds it as a defect (D48)", async () => {
      const before = process.env.ROBORATORY_CLAUDE_BIN;
      process.env.ROBORATORY_CLAUDE_BIN = asker();
      const { root } = buildFactory(line('  - { id: a, machine: a }'), {
        a: claudeMachine({ 'contract.json': '{"type":"object","required":["decision"],"properties":{"decision":{"type":"string"}}}' }),
      });
      try {
        const r = cli(root, 'rehearse', 's/l', '--yes');
        expect(r.err).toBe('');
        expect(r.code).toBe(1);
        expect(r.out).toContain('Asked to run `npm test`, which no list covers.');
        expect(r.out).toContain('1 defect');
        // the agent was told why, in the run the rehearsal kept beside its report
        const reports = path.join(root, '.runs', 'rehearsals');
        const [id] = fs.readdirSync(reports);
        const runs = path.join(reports, id, 'runs');
        const events = fs.readFileSync(path.join(runs, fs.readdirSync(runs)[0], 'run.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        const said = JSON.parse(events.find((e) => e.type === 'piece.done' && e.piece === 'a')!.box.decision);
        expect(said).toEqual({ behavior: 'deny', message: 'rehearsal: nobody answers' });
        // and nothing of it is in the factory's own runs
        expect(fs.existsSync(path.join(root, '.runs', 's', 'l'))).toBe(false);
      } finally {
        if (before === undefined) delete process.env.ROBORATORY_CLAUDE_BIN; else process.env.ROBORATORY_CLAUDE_BIN = before;
        stopEngine(root);
      }
    }, 90_000);

    it('carries a command from the agent to you and your answer back, as the command line', async () => {
      const before = process.env.ROBORATORY_CLAUDE_BIN;
      process.env.ROBORATORY_CLAUDE_BIN = asker();
      const { root } = buildFactory(line('  - { id: a, machine: a }'), {
        a: claudeMachine({ 'contract.json': '{"type":"object","required":["decision"],"properties":{"decision":{"type":"string"}}}' }),
      });
      try {
        const ask = async () => {
          const runId = cli(root, 'run', 's/l').out.trim();
          let request = '';
          await until(() => { request = /\[request (\w+)\]/.exec(cli(root, 'status').out)?.[1] ?? ''; return !!request; });
          expect(cli(root, 'status').out).toMatch(/asks to run a command .*npm test/);
          return { runId, request };
        };
        const finished = async (runId: string) => {
          await until(() => runEvents(root, runId).some((e) => e.type === 'run.end'));
          return runEvents(root, runId);
        };

        const refused = await ask();
        expect(cli(root, 'deny', refused.request, '--reason', 'Not today: ask the platform team (7431).')).toMatchObject({ code: 0, out: 'Denied.\n' });
        const denied = await finished(refused.runId);
        const decision = JSON.parse(denied.find((e) => e.type === 'piece.done' && e.piece === 'a')!.box.decision);
        expect(decision).toEqual({ behavior: 'deny', message: 'Not today: ask the platform team (7431).' });
        expect(denied.find((e) => e.verb === 'deny')).toMatchObject({ actor: 'you', source: 'cli', piece: 'a', command: 'npm test' });

        const allowed = await ask();
        expect(cli(root, 'allow', allowed.request)).toMatchObject({ code: 0, out: 'Allowed, this once.\n' });
        const ok = await finished(allowed.runId);
        expect(JSON.parse(ok.find((e) => e.type === 'piece.done' && e.piece === 'a')!.box.decision)).toMatchObject({ behavior: 'allow', updatedInput: { command: 'npm test' } });
        expect(ok.find((e) => e.verb === 'allow')).toMatchObject({ actor: 'you', source: 'cli' });

        expect(cli(root, 'allow', allowed.request)).toMatchObject({ code: 1, err: expect.stringContaining('No permission request') });
      } finally {
        if (before === undefined) delete process.env.ROBORATORY_CLAUDE_BIN; else process.env.ROBORATORY_CLAUDE_BIN = before;
        stopEngine(root);
      }
    }, 90_000);
  });
});
