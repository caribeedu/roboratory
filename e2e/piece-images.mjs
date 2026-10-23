// Draws one picture per piece (machine, belt, box...) with the app's own sprites, for the README.
// Usage: node e2e/piece-images.mjs [out-dir]   (needs the packaged app; default out-dir is docs/pieces)
import { _electron as electron } from 'playwright';
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appExecutable } from './exe.mjs';

const out = path.resolve(process.argv[2] || 'docs/pieces');
fs.mkdirSync(out, { recursive: true });

const bundle = await build({ entryPoints: ['src/app/floor/sprites.ts'], bundle: true, format: 'iife', globalName: 'Sprites', write: false, platform: 'browser' });
const code = bundle.outputFiles[0].text;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-pieces-'));
const app = await electron.launch({ executablePath: appExecutable(), env: { ...process.env, ROBORATORY_USER_DATA: path.join(tmp, 'ud') } });
const win = await app.firstWindow();

const images = await win.evaluate((src) => {
  const S = (0, eval)(src + '\n;Sprites');
  const SCALE = 6;
  const BLUE = '#4a7fbf', RED = '#c9473a', GREEN = '#8bd06b', AMBER = '#f0a845';

  // A picture: the app's floor tiles behind some sprites placed at texel positions.
  function picture(w, h, parts, opts = {}) {
    const base = S.canvas(w, h, (g) => {
      if (opts.floor !== false) S.drawFloor(g, 0, 0, w, h);
      for (const [c, x, y] of parts) g.drawImage(c, x, y);
    });
    const big = document.createElement('canvas');
    big.width = w * SCALE; big.height = h * SCALE;
    const g = big.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(base, 0, 0, w * SCALE, h * SCALE);
    return big.toDataURL('image/png');
  }
  const sprite = (w, h, fn) => S.canvas(w, h, fn);
  const machine = (roof, fire) => sprite(56, 52, (g) => S.drawMachine(g, roof, { glow: !fire, fire, lamp: S.PAL.ok, frame: 0 }));
  const worker = (roof) => sprite(10, 18, (g) => S.drawWorker(g, roof, 0));
  const belt = (n) => sprite(n * 8, 12, (g) => { const t = sprite(8, 12, S.drawBeltTile); for (let i = 0; i < n; i++) g.drawImage(t, i * 8, 0); });
  const box = (c) => sprite(10, 10, (g) => S.drawBox(g, c));
  const intake = () => sprite(40, 40, (g) => S.drawIntake(g, 'manual', BLUE));
  const signal = (lamp) => sprite(22, 40, (g) => S.drawSignal(g, lamp, false));
  const gate = () => sprite(40, 36, (g) => S.drawGate(g, true, true));
  const balloon = () => sprite(14, 18, (g) => S.drawBalloon(g, '#c9473a'));
  const pallet = () => sprite(44, 20, S.drawPallet);
  const manager = (tie, pose) => sprite(16, 26, (g) => S.drawManager(g, tie, pose, 0));
  const think = () => sprite(18, 12, (g) => S.drawThink(g, 0));
  const room = (w, h, accent) => sprite(w, h, (g) => {
    S.drawFloor(g, 0, 0, w, h);
    const wall = sprite(w, 34, (c) => S.drawBackWall(c, w, 34, accent));
    g.drawImage(wall, 0, 0);
  });

  const result = {};
  result.machine = picture(76, 64, [[machine('#5aa85a', false), 12, 6], [worker('#5aa85a'), 2, 36]]);
  result.belt = picture(72, 30, [[belt(9), 0, 9], [box(GREEN), 30, 5]]);
  result.box = picture(26, 24, [[box(GREEN), 8, 7]]);
  result.pallet = picture(60, 40, [[pallet(), 8, 18], [box(GREEN), 12, 9], [box(AMBER), 23, 9], [box('#6aa7e0'), 34, 9], [box(GREEN), 17, 2], [box(AMBER), 28, 2]]);
  result.signal = picture(38, 48, [[signal(S.PAL.ok), 8, 4]]);
  result.gate = picture(58, 60, [[gate(), 9, 20], [balloon(), 22, 0]]);
  result['sector-manager'] = picture(34, 40, [[manager(BLUE, 'idle'), 9, 9]]);
  result['general-manager'] = picture(34, 40, [[manager(AMBER, 'think'), 9, 11], [think(), 8, 0]]);
  result.sector = picture(110, 78, [[room(98, 70, BLUE), 6, 4], [machine('#5aa85a', false), 20, 16], [manager(BLUE, 'idle'), 80, 34]]);
  const rooms = [[BLUE, '#5aa85a'], [RED, '#8a5d9b'], [GREEN, '#e0a43a']];
  result.factory = picture(184, 64, rooms.flatMap(([accent, roof], i) => {
    const x = 4 + i * 59;
    return [[room(56, 56, accent), x, 4], [belt(5), x + 8, 46], [box(AMBER), x + 22, 42], [worker(roof), x + 40, 32]];
  }));
  result['production-line'] = picture(236, 66, [
    [belt(28), 8, 36], [intake(), 4, 10], [machine('#5aa85a', false), 50, 4], [signal(S.PAL.ok), 112, 12], [gate(), 138, 18], [pallet(), 186, 32],
    [box(AMBER), 38, 36], [box(AMBER), 106, 36], [box(GREEN), 176, 36],
  ]);
  return result;
}, code);

for (const [name, dataUrl] of Object.entries(images)) {
  fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote', `${name}.png`);
}
await app.close();
