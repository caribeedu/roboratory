import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createDemoFactory } from './demo';
import { lockPath, readLock, socketPathFor, startServer } from './server';

process.env.ROBORATORY_SIM_SPEED = '200';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-srv-'));

/** A minimal line client: calls by id, pushed events collected. */
function connect(socket: string) {
  return new Promise<{ call(method: string, ...params: unknown[]): Promise<any>; events: { event: string; data: any }[]; end(): void }>((resolve, reject) => {
    const c = net.connect(socket);
    const events: { event: string; data: any }[] = [];
    const waiting = new Map<number, { ok(v: any): void; fail(e: Error): void }>();
    let n = 0, buf = '';
    c.setEncoding('utf8');
    c.on('data', (d: string) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
        if (m.event) events.push(m);
        else { const w = waiting.get(m.id); waiting.delete(m.id); if (m.error) w?.fail(new Error(m.error)); else w?.ok(m.result); }
      }
    });
    c.once('error', reject);
    c.once('connect', () => resolve({
      events, end: () => c.end(),
      call: (method, ...params) => new Promise((ok, fail) => { const id = ++n; waiting.set(id, { ok, fail }); c.write(JSON.stringify({ id, method, params }) + '\n'); }),
    }));
  });
}

describe('engine server', () => {
  it('serves calls and pushes state, takes one lock per factory and cleans up on stop', async () => {
    const dir = tmp();
    const root = createDemoFactory(path.join(dir, 'factory'), path.join(dir, 'repos'));
    const srv = await startServer(root, { version: '9.9.9', idleGraceMs: 60_000 });
    try {
      expect(readLock(root)).toMatchObject({ pid: process.pid, version: '9.9.9', socket: srv.socket });
      await expect(startServer(root, { version: '9.9.9' })).rejects.toThrow(/already running/);
      expect(fs.existsSync(lockPath(root))).toBe(true); // the refused server did not take the lock away

      const c = await connect(srv.socket);
      expect(await c.call('hello')).toMatchObject({ version: '9.9.9', pid: process.pid });
      const { snapshot } = await c.call('state');
      expect(snapshot.factory.sectors.map((s: any) => s.name)).toEqual(['Engineering', 'Incidents', 'Releases']);
      await expect(c.call('nope')).rejects.toThrow(/Unknown method/);
      await expect(c.call('buildApply', {})).rejects.toThrow(/not open/);

      await c.call('buildStart', snapshot.factory.sectors[0].id);
      await c.call('buildDiscard');
      await new Promise((r) => setTimeout(r, 150));
      expect(c.events.some((e) => e.event === 'snapshot')).toBe(true);
      expect(c.events.some((e) => e.event === 'build' && e.data === null)).toBe(true);

      await c.call('stop');
      await new Promise((r) => setTimeout(r, 150));
      expect(readLock(root)).toBeNull();
      expect(fs.existsSync(lockPath(root))).toBe(false);
    } finally { await srv.close(); }
  });

  it('replaces a stale lock', async () => {
    const dir = tmp();
    const root = createDemoFactory(path.join(dir, 'factory'), path.join(dir, 'repos'));
    fs.mkdirSync(path.join(root, '.runs'), { recursive: true });
    fs.writeFileSync(lockPath(root), JSON.stringify({ pid: 2 ** 22 + 12345, version: '0', socket: path.join(root, '.runs', 'old.sock'), root }));
    const srv = await startServer(root, { version: '1.0.0' });
    try { expect(readLock(root)?.pid).toBe(process.pid); } finally { await srv.close(); }
  });

  it('falls back to a short path when the factory path is long', () => {
    const long = path.join(os.tmpdir(), 'x'.repeat(120), 'factory');
    const p = socketPathFor(long);
    if (process.platform === 'win32') expect(p).toMatch(/^\\\\\.\\pipe\\roboratory-/);
    else { expect(Buffer.byteLength(p)).toBeLessThan(104); expect(p).not.toContain('x'.repeat(50)); }
  });

  it('exits by itself when no run is open and no client is connected', async () => {
    const dir = tmp();
    const root = createDemoFactory(path.join(dir, 'factory'), path.join(dir, 'repos'));
    let exited = false;
    const srv = await startServer(root, { version: '1.0.0', idleGraceMs: 200, onExit: () => { exited = true; } });
    const c = await connect(srv.socket);
    await new Promise((r) => setTimeout(r, 500));
    expect(exited).toBe(false); // a connected client keeps it up
    c.end();
    await new Promise((r) => setTimeout(r, 700));
    expect(exited).toBe(true);
    expect(readLock(root)).toBeNull();
    await srv.close();
  });
});
