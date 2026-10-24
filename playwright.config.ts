import { defineConfig } from '@playwright/test';

// End-to-end specs drive the packaged app (`npm run package` first). Each test launches it in a sandbox of its own,
// so specs can run side by side; the engine of each test is a process of its own too.
const ci = !!process.env.CI;
// A Windows runner starts Electron, an engine and Git's `sh` far slower than a laptop, and two apps at once starve each other:
// one worker, and room for each wait. Where the machine is quick these only matter when something is really wrong.
const slowRunner = ci && process.platform === 'win32';

export default defineConfig({
  testDir: 'e2e/specs',
  outputDir: 'e2e/.results',
  timeout: slowRunner ? 240_000 : 120_000,
  expect: { timeout: slowRunner ? 45_000 : 15_000 },
  fullyParallel: true,
  workers: slowRunner ? 1 : ci ? 2 : 3,
  retries: ci ? 1 : 0,
  forbidOnly: ci,
  reporter: ci ? [['list'], ['github'], ['html', { open: 'never', outputFolder: 'e2e/.report' }]] : [['list']],
});
