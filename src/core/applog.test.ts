import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appLog } from './applog';

describe('the app log', () => {
  it('appends lines with the time, keeps stacks, and rotates past a megabyte', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-log-')), 'logs', 'app.log');
    const log = appLog(file, () => new Date('2000-01-02T03:04:05Z'));
    log.info('opened a factory');
    log.error('renderer gone', new Error('boom'));
    log.error('plain', 'text');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    expect(lines[0]).toBe('2000-01-02T03:04:05.000Z info  opened a factory');
    expect(lines[1]).toMatch(/^2000-01-02T03:04:05.000Z error renderer gone: Error: boom\n?/);
    expect(fs.readFileSync(file, 'utf8')).toContain('error plain: text');
    fs.appendFileSync(file, 'x'.repeat(1024 * 1024 + 1));
    log.info('after');
    expect(fs.existsSync(`${file}.old`)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('2000-01-02T03:04:05.000Z info  after\n');
  });

  it('never throws, even when the folder cannot be written', () => {
    const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-log-')), 'file');
    fs.writeFileSync(blocker, '');
    expect(() => appLog(path.join(blocker, 'sub', 'app.log')).error('x', new Error('y'))).not.toThrow();
  });
});
