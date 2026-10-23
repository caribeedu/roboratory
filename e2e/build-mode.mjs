// v0.7 exit criteria for build mode (D41), driven through the packaged app's UI only.
//  1. Build a sector and a line from scratch: a machine, a decision gate, a return belt and a signal;
//     save, and dry-run the saved line to its pallet with the simulated agent.
//  2. Edit a real line (insert, connect, rule, remove leaving a red belt, undo) and save a minimal
//     diff that keeps the YAML comments.
//  3. Saving is blocked while the line runs, and a file changed on disk shows as a conflict.
// Usage: node e2e/build-mode.mjs [out-dir]   (honours PROMPTORY_OUT_DIR)
import { appExecutable } from './exe.mjs';
import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'build-shots-'));
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'promptory-build-e2e-'));
const root = path.join(tmp, 'Demo Factory');
const exe = appExecutable();
const app = await electron.launch({ executablePath: exe, env: { ...process.env, PROMPTORY_USER_DATA: path.join(tmp, 'ud'), PROMPTORY_DEMO_DIR: root, PROMPTORY_SIM_SPEED: '1' } });
const win = await app.firstWindow();
await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
const errors = [];
win.on('pageerror', (e) => errors.push(String(e)));
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (n) => win.screenshot({ path: path.join(out, `${n}.png`) });
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const panel = () => win.locator('.build-insp');
const field = async (label, value) => { const f = panel().getByLabel(label, { exact: true }); await f.fill(value); await f.press('Tab'); await wait(250); };
const insertOn = async (from, to, kind) => { await win.keyboard.press('Escape'); await win.keyboard.press('Escape'); await wait(200); await win.getByRole('button', { name: `Add a piece between ${from} and ${to}` }).click(); await win.getByRole('menuitem', { name: new RegExp(kind, 'i') }).click(); await wait(500); };
const pieceIds = (lineFile) => fs.readFileSync(lineFile, 'utf8');

await wait(1500);
await win.getByText('Open the demo factory').click();
await wait(2500);

// ---------- criterion 1: a sector and a line from scratch ----------
await win.getByRole('button', { name: 'Build', exact: true }).click();
await wait(500);
await win.getByRole('button', { name: '+ Sector' }).click();
await panel().getByLabel('New sector name').fill('Operations');
await panel().getByRole('button', { name: 'Create the sector' }).click();
await wait(1200);
check(fs.existsSync(path.join(root, 'sectors/operations/sector.yaml')), 'a new sector is created and saved');
await win.getByRole('button', { name: '+ Line' }).click();
await panel().getByLabel('New line name').fill('Deploy');
await panel().getByText('a new model').click();
await panel().getByLabel('New model name').fill('deploy');
await panel().getByRole('button', { name: 'Add the line' }).click();
await wait(800);
// intake -> machine -> signal -> gate -> pallet, gate sends "revise" back to the machine
await insertOn('@intake', '@pallet', 'Machine');
await field('Name', 'Deployer');
await panel().getByLabel('Agent').selectOption('sim');
await wait(300);
await insertOn('machine', '@pallet', 'Signal');
await field('Name', 'Smoke');
await insertOn('signal', '@pallet', 'Gate');
await field('Name', 'Ship?');
await panel().getByText('when you choose').click();
await wait(400);
await field('Choices', 'ship, revise');
// belt gate -> pallet: only "ship"
await panel().locator('li', { hasText: '"Ship?" → "Delivered"' }).getByRole('button', { name: 'Add rule' }).click();
await panel().locator('.rule-builder').getByLabel('Field').selectOption('decision.choice');
await panel().locator('.rule-builder').getByLabel('Value').selectOption('ship');
await panel().getByRole('button', { name: 'Save rule' }).click();
await wait(400);
// return belt gate -> machine on "revise"
await win.getByRole('button', { name: 'Fit the room' }).click();
await panel().getByRole('button', { name: 'Connect to…' }).click();
await wait(300);
await shot('c1-connect-mode');
const machineLabel = win.locator('.piece-label', { hasText: 'Deployer' });
const box = await machineLabel.boundingBox();
await win.mouse.click(box.x + box.width / 2, box.y + 2);
await wait(800);
check(await win.locator('.piece-label.broken', { hasText: 'Deployer' }).count() === 1, 'a return belt without a rule is marked red');
await panel().locator('li', { hasText: 'Back from "Ship?"' }).getByRole('button', { name: 'Add rule' }).click();
await panel().locator('.rule-builder').getByLabel('Field').selectOption('decision.choice');
await panel().locator('.rule-builder').getByLabel('Value').selectOption('revise');
await panel().getByRole('button', { name: 'Save rule' }).click();
await wait(600);
await shot('c1-line-built');
check(await win.locator('.piece-label.broken').count() === 0, 'the built line has no broken piece');
await win.getByRole('button', { name: 'Done' }).click();
await wait(500);
await shot('c1-save-dialog');
await win.getByRole('button', { name: 'Save the files' }).click();
await wait(1500);
const deploy = path.join(root, 'sectors/operations/models/deploy/line.yaml');
check(fs.existsSync(deploy) && /machine: machine/.test(pieceIds(deploy)) && /back: true/.test(pieceIds(deploy)), 'the new line is saved with its machine and return belt');
// dry run the saved factory with the simulated agent
// (only the new sector: the demo's other lines point at repositories outside the factory folder)
const only = path.join(tmp, 'only-operations');
fs.cpSync(root, only, { recursive: true, filter: (p) => !p.includes(`${path.sep}.runs`) });
for (const sdir of fs.readdirSync(path.join(only, 'sectors'))) if (sdir !== 'operations') fs.rmSync(path.join(only, 'sectors', sdir), { recursive: true });
let dry = '';
try { dry = execFileSync('node', ['e2e/factory-sim-check.mjs', only], { encoding: 'utf8' }); } catch (e) { dry = String(e.stdout ?? e); }
check(/OK +operations\/deploy: done/.test(dry), `the new line reaches its pallet in a simulated run (${(/operations\/deploy.*/.exec(dry) ?? ['missing'])[0]})`);

// ---------- criterion 2: edit a real line, minimal diff, comments kept ----------
const tri = path.join(root, 'sectors/incidents/models/triage-to-mitigation/line.yaml');
const original = `# Alert to mitigation: correlate, investigate, gate, mitigate, verify.\n${fs.readFileSync(tri, 'utf8').replace('  - id: mitigate\n', '  # the fix itself\n  - id: mitigate\n')}`;
fs.writeFileSync(tri, original);
await wait(800);
await win.locator('.minimap').getByText('Incidents').click();
await wait(1200);
await win.getByRole('button', { name: 'Build', exact: true }).click();
await wait(600);
await insertOn('mitigate', 'error-rate', 'Signal');
await field('Name', 'Smoke test');
await win.keyboard.press('Escape');
await wait(300);
// remove "investigate": the gate after it turns red, then undo brings it back
const inv = await win.locator('.piece-label', { hasText: 'Investigate' }).boundingBox();
await win.mouse.click(inv.x + inv.width / 2, inv.y + 2);
await wait(500);
await panel().getByRole('button', { name: /Remove this machine/ }).click();
await wait(700);
check(await win.locator('.piece-label.broken').count() > 0, 'removing a piece leaves its belts red');
await shot('c2-removed-red');
await win.keyboard.press('Meta+z');
await wait(700);
check(await win.locator('.piece-label.broken').count() === 0 && await win.locator('.piece-label', { hasText: 'Investigate' }).count() === 1, 'undo brings the piece back');
await win.getByRole('button', { name: 'Done' }).click();
await wait(400);
await win.getByRole('button', { name: 'Save the files' }).click();
await wait(1200);
const saved = fs.readFileSync(tri, 'utf8');
const added = saved.split('\n').filter((l) => !original.split('\n').includes(l));
const lost = original.split('\n').filter((l) => !saved.split('\n').includes(l));
check(saved.startsWith('# Alert to mitigation') && saved.includes('  # the fix itself\n'), 'comments are kept');
check(lost.length === 0 && added.length === 3 && added.every((l) => /id: signal|label: Smoke test|signal: \{ run: "true" \}/.test(l)), `the diff only adds the new signal (${added.length} lines added: ${added.map((l) => l.trim()).join(' | ')}; ${lost.length} lost)`);

// ---------- criterion 3: locks, from the UI ----------
await win.evaluate(() => window.promptory.run('incidents/orders-api', { alert: 'ALT-1' }));
await wait(500);
await win.getByRole('button', { name: 'Build', exact: true }).click();
await wait(500);
await insertOn('mitigate', 'signal', 'Gate');
const role = path.join(root, 'sectors/incidents/models/triage-to-mitigation/machines/mitigator/role.md');
await win.evaluate((p) => window.promptory.buildApply({ op: 'writeFile', path: p, content: 'Draft role.\n' }), 'sectors/incidents/models/triage-to-mitigation/machines/mitigator/role.md');
fs.writeFileSync(role, 'Changed on disk.\n');
await wait(800);
await win.getByRole('button', { name: 'Done' }).click();
await wait(500);
await shot('c3-blocked');
check(await win.locator('.save-dialog .blocked', { hasText: 'run in progress' }).count() === 1, 'saving is blocked while the line runs');
check(await win.locator('.save-dialog .conflicts', { hasText: 'mitigator/role.md' }).count() === 1, 'a file changed on disk shows as a conflict');
check(await win.getByRole('button', { name: 'Save the files' }).isDisabled(), 'the save button is disabled');
await win.getByRole('button', { name: 'Discard everything' }).click();
await win.getByRole('button', { name: 'Yes, discard' }).click();
await wait(500);

check(errors.length === 0, `no errors in the page${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await app.close();
console.log(`shots: ${out}`);
process.exit(failures ? 1 : 0);
