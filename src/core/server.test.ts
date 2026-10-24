import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createDemoFactory } from './demo';
import { liveLock, lockPath, readLock, socketPathFor, startServer } from './server';

process.env.ROBORATORY_SIM_SPEED = '200';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-srv-'));
const factory = () => {
  const dir = tmp();
  return { dir, root: createDemoFactory(path.join(dir, 'factory'), path.join(dir, 'repos')) };
};

interface TestClient { call(method: string, ...params: unknown[]): Promise<any>; events: { event: string; data: any }[]; end(): void }

/** A minimal line client: calls by id, pushed events collected. With a token it says hello first. */
function connect(socket: string, token?: string) {
  return new Promise<TestClient>((resolve, reject) => {
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
    c.once('connect', () => {
      const client: TestClient = {
        events, end: () => c.end(),
        call: (method, ...params) => new Promise((ok, fail) => { const id = ++n; waiting.set(id, { ok, fail }); c.write(JSON.stringify({ id, method, params }) + '\n'); }),
      };
      if (token === undefined) resolve(client); else client.call('hello', { token }).then(() => resolve(client), reject);
    });
  });
}

describe('engine server', () => {
  it('serves calls and pushes state, takes one lock per factory and cleans up on stop', async () => {
    const { root } = factory();
    const srv = await startServer(root, { version: '9.9.9', idleGraceMs: 60_000 });
    try {
      expect(readLock(root)).toMatchObject({ pid: process.pid, version: '9.9.9', socket: srv.socket });
      await expect(startServer(root, { version: '9.9.9' })).rejects.toThrow(/already running/);
      expect(fs.existsSync(lockPath(root))).toBe(true); // the refused server did not take the lock away

      const c = await connect(srv.socket, srv.token);
      expect(await c.call('hello', { token: srv.token })).toMatchObject({ version: '9.9.9', pid: process.pid });
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

  it('replaces a stale lock without touching the file the lock names', async () => {
    const { dir, root } = factory();
    fs.mkdirSync(path.join(root, '.runs'), { recursive: true });
    // a lock copied from somewhere else must not make the engine delete the file it names
    const victim = path.join(dir, 'victim.txt');
    fs.writeFileSync(victim, 'keep me');
    fs.writeFileSync(lockPath(root), JSON.stringify({ pid: 2 ** 22 + 12345, version: '0', socket: victim, root, token: 'x', t: 1 }));
    const srv = await startServer(root, { version: '1.0.0' });
    try {
      expect(readLock(root)?.pid).toBe(process.pid);
      expect(fs.readFileSync(victim, 'utf8')).toBe('keep me');
    } finally { await srv.close(); }
  });

  it('doubts a lock whose pid is alive but nothing listens once the start-up time has passed (a reused pid)', async () => {
    const { root } = factory();
    fs.mkdirSync(path.join(root, '.runs'), { recursive: true });
    const lock = (t: number) => JSON.stringify({ pid: process.pid, version: '0', socket: socketPathFor(root), root, token: 'x', t });
    fs.writeFileSync(lockPath(root), lock(Date.now()));
    expect(await liveLock(root)).not.toBeNull(); // just started: it is given time to listen
    fs.writeFileSync(lockPath(root), lock(Date.now() - 60_000));
    expect(await liveLock(root)).toBeNull();
    expect(fs.existsSync(lockPath(root))).toBe(false);
  });

  it("answers only a client that says hello with the lock's token, and pushes it nothing before", async () => {
    const { root } = factory();
    const srv = await startServer(root, { version: '1.0.0' });
    try {
      const c = await connect(srv.socket);
      await expect(c.call('state')).rejects.toThrow(/hello/);
      await expect(c.call('hello', { token: 'wrong' })).rejects.toThrow(/Not allowed/);
      await expect(c.call('run', 'releases/orders-api', { tag: 'x' })).rejects.toThrow(/hello/);
      await new Promise((r) => setTimeout(r, 150));
      expect(c.events).toEqual([]);
      c.end();
    } finally { await srv.close(); }
  });

  it('does not run a method that only the object prototype has', async () => {
    const { root } = factory();
    const srv = await startServer(root, { version: '1.0.0' });
    try {
      const c = await connect(srv.socket, srv.token);
      await expect(c.call('constructor')).rejects.toThrow(/Unknown method/);
      await expect(c.call('__proto__')).rejects.toThrow(/Unknown method/);
    } finally { await srv.close(); }
  });

  it('reports why it could not start, and leaves no lock behind', async () => {
    const { root } = factory();
    fs.writeFileSync(path.join(root, 'factory.yaml'), 'name: [unclosed\n');
    let exited = false;
    await expect(startServer(root, { version: '1.0.0', onExit: () => { exited = true; } })).rejects.toThrow();
    expect(exited).toBe(false);
    expect(fs.existsSync(lockPath(root))).toBe(false);
  });

  it('falls back to a short path when the factory path is long', () => {
    const long = path.join(os.tmpdir(), 'x'.repeat(120), 'factory');
    const p = socketPathFor(long);
    if (process.platform === 'win32') expect(p).toMatch(/^\\\\\.\\pipe\\roboratory-/);
    else { expect(Buffer.byteLength(p)).toBeLessThan(104); expect(p).not.toContain('x'.repeat(50)); }
  });

  it('exits by itself when no run is open and no client is connected', async () => {
    const { root } = factory();
    let exited = false;
    const srv = await startServer(root, { version: '1.0.0', idleGraceMs: 200, onExit: () => { exited = true; } });
    const c = await connect(srv.socket, srv.token);
    await new Promise((r) => setTimeout(r, 500));
    expect(exited).toBe(false); // a connected client keeps it up
    c.end();
    await new Promise((r) => setTimeout(r, 700));
    expect(exited).toBe(true);
    expect(readLock(root)).toBeNull();
    await srv.close();
  });

  it('leaves for a restart once nothing runs, telling its clients first', async () => {
    const { root } = factory();
    let restart: boolean | undefined;
    const srv = await startServer(root, { version: '1.0.0', onExit: (r) => { restart = r; } });
    const c = await connect(srv.socket, srv.token);
    expect(await c.call('status')).toMatchObject({ restarting: false, running: 0 });
    await c.call('restartWhenIdle');
    await new Promise((r) => setTimeout(r, 300));
    expect(c.events.some((e) => e.event === 'restarting')).toBe(true);
    expect(restart).toBe(true);
    expect(readLock(root)).toBeNull();
    await srv.close();
  });

  it('refuses to restart while build mode holds a draft, which would be lost', async () => {
    const { root } = factory();
    const srv = await startServer(root, { version: '1.0.0' });
    try {
      const c = await connect(srv.socket, srv.token);
      await c.call('buildStart', 'releases');
      await expect(c.call('restartWhenIdle')).rejects.toThrow(/draft/);
      await c.call('buildDiscard');
      expect(await c.call('status')).toMatchObject({ restarting: false });
    } finally { await srv.close(); }
  });
});
