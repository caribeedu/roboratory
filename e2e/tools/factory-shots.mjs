// Opens a simulated copy of a factory in the packaged app and screenshots decision gates,
// return belts and questions. Usage: node e2e/tools/factory-shots.mjs <factory-dir> <out-dir>
import { appExecutable } from './exe.mjs';
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A copy of a factory in which every agent is the simulated one and every signal passes, to take pictures of without spending anything. */
function simulatedCopy(src) {
  src = path.resolve(src);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-shots-'));
  const copy = path.join(tmp, 'factory');
  fs.cpSync(src, copy, { recursive: true, filter: (p) => !p.includes(`${path.sep}.runs`) });
  // lines point at target repositories next to the factory (../repos/<name>), so those come along
  for (const name of ['repos', 'demo-repos']) {
    const repos = path.join(path.dirname(src), name);
    if (fs.existsSync(repos)) fs.cpSync(repos, path.join(tmp, name), { recursive: true });
  }
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(copy)) {
    if (f.endsWith('machine.yaml')) {
      const contract = JSON.parse(fs.readFileSync(path.join(path.dirname(f), 'contract.json'), 'utf8'));
      const props = contract.properties ?? {};
      const sample = (k, s) => (s.enum ? s.enum[0] : s.type === 'array' ? [] : s.type === 'boolean' ? true : s.type === 'integer' || s.type === 'number' ? 1 : s.type === 'object' ? {} : s.pattern ? 'https://github.com/acme-corp/demo/pull/1' : `${k} (simulated)`);
      const out = Object.fromEntries(Object.entries(props).map(([k, s]) => [k, sample(k, s)]));
      const lines = ['schema_version: 1', 'agent: sim', 'attempts: 2', 'sim:', '  seconds: 1'];
      if (props.verdict) lines.push('  outputs:', `    - ${JSON.stringify({ ...out, verdict: 'fail', top_finding: 'simulated finding' })}`, `    - ${JSON.stringify({ ...out, verdict: 'pass' })}`);
      else lines.push(`  output: ${JSON.stringify(out)}`);
      fs.writeFileSync(f, lines.join('\n') + '\n');
    }
    if (f.endsWith('line.yaml')) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/signal: \{ run: "[^"]*"[^}]*\}/g, 'signal: { run: "true" }'));
  }
  for (const f of walk(copy)) if (f.endsWith('sector.yaml') || f.endsWith('factory.yaml')) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/agent: claude/g, 'agent: sim'));
  return copy;
}

const root = simulatedCopy(process.argv[2]);
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
