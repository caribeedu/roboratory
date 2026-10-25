// A machine asks to run a command outside its list (D44): it turns up in the attention queue, the machine stays at work,
// and you allow it once, refuse it with a reason the agent reads, or answer from the command line.
import fs from 'node:fs';
import path from 'node:path';
import { cliFor, expect, patience, stopEngine, test, type Sandbox } from '../support/app';

const LINE = 's/l';

/** A one-machine factory whose simulated agent tries `npm install`, which its list does not cover. */
function factoryFor(sandbox: Sandbox, o: { deny?: string[] } = {}) {
  const root = path.join(sandbox.dir, 'perm-factory');
  const w = (rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  w('factory.yaml', `name: Perm Factory\n${o.deny ? `deny: [${o.deny.join(', ')}]\n` : ''}`);
  w('sectors/s/sector.yaml', 'name: Shop\n');
  w('sectors/s/lines.yaml', 'lines:\n  - { id: l, name: Orders, model: m }\n');
  w('sectors/s/models/m/line.yaml', 'schema_version: 1\nintake: { kind: manual }\npieces:\n  - { id: build, label: Build, machine: build }\n');
  w('sectors/s/models/m/machines/build/role.md', 'Build.\n');
  w('sectors/s/models/m/machines/build/contract.json', '{"type":"object"}');
  w('sectors/s/models/m/machines/build/machine.yaml', 'schema_version: 1\nagent: sim\nattempts: 1\nsim:\n  seconds: 1\n  requests: ["npm install"]\n  stop_if_denied: true\n  output: { ok: true }\n');
  return root;
}

test.describe('A machine that asks to run a command', () => {
  test.beforeEach(async ({ sandbox, roboratory }) => {
    const root = factoryFor(sandbox);
    expect(await roboratory.tryOpenAt(root)).toBe('');
    await expect(roboratory.page.locator('.factory-name')).toHaveText('Perm Factory');
    await roboratory.run(LINE, {});
  });
  test.afterEach(({ sandbox }) => { stopEngine(path.join(sandbox.dir, 'perm-factory')); });

  test('waits in the attention queue with the command in front of you, and the machine is not on fire', async ({ roboratory }) => {
    const ask = roboratory.attention().getByRole('button', { name: /Build asks to run a command/ });
    await expect(ask).toBeVisible({ timeout: patience(30_000) });
    await expect(ask).toContainText('npm install');
    await expect.poll(() => roboratory.pieceState(LINE, 'build')).toBe('busy');
    await ask.click();
    const card = roboratory.panel('Build').getByRole('form', { name: 'Permission request' });
    await expect(card).toContainText('npm install');
    await expect(card).toContainText('paused until you answer');
  });

  test('goes on when you allow it once, and the Ledger tells it', async ({ window, roboratory }) => {
    await roboratory.attention().getByRole('button', { name: /Build asks to run a command/ }).click({ timeout: patience(30_000) });
    await roboratory.panel('Build').getByRole('button', { name: 'Allow once' }).click();
    await expect(window.getByRole('status').filter({ hasText: 'Allowed, this once' })).toBeVisible();
    await expect(roboratory.attention()).toContainText('All clear', { timeout: patience(30_000) });

    await roboratory.openLedger();
    await expect(window.locator('.run-list .chip').first()).toHaveText('Done', { timeout: patience(30_000) });
    await expect(window.getByRole('heading', { name: 'Who did what' }).locator('xpath=following-sibling::ul[1]')).toContainText('allowed Build to run "npm install"');
  });

  test('stops the machine with your reason when you refuse it, and the reason is what the fire says', async ({ roboratory }) => {
    await roboratory.attention().getByRole('button', { name: /Build asks to run a command/ }).click({ timeout: patience(30_000) });
    const panel = roboratory.panel('Build');
    await panel.getByLabel(/refuse it, with a reason/).fill('Use the cached modules; this line may not install.');
    await panel.getByRole('button', { name: 'Deny' }).click();
    await expect(roboratory.attention().getByRole('button', { name: /Build stopped/ })).toContainText('Use the cached modules; this line may not install.', { timeout: patience(30_000) });
  });

  test('is answered from the command line too, audited as the command', async ({ launched, sandbox, roboratory }) => {
    const cli = cliFor(sandbox, launched.scriptPath, path.join(sandbox.dir, 'perm-factory'));
    await expect(roboratory.attention().getByRole('button', { name: /Build asks to run a command/ })).toBeVisible({ timeout: patience(30_000) });
    const status = cli('status').out;
    const request = /\[request (\w+)\]/.exec(status)?.[1];
    expect(request, status).toBeTruthy();
    expect(cli('deny', request!, '--reason', 'Not from here.').out).toBe('Denied.\n');
    await expect(roboratory.attention().getByRole('button', { name: /Build stopped/ })).toContainText('Not from here.', { timeout: patience(30_000) });
  });
});

test.describe('What the factory never allows', () => {
  test('is refused without asking you', async ({ sandbox, roboratory }) => {
    const root = factoryFor(sandbox, { deny: ['npm install'] });
    try {
      expect(await roboratory.tryOpenAt(root)).toBe('');
      await roboratory.run(LINE, {});
      await expect(roboratory.attention().getByRole('button', { name: /Build stopped/ })).toContainText('Forbidden by this factory', { timeout: patience(30_000) });
      await expect(roboratory.attention().getByRole('button', { name: /asks to run a command/ })).toHaveCount(0);
    } finally { stopEngine(root); }
  });
});
