// Which build of the engine bundle a process runs. The version alone cannot tell a rebuilt bundle from the one
// already running, so a client compares this too and offers to restart an engine of another build (D43).
import crypto from 'node:crypto';
import fs from 'node:fs';

/** A short hash of the bundle's contents (it reads through app.asar in the packaged app). */
export function buildIdOf(file: string): string {
  try { return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 12); } catch { return ''; }
}

/** True when the engine behind `info` is not the one `app` would start: another version or another build. */
export function engineIsOlder(info: { version: string; build?: string }, app: { version: string; build: string }): boolean {
  if (info.version !== app.version) return true;
  // an engine or an app that cannot tell its build is not called older for that
  return !!info.build && !!app.build && info.build !== app.build;
}
