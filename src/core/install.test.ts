import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installCommand, installStatus, launcher } from './install';

describe('the roboratory launcher', () => {
  it('runs the bundle with the app binary in Node mode', () => {
    expect(launcher({ execPath: '/Apps/Roboratory.app/Contents/MacOS/Roboratory', script: '/Apps/Roboratory.app/Contents/Resources/app.asar/.vite/build/engine.js', platform: 'darwin' }))
      .toBe(`#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '/Apps/Roboratory.app/Contents/MacOS/Roboratory' '/Apps/Roboratory.app/Contents/Resources/app.asar/.vite/build/engine.js' "$@"\n`);
    expect(launcher({ execPath: "/o'neil/app", script: '/s.js', platform: 'linux' })).toContain(`'/o'\\''neil/app'`);
    const exe = String.raw`C:\Roboratory\Roboratory.exe`;
    const script = String.raw`C:\Roboratory\resources\app.asar\.vite\build\engine.js`;
    expect(launcher({ execPath: exe, script, platform: 'win32' }))
      .toBe(`@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe}" "${script}" %*\r\n`);
    // a "%" in a path would be read by cmd as a variable
    expect(launcher({ execPath: String.raw`C:\100%\app.exe`, script, platform: 'win32' })).toContain(String.raw`"C:\100%%\app.exe"`);
  });

  it('tells whether the launcher is missing, installed, or outdated because the app moved', () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-bin-')), 'bin');
    const spec = { dir, execPath: '/Apps/Roboratory', script: '/Apps/engine.js' };
    expect(installStatus(spec).state).toBe('missing');
    installCommand(spec);
    expect(installStatus(spec).state).toBe('installed');
    expect(installStatus({ ...spec, script: '/Moved/engine.js' }).state).toBe('outdated');
  });

  it('writes it into the folder and says whether the folder is on PATH', () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-bin-')), 'bin');
    const r = installCommand({ dir, execPath: process.execPath, script: '/x/engine.js' });
    expect(path.basename(r.file)).toBe(process.platform === 'win32' ? 'roboratory.cmd' : 'roboratory');
    expect(fs.readFileSync(r.file, 'utf8')).toContain('engine.js');
    if (process.platform !== 'win32') expect(fs.statSync(r.file).mode & 0o111).not.toBe(0);
    expect(r.onPath).toBe(false);
  });
});
