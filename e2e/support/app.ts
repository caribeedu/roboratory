// What every e2e spec stands on: the packaged app, launched in a sandbox of its own, and the `roboratory` command
// that ships inside it. A test gets a new user-data folder, a new demo factory and, through it, a new engine, so
// no test depends on another. Nothing here touches your own factories or settings.
import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appExecutable } from '../tools/exe.mjs';
import type { Snapshot } from '../../src/shared/types';

export { expect };

export interface Sandbox {
  dir: string;
  userData: string;
  /** the home folder the app sees */
  home: string;
  /** where "Open the demo factory" puts the demo */
  demo: string;
  env: NodeJS.ProcessEnv;
}

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long to wait for something slow: a Windows CI runner takes several times longer than a laptop to start things. */
export const patience = (ms: number) => (process.env.CI && process.platform === 'win32' ? ms * 3 : ms);

export async function until(fn: () => boolean | Promise<boolean>, ms = 30_000, every = 100) {
  const t0 = Date.now();
  while (!(await fn())) {
    if (Date.now() - t0 > patience(ms)) return false;
    await wait(every);
  }
  return true;
}

export function makeSandbox(extraEnv: NodeJS.ProcessEnv = {}): Sandbox {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-e2e-'));
  const demo = path.join(dir, 'Demo Factory');
  const userData = path.join(dir, 'user-data');
  // simulated agents work fast, and boxes cross a belt in a blink, unless a test wants to watch them
  // a home of its own, so installing the command or reading settings never touches the real one
  const home = path.join(dir, 'home');
  fs.mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home, ROBORATORY_USER_DATA: userData, ROBORATORY_DEMO_DIR: demo, ROBORATORY_SIM_SPEED: '200', ROBORATORY_BELT_MS: '50', ...extraEnv };
  return { dir, userData, home, demo, env };
}

export interface EngineLock { pid: number; version: string; socket: string; token: string }
export const readEngineLock = (root: string): EngineLock | null => {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.runs', 'engine.lock'), 'utf8')); } catch { return null; }
};
export const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Stops the engine of a factory, if one runs: it outlives the app, so a test has to put it away. */
export function stopEngine(root: string) {
  const lock = readEngineLock(root);
  if (lock && alive(lock.pid)) { try { process.kill(lock.pid); } catch { /* already gone */ } }
}

export interface Launched { app: ElectronApplication; window: Page; errors: string[]; scriptPath: string }

/** Starts the packaged app in a sandbox. */
export async function launch(sandbox: Sandbox, args: string[] = []): Promise<Launched> {
  // CI containers have no setuid sandbox for Chromium
  const sandboxFlag = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : [];
  const app = await electron.launch({ executablePath: appExecutable(), args: [...sandboxFlag, ...args], env: sandbox.env as Record<string, string> });
  const window = await app.firstWindow();
  const errors: string[] = [];
  window.on('pageerror', (e) => errors.push(String(e)));
  window.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const asar = await app.evaluate(({ app: a }) => a.getAppPath());
  await window.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  return { app, window, errors, scriptPath: path.join(asar, '.vite', 'build', 'engine.js') };
}

/**
 * Quits the app and waits for its process to end. The engine outlives the app, and on Windows it inherits the pipes
 * Playwright waits on, so `close()` may never return; the app is gone once its process has exited.
 */
export async function quit(app: ElectronApplication) {
  let proc;
  try { proc = app.process(); } catch { return; } // a test that quit the app itself leaves nothing to close
  await Promise.race([app.close().catch(() => undefined), wait(6000)]);
  await until(() => proc.exitCode !== null || proc.signalCode !== null, 10_000);
}

export interface CliResult { code: number | null; out: string; err: string }

/** The `roboratory` command: the packaged binary in Node mode running the engine bundle. */
export function cliFor(sandbox: Sandbox, scriptPath: string, factory: string) {
  return (...args: string[]): CliResult => {
    const r = spawnSync(appExecutable(), [scriptPath, ...args, '--factory', factory], {
      encoding: 'utf8', timeout: 60_000, windowsHide: true, env: { ...sandbox.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
  };
}

// ---------- what a person does in the window ----------

/** The window, as a person uses it. */
export class Roboratory {
  constructor(readonly page: Page) {}

  async openDemo() {
    await this.page.getByRole('button', { name: 'Open the demo factory' }).click();
    await expect(this.page.locator('.factory-name')).toHaveText('Demo Factory');
  }

  /** Calls the same bridge the buttons call, for set-up that is not what the test is about. */
  run(lineId: string, input: Record<string, string>) {
    return this.page.evaluate(([l, i]) => window.roboratory.run(l as string, i as Record<string, string>), [lineId, input] as const);
  }

  state() { return this.page.evaluate(() => window.roboratory.state()); }

  runs() { return this.page.evaluate(() => window.roboratory.runs()); }

  closeFactory() { return this.page.evaluate(() => window.roboratory.closeFactory()); }

  buildDiscard() { return this.page.evaluate(() => window.roboratory.buildDiscard()); }

  /** Puts a file in the open build-mode draft, as an edit made in a panel would. */
  buildDraftFile(file: string, content: string) { return this.page.evaluate(([f, c]) => window.roboratory.buildApply({ op: 'writeFile', path: f, content: c }), [file, content] as const); }

  /** Opens a folder the way the app does, and gives back what it complained about, if anything. */
  tryOpenAt(folder: string) { return this.page.evaluate((p) => window.roboratory.openFactoryAt(p).then(() => '', (e: Error) => e.message), folder); }

  /** A line as the floor sees it, or nothing while the engine is between two lives. */
  async lineState(lineId: string): Promise<Snapshot['lines'][string] | undefined> { return (await this.state()).snapshot.lines[lineId]; }

  /** The state of one station ("holding", "fire"…), or nothing while the line is not on the floor. */
  async pieceState(lineId: string, pieceId: string) { return (await this.lineState(lineId))?.pieces[pieceId]?.state; }

  attention() { return this.page.getByRole('region', { name: 'Needs you' }); }

  sector(name: string) { return this.page.getByRole('navigation', { name: 'Sectors' }).getByRole('button', { name: new RegExp(name) }); }

  async goToSector(name: string) {
    await this.sector(name).click();
    await expect(this.sector(name)).toHaveAttribute('aria-current', 'true');
  }

  /** A station on the floor, by its label. */
  piece(label: string | RegExp) { return this.page.locator('.piece-label', { hasText: label }).first(); }

  async openPiece(label: string | RegExp) {
    const box = await this.piece(label).boundingBox();
    if (!box) throw new Error(`no piece called ${label} on the floor`);
    await this.page.mouse.click(box.x + box.width / 2, box.y + 2);
  }

  panel(name: string | RegExp) { return this.page.getByRole('complementary', { name }); }

  async openLedger() { await this.page.getByRole('tab', { name: /Ledger/ }).click(); }

  async openFloor() { await this.page.getByRole('tab', { name: /Floor/ }).click(); }
}

// ---------- fixtures ----------

interface Fixtures {
  sandbox: Sandbox;
  launched: Launched;
  app: ElectronApplication;
  window: Page;
  roboratory: Roboratory;
  cli: (...args: string[]) => CliResult;
  /** page errors are a failure unless a test says it causes one on purpose */
  allowPageErrors: boolean;
}

export const test = base.extend<Fixtures>({
  allowPageErrors: [false, { option: true }],

  sandbox: async ({}, use) => {
    const sandbox = makeSandbox();
    await use(sandbox);
    stopEngine(sandbox.demo);
    await until(() => { const l = readEngineLock(sandbox.demo); return !l || !alive(l.pid); }, 5000);
    fs.rmSync(sandbox.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  },

  launched: async ({ sandbox, allowPageErrors }, use, testInfo) => {
    const launched = await launch(sandbox);
    await launched.app.context().tracing.start({ screenshots: true, snapshots: true });
    await use(launched);
    const failed = testInfo.status !== testInfo.expectedStatus;
    await launched.app.context().tracing.stop(failed ? { path: testInfo.outputPath('trace.zip') } : undefined).catch(() => undefined);
    if (failed) await testInfo.attach('window', { body: await launched.window.screenshot().catch(() => Buffer.alloc(0)), contentType: 'image/png' }).catch(() => undefined);
    await quit(launched.app);
    if (!allowPageErrors) expect(launched.errors, 'the window logged errors').toEqual([]);
  },

  app: async ({ launched }, use) => { await use(launched.app); },
  window: async ({ launched }, use) => { await use(launched.window); },
  roboratory: async ({ window }, use) => { await use(new Roboratory(window)); },
  cli: async ({ launched, sandbox }, use) => { await use(cliFor(sandbox, launched.scriptPath, sandbox.demo)); },
});
