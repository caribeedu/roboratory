// Installs the `roboratory` command: a small launcher that runs the engine bundle with the app's own binary
// in Node mode, so the app and the command share one bundle and need no other runtime (D43).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface InstallSpec { dir?: string; execPath: string; script: string; platform?: NodeJS.Platform; home?: string }

export const defaultBinDir = (home = os.homedir()) => path.join(home, '.local', 'bin');

/** Contents of the launcher for a platform. */
export function launcher(spec: Pick<InstallSpec, 'execPath' | 'script' | 'platform'>): string {
  if ((spec.platform ?? process.platform) === 'win32') {
    // setlocal keeps the variable out of the shell that ran the command; "%" in a path would be expanded by cmd
    const cmd = (s: string) => s.replace(/%/g, '%%');
    return `@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${cmd(spec.execPath)}" "${cmd(spec.script)}" %*\r\n`;
  }
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${q(spec.execPath)} ${q(spec.script)} "$@"\n`;
}

export type InstallState = 'installed' | 'outdated' | 'missing';

/** Whether the launcher is there and still points at this build (an app that moved or updated leaves it outdated). */
export function installStatus(spec: InstallSpec): { state: InstallState; file: string } {
  const dir = spec.dir ?? defaultBinDir(spec.home);
  const file = path.join(dir, (spec.platform ?? process.platform) === 'win32' ? 'roboratory.cmd' : 'roboratory');
  let have: string;
  try { have = fs.readFileSync(file, 'utf8'); } catch { return { state: 'missing', file }; }
  return { state: have === launcher(spec) ? 'installed' : 'outdated', file };
}

/** Writes the launcher and returns where. The folder may not be on PATH yet. */
export function installCommand(spec: InstallSpec): { file: string; onPath: boolean } {
  const dir = spec.dir ?? defaultBinDir(spec.home);
  const win = (spec.platform ?? process.platform) === 'win32';
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, win ? 'roboratory.cmd' : 'roboratory');
  fs.writeFileSync(file, launcher(spec));
  if (!win) fs.chmodSync(file, 0o755);
  const onPath = (process.env.PATH ?? '').split(path.delimiter).some((p) => path.resolve(p) === path.resolve(dir));
  return { file, onPath };
}
