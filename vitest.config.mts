import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // the Electron wiring and the drawing code run in the packaged app and are checked by the e2e suite
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.ts', 'src/engine.ts', 'src/preload.ts', 'src/renderer.tsx', 'src/vite-env.d.ts', 'src/app/floor/**'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      // a floor, a little under what the suite reaches, so coverage cannot fall without anyone seeing it
      thresholds: { statements: 90, lines: 90, branches: 80, functions: 80 },
    },
    projects: [
      { extends: true, test: { name: 'core', environment: 'node', include: ['src/core/**/*.test.ts', 'src/shared/**/*.test.ts'], testTimeout: 30000 } },
      { extends: true, test: { name: 'app', environment: 'jsdom', include: ['src/app/**/*.test.{ts,tsx}'], setupFiles: ['src/test/ui-setup.ts'] } },
    ],
  },
});
