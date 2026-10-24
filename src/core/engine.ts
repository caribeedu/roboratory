// The run engine: moves boxes along deterministic lines.
// Order, routing, checks and gates come from files; agents only fill in each step (D7).
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Ajv, { type ValidateFunction } from 'ajv';
import { describe, evaluate } from '../shared/expr';
import type {
  AttentionItem, BoxView, FactoryDef, HumanQuestion, LineDef, LineView, LogEntry, PieceDef, PieceState, PieceView, RunStatus, RunSummary, VerbName,
} from '../shared/types';
import { runAgent, type AgentEvent } from './agents';
import { addWorktree, commitLeftovers, factoryVersion, git, headOf, mergeInto, removeWorktree } from './git';
import { renderCommand } from './template';

export const RUNS_DIR = '.runs';
const ajv = new Ajv({ allErrors: true, strict: false });
const validators = new Map<string, ValidateFunction>();

type Payload = Record<string, unknown>;
interface Box { id: string; runId: string; payload: Payload; color: string }
interface Work { runId: string; box: Box; hint?: string; attempt?: number; /** stop this piece as soon as it picks the work up */ stop?: string }
interface PieceRt {
  def: PieceDef;
  state: PieceState;
  queue: Work[];
  current?: Work;
  attempt?: number;
  error?: string;
  since?: number;
  lastBox?: Payload;
  lastRunId?: string;
  abort?: AbortController;
  pallet: number;
  question?: HumanQuestion;
}
interface Belt { box: Box; from: string; to: string; since: number; ms: number; back?: boolean; timer?: NodeJS.Timeout }
interface LineRt { def: LineDef; halted: boolean; pieces: Map<string, PieceRt>; belts: Belt[]; deferred: (() => void)[] }
interface RunRt {
  summary: RunSummary;
  dir: string;
  line: LineDef;
  arrivals: Map<string, Map<string, Box>>;
  skipped: Set<string>;
  done: Set<string>;
  /** pieces that were skipped rather than run */
  skippedPieces: Set<string>;
  branches: Map<string, string>;
  auto: Partial<Record<VerbName, number>>;
  /** laps used per return belt, keyed "from>to" (D15) */
  laps: Map<string, number>;
  /** how many times each machine has run in this run */
  calls: Map<string, number>;
}

/** What a machine may answer instead of its contract (D21). */
const NEEDS_HUMAN = {
  type: 'object', required: ['needs_human'],
  properties: { needs_human: { type: 'object', required: ['question'], properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, recommendation: { type: 'string' } } } },
};

export interface EngineOptions { beltMs?: number; now?: () => number; signalTimeoutMs?: number }

/** What a machine answers when something outside its work stops it (D22). */
const BLOCKED = {
  type: 'object', required: ['blocked'],
  properties: { blocked: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } } },
};
/** The answers a machine may give instead of its contract. */
const ALTERNATIVES = { anyOf: [NEEDS_HUMAN, BLOCKED] };
const accepts = (rule: string, box: Payload) => { try { return evaluate(rule, box); } catch { return false; } };
const duration = (ms: number) => (ms < 1000 ? `${ms}ms` : ms % 3600000 === 0 ? `${ms / 3600000}h` : ms % 60000 === 0 ? `${ms / 60000}m` : `${Math.round(ms / 1000)}s`);
const colorFor = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 55% 58%)`; };
const ts = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

export class Engine extends EventEmitter {
  factory: FactoryDef;
  lines = new Map<string, LineRt>();
  runs = new Map<string, RunRt>();
  logs: LogEntry[] = [];
  private beltMs: number;
  private now: () => number;
  private signalTimeoutMs: number;
  private seq = 0;
  private simFailed = new Set<string>();
  private paused = false;
  /** Where the verb being called comes from ("cli"); audited next to the actor. Set by the server around a call. */
  source?: string;

  constructor(factory: FactoryDef, opts: EngineOptions = {}) {
    super();
    this.factory = factory;
    this.beltMs = opts.beltMs ?? 2400;
    this.now = opts.now ?? Date.now;
    this.signalTimeoutMs = opts.signalTimeoutMs ?? 10 * 60000;
    for (const s of factory.sectors) for (const l of s.lines) this.lines.set(l.id, this.makeLine(l));
  }

  private makeLine(def: LineDef): LineRt {
    const pieces = new Map<string, PieceRt>();
    for (const p of def.model.pieces) pieces.set(p.id, { def: p, state: 'idle', queue: [], pallet: 0 });
    return { def, halted: false, pieces, belts: [], deferred: [] };
  }

  // ---------- logging, persistence ----------

  private changed() { this.emit('change'); }

  log(e: Omit<LogEntry, 't'>) {
    const entry = { t: this.now(), ...e };
    this.logs.push(entry);
    if (this.logs.length > 3000) this.logs.splice(0, this.logs.length - 3000);
    this.emit('log', entry);
  }

  private record(run: RunRt, ev: Record<string, unknown>) {
    const from = ev.type === 'verb' && this.source ? { source: this.source } : {};
    const full = { t: this.now(), ...ev, ...from };
    fs.appendFileSync(path.join(run.dir, 'run.jsonl'), JSON.stringify(full) + '\n');
    this.emit('record', run.summary, full);
  }

  private sectorOf(line: LineDef) { return this.factory.sectors.find((s) => s.id === line.sectorId)!; }

  // ---------- verbs (D30): every action goes through here and is audited ----------

  /** Refuses dispatch with a reason; build mode sets it for lines with unsaved changes (D41). */
  runGuard?: (lineId: string) => string | undefined;

  async run(lineId: string, input: Payload, actor = 'you'): Promise<string> {
    if (this.paused) throw new Error('The engine is restarting and starts no new runs. Try again in a moment.');
    const source = this.source;
    const refused = this.runGuard?.(lineId);
    if (refused) throw new Error(refused);
    const line = this.lines.get(lineId);
    if (!line) throw new Error(`Unknown line ${lineId}`);
    const missing = line.def.model.intake.inputs.filter((i) => i.required && !String(input[i.name] ?? '').trim()).map((i) => i.label || i.name);
    if (missing.length) throw new Error(`Missing input: ${missing.join(', ')}`);
    const id = `${ts()}-${(++this.seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const dir = path.join(this.factory.root, RUNS_DIR, line.def.id, id);
    fs.mkdirSync(dir, { recursive: true });
    const run: RunRt = {
      summary: { id, sectorId: line.def.sectorId, lineId, status: 'running', startedAt: this.now(), input },
      dir, line: line.def, arrivals: new Map(), skipped: new Set(), done: new Set(), skippedPieces: new Set(), branches: new Map(), auto: {}, laps: new Map(), calls: new Map(),
    };
    this.runs.set(id, run);
    const v = await factoryVersion(this.factory.root);
    run.summary.baseCommit = v.commit;
    run.summary.dirty = !!v.diff;
    if (v.diff) fs.writeFileSync(path.join(dir, 'factory.diff'), v.diff);
    this.source = source;
    this.record(run, { type: 'run.start', input, actor, baseCommit: v.commit, dirty: !!v.diff });
    this.record(run, { type: 'verb', verb: 'run', actor });
    this.source = undefined;
    this.log({ level: 'factory', sectorId: line.def.sectorId, lineId, runId: id, kind: 'info', text: `${line.def.name}: run started (${Object.values(input).join(', ') || 'no input'}) by ${actor}` });
    const box: Box = { id: `${id}:intake`, runId: id, payload: { ...input }, color: '#c8a46a' };
    this.finishPiece(run, '@intake', box);
    this.changed();
    return id;
  }

  retry(lineId: string, pieceId: string, hint = '', actor = 'you') {
    const line = this.mustLine(lineId);
    const p = this.mustPiece(line, pieceId);
    if (p.state !== 'fire' || !p.current) throw new Error(`${p.def.label} is not stopped`);
    const run = this.runs.get(p.current.runId)!;
    this.record(run, { type: 'verb', verb: 'retry', actor, piece: pieceId, hint });
    this.log({ level: 'sector', sectorId: line.def.sectorId, lineId, pieceId, runId: run.summary.id, kind: 'info', text: `${p.def.label}: retry by ${actor}${hint ? ` with hint "${hint}"` : ''}` });
    p.error = undefined;
    // retrying a piece whose rework laps ran out grants its return belts a fresh set of laps
    for (const k of [...run.laps.keys()]) if (k.endsWith(`>${pieceId}`)) run.laps.delete(k);
    const work = { ...p.current, hint: hint || undefined, attempt: undefined };
    p.current = undefined;
    p.state = 'idle';
    this.refreshStatus(run);
    p.queue.unshift(work);
    this.pump(line, p);
    this.changed();
  }

  release(lineId: string, pieceId: string, confirmations: number, actor = 'you', decision?: { choice: string; note?: string }) {
    const line = this.mustLine(lineId);
    const p = this.mustPiece(line, pieceId);
    if (p.def.kind !== 'gate' || p.state !== 'holding' || !p.current) throw new Error(`${p.def.label} is not holding a box`);
    const need = p.def.confirmations ?? 1;
    if (!p.def.rule && confirmations < need) throw new Error(`${p.def.label} needs ${need} confirmations`);
    if (p.def.choices) {
      if (!decision?.choice) throw new Error(`${p.def.label}: choose one of ${p.def.choices.join(', ')}`);
      if (!p.def.choices.includes(decision.choice)) throw new Error(`"${decision.choice}" is not one of ${p.def.choices.join(', ')}`);
    }
    const run = this.runs.get(p.current.runId)!;
    const note = decision?.note?.trim() ?? '';
    this.record(run, { type: 'verb', verb: 'release', actor, piece: pieceId, confirmations, ...(p.def.choices ? { choice: decision!.choice, note } : {}) });
    this.log({ level: 'sector', sectorId: line.def.sectorId, lineId, pieceId, runId: run.summary.id, kind: 'ok', text: p.def.choices ? `${p.def.label}: ${actor} chose ${decision!.choice}${note ? ` — "${note}"` : ''}` : `${p.def.label} released by ${actor}` });
    const work = p.current;
    p.current = undefined;
    p.state = 'passed';
    p.error = undefined;
    this.refreshStatus(run);
    const payload = { ...work.box.payload, ...(p.def.choices ? { decision: { choice: decision!.choice, note } } : {}) };
    this.finishPiece(run, pieceId, { ...work.box, payload });
    this.pump(line, p);
    this.changed();
  }

  /** Answers a machine that asked for you (D21); it reruns without spending an attempt. */
  answer(lineId: string, pieceId: string, text: string, actor = 'you') {
    const line = this.mustLine(lineId);
    const p = this.mustPiece(line, pieceId);
    if (p.state !== 'asking' || !p.current || !p.question) throw new Error(`${p.def.label} is not asking anything`);
    if (!text.trim()) throw new Error('Write an answer first');
    const run = this.runs.get(p.current.runId)!;
    this.record(run, { type: 'verb', verb: 'answer', actor, piece: pieceId, question: p.question.question, answer: text });
    this.log({ level: 'sector', sectorId: line.def.sectorId, lineId, pieceId, runId: run.summary.id, kind: 'info', text: `${p.def.label}: ${actor} answered "${text}"` });
    const work: Work = { ...p.current, box: { ...p.current.box, payload: { ...p.current.box.payload, human_answer: { question: p.question.question, answer: text } } } };
    p.current = undefined;
    p.question = undefined;
    p.state = 'idle';
    p.queue.unshift(work);
    this.pump(line, p);
    this.changed();
  }

  halt(lineId: string, actor = 'you') {
    const line = this.mustLine(lineId);
    if (line.halted) return;
    line.halted = true;
    this.persistHalt(line);
    this.audit(line.def.sectorId, { verb: 'halt', actor, lineId });
    this.log({ level: 'sector', sectorId: line.def.sectorId, lineId, kind: 'warn', text: `${line.def.name} halted by ${actor}` });
    for (const run of this.runs.values()) if (run.summary.lineId === lineId && !run.summary.endedAt) this.record(run, { type: 'verb', verb: 'halt', actor });
    this.changed();
  }

  resume(lineId: string, actor = 'you') {
    const line = this.mustLine(lineId);
    if (!line.halted) return;
    line.halted = false;
    this.persistHalt(line);
    this.audit(line.def.sectorId, { verb: 'resume', actor, lineId });
    this.log({ level: 'sector', sectorId: line.def.sectorId, lineId, kind: 'info', text: `${line.def.name} resumed by ${actor}` });
    for (const run of this.runs.values()) if (run.summary.lineId === lineId && !run.summary.endedAt) this.record(run, { type: 'verb', verb: 'resume', actor });
    const pending = line.deferred.splice(0);
    pending.forEach((f) => f());
    for (const p of line.pieces.values()) this.pump(line, p);
    this.changed();
  }

  /** Counts automatic verb uses per run, for the policy (D34). */
  autoUses(runId: string, verb: VerbName) { return this.runs.get(runId)?.auto[verb] ?? 0; }
  noteAuto(runId: string, verb: VerbName) { const r = this.runs.get(runId); if (r) r.auto[verb] = (r.auto[verb] ?? 0) + 1; }

  /** Sector-level audit log for verbs that are not about one run (D30). */
  audit(sectorId: string, entry: Record<string, unknown>) {
    const f = path.join(this.factory.root, RUNS_DIR, sectorId, 'audit.jsonl');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, JSON.stringify({ t: this.now(), ...entry, ...(this.source ? { source: this.source } : {}) }) + '\n');
  }

  private persistHalt(line: LineRt) {
    const f = path.join(this.factory.root, RUNS_DIR, line.def.id, 'HALTED');
    if (line.halted) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, String(this.now())); }
    else if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  /** A run is on fire while any of its pieces is; otherwise it is running. */
  private refreshStatus(run: RunRt) {
    if (run.summary.endedAt) return;
    const line = this.lines.get(run.summary.lineId);
    const burning = !!line && [...line.pieces.values()].some((p) => p.state === 'fire' && p.current?.runId === run.summary.id);
    run.summary.status = burning ? 'fire' : 'running';
  }

  private mustLine(id: string) { const l = this.lines.get(id); if (!l) throw new Error(`Unknown line ${id}`); return l; }
  private mustPiece(l: LineRt, id: string) { const p = l.pieces.get(id); if (!p) throw new Error(`Unknown piece ${id}`); return p; }

  // ---------- flow ----------

  private outgoing(line: LineDef, from: string) {
    const out: { to: PieceDef; when?: string; back?: boolean; laps?: number }[] = [];
    for (const p of line.model.pieces) for (const n of p.needs) if (n.from === from) out.push({ to: p, when: n.when, back: n.back, laps: n.laps });
    return out;
  }

  /** A piece is done with a box: send it down every belt whose rule accepts it. */
  private finishPiece(run: RunRt, pieceId: string, box: Box, backOnly = false) {
    const line = this.lines.get(run.summary.lineId)!;
    if (line.halted) { line.deferred.push(() => this.finishPiece(run, pieceId, box, backOnly)); return; }
    run.done.add(pieceId);
    const p = line.pieces.get(pieceId);
    if (!p) return;
    if (!backOnly) { p.lastBox = box.payload; p.lastRunId = run.summary.id; } // a failed signal sent nothing forward
    this.record(run, { type: 'piece.done', piece: pieceId, box: box.payload, branch: run.branches.get(pieceId), ...(backOnly ? { failed: true } : {}) });
    let taken = 0;
    const skips: string[] = [];
    // a failed signal only uses its return belts (D20)
    const outs = this.outgoing(run.line, pieceId).filter((o) => !backOnly || (o.back && o.when)).map((o) => {
      let ok = true;
      if (o.when) { try { ok = evaluate(o.when, box.payload); } catch { ok = false; } }
      return { ...o, ok };
    });
    // A box sent back for rework will pass this piece again, so its forward skips wait for that verdict.
    const sentBack = outs.some((o) => o.back && o.ok);
    for (const { to, when, back, ok } of outs) {
      if (back && !ok) continue; // a return belt not taken changes nothing
      if (ok || !sentBack) this.record(run, { type: 'edge', from: pieceId, to: to.id, taken: ok, back });
      if (!ok) {
        this.log({ level: 'sector', sectorId: run.line.sectorId, lineId: run.line.id, pieceId, runId: run.summary.id, kind: 'info', text: `${p.def.label}: "${when}" is false, skipping ${to.label}` });
        skips.push(to.id);
        continue;
      }
      taken++;
      const belt: Belt = { box: { ...box, payload: { ...box.payload } }, from: pieceId, to: to.id, since: this.now(), ms: back ? this.beltMs * 2 : this.beltMs, back };
      line.belts.push(belt);
      belt.timer = setTimeout(() => {
        line.belts = line.belts.filter((b) => b !== belt);
        if (back) this.rework(run, to.id, pieceId, belt.box); else this.arrive(run, to.id, pieceId, belt.box);
      }, belt.ms);
    }
    // Skips go last, so a run with a live belt never looks stuck.
    if (!sentBack) for (const to of skips) this.skipEdge(run, pieceId, to);
    if (!taken && pieceId !== '@pallet') this.checkStuck(run);
    this.changed();
  }

  /** A box came back along a return belt: reopen the stretch from `target` to `from` and run it again (D15). */
  private rework(run: RunRt, target: string, from: string, box: Box) {
    const line = this.lines.get(run.summary.lineId)!;
    if (line.halted) { line.deferred.push(() => this.rework(run, target, from, box)); return; }
    const need = line.def.model.pieces.find((p) => p.id === target)!.needs.find((n) => n.from === from && n.back)!;
    const key = `${from}>${target}`;
    const used = (run.laps.get(key) ?? 0) + 1;
    const limit = need.laps ?? 3;
    const exhausted = used > limit;
    if (!exhausted) run.laps.set(key, used);
    // everything on the way from target to `from` runs again
    const pieces = line.def.model.pieces;
    const fwd = (id: string) => pieces.filter((q) => q.needs.some((n) => n.from === id && !n.back)).map((q) => q.id);
    const down = new Set<string>([target]); const stack = [target];
    while (stack.length) for (const n of fwd(stack.pop()!)) if (!down.has(n)) { down.add(n); stack.push(n); }
    const up = new Set<string>([from]); const st2 = [from];
    while (st2.length) { const id = st2.pop()!; for (const n of pieces.find((q) => q.id === id)!.needs) if (!n.back && !up.has(n.from)) { up.add(n.from); st2.push(n.from); } }
    const reopened = [...down].filter((id) => up.has(id));
    // pieces after the target that were skipped on the last lap may be reached this time
    const reset = [...down].filter((id) => !up.has(id) && run.skippedPieces.has(id));
    reopen(run, target, reopened, reset);
    this.record(run, { type: 'rework', from, to: target, lap: exhausted ? limit : used, laps: limit, reopened, reset, exhausted, feedback: box.payload });
    const p = line.pieces.get(target)!;
    const input: Payload = Object.assign({}, ...[...(run.arrivals.get(target)?.values() ?? [])].map((b) => b.payload));
    const work: Work = { runId: run.summary.id, box: { id: `${run.summary.id}:${target}`, runId: run.summary.id, payload: { ...input, feedback: box.payload }, color: box.color } };
    if (exhausted) {
      work.stop = `${limit} rework lap${limit === 1 ? '' : 's'} used and ${this.label(line, from)} still sends it back. Retry to run it again. Last findings: ${typeof box.payload.signal_output === 'string' ? box.payload.signal_output.slice(-300) : JSON.stringify(box.payload).slice(0, 300)}`;
      p.queue.unshift(work);
      this.pump(line, p);
      return;
    }
    this.log({ level: 'sector', sectorId: run.line.sectorId, lineId: run.line.id, pieceId: target, runId: run.summary.id, kind: 'warn', text: `${this.label(line, from)} sent it back to ${this.label(line, target)} (lap ${used} of ${limit})` });
    // two checkers sending the same piece back together rework it once, with both findings
    const queued = p.queue.find((w) => w.runId === run.summary.id);
    if (queued) { const fb = queued.box.payload.feedback; queued.box.payload.feedback = [...(Array.isArray(fb) ? fb : [fb]), box.payload]; this.changed(); return; }
    if (p.current?.runId === run.summary.id) { this.changed(); return; }
    this.enqueue(line, run, p, work.box);
    for (const id of reset) this.checkReady(run, id);
    this.changed();
  }

  private label(line: LineRt, id: string) { return line.pieces.get(id)?.def.label ?? id; }

  private skipEdge(run: RunRt, from: string, to: string) {
    run.skipped.add(`${from}>${to}`);
    this.checkReady(run, to);
  }

  private arrive(run: RunRt, to: string, from: string, box: Box) {
    const line = this.lines.get(run.summary.lineId)!;
    if (line.halted) { line.deferred.push(() => this.arrive(run, to, from, box)); return; }
    if (!run.arrivals.has(to)) run.arrivals.set(to, new Map());
    run.arrivals.get(to)!.set(from, box);
    this.checkReady(run, to);
    this.changed();
  }

  private checkReady(run: RunRt, pieceId: string) {
    if (run.done.has(pieceId)) return;
    const line = this.lines.get(run.summary.lineId)!;
    const p = line.pieces.get(pieceId);
    if (!p) return;
    if (p.current?.runId === run.summary.id || p.queue.some((w) => w.runId === run.summary.id)) return;
    const arrived = run.arrivals.get(pieceId) ?? new Map<string, Box>();
    const fwdNeeds = p.def.needs.filter((n) => !n.back);
    const resolved = fwdNeeds.every((n) => arrived.has(n.from) || run.skipped.has(`${n.from}>${pieceId}`));
    if (!resolved) return;
    if (!arrived.size) {
      run.done.add(pieceId);
      run.skippedPieces.add(pieceId);
      this.record(run, { type: 'piece.skip', piece: pieceId });
      if (pieceId === '@pallet') { this.endRun(run, 'stopped', 'Every belt into the pallet was skipped, so nothing was delivered.'); return; }
      for (const { to, back } of this.outgoing(run.line, pieceId)) if (!back) this.skipEdge(run, pieceId, to.id);
      this.checkStuck(run);
      return;
    }
    const boxes = fwdNeeds.map((n) => arrived.get(n.from)).filter((b): b is Box => !!b);
    const merged: Box = { id: `${run.summary.id}:${pieceId}`, runId: run.summary.id, payload: Object.assign({}, ...boxes.map((b) => b.payload)), color: boxes[0].color };
    this.enqueue(line, run, p, merged);
  }

  private checkStuck(run: RunRt) {
    if (run.summary.status !== 'running') return;
    const line = this.lines.get(run.summary.lineId)!;
    const busy = [...line.pieces.values()].some((p) => p.current?.runId === run.summary.id || p.queue.some((w) => w.runId === run.summary.id));
    const moving = line.belts.some((b) => b.box.runId === run.summary.id) || line.deferred.length > 0;
    if (!busy && !moving && !run.summary.deliverable) this.endRun(run, 'stopped', 'No belt accepted the box, so the run stopped before the pallet.');
  }

  private enqueue(line: LineRt, run: RunRt, p: PieceRt, box: Box) {
    const def = p.def;
    if (def.kind === 'pallet') {
      run.done.add('@pallet');
      p.pallet++;
      p.lastBox = box.payload;
      p.lastRunId = run.summary.id;
      run.summary.deliverable = box.payload;
      this.record(run, { type: 'piece.done', piece: '@pallet', box: box.payload });
      this.endRun(run, 'done');
      return;
    }
    if (def.kind === 'gate' && def.rule) {
      let ok = false;
      try { ok = evaluate(def.rule, box.payload); } catch { ok = false; }
      if (ok) {
        this.log({ level: 'sector', sectorId: run.line.sectorId, lineId: run.line.id, pieceId: def.id, runId: run.summary.id, kind: 'ok', text: `${def.label}: "${def.rule}" holds, passing` });
        p.state = 'passed';
        this.finishPiece(run, def.id, box);
        return;
      }
    }
    p.queue.push({ runId: run.summary.id, box });
    this.pump(line, p);
  }

  /** Starts the next queued work on a piece; pieces handle one box at a time. */
  private pump(line: LineRt, p: PieceRt) {
    if (line.halted || p.current || !p.queue.length) return;
    // while the engine waits to restart (D43), nothing new starts; gates still take boxes, they run no process
    if (this.paused && p.def.kind !== 'gate') return;
    const work = p.queue.shift()!;
    const run = this.runs.get(work.runId);
    if (!run) return;
    p.current = work;
    p.since = this.now();
    if (work.stop) { const why = work.stop; delete work.stop; this.stop(run, p, why); return; }
    if (p.def.kind === 'gate') {
      p.state = 'holding';
      p.error = p.def.rule ? `Rule "${p.def.rule}" does not hold for this box. Release it to let it through anyway.` : undefined;
      this.record(run, { type: 'piece.hold', piece: p.def.id });
      this.log({ level: 'sector', sectorId: run.line.sectorId, lineId: run.line.id, pieceId: p.def.id, runId: run.summary.id, kind: 'warn', text: `${p.def.label} is waiting for you` });
      this.changed();
      return;
    }
    p.state = 'busy';
    p.error = undefined;
    this.changed();
    const job = p.def.kind === 'machine' ? this.work(line, run, p, work) : this.check(line, run, p, work);
    job.catch((e) => this.stop(run, p, `Internal error: ${(e as Error).message}`));
  }

  private stop(run: RunRt, p: PieceRt, error: string) {
    p.state = 'fire';
    p.error = error;
    p.since = this.now();
    run.summary.status = 'fire';
    this.record(run, { type: 'piece.fire', piece: p.def.id, error });
    this.log({ level: 'sector', sectorId: run.line.sectorId, lineId: run.line.id, pieceId: p.def.id, runId: run.summary.id, kind: 'fail', text: `${run.line.name}: ${p.def.label} stopped — ${error}` });
    this.changed();
  }

  private endRun(run: RunRt, status: RunStatus, why?: string) {
    run.summary.status = status;
    run.summary.endedAt = this.now();
    this.record(run, { type: 'run.end', status, why });
    const dur = Math.round((run.summary.endedAt - run.summary.startedAt) / 1000);
    this.log({ level: 'factory', sectorId: run.line.sectorId, lineId: run.line.id, runId: run.summary.id, kind: status === 'done' ? 'ok' : 'warn', text: `${run.line.name}: run ${status === 'done' ? 'finished' : status} in ${dur}s${why ? ` — ${why}` : ''}` });
    this.changed();
  }

  /** Machines upstream of a piece, walking back through signals and gates. */
  private upstreamMachines(line: LineDef, pieceId: string): string[] {
    const byId = new Map(line.model.pieces.map((p) => [p.id, p]));
    const out: string[] = [];
    const seen = new Set<string>();
    const walk = (id: string) => {
      for (const n of byId.get(id)!.needs) {
        if (n.back || seen.has(n.from)) continue;
        seen.add(n.from);
        const q = byId.get(n.from)!;
        if (q.kind === 'machine') out.push(q.id); else walk(q.id);
      }
    };
    walk(pieceId);
    return out;
  }

  private async prepareFolder(run: RunRt, pieceId: string): Promise<string> {
    const dir = path.join(run.dir, 'machines', pieceId);
    const ups = this.upstreamMachines(run.line, pieceId).filter((m) => run.branches.has(m));
    if (fs.existsSync(dir)) {
      // a machine running again (rework) first catches up with its upstream branches
      if (run.line.repo) for (const u of ups) {
        const m = await mergeInto(dir, run.branches.get(u)!);
        if (!m.ok) throw new Error(m.conflict);
      }
      return dir;
    }
    if (!run.line.repo) { fs.mkdirSync(dir, { recursive: true }); return dir; }
    const branch = `roboratory/${run.summary.id}/${pieceId}`;
    const base = ups.length ? run.branches.get(ups[0])! : await headOf(run.line.repo);
    await addWorktree(run.line.repo, dir, branch, base);
    for (const other of ups.slice(1)) {
      const m = await mergeInto(dir, run.branches.get(other)!);
      if (!m.ok) {
        // start over on retry: the folder must not survive a failed merge
        await removeWorktree(run.line.repo, dir);
        fs.rmSync(dir, { recursive: true, force: true });
        await git(run.line.repo, ['worktree', 'prune'], { allowFail: true });
        throw new Error(m.conflict);
      }
    }
    return dir;
  }

  private async work(line: LineRt, run: RunRt, p: PieceRt, w: Work) {
    const def = p.def;
    const machine = run.line.model.machines[def.machine!];
    let dir: string;
    try { dir = await this.prepareFolder(run, def.id); }
    catch (e) { return this.stop(run, p, (e as Error).message); }
    // On a repository line the box lives outside the worktree, so it never gets committed.
    const boxFile = run.line.repo ? path.join(run.dir, 'boxes', `${def.id}.json`) : path.join(dir, 'box.json');
    fs.mkdirSync(path.dirname(boxFile), { recursive: true });
    fs.writeFileSync(boxFile, JSON.stringify(w.box.payload, null, 2));
    const key = machine.dir;
    let validate = validators.get(key);
    if (!validate) { validate = ajv.compile(machine.contract); validators.set(key, validate); }
    const siblings = fs.existsSync(path.join(run.dir, 'machines')) ? fs.readdirSync(path.join(run.dir, 'machines')).filter((d) => d !== def.id).map((d) => path.join(run.dir, 'machines', d)) : [];
    const addDirs = [...siblings, ...(run.line.repo ? [path.dirname(boxFile)] : []), ...machine.dirs.filter((d) => fs.existsSync(d))];
    const branch = run.line.repo ? `roboratory/${run.summary.id}/${def.id}` : undefined;
    const simFail = !!machine.sim?.fail_first_run && !this.simFailed.has(key) && !w.hint;
    const call = run.calls.get(def.id) ?? 0;
    run.calls.set(def.id, call + 1);
    const sector = this.sectorOf(run.line);
    const role = [machine.role, this.factory.culture, sector?.culture].filter((x) => x && x.trim()).join('\n\n');

    let lastError = '';
    for (let attempt = w.attempt ?? 1; attempt <= machine.attempts; attempt++) {
      if (line.halted) { w.attempt = attempt; line.deferred.push(() => { p.current = undefined; p.queue.unshift(w); p.state = 'idle'; this.pump(line, p); }); p.state = 'idle'; this.changed(); return; }
      p.attempt = attempt;
      this.record(run, { type: 'piece.start', piece: def.id, attempt, box: w.box.payload });
      this.log({ level: 'sector', sectorId: run.line.sectorId, lineId: run.line.id, pieceId: def.id, runId: run.summary.id, kind: 'info', text: `${def.label}: attempt ${attempt}/${machine.attempts} (${machine.agent})` });
      this.changed();
      const abort = new AbortController();
      p.abort = abort;
      const res = await runAgent({
        agent: machine.agent, model: machine.model, effort: machine.effort, role, schema: machine.contract, question: ALTERNATIVES, cwd: dir, addDirs,
        allow: machine.allow, tools: machine.tools, readOnly: false, timeoutMs: machine.timeoutMs, sim: machine.sim, simFail,
        simCtx: { box: w.box.payload, params: run.line.params, run: { id: run.summary.id }, git: { branch }, call },
        prompt: machinePrompt(run, this.factory.lineContext ? def.id : undefined, def.label, w.box.payload, machine.contract, siblings, lastError, w.hint, boxFile),
        signal: abort.signal,
        onEvent: (e: AgentEvent) => {
          this.record(run, { type: 'agent', piece: def.id, attempt, kind: e.kind, text: e.text });
          this.log({ level: 'machine', sectorId: run.line.sectorId, lineId: run.line.id, pieceId: def.id, runId: run.summary.id, kind: e.kind === 'ret' ? 'text' : e.kind === 'tool' ? 'tool' : 'text', text: e.kind === 'ret' ? `◂ ${e.text}` : e.kind === 'tool' ? `▸ ${e.text}` : e.text });
        },
      });
      p.abort = undefined;
      if (res.costUsd !== undefined) this.record(run, { type: 'cost', piece: def.id, usd: res.costUsd });
      const ask = (res.output as { needs_human?: HumanQuestion } | undefined)?.needs_human;
      if (!res.error && ask && typeof ask.question === 'string') {
        p.state = 'asking';
        p.question = { question: ask.question, options: Array.isArray(ask.options) ? ask.options.map(String) : undefined, recommendation: ask.recommendation ? String(ask.recommendation) : undefined };
        p.since = this.now();
        w.attempt = attempt; // the answer reruns this attempt
        this.record(run, { type: 'piece.ask', piece: def.id, question: p.question });
        this.log({ level: 'sector', sectorId: run.line.sectorId, lineId: run.line.id, pieceId: def.id, runId: run.summary.id, kind: 'warn', text: `${def.label} needs you: ${ask.question}` });
        this.changed();
        return;
      }
      const blocked = (res.output as { blocked?: { reason?: unknown } } | undefined)?.blocked;
      if (!res.error && blocked && typeof blocked.reason === 'string') {
        this.record(run, { type: 'piece.blocked', piece: def.id, attempt, reason: blocked.reason });
        this.stop(run, p, `Blocked: ${blocked.reason}`);
        return;
      }
      if (res.error) { lastError = res.error; }
      else if (!validate(res.output)) { lastError = ajv.errorsText(validate.errors, { dataVar: 'output' }); }
      else {
        if (branch) {
          const c = await commitLeftovers(dir, `${def.label}: work left uncommitted by the agent (${run.summary.id})`);
          run.branches.set(def.id, branch);
          if (c.committed) this.log({ level: 'machine', sectorId: run.line.sectorId, lineId: run.line.id, pieceId: def.id, runId: run.summary.id, kind: 'info', text: 'Committed work the agent left uncommitted.' });
        }
        this.log({ level: 'sector', sectorId: run.line.sectorId, lineId: run.line.id, pieceId: def.id, runId: run.summary.id, kind: 'ok', text: `${def.label} → contract valid on attempt ${attempt}` });
        p.state = 'idle';
        p.current = undefined;
        p.attempt = undefined;
        this.finishPiece(run, def.id, { id: `${run.summary.id}:${def.id}`, runId: run.summary.id, payload: res.output as Payload, color: colorFor(def.machine!) });
        this.pump(line, p);
        return;
      }
      this.record(run, { type: 'attempt.rejected', piece: def.id, attempt, error: lastError });
      this.log({ level: 'sector', sectorId: run.line.sectorId, lineId: run.line.id, pieceId: def.id, runId: run.summary.id, kind: 'warn', text: `${def.label}: attempt ${attempt} rejected — ${lastError}` });
    }
    if (simFail) this.simFailed.add(key);
    this.stop(run, p, `${machine.attempts}/${machine.attempts} attempts used. Last error: ${lastError}`);
  }

  private resolveSignal(line: LineDef, cmd: string): string {
    return cmd.replace(/(^|\s)(signals\/[^\s]+)/g, (m, pre, rel) => {
      for (const base of [line.model.dir, path.join(this.factory.root, 'shared')]) {
        const abs = path.join(base, rel);
        if (fs.existsSync(abs)) return `${pre}${JSON.stringify(abs)}`;
      }
      return m;
    });
  }

  private async check(line: LineRt, run: RunRt, p: PieceRt, w: Work) {
    const def = p.def;
    const ups = this.upstreamMachines(run.line, def.id);
    const cwdCandidate = ups.length ? path.join(run.dir, 'machines', ups[0]) : run.dir;
    const cwd = fs.existsSync(cwdCandidate) ? cwdCandidate : run.dir;
    const boxFile = path.join(run.dir, `box-${def.id}.json`);
    fs.writeFileSync(boxFile, JSON.stringify(w.box.payload, null, 2));
    const cmd = renderCommand(this.resolveSignal(run.line, def.run!), { box: w.box.payload, params: run.line.params, run: { id: run.summary.id } });
    this.record(run, { type: 'piece.start', piece: def.id, command: cmd });
    this.log({ level: 'sector', sectorId: run.line.sectorId, lineId: run.line.id, pieceId: def.id, runId: run.summary.id, kind: 'info', text: `${def.label}: running ${def.run}` });
    const out: string[] = [];
    const limitMs = def.timeoutMs ?? this.signalTimeoutMs;
    let timedOut = false;
    const code = await new Promise<number | null>((resolve) => {
      // its own process group, so a timeout stops everything the script started (D19)
      const child = spawn('sh', ['-c', cmd], { cwd, detached: true, windowsHide: true, env: { ...process.env, ROBORATORY_BOX: boxFile, ROBORATORY_RUN: run.summary.id, ROBORATORY_RUN_DIR: run.dir } });
      // on Windows there are no process groups: the whole tree is stopped with taskkill
      const group = (sig: NodeJS.Signals) => {
        if (process.platform === 'win32') { if (child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {}); return; }
        try { process.kill(-child.pid!, sig); } catch { /* already gone */ }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        group('SIGTERM');
        setTimeout(() => group('SIGKILL'), 5000).unref();
        child.stdout.destroy(); child.stderr.destroy();
        resolve(null);
      }, limitMs);
      const onData = (d: Buffer) => {
        for (const l of d.toString().split('\n')) if (l.trim()) {
          out.push(l);
          this.record(run, { type: 'agent', piece: def.id, kind: 'text', text: l });
          this.log({ level: 'machine', sectorId: run.line.sectorId, lineId: run.line.id, pieceId: def.id, runId: run.summary.id, kind: 'text', text: l });
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', (e) => { out.push((e as NodeJS.ErrnoException).code === 'ENOENT' ? 'sh was not found: signals run as shell scripts, so on Windows install Git for Windows (or use WSL) and put sh on PATH' : e.message); });
      child.on('close', (c) => { clearTimeout(timer); resolve(c); });
      child.on('exit', () => group('SIGTERM')); // nothing the script left behind outlives it
    });
    if (code === 0 && !timedOut) {
      this.log({ level: 'sector', sectorId: run.line.sectorId, lineId: run.line.id, pieceId: def.id, runId: run.summary.id, kind: 'ok', text: `${def.label} passed` });
      p.state = 'passed';
      p.current = undefined;
      this.finishPiece(run, def.id, w.box);
      this.pump(line, p);
      return;
    }
    const why = timedOut ? `timed out after ${duration(limitMs)}` : `exited with ${code}${out.length ? `: ${out[out.length - 1]}` : ''}`;
    // a failing signal with a return belt sends the box back for rework (D20); a timeout is not a failure of the work (D19)
    const failed: Box = { ...w.box, payload: { ...w.box.payload, signal: 'fail', signal_output: [...out.slice(-40), why].join('\n') } };
    const back = timedOut ? [] : this.outgoing(run.line, def.id).filter((o) => o.back && o.when && accepts(o.when, failed.payload));
    if (back.length) {
      this.log({ level: 'sector', sectorId: run.line.sectorId, lineId: run.line.id, pieceId: def.id, runId: run.summary.id, kind: 'warn', text: `${def.label} failed (${why}); sending it back` });
      p.state = 'idle';
      p.current = undefined;
      this.finishPiece(run, def.id, failed, true);
      this.pump(line, p);
      return;
    }
    this.stop(run, p, why);
  }

  // ---------- views ----------

  lineView(id: string): LineView {
    const l = this.lines.get(id)!;
    const pieces: Record<string, PieceView> = {};
    const boxes: BoxView[] = [];
    for (const [pid, p] of l.pieces) {
      const run = p.current ? this.runs.get(p.current.runId) : undefined;
      const def = run?.line.model.machines[p.def.machine ?? ''];
      pieces[pid] = {
        id: pid, state: l.halted && p.state === 'idle' ? 'idle' : p.state, runId: p.current?.runId, queue: p.queue.length,
        attempt: p.attempt, attempts: def?.attempts, error: p.error, since: p.since,
        lastBox: p.lastBox, lastRunId: p.lastRunId, pallet: p.pallet, question: p.question,
      };
      const atPiece = [...(p.current ? [p.current] : []), ...p.queue];
      for (const w of atPiece) boxes.push({ id: w.box.id, runId: w.runId, at: { piece: pid }, color: w.box.color, payload: w.box.payload });
    }
    for (const b of l.belts) boxes.push({ id: `${b.box.id}>${b.to}${b.back ? '<' : ''}`, runId: b.box.runId, at: { from: b.from, to: b.to, since: b.since, ms: b.ms }, color: b.box.color, payload: b.box.payload });
    return { id, sectorId: l.def.sectorId, halted: l.halted, pieces, boxes };
  }

  attention(): AttentionItem[] {
    const items: AttentionItem[] = [];
    for (const l of this.lines.values()) for (const [pid, p] of l.pieces) {
      if (p.state === 'fire') items.push({ id: `${l.def.id}#${pid}`, severity: 3, kind: p.def.kind === 'signal' ? 'signal' : 'fire', sectorId: l.def.sectorId, lineId: l.def.id, pieceId: pid, runId: p.current?.runId, since: p.since ?? this.now(), title: `${p.def.label} stopped`, detail: `${l.def.name} · ${p.error ?? ''}` });
      if (p.state === 'asking') items.push({ id: `${l.def.id}#${pid}`, severity: 2, kind: 'question', sectorId: l.def.sectorId, lineId: l.def.id, pieceId: pid, runId: p.current?.runId, since: p.since ?? this.now(), title: `${p.def.label} asks you`, detail: `${l.def.name} · ${p.question?.question ?? ''}` });
      if (p.state === 'holding') items.push({ id: `${l.def.id}#${pid}`, severity: 2, kind: 'gate', sectorId: l.def.sectorId, lineId: l.def.id, pieceId: pid, runId: p.current?.runId, since: p.since ?? this.now(), title: `${p.def.label} is waiting for you`, detail: `${l.def.name}${p.queue.length ? ` · ${p.queue.length} more behind it` : ''}` });
    }
    return items.sort((a, b) => b.severity - a.severity || a.since - b.since);
  }

  /** Stops starting machines and signals; the ones running finish. Queued work is rebuilt from the run files after a restart. */
  pauseDispatch() { this.paused = true; this.changed(); }

  resumeDispatch() {
    if (!this.paused) return;
    this.paused = false;
    for (const l of this.lines.values()) for (const p of l.pieces.values()) this.pump(l, p);
    this.changed();
  }

  get dispatchPaused() { return this.paused; }

  /** Machines and signals running right now. */
  runningCount() { let n = 0; for (const l of this.lines.values()) for (const p of l.pieces.values()) if (p.state === 'busy') n++; return n; }

  /** Lines with a run that has not ended (running, on fire, or halted). */
  activeLineIds(): Set<string> { return new Set([...this.runs.values()].filter((r) => !r.summary.endedAt).map((r) => r.summary.lineId)); }

  runSummaries(): RunSummary[] { return [...this.runs.values()].map((r) => r.summary).sort((a, b) => b.startedAt - a.startedAt); }

  runEvents(runId: string): Record<string, unknown>[] {
    const run = this.runs.get(runId);
    if (!run) return [];
    const file = path.join(run.dir, 'run.jsonl');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  }

  runDiff(runId: string): string | undefined {
    const run = this.runs.get(runId);
    const f = run && path.join(run.dir, 'factory.diff');
    return f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : undefined;
  }

  // ---------- restore (v0.1 exit: restarting restores the floor from run files) ----------

  restore() {
    const base = path.join(this.factory.root, RUNS_DIR);
    if (!fs.existsSync(base)) return;
    for (const l of this.lines.values()) {
      const dir = path.join(base, l.def.id);
      if (!fs.existsSync(dir)) continue;
      if (fs.existsSync(path.join(dir, 'HALTED'))) l.halted = true;
      for (const id of fs.readdirSync(dir).sort()) {
        const file = path.join(dir, id, 'run.jsonl');
        if (!fs.existsSync(file)) continue;
        try { this.restoreRun(l, id, path.join(dir, id), file); } catch (e) { this.factory.warnings.push(`Could not restore run ${id}: ${(e as Error).message}`); }
      }
    }
    this.changed();
  }

  private restoreRun(l: LineRt, id: string, dir: string, file: string) {
    const events = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x) as Record<string, any>);
    const start = events.find((e) => e.type === 'run.start');
    if (!start) return;
    const run: RunRt = {
      summary: { id, sectorId: l.def.sectorId, lineId: l.def.id, status: 'running', startedAt: start.t, input: start.input, baseCommit: start.baseCommit, dirty: start.dirty },
      dir, line: l.def, arrivals: new Map(), skipped: new Set(), done: new Set(), skippedPieces: new Set(), branches: new Map(), auto: {}, laps: new Map(), calls: new Map(),
    };
    this.runs.set(id, run);
    const boxes = new Map<string, Payload>();
    /** every box a piece sent, a failed signal's included (D20) */
    const sent = new Map<string, Payload>();
    const started = new Set<string>();
    const fired = new Map<string, string>();
    const holding = new Set<string>();
    const asking = new Map<string, HumanQuestion>();
    const since = new Map<string, number>();
    const startBox = new Map<string, Payload>();
    const pendingBack = new Map<string, { from: string; to: string }>();
    let delivered = false;
    for (const e of events) {
      if (e.type === 'piece.done' && e.piece === '@pallet') delivered = true;
      if (e.type === 'piece.fire' || e.type === 'piece.hold') since.set(e.piece, e.t);
      if (e.type === 'piece.done') { run.done.add(e.piece); sent.set(e.piece, e.box); if (!e.failed) boxes.set(e.piece, e.box); if (e.branch) run.branches.set(e.piece, e.branch); started.delete(e.piece); fired.delete(e.piece); holding.delete(e.piece); }
      if (e.type === 'piece.skip') { run.done.add(e.piece); run.skippedPieces.add(e.piece); }
      if (e.type === 'piece.start') { started.add(e.piece); if (e.box) startBox.set(e.piece, e.box); }
      if (e.type === 'edge' && e.back && e.taken) pendingBack.set(`${e.from}>${e.to}`, { from: e.from, to: e.to });
      if (e.type === 'rework') pendingBack.delete(`${e.from}>${e.to}`);
      if (e.type === 'piece.fire') fired.set(e.piece, e.error);
      if (e.type === 'piece.hold') holding.add(e.piece);
      if (e.type === 'piece.ask') { asking.set(e.piece, e.question); started.delete(e.piece); since.set(e.piece, e.t); }
      if (e.type === 'verb' && e.verb === 'answer') asking.delete(e.piece);
      if (e.type === 'rework') {
        run.laps.set(`${e.from}>${e.to}`, e.lap);
        reopen(run, e.to, e.reopened as string[], (e.reset as string[] | undefined) ?? []);
        startBox.set(e.to, { ...Object.assign({}, ...[...(run.arrivals.get(e.to)?.values() ?? [])].map((b) => b.payload)), feedback: e.feedback });
      }
      if (e.type === 'verb' && e.verb === 'retry') { fired.delete(e.piece); for (const k of [...run.laps.keys()]) if (k.endsWith(`>${e.piece}`)) run.laps.delete(k); }
      if (e.type === 'piece.done') run.calls.set(e.piece, (run.calls.get(e.piece) ?? 0) + 1);
      if (e.type === 'edge' && e.back) continue;
      if (e.type === 'edge') {
        if (!e.taken) run.skipped.add(`${e.from}>${e.to}`);
        else if (boxes.has(e.from)) { if (!run.arrivals.has(e.to)) run.arrivals.set(e.to, new Map()); run.arrivals.get(e.to)!.set(e.from, { id: `${id}:${e.from}`, runId: id, payload: boxes.get(e.from)!, color: '#c8a46a' }); }
      }
      if (e.type === 'run.end') { run.summary.status = e.status; run.summary.endedAt = e.t; }
    }
    for (const [pid, b] of boxes) { const p = l.pieces.get(pid); if (p) { p.lastBox = b; p.lastRunId = id; } }
    if (delivered) { const p = l.pieces.get('@pallet')!; p.pallet++; run.summary.deliverable = boxes.get('@pallet'); }
    if (run.summary.status !== 'running' && run.summary.status !== 'fire') return;
    // what the agents of an unfinished run said, so panels can show it again
    for (const e of events) if (e.type === 'agent') this.logs.push({ t: e.t, level: 'machine', sectorId: l.def.sectorId, lineId: l.def.id, pieceId: e.piece, runId: id, kind: e.kind === 'tool' ? 'tool' : 'text', text: e.kind === 'tool' ? `▸ ${e.text}` : e.kind === 'ret' ? `◂ ${e.text}` : e.text });
    if (!run.done.has('@intake')) { this.finishPiece(run, '@intake', { id: `${id}:intake`, runId: id, payload: { ...run.summary.input }, color: '#c8a46a' }); return; }
    // Rebuild in-flight work: interrupted steps come back stopped, gates come back holding.
    for (const p of l.def.model.pieces) {
      if (run.done.has(p.id)) continue;
      const arrived = run.arrivals.get(p.id);
      const rt = l.pieces.get(p.id)!;
      const merged = (): Box => ({ id: `${id}:${p.id}`, runId: id, payload: startBox.get(p.id) ?? Object.assign({}, ...[...(arrived?.values() ?? [])].map((b) => b.payload)), color: '#c8a46a' });
      if (asking.has(p.id)) {
        rt.current = { runId: id, box: merged() };
        rt.state = 'asking';
        rt.question = asking.get(p.id);
        rt.since = since.get(p.id) ?? this.now();
      } else if (fired.has(p.id) || started.has(p.id)) {
        rt.current = { runId: id, box: merged() };
        rt.state = 'fire';
        rt.since = since.get(p.id) ?? this.now();
        rt.error = fired.get(p.id) ?? 'Interrupted when Roboratory closed. Retry to run this step again.';
        run.summary.status = 'fire';
      } else if (holding.has(p.id)) {
        rt.current = { runId: id, box: merged() };
        rt.state = 'holding';
        rt.since = since.get(p.id) ?? this.now();
      }
    }
    for (const p of l.def.model.pieces) if (!run.done.has(p.id)) this.checkReady(run, p.id);
    // a box that was on a return belt when Roboratory closed comes back now
    for (const { from, to } of pendingBack.values()) {
      const fb = sent.get(from);
      if (fb) this.rework(run, to, from, { id: `${id}:${from}`, runId: id, payload: fb, color: '#c8a46a' });
    }
  }

  /** Picks up edited factory files. Runs in flight keep the definition they started with. */
  reload(f: FactoryDef) {
    this.factory = f;
    const seen = new Set<string>();
    for (const s of f.sectors) for (const l of s.lines) {
      seen.add(l.id);
      const rt = this.lines.get(l.id);
      if (!rt) { this.lines.set(l.id, this.makeLine(l)); continue; }
      rt.def = l;
      for (const p of l.model.pieces) {
        const old = rt.pieces.get(p.id);
        if (old) old.def = p; else rt.pieces.set(p.id, { def: p, state: 'idle', queue: [], pallet: 0 });
      }
      const active = [...this.runs.values()].some((r) => r.summary.lineId === l.id && !r.summary.endedAt);
      for (const [id, p] of rt.pieces) if (!active && !l.model.pieces.some((x) => x.id === id) && !p.current && !p.queue.length) rt.pieces.delete(id);
    }
    for (const [id, rt] of this.lines) {
      if (seen.has(id)) continue;
      const active = [...rt.pieces.values()].some((p) => p.current || p.queue.length) || rt.belts.length;
      if (!active) this.lines.delete(id);
    }
    this.changed();
  }

  dispose() {
    for (const l of this.lines.values()) {
      for (const b of l.belts) clearTimeout(b.timer);
      for (const p of l.pieces.values()) p.abort?.abort();
    }
  }
}

/**
 * Forgets what a rework makes stale (D15): the reopened stretch and the skipped pieces after it run
 * or skip again, so every arrival and skip they sent on the last lap is dropped. Inputs from outside stay.
 */
function reopen(run: RunRt, target: string, reopened: string[], reset: string[]) {
  const sources = new Set([...reopened, ...reset]);
  for (const id of sources) { run.done.delete(id); run.skippedPieces.delete(id); }
  for (const [id, arr] of run.arrivals) if (id !== target && !run.done.has(id)) for (const src of [...arr.keys()]) if (sources.has(src)) arr.delete(src);
  for (const k of [...run.skipped]) { const [src, dst] = k.split('>'); if (sources.has(src) && !run.done.has(dst)) run.skipped.delete(k); }
}

/**
 * Where a machine stands in its line, for its prompt: the line in order, what feeds it, where its
 * box goes (rules in plain words) and which machines come after it, so it does its own step only.
 */
export function linePlace(line: LineDef, pieceId: string): string {
  const pieces = line.model.pieces;
  const name = (id: string) => { const p = pieces.find((x) => x.id === id); return p ? (p.kind === 'intake' ? `${line.model.intake.label || 'Intake'} (intake)` : p.kind === 'pallet' ? `${p.label} (pallet)` : `${p.label} (${p.kind})`) : id; };
  const me = pieces.find((p) => p.id === pieceId);
  if (!me) return '';
  const goalOf = (p: typeof me) => p.goal ?? (p.machine ? line.model.machines[p.machine]?.goal : undefined);
  const ins = me.needs.map((n) => `- ${n.back ? 'sent back by' : 'from'} ${name(n.from)}${n.when ? ` when ${describe(n.when)}` : ''}`);
  const outs = pieces.flatMap((p) => p.needs.filter((n) => n.from === pieceId).map((n) => `- ${n.back ? 'back to' : 'to'} ${name(p.id)}${n.when ? ` when ${describe(n.when)}` : ''}`));
  const after = new Set<string>(); const stack = [pieceId];
  while (stack.length) { const id = stack.pop()!; for (const p of pieces) if (p.needs.some((n) => n.from === id && !n.back) && !after.has(p.id)) { after.add(p.id); stack.push(p.id); } }
  const later = pieces.filter((p) => after.has(p.id) && p.kind !== 'pallet').map((p) => `- ${name(p.id)}${goalOf(p) ? `: ${goalOf(p)}` : ''}`);
  return [
    `Your place in the line "${line.name}":`,
    `The line, in order: ${pieces.map((p) => (p.id === pieceId ? `${name(p.id)} ← you` : name(p.id))).join(' → ')}`,
    goalOf(me) ? `Your goal: ${goalOf(me)}` : '',
    ins.length ? `Your box comes:\n${ins.join('\n')}` : '',
    outs.length ? `Your box goes:\n${outs.join('\n')}` : '',
    later.length ? `After you, each piece does its own step:\n${later.join('\n')}\nDo only your step; leave theirs to them.` : '',
  ].filter(Boolean).join('\n');
}

/** The human actions of a run so far, in order, for every machine of the run (D26). */
export function humanActions(run: RunRt): string {
  const file = path.join(run.dir, 'run.jsonl');
  if (!fs.existsSync(file)) return '';
  const label = (id: string) => run.line.model.pieces.find((p) => p.id === id)?.label ?? id;
  const passes = new Map<string, number>();
  const lines: string[] = [];
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!raw.trim()) continue;
    let e: Record<string, unknown>;
    try { e = JSON.parse(raw); } catch { continue; }
    const piece = String(e.piece ?? '');
    // a piece's pass is one more than the reworks that reopened it; attempts and reruns after an answer stay in the pass
    if (e.type === 'rework') for (const id of (e.reopened as string[] | undefined) ?? []) passes.set(id, (passes.get(id) ?? 1) + 1);
    if (e.type !== 'verb') continue;
    const at = `${label(piece)}, pass ${passes.get(piece) ?? 1}`;
    const who = e.actor === 'you' || !e.actor ? 'the human' : String(e.actor);
    if (e.verb === 'release') lines.push(e.choice ? `- ${at}: ${who} chose "${e.choice}"${e.note ? ` with the note "${e.note}"` : ''}.` : `- ${at}: ${who} released the gate.`);
    else if (e.verb === 'retry') lines.push(`- ${at}: ${who} retried it${e.hint ? ` with the hint "${e.hint}"` : ''}.`);
    else if (e.verb === 'answer') lines.push(`- ${at}: asked "${e.question}"; ${who} answered "${e.answer}".`);
  }
  return lines.length ? `What the human decided in this run so far, in order. Treat it as fact:\n${lines.join('\n')}` : '';
}

function machinePrompt(run: RunRt, pieceId: string | undefined, label: string, box: Payload, contract: Record<string, unknown>, siblings: string[], lastError: string, hint: string | undefined, boxFile: string) {
  return [
    `You are the "${label}" machine on the Roboratory production line "${run.line.name}" (run ${run.summary.id}).`,
    pieceId ? linePlace(run.line, pieceId) : '',
    `Your working folder is the current directory. The incoming box is also saved at ${boxFile}.`,
    siblings.length ? `Other machines of this run work in these folders, which you may read:\n${siblings.map((s) => `- ${s}`).join('\n')}` : '',
    `Line parameters: ${JSON.stringify(run.line.params)}`,
    `Incoming box:\n${JSON.stringify(box, null, 2)}`,
    `When you are done, answer with a single JSON object that matches this JSON Schema:\n${JSON.stringify(contract, null, 2)}`,
    pieceId ? humanActions(run) : '',
    'If a decision you need is missing from the box, the plan or the approval, do not guess: answer {"needs_human": {"question": ..., "options": [...], "recommendation": ...}} instead.',
    'If something outside your work stops you, such as a broken shared environment or a tool that does not answer, do not work around it: answer {"blocked": {"reason": ...}} instead.',
    lastError ? `Your previous attempt was rejected: ${lastError}. Fix it.` : '',
    hint ? `Hint from your supervisor: ${hint}` : '',
  ].filter(Boolean).join('\n\n');
}
