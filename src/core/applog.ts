// A plain text log of what went wrong in the app (a crash, a renderer that died, a failed start), kept on this
// machine only. The engine has its own, `.runs/engine.log`.
import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 1024 * 1024;

export function appLog(file: string, now: () => Date = () => new Date()) {
  const write = (line: string) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // keep the last megabyte of history: the older half goes to a sibling file
      if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.old`);
      fs.appendFileSync(file, `${now().toISOString()} ${line}\n`);
    } catch { /* logging must never be the reason the app fails */ }
  };
  const describe = (e: unknown) => (e instanceof Error ? e.stack ?? e.message : String(e));
  return {
    file,
    info: (what: string) => write(`info  ${what}`),
    error: (what: string, e?: unknown) => write(`error ${what}${e === undefined ? '' : `: ${describe(e)}`}`),
  };
}
