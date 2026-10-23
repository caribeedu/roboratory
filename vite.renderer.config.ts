import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite tags module scripts with `crossorigin`. Under Electron `loadFile`
 * (file://) Chromium treats that as a CORS fetch with nobody to answer, and the
 * window stays blank. Strip it.
 */
function stripCrossOrigin(): Plugin {
  return {
    name: 'roboratory-strip-crossorigin',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/(\s)crossorigin(="[^"]*")?/g, '');
    },
  };
}

// https://vitejs.dev/config
export default defineConfig({
  base: './',
  plugins: [react(), stripCrossOrigin()],
  build: { modulePreload: { polyfill: false } },
});
