// The file system the factory loader reads. Build mode reads a draft through an overlay:
// written files replace the disk, and a deletion hides a file or a whole folder on disk.
import fs from 'node:fs';
import path from 'node:path';

export interface Vfs {
  exists(p: string): boolean;
  isDir(p: string): boolean;
  read(p: string): string;
  /** Names of the entries directly inside a folder. */
  list(dir: string): string[];
}

export const diskFs: Vfs = {
  exists: (p) => fs.existsSync(p),
  isDir: (p) => fs.existsSync(p) && fs.statSync(p).isDirectory(),
  read: (p) => fs.readFileSync(p, 'utf8'),
  list: (dir) => (fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? fs.readdirSync(dir) : []),
};

/** `null` hides the path on disk and everything under it; a string is a file's new content. */
export type Overlay = Map<string, string | null>;

export class OverlayFs implements Vfs {
  constructor(private base: Vfs, readonly files: Overlay) {}

  private hidden(p: string) {
    for (const [k, v] of this.files) if (v === null && (p === k || p.startsWith(k + path.sep))) return true;
    return false;
  }

  private writtenUnder(dir: string) {
    for (const [k, v] of this.files) if (v !== null && k.startsWith(dir + path.sep)) return true;
    return false;
  }

  exists(p: string) {
    const v = this.files.get(p);
    if (v !== undefined) return v !== null;
    if (this.writtenUnder(p)) return true;
    return !this.hidden(p) && this.base.exists(p);
  }

  isDir(p: string) {
    if (typeof this.files.get(p) === 'string') return false;
    if (this.writtenUnder(p)) return true;
    return !this.hidden(p) && this.base.isDir(p);
  }

  read(p: string) {
    const v = this.files.get(p);
    if (typeof v === 'string') return v;
    if (v === null || this.hidden(p)) throw Object.assign(new Error(`ENOENT: no such file, open '${p}'`), { code: 'ENOENT' });
    return this.base.read(p);
  }

  list(dir: string) {
    const names = new Set(this.base.list(dir).filter((n) => this.exists(path.join(dir, n))));
    for (const [k, v] of this.files) if (v !== null && k.startsWith(dir + path.sep)) names.add(k.slice(dir.length + 1).split(path.sep)[0]);
    return [...names].sort();
  }
}
