// Metrics (D47): how each piece usually behaves, in a tab of its own and in a line of history in the machine's panel.
import { expect, test, patience } from '../support/app';

const LINE = 'engineering/orders-api';

test.describe('Metrics', () => {
  test.beforeEach(async ({ roboratory }) => {
    await roboratory.openDemo();
    await roboratory.run(LINE, { ticket: 'PROJ-812' });
    // the first machine has finished once its box has left it
    await expect.poll(async () => (await roboratory.lineState(LINE))?.pieces.triage?.lastBox !== undefined, { timeout: patience(30_000) }).toBe(true);
  });

  test('shows what the pieces of a line did, in a tab opened with 3', async ({ window, roboratory }) => {
    await window.keyboard.press('3');
    await expect(window.getByRole('tab', { name: /Metrics/ })).toHaveAttribute('aria-selected', 'true');
    const table = window.getByRole('region', { name: 'Metrics of orders-api tickets' });
    await expect(table).toContainText('1 run');
    const triage = table.getByRole('row').filter({ has: window.getByRole('button', { name: 'Triage' }) });
    await expect(triage).toContainText(/[0-9a-f]{8}/);
    await expect(window.getByText(/Costs are estimates made by the agent CLI/)).toBeVisible();
    await roboratory.openFloor();
  });

  test("opens a piece's panel from its row", async ({ window, roboratory }) => {
    await roboratory.page.getByRole('tab', { name: /Metrics/ }).click();
    await window.getByRole('region', { name: 'Metrics of orders-api tickets' }).getByRole('button', { name: 'Triage' }).click();
    await expect(window.getByRole('tab', { name: /Floor/ })).toHaveAttribute('aria-selected', 'true');
    await expect(roboratory.panel('Triage')).toBeVisible();
    await expect(roboratory.panel('Triage')).toContainText(/Usually .* \(1 run\)/, { timeout: patience(15_000) });
  });

  test('narrows by line, and has nothing to show for one that never ran', async ({ window, roboratory }) => {
    await roboratory.page.getByRole('tab', { name: /Metrics/ }).click();
    await window.getByLabel('Line').selectOption('engineering/storefront-ui');
    const table = window.getByRole('region', { name: 'Metrics of storefront-ui tickets' });
    await expect(table).toContainText('0 runs');
    await expect(table).toContainText('No runs yet.');
  });
});
