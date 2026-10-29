// A build-mode draft: an overlay of file changes over the factory on disk (D41).
// Every edit is a change to files; YAML is edited in place so comments and style survive.
import fs from 'node:fs';
import path from 'node:path';
import YAML, { isMap, isScalar, isSeq, type Document, type YAMLMap, type YAMLSeq } from 'yaml';
import { diffLines } from '../../shared/diff';
import { loadFactory } from '../factory';
import { OverlayFs, diskFs, type Overlay, type Vfs } from '../vfs';
import type { FactoryDef } from '../../shared/types';
import { relPosix } from '../paths';

export class Draft {
  readonly files: Overlay;
  readonly fs: OverlayFs;
  /** scripts written in this draft that must be executable */
  readonly executable: Set<string>;

  constructor(readonly root: string, files: Overlay = new Map(), executable: Set<string> = new Set(), readonly base: Vfs = diskFs) {
    this.files = files;
    this.executable = executable;
    this.fs = new OverlayFs(base, files);
  }

  clone() { return new Draft(this.root, new Map(this.files), new Set(this.executable), this.base); }

  /** A factory-relative path as an absolute one; never the root, `.git`, `.runs` or anything outside. */
  abs(rel: string) {
    const p = path.resolve(this.root, rel);
    if (!p.startsWith(this.root + path.sep)) throw new Error(`${rel} is outside the factory`);
    const top = path.relative(this.root, p).split(path.sep)[0];
    if (top === '.git' || top === '.runs') throw new Error(`${rel} is not part of the factory's definitions`);
    return p;
  }

  /** Whether a file is executable: marked in this draft, or on disk and not rewritten. */
  isExecutable(p: string) {
    if (this.executable.has(p)) return true;
    if (this.files.has(p) || this.hiddenAbove(p)) return false;
    try { return (fs.statSync(p).mode & 0o111) !== 0; } catch { return false; }
  }

  exists(p: string) { return this.fs.exists(p); }
  read(p: string) { return this.fs.read(p); }

  /** Writes a file; writing back what the disk already holds (mode included) drops the change. */
  write(p: string, content: string, executable = false) {
    if (this.fs.isDir(p)) throw new Error(`${relPosix(this.root, p)} is a folder.`);
    for (let up = path.dirname(p); up.startsWith(this.root + path.sep); up = path.dirname(up)) {
      if (this.fs.exists(up) && !this.fs.isDir(up)) throw new Error(`${relPosix(this.root, up)} is a file, so nothing can be written inside it.`);
    }
    const onDisk = this.base.exists(p) && !this.base.isDir(p) && !this.hiddenAbove(p);
    const sameMode = !executable || (onDisk && (() => { try { return (fs.statSync(p).mode & 0o111) !== 0; } catch { return false; } })());
    if (onDisk && this.base.read(p) === content && sameMode) { this.files.delete(p); this.executable.delete(p); return; }
    this.files.set(p, content);
    if (executable) this.executable.add(p); else this.executable.delete(p);
  }

  /** Removes a file or a folder and everything in it. */
  remove(p: string) {
    for (const k of [...this.files.keys()]) if (k === p || k.startsWith(p + path.sep)) this.files.delete(k);
    this.executable.forEach((k) => { if (k === p || k.startsWith(p + path.sep)) this.executable.delete(k); });
    if (this.base.exists(p) && !this.hiddenAbove(p)) this.files.set(p, null);
  }

  private hiddenAbove(p: string) {
    for (const [k, v] of this.files) if (v === null && p.startsWith(k + path.sep)) return true;
    return false;
  }

  /** Copies a folder, file by file and keeping executable scripts executable, into the draft. */
  copyDir(from: string, to: string) {
    for (const name of this.fs.list(from)) {
      const a = path.join(from, name), b = path.join(to, name);
      if (this.fs.isDir(a)) this.copyDir(a, b); else this.write(b, this.fs.read(a), this.isExecutable(a));
    }
  }

  /** Edits a YAML file in place; a missing file starts empty. */
  editYaml(p: string, fn: (doc: Document) => void) {
    const doc = YAML.parseDocument(this.exists(p) ? this.read(p) : '');
    if (doc.errors.length) throw new Error(`${relPosix(this.root, p)}: ${doc.errors[0].message}`);
    if (!doc.contents) doc.contents = doc.createNode({}) as never;
    fn(doc);
    // the core formats are versioned (D46): a file edited here that lacks its version gets it, first
    if (/(^|[\\/])(machine|line)\.yaml$/.test(p) && isMap(doc.contents) && !doc.contents.has('schema_version')) doc.contents.items.unshift(doc.createPair('schema_version', 1) as never);
    this.write(p, preserve(this.exists(p) ? this.read(p) : '', doc));
  }

  /**
   * Writes the factory as the draft has it into a folder, without touching the factory: files the draft did not change are copied from
   * the disk as they are, and the ones it wrote are written, executable where it says so. `.git`, `.runs` and `node_modules` are left out.
   */
  export(target: string) {
    const walk = (dir: string, out: string) => {
      fs.mkdirSync(out, { recursive: true });
      for (const name of this.fs.list(dir)) {
        if (dir === this.root && ['.git', '.runs', 'node_modules'].includes(name)) continue;
        const from = path.join(dir, name), to = path.join(out, name);
        if (this.fs.isDir(from)) { walk(from, to); continue; }
        const written = this.files.get(from);
        if (typeof written === 'string') fs.writeFileSync(to, written, { mode: this.isExecutable(from) ? 0o755 : 0o644 });
        else fs.copyFileSync(from, to);
      }
    };
    walk(this.root, target);
  }

  /** The factory as the draft would load it, keeping structural problems instead of failing. */
  load(): FactoryDef { return loadFactory(this.root, { fs: this.fs, tolerant: true }); }

  /** Factory-relative paths this draft changes, with their status. */
  changes(): { path: string; status: 'added' | 'changed' | 'removed' }[] {
    const out: { path: string; status: 'added' | 'changed' | 'removed' }[] = [];
    const walk = (p: string) => {
      if (this.base.isDir(p)) { for (const n of this.base.list(p)) walk(path.join(p, n)); return; }
      if (typeof this.files.get(p) === 'string') return; // rewritten below a removed folder: listed as changed
      out.push({ path: relPosix(this.root, p), status: 'removed' });
    };
    for (const [p, v] of this.files) {
      if (v === null) walk(p);
      else out.push({ path: relPosix(this.root, p), status: this.base.exists(p) && !this.base.isDir(p) ? 'changed' : 'added' });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }
}

// ---------- YAML helpers ----------

const YAML_OUT = { lineWidth: 0, flowCollectionPadding: true, doubleQuotedAsJSON: true } as const;

/**
 * Drops the padding the YAML writer puts inside flow sequences (`[ a, b ]` → `[a, b]`), only where
 * a bracket is structural: after `: `, `- `, `[` or `, ` and outside quoted strings (escapes included).
 */
function tightSeqs(line: string) {
  let out = '', quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      out += c;
      if (quote === '"' && c === '\\') { out += line[++i] ?? ''; continue; }
      if (c === quote) { if (quote === "'" && line[i + 1] === "'") { out += line[++i]; continue; } quote = ''; }
      continue;
    }
    if ((c === '"' || c === "'") && /(^|[\s:,[{-])$/.test(out.slice(-1) || ' ')) { quote = c; out += c; continue; }
    if (c === '[' && line[i + 1] === ' ' && /(^\s*|: |- |\[|, )$/.test(out)) { out += '['; i++; continue; }
    if (c === ' ' && line[i + 1] === ']' && /^\](,|\s*$|\]|\s*})/.test(line.slice(i + 1))) continue;
    out += c;
  }
  return out;
}

/**
 * Writes an edited YAML document so that every line the edit did not touch keeps its original
 * text, and only new or changed lines come from the YAML writer. Falls back to the writer's
 * output when re-reading the original would move its line breaks.
 */
export function preserve(original: string, doc: Document): string {
  const next = doc.toString(YAML_OUT);
  if (!original) return next.split('\n').map(tightSeqs).join('\n');
  const src = original.split('\n');
  const normalized = YAML.parseDocument(original).toString(YAML_OUT);
  if (normalized.split('\n').length !== src.length) return next;
  const out: string[] = [];
  let i = 0;
  for (const d of diffLines(normalized, next)) {
    if (d.t === ' ') out.push(src[i++]);
    else if (d.t === '-') i++;
    else out.push(tightSeqs(d.s));
  }
  return out.join('\n');
}

export const seqOf = (doc: Document, key: string): YAMLSeq => {
  let s = doc.get(key, true);
  if (!isSeq(s)) { doc.set(key, doc.createNode([])); s = doc.get(key, true); }
  return s as YAMLSeq;
};

export const idOf = (n: unknown) => (isMap(n) ? String((n as YAMLMap).get('id') ?? '') : '');

/**
 * A new mapping node in the style (flow or block) of its future neighbours; nested maps such as
 * `gate:` and `signal:` stay on one line. An empty `[]` list becomes a block list as it fills.
 */
export function nodeLike(doc: Document, seq: YAMLSeq, value: Record<string, unknown>) {
  const node = doc.createNode(value) as YAMLMap;
  const neighbour = seq.items.find((x) => isMap(x)) as YAMLMap | undefined;
  if (!seq.items.length) seq.flow = false;
  node.flow = !!neighbour?.flow;
  for (const pair of node.items) if (isMap(pair.value)) pair.value.flow = true;
  return node;
}

/** A `needs` value written compactly: `[a, { from: b, when: "…" }]`. */
export function needsNode(doc: Document, needs: { from: string; when?: string; back?: boolean; laps?: number }[]) {
  const node = doc.createNode(needs.map((n) => (n.when || n.back ? { from: n.from, ...(n.when ? { when: n.when } : {}), ...(n.back ? { back: true, laps: n.laps ?? 3 } : {}) } : n.from))) as YAMLSeq;
  node.flow = true;
  for (const it of node.items) {
    if (isMap(it)) {
      it.flow = true;
      const w = it.items.find((p) => isScalar(p.key) && p.key.value === 'when');
      if (w && isScalar(w.value)) w.value.type = 'QUOTE_DOUBLE';
    }
  }
  return node;
}
