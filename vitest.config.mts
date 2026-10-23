import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    projects: [
      { extends: true, test: { name: 'core', environment: 'node', include: ['src/core/**/*.test.ts', 'src/shared/**/*.test.ts'], testTimeout: 30000 } },
      { extends: true, test: { name: 'app', environment: 'jsdom', include: ['src/app/**/*.test.{ts,tsx}'] } },
    ],
  },
});
