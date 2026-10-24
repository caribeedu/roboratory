import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installCommand, launcher } from './install';

describe('the roboratory launcher', () => {
  it('runs the bundle with the app binary in Node mode', () => {
    expect(launcher({ execPath: '/Apps/Roboratory.app/Contents/MacOS/Roboratory', script: '/Apps/Roboratory.app/Contents/Resources/app.asar/.vite/build/engine.js', platform: 'darwin' }))
      .toBe(`#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '/Apps/Roboratory.app/Contents/MacOS/Roboratory' '/Apps/Roboratory.app/Contents/Resources/app.asar/.vite/build/engine.js' "$@"\n`);
    expect(launcher({ execPath: "/o'neil/app", script: '/s.js', platform: 'linux' })).toContain(`'/o'\\''neil/app'`);
    expect(launcher({ execPath: 'C:\Roboratory\Roboratory.exe', script: 'C:\Roboratory\resources\app.asar\.vite\build\engine.js', platform: 'win32' }))
      .toBe('@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"C:\Roboratory\Roboratory.exe" "C:\Roboratory\resources\app.asar\.vite\build\engine.js" %*\r\n');
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
