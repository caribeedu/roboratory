// Checks trackpad gestures (scroll pans, pinch zooms) and megaphone chip layout on the packaged app.
import { appExecutable } from './exe.mjs';
import { _electron as electron } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const out = process.argv[2]; const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-'));
const app = await electron.launch({ executablePath: appExecutable(), env: { ...process.env, ROBORATORY_USER_DATA: path.join(tmp, 'ud'), ROBORATORY_DEMO_DIR: path.join(tmp, 'Demo Factory') } });
const win = await app.firstWindow(); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1200); await win.getByText('Open the demo factory').click(); await wait(1500);
const tf = () => win.evaluate(() => document.querySelector('.floor-overlay').style.transform);
console.log('start', await tf());
await win.mouse.move(720, 450);
for (let i = 0; i < 10; i++) await win.mouse.wheel(12, 30);  // two-finger scroll
await wait(200); console.log('after pan', await tf());
await win.keyboard.down('Control');
for (let i = 0; i < 10; i++) await win.mouse.wheel(0, -6); // pinch out
await win.keyboard.up('Control');
await wait(200); console.log('after pinch', await tf());
await win.screenshot({ path: path.join(out, 'gesture.png') });
// evidence chips in a long answer
await win.evaluate(() => window.roboratory.run('engineering/orders-api', { ticket: 'PROJ-1' }));
await win.evaluate(() => window.roboratory.run('engineering/storefront-ui', { ticket: 'PROJ-2' }));
await wait(30000);
const gap = await win.evaluate(() => { const el = document.querySelector('.radio ol'); return el.scrollHeight - el.scrollTop - el.clientHeight; });
console.log('live log distance from bottom:', gap, gap < 30 ? 'FOLLOWING' : 'NOT FOLLOWING');
await win.locator('#megaphone-input').fill('What needs me right now?');
await win.getByRole('button', { name: 'Send' }).click(); await wait(3500);
await win.screenshot({ path: path.join(out, 'chips.png') });
console.log('title', await app.evaluate(({ app }) => app.getName()));
await app.close();
