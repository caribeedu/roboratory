import { defineConfig } from '@playwright/test';

// End-to-end specs drive the packaged app (`npm run package` first). Each test launches it in a sandbox of its own,
// so specs can run side by side; the engine of each test is a process of its own too.
export default defineConfig({
  testDir: 'e2e/specs',
  outputDir: 'e2e/.results',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['github'], ['html', { open: 'never', outputFolder: 'e2e/.report' }]] : [['list']],
});
