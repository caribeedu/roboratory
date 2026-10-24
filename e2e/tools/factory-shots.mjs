// Opens a simulated copy of a factory in the packaged app and screenshots decision gates,
// return belts and questions. Usage: node e2e/tools/factory-shots.mjs <factory-dir> <out-dir>
import { appExecutable } from './exe.mjs';
import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = execFileSync('node', ['e2e/tools/factory-sim-check.mjs', process.argv[2], '--prepare-only']).toString().trim();
const out = process.argv[3]; fs.mkdirSync(out, { recursive: true });
const app = await electron.launch({ executablePath: appExecutable(), env: { ...process.env, ROBORATORY_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'ud-')), ROBORATORY_SIM_SPEED: '3' } });
const win = await app.firstWindow();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (n) => win.screenshot({ path: path.join(out, `${n}.png`) });
await wait(1000);
await win.evaluate((r) => window.roboratory.openFactoryAt(r), root);
await wait(1500);
await win.getByRole('button', { name: /Incidents/ }).first().click();
await wait(800);
await win.evaluate(() => window.roboratory.run('incidents/incident-response', { incident: 'INC-1234 checkout 5xx since 14:02 UTC' }));
const until = async (fn, ms = 60000) => { const t0 = Date.now(); while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error('timeout'); await wait(300); } };
const state = (piece) => win.evaluate(async (p) => { const s = await window.roboratory.state(); return s.snapshot.lines['incidents/incident-response'].pieces[p].state; }, piece);
await until(async () => (await state('decision')) === 'holding');
await shot('f1-decision-waiting');
await win.getByRole('button', { name: /Decision is waiting/ }).click();
await wait(800);
await win.getByRole('button', { name: 'hotfix', exact: true }).click();
await win.locator('#decision-note').fill('hotfix in orders-api only');
await shot('f2-decision-panel');

await win.getByRole('button', { name: /Go with hotfix/ }).click();
await win.getByRole('button', { name: /Yes, hotfix/ }).click();
await wait(4000);
await shot('f3-rework-belt');
await until(async () => (await state('ready-gate')) === 'holding', 90000);
await win.keyboard.press('Escape');
await wait(500);
await shot('f4-ready-gate');
await win.mouse.click(10, 10);
const plan = await win.evaluate(() => [...document.querySelectorAll('.piece-label b')].findIndex((b) => b.textContent === 'Verify'));
if (plan >= 0) { const box = await win.locator('.piece-label b').nth(plan).boundingBox(); await win.mouse.click(box.x + box.width / 2, box.y - 30); await wait(800); await win.getByRole('button', { name: /Flow/ }).scrollIntoViewIfNeeded().catch(() => {}); await shot('f5-flow-panel'); }
await app.close();
