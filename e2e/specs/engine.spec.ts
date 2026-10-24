// The engine runs without the app (D43): it outlives the window, the command drives it, a newer app restarts an older
// engine without losing a step, build mode's locks reach the command, and only a client with the token gets in.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { alive, cliFor, expect, launch, quit, readEngineLock, stopEngine, test, until, type Sandbox, patience } from '../support/app';
import { appExecutable } from '../tools/exe.mjs';

const LINE = 'releases/orders-api';
const runFile = (root: string, line: string, id: string) => path.join(root, '.runs', line, id, 'run.jsonl');
const events = (root: string, line: string, id: string) => fs.readFileSync(runFile(root, line, id), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const ended = (root: string, line: string, id: string) => { try { return events(root, line, id).find((e) => e.type === 'run.end'); } catch { return undefined; } };

test.describe('When the app quits', () => {
  test.beforeEach(async ({ roboratory }) => {
    await roboratory.openDemo();
  });

  test('the engine keeps running, in a process of its own', async ({ app, roboratory, sandbox }) => {
    await roboratory.run(LINE, { tag: 'v1' });
    await expect.poll(() => roboratory.pieceState(LINE, 'launch'), { timeout: patience(30_000) }).toBe('holding');
    const lock = readEngineLock(sandbox.demo)!;
    expect(lock.pid).not.toBe(app.process().pid);

    await quit(app);
    expect(alive(lock.pid)).toBe(true);
  });

  test('a simulated line reaches its pallet with the app closed, released from the command', async ({ app, roboratory, sandbox, cli }) => {
    const id = await roboratory.run(LINE, { tag: 'v2' });
    await expect.poll(() => roboratory.pieceState(LINE, 'launch'), { timeout: patience(30_000) }).toBe('holding');
    await quit(app);

    expect(cli('release', LINE, 'launch', '--confirm', '2').code).toBe(0);
    expect(await until(() => ended(sandbox.demo, LINE, id)?.status === 'done', 45_000)).toBe(true);
  });

  test('a reopened app shows the run where it is, on the same engine, and the run goes on', async ({ app, roboratory, sandbox }) => {
    const id = await roboratory.run(LINE, { tag: 'v3' });
    await expect.poll(() => roboratory.pieceState(LINE, 'launch'), { timeout: patience(30_000) }).toBe('holding');
    const pid = readEngineLock(sandbox.demo)!.pid;
    await quit(app);

    const again = await launch(sandbox);
    try {
      await expect(again.window.locator('.factory-name')).toHaveText('Demo Factory');
      const state = () => again.window.evaluate((l) => window.roboratory.state().then((s) => s.snapshot.lines[l]?.pieces.launch.state), LINE);
      await expect.poll(state, { timeout: patience(30_000) }).toBe('holding');
      expect(readEngineLock(sandbox.demo)!.pid).toBe(pid);
      await again.window.evaluate((l) => window.roboratory.release(l, 'launch', 2), LINE);
      expect(await until(() => ended(sandbox.demo, LINE, id)?.status === 'done', 45_000)).toBe(true);
    } finally { await quit(again.app); }
  });
});

test.describe('The command line', () => {
  /** A small factory with a machine that asks, one that fails once, and a gate: every verb has something to do. */
  function verbsFactory(sandbox: Sandbox) {
    const root = path.join(sandbox.dir, 'verbs');
    const sim = (extra: string) => `agent: sim\nattempts: 1\nsim:\n  seconds: 1\n${extra}`;
    const files: Record<string, string> = {
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
    for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); }
    return root;
  }

  test('drives a run to its pallet with every verb, and each one is audited as you, from the command', async ({ launched, sandbox }) => {
    const root = verbsFactory(sandbox);
    const cli = cliFor(sandbox, launched.scriptPath, root);
    const L = 's/l';
    const watcher = spawn(appExecutable(), [launched.scriptPath, 'watch', '--factory', root], { windowsHide: true, env: { ...sandbox.env, ELECTRON_RUN_AS_NODE: '1' } });
    let watched = '';
    watcher.stdout.on('data', (d) => { watched += d; });
    try {
      expect(cli('status').out).toContain('No engine is running');
      const started = cli('run', 'l', '--input', 'topic=x');
      expect(started.code).toBe(0);
      const id = started.out.trim();

      expect(await until(() => /asks you/.test(cli('status').out))).toBe(true);
      expect(cli('halt', L).code).toBe(0);
      expect(cli('status').out).toContain('(halted)');
      expect(cli('resume', L).code).toBe(0);
      expect(cli('status').out).not.toContain('(halted)');
      expect(cli('answer', L, 'asker', 'the first').code).toBe(0);
      expect(await until(() => /stopped/.test(cli('status').out))).toBe(true);
      expect(cli('retry', L, 'flaky', '--hint', 'try again').code).toBe(0);
      expect(await until(() => /waiting for you/.test(cli('status').out))).toBe(true);
      expect(cli('release', L, 'ok').code).toBe(0);
      expect(await until(() => ended(root, L, id)?.status === 'done')).toBe(true);

      const verbs = events(root, L, id).filter((e) => e.type === 'verb');
      for (const verb of ['run', 'halt', 'resume', 'answer', 'retry', 'release']) {
        expect(verbs.find((e) => e.verb === verb), verb).toMatchObject({ actor: 'you', source: 'cli' });
      }
      expect(await until(() => /finished|done/.test(watched), 5000)).toBe(true);
      expect(watched).toMatch(/question .*asker/);
      expect(watched).toMatch(/fire .*flaky/);
      expect(watched).toMatch(/gate .*waiting/);
    } finally {
      watcher.kill();
      cli('stop');
    }
  });

  test('asks for each confirmation of a gate that wants several, instead of giving them for you', async ({ roboratory, cli }) => {
    await roboratory.openDemo();
    await roboratory.run(LINE, { tag: 'v5' });
    await expect.poll(() => roboratory.pieceState(LINE, 'launch'), { timeout: patience(30_000) }).toBe('holding');
    const refused = cli('release', LINE, 'launch');
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('--confirm 2');
    expect(await roboratory.pieceState(LINE, 'launch')).toBe('holding');
  });
});

test.describe('An engine older than the app', () => {
  test('restarts when idle, from the banner, and the run goes on with no step on fire', async ({ window, roboratory, sandbox, launched }) => {
    await roboratory.openDemo();
    await roboratory.closeFactory();
    const cli = cliFor(sandbox, launched.scriptPath, sandbox.demo);
    cli('stop');
    await until(() => !readEngineLock(sandbox.demo));

    // an engine that says it is from an earlier version, started by hand
    const old = spawn(appExecutable(), [launched.scriptPath, 'serve', sandbox.demo], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...sandbox.env, ELECTRON_RUN_AS_NODE: '1', ROBORATORY_ENGINE_VERSION: '0.0.1' } });
    old.unref();
    await until(() => !!readEngineLock(sandbox.demo));
    const oldPid = readEngineLock(sandbox.demo)!.pid;

    await window.getByRole('button', { name: sandbox.demo }).click();
    await expect(window.getByRole('status')).toContainText('The engine is older than the app (0.0.1');
    const id = await roboratory.run(LINE, { tag: 'v4' });

    await window.getByRole('button', { name: 'Restart when idle' }).click();
    await expect.poll(() => readEngineLock(sandbox.demo)?.pid, { timeout: patience(45_000) }).not.toBe(oldPid);
    await expect(window.getByRole('status').filter({ hasText: /engine/ })).toHaveCount(0, { timeout: patience(30_000) });
    await expect.poll(() => roboratory.pieceState(LINE, 'launch'), { timeout: patience(45_000) }).toBe('holding');

    const pieces = Object.values((await roboratory.lineState(LINE))?.pieces ?? {});
    expect(pieces.some((p) => p.state === 'fire')).toBe(false);
    expect(events(sandbox.demo, LINE, id).some((e) => e.type === 'piece.fire')).toBe(false);
  });
});

test.describe('Build mode and the command', () => {
  test('a line the open draft changes is refused to the command, and runs once the draft is gone', async ({ window, roboratory, sandbox, cli }) => {
    await roboratory.openDemo();
    await roboratory.goToSector('Releases');
    await window.getByRole('button', { name: 'Build', exact: true }).click();
    const file = 'sectors/releases/models/ship-to-prod/line.yaml';
    await roboratory.buildDraftFile(file, `${fs.readFileSync(path.join(sandbox.demo, file), 'utf8')}# draft\n`);

    const refused = cli('run', LINE, '--input', 'tag=v5');
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('unsaved changes in build mode');

    await roboratory.buildDiscard();
    expect(cli('run', LINE, '--input', 'tag=v5').code).toBe(0);
  });
});

test.describe('Who may talk to the engine', () => {
  test('answers nothing to a connection without the token, and opens no network port', async ({ app, roboratory, sandbox }) => {
    await roboratory.openDemo();
    const lock = readEngineLock(sandbox.demo)!;
    expect(lock.socket).toContain(process.platform === 'win32' ? '\\\\.\\pipe\\' : '.sock');

    const reply = await new Promise<string>((resolve, reject) => {
      const c = net.connect(lock.socket);
      let buf = '';
      c.on('data', (d) => { buf += d; if (buf.includes('\n')) { c.destroy(); resolve(buf); } });
      c.on('error', reject);
      c.on('connect', () => c.write(JSON.stringify({ id: 1, method: 'state', params: [] }) + '\n'));
    });
    expect(JSON.parse(reply)).toMatchObject({ id: 1, error: expect.stringContaining('hello') });

    let listening = '';
    if (process.platform === 'win32') {
      listening = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true }).split('\n').filter((l) => /LISTENING/.test(l) && new RegExp(`\\s${lock.pid}\\s*$`).test(l.trim())).join('');
    } else {
      // The app under test is started by Playwright with a remote-debugging port, and a child can inherit that
      // listening socket. What counts is a port the engine opened itself, so the app's own ports are left out.
      const listeners = (pid: number) => spawnSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', String(pid)], { encoding: 'utf8' });
      const address = (row: string) => /\S+:\d+/.exec(row)?.[0] ?? row;
      const mine = listeners(lock.pid);
      test.skip(mine.error !== undefined, 'lsof is not installed');
      const theApps = new Set(listeners(app.process().pid!).stdout.split('\n').slice(1).filter(Boolean).map(address));
      listening = mine.stdout.split('\n').slice(1).filter((row) => row.trim() && !theApps.has(address(row))).join('\n');
    }
    expect(listening.trim()).toBe('');
    if (process.platform !== 'win32') expect(fs.statSync(lock.socket).mode & 0o077).toBe(0);
  });
});

test.describe('Dry-running a factory through the engine', () => {
  test('every line of the demo reaches its pallet in a simulated run', async ({ roboratory, sandbox }) => {
    await roboratory.openDemo();
    stopEngine(sandbox.demo);
    const run = spawnSync(process.execPath, ['e2e/tools/factory-sim-check.mjs', sandbox.demo], { encoding: 'utf8', timeout: patience(280_000), windowsHide: true });
    expect(run.stdout).toMatch(/OK +engineering\/orders-api: done/);
    expect(run.stdout).toMatch(/OK +incidents\/orders-api: done/);
    expect(run.stdout).toMatch(/OK +releases\/orders-api: done/);
    expect(run.status, run.stdout + run.stderr).toBe(0);
  });
});
