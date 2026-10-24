// The engine as a process (D43): one FactoryService for one factory, served over a local socket.
// Protocol: one JSON object per line. Calls are {id, method, params: [...]} with the methods of
// src/shared/api.ts; replies are {id, result} or {id, error}; pushed events are {event, data}.
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { FactoryService } from './service';
import { RUNS_DIR } from './engine';

export const LOCK_FILE = 'engine.lock';
export const SOCKET_FILE = 'engine.sock';
/** Longest socket path used as is; macOS silently shortens anything past about 104 bytes. */
const MAX_SOCKET_PATH = 100;

export interface EngineLock { pid: number; version: string; socket: string; root: string }
export interface ServerOptions {
  version: string;
  /** How long the engine stays up with no open run and no client, in ms. */
  idleGraceMs?: number;
  /** `restart` is true when the engine left to be started again by a newer version. */
  onExit?: (restart: boolean) => void;
}

export const lockPath = (root: string) => path.join(root, RUNS_DIR, LOCK_FILE);

const pidAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e: any) { return e.code === 'EPERM'; } };

/** The lock of a running engine for this factory, or null when none runs (a stale lock counts as none). */
export function readLock(root: string): EngineLock | null {
  let lock: EngineLock;
  try { lock = JSON.parse(fs.readFileSync(lockPath(root), 'utf8')); } catch { return null; }
  return pidAlive(lock.pid) ? lock : null;
}

/** Where the engine listens: the factory's own folder, a hashed path in the temp folder when that is too long, a named pipe on Windows. */
export function socketPathFor(root: string): string {
  const hash = crypto.createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 12);
  if (process.platform === 'win32') return `\\\\.\\pipe\\roboratory-${hash}`;
  const own = path.join(root, RUNS_DIR, SOCKET_FILE);
  return Buffer.byteLength(own) <= MAX_SOCKET_PATH ? own : path.join(os.tmpdir(), `roboratory-${hash}.sock`);
}

/** Takes the factory's lock, removing a stale one. Throws when another engine is alive. */
function acquire(root: string, socket: string, version: string) {
  fs.mkdirSync(path.join(root, RUNS_DIR), { recursive: true });
  const file = lockPath(root);
  const mine: EngineLock = { pid: process.pid, version, socket, root };
  for (let attempt = 0; ; attempt++) {
    try { fs.writeFileSync(file, JSON.stringify(mine), { flag: 'wx' }); return; } catch (e: any) {
      if (e.code !== 'EEXIST' || attempt) throw e;
      const live = readLock(root);
      if (live) throw new Error(`An engine is already running for this factory (pid ${live.pid}).`);
      try { const old = JSON.parse(fs.readFileSync(file, 'utf8')); if (old.socket && !old.socket.startsWith('\\\\')) fs.rmSync(old.socket, { force: true }); } catch { /* unreadable lock */ }
      fs.rmSync(file, { force: true });
    }
  }
}

type Handler = (service: FactoryService, ...a: any[]) => unknown;
// the client-facing names of src/shared/api.ts that differ from FactoryService's
const calls: Record<string, Handler> = {
  state: (s) => ({ snapshot: s.snapshot(), logs: s.logs() }),
  run: (s, l, input) => s.run(l, input),
  retry: (s, l, p, h) => s.retry(l, p, h),
  release: (s, l, p, c, d) => s.release(l, p, c, d),
  answer: (s, l, p, t) => s.answer(l, p, t),
  halt: (s, l) => s.halt(l),
  resume: (s, l) => s.resume(l),
  runs: (s) => s.runs(),
  runDetail: (s, id) => s.runDetail(id),
  ask: (s, scope, q) => s.ask(scope, q),
  messages: (s, scope) => s.messages(scope),
  acceptProposal: (s, scope, m, p, c) => s.accept(scope, m, p, c),
  rejectProposal: (s, scope, m, p) => s.reject(scope, m, p),
  buildStart: (s, sector) => s.buildStart(sector),
  buildApply: (s, op) => s.buildApply(op),
  buildUndo: (s) => s.buildUndo(),
  buildRedo: (s) => s.buildRedo(),
  buildFields: (s, l, from, back) => s.buildFields(l, from, back),
  buildServers: (s) => s.buildServers(),
  buildRead: (s, p) => s.buildRead(p),
  buildList: (s, p) => s.buildList(p),
  buildSave: (s, r) => s.buildSave(r),
  buildDiscard: (s) => s.buildDiscard(),
};

export interface EngineServer { service: FactoryService; socket: string; clients(): number; close(): Promise<void> }

export async function startServer(root: string, opts: ServerOptions): Promise<EngineServer> {
  root = path.resolve(root);
  const socket = socketPathFor(root);
  acquire(root, socket, opts.version);
  const clients = new Set<net.Socket>();
  const push = (event: string, data: unknown) => {
    const line = JSON.stringify({ event, data }) + '\n';
    for (const c of clients) c.write(line);
  };
  const service = new FactoryService({
    snapshot: (s) => push('snapshot', s),
    logs: (l) => push('logs', l),
    messages: (k) => push('messages', k),
    build: (v) => push('build', v),
  });
  let closed = false;
  let restarting = false;
  const sources = new WeakMap<net.Socket, string>();
  let idleTimer: NodeJS.Timeout | null = null;
  let server: net.Server | null = null;

  const close = async () => {
    if (closed) return;
    closed = true;
    if (idleTimer) clearInterval(idleTimer);
    service.close();
    // closing a Windows pipe drops what the peer has not read yet, so give the last reply and events time to arrive
    if (clients.size) await new Promise((r) => setTimeout(r, 120));
    for (const c of clients) c.destroy();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    fs.rmSync(socket, { force: true });
    fs.rmSync(lockPath(root), { force: true });
    opts.onExit?.(restarting);
  };

  const methods: Record<string, (...a: any[]) => unknown> = {
    hello: (c: net.Socket, opts2?: { client?: string }) => { if (opts2?.client === 'cli') sources.set(c, 'cli'); return { version: opts.version, pid: process.pid, root, name: service.factory?.name ?? '', restarting }; },
    status: () => ({ version: opts.version, pid: process.pid, root, name: service.factory?.name ?? '', restarting, clients: clients.size, running: service.engine?.runningCount() ?? 0, runs: [...(service.engine?.activeLineIds() ?? [])] }),
    // stop dispatching; once no machine or signal runs the engine leaves and its client starts it again (D43)
    restartWhenIdle: () => { restarting = true; service.engine?.pauseDispatch(); push('restarting', {}); return true; },
    cancelRestart: () => { restarting = false; service.engine?.resumeDispatch(); return true; },
    stop: () => { setImmediate(() => void close()); return true; },
  };

  try {
    service.open(root);
    server = net.createServer((c) => {
      clients.add(c);
      let buf = '';
      c.setEncoding('utf8');
      c.on('data', (chunk: string) => {
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (line.trim()) void handle(c, line);
        }
      });
      c.on('close', () => clients.delete(c));
      c.on('error', () => clients.delete(c));
    });
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(socket, () => resolve()); });
    if (process.platform !== 'win32') fs.chmodSync(socket, 0o600);
  } catch (e) {
    await close();
    throw e;
  }

  async function handle(c: net.Socket, line: string) {
    let msg: { id?: number; method?: string; params?: unknown[] };
    try { msg = JSON.parse(line); } catch { return; }
    const reply = (o: object) => { if (!c.destroyed) c.write(JSON.stringify({ id: msg.id, ...o }) + '\n'); };
    try {
      const params = Array.isArray(msg.params) ? msg.params : [];
      const own = msg.method ? methods[msg.method] : undefined;
      const call = msg.method ? calls[msg.method] : undefined;
      if (!own && !call) throw new Error(`Unknown method: ${msg.method}`);
      const engine = service.engine;
      if (engine) engine.source = sources.get(c);
      let pending: unknown;
      try { pending = own ? own(c, ...params) : call!(service, ...params); } finally { if (engine) engine.source = undefined; }
      const result = await pending;
      reply({ result: result ?? null });
    } catch (e: any) {
      reply({ error: e?.message ?? String(e) });
    }
  }

  // deferred so the reply to the call that caused it is written first
  function drained() { setImmediate(() => { if (restarting && !closed && (service.engine?.runningCount() ?? 0) === 0) void close(); }); }
  service.engine?.on('change', drained);

  // ends by itself once nothing is running and nobody is connected
  const grace = opts.idleGraceMs ?? 60_000;
  let idleSince = Date.now();
  idleTimer = setInterval(() => {
    const busy = clients.size > 0 || (service.engine?.activeLineIds().size ?? 0) > 0;
    if (busy) idleSince = Date.now();
    else if (Date.now() - idleSince >= grace) void close();
  }, Math.min(5000, Math.max(20, grace / 4)));
  idleTimer.unref?.();

  return { service, socket, clients: () => clients.size, close };
}
