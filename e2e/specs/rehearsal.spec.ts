// The rehearsal in build mode (D48): try a draft before saving it, read what it found on the Floor, answer a finding in the draft and rehearse again.
import fs from 'node:fs';
import path from 'node:path';
import { expect, patience, stopEngine, test, type Sandbox } from '../support/app';

/** A one-machine factory whose simulated agent tries `npm install`, which its list does not cover. */
function factoryFor(sandbox: Sandbox) {
  const root = path.join(sandbox.dir, 'rehearsal-factory');
  const w = (rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  w('factory.yaml', 'name: Rehearsal Factory\n');
  w('sectors/s/sector.yaml', 'name: Shop\n');
  w('sectors/s/lines.yaml', 'lines:\n  - { id: l, name: Orders, model: m }\n');
  w('sectors/s/models/m/line.yaml', 'schema_version: 1\nintake: { kind: manual }\npieces:\n  - { id: build, label: Build, machine: build }\n');
  w('sectors/s/models/m/machines/build/role.md', 'Build.\n');
  w('sectors/s/models/m/machines/build/contract.json', '{"type":"object"}');
  w('sectors/s/models/m/machines/build/machine.yaml', 'schema_version: 1\nagent: sim\nattempts: 1\nsim:\n  seconds: 1\n  requests: ["npm install"]\n  output: { ok: true }\n');
  return root;
}

test.describe('Rehearsing a draft in build mode', () => {
  test.beforeEach(async ({ sandbox, roboratory, window }) => {
    expect(await roboratory.tryOpenAt(factoryFor(sandbox))).toBe('');
    await expect(window.locator('.factory-name')).toHaveText('Rehearsal Factory');
    await window.getByRole('button', { name: 'Build', exact: true }).click();
    await expect(window.locator('.build-badge')).toBeVisible();
    await window.getByRole('button', { name: '⚙ Line' }).click();
    await window.getByRole('button', { name: 'Rehearse', exact: true }).click();
  });
  test.afterEach(({ sandbox }) => { stopEngine(path.join(sandbox.dir, 'rehearsal-factory')); });

  test('shows what will run, with no cost ceiling in the simulation, and finds nothing wrong there', async ({ window }) => {
    const dialog = window.getByRole('dialog', { name: 'Rehearse Orders' });
    await expect(dialog).toContainText('What will run');
    await expect(dialog.getByLabel('Cost ceiling (US$)')).toBeDisabled();
    await expect(dialog.getByLabel('Cost ceiling (US$)')).toHaveValue('free');
    await dialog.getByRole('button', { name: 'Start (free)' }).click();
    await expect(dialog).toContainText('The line reached the pallet.', { timeout: patience(30_000) });
    await expect(dialog).toContainText('No defects');
  });

  test('finds the command no list covers, marks the piece, and answers it in the draft without touching the files', async ({ window, sandbox }) => {
    const dialog = window.getByRole('dialog', { name: 'Rehearse Orders' });
    await dialog.getByLabel('Real with Haiku (spends money)').check();
    await expect(dialog.getByLabel('Cost ceiling (US$)')).toBeEnabled();
    await dialog.getByRole('button', { name: /Start \(spends up to US\$ 1\.00\)/ }).click();
    const finding = dialog.getByRole('list', { name: 'Findings' }).getByRole('listitem').first();
    await expect(finding).toContainText('Asked to run `npm install`, which no list covers.', { timeout: patience(30_000) });
    await expect(finding).toContainText('Look at: allow in machine.yaml of build');

    await finding.getByRole('button', { name: 'Allow it' }).click();
    await expect(finding).toContainText('Added "npm install" to allow. Rehearse again to check.');
    // the draft has it, the files do not, and the piece's version changed, so what was found is marked as out of date
    expect(fs.readFileSync(path.join(sandbox.dir, 'rehearsal-factory/sectors/s/models/m/machines/build/machine.yaml'), 'utf8')).not.toContain('allow');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(window.locator('.piece-label.found-stale', { hasText: 'Build' })).toBeVisible();

    // and rehearsing again finds the command covered
    await window.getByRole('button', { name: 'Rehearse (1)' }).click();
    const again = window.getByRole('dialog', { name: 'Rehearse Orders' });
    await again.getByLabel('Real with Haiku (spends money)').check();
    await again.getByRole('button', { name: /Start \(spends/ }).click();
    await expect(again).toContainText('No defects', { timeout: patience(30_000) });
  });

  test('shows a defect on the piece, in its panel, when the dialog is closed', async ({ window }) => {
    const dialog = window.getByRole('dialog', { name: 'Rehearse Orders' });
    await dialog.getByLabel('Real with Haiku (spends money)').check();
    await dialog.getByRole('button', { name: /Start \(spends/ }).click();
    await expect(dialog.getByRole('list', { name: 'Findings' })).toBeVisible({ timeout: patience(30_000) });
    await dialog.getByRole('button', { name: 'Build' }).click();
    await expect(window.locator('.piece-label.found-defect', { hasText: 'Build' })).toBeVisible();
    await expect(window.getByRole('region', { name: 'Rehearsal' })).toContainText('Asked to run `npm install`');
  });
});
