import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  // ROBORATORY_OUT_DIR builds elsewhere, e.g. to check a change while the app in out/ is open
  ...(process.env.ROBORATORY_OUT_DIR ? { outDir: process.env.ROBORATORY_OUT_DIR } : {}),
  packagerConfig: {
    name: 'Roboratory',
    // icon.icns on macOS, icon.ico on Windows (forge picks the extension)
    icon: 'assets/icon',
    appBundleId: 'app.roboratory',
    asar: true,
    extraResource: ['assets/icon.png'],
  },
  rebuildConfig: {},
  makers: [new MakerZIP({}, ['darwin', 'linux', 'win32'])],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/engine.ts', config: 'vite.engine.config.ts', target: 'main' },
        { entry: 'src/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
  ],
};

export default config;
