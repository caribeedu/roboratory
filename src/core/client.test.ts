// The client as the app and the command use it: it reports an engine that went away, and starts a newer one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EngineClient } from './client';
import { createDemoFactory } from './demo';
import { startServer, type EngineServer } from './server';

let server: EngineServer | null = null;
afterEach(async () => { await server?.close(); server = null; });

function demo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-client-'));
  return createDemoFactory(path.join(dir, 'factory'), path.join(dir, 'repos'));
}

const happens = (c: EngineClient, event: string, ms = 10_000) => new Promise<unknown>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`no "${event}" in ${ms} ms`)), ms);
  c.once(event, (v) => { clearTimeout(t); resolve(v); });
});

describe('The engine client', () => {
  it('connects to a running engine and knows its version', async () => {
    const root = demo();
    server = await startServer(root, { version: '3.2.1', build: 'abc' });
    const c = await EngineClient.connect(root, { client: 'app' });
    expect(c.info).toMatchObject({ version: '3.2.1', build: 'abc', restarting: false });
    c.close();
  });

  it('refuses to connect when no engine runs and it was not asked to start one', async () => {
    await expect(EngineClient.connect(demo(), { client: 'app' })).rejects.toThrow('No engine is running for this factory.');
  });

  it('says the engine stopped when it is stopped on request', async () => {
    const root = demo();
    server = await startServer(root, { version: '1.0.0' });
    const c = await EngineClient.connect(root, { client: 'app', reconnectTries: 2 });
    const stopped = happens(c, 'stopped');
    await c.call('stop');
    await stopped;
    c.close();
  });

  it('sees the connection end, not a factory with nothing in it, when the engine is stopped', async () => {
    const root = demo();
    server = await startServer(root, { version: '1.0.0' });
    const c = await EngineClient.connect(root, { client: 'app', reconnectTries: 1 });
    const snapshots: Array<{ factory: unknown }> = [];
    c.on('snapshot', (s) => snapshots.push(s));
    const stopped = happens(c, 'stopped');
    await c.call('stop');
    await stopped;
    expect(snapshots.filter((s) => !s.factory)).toEqual([]);
    c.close();
  });

  it('says the engine stopped when it leaves by itself because nothing runs', async () => {
    const root = demo();
    server = await startServer(root, { version: '1.0.0', idleGraceMs: 100 });
    const c = await EngineClient.connect(root, { client: 'app', reconnectTries: 2 });
    // a connected client keeps it up, so this one lets go of the line but the engine is stopped under it
    const stopped = happens(c, 'stopped');
    void server.close();
    await stopped;
    c.close();
  });

  it('fails the calls that were waiting when the engine went away', async () => {
    const root = demo();
    server = await startServer(root, { version: '1.0.0' });
    const c = await EngineClient.connect(root, { client: 'app', reconnectTries: 1 });
    const stopped = happens(c, 'stopped');
    void server.close();
    await stopped;
    await expect(c.call('state')).rejects.toThrow(/not connected/);
    c.close();
  });
});
