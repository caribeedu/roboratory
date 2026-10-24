// v0.8 exit criteria for the engine that runs without the app (D43), checked against the packaged app
// and its `roboratory` command, all with the simulated agent:
//  1. Quitting the app does not stop runs: a simulated line reaches its pallet with the app closed.
//  2. The command drives a simulated run to its pallet (run, release, answer, retry, halt, resume, status, watch) with no app.
//  3. Rebuilding and reopening the app during a run shows the current state, and the run goes on.
//  4. An older engine with an open run restarts by itself when idle, and no step catches fire because of it.
//  5. Build-mode locks apply to the command: `roboratory run` on a line the open draft changes is refused.
//  6. Flow tests and the factory dry run go through the real engine over the socket (e2e/factory-sim-check.mjs).
//  7. Only your user can connect to the socket, and no network port is open.
// Usage: node e2e/headless.mjs   (honours ROBORATORY_OUT_DIR and ROBORATORY_EXE)
import { appExecutable } from './exe.mjs';
import { _electron as electron } from 'playwright';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const exe = appExecutable();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-headless-'));
const demo = path.join(tmp, 'Demo Factory');
const userData = path.join(tmp, 'ud');
const appEnv = { ...process.env, ROBORATORY_USER_DATA: userData, ROBORATORY_DEMO_DIR: demo, ROBORATORY_SIM_SPEED: '200', ROBORATORY_BELT_MS: '50' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const until = async (fn, ms = 40000) => { const t0 = Date.now(); while (!(await fn())) { if (Date.now() - t0 > ms) return false; await wait(150); } return true; };

// The engine outlives the app, and on Windows it inherits the pipes Playwright waits on, so close() may never return;
// the app is gone once its process has exited.
const quit = async (app) => {
  const proc = app.process();
  await Promise.race([app.close().catch(() => {}), wait(6000)]);
  await until(() => proc.exitCode !== null || proc.signalCode !== null, 10000);
};
const launch = async () => {
  const app = await electron.launch({ executablePath: exe, env: appEnv });
  const win = await app.firstWindow();
  const asar = await app.evaluate(({ app: a }) => a.getAppPath());
  return { app, win, script: path.join(asar, '.vite', 'build', 'engine.js') };
};
// the command: the packaged binary in Node mode running the engine bundle
let script = '';
const cli = (root, ...args) => {
  const r = spawnSync(exe, [script, ...args, '--factory', root], { encoding: 'utf8', env: { ...appEnv, ELECTRON_RUN_AS_NODE: '1' }, timeout: 60000 });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
};
const lockOf = (root) => { try { return JSON.parse(fs.readFileSync(path.join(root, '.runs', 'engine.lock'), 'utf8')); } catch { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const events = (root, line, id) => fs.readFileSync(path.join(root, '.runs', line, id, 'run.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const ended = (root, line, id) => { try { return events(root, line, id).find((e) => e.type === 'run.end'); } catch { return undefined; } };
const stopEngine = (root) => { const l = lockOf(root); if (l && alive(l.pid)) try { process.kill(l.pid); } catch { /* gone */ } };

const LINE = 'releases/orders-api';
const gateHolding = async (win) => win.evaluate(async (l) => (await window.roboratory.state()).snapshot.lines[l]?.pieces.launch?.state === 'holding', LINE);

// ---------- first launch: open the demo and start a run ----------
let { app, win, script: s1 } = await launch();
script = s1;
await wait(1200);
await win.getByText('Open the demo factory').click();
await until(async () => (await win.evaluate(() => window.roboratory.state())).snapshot.factory !== null);
const lock1 = lockOf(demo);
check(!!lock1 && alive(lock1.pid) && lock1.pid !== app.process().pid, 'the engine is its own process, not the app');
const run1 = await win.evaluate(([l]) => window.roboratory.run(l, { tag: 'v1' }), [LINE]);
check(await until(() => gateHolding(win)), 'a run reaches its gate');

// ---------- 3. rebuilding and reopening the app during a run ----------
await quit(app);
check(alive(lock1.pid), 'quitting the app leaves the engine running');
({ app, win } = await launch());
check(await until(async () => (await win.evaluate(() => window.roboratory.state())).snapshot.factory !== null), 'reopening the app opens the last factory');
check(await until(() => gateHolding(win), 15000), '3. the reopened app shows the run where it is');
check(lockOf(demo).pid === lock1.pid, '3. it is the same engine');
await win.evaluate(([l]) => window.roboratory.release(l, 'launch', 2), [LINE]);
check(await until(() => ended(demo, LINE, run1)?.status === 'done'), '3. the run goes on to its pallet');

// ---------- 1. a line reaches its pallet with the app closed ----------
const run2 = await win.evaluate(([l]) => window.roboratory.run(l, { tag: 'v2' }), [LINE]);
await until(() => gateHolding(win));
await quit(app);
check(cli(demo, 'release', LINE, 'launch', '--confirm', '2').code === 0, '1. release from the command with the app closed');
check(await until(() => ended(demo, LINE, run2)?.status === 'done'), '1. the simulated line reaches its pallet with the app closed');

// ---------- 2. the command drives every verb ----------
const verbs = path.join(tmp, 'verbs');
const sim = (extra) => `agent: sim\nattempts: 1\nsim:\n  seconds: 1\n${extra}`;
const files = {
  'factory.yaml': 'name: Verbs\n',
  'sectors/s/sector.yaml': 'name: S\n',
  'sectors/s/lines.yaml': 'lines:\n  - id: l\n    model: m\n',
  'sectors/s/models/m/line.yaml': 'intake: { kind: manual, inputs: [{ name: topic, required: true }] }\npieces:\n  - { id: asker, machine: asker }\n  - { id: flaky, machine: flaky }\n  - { id: ok, label: OK, gate: {} }\n',
  'sectors/s/models/m/machines/asker/role.md': 'role',
  'sectors/s/models/m/machines/asker/contract.json': '{"type":"object"}',
  'sectors/s/models/m/machines/asker/machine.yaml': sim('  ask: { question: "Which one?" }\n  output: { picked: "{{box.human_answer.answer}}" }\n'),
  'sectors/s/models/m/machines/flaky/role.md': 'role',
  'sectors/s/models/m/machines/flaky/contract.json': '{"type":"object","required":["ok"],"properties":{"ok":{"const":true}}}',
  'sectors/s/models/m/machines/flaky/machine.yaml': sim('  fail_first_run: true\n  bad_output: { ok: false }\n  output: { ok: true }\n'),
};
for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(verbs, rel)), { recursive: true }); fs.writeFileSync(path.join(verbs, rel), text); }
const L = 's/l';
const watcher = spawn(exe, [script, 'watch', '--factory', verbs], { env: { ...appEnv, ELECTRON_RUN_AS_NODE: '1' } });
let watched = '';
watcher.stdout.on('data', (d) => { watched += d; });
check(cli(verbs, 'status').out.includes('No engine is running'), '2. status with no engine');
const started = cli(verbs, 'run', 'l', '--input', 'topic=x');
check(started.code === 0 && !!started.out.trim(), '2. run');
const id3 = started.out.trim();
check(await until(() => /needs you: Asker asks you|asks you/.test(cli(verbs, 'status').out)), '2. status shows the question');
check(cli(verbs, 'halt', L).code === 0 && /\(halted\)/.test(cli(verbs, 'status').out), '2. halt');
check(cli(verbs, 'resume', L).code === 0 && !/\(halted\)/.test(cli(verbs, 'status').out), '2. resume');
check(cli(verbs, 'answer', L, 'asker', 'the first').code === 0, '2. answer');
check(await until(() => /needs you: Flaky stopped|stopped/.test(cli(verbs, 'status').out)), '2. a machine on fire shows in status');
check(cli(verbs, 'retry', L, 'flaky', '--hint', 'try again').code === 0, '2. retry');
check(await until(() => /needs you: OK is waiting|waiting for you/.test(cli(verbs, 'status').out)), '2. the gate waits');
check(cli(verbs, 'release', L, 'ok').code === 0, '2. release');
check(await until(() => ended(verbs, L, id3)?.status === 'done'), '2. the run reaches its pallet');
const ev3 = events(verbs, L, id3);
check(['run', 'halt', 'resume', 'answer', 'retry', 'release'].every((v) => ev3.find((e) => e.type === 'verb' && e.verb === v && e.actor === 'you' && e.source === 'cli')), '2. every verb is audited as you, from the cli');
await wait(300);
check(/question .*asker/.test(watched) && /fire .*flaky/.test(watched) && /gate .*ok is waiting|gate .*waiting/.test(watched) && /finished|done/.test(watched), '2. watch printed the question, the fire, the gate and the end');
watcher.kill();

// ---------- 7. the socket belongs to your user, and no port is open ----------
const lockV = lockOf(verbs);
if (process.platform === 'win32') {
  check(lockV.socket.startsWith('\\\\.\\pipe\\'), '7. the engine listens on a named pipe');
} else {
  check((fs.statSync(lockV.socket).mode & 0o077) === 0, '7. the socket is open to your user only');
}
let ports = '';
if (process.platform === 'win32') ports = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' }).split('\n').filter((l) => /LISTENING/.test(l) && new RegExp(`\\s${lockV.pid}\\s*$`).test(l.trim() + ' ')).join('');
else { const r = spawnSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', String(lockV.pid)], { encoding: 'utf8' }); ports = r.stdout.trim(); }
check(ports.trim() === '', '7. the engine opens no network port');
cli(verbs, 'stop');

// ---------- 4 and 5. an older engine, and build mode against the command ----------
stopEngine(demo);
await until(() => !lockOf(demo) || !alive(lockOf(demo).pid));
const old = spawn(exe, [script, 'serve', demo], { detached: true, stdio: 'ignore', env: { ...appEnv, ELECTRON_RUN_AS_NODE: '1', ROBORATORY_ENGINE_VERSION: '0.0.1' } });
old.unref();
await until(() => lockOf(demo));
const oldPid = lockOf(demo).pid;
({ app, win } = await launch());
await until(async () => (await win.evaluate(() => window.roboratory.state())).snapshot.factory !== null);
check(await until(async () => (await win.evaluate(() => window.roboratory.state())).engine.state === 'older'), '4. the app finds the older engine');
const run4 = await win.evaluate(([l]) => window.roboratory.run(l, { tag: 'v4' }), [LINE]);
await until(() => gateHolding(win));
await win.getByRole('button', { name: 'Restart when idle' }).click();
check(await until(() => lockOf(demo) && lockOf(demo).pid !== oldPid && alive(lockOf(demo).pid), 30000), '4. the engine restarts by itself');
check(await until(async () => (await win.evaluate(() => window.roboratory.state())).engine.state === 'running'), '4. the app is connected to the new engine');
check(await until(() => gateHolding(win), 20000), '4. the gate is still holding after the restart');
const fire = await win.evaluate(async (l) => Object.values((await window.roboratory.state()).snapshot.lines[l].pieces).some((p) => p.state === 'fire'), LINE);
check(!fire && !events(demo, LINE, run4).some((e) => e.type === 'piece.fire'), '4. no step caught fire because of the restart');

await win.evaluate(() => window.roboratory.buildStart('releases'));
const lineFile = 'sectors/releases/models/ship-to-prod/line.yaml';
// run 4 is still open on that line; discard it by letting it finish first, then try the lock on a fresh run
await win.evaluate(([l]) => window.roboratory.release(l, 'launch', 2), [LINE]);
await until(() => ended(demo, LINE, run4)?.status === 'done');
const text = fs.readFileSync(path.join(demo, lineFile), 'utf8');
await win.evaluate(([f, t]) => window.roboratory.buildApply({ op: 'writeFile', path: f, content: `${t}# draft\n` }), [lineFile, text]);
const refused = cli(demo, 'run', LINE, '--input', 'tag=v5');
check(refused.code === 1 && /unsaved changes in build mode/.test(refused.err), '5. the command refuses a line the open draft changes');
await win.evaluate(() => window.roboratory.buildDiscard());
check(cli(demo, 'run', LINE, '--input', 'tag=v5').code === 0, '5. and runs it once the draft is gone');
await quit(app);
stopEngine(demo);

// ---------- 6. the dry run goes through the real engine ----------
const dry = spawnSync(process.execPath, ['e2e/factory-sim-check.mjs', demo], { encoding: 'utf8', env: process.env, timeout: 280000 });
console.log(dry.stdout.trim().split('\n').map((l) => `     ${l}`).join('\n'));
check(dry.status === 0, '6. the factory dry run passes through the engine over the socket (flow tests: npm test)');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll v0.8 exit criteria hold');
process.exit(failures ? 1 : 0);
