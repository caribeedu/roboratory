// Build mode (D41), driven through the window only: build a line from scratch, change a real one with a small diff, and the locks.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test, type Sandbox } from '../support/app';

const panel = (page: Page) => page.locator('.build-insp');

async function field(page: Page, label: string, value: string) {
  const f = panel(page).getByLabel(label, { exact: true });
  await f.fill(value);
  await f.press('Tab');
}

/** Puts a new piece on the belt between two stations, and waits for the panel of the new piece. */
async function insertOn(page: Page, from: string, to: string, kind: string) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: `Add a piece between ${from} and ${to}` }).click();
  await page.getByRole('menuitem', { name: new RegExp(kind, 'i') }).click();
  await expect(panel(page).getByLabel('Name', { exact: true })).toHaveValue(new RegExp(`^${kind}`, 'i'));
}

/** Names the piece whose panel is open, and waits until the floor shows the name. */
async function rename(page: Page, name: string) {
  // The panel re-reads the draft when the engine reloads files that changed on disk, which can land while a field is
  // being typed in; the typing is then lost, as it is meant to be. A person types again, so the test does too.
  await expect(async () => {
    await field(page, 'Name', name);
    await expect(page.locator('.piece-label', { hasText: name }).first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}

async function startBuilding(page: Page) {
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await expect(page.locator('.build-badge')).toBeVisible();
}

const finish = async (page: Page) => {
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Save the files' }).click();
  await expect(page.locator('.build-badge')).toHaveCount(0);
};

test.describe('Building a line from scratch', () => {
  test('makes a sector, a line with a machine, a signal and a decision gate that sends work back, and saves it all', async ({ window, roboratory, sandbox }) => {
    await roboratory.openDemo();
    await startBuilding(window);

    await window.getByRole('button', { name: '+ Sector' }).click();
    await panel(window).getByLabel('New sector name').fill('Operations');
    await panel(window).getByRole('button', { name: 'Create the sector' }).click();
    await expect.poll(() => fs.existsSync(path.join(sandbox.demo, 'sectors/operations/sector.yaml'))).toBe(true);

    await window.getByRole('button', { name: '+ Line' }).click();
    await panel(window).getByLabel('New line name').fill('Deploy');
    await panel(window).getByText('a new model').click();
    await panel(window).getByLabel('New model name').fill('deploy');
    await panel(window).getByRole('button', { name: 'Add the line' }).click();

    // intake → machine → signal → gate → pallet; the gate sends "revise" back to the machine
    await insertOn(window, '@intake', '@pallet', 'Machine');
    await rename(window, 'Deployer');
    await panel(window).getByLabel('Agent').selectOption('sim');
    await insertOn(window, 'machine', '@pallet', 'Signal');
    await rename(window, 'Smoke');
    await insertOn(window, 'signal', '@pallet', 'Gate');
    await rename(window, 'Ship?');
    await panel(window).getByText('when you choose').click();
    await field(window, 'Choices', 'ship, revise');

    await panel(window).locator('li', { hasText: '"Ship?" → "Delivered"' }).getByRole('button', { name: 'Add rule' }).click();
    await panel(window).locator('.rule-builder').getByLabel('Field').selectOption('decision.choice');
    await panel(window).locator('.rule-builder').getByLabel('Value').selectOption('ship');
    await panel(window).getByRole('button', { name: 'Save rule' }).click();

    await window.getByRole('button', { name: 'Fit the room' }).click();
    await panel(window).getByRole('button', { name: 'Connect to…' }).click();
    const box = await roboratory.piece('Deployer').boundingBox();
    await window.mouse.click(box!.x + box!.width / 2, box!.y + 2);
    await expect(window.locator('.piece-label.broken', { hasText: 'Deployer' })).toHaveCount(1); // a return belt with no rule yet

    await panel(window).locator('li', { hasText: 'Back from "Ship?"' }).getByRole('button', { name: 'Add rule' }).click();
    await panel(window).locator('.rule-builder').getByLabel('Field').selectOption('decision.choice');
    await panel(window).locator('.rule-builder').getByLabel('Value').selectOption('revise');
    await panel(window).getByRole('button', { name: 'Save rule' }).click();
    await expect(window.locator('.piece-label.broken')).toHaveCount(0);

    await finish(window);
    const deploy = fs.readFileSync(path.join(sandbox.demo, 'sectors/operations/models/deploy/line.yaml'), 'utf8');
    expect(deploy).toMatch(/machine: machine/);
    expect(deploy).toMatch(/back: true/);
    await expect.poll(() => dryRun(sandbox, 'operations')).toMatch(/OK +operations\/deploy: done/);
  });
});

/** Runs the saved sector through the engine with simulated agents; only that sector, as the demo's other lines point at repositories beside the factory. */
function dryRun(sandbox: Sandbox, sector: string) {
  const only = path.join(sandbox.dir, `only-${sector}`);
  if (!fs.existsSync(only)) {
    fs.cpSync(sandbox.demo, only, { recursive: true, filter: (p) => !p.includes(`${path.sep}.runs`) });
    for (const s of fs.readdirSync(path.join(only, 'sectors'))) if (s !== sector) fs.rmSync(path.join(only, 'sectors', s), { recursive: true });
  }
  try { return execFileSync(process.execPath, ['e2e/tools/factory-sim-check.mjs', only], { encoding: 'utf8', windowsHide: true, timeout: 120_000 }); } catch (e) { return String((e as { stdout?: string }).stdout ?? e); }
}

test.describe('Changing a line that exists', () => {
  const lineFile = (sandbox: Sandbox) => path.join(sandbox.demo, 'sectors/incidents/models/triage-to-mitigation/line.yaml');

  test('adds a signal with the smallest diff, keeps the comments, and undo brings back what you removed', async ({ window, roboratory, sandbox }) => {
    await roboratory.openDemo();
    const original = `# Alert to mitigation: correlate, investigate, gate, mitigate, verify.\n${fs.readFileSync(lineFile(sandbox), 'utf8').replace('  - id: mitigate\n', '  # the fix itself\n  - id: mitigate\n')}`;
    fs.writeFileSync(lineFile(sandbox), original);
    await roboratory.goToSector('Incidents');
    await expect(roboratory.piece('Mitigate')).toBeVisible();
    await startBuilding(window);

    await insertOn(window, 'mitigate', 'error-rate', 'Signal');
    await rename(window, 'Smoke test');
    await window.keyboard.press('Escape');

    // removing "investigate" leaves the belts around it red; undo puts it back
    await roboratory.openPiece('Investigate');
    await panel(window).getByRole('button', { name: /Remove this machine/ }).click();
    await expect(window.locator('.piece-label.broken').first()).toBeVisible();
    await window.keyboard.press('ControlOrMeta+z');
    await expect(window.locator('.piece-label.broken')).toHaveCount(0);
    await expect(roboratory.piece('Investigate')).toBeVisible();

    await finish(window);
    const saved = fs.readFileSync(lineFile(sandbox), 'utf8');
    const added = saved.split('\n').filter((l) => !original.split('\n').includes(l));
    const lost = original.split('\n').filter((l) => !saved.split('\n').includes(l));
    expect(saved.startsWith('# Alert to mitigation')).toBe(true);
    expect(saved).toContain('  # the fix itself\n');
    expect(lost).toEqual([]);
    expect(added).toHaveLength(3);
    for (const l of added) expect(l).toMatch(/id: signal|label: Smoke test|signal: \{ run: "true" \}/);
  });
});

test.describe('Saving while a run is going', () => {
  test('is blocked, shows a file changed on disk as a conflict, and discarding leaves the files as they were', async ({ window, roboratory, sandbox }) => {
    await roboratory.openDemo();
    const role = 'sectors/incidents/models/triage-to-mitigation/machines/mitigator/role.md';
    const before = fs.readFileSync(path.join(sandbox.demo, role), 'utf8');
    await roboratory.run('incidents/orders-api', { alert: 'ALT-1' });
    await roboratory.goToSector('Incidents');
    await startBuilding(window);
    await insertOn(window, 'mitigate', 'error-rate', 'Gate');
    await roboratory.buildDraftFile(role, 'Draft role.\n');
    fs.writeFileSync(path.join(sandbox.demo, role), 'Changed on disk.\n');

    await window.getByRole('button', { name: 'Done' }).click();
    await expect(window.locator('.save-dialog .blocked', { hasText: 'run in progress' })).toHaveCount(1);
    await expect(window.locator('.save-dialog .conflicts', { hasText: 'mitigator/role.md' })).toHaveCount(1);
    await expect(window.getByRole('button', { name: 'Save the files' })).toBeDisabled();

    await window.getByRole('button', { name: 'Discard everything' }).click();
    await window.getByRole('button', { name: 'Yes, discard' }).click();
    await expect(window.locator('.build-badge')).toHaveCount(0);
    expect(fs.readFileSync(path.join(sandbox.demo, role), 'utf8')).toBe('Changed on disk.\n'); // the disk change is the person's own; the draft left no trace
    expect(before).not.toBe('Changed on disk.\n');
  });
});
