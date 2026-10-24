// The managers: you ask, they answer from what is on the floor, and a change they suggest is written only when you accept.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '../support/app';

const LINE_FILE = 'sectors/incidents/models/triage-to-mitigation/line.yaml';

test.describe('Asking a manager', () => {
  test.beforeEach(async ({ roboratory }) => { await roboratory.openDemo(); });

  test('answers a question, with your question above it', async ({ window }) => {
    await window.locator('#megaphone-input').fill('What needs me right now?');
    await window.getByRole('button', { name: 'Send' }).click();
    const conversation = window.getByRole('region', { name: /Conversation with the Engineering Manager/ });
    await expect(conversation.locator('.msg.you')).toHaveText('What needs me right now?');
    await expect(conversation.locator('.msg.mgr:not(.pending)').first()).toBeVisible();
  });

  test('speaks for the sector you are in, and for the whole factory when you switch', async ({ window, roboratory }) => {
    await roboratory.goToSector('Incidents');
    await expect(window.getByRole('textbox', { name: 'Message the Incidents Manager' })).toBeVisible();
    await window.getByTitle('Switch between the Sector Manager and the General Manager').click();
    await expect(window.getByRole('textbox', { name: 'Message the General Manager' })).toBeVisible();
  });
});

test.describe('A manager\'s suggestion', () => {
  test.beforeEach(async ({ roboratory, window }) => {
    await roboratory.openDemo();
    await roboratory.goToSector('Incidents');
    await window.locator('#megaphone-input').fill('Add a smoke signal');
    await window.getByRole('button', { name: 'Send' }).click();
    await expect(window.getByText('Change 1 file')).toBeVisible();
  });

  test('is shown as a diff first, and nothing is written yet', async ({ window, sandbox }) => {
    await expect(window.locator('.diff-path')).toContainText('line.yaml');
    await expect(window.locator('.diff')).toContainText('smoke');
    expect(fs.readFileSync(path.join(sandbox.demo, LINE_FILE), 'utf8')).not.toContain('smoke');
  });

  test('is written when you accept it, and the floor gains the new station', async ({ window, roboratory, sandbox }) => {
    await window.getByRole('button', { name: 'Accept (write files)' }).click();
    await expect(window.getByRole('status').filter({ hasText: 'Files written' })).toBeVisible();
    expect(fs.readFileSync(path.join(sandbox.demo, LINE_FILE), 'utf8')).toContain('smoke');
    await expect(roboratory.piece(/smoke/i)).toBeVisible();
    await expect(window.locator('.proposal')).toContainText('applied');
  });

  test('is left unwritten when you reject it', async ({ window, roboratory, sandbox }) => {
    await window.getByRole('button', { name: 'Reject' }).click();
    await expect(window.locator('.proposal')).toContainText('rejected');
    expect(fs.readFileSync(path.join(sandbox.demo, LINE_FILE), 'utf8')).not.toContain('smoke');
    await expect(roboratory.piece(/smoke/i)).toHaveCount(0);
  });
});

test.describe('The General Manager', () => {
  test('proposes a new sector, which appears on the minimap once you accept', async ({ window, roboratory, sandbox }) => {
    await roboratory.openDemo();
    await window.getByTitle('Switch between the Sector Manager and the General Manager').click();
    await window.locator('#megaphone-input').fill('Build a sector called Support');
    await window.getByRole('button', { name: 'Send' }).click();
    await expect(window.getByText(/^Change \d+ files?$/)).toBeVisible();
    expect(fs.existsSync(path.join(sandbox.demo, 'sectors', 'support'))).toBe(false);
    await window.getByRole('button', { name: 'Accept (write files)' }).click();
    await expect(roboratory.sector('Support')).toBeVisible();
    expect(fs.existsSync(path.join(sandbox.demo, 'sectors', 'support', 'sector.yaml'))).toBe(true);
  });
});
