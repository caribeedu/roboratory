// Owns the open factory: loader, engine, managers, file watching and snapshots.
// Electron-free so it can be tested; main.ts wires it to IPC.
import fs from 'node:fs';
import path from 'node:path';
import type { ScopeArg, RunDetail } from '../shared/api';
import type { BuildOp, BuildView } from '../shared/build';
import type { FactoryDef, LogEntry, Snapshot } from '../shared/types';
import { claudeMcpServers, mcpServerOf } from './agents';
import { Engine } from './engine';
import { loadFactory } from './factory';
import { BuildSession } from './build/session';
import { Managers } from './managers';
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
  private mcpServers: Promise<string[] | null> | null = null;

  constructor(private out: { snapshot(s: Snapshot): void; logs(l: LogEntry[]): void; messages(key: string): void; build?(v: BuildView | null): void }) {}

  open(root: string) {
    this.close();
    if (!fs.existsSync(path.join(root, 'factory.yaml')) && !fs.existsSync(path.join(root, 'sectors'))) throw new Error(`${root} is not a Roboratory factory (no factory.yaml or sectors/ folder).`);
    this.factory = loadFactory(root);
    const engine = new Engine(this.factory);
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
