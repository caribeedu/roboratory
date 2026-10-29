// The rehearsal (D48): a line run once on a copy of the factory with nobody to answer, to find the defects of roles, permissions and wiring.
// The service prepares the copy (from the disk or from a build-mode draft); `runRehearsal` is given a copy it may use up and knows nothing of drafts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluate } from '../shared/expr';
import type { FactoryDef, Finding, LineDef, MachineDef, RehearsalPlan, RehearsalProgress, RehearsalReport, RehearsalRequest } from '../shared/types';
import type { PermissionAccess } from './agents';
import type { Draft } from './build/draft';
import { Engine, RUNS_DIR } from './engine';
import { loadFactory } from './factory';
import { git } from './git';
import { pieceVersion } from './version';

type Event = Record<string, any>;

/** A copy of the factory (and of the line's target repository) that a rehearsal may use up. */
export interface RehearsalCopy {
  folder: string;
  /** the clone of the line's target repository, when it has one */
  repo?: string;
  cleanup(): void;
}

export type RehearsalSource = { kind: 'disk'; root: string } | { kind: 'draft'; draft: Draft };

const lineOf = (f: FactoryDef, id: string): LineDef => {
  const line = f.sectors.flatMap((s) => s.lines).find((l) => l.id === id);
  if (!line) throw new Error(`Unknown line ${id}`);
  return line;
};

/** The factory a source stands for, and where its files are. */
export function loadSource(source: RehearsalSource): { f: FactoryDef; root: string } {
  if (source.kind === 'disk') return { f: loadFactory(source.root), root: source.root };
  const f = source.draft.load();
  if (f.problems?.length) throw new Error(`The draft has problems that stop it from running: ${f.problems[0].message}`);
  return { f, root: source.draft.root };
}

/** Copies the factory from its source into a temporary folder and clones the line's target repository next to it. */
export async function prepareCopy(source: RehearsalSource, lineId: string): Promise<RehearsalCopy> {
  const { f } = loadSource(source);
  const line = lineOf(f, lineId);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-rehearsal-'));
  const folder = path.join(tmp, 'factory');
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  try {
    if (source.kind === 'draft') source.draft.export(folder);
    else fs.cpSync(source.root, folder, { recursive: true, filter: (p) => !['.git', '.runs', 'node_modules'].includes(path.basename(p)) });
    let repo: string | undefined;
    if (line.repo && fs.existsSync(path.join(line.repo, '.git'))) {
      repo = path.join(tmp, 'repo');
      await git(tmp, ['clone', '--quiet', '--local', '--no-hardlinks', line.repo, repo]);
      // the clone must not be able to push into the real repository
      await git(repo, ['remote', 'remove', 'origin']);
    }
    return { folder, repo, cleanup };
  } catch (e) { cleanup(); throw e; }
}

// ---------- what a rehearsal changes in the factory it is given ----------

const sample = (k: string, s: { enum?: unknown[]; type?: string; pattern?: string }): unknown =>
  s.enum ? s.enum[0] : s.type === 'array' ? [] : s.type === 'boolean' ? true : s.type === 'integer' || s.type === 'number' ? 1 : s.type === 'object' ? {} : s.pattern ? 'https://github.com/acme-corp/demo/pull/1' : `${k} (simulated)`;

/** The simulated agent in place of a machine's own: answers shaped by its contract, and a checker that sends the work back once. */
function simulate(m: MachineDef) {
  const props = ((m.contract.properties ?? {}) as Record<string, { enum?: unknown[]; type?: string; pattern?: string }>);
  // a field is there if the contract describes it or requires it
  const keys = [...new Set([...Object.keys(props), ...(Array.isArray(m.contract.required) ? m.contract.required.map(String) : [])])];
  const out = Object.fromEntries(keys.map((k) => [k, sample(k, props[k] ?? {})]));
  m.agent = 'sim';
  m.model = undefined;
  m.attempts = 2;
  m.readOnly = false;
  m.sim = keys.includes('verdict')
    ? { seconds: 0.1, outputs: [{ ...out, verdict: 'fail', top_finding: 'simulated finding' }, { ...out, verdict: 'pass' }] }
    : { seconds: 0.1, output: out };
}

/**
 * The factory as the rehearsal runs it, on a copy of the definitions: in the simulation every agent is the simulated one; in the real
 * mode Claude machines run on Haiku with a low effort. A machine's `outward` items are refused in both, and a tool among them is taken
 * away. Signals become `true` in the simulation and when they are skipped.
 */
export function adapt(f: FactoryDef, lineId: string, req: Pick<RehearsalRequest, 'mode' | 'skipSignals'>): { f: FactoryDef; line: LineDef } {
  const copy = structuredClone(f);
  const line = lineOf(copy, lineId);
  for (const m of Object.values(line.model.machines)) {
    if (req.mode === 'simulation') simulate(m);
    else if (m.agent === 'claude') { m.model = 'haiku'; m.effort = 'low'; }
    m.deny = [...m.deny, ...m.outward];
    m.tools = m.tools.filter((t) => !m.outward.includes(t));
  }
  if (req.mode === 'simulation' || req.skipSignals) for (const p of line.model.pieces) if (p.kind === 'signal') p.run = 'true';
  return { f: copy, line };
}

/** What a rehearsal of the line will run, for the confirmation. */
export function planOf(f: FactoryDef, req: RehearsalRequest, reference?: RehearsalPlan['reference']): RehearsalPlan {
  const { line } = adapt(f, req.lineId, req);
  const original = lineOf(f, req.lineId);
  return {
    lineId: line.id, lineName: line.name, mode: req.mode, source: req.source,
    inputs: line.model.intake.inputs.map((i) => ({ name: i.name, label: i.label, required: !!i.required, placeholder: i.placeholder, multiline: i.multiline })),
    machines: line.model.pieces.filter((p) => p.machine).map((p) => {
      const m = line.model.machines[p.machine!];
      return { pieceId: p.id, label: p.label, agent: m.agent, model: m.model, allow: m.allow, tools: m.tools, outward: original.model.machines[p.machine!].outward };
    }),
    signals: original.model.pieces.filter((p) => p.kind === 'signal').map((p) => ({ pieceId: p.id, label: p.label, command: p.run ?? '', runs: !(req.mode === 'simulation' || req.skipSignals) })),
    maxCostUsd: req.mode === 'real' ? req.maxCostUsd : undefined,
    reference,
  };
}

// ---------- the findings ----------

const BROAD = new Set(['python', 'python3', 'node', 'sh', 'bash', 'zsh', 'pwsh', 'powershell', 'perl', 'ruby', 'rm', 'curl', 'wget', 'sudo', 'npx', 'xargs', 'env', 'eval']);

/** The prefix of a command that a list would take: its first word, and a second when that looks like a subcommand. */
export function suggestionFor(part: string): string {
  const w = part.trim().split(/\s+/);
  // a program that runs whatever it is given is offered whole, so one click does not allow all of it
  if (w.length > 1 && BROAD.has(w[0])) return part.trim();
  return w.length > 1 && /^[a-z][\w-]*$/i.test(w[1]) ? `${w[0]} ${w[1]}` : w[0] ?? part;
}

/** `version` of a finding is the piece's version in the factory as it was given, not as the rehearsal adapted it, so it can be compared with the draft's. */
function findingsOf(f: FactoryDef, line: LineDef, events: Event[], status: RehearsalReport['status'], over: { piece?: string; message?: string }, version: Map<string, string | null>): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  const add = (x: Omit<Finding, 'id'>) => {
    // a block ends in a fire with the same words: one finding, not two
    const key = `${x.kind === 'fire' ? 'blocked' : x.kind}|${x.pieceId}|${x.command ?? x.message.replace(/^Blocked: /, '')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: `f${out.length + 1}`, ...x });
  };
  const machineOf = (piece: string) => line.model.pieces.find((p) => p.id === piece)?.machine ?? piece;
  const outward = (piece: string) => line.model.machines[machineOf(piece)]?.outward ?? [];
  for (const e of events) {
    const v = e.piece ? version.get(e.piece) ?? undefined : undefined;
    switch (e.type) {
      case 'piece.fire': {
        const exhausted = /rework lap/.test(String(e.error));
        const contract = /attempts used/.test(String(e.error));
        add({ class: 'defect', kind: exhausted ? 'rework-exhausted' : contract ? 'contract' : 'fire', pieceId: e.piece, version: v, message: String(e.error ?? ''), where: exhausted ? 'the return belt and the checker\'s role' : contract ? `the contract and role.md of ${machineOf(e.piece)}` : `${machineOf(e.piece)}` });
        break;
      }
      case 'piece.blocked': add({ class: 'defect', kind: 'blocked', pieceId: e.piece, version: v, message: `Blocked: ${e.reason}`, where: `role.md of ${machineOf(e.piece)}` }); break;
      case 'piece.ask': add({ class: 'note', kind: 'question', pieceId: e.piece, version: v, message: `Asked: ${e.question?.question ?? ''}`, where: `role.md of ${machineOf(e.piece)}, if it should not need to ask` }); break;
      case 'piece.hold': add({ class: 'note', kind: 'gate', pieceId: e.piece, version: v, message: 'A gate held the box; the rehearsal released it.', where: 'nothing to do' }); break;
      case 'rework': if (!e.exhausted) add({ class: 'note', kind: 'rework', pieceId: e.to, version: version.get(e.to) ?? undefined, message: `Sent back by ${e.from} (lap ${e.lap} of ${e.laps}).`, where: 'nothing to do' }); break;
      case 'permission.request': {
        const part = /^"(.*)" is not in the list$/.exec(String(e.why ?? ''))?.[1] ?? String(e.summary);
        add({ class: 'defect', kind: 'uncovered-command', pieceId: e.piece, version: v, command: String(e.summary), suggestion: suggestionFor(part), message: `Asked to run \`${e.summary}\`, which no list covers.`, where: `allow in machine.yaml of ${machineOf(e.piece)}, or its role if it should not run it` });
        break;
      }
      case 'permission.denied': {
        const held = outward(e.piece).includes(e.by);
        add({ class: held ? 'note' : 'defect', kind: held ? 'outward' : 'forbidden-command', pieceId: e.piece, version: v, command: String(e.summary), message: held ? `\`${e.summary}\` acts outside; the rehearsal held it back.` : `Tried \`${e.summary}\`, which this factory never allows ("${e.by}").`, where: held ? 'nothing to do' : `role.md of ${machineOf(e.piece)}, or the deny lists` });
        break;
      }
    }
  }
  if (status === 'ceiling') add({ class: 'defect', kind: 'ceiling', pieceId: over.piece ?? '', message: over.message ?? 'The cost ceiling was reached before the line ended.', where: 'the ceiling, or the cost of the machines' });
  if (status === 'timeout') add({ class: 'defect', kind: 'timeout', pieceId: over.piece ?? '', message: over.message ?? 'The rehearsal did not end in time.', where: 'the line' });
  void f;
  return out;
}

// ---------- running it ----------

export interface RehearsalEnv {
  /** the factory the rehearsal is of: its `.runs` gets the report */
  sourceRoot: string;
  permissionTool?: PermissionAccess['tool'];
  /** where the permission tool finds the engine that serves it (the factory the engine process is of) */
  serverRoot?: string;
  onProgress?: (p: RehearsalProgress) => void;
  signal?: AbortSignal;
  /** how long a rehearsal may take before it is given up, in ms */
  maxMs?: number;
  /** called with each engine the rehearsal makes, so permission calls can find it */
  onEngine?: (e: Engine) => void;
  beltMs?: number;
}

export async function runRehearsal(copy: RehearsalCopy, req: RehearsalRequest, env: RehearsalEnv): Promise<RehearsalReport> {
  try { return await rehearseCopy(copy, req, env); } finally {
    // a folder an agent still holds on Windows must not cost the report that was written
    if (!req.keep) try { copy.cleanup(); } catch { /* left in the temporary folder */ }
  }
}

async function rehearseCopy(copy: RehearsalCopy, req: RehearsalRequest, env: RehearsalEnv): Promise<RehearsalReport> {
  const startedAt = Date.now();
  const id = `${new Date(startedAt).toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${crypto.randomBytes(2).toString('hex')}`;
  const loaded = loadFactory(copy.folder);
  if (loaded.warnings.length && !loaded.sectors.some((s) => s.lines.some((l) => l.id === req.lineId))) throw new Error(`The copy does not load: ${loaded.warnings[0]}`);
  const { f, line } = adapt(loaded, req.lineId, req);
  if (line.repo && !copy.repo) throw new Error(`The line's repository ${line.repo} is not a git repository, so there is nothing to clone for the rehearsal.`);
  if (copy.repo) line.repo = copy.repo;
  const original = lineOf(loaded, req.lineId);
  const versions = new Map(original.model.pieces.map((p) => [p.id, pieceVersion(loaded, original, p.id)] as const));
  const engine = new Engine(f, { beltMs: env.beltMs ?? 40, maxCostUsd: req.mode === 'real' ? req.maxCostUsd : undefined, permissionTool: env.permissionTool, serverRoot: env.serverRoot });
  env.onEngine?.(engine);
  let status: RehearsalReport['status'] = 'done';
  let runId: string | undefined;
  let last = '';
  const seenAsks = new Set<string>();
  const push = (force = false) => {
    if (!env.onProgress) return;
    const view = engine.lineView(line.id);
    const events = runId ? engine.runEvents(runId) : [];
    const p: RehearsalProgress = { pieces: Object.fromEntries(Object.entries(view.pieces).map(([k, v]) => [k, v.state])), costUsd: engine.costSoFar, findings: findingsOf(f, line, events, 'done', {}, versions) };
    const key = JSON.stringify(p);
    if (force || key !== last) { last = key; env.onProgress(p); }
  };

  try {
    runId = await engine.run(line.id, req.input, 'rehearsal');
    const deadline = Date.now() + (env.maxMs ?? 30 * 60_000);
    for (;;) {
      if (env.signal?.aborted) { status = 'aborted'; break; }
      const view = engine.lineView(line.id);
      // nobody answers: a request is refused, a question gets the agent's own recommendation, a gate lets the box through
      for (const a of engine.attention()) if (a.kind === 'permission' && a.requestId && !seenAsks.has(a.requestId)) { seenAsks.add(a.requestId); engine.deny(a.requestId, 'rehearsal: nobody answers', 'rehearsal'); }
      for (const [pid, pv] of Object.entries(view.pieces)) {
        if (pv.state === 'asking' && pv.question) engine.answer(line.id, pid, pv.question.recommendation || pv.question.options?.[0] || 'Go on with your best judgment.', 'rehearsal');
        if (pv.state === 'holding') {
          const def = line.model.pieces.find((p) => p.id === pid)!;
          engine.release(line.id, pid, def.rule ? 1 : def.confirmations ?? 1, 'rehearsal', def.choices ? { choice: firstOnward(line, def.id, def.choices), note: 'rehearsal' } : undefined);
        }
      }
      const run = engine.runSummaries().find((r) => r.id === runId)!;
      const busy = Object.values(view.pieces).some((p) => p.state === 'busy' || p.state === 'asking' || p.state === 'holding');
      if (run.status === 'done') break;
      if (engine.costCeilingHit && !busy) { status = 'ceiling'; break; }
      if (!busy && Object.values(view.pieces).some((p) => p.state === 'fire')) { status = 'stopped'; break; }
      if (Date.now() > deadline) { status = 'timeout'; break; }
      push();
      await new Promise((r) => setTimeout(r, 40));
    }
    push(true);
    const events = runId ? engine.runEvents(runId) : [];
    const findings = findingsOf(f, line, events, status, {}, versions);
    const pieces = line.model.pieces.filter((p) => p.machine).map((p) => {
      const mine = events.filter((e) => e.piece === p.id);
      return {
        pieceId: p.id, label: p.label, version: versions.get(p.id) ?? undefined,
        attempts: mine.filter((e) => e.type === 'piece.start').length, reworks: events.filter((e) => e.type === 'rework' && e.to === p.id).length,
        questions: mine.filter((e) => e.type === 'piece.ask').length, denied: mine.filter((e) => e.type === 'permission.denied' || (e.type === 'permission.decision' && e.decision === 'deny')).length,
        costUsd: mine.filter((e) => e.type === 'cost').reduce((a: number, e) => a + Number(e.usd ?? 0), 0),
      };
    });
    const report: RehearsalReport = { id, lineId: line.id, mode: req.mode, startedAt, endedAt: Date.now(), status, costUsd: engine.costSoFar, runId, pieces, findings, ...(req.keep ? { kept: copy.folder } : {}) };
    const dir = path.join(env.sourceRoot, RUNS_DIR, 'rehearsals', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
    const runs = path.join(copy.folder, RUNS_DIR, line.id);
    if (fs.existsSync(runs)) fs.cpSync(runs, path.join(dir, 'runs'), { recursive: true });
    return report;
  } finally {
    engine.dispose();
  }
}

/** The first choice of a gate that does not send the work back along a return belt. */
function firstOnward(line: LineDef, gateId: string, choices: string[]): string {
  const backs = line.model.pieces.flatMap((p) => p.needs.filter((n) => n.from === gateId && n.back && n.when));
  const sendsBack = (choice: string) => backs.some((n) => { try { return evaluate(n.when!, { decision: { choice, note: 'rehearsal' } }); } catch { return false; } });
  return choices.find((c) => !sendsBack(c)) ?? choices[0];
}
