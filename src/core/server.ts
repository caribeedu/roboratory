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

/** `token` proves a client may talk to this engine: only someone who can read the lock (your own folder) has it. `t` is when the engine started. */
export interface EngineLock { pid: number; version: string; socket: string; root: string; token: string; t: number }
export interface ServerOptions {
  version: string;
  /** Which build of the bundle this is (see buildid.ts), told to clients so they can spot an older one. */
  build?: string;
  /** How long the engine stays up with no open run and no client, in ms. */
  idleGraceMs?: number;
  /** How a machine's agent starts `roboratory permission-tool` (D44); set by the bundle that knows its own path. */
  permissionTool?: { command: string; args: string[]; env: Record<string, string> };
  /** `restart` is true when the engine left to be started again by a newer version. */
  onExit?: (restart: boolean) => void;
}

export const lockPath = (root: string) => path.join(root, RUNS_DIR, LOCK_FILE);

const pidAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e: any) { return e.code === 'EPERM'; } };

function readRaw(root: string): EngineLock | null {
  try { return JSON.parse(fs.readFileSync(lockPath(root), 'utf8')); } catch { return null; }
}

/** The lock of a running engine for this factory, or null when none runs (a lock whose pid is gone counts as none). */
export function readLock(root: string): EngineLock | null {
  const lock = readRaw(root);
  return lock && pidAlive(lock.pid) ? lock : null;
}

/** Where the engine listens: the factory's own folder, a path in the temp folder named after the user and the factory when that is too long, a named pipe on Windows. */
export function socketPathFor(root: string): string {
  const user = os.userInfo().username.replace(/[^\w.-]/g, '_');
  const hash = crypto.createHash('sha1').update(`${path.resolve(root)}\n${user}`).digest('hex').slice(0, 12);
  if (process.platform === 'win32') return `\\\\.\\pipe\\roboratory-${user}-${hash}`;
  const own = path.join(root, RUNS_DIR, SOCKET_FILE);
  // outside the factory the socket goes in a folder of the user's own, so nobody else can take its name
  return Buffer.byteLength(own) <= MAX_SOCKET_PATH ? own : path.join(os.tmpdir(), `roboratory-${user}`, `${hash}.sock`);
}

const inFactory = (socket: string) => path.basename(path.dirname(socket)) === RUNS_DIR;

/** Whether the folder that holds the socket can be trusted: the factory's own, or a folder of this user that only this user can enter. */
export function socketDirIsOurs(socket: string): boolean {
  if (process.platform === 'win32' || inFactory(socket)) return true;
  try {
    const st = fs.lstatSync(path.dirname(socket));
    return st.isDirectory() && (process.getuid ? st.uid === process.getuid() : true) && (st.mode & 0o077) === 0;
  } catch { return false; }
}

/** Makes the folder for a socket that is not in the factory, closed to everyone else; throws if it is not ours. */
function prepareSocketDir(socket: string) {
  if (process.platform === 'win32' || inFactory(socket)) return;
  fs.mkdirSync(path.dirname(socket), { recursive: true, mode: 0o700 });
  if (!socketDirIsOurs(socket)) throw new Error(`${path.dirname(socket)} belongs to someone else or is open to others, so the engine will not listen there.`);
}

/** Compares tokens in constant time. */
function sameToken(given: unknown, token: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given), b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** An engine is given this long to start listening before a lock whose pid is alive is doubted. */
const STARTING_MS = 10_000;

function reachable(socket: string) {
  return new Promise<boolean>((resolve) => {
    const s = net.connect(socket);
    const done = (ok: boolean) => { s.destroy(); resolve(ok); };
    s.setTimeout(1000, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/** Removes a lock that was judged stale. The rename lets only one starter do it; a lock that is not the one judged is put back. */
function breakLock(root: string, seen: EngineLock | null) {
  const file = lockPath(root);
  const tomb = `${file}.${process.pid}.stale`;
  try { fs.renameSync(file, tomb); } catch { return; }
  try {
    const got = JSON.parse(fs.readFileSync(tomb, 'utf8')) as EngineLock;
    if (seen && (got.pid !== seen.pid || got.t !== seen.t)) { try { fs.writeFileSync(file, fs.readFileSync(tomb), { flag: 'wx', mode: 0o600 }); } catch { /* another engine took it */ } return; }
  } catch { /* unreadable lock: nothing to keep */ }
  finally { fs.rmSync(tomb, { force: true }); }
  // the socket file of the engine that died; only ever the path computed for this factory, and only a socket
  if (process.platform !== 'win32') { const sp = socketPathFor(root); try { if (fs.lstatSync(sp).isSocket()) fs.rmSync(sp); } catch { /* none */ } }
}

/**
 * The lock of an engine that is really there. A lock whose pid is gone, or whose pid is alive but nothing listens
 * after the start-up time (the pid was reused), is stale and is removed.
 */
export async function liveLock(root: string): Promise<EngineLock | null> {
  if (!fs.existsSync(lockPath(root))) return null;
  const lock = readRaw(root);
  if (!lock) { breakLock(root, null); return null; }
  if (!pidAlive(lock.pid)) { breakLock(root, lock); return null; }
  if (Date.now() - lock.t < STARTING_MS || await reachable(socketPathFor(root))) return lock;
  breakLock(root, lock);
  return null;
}

/** Takes the factory's lock, removing a stale one. Throws when another engine is alive. */
async function acquire(root: string, socket: string, version: string): Promise<string> {
  fs.mkdirSync(path.join(root, RUNS_DIR), { recursive: true });
  const file = lockPath(root);
  const mine: EngineLock = { pid: process.pid, version, socket, root, token: crypto.randomBytes(16).toString('hex'), t: Date.now() };
  for (let attempt = 0; ; attempt++) {
    try { fs.writeFileSync(file, JSON.stringify(mine), { flag: 'wx', mode: 0o600 }); return mine.token; } catch (e: any) {
      if (e.code !== 'EEXIST' || attempt >= 3) throw e;
      const live = await liveLock(root);
      if (live) throw new Error(`An engine is already running for this factory (pid ${live.pid}).`);
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
  allow: (s, id) => s.allow(id),
  deny: (s, id, reason) => s.deny(id, reason),
  halt: (s, l) => s.halt(l),
  resume: (s, l) => s.resume(l),
  runs: (s) => s.runs(),
  stats: (s, filter) => s.stats(filter),
  rehearsalPlan: (s, req) => s.rehearsalPlan(req),
  rehearse: (s, req) => s.rehearse(req),
  rehearsalStop: (s) => s.rehearsalStop(),
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

export interface EngineServer { service: FactoryService; socket: string; token: string; clients(): number; close(): Promise<void> }

export async function startServer(root: string, opts: ServerOptions): Promise<EngineServer> {
  root = path.resolve(root);
  const socket = socketPathFor(root);
  const token = await acquire(root, socket, opts.version);
  try { prepareSocketDir(socket); } catch (e) { fs.rmSync(lockPath(root), { force: true }); throw e; }
  const clients = new Set<net.Socket>();
  // a connection is trusted once its hello carried the lock's token; events go to trusted connections only
  const authed = new Set<net.Socket>();
  const push = (event: string, data: unknown) => {
    // closing the service pushes an empty snapshot; a client must see the connection end, not "no factory"
    if (closed) return;
    const line = JSON.stringify({ event, data }) + '\n';
    for (const c of authed) c.write(line);
  };
  const service = new FactoryService({
    snapshot: (s) => push('snapshot', s),
    logs: (l) => push('logs', l),
    messages: (k) => push('messages', k),
    build: (v) => push('build', v),
    rehearsal: (p) => push('rehearsal', p),
  }, { permissionTool: opts.permissionTool });
  let closed = false;
  let failed = false;
  let restarting = false;
  const sources = new WeakMap<net.Socket, string>();
  const watchers = new Set<net.Socket>();
  const spent = new Map<string, number>();
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
    if (process.platform !== 'win32') fs.rmSync(socket, { force: true });
    fs.rmSync(lockPath(root), { force: true });
    if (!failed) opts.onExit?.(restarting);
  };

  const methods: Record<string, (...a: any[]) => unknown> = {
    hello: (c: net.Socket, who?: { client?: string; token?: string }) => {
      if (!sameToken(who?.token, token)) throw new Error("Not allowed to use this engine.");
      authed.add(c);
      if (who?.client === 'cli') sources.set(c, 'cli');
      return { version: opts.version, build: opts.build, pid: process.pid, root, name: service.factory?.name ?? '', restarting };
    },
    status: () => ({ version: opts.version, build: opts.build, pid: process.pid, root, name: service.factory?.name ?? '', restarting, clients: clients.size, running: service.engine?.runningCount() ?? 0, runs: [...(service.engine?.activeLineIds() ?? [])] }),
    // stop dispatching; once no machine or signal runs the engine leaves and its client starts it again (D43)
    restartWhenIdle: () => {
      if (service.buildOpen) throw new Error('Build mode has a draft open. Save or discard it first: a restart would lose it.');
      restarting = true;
      service.engine?.pauseDispatch();
      push('restarting', {});
      return true;
    },
    // an agent's permission tool asks whether a machine may make a call; the reply comes when a person has decided (D44)
    // (a request is given up if the connection that asked ends before a person answers)
    permission: (c: net.Socket, session: string, call: { tool: string; input: Record<string, unknown> }) => {
      const ended = new AbortController();
      c.once('close', () => ended.abort());
      return service.permit(session, call, ended.signal);
    },
    // a rehearsal spends money, so it ends with the connection that asked for it (Ctrl-C in the command, the window closing)
    rehearse: (c: net.Socket, req: Parameters<FactoryService['rehearse']>[0]) => {
      if (restarting) throw new Error('The engine is restarting and starts no rehearsal. Try again in a moment.');
      const stop = () => service.rehearsalStop();
      c.once('close', stop);
      return service.rehearse(req).finally(() => { c.off('close', stop); drained(); });
    },
    // a stream of what is worth acting on, for `roboratory watch`
    watch: (c: net.Socket) => { watchers.add(c); return true; },
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
      const gone = () => { clients.delete(c); authed.delete(c); watchers.delete(c); };
      c.on('close', gone);
      c.on('error', gone);
    });
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(socket, () => resolve()); });
    if (process.platform !== 'win32') fs.chmodSync(socket, 0o600);
  } catch (e) {
    failed = true; // the caller reports why; a quiet exit would hide it
    await close();
    throw e;
  }

  async function handle(c: net.Socket, line: string) {
    let msg: { id?: number; method?: string; params?: unknown[] };
    try { msg = JSON.parse(line); } catch { return; }
    const reply = (o: object) => { if (!c.destroyed) c.write(JSON.stringify({ id: msg.id, ...o }) + '\n'); };
    try {
      const params = Array.isArray(msg.params) ? msg.params : [];
      const own = msg.method && Object.hasOwn(methods, msg.method) ? methods[msg.method] : undefined;
      const call = msg.method && Object.hasOwn(calls, msg.method) ? calls[msg.method] : undefined;
      if (!own && !call) throw new Error(`Unknown method: ${msg.method}`);
      if (!authed.has(c) && msg.method !== 'hello') throw new Error("Say hello with the engine's token first.");
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

  const WORTH = new Set(['run.start', 'run.end', 'piece.hold', 'piece.ask', 'piece.fire', 'rework', 'piece.blocked', 'permission.request']);
  service.engine?.on('record', (run: { id: string; lineId: string }, ev: Record<string, any>) => {
    if (ev.type === 'cost') spent.set(run.id, (spent.get(run.id) ?? 0) + ev.usd);
    if (!watchers.size || !WORTH.has(ev.type)) return;
    const line = JSON.stringify({ event: 'watch', data: { runId: run.id, lineId: run.lineId, costUsd: spent.get(run.id) ?? 0, ...ev } }) + '\n';
    for (const w of watchers) w.write(line);
  });

  // deferred so the reply to the call that caused it is written first
  function drained() { setImmediate(() => { if (restarting && !closed && (service.engine?.runningCount() ?? 0) === 0 && !service.rehearsalRunning) void close(); }); }
  service.engine?.on('change', drained);

  // ends by itself once nothing is running and nobody is connected
  const grace = opts.idleGraceMs ?? 60_000;
  let idleSince = Date.now();
  idleTimer = setInterval(() => {
    const busy = clients.size > 0 || (service.engine?.activeLineIds().size ?? 0) > 0 || service.rehearsalRunning;
    if (busy) idleSince = Date.now();
    else if (Date.now() - idleSince >= grace) void close();
  }, Math.min(5000, Math.max(20, grace / 4)));
  idleTimer.unref?.();

  return { service, socket, token, clients: () => clients.size, close };
}
