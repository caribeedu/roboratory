// What the process-based adapters share: running a CLI line by line, and finding JSON in text.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentRequest } from './types';

export const short = (v: unknown, n = 140) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export interface Launch { file: string; args: string[]; env: NodeJS.ProcessEnv; error?: string }

/**
 * What to spawn for an agent CLI. On Windows a command is found through PATH and PATHEXT (`claude` is `claude.exe`),
 * and a script with a `node` shebang is run by node. A `.cmd` or `.bat` shim cannot carry multi-line arguments, so it
 * is refused with a pointer to the native executable.
 */
export function launch(bin: string, args: string[], env: NodeJS.ProcessEnv = process.env): Launch {
  if (process.platform !== 'win32') return { file: bin, args, env };
  const exts = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase());
  const order = [...exts.filter((e) => e === '.exe' || e === '.com'), ...exts.filter((e) => e !== '.exe' && e !== '.com')];
  const dirs = /[\\/]/.test(bin) ? [''] : (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const base = dir ? path.join(dir, bin) : bin;
    for (const ext of ['', ...order]) {
      const file = base + ext;
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) continue;
      if (/\.(cmd|bat)$/i.test(file)) return { file, args, env, error: `${file} is a .cmd shim, which cannot be started with multi-line arguments. Install the native executable instead and put it on PATH.` };
      let head = '';
      try { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(80); fs.readSync(fd, b, 0, 80, 0); fs.closeSync(fd); head = b.toString('latin1'); } catch { /* unreadable: spawn reports it */ }
      if (/^#!.*\bnode\b/.test(head)) return { file: process.execPath, args: [file, ...args], env: { ...env, ELECTRON_RUN_AS_NODE: '1' } };
      return { file, args, env };
    }
  }
  return { file: bin, args, env };
}

export function spawnCollect(bin: string, args: string[], req: AgentRequest, onLine: (l: string) => void): Promise<{ code: number | null; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const run = launch(bin, args);
    if (run.error) { resolve({ code: null, stderr: run.error, timedOut: false }); return; }
    const child = spawn(run.file, run.args, { cwd: req.cwd, env: run.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let buf = '', stderr = '', timedOut = false;
    // the time limit counts the agent's work, not the wait for a person to answer a permission request (D44)
    let left = req.timeoutMs, started = Date.now();
    let timer: NodeJS.Timeout | undefined;
    const arm = () => { started = Date.now(); timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, left); };
    const stopWatch = req.permission?.waits.on((waiting) => {
      if (waiting > 0 && timer) { clearTimeout(timer); timer = undefined; left = Math.max(0, left - (Date.now() - started)); }
      else if (waiting === 0 && !timer) arm();
    });
    arm();
    const abort = () => child.kill('SIGTERM');
    req.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) onLine(l); }
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => { stderr += e.message; });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      stopWatch?.();
      req.signal?.removeEventListener('abort', abort);
      if (buf.trim()) onLine(buf);
      resolve({ code, stderr, timedOut });
    });
  });
}

/** Finds a JSON object in free text: a fenced block, or the last {...}. */
export function extractJson(text: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/g;
  let m, last: unknown;
  while ((m = fence.exec(text))) { try { last = JSON.parse(m[1]); } catch { /* keep looking */ } }
  if (last !== undefined) return last;
  for (let end = text.lastIndexOf('}'); end >= 0; end = text.lastIndexOf('}', end - 1)) {
    let depth = 0;
    for (let i = end; i >= 0; i--) {
      if (text[i] === '}') depth++;
      if (text[i] === '{' && --depth === 0) { try { return JSON.parse(text.slice(i, end + 1)); } catch { break; } }
    }
  }
  return undefined;
}
