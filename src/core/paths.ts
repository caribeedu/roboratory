// Factory-relative paths are always written with "/", on every platform: they are keys in diffs, conflicts,
// proposals and the interface, and they appear in files.
import path from 'node:path';

export const posix = (p: string) => p.split(path.sep).join('/');

/** `to` relative to `from`, with "/" separators. */
export const relPosix = (from: string, to: string) => posix(path.relative(from, to));

/** Expands a leading "~" to the user's home folder, with the platform's separators. */
export const expandHome = (p: string, home: string) =>
  p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? path.join(home, p.slice(2)) : p;
