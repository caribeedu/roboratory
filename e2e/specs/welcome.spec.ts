// Starting the app: the welcome screen, the demo factory, and coming back to a factory you had open.
import fs from 'node:fs';
import path from 'node:path';
import { expect, launch, quit, Roboratory, stopEngine, test } from '../support/app';

test.describe('Starting the app', () => {
  test('shows the welcome screen with the demo and your own folder as the two ways in', async ({ window }) => {
    await expect(window.getByRole('heading', { name: 'Roboratory' })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Open the demo factory' })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Open a factory folder…' })).toBeVisible();
    await expect(window.getByText(/costs nothing and runs offline/)).toBeVisible();
    await expect(window.getByText('Recent factories')).toHaveCount(0);
  });

  test('opens the demo factory onto its first sector, with nothing waiting for you', async ({ window, roboratory }) => {
    await roboratory.openDemo();
    for (const name of ['Engineering', 'Incidents', 'Releases']) await expect(roboratory.sector(name)).toBeVisible();
    await expect(roboratory.sector('Engineering')).toHaveAttribute('aria-current', 'true');
    await expect(roboratory.attention()).toContainText('All clear');
    await expect(window.getByRole('tab', { name: /Floor/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('draws the floor: a canvas with something on it, not a blank room', async ({ window, roboratory }) => {
    await roboratory.openDemo();
    const canvas = window.locator('canvas').first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box!.width).toBeGreaterThan(400);
    // a blank dark canvas compresses to almost nothing; a drawn room does not
    const png = await canvas.screenshot();
    expect(png.length).toBeGreaterThan(20_000);
  });

  test('puts a closed factory under Recent, and reopens it from there', async ({ window, roboratory, sandbox }) => {
    await roboratory.openDemo();
    await window.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(window.getByRole('button', { name: 'Open the demo factory' })).toBeVisible();
    await expect(window.getByText('Recent factories')).toBeVisible();
    await window.getByRole('button', { name: sandbox.demo }).click();
    await expect(window.locator('.factory-name')).toHaveText('Demo Factory');
  });

  test('refuses a folder that is not a factory, and stays on the welcome screen', async ({ window, roboratory, sandbox }) => {
    const folder = path.join(sandbox.dir, 'not-a-factory');
    fs.mkdirSync(folder);
    expect(await roboratory.tryOpenAt(folder)).toContain('is not a Roboratory factory');
    await expect(window.getByRole('button', { name: 'Open the demo factory' })).toBeVisible();
  });
});

test.describe('Coming back', () => {
  test('reopens the factory you had open when the app starts again', async ({ sandbox }) => {
    const first = await launch(sandbox);
    await new Roboratory(first.window).openDemo();
    await quit(first.app);

    const second = await launch(sandbox);
    try {
      await expect(second.window.locator('.factory-name')).toHaveText('Demo Factory');
      await expect(second.window.getByRole('button', { name: 'Open the demo factory' })).toHaveCount(0);
    } finally {
      await quit(second.app);
      stopEngine(sandbox.demo);
    }
  });

  test('starts on the welcome screen when the factory you had open is gone', async ({ sandbox }) => {
    const first = await launch(sandbox);
    await new Roboratory(first.window).openDemo();
    await quit(first.app);
    stopEngine(sandbox.demo);
    fs.rmSync(sandbox.demo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });

    const second = await launch(sandbox);
    try {
      await expect(second.window.getByRole('button', { name: 'Open the demo factory' })).toBeVisible();
    } finally { await quit(second.app); }
  });
});

