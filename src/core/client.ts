// Talks to a factory's engine process over its socket (D43). The app's main process and the command line
// use this same client, and the tests drive the engine through it.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { RUNS_DIR } from './engine';
import { liveLock, readLock, socketPathFor, type EngineLock } from './server';

export interface LaunchSpec { command: string; args: string[]; env?: Record<string, string> }
export interface EngineInfo { version: string; pid: number; root: string; name: string; restarting: boolean }
export interface ConnectOptions {
  /** Who is calling, for the audit: the command line's verbs are recorded with the source "cli". */
  client?: 'app' | 'cli';
  /** Starts the engine when none runs. */
  start?: boolean;
  /** How to start it; defaults to this process running `script`. */
  launch?: LaunchSpec;
  startTimeoutMs?: number;
  /** Tries to reach a dropped engine again before reporting it stopped. */
  reconnectTries?: number;
}

export const LOG_FILE = 'engine.log';

/** The packaged app's own binary runs the bundle in Node mode; development uses the project's Node. */
export function launchFor(script: string): LaunchSpec {
  return { command: process.execPath, args: [script], env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {} };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Events: snapshot, logs, messages, build (pushed by the engine), restarting, stopped, connected. */
export class EngineClient extends EventEmitter {
  info!: EngineInfo;
  private sock: net.Socket | null = null;
  private seq = 0;
  private waiting = new Map<number, { ok(v: any): void; fail(e: Error): void }>();
  private closed = false;
  private restartSeen = false;

  private constructor(readonly root: string, private opts: ConnectOptions) { super(); }

  /** Connects to the factory's engine, starting it first when `start` is set and none runs. */
  static async connect(root: string, opts: ConnectOptions = {}): Promise<EngineClient> {
    const c = new EngineClient(path.resolve(root), opts);
    await c.attach(!!opts.start);
    return c;
  }

  /** Whether an engine runs for this factory (no connection is made). */
  static running(root: string) { return readLock(path.resolve(root)); }

  private async attach(start: boolean) {
    let lock = await liveLock(this.root);
    if (!lock) {
      if (!start) throw new Error('No engine is running for this factory.');
      lock = await this.startEngine();
    }
    // the path is worked out here, never read from the lock, so a lock cannot send a client elsewhere
    const sock = await open(socketPathFor(this.root), 5000);
    this.bind(sock);
    try {
      this.info = await this.call<EngineInfo>('hello', { client: this.opts.client ?? 'app', token: lock.token });
    } catch (e) {
      if (this.sock === sock) this.sock = null;
      sock.destroy();
      throw e;
    }
    // an engine that is already waiting to restart is restarted by whoever connects to it
    if (this.info.restarting) this.restartSeen = true;
  }

  private bind(sock: net.Socket) {
    this.sock = sock;
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) this.receive(line);
      }
    });
    sock.on('error', () => { /* followed by close */ });
    sock.on('close', () => { if (this.sock === sock) void this.dropped(); });
  }

  private receive(line: string) {
    let m: { id?: number; result?: unknown; error?: string; event?: string; data?: unknown };
    try { m = JSON.parse(line); } catch { return; }
    if (m.event) {
      if (m.event === 'restarting') this.restartSeen = true;
      this.emit(m.event, m.data);
      return;
    }
    const w = this.waiting.get(m.id ?? -1);
    if (!w) return;
    this.waiting.delete(m.id!);
    if (m.error !== undefined) w.fail(new Error(m.error)); else w.ok(m.result);
  }

  call<T = unknown>(method: string, ...params: unknown[]): Promise<T> {
    return new Promise<T>((ok, fail) => {
      if (!this.sock || this.sock.destroyed) { fail(new Error('The engine is not connected.')); return; }
      const id = ++this.seq;
      this.waiting.set(id, { ok, fail });
      this.sock.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  /** The connection dropped: reconnect (starting a newer engine after a restart), else report the engine stopped. */
  private async dropped() {
    this.sock = null;
    for (const w of this.waiting.values()) w.fail(new Error('The engine stopped.'));
    this.waiting.clear();
    if (this.closed) return;
    const tries = this.opts.reconnectTries ?? 5;
    const start = this.restartSeen && (this.opts.start ?? true);
    for (let i = 0; i < tries && !this.closed; i++) {
      try {
        await this.attach(start);
        this.restartSeen = false;
        this.emit('connected', this.info);
        return;
      } catch { await sleep(300); }
    }
    if (!this.closed) this.emit('stopped');
  }

  /** Starts the engine again after it stopped, and reconnects. */
  async restart() {
    this.restartSeen = false;
    await this.attach(true);
    this.emit('connected', this.info);
  }

  private async startEngine() {
    if (!this.opts.launch) throw new Error('Cannot start the engine: no launch command was given.');
    const { command, args, env } = this.opts.launch;
    fs.mkdirSync(path.join(this.root, RUNS_DIR), { recursive: true });
    const logFile = path.join(this.root, RUNS_DIR, LOG_FILE);
    const fd = fs.openSync(logFile, 'a');
    let exited: number | null | undefined;
    const child = spawn(command, [...args, 'serve', this.root], { detached: true, stdio: ['ignore', fd, fd], windowsHide: true, env: { ...process.env, ...env } });
    child.on('exit', (code) => { exited = code; });
    child.on('error', (e) => { fs.appendFileSync(logFile, `Could not start the engine: ${e.message}\n`); exited = -1; });
    child.unref();
    fs.closeSync(fd);
    const until = Date.now() + (this.opts.startTimeoutMs ?? 20_000);
    while (Date.now() < until) {
      // the lock is written before the engine has loaded the factory and listens: ready is when it answers
      const lock: EngineLock | null = readLock(this.root);
      if (lock) {
        try { (await open(socketPathFor(this.root), 300)).destroy(); return lock; } catch { /* not listening yet */ }
      }
      if (exited !== undefined) break;
      await sleep(50);
    }
    const tail = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').slice(-5).join('\n') : '';
    throw new Error(`The engine did not start${tail ? `:\n${tail}` : '.'}`);
  }

  /** Drops the connection; the engine keeps running. */
  close() {
    this.closed = true;
    const s = this.sock;
    this.sock = null;
    s?.destroy();
    for (const w of this.waiting.values()) w.fail(new Error('Disconnected.'));
    this.waiting.clear();
  }
}

/** The lock is written just before the engine listens, so a fresh engine may need a moment. */
async function open(socket: string, waitMs: number): Promise<net.Socket> {
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      return await new Promise<net.Socket>((resolve, reject) => {
        const s = net.connect(socket);
        s.once('connect', () => { s.removeListener('error', reject); resolve(s); });
        s.once('error', reject);
      });
    } catch (e) {
      if (Date.now() >= until) throw e;
      await sleep(50);
    }
  }
}
