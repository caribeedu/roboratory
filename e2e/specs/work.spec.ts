// Work on the floor: dispatch a work order, release a gate that waits for you, fight a fire, read it all in the Ledger.
import { expect, test, patience } from '../support/app';

test.describe('Dispatching work', () => {
  test.beforeEach(async ({ roboratory }) => { await roboratory.openDemo(); });

  test('sends a work order from the intake, and says which run it started', async ({ window, roboratory }) => {
    await roboratory.goToSector('Releases');
    await roboratory.openPiece('Release tag');
    const panel = roboratory.panel('Release tag');
    await panel.getByLabel('Tag *').fill('v4.18.0');
    await panel.getByRole('button', { name: 'Dispatch' }).click();
    await expect(window.getByRole('status').filter({ hasText: /dispatched to orders-api releases/ })).toBeVisible();
    await expect.poll(async () => (await roboratory.state()).snapshot.lines['releases/orders-api'].boxes.length > 0 || (await roboratory.state()).snapshot.attention.length > 0).toBe(true);
  });

  test('does not send a work order without its required field', async ({ window, roboratory }) => {
    await roboratory.goToSector('Releases');
    await roboratory.openPiece('Release tag');
    await roboratory.panel('Release tag').getByRole('button', { name: 'Dispatch' }).click();
    await expect(window.getByRole('status').filter({ hasText: /dispatched/ })).toHaveCount(0);
    expect(await roboratory.runs()).toEqual([]);
  });
});

test.describe('A gate that waits for you', () => {
  test.beforeEach(async ({ roboratory }) => {
    await roboratory.openDemo();
    await roboratory.run('releases/orders-api', { tag: 'v4.18.0' });
  });

  test('turns up in the attention queue, and is released with the two confirmations it asks for', async ({ window, roboratory }) => {
    const waiting = roboratory.attention().getByRole('button', { name: /Launch is waiting for you/ });
    await expect(waiting).toBeVisible();
    await waiting.click();
    const panel = roboratory.panel('Launch');
    await expect(panel).toContainText('Waiting for you');

    await panel.getByRole('button', { name: 'Release', exact: true }).click();
    await expect(panel.getByText('Confirmation 1 of 2')).toBeVisible();
    await panel.getByRole('button', { name: 'Yes', exact: true }).click();
    await expect(panel.getByText('Confirmation 2 of 2')).toBeVisible();
    await panel.getByRole('button', { name: 'Yes, release' }).click();

    await expect(window.getByRole('status').filter({ hasText: 'Launch released' })).toBeVisible();
    await expect(roboratory.attention()).toContainText('All clear', { timeout: patience(30_000) });
  });

  test('can be left alone: cancelling a confirmation releases nothing', async ({ roboratory }) => {
    await roboratory.attention().getByRole('button', { name: /Launch is waiting for you/ }).click();
    const panel = roboratory.panel('Launch');
    await panel.getByRole('button', { name: 'Release', exact: true }).click();
    await panel.getByRole('button', { name: 'Cancel' }).click();
    await expect(panel.getByRole('button', { name: 'Release', exact: true })).toBeVisible();
    await expect(roboratory.attention()).toContainText('Launch is waiting for you');
  });

  test('ends with the run on the pallet, and the Ledger tells what happened', async ({ window, roboratory }) => {
    await roboratory.attention().getByRole('button', { name: /Launch is waiting for you/ }).click();
    const panel = roboratory.panel('Launch');
    await panel.getByRole('button', { name: 'Release', exact: true }).click();
    await panel.getByRole('button', { name: 'Yes', exact: true }).click();
    await panel.getByRole('button', { name: 'Yes, release' }).click();

    await roboratory.openLedger();
    await expect(window.locator('.run-list')).toContainText('v4.18.0');
    await expect(window.locator('.run-list .chip').first()).toHaveText('Done', { timeout: patience(45_000) });
    await expect(window.getByRole('heading', { name: 'Who did what' }).locator('xpath=following-sibling::ul[1]')).toContainText('released Launch after 2 confirmations');
    await expect(window.getByRole('heading', { name: 'On the pallet' })).toBeVisible();
  });
});

test.describe('A machine on fire', () => {
  test.beforeEach(async ({ roboratory }) => {
    await roboratory.openDemo();
    await roboratory.run('incidents/orders-api', { alert: 'ALT-55102' });
    await roboratory.goToSector('Incidents');
  });

  test('shows in the attention queue with why it stopped, and the retry carries on with your hint', async ({ window, roboratory }) => {
    const fire = roboratory.attention().getByRole('button', { name: /Investigate stopped/ });
    await expect(fire).toBeVisible();
    await fire.click();
    const panel = roboratory.panel('Investigate');
    await expect(panel.getByRole('heading', { name: 'Why it stopped' })).toBeVisible();
    await expect(panel).toContainText('attempts used');

    await panel.getByLabel('Hint for the retry (optional)').fill('Include suspected_cause from the pool metrics.');
    await panel.getByRole('button', { name: 'Retry with hint' }).click();
    // the "Retrying" toast lasts a few seconds, which a slow runner can poll right past; what the retry does is what counts
    await expect(roboratory.attention().getByRole('button', { name: /Investigate stopped/ })).toHaveCount(0, { timeout: patience(30_000) });
    await expect(roboratory.attention().getByRole('button', { name: /Mitigation OK is waiting for you/ })).toBeVisible({ timeout: patience(30_000) });
  });

  test('halts the line from the panel of the machine that stopped it', async ({ roboratory }) => {
    await roboratory.attention().getByRole('button', { name: /Investigate stopped/ }).click();
    const panel = roboratory.panel('Investigate');
    await panel.getByRole('button', { name: 'Halt line' }).click();
    await expect(panel).toContainText('Line halted');
    await expect(panel.getByRole('button', { name: 'Halt line' })).toHaveCount(0);
    expect((await roboratory.lineState('incidents/orders-api'))?.halted).toBe(true);
  });
});
