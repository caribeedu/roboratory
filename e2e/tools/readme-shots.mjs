// Screenshots for the README that need a specific frame: the Floor, a line at work, the Metrics tab, build mode and a rehearsal.
// Usage: node e2e/tools/readme-shots.mjs [out-dir]   (default docs/screenshots)
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appExecutable } from './exe.mjs';

const out = path.resolve(process.argv[2] || 'docs/screenshots');
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-readme-'));
const app = await electron.launch({ executablePath: appExecutable(), env: { ...process.env, ROBORATORY_USER_DATA: path.join(tmp, 'ud'), ROBORATORY_DEMO_DIR: path.join(tmp, 'Demo Factory'), ROBORATORY_SIM_SPEED: '2' } });
const win = await app.firstWindow();
await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1500);
await win.getByText('Open the demo factory').click();
await wait(2500);

// the Floor, calm and busy: a release line with the live log folded and nothing burning
await win.getByText('Live log').first().click().catch(() => {});
await win.getByRole('button', { name: /Releases/ }).first().click();
await wait(800);
await win.evaluate(() => window.roboratory.run('releases/orders-api', { tag: 'v4.18.0' }));
await wait(3300);
await win.screenshot({ path: path.join(out, 'floor-releases.png') });
console.log('wrote floor-releases.png');

// a line at work: an engineering ticket, a few seconds in
await win.getByRole('button', { name: /Engineering/ }).first().click();
await wait(800);
await win.evaluate(() => window.roboratory.run('engineering/orders-api', { ticket: 'PROJ-812' }));
await wait(9000);
await win.screenshot({ path: path.join(out, 'line.png'), clip: { x: 60, y: 274, width: 1200, height: 200 } });
console.log('wrote line.png');

// the Metrics tab over the runs so far
await win.keyboard.press('3');
await wait(1200);
await win.screenshot({ path: path.join(out, 'metrics.png'), clip: { x: 0, y: 46, width: 1440, height: 360 } });
console.log('wrote metrics.png');
await win.keyboard.press('1');
await wait(600);

// build mode on the Floor
await win.getByRole('button', { name: 'Build', exact: true }).click();
await wait(1200);
await win.screenshot({ path: path.join(out, 'build-mode.png') });
console.log('wrote build-mode.png');

// a rehearsal of the engineering line in the draft, in simulation, with its findings
await win.locator('button.mini', { hasText: '⚙ Line' }).first().click();
await win.getByRole('button', { name: 'Rehearse', exact: true }).click();
const dialog = win.getByRole('dialog', { name: /Rehearse/ });
await dialog.getByLabel(/ticket/i).fill('PROJ-812').catch(() => {});
await dialog.getByRole('button', { name: /Start/ }).click();
await dialog.getByText(/The line reached the pallet|stopped|defect/i).first().waitFor({ timeout: 60000 });
await wait(800);
await win.screenshot({ path: path.join(out, 'rehearsal.png') });
console.log('wrote rehearsal.png');
await app.close();
