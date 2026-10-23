// Launches the packaged app against a throwaway demo factory and takes screenshots.
// Usage: node e2e/shoot.mjs <out-dir>
import { appExecutable } from './exe.mjs';
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'promptory-e2e-'));
const exe = appExecutable();
const app = await electron.launch({ executablePath: exe, env: { ...process.env, PROMPTORY_USER_DATA: path.join(tmp, 'ud'), PROMPTORY_DEMO_DIR: path.join(tmp, 'Demo Factory'), PROMPTORY_SIM_SPEED: process.env.PROMPTORY_SIM_SPEED || '2' } });
const win = await app.firstWindow();
await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
const errors = [];
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
win.on('pageerror', (e) => errors.push(String(e)));
const shot = async (name) => { await win.screenshot({ path: path.join(out, `${name}.png`) }); console.log('shot', name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1500);
await shot('01-welcome');
await win.getByText('Open the demo factory').click();
await wait(2500);
await shot('02-floor-engineering');
const steps = (process.argv[3] || 'all').split(',');
if (steps.includes('all') || steps.includes('run')) {
  await win.evaluate(() => window.promptory.run('engineering/orders-api', { ticket: 'PROJ-812' }));
  await win.evaluate(() => window.promptory.run('engineering/storefront-ui', { ticket: 'PROJ-900' }));
  await win.evaluate(() => window.promptory.run('incidents/orders-api', { alert: 'ALT-55102' }));
  await win.evaluate(() => window.promptory.run('releases/orders-api', { tag: 'v4.18.0' }));
  await wait(6000);
  await shot('03-floor-running');
  await wait(14000);
  await shot('04-floor-later');
  // firefight: open the fire from the attention queue
  await win.getByRole('button', { name: /Investigate stopped/ }).click();
  await wait(1500);
  await shot('05-fire-panel');
  await win.locator('#retry-hint').fill('Include suspected_cause from the pool metrics.');
  await win.getByRole('button', { name: /Retry with hint/ }).click();
  await wait(9000);
  await shot('06-after-retry');
  // gate: release the incident sign-off and the two-key launch
  const gate = win.getByRole('button', { name: /Mitigation OK is waiting|Launch is waiting/ }).first();
  await gate.click();
  await wait(1200);
  await shot('07-gate-panel');
  await win.getByRole('button', { name: /^Release$/ }).click();
  await wait(300);
  await shot('08-gate-confirm');
  for (let i = 0; i < 3; i++) { const yes = win.getByRole('button', { name: /^Yes/ }); if (await yes.count()) { await yes.first().click(); await wait(300); } }
  await wait(1500);
  // megaphone
  await win.locator('#megaphone-input').fill('What needs me right now?');
  await win.getByRole('button', { name: 'Send' }).click();
  await wait(4000);
  await shot('09-megaphone');
  await win.keyboard.press('Escape');
  // manager proposes a change; accept it and see the floor update
  await win.getByRole('button', { name: /Releases|Incidents|Engineering/ }).filter({ hasText: 'Incidents' }).first().click();
  await wait(800);
  await win.locator('#megaphone-input').fill('Add a smoke signal');
  await win.getByRole('button', { name: 'Send' }).click();
  await wait(4000);
  await shot('09b-proposal');
  await win.getByRole('button', { name: /Accept \(write files\)/ }).click();
  await wait(2500);
  await shot('09c-after-accept');
  // dispatch from the intake's work order
  await win.mouse.click(10, 10);
  await win.getByRole('tab', { name: /Ledger/ }).click();
  await wait(2500);
  await shot('10-ledger');
}
console.log('errors:', JSON.stringify(errors.slice(0, 10)));
console.log('out:', out, 'tmp:', tmp);
await app.close();
