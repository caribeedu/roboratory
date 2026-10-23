// Draws the Promptory logo as 32×32 pixel art and writes the app icons:
// assets/icon.png (1024), assets/logo-32.png, assets/icon.icns (macOS), assets/icon.ico (Windows).
// The logo: a little factory whose glowing window is a prompt "›_", with smoke from the chimney.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const N = 32;
const px = Array.from({ length: N * N }, () => [0, 0, 0, 0]);
const hex = (h, a = 255) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];
const R = (x, y, w, h, c) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (i >= 0 && j >= 0 && i < N && j < N) px[j * N + i] = c; };

const ink = hex('#120f0c'), night = hex('#1d1813'), night2 = hex('#2a2219'), amber = hex('#f0a845'), amberHi = hex('#ffd27a');
const brick = hex('#8a4f36'), brickHi = hex('#a8643f'), brickDk = hex('#6a3a28'), roof = hex('#d06a3c'), roofHi = hex('#f08a52'), roofDk = hex('#9e4a26');
const glass = hex('#2a2117'), glow = hex('#ffd27a'), smoke = hex('#cfc6b4'), smoke2 = hex('#9e9686'), floor = hex('#4a4037');

// full-bleed warm brown ground, so no corner shows white
R(0, 0, N, N, hex('#3b2918'));
// rounded square plate with an amber rim
R(4, 3, 24, 26, ink); R(3, 4, 26, 24, ink);
R(5, 4, 22, 24, night); R(4, 5, 24, 22, night);
R(5, 4, 22, 1, amber); R(4, 5, 1, 22, amber); R(27, 5, 1, 22, hex('#9b6a2b')); R(5, 27, 22, 1, hex('#9b6a2b'));
R(5, 5, 22, 1, night2);
// floor strip
R(5, 23, 22, 4, floor); R(5, 23, 22, 1, hex('#5a4f44'));
// smoke, drifting right, below the rim
R(23, 7, 2, 1, smoke2); R(21, 6, 2, 2, smoke); R(24, 6, 1, 1, smoke2);
// chimney
R(20, 8, 4, 7, ink); R(21, 8, 2, 6, hex('#7a7368')); R(21, 8, 1, 6, hex('#9a9184')); R(20, 8, 4, 1, hex('#5a544b'));
// sawtooth roof: two teeth rising to the right, each with a lit skylight face
for (const x0 of [6, 13]) {
  for (let i = 0; i < 7; i++) { const h = 1 + Math.floor(i / 2); R(x0 + i, 14 - h, 1, h, roof); R(x0 + i, 14 - h, 1, 1, roofHi); }
  R(x0 + 7, 10, 1, 4, ink); R(x0 + 6, 11, 1, 3, roofDk);
  R(x0 + 7, 11, 1, 3, hex('#ffd27a'));
}
R(6, 14, 20, 1, ink);
// walls
R(6, 15, 20, 9, ink); R(7, 15, 18, 8, brick);
for (let y = 15; y < 23; y += 2) R(7, y, 18, 1, (y / 2) % 2 ? brickHi : brick);
R(7, 22, 18, 1, brickDk);
// the prompt window: › _
R(9, 16, 14, 6, ink); R(10, 17, 12, 4, glass);
R(11, 17, 1, 1, glow); R(12, 18, 1, 1, amberHi); R(11, 19, 1, 1, glow);
R(14, 20, 6, 1, amberHi);
// light spill on the floor
R(10, 24, 12, 1, hex('#6b5a3f'));

function png(scale) {
  const W = N * scale;
  const raw = Buffer.alloc((W * 4 + 1) * W);
  for (let y = 0; y < W; y++) {
    raw[y * (W * 4 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const c = px[Math.floor(y / scale) * N + Math.floor(x / scale)];
      raw.set(c, y * (W * 4 + 1) + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const out = path.resolve('assets');
fs.writeFileSync(path.join(out, 'icon.png'), png(32));
fs.writeFileSync(path.join(out, 'logo-32.png'), png(1));
fs.writeFileSync(path.join(out, 'logo-64.png'), png(2));

// macOS .icns via iconutil
const set = path.join(out, 'icon.iconset');
fs.rmSync(set, { recursive: true, force: true }); fs.mkdirSync(set);
for (const [name, s] of [['16x16', 0.5], ['16x16@2x', 1], ['32x32', 1], ['32x32@2x', 2], ['128x128', 4], ['128x128@2x', 8], ['256x256', 8], ['256x256@2x', 16], ['512x512', 16], ['512x512@2x', 32]]) {
  if (s < 1) { fs.writeFileSync(path.join(set, `icon_${name}.png`), pngHalf()); continue; }
  fs.writeFileSync(path.join(set, `icon_${name}.png`), png(s));
}
function pngHalf() { return png(1).length && downscale16(); }
function downscale16() { // 16px: sample every other pixel
  const keep = px.slice();
  const small = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) small.push(keep[(y * 2) * N + x * 2]);
  const save = px.splice(0, px.length, ...small.concat(Array(N * N - 256).fill([0, 0, 0, 0])));
  const W = 16, raw = Buffer.alloc((W * 4 + 1) * W);
  for (let y = 0; y < W; y++) { raw[y * (W * 4 + 1)] = 0; for (let x = 0; x < W; x++) raw.set(small[y * 16 + x], y * (W * 4 + 1) + 1 + x * 4); }
  px.splice(0, px.length, ...save);
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(out, 'icon.icns')]);
fs.rmSync(set, { recursive: true, force: true });

// Windows .ico with embedded PNGs (16..256)
const sizes = [[16, null], [32, 1], [48, null], [64, 2], [128, 4], [256, 8]].filter(([, s]) => s);
const imgs = sizes.map(([, s]) => png(s));
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(imgs.length, 4);
let offset = 6 + 16 * imgs.length;
const dir = Buffer.concat(sizes.map(([sz], i) => { const e = Buffer.alloc(16); e[0] = sz >= 256 ? 0 : sz; e[1] = sz >= 256 ? 0 : sz; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(imgs[i].length, 8); e.writeUInt32LE(offset, 12); offset += imgs[i].length; return e; }));
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([header, dir, ...imgs]));
console.log('icons written to', out);
