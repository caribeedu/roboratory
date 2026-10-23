// Where the packaged app's executable is, for the platform running the e2e scripts.
import path from 'node:path';

export function appExecutable() {
  const out = path.resolve(process.env.ROBORATORY_OUT_DIR || 'out');
  if (process.env.ROBORATORY_EXE) return path.resolve(process.env.ROBORATORY_EXE);
  if (process.platform === 'win32') return path.join(out, `Roboratory-win32-${process.arch}`, 'Roboratory.exe');
  if (process.platform === 'linux') return path.join(out, `Roboratory-linux-${process.arch}`, 'Roboratory');
  return path.join(out, `Roboratory-darwin-${process.arch}`, 'Roboratory.app/Contents/MacOS/Roboratory');
}
