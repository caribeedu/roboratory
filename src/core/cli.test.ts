import { spawn, spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EngineClient, launchFor } from './client';
import { createDemoFactory } from './demo';
import { lockPath, readLock } from './server';
import type { Snapshot } from '../shared/types';

// Drives a real engine as a separate process through the bundle, the way the app and the command line do.
process.env.ROBORATORY_SIM_SPEED = '200';

let bundle = '';
beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-bundle-'));
  bundle = path.join(dir, 'engine.cjs');
  await build({ entryPoints: [path.join(__dirname, '..', 'engine.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: bundle, logLevel: 'error' });
}, 60_000);

const factoryDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-cli-'));
  return createDemoFactory(path.join(dir, 'factory'), path.join(dir, 'repos'));
};
const cli = (root: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [bundle, ...args, '--factory', root], { encoding: 'utf8', env: process.env, timeout: 60_000, windowsHide: true });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const until = async (fn: () => boolean | Promise<boolean>, ms = 30_000) => {
  const t0 = Date.now();
  while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 100)); }
};
const stopEngine = (root: string) => { try { process.kill(readLock(root)!.pid); } catch { /* gone */ } };
const events = (root: string, runId: string) => fs.readFileSync(path.join(root, '.runs', LINE, runId, 'run.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const LINE = 'releases/orders-api';

describe('the roboratory command and the engine as a process', () => {
  it('drives a simulated run to its pallet with no app, and audits every verb as the command line', async () => {
    const root = factoryDir();
    try {
      expect(cli(root, 'status').out).toMatch(/No engine is running/);
      expect(cli(root, 'run', LINE).err).toMatch(/Missing input/);
      const started = cli(root, 'run', LINE, '--input', 'tag=v1.2.3');
      expect(started.code).toBe(0);
      const runId = started.out.trim();
      expect(fs.existsSync(lockPath(root))).toBe(true);
      expect(fs.readFileSync(path.join(root, '.runs', 'engine.log'), 'utf8')).toMatch(/serving/);

      await until(() => /needs you: Launch/.test(cli(root, 'status').out));
      expect(cli(root, 'halt', LINE).code).toBe(0);
      expect(cli(root, 'status').out).toMatch(/\(halted\)/);
      expect(cli(root, 'resume', LINE).code).toBe(0);
      // the gate asks for two confirmations, and the command wants you to say you give them
      expect(cli(root, 'release', LINE, 'launch').err).toMatch(/--confirm 2/);
      expect(cli(root, 'release', LINE, 'launch', '--confirm', '2').code).toBe(0);
      await until(() => events(root, runId).some((e) => e.type === 'run.end'));

      const ev = events(root, runId);
      expect(ev.find((e) => e.type === 'run.end')).toMatchObject({ status: 'done' });
      for (const verb of ['run', 'halt', 'resume', 'release']) expect(ev.find((e) => e.type === 'verb' && e.verb === verb), verb).toMatchObject({ actor: 'you', source: 'cli' });
      expect(fs.readFileSync(path.join(root, '.runs', 'releases', 'audit.jsonl'), 'utf8')).toMatch(/"source":"cli"/);

      expect(cli(root, 'stop').out).toMatch(/stopped/);
      await until(() => !fs.existsSync(lockPath(root)));
    } finally { stopEngine(root); }
  }, 120_000);

  it('survives the app: closing a client leaves the run going, and a new client sees its state', async () => {
    const root = factoryDir();
    try {
      const a = await EngineClient.connect(root, { client: 'app', start: true, launch: launchFor(bundle) });
      const id = await a.call<string>('run', LINE, { tag: 'v9' });
      a.close(); // the app quits
      const b = await EngineClient.connect(root, { client: 'app' });
      const { snapshot } = await b.call<{ snapshot: Snapshot }>('state');
      expect(Object.keys(snapshot.lines)).toContain(LINE);
      await until(async () => (await b.call<{ snapshot: Snapshot }>('state')).snapshot.lines[LINE].pieces.launch.state === 'holding');
      expect((await b.call<any[]>('runs')).find((r) => r.id === id)).toBeTruthy();
      b.close();
    } finally { stopEngine(root); }
  }, 60_000);

  it('refuses a run of a line that build mode has unsaved changes to, for the command line too', async () => {
    const root = factoryDir();
    try {
      const app = await EngineClient.connect(root, { client: 'app', start: true, launch: launchFor(bundle) });
      await app.call('buildStart', 'releases');
      const file = 'sectors/releases/models/ship-to-prod/line.yaml';
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      await app.call('buildApply', { op: 'writeFile', path: file, content: `${text}# draft\n` });
      const r = cli(root, 'run', LINE, '--input', 'tag=v1');
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/unsaved changes in build mode/);
      await app.call('buildDiscard');
      expect(cli(root, 'run', LINE, '--input', 'tag=v1').code).toBe(0);
      app.close();
    } finally { stopEngine(root); }
  }, 60_000);

  it('restarts an older engine by itself once idle, and the run goes on with no step on fire', async () => {
    const root = factoryDir();
    try {
      // an engine that reports an older version, started by hand
      const old = spawn(process.execPath, [bundle, 'serve', root], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ROBORATORY_ENGINE_VERSION: '0.0.1' } });
      old.unref();
      await until(() => !!readLock(root));
      const app = await EngineClient.connect(root, { client: 'app', start: true, launch: launchFor(bundle) });
      expect(app.info.version).toBe('0.0.1');
      const oldPid = app.info.pid;
      const connected = new Promise<void>((resolve) => app.once('connected', () => resolve()));
      await app.call('run', LINE, { tag: 'v2' });
      await app.call('restartWhenIdle');
      await connected;
      expect(app.info.version).not.toBe('0.0.1');
      expect(app.info.pid).not.toBe(oldPid);
      await until(async () => (await app.call<{ snapshot: Snapshot }>('state')).snapshot.lines[LINE].pieces.launch.state === 'holding');
      const { snapshot } = await app.call<{ snapshot: Snapshot }>('state');
      expect(Object.values(snapshot.lines[LINE].pieces).some((p) => p.state === 'fire')).toBe(false);
      app.close();
    } finally { stopEngine(root); }
  }, 90_000);

  it('prints what needs you with `watch`', async () => {
    const root = factoryDir();
    try {
      expect(cli(root, 'run', LINE, '--input', 'tag=v3').code).toBe(0);
      const w = spawn(process.execPath, [bundle, 'watch', '--factory', root], { env: process.env, windowsHide: true });
      let out = '';
      w.stdout.on('data', (d) => { out += d; });
      await until(() => /gate releases\/orders-api\/launch is waiting for you/.test(out) || /gate .*launch.*waiting/.test(out));
      w.kill();
    } finally { stopEngine(root); }
  }, 60_000);
});
