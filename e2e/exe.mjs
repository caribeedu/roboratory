// Where the packaged app's executable is, for the platform running the e2e scripts.
import path from 'node:path';

export function appExecutable() {
  const out = path.resolve(process.env.PROMPTORY_OUT_DIR || 'out');
  if (process.env.PROMPTORY_EXE) return path.resolve(process.env.PROMPTORY_EXE);
  if (process.platform === 'win32') return path.join(out, `Promptory-win32-${process.arch}`, 'Promptory.exe');
  if (process.platform === 'linux') return path.join(out, `Promptory-linux-${process.arch}`, 'Promptory');
  return path.join(out, `Promptory-darwin-${process.arch}`, 'Promptory.app/Contents/MacOS/Promptory');
}
