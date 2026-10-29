// Owns the open factory: loader, engine, managers, file watching and snapshots.
// Electron-free so it can be tested; main.ts wires it to IPC.
import fs from 'node:fs';
import path from 'node:path';
import type { ScopeArg, RunDetail } from '../shared/api';
import type { BuildOp, BuildView } from '../shared/build';
import type { FactoryDef, LogEntry, RehearsalPlan, RehearsalProgress, RehearsalReport, RehearsalRequest, Snapshot, Stats, StatsFilter } from '../shared/types';
import { claudeMcpServers, mcpServerOf, type PermissionCall } from './agents';
import { Engine, type EngineOptions } from './engine';
import { loadFactory } from './factory';
import { BuildSession } from './build/session';
import { Managers } from './managers';
import { planOf, prepareCopy, runRehearsal, loadSource, type RehearsalSource } from './rehearsal';
import { computeStats } from './stats';
import { factoryView } from './view';

export class FactoryService {
  factory: FactoryDef | null = null;
  engine: Engine | null = null;
  managers: Managers | null = null;
  private watcher: fs.FSWatcher | null = null;
  private reloadTimer: NodeJS.Timeout | null = null;
  private pushTimer: NodeJS.Timeout | null = null;
  private pendingLogs: LogEntry[] = [];
  private toolWarnings: string[] = [];
  private session: BuildSession | null = null;
  /** the rehearsal that is running, and the engine it works on (permission calls from its agents find it there) */
  private rehearsing: { stop: AbortController; engine?: Engine } | null = null;
  private mcpServers: Promise<string[] | null> | null = null;

  constructor(
    private out: { snapshot(s: Snapshot): void; logs(l: LogEntry[]): void; messages(key: string): void; build?(v: BuildView | null): void; rehearsal?(p: RehearsalProgress): void },
    private opts: Pick<EngineOptions, 'permissionTool'> = {},
  ) {}

  open(root: string) {
    this.close();
    if (!fs.existsSync(path.join(root, 'factory.yaml')) && !fs.existsSync(path.join(root, 'sectors'))) throw new Error(`${root} is not a Roboratory factory (no factory.yaml or sectors/ folder).`);
    this.factory = loadFactory(root);
    const engine = new Engine(this.factory, { permissionTool: this.opts.permissionTool });
    this.engine = engine;
    // every dispatch (yours, a manager's proposal, a policy auto-run) passes the build-mode lock
    engine.runGuard = (lineId) => (this.session && this.factory && this.session.affected(this.factory, this.session.draft.load()).some((l) => l.id === lineId)
      ? 'This line has unsaved changes in build mode. Save or discard them before dispatching it.' : undefined);
    engine.on('change', () => this.schedulePush());
    engine.on('log', (l: LogEntry) => { this.pendingLogs.push(l); this.schedulePush(); });
    engine.restore();
    this.managers = new Managers(() => this.factory!, () => this.engine!, (k) => this.out.messages(k));
    try {
      this.watcher = fs.watch(root, { recursive: true }, (_ev, file) => {
        const f = String(file ?? '');
        if (!f || f.startsWith('.runs') || f.startsWith('.git') || f.includes(`${path.sep}.git`)) return;
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => this.reload(), 350);
      });
    } catch { /* watching is a convenience */ }
    void this.checkTools();
    this.schedulePush();
  }

  /** Build mode has a draft open (it lives in memory, so a restart would lose it). */
  get buildOpen() { return !!this.session; }

  reload() {
    if (!this.factory || !this.engine) return;
    this.factory = loadFactory(this.factory.root);
    this.factory.warnings.push(...this.toolWarnings);
    this.engine.reload(this.factory);
    this.schedulePush();
    // files changed on disk: the open draft may now conflict with them
    if (this.session) this.out.build?.(this.buildView());
  }

  /** Warns when a machine or manager lists an MCP tool whose server the agent CLI lacks (D33). */
  async checkTools() {
    const f = this.factory;
    if (!f) return;
    const wanted = new Map<string, string[]>();
    const add = (tool: string, where: string) => { const s = mcpServerOf(tool); if (s) wanted.set(s, [...(wanted.get(s) ?? []), where]); };
    for (const s of f.sectors) {
      if (s.manager.agent === 'claude') s.manager.tools.forEach((t) => add(t, `${s.name} manager`));
      for (const l of s.lines) for (const m of Object.values(l.model.machines)) if (m.agent === 'claude') m.tools.forEach((t) => add(t, `machine ${m.name}`));
    }
    if (f.generalManager.agent === 'claude') f.generalManager.tools.forEach((t) => add(t, 'General Manager'));
    if (!wanted.size) return;
    const servers = await claudeMcpServers();
    if (servers === null) { this.toolWarnings = ['Could not run `claude mcp list` to check MCP tools. Is Claude Code installed?']; }
    else this.toolWarnings = [...wanted].filter(([s]) => !servers.includes(s)).map(([s, where]) => `MCP server "${s}" is not configured in Claude Code (used by ${[...new Set(where)].join(', ')}).`);
    if (this.factory === f) { f.warnings.push(...this.toolWarnings); this.schedulePush(); }
  }

  close() {
    this.session = null;
    this.out.build?.(null);
    this.watcher?.close();
    this.watcher = null;
    this.engine?.dispose();
    this.engine = null;
    this.factory = null;
    this.managers = null;
    this.toolWarnings = [];
    this.schedulePush();
  }

  private schedulePush() {
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.out.snapshot(this.snapshot());
      if (this.pendingLogs.length) this.out.logs(this.pendingLogs.splice(0));
    }, 80);
  }

  snapshot(): Snapshot {
    const f = this.factory, e = this.engine;
    if (!f || !e) return { factory: null, lines: {}, attention: [], now: Date.now() };
    const lines: Snapshot['lines'] = {};
    for (const id of e.lines.keys()) lines[id] = e.lineView(id);
    return { now: Date.now(), attention: e.attention(), lines, factory: factoryView(f) };
  }

  logs() { return this.engine?.logs.slice(-1500) ?? []; }

  private need() { if (!this.engine || !this.managers || !this.factory) throw new Error('No factory is open.'); return { e: this.engine, m: this.managers, f: this.factory }; }

  run(lineId: string, input: Record<string, string>) { return this.need().e.run(lineId, input); }
  retry(lineId: string, pieceId: string, hint: string) { this.need().e.retry(lineId, pieceId, hint); }
  release(lineId: string, pieceId: string, c: number, decision?: { choice: string; note: string }) { this.need().e.release(lineId, pieceId, c, 'you', decision); }
  answer(lineId: string, pieceId: string, text: string) { this.need().e.answer(lineId, pieceId, text); }
  /** How the pieces behave over the runs of the factory (D47); with `draft`, the versions are those of the build-mode draft. */
  stats(filter: StatsFilter = {}): Stats {
    const { e, f } = this.need();
    const factory = filter.draft && this.session ? this.session.draft.load() : f;
    return computeStats(factory, e.runSummaries().map((summary) => ({ summary, events: e.runEvents(summary.id) })), filter);
  }

  /** Lets a machine make the call it asked for, this once (D44). */
  allow(requestId: string) { this.need().e.allow(requestId); }
  /** Refuses it; the reason goes back to the agent. */
  deny(requestId: string, reason = '') { this.need().e.deny(requestId, reason); }
  /** The decision on a call of the machine started with `session`; asked by an agent's permission tool. */
  permit(session: string, call: PermissionCall, gone?: AbortSignal) {
    const rehearsal = this.rehearsing?.engine;
    return (rehearsal?.hasSession(session) ? rehearsal : this.need().e).permitSession(session, call, gone);
  }

  /** Whether a rehearsal is running, which keeps the engine from ending as idle. */
  get rehearsalRunning() { return !!this.rehearsing; }

  private sourceOf(req: RehearsalRequest): RehearsalSource {
    if (req.source === 'draft') {
      if (!this.session) throw new Error('Build mode is not open, so there is no draft to rehearse.');
      return { kind: 'draft', draft: this.session.draft };
    }
    return { kind: 'disk', root: this.need().f.root };
  }

  /** In the simulation, a required input nobody gave is filled in, as the dry run always did. */
  private withInputs(req: RehearsalRequest, f: FactoryDef): RehearsalRequest {
    if (req.mode !== 'simulation') return req;
    const line = f.sectors.flatMap((s) => s.lines).find((l) => l.id === req.lineId);
    const input = { ...req.input };
    for (const i of line?.model.intake.inputs ?? []) if (i.required && !String(input[i.name] ?? '').trim()) input[i.name] = i.placeholder || 'x';
    return { ...req, input };
  }

  /** What a rehearsal would run, with what a real run of the line has cost for reference (D48). */
  rehearsalPlan(req: RehearsalRequest): RehearsalPlan {
    const { e } = this.need();
    const { f } = loadSource(this.sourceOf(req));
    const costs = e.runSummaries().filter((r) => r.lineId === req.lineId).map((r) => e.runEvents(r.id).filter((x) => x.type === 'cost').reduce((a: number, x) => a + Number(x.usd ?? 0), 0)).filter((c) => c > 0).sort((a, b) => a - b);
    const reference = costs.length ? { runs: costs.length, medianUsd: costs.length % 2 ? costs[costs.length >> 1] : (costs[costs.length / 2 - 1] + costs[costs.length / 2]) / 2 } : undefined;
    return planOf(f, this.withInputs(req, f), reference);
  }

  /** Rehearses a line on a copy (D48). It is a verb: audited, and never automatic. */
  async rehearse(req: RehearsalRequest): Promise<RehearsalReport> {
    const { e, f } = this.need();
    if (this.rehearsing) throw new Error('A rehearsal is already running.');
    if (req.mode === 'real' && !req.approved) throw new Error('A real rehearsal spends money: show what it will run and ask first (invariant 8).');
    if (req.mode === 'real' && !(req.maxCostUsd! > 0)) throw new Error('A real rehearsal needs a cost ceiling above zero (invariant 8).');
    const source = this.sourceOf(req);
    const { f: of } = loadSource(source);
    const line = of.sectors.flatMap((s) => s.lines).find((l) => l.id === req.lineId);
    if (!line) throw new Error(`Unknown line ${req.lineId}`);
    const run = this.withInputs(req, of);
    const missing = line.model.intake.inputs.filter((i) => i.required && !String(run.input[i.name] ?? '').trim()).map((i) => i.label || i.name);
    if (missing.length) throw new Error(`Missing input: ${missing.join(', ')}`);
    const stop = new AbortController();
    this.rehearsing = { stop };
    try {
      const copy = await prepareCopy(source, req.lineId);
      e.audit(line.sectorId, { verb: 'rehearse', actor: 'you', lineId: req.lineId, mode: req.mode, from: req.source, ...(req.mode === 'real' ? { maxCostUsd: req.maxCostUsd } : {}) });
      return await runRehearsal(copy, run, {
        sourceRoot: f.root, permissionTool: this.opts.permissionTool, serverRoot: f.root, signal: stop.signal,
        onProgress: (p) => this.out.rehearsal?.(p), onEngine: (engine) => { if (this.rehearsing) this.rehearsing.engine = engine; },
      });
    } finally { this.rehearsing = null; }
  }

  /** Stops the rehearsal that is running. */
  rehearsalStop() { this.rehearsing?.stop.abort(); }

  /** Lets a machine make the call it asked for, this once (D44). */
  halt(lineId: string) { this.need().e.halt(lineId); }
  resume(lineId: string) { this.need().e.resume(lineId); }
  runs() { return this.engine?.runSummaries() ?? []; }

  runDetail(runId: string): RunDetail | null {
    const e = this.engine;
    const run = e?.runs.get(runId);
    if (!e || !run) return null;
    return { summary: run.summary, events: e.runEvents(runId), diff: e.runDiff(runId), dir: run.dir };
  }

  async ask(scope: ScopeArg, q: string) { await this.need().m.ask(scope, q); }
  messages(scope: ScopeArg) { return this.managers?.messages(scope) ?? []; }

  async accept(scope: ScopeArg, messageId: string, proposalId: string, confirmations = 0) {
    const { m, e, f } = this.need();
    const p = m.find(scope, messageId, proposalId);
    if (p.kind === 'patch') {
      if (this.session) throw new Error('Finish build mode first: save or discard the draft, then accept this change.');
      // a change to a line with a run in progress waits, as saving in build mode does (D41)
      const probe = new BuildSession(f.root, '');
      for (const file of p.files ?? []) probe.apply({ op: 'writeFile', path: file.path, content: file.content });
      const busy = probe.affected(f, probe.draft.load()).filter((l) => e.activeLineIds().has(l.id));
      if (busy.length) throw new Error(`Wait for the run in progress on ${busy.map((l) => l.name).join(', ')}, or stop it, before accepting this change.`);
      m.applyPatch(scope, messageId, proposalId); this.reload(); return;
    }
    await m.execute(p, 'you', confirmations);
    m.setStatus(scope, messageId, proposalId, 'applied');
  }
  reject(scope: ScopeArg, messageId: string, proposalId: string) { this.need().m.setStatus(scope, messageId, proposalId, 'rejected'); }

  // ---------- build mode (D41) ----------

  buildStart(sectorId: string): BuildView {
    const { f } = this.need();
    if (this.session && this.session.draft.files.size) throw new Error('Build mode is already open with unsaved changes.');
    this.session = new BuildSession(f.root, sectorId);
    return this.buildView();
  }

  buildView(): BuildView {
    const { e, f } = this.need();
    if (!this.session) throw new Error('Build mode is not open.');
    return this.session.view(f, e.activeLineIds());
  }

  private needSession() { if (!this.session) throw new Error('Build mode is not open.'); return this.session; }
  buildApply(op: BuildOp): BuildView { this.needSession().apply(op); return this.buildView(); }
  buildUndo(): BuildView { this.needSession().undo(); return this.buildView(); }
  buildRedo(): BuildView { this.needSession().redo(); return this.buildView(); }
  buildFields(lineId: string, from: string, back = false) { return this.needSession().fields(lineId, from, back); }
  buildRead(rel: string) { return this.needSession().read(rel); }
  buildList(rel: string) { return this.needSession().list(rel); }
  buildDiscard() { this.session = null; this.out.build?.(null); }

  buildSave(resolutions: Record<string, 'mine' | 'disk'> = {}) {
    const { e, f } = this.need();
    this.needSession().save(f, e.activeLineIds(), resolutions);
    this.session = null;
    this.out.build?.(null);
    this.reload();
  }

  /** MCP servers configured in Claude Code, for the tool picker (looked up once per open). */
  async buildServers(): Promise<string[] | null> {
    this.mcpServers ??= claudeMcpServers();
    return this.mcpServers;
  }
}
