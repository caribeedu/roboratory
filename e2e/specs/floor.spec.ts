// The Floor: moving between sectors, moving the camera, and opening the panel of a station.
import { expect, test } from '../support/app';

test.describe('The Floor', () => {
  test.beforeEach(async ({ roboratory }) => { await roboratory.openDemo(); });

  test('shows one sector at a time and changes room when you pick another on the minimap', async ({ roboratory }) => {
    await expect(roboratory.piece('Triage')).toBeVisible();
    await roboratory.goToSector('Incidents');
    await expect(roboratory.piece('Investigate')).toBeVisible();
    await expect(roboratory.piece('Triage')).toHaveCount(0);
    await roboratory.goToSector('Releases');
    await expect(roboratory.piece('Launch')).toBeVisible();
  });

  test('opens the panel of a station when you click it, and closes it with Escape', async ({ window, roboratory }) => {
    await roboratory.openPiece('Triage');
    const panel = roboratory.panel('Triage');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Machine');
    await window.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });

  test('shows what a station is, where its boxes come from and where they go', async ({ roboratory }) => {
    await roboratory.openPiece('Review');
    const panel = roboratory.panel('Review');
    await expect(panel).toContainText('Gate');
    await expect(panel).toContainText('Receives from');
    await expect(panel).toContainText('Sends to');
  });

  test('pans with a two-finger scroll and zooms with a pinch', async ({ window }) => {
    const transform = () => window.evaluate(() => (document.querySelector('.floor-overlay') as HTMLElement).style.transform);
    await expect.poll(transform).not.toBe(''); // the room is fitted once it is drawn
    const start = await transform();
    await window.mouse.move(720, 450);
    for (let i = 0; i < 10; i++) await window.mouse.wheel(12, 30);
    await expect.poll(transform).not.toBe(start);
    const panned = await transform();
    await window.keyboard.down('Control');
    for (let i = 0; i < 10; i++) await window.mouse.wheel(0, -6);
    await window.keyboard.up('Control');
    await expect.poll(transform).not.toBe(panned);
  });

  test('fits the room back into view after you moved it', async ({ window }) => {
    const transform = () => window.evaluate(() => (document.querySelector('.floor-overlay') as HTMLElement).style.transform);
    await expect.poll(transform).not.toBe(''); // the room is fitted once it is drawn
    const start = await transform();
    await window.mouse.move(720, 450);
    for (let i = 0; i < 10; i++) await window.mouse.wheel(40, 40);
    await expect.poll(transform).not.toBe(start);
    await window.getByRole('button', { name: 'Fit the room' }).click();
    await expect.poll(transform).toBe(start);
  });

  test('can be closed right after it opened, over and over, without an error', async ({ window, roboratory, sandbox }) => {
    // the canvas takes a moment to start; leaving before it has is what a hurried person does
    for (let i = 0; i < 6; i++) {
      await window.getByRole('button', { name: 'Close', exact: true }).click();
      await window.getByRole('button', { name: sandbox.demo }).click();
      await expect(window.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    }
    await expect(roboratory.piece('Triage')).toBeVisible();
  });

  test('keeps the keyboard shortcuts: 2 for the Ledger and 1 back to the Floor', async ({ window }) => {
    await window.keyboard.press('2');
    await expect(window.getByRole('tab', { name: /Ledger/ })).toHaveAttribute('aria-selected', 'true');
    await window.keyboard.press('1');
    await expect(window.getByRole('tab', { name: /Floor/ })).toHaveAttribute('aria-selected', 'true');
  });
});
