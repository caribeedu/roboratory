// A build-mode session on one sector (D41): the draft, its undo history, what it changes,
// and the locks that decide whether it may be saved.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { BuildIssue, BuildOp, BuildView, FieldInfo, FileChange } from '../../shared/build';
import type { FactoryDef, LineDef } from '../../shared/types';
import { factoryView } from '../view';
import { checkFactory } from './checks';
import { Draft } from './draft';
import { beltFields } from './fields';
import { apply } from './ops';
import { relPosix } from '../paths';

const UNDO_LIMIT = 200;

/** Files a line's behavior depends on, as absolute paths (folders cover everything inside). */
function dependencies(f: FactoryDef, l: LineDef, read: (p: string) => string | null): string[] {
  const out = [l.model.dir, path.join(f.root, 'culture.md'), path.join(f.root, 'sectors', l.sectorId, 'culture.md'), path.join(f.root, 'shared', 'signals')];
  for (const m of Object.values(l.model.machines)) {
    out.push(m.dir);
    const conf = read(path.join(m.dir, 'machine.yaml'));
    try { const roles = (YAML.parse(conf ?? '') ?? {}).roles; if (Array.isArray(roles)) for (const r of roles) out.push(path.resolve(f.root, String(r))); } catch { /* the loader reports it */ }
  }
  return out;
}
const under = (p: string, dirs: string[]) => dirs.some((d) => p === d || p.startsWith(d + path.sep));
const lineEntry = (l: LineDef) => JSON.stringify({ n: l.name, d: l.direction, p: l.params, r: l.repo, m: l.model.dir });

export class BuildSession {
  draft: Draft;
  private undoStack: Draft[] = [];
  private redoStack: Draft[] = [];
  /** what each file the draft touches held on disk when the session first touched it (null: absent) */
  private base = new Map<string, string | null>();

  constructor(readonly root: string, readonly sectorId: string) {
    this.draft = new Draft(root);
  }

  private disk(p: string): string | null {
    try { return fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8') : null; } catch { return null; }
  }

  private remember(p: string) {
    if (this.base.has(p)) return;
    try {
      if (fs.statSync(p).isDirectory()) { for (const n of fs.readdirSync(p)) this.remember(path.join(p, n)); return; }
    } catch { /* absent */ }
    this.base.set(p, this.disk(p));
  }

  apply(op: BuildOp) {
    const next = this.draft.clone();
    apply(next, op);
    const same = next.files.size === this.draft.files.size && [...next.files].every(([k, v]) => this.draft.files.get(k) === v)
      && next.executable.size === this.draft.executable.size && [...next.executable].every((k) => this.draft.executable.has(k));
    if (same) return;
    // a path this draft starts touching again (after an undo) is based on the disk as it is now
    for (const k of next.files.keys()) if (!this.draft.files.has(k)) this.forget(k);
    for (const k of next.files.keys()) this.remember(k);
    this.undoStack.push(this.draft);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.draft = next;
  }

  private forget(p: string) { for (const k of [...this.base.keys()]) if (k === p || k.startsWith(p + path.sep)) this.base.delete(k); }

  undo() { const d = this.undoStack.pop(); if (d) { this.redoStack.push(this.draft); this.draft = d; } }
  redo() { const d = this.redoStack.pop(); if (d) { this.undoStack.push(this.draft); this.draft = d; } }

  /** Files changed on disk since the session first read them, including files added inside a folder the draft removes. */
  conflicts(): string[] {
    const out = new Set<string>();
    for (const [p, before] of this.base) if (this.disk(p) !== before && this.touches(p)) out.add(relPosix(this.root, p));
    const walk = (dir: string) => {
      let names: string[] = [];
      try { names = fs.readdirSync(dir); } catch { return; }
      for (const n of names) { const q = path.join(dir, n); if (fs.statSync(q).isDirectory()) walk(q); else if (!this.base.has(q)) out.add(relPosix(this.root, q)); }
    };
    for (const [p, v] of this.draft.files) if (v === null) walk(p);
    return [...out].sort();
  }

  private touches(p: string) {
    for (const k of this.draft.files.keys()) if (p === k || p.startsWith(k + path.sep)) return true;
    return false;
  }

  changes(): FileChange[] {
    const conflicts = new Set(this.conflicts());
    return this.draft.changes().map((c) => {
      const abs = path.join(this.root, c.path);
      const before = this.base.has(abs) ? this.base.get(abs) ?? undefined : this.disk(abs) ?? undefined;
      const after = c.status === 'removed' ? undefined : this.draft.read(abs);
      let staleComment = false;
      if (before && after && c.path.endsWith('line.yaml') && /^\s*#/.test(before)) {
        try {
          const shape = (s: string) => { const o = YAML.parse(s) ?? {}; return JSON.stringify([o.pieces, o.pallet?.needs]); };
          staleComment = shape(before) !== shape(after);
        } catch { /* reported by the loader */ }
      }
      return { ...c, before, after, conflict: conflicts.has(c.path) || undefined, staleComment: staleComment || undefined };
    });
  }

  /** Lines whose behavior the draft changes, in the live factory and in the draft. */
  affected(live: FactoryDef, draft: FactoryDef): LineDef[] {
    const changed = [...this.draft.files.keys()];
    const hit = (f: FactoryDef, read: (p: string) => string | null) => f.sectors.flatMap((s) => s.lines).filter((l) => {
      const deps = dependencies(f, l, read);
      return changed.some((c) => under(c, deps) || deps.some((d) => d.startsWith(c + path.sep)));
    });
    const out = new Map<string, LineDef>();
    for (const l of hit(live, (p) => this.disk(p))) out.set(l.id, l);
    for (const l of hit(draft, (p) => (this.draft.exists(p) ? this.draft.read(p) : null))) out.set(l.id, l);
    // a line's own settings (name, model, parameters…) changed in lines.yaml, or the line is new or gone
    const liveLines = new Map(live.sectors.flatMap((s) => s.lines).map((l) => [l.id, l]));
    const draftLines = new Map(draft.sectors.flatMap((s) => s.lines).map((l) => [l.id, l]));
    for (const [id, l] of liveLines) if (!draftLines.has(id) || lineEntry(draftLines.get(id)!) !== lineEntry(l)) out.set(id, l);
    for (const [id, l] of draftLines) if (!liveLines.has(id)) out.set(id, l);
    return [...out.values()];
  }

  view(live: FactoryDef, running: Set<string>): BuildView {
    const f = this.draft.load();
    const affected = this.affected(live, f);
    const linesOf = (model?: string) => (model ? f.sectors.flatMap((s) => s.lines).filter((l) => l.model.dir === model).map((l) => l.id) : []);
    const issues: BuildIssue[] = checkFactory(f).map((i) => ({ kind: i.kind, message: i.message, pieceId: i.pieceId, lineIds: linesOf(i.model) }));
    const busy = affected.filter((l) => running.has(l.id));
    const blocked: string[] = [];
    if (issues.length) blocked.push(`Fix ${issues.length === 1 ? 'the problem' : `the ${issues.length} problems`} listed first.`);
    if (busy.length) blocked.push(`Wait for the run in progress on ${busy.map((l) => l.name).join(', ')}, or stop it.`);
    const roles = new Map<string, { machines: Set<string>; lines: Set<string> }>();
    for (const l of f.sectors.flatMap((x) => x.lines)) for (const m of Object.values(l.model.machines)) {
      let list: unknown = [];
      try { const conf = this.read(relPosix(this.root, path.join(m.dir, 'machine.yaml'))); list = (YAML.parse(conf ?? '') ?? {}).roles; } catch { /* the loader reports it */ }
      if (Array.isArray(list)) for (const r of list) {
        const rel = relPosix(this.root, path.resolve(this.root, String(r)));
        const u = roles.get(rel) ?? { machines: new Set<string>(), lines: new Set<string>() };
        u.machines.add(relPosix(this.root, m.dir)); u.lines.add(l.id); roles.set(rel, u);
      }
    }
    return {
      sectorId: this.sectorId,
      factory: factoryView(f),
      roles: [...roles].map(([p, u]) => ({ path: p, machines: [...u.machines].sort(), lines: u.lines.size })).sort((a, b) => a.path.localeCompare(b.path)),
      issues,
      changes: this.changes(),
      affected: affected.map((l) => ({ lineId: l.id, name: l.name, sectorId: l.sectorId, running: running.has(l.id) })),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      blocked,
    };
  }

  /** A file as the draft holds it (factory-relative path), or null when it does not exist. */
  read(rel: string): string | null {
    const p = this.draft.abs(rel);
    return this.draft.exists(p) && !this.draft.fs.isDir(p) ? this.draft.read(p) : null;
  }

  /** Entries of a folder as the draft holds it (factory-relative path). */
  list(rel: string): string[] { return this.draft.fs.list(this.draft.abs(rel)); }

  /** Fields a rule on the belt leaving `from` can read; a return belt from a signal adds why it failed. */
  fields(lineId: string, from: string, back = false): { fields: FieldInfo[]; open: boolean } {
    const l = this.draft.load().sectors.flatMap((s) => s.lines).find((x) => x.id === lineId);
    return l ? beltFields(l.model, from, back) : { fields: [], open: true };
  }

  /**
   * Writes the draft. Each conflicting file needs a resolution: keep the draft's version, or the
   * one on disk (which drops the draft's change to it). Refuses while anything still blocks.
   */
  save(live: FactoryDef, running: Set<string>, resolutions: Record<string, 'mine' | 'disk'> = {}) {
    const conflicts = this.conflicts();
    const open = conflicts.filter((c) => !resolutions[c]);
    if (open.length) throw new Error(`${open.length === 1 ? 'A file' : `${open.length} files`} changed on disk during this session: ${open.join(', ')}. Choose which version to keep.`);
    const keepDisk = new Set(conflicts.filter((c) => resolutions[c] === 'disk').map((c) => path.join(this.root, c)));
    // decide on a copy: a save that is then refused leaves the draft as it was
    const draft = this.draft.clone();
    for (const p of keepDisk) draft.files.delete(p);
    const previous = this.draft;
    this.draft = draft;
    const v = this.view(live, running);
    this.draft = previous;
    if (v.blocked.length) throw new Error(v.blocked.join(' '));
    const inside = (p: string) => {
      const rel = relPosix(this.root, p);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || ['.git', '.runs'].includes(rel.split('/')[0])) throw new Error(`Refusing to touch ${p}.`);
    };
    const writes = [...draft.files].filter((e): e is [string, string] => e[1] !== null);
    const removed = [...draft.files].filter(([, c]) => c === null).map(([p]) => p);
    // everything is checked before anything changes on disk
    for (const p of [...removed, ...writes.map(([p]) => p)]) inside(p);
    for (const [p] of writes) {
      if (removed.some((r) => p === r || p.startsWith(r + path.sep))) continue;
      try { if (fs.statSync(p).isDirectory()) throw new Error(`${relPosix(this.root, p)} is a folder on disk; the draft cannot write a file there.`); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
    // new content goes to temporary files first, then everything lands
    const stage = path.join(this.root, '.runs', '.save');
    fs.mkdirSync(stage, { recursive: true });
    const staged = writes.map(([p, c], i) => { const tmp = path.join(stage, `${process.pid}-${i}`); fs.writeFileSync(tmp, c); return { p, tmp }; });
    try {
      for (const p of removed) {
        if (![...keepDisk].some((k) => k.startsWith(p + path.sep))) { fs.rmSync(p, { recursive: true, force: true }); continue; }
        // a folder the draft removes, minus files you chose to keep from disk
        const walk = (dir: string) => { for (const n of fs.readdirSync(dir)) { const q = path.join(dir, n); if (fs.statSync(q).isDirectory()) { walk(q); if (!fs.readdirSync(q).length) fs.rmdirSync(q); } else if (!keepDisk.has(q)) fs.rmSync(q); } };
        walk(p);
      }
      for (const { p, tmp } of staged) {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.renameSync(tmp, p);
        fs.chmodSync(p, draft.executable.has(p) ? 0o755 : 0o644);
      }
    } finally {
      for (const { tmp } of staged) fs.rmSync(tmp, { force: true });
    }
    this.draft = draft;
  }
}
