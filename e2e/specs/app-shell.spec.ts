// What surrounds the Floor: the command-line tool in the menu and top bar, the engine banner, and the app's log.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { alive, expect, readEngineLock, test, until } from '../support/app';

/** The label of the File-menu item about the command-line tool. */
const cliMenuLabel = (app: ElectronApplication) => app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.flatMap((i) => i.submenu?.items ?? []).map((i) => i.label).find((l) => /command-line tool/i.test(l)));

test.describe('The roboratory command in the app', () => {
  test.beforeEach(async ({ roboratory }) => { await roboratory.openDemo(); });

  test('offers to install it in the menu and the top bar while it is missing', async ({ app, window }) => {
    expect(await cliMenuLabel(app)).toBe('Install command-line tool…');
    await expect(window.getByRole('button', { name: 'Install CLI' })).toBeVisible();
  });

  test('installs it when you confirm, after which the menu says so and the button goes', async ({ app, window, sandbox }) => {
    // the confirmation is a native dialog; answer it as a person pressing the first button
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox; });
    await window.getByRole('button', { name: 'Install CLI' }).click();

    const launcher = path.join(sandbox.home, '.local', 'bin', process.platform === 'win32' ? 'roboratory.cmd' : 'roboratory');
    await expect.poll(() => fs.existsSync(launcher)).toBe(true);
    await expect(window.getByRole('button', { name: 'Install CLI' })).toHaveCount(0);
    expect(await cliMenuLabel(app)).toBe('Command-line tool: installed');

    // the installed launcher really starts the command that ships in the app
    const run = process.platform === 'win32'
      ? spawnSync('cmd.exe', ['/c', launcher, 'version'], { encoding: 'utf8', windowsHide: true, env: sandbox.env })
      : spawnSync(launcher, ['version'], { encoding: 'utf8', env: sandbox.env });
    expect(run.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('leaves it alone when you decline', async ({ app, window, sandbox }) => {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox; });
    await window.getByRole('button', { name: 'Install CLI' }).click();
    await expect(window.getByRole('button', { name: 'Install CLI' })).toBeVisible();
    expect(fs.existsSync(path.join(sandbox.home, '.local', 'bin'))).toBe(false);
  });
});

test.describe('The engine banner', () => {
  test('says when the engine stopped, and starts it again on request', async ({ window, roboratory, sandbox }) => {
    await roboratory.openDemo();
    const old = readEngineLock(sandbox.demo)!;
    process.kill(old.pid);
    await expect(window.getByRole('status')).toContainText('Engine stopped. Runs are paused until it starts again.', { timeout: 30_000 });

    await window.getByRole('button', { name: 'Start' }).click();
    await expect(window.getByRole('status')).toHaveCount(0);
    expect(await until(() => { const l = readEngineLock(sandbox.demo); return !!l && l.pid !== old.pid && alive(l.pid); })).toBe(true);
    // and the floor is live again
    await roboratory.run('releases/orders-api', { tag: 'v1' });
    await expect.poll(async () => (await roboratory.lineState('releases/orders-api')).pieces.launch.state, { timeout: 30_000 }).toBe('holding');
  });
});

test.describe('The app log', () => {
  test.use({ allowPageErrors: true });

  test('keeps what went wrong in the window, and the menu shows where', async ({ app, window, roboratory, sandbox }) => {
    await roboratory.openDemo();
    await window.evaluate(() => console.error('e2e: something went wrong in the window'));
    const log = path.join(sandbox.userData, 'logs', 'app.log');
    await expect.poll(() => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '')).toContain('renderer: e2e: something went wrong in the window');
    const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.flatMap((i) => i.submenu?.items ?? []).map((i) => i.label));
    expect(labels).toContain('Show log file');
  });

  test('says why a factory could not be opened', async ({ roboratory, sandbox }) => {
    await roboratory.tryOpenAt(path.join(sandbox.dir, 'nowhere'));
    const log = path.join(sandbox.userData, 'logs', 'app.log');
    await expect.poll(() => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '')).toContain('could not open');
  });
});
