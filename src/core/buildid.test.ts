import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildIdOf, engineIsOlder } from './buildid';

describe('which build an engine runs', () => {
  it('hashes the bundle, so a rebuilt one with the same version has another id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-build-'));
    const a = path.join(dir, 'a.js'), b = path.join(dir, 'b.js');
    fs.writeFileSync(a, 'console.log(1)');
    fs.writeFileSync(b, 'console.log(1)');
    const first = buildIdOf(a);
    expect(first).toMatch(/^[0-9a-f]{12}$/);
    expect(buildIdOf(b)).toBe(first);
    fs.writeFileSync(b, 'console.log(2)');
    expect(buildIdOf(b)).not.toBe(first);
    expect(buildIdOf(path.join(dir, 'missing.js'))).toBe('');
  });

  it('calls an engine older when its version or its build differs, and not when either is unknown', () => {
    const app = { version: '0.8.0', build: 'aaa' };
    expect(engineIsOlder({ version: '0.8.0', build: 'aaa' }, app)).toBe(false);
    expect(engineIsOlder({ version: '0.7.0', build: 'aaa' }, app)).toBe(true);
    expect(engineIsOlder({ version: '0.8.0', build: 'bbb' }, app)).toBe(true);
    expect(engineIsOlder({ version: '0.8.0' }, app)).toBe(false);
    expect(engineIsOlder({ version: '0.8.0', build: 'bbb' }, { version: '0.8.0', build: '' })).toBe(false);
  });
});
