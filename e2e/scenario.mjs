// Opens the packaged app on a fresh demo factory and stages a hypothetical busy day.
// Everything uses the simulated agent and local scripts: no real system is touched.
// The window stays open until you close it.
import { appExecutable } from './exe.mjs';
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = path.join(os.homedir(), 'Promptory', 'Scenario');
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
const exe = appExecutable();
const app = await electron.launch({ executablePath: exe, env: { ...process.env, PROMPTORY_USER_DATA: path.join(base, '.app-data'), PROMPTORY_DEMO_DIR: path.join(base, 'Demo Factory') } });
const win = await app.firstWindow();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1200);
await win.getByText('Open the demo factory').click();
await wait(1500);
const run = (line, input) => win.evaluate(([l, i]) => window.promptory.run(l, i), [line, input]).catch(() => {});
// a busy morning, staggered so belts are full
await run('incidents/orders-api', { alert: 'ALT-55102' });
await run('releases/orders-api', { tag: 'v4.18.0' });
const tickets = ['PROJ-812', 'PROJ-815', 'PROJ-820', 'PROJ-901', 'PROJ-904', 'PROJ-910'];
for (let i = 0; i < tickets.length; i++) {
  await run(i % 2 ? 'engineering/storefront-ui' : 'engineering/orders-api', { ticket: tickets[i] });
  await wait(2500);
}
console.log('Scenario staged. The window is yours; close it when you are done.');
app.on('close', () => process.exit(0));
await new Promise(() => {});
