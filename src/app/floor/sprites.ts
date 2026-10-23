// Procedural pixel art. Every sprite is drawn once on a canvas at 1 texel per
// pixel and scaled with nearest-neighbour filtering. Light comes from the
// top-left; every object has a 1px dark outline and a soft floor shadow.

export const PAL = {
  ink: '#120f0c',
  shadow: 'rgba(10,8,6,0.38)',
  floorA: '#4a4037', floorB: '#453b32', floorC: '#50463c', grout: '#352d26', floorHi: '#5a4f44',
  brick: '#6e4636', brickDark: '#5a382b', brickHi: '#82543f', mortar: '#3b2a22',
  beam: '#4b3220', beamHi: '#6a4a30', beamDark: '#2e1f14',
  glass: '#22324a', glassHi: '#3c5677', moon: '#cfe0ff',
  steel: '#6c6f73', steelHi: '#9a9da1', steelDark: '#45474a',
  wood: '#8a5d34', woodHi: '#ad7a48', woodDark: '#5f3e22',
  kraft: '#c39a62', kraftHi: '#ddb67e', kraftDark: '#8f6c40', tape: '#e8d6a8',
  paper: '#efe6cf', paperDark: '#c9bd9f',
  lamp: '#ffd27a', lampHot: '#fff1c4', amber: '#f0a845',
  ok: '#8bd06b', okDark: '#4f8a3b', warn: '#f2c14e', fail: '#ef5a3c', failDark: '#9b2f1e',
  skin: '#e8b98f', skinDark: '#c48f66', hair: '#3b2a1e', suit: '#2f3644', suitHi: '#46506a', shirt: '#e9e2d0',
  rubber: '#2a2523', rubberHi: '#3c3532', rail: '#7b7f84', railDark: '#4c4f53', stripeY: '#e3b53e',
};

export type Draw = (g: CanvasRenderingContext2D) => void;
export function canvas(w: number, h: number, draw: Draw): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  draw(g);
  return c;
}
export const R = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
const P = (g: CanvasRenderingContext2D, x: number, y: number, c: string) => R(g, x, y, 1, 1, c);

export function hash(x: number, y: number) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }

export function shade(color: string, f: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(color);
  let r = 128, g = 128, b = 128;
  if (m) { const n = parseInt(m[1], 16); r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255; }
  else { const h = /hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/.exec(color); if (h) [r, g, b] = hslToRgb(+h[1], +h[2] / 100, +h[3] / 100); }
  const k = (v: number) => Math.max(0, Math.min(255, Math.round(f > 1 ? v + (255 - v) * (f - 1) : v * f)));
  return `rgb(${k(r)},${k(g)},${k(b)})`;
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
export function hueColor(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 48% 52%)`; }

// ---------- room ----------

/** Floor: worn stone tiles with grout, stains and the odd crack. */
export function drawFloor(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number) {
  const T = 16;
  for (let ty = 0; ty < h; ty += T) for (let tx = 0; tx < w; tx += T) {
    const v = hash(tx + 7, ty + 3);
    const base = v < 0.33 ? PAL.floorA : v < 0.7 ? PAL.floorB : PAL.floorC;
    R(g, x0 + tx, y0 + ty, T, T, base);
    R(g, x0 + tx, y0 + ty, T, 1, PAL.floorHi);
    R(g, x0 + tx, y0 + ty, 1, T, PAL.floorHi);
    R(g, x0 + tx, y0 + ty + T - 1, T, 1, PAL.grout);
    R(g, x0 + tx + T - 1, y0 + ty, 1, T, PAL.grout);
    for (let i = 0; i < 5; i++) { const a = hash(tx * 3 + i, ty * 5 + i); P(g, x0 + tx + 2 + Math.floor(a * 12), y0 + ty + 2 + Math.floor(hash(i, tx + ty) * 12), a > 0.5 ? shade(base, 1.08) : shade(base, 0.9)); }
    if (v > 0.93) { R(g, x0 + tx + 4, y0 + ty + 6, 6, 3, 'rgba(20,14,10,0.22)'); R(g, x0 + tx + 6, y0 + ty + 5, 3, 5, 'rgba(20,14,10,0.18)'); }
    if (v > 0.86 && v < 0.89) { P(g, x0 + tx + 5, y0 + ty + 4, PAL.grout); P(g, x0 + tx + 6, y0 + ty + 5, PAL.grout); P(g, x0 + tx + 6, y0 + ty + 6, PAL.grout); P(g, x0 + tx + 7, y0 + ty + 7, PAL.grout); }
  }
}

/** Back wall: brick with timber beams, tall night windows and hanging lamps. */
export function drawBackWall(g: CanvasRenderingContext2D, w: number, h: number, accent: string) {
  R(g, 0, 0, w, h, PAL.mortar);
  for (let y = 0, row = 0; y < h; y += 6, row++) {
    for (let x = -(row % 2) * 7; x < w; x += 14) {
      const v = hash(x + 99, y + 7);
      R(g, x + 1, y + 1, 12, 4, v < 0.2 ? PAL.brickDark : v > 0.85 ? PAL.brickHi : PAL.brick);
      R(g, x + 1, y + 1, 12, 1, shade(PAL.brick, 1.12));
    }
  }
  // soot gradient toward the top
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgba(15,10,8,0.55)'); grd.addColorStop(0.5, 'rgba(15,10,8,0.1)'); grd.addColorStop(1, 'rgba(15,10,8,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  // windows
  for (let x = 40; x < w - 50; x += 112) {
    const wx = x, wy = 18, ww = 34, wh = 46;
    R(g, wx - 3, wy - 3, ww + 6, wh + 8, PAL.beamDark);
    R(g, wx - 2, wy - 2, ww + 4, wh + 4, PAL.beam);
    const sky = g.createLinearGradient(0, wy, 0, wy + wh);
    sky.addColorStop(0, '#1a2440'); sky.addColorStop(1, '#2d3c5c');
    g.fillStyle = sky; g.fillRect(wx, wy, ww, wh);
    for (let i = 0; i < 6; i++) P(g, wx + 2 + Math.floor(hash(x, i) * (ww - 4)), wy + 2 + Math.floor(hash(i, x) * (wh / 2)), i % 2 ? '#c7d6ff' : '#8ea4d8');
    if (hash(x, 1) > 0.5) { R(g, wx + 22, wy + 7, 6, 6, PAL.moon); R(g, wx + 24, wy + 7, 4, 4, '#2a3858'); }
    R(g, wx + ww / 2 - 1, wy, 2, wh, PAL.beam); R(g, wx, wy + wh / 2 - 1, ww, 2, PAL.beam);
    R(g, wx - 4, wy + wh + 2, ww + 8, 3, PAL.beamHi); R(g, wx - 4, wy + wh + 5, ww + 8, 1, PAL.beamDark);
  }
  // timber beams
  R(g, 0, 0, w, 6, PAL.beamDark); R(g, 0, 4, w, 2, PAL.beam);
  for (let x = 0; x < w; x += 112) { R(g, x - 4, 0, 8, h, PAL.beamDark); R(g, x - 3, 0, 5, h, PAL.beam); R(g, x - 3, 0, 1, h, PAL.beamHi); }
  // pipe along the wall
  R(g, 0, h - 26, w, 5, PAL.steelDark); R(g, 0, h - 26, w, 2, PAL.steel); R(g, 0, h - 26, w, 1, PAL.steelHi);
  for (let x = 30; x < w; x += 56) { R(g, x, h - 28, 4, 9, PAL.steelDark); R(g, x, h - 28, 4, 1, PAL.steelHi); }
  // skirting with the sector colour
  R(g, 0, h - 10, w, 10, PAL.beamDark); R(g, 0, h - 9, w, 3, accent); R(g, 0, h - 9, w, 1, shade(accent, 1.25)); R(g, 0, h - 6, w, 6, PAL.beam);
}

/** Thick cutaway side wall seen from above (only its cap shows). */
export function drawSideWall(g: CanvasRenderingContext2D, h: number) {
  R(g, 0, 0, 12, h, PAL.ink);
  R(g, 1, 0, 10, h, '#5d3b2e');
  for (let y = 0; y < h; y += 6) R(g, 1, y, 10, 1, '#4b2f24');
  R(g, 1, 0, 2, h, '#7b5141');
  R(g, 9, 0, 2, h, '#3e271e');
}

// ---------- pieces ----------

/** A machine: a workshop with a coloured roof, chimney, glowing windows and a status lamp. 56×52 */
export function drawMachine(g: CanvasRenderingContext2D, roof: string, opts: { glow: boolean; fire: boolean; lamp: string; frame: number }) {
  const ox = 4, oy = 8;
  R(g, ox - 2, oy + 38, 52, 6, PAL.shadow);
  // chimney
  R(g, ox + 34, oy - 6, 9, 16, PAL.ink); R(g, ox + 35, oy - 5, 7, 15, '#6a645a'); R(g, ox + 35, oy - 5, 7, 2, '#8c857a'); R(g, ox + 36, oy - 2, 2, 10, '#7a7368');
  // roof (top face) with tiles
  R(g, ox, oy + 2, 48, 16, PAL.ink);
  R(g, ox + 1, oy + 3, 46, 14, opts.fire ? shade(roof, 0.55) : roof);
  for (let y = 0; y < 14; y += 3) for (let x = (y / 3) % 2 ? 3 : 0; x < 46; x += 6) R(g, ox + 1 + x, oy + 3 + y, 5, 1, shade(roof, 0.82));
  R(g, ox + 1, oy + 3, 46, 1, shade(roof, 1.3));
  R(g, ox + 1, oy + 15, 46, 2, shade(roof, 0.55));
  // front wall: planks
  R(g, ox, oy + 17, 48, 24, PAL.ink);
  R(g, ox + 1, oy + 18, 46, 22, opts.fire ? '#5b3a22' : PAL.wood);
  for (let y = 0; y < 22; y += 4) R(g, ox + 1, oy + 18 + y, 46, 1, PAL.woodDark);
  for (let i = 0; i < 9; i++) P(g, ox + 3 + Math.floor(hash(i, 3) * 42), oy + 20 + Math.floor(hash(3, i) * 18), PAL.woodHi);
  R(g, ox + 1, oy + 18, 1, 22, PAL.woodHi);
  // windows
  const glow = opts.fire ? (opts.frame % 2 ? '#ff8a3d' : '#ffb35c') : opts.glow ? (opts.frame % 4 === 3 ? '#f3b54f' : PAL.lamp) : '#2c2520';
  for (const wx of [ox + 5, ox + 33]) {
    R(g, wx - 1, oy + 21, 12, 10, PAL.ink); R(g, wx, oy + 22, 10, 8, glow);
    R(g, wx + 4, oy + 22, 1, 8, PAL.ink); R(g, wx, oy + 25, 10, 1, PAL.ink);
    if (opts.glow || opts.fire) R(g, wx + 1, oy + 23, 2, 2, PAL.lampHot);
    R(g, wx - 1, oy + 31, 12, 2, PAL.woodDark);
  }
  // door
  R(g, ox + 18, oy + 25, 12, 16, PAL.ink); R(g, ox + 19, oy + 26, 10, 15, '#3d2816'); R(g, ox + 19, oy + 26, 10, 1, '#5a3c22'); R(g, ox + 26, oy + 33, 1, 2, PAL.amber);
  // sign plate above the door
  R(g, ox + 16, oy + 19, 16, 5, PAL.ink); R(g, ox + 17, oy + 20, 14, 3, PAL.paper); R(g, ox + 19, oy + 21, 10, 1, PAL.paperDark);
  // status lamp on the roof edge
  R(g, ox + 42, oy + 7, 5, 5, PAL.ink); R(g, ox + 43, oy + 8, 3, 3, opts.lamp); if (opts.lamp !== '#4a443a') P(g, ox + 43, oy + 8, '#ffffffaa');
}

/** A worker standing at a machine. 10×18, two frames. */
export function drawWorker(g: CanvasRenderingContext2D, color: string, frame: number) {
  const b = frame % 2;
  R(g, 1, 16, 8, 2, PAL.shadow);
  R(g, 2, 11, 2, 5, '#2b2620'); R(g, 6, 11, 2, 5, '#2b2620');
  R(g, 1, 5 + b, 8, 7, PAL.ink); R(g, 2, 6 + b, 6, 6, shade(color, 0.85)); R(g, 2, 6 + b, 6, 1, shade(color, 1.15));
  R(g, 2, 0 + b, 6, 6, PAL.ink); R(g, 3, 1 + b, 4, 5, PAL.skin); R(g, 3, 1 + b, 4, 1, PAL.skinDark);
  R(g, 2, 0 + b, 6, 2, color); R(g, 1, 1 + b, 8, 1, shade(color, 0.7));
  P(g, 5, 3 + b, PAL.ink);
  // arms: working motion
  R(g, b ? 0 : 1, 7 + b, 1, 4, PAL.skin); R(g, b ? 8 : 9, 6 + b, 1, 4, PAL.skin);
}

/** The Sector Manager: suit, sector-coloured tie. Poses: idle (hands on hips), thinking (hand on chin). 16×26 */
export function drawManager(g: CanvasRenderingContext2D, tie: string, pose: 'idle' | 'think', frame: number) {
  const b = frame % 2;
  R(g, 2, 24, 12, 2, PAL.shadow);
  // legs
  R(g, 4, 16, 3, 8, PAL.ink); R(g, 9, 16, 3, 8, PAL.ink); R(g, 5, 16, 2, 7, PAL.suit); R(g, 9, 16, 2, 7, PAL.suit);
  R(g, 4, 23, 3, 1, '#1a1a1a'); R(g, 9, 23, 4, 1, '#1a1a1a');
  // torso
  R(g, 3, 8, 10, 9, PAL.ink); R(g, 4, 9, 8, 8, PAL.suit); R(g, 4, 9, 8, 1, PAL.suitHi);
  R(g, 7, 9, 2, 3, PAL.shirt); R(g, 7, 10, 2, 5, tie); P(g, 7, 15, shade(tie, 0.7));
  if (pose === 'idle') {
    // hands on hips: elbows out
    R(g, 1, 10, 3, 2, PAL.ink); R(g, 1, 11, 2, 3, PAL.suit); R(g, 2, 13, 2, 2, PAL.skin);
    R(g, 12, 10, 3, 2, PAL.ink); R(g, 13, 11, 2, 3, PAL.suit); R(g, 12, 13, 2, 2, PAL.skin);
  } else {
    // one hand on the chin, the other across the chest
    R(g, 12, 9, 2, 4, PAL.suit); R(g, 10, 6, 2, 3, PAL.suit); R(g, 9, 5, 2, 2, PAL.skin);
    R(g, 3, 12, 6, 2, PAL.suitHi); R(g, 8, 12, 2, 2, PAL.skin);
  }
  // head
  const hy = b && pose === 'idle' ? 1 : 0;
  R(g, 4, 0 + hy, 8, 9, PAL.ink); R(g, 5, 1 + hy, 6, 7, PAL.skin); R(g, 5, 7 + hy, 6, 1, PAL.skinDark);
  R(g, 4, 0 + hy, 8, 3, PAL.hair); R(g, 4, 3 + hy, 1, 2, PAL.hair); R(g, 11, 3 + hy, 1, 2, PAL.hair);
  P(g, 6, 4 + hy, PAL.ink); P(g, 9, 4 + hy, PAL.ink);
  if (pose === 'think') { P(g, 7, 6 + hy, PAL.skinDark); P(g, 8, 6 + hy, PAL.skinDark); } else { R(g, 7, 6 + hy, 2, 1, '#9b5a45'); }
}

/** Signal post: a pole with a lamp head and a little readout. 22×40 */
export function drawSignal(g: CanvasRenderingContext2D, lamp: string, blink: boolean) {
  R(g, 4, 36, 14, 4, PAL.shadow);
  R(g, 5, 33, 12, 5, PAL.ink); R(g, 6, 34, 10, 3, PAL.steelDark); R(g, 6, 34, 10, 1, PAL.steel);
  R(g, 9, 12, 4, 23, PAL.ink); R(g, 10, 12, 2, 22, PAL.steel); R(g, 10, 12, 1, 22, PAL.steelHi);
  R(g, 2, 0, 18, 14, PAL.ink); R(g, 3, 1, 16, 12, '#585b60'); R(g, 3, 1, 16, 1, PAL.steelHi);
  R(g, 5, 3, 12, 8, PAL.ink);
  R(g, 6, 4, 10, 6, blink ? shade(lamp, 0.55) : lamp);
  if (!blink && lamp !== '#3e3a33') { R(g, 7, 5, 3, 2, '#ffffff99'); }
}

/** Boom gate: two posts and a striped arm that lowers while it holds. 40×36 */
export function drawGate(g: CanvasRenderingContext2D, holding: boolean, human: boolean) {
  R(g, 2, 32, 36, 4, PAL.shadow);
  for (const x of [3, 31]) { R(g, x - 1, 6, 8, 28, PAL.ink); R(g, x, 7, 6, 26, '#6d675c'); R(g, x, 7, 6, 2, '#8d877b'); R(g, x + 1, 9, 1, 22, '#7d776b'); }
  if (holding) {
    R(g, 6, 18, 28, 6, PAL.ink);
    for (let x = 0; x < 26; x += 6) { R(g, 7 + x, 19, 3, 4, PAL.fail); R(g, 10 + x, 19, 3, 4, '#f2eadb'); }
  } else {
    R(g, 32, 0, 5, 10, PAL.ink);
    for (let y = 0; y < 8; y += 4) { R(g, 33, 1 + y, 3, 2, PAL.ok); R(g, 33, 3 + y, 3, 2, '#f2eadb'); }
  }
  // the gate's box: a human gate shows a key slot, a rule gate a dial
  R(g, 14, 26, 12, 9, PAL.ink); R(g, 15, 27, 10, 7, '#4a443a');
  if (human) { R(g, 19, 29, 2, 3, PAL.amber); } else { R(g, 17, 29, 6, 3, PAL.steelHi); P(g, 20, 30, PAL.ink); }
}

/** Intake by kind: manual cart, timer clock post, webhook tube, chat board. 40×40 */
export function drawIntake(g: CanvasRenderingContext2D, kind: string, accent: string) {
  R(g, 2, 35, 36, 5, PAL.shadow);
  if (kind === 'timer') {
    R(g, 17, 12, 6, 24, PAL.ink); R(g, 18, 12, 4, 23, PAL.wood);
    R(g, 8, 0, 24, 18, PAL.ink); R(g, 9, 1, 22, 16, '#e9dfc5'); R(g, 9, 1, 22, 2, '#f6efdc');
    R(g, 19, 4, 2, 6, PAL.ink); R(g, 19, 9, 6, 2, PAL.ink);
    for (const [x, y] of [[19, 2], [28, 8], [19, 15], [11, 8]]) P(g, x, y, PAL.ink);
  } else if (kind === 'webhook') {
    R(g, 14, 0, 12, 30, PAL.ink); R(g, 15, 0, 10, 29, PAL.steel); R(g, 15, 0, 3, 29, PAL.steelHi); R(g, 22, 0, 2, 29, PAL.steelDark);
    for (let y = 4; y < 28; y += 8) R(g, 13, y, 14, 2, PAL.steelDark);
    R(g, 10, 26, 20, 10, PAL.ink); R(g, 11, 27, 18, 8, '#3d4146'); R(g, 13, 29, 14, 4, '#22252a');
  } else if (kind === 'chat') {
    R(g, 6, 2, 28, 22, PAL.ink); R(g, 7, 3, 26, 20, PAL.wood); R(g, 7, 3, 26, 2, PAL.woodHi);
    for (const [x, y, w] of [[9, 7, 12], [14, 12, 16], [9, 17, 10]] as const) { R(g, x, y, w, 4, PAL.paper); R(g, x, y + 3, w, 1, PAL.paperDark); }
    R(g, 10, 24, 3, 12, PAL.woodDark); R(g, 27, 24, 3, 12, PAL.woodDark);
  } else {
    // manual: a hand cart with an order slip
    R(g, 4, 16, 30, 14, PAL.ink); R(g, 5, 17, 28, 12, PAL.wood); for (let y = 17; y < 29; y += 4) R(g, 5, y, 28, 1, PAL.woodDark); R(g, 5, 17, 28, 1, PAL.woodHi);
    R(g, 33, 8, 3, 12, PAL.ink); R(g, 34, 8, 1, 11, PAL.steelHi); R(g, 30, 7, 6, 2, PAL.ink);
    for (const x of [8, 26]) { R(g, x - 1, 28, 8, 8, PAL.ink); R(g, x, 29, 6, 6, '#3a3632'); R(g, x + 2, 31, 2, 2, PAL.steelHi); }
    R(g, 9, 4, 18, 14, PAL.ink); R(g, 10, 5, 16, 12, PAL.paper); R(g, 10, 5, 16, 3, accent);
    for (let y = 10; y < 16; y += 2) R(g, 12, y, 11, 1, PAL.paperDark);
  }
}

/** The pallet at the end of a line. 44×20 (boxes are drawn on top separately). */
export function drawPallet(g: CanvasRenderingContext2D) {
  R(g, 0, 15, 44, 5, PAL.shadow);
  R(g, 0, 4, 44, 12, PAL.ink);
  for (let x = 1; x < 43; x += 7) { R(g, x, 5, 6, 3, PAL.woodHi); R(g, x, 5, 6, 1, '#c99a62'); }
  for (const x of [1, 19, 37]) R(g, x, 8, 6, 7, PAL.wood);
  R(g, 1, 13, 42, 2, PAL.woodDark);
}

/** A box on a belt: kraft carton with tape and a coloured label from the machine that made it. 10×10 */
export function drawBox(g: CanvasRenderingContext2D, label: string) {
  R(g, 0, 8, 10, 2, PAL.shadow);
  R(g, 0, 0, 10, 9, PAL.ink);
  R(g, 1, 1, 8, 3, PAL.kraftHi); R(g, 1, 4, 8, 4, PAL.kraft); R(g, 1, 7, 8, 1, PAL.kraftDark);
  R(g, 4, 1, 2, 3, PAL.tape);
  R(g, 2, 5, 4, 2, label);
}

/** A tile of belt; scrolled to animate. 8×12 */
export function drawBeltTile(g: CanvasRenderingContext2D) {
  R(g, 0, 0, 8, 12, PAL.rubber);
  R(g, 0, 0, 8, 2, PAL.railDark); R(g, 0, 0, 8, 1, PAL.rail);
  R(g, 0, 10, 8, 2, PAL.railDark); R(g, 0, 11, 8, 1, '#2f3134');
  R(g, 3, 3, 2, 6, PAL.rubberHi); R(g, 3, 3, 2, 1, '#4d4542');
}
export function drawBeltTileV(g: CanvasRenderingContext2D) {
  R(g, 0, 0, 12, 8, PAL.rubber);
  R(g, 0, 0, 2, 8, PAL.railDark); R(g, 0, 0, 1, 8, PAL.rail);
  R(g, 10, 0, 2, 8, PAL.railDark); R(g, 11, 0, 1, 8, '#2f3134');
  R(g, 3, 3, 6, 2, PAL.rubberHi);
}

/** Exclamation balloon. 14×18 */
export function drawBalloon(g: CanvasRenderingContext2D, color: string) {
  R(g, 0, 0, 14, 14, PAL.ink); R(g, 1, 1, 12, 12, '#fbf4e2'); R(g, 1, 12, 12, 1, '#d9cfb6');
  R(g, 4, 13, 5, 3, PAL.ink); R(g, 5, 13, 3, 2, '#fbf4e2'); R(g, 6, 15, 1, 2, PAL.ink);
  R(g, 6, 3, 2, 6, color); R(g, 6, 10, 2, 2, color);
}
/** Question balloon for a machine that needs you. 14×18 */
export function drawQuestion(g: CanvasRenderingContext2D) {
  R(g, 0, 0, 14, 14, PAL.ink); R(g, 1, 1, 12, 12, '#fbf4e2'); R(g, 1, 12, 12, 1, '#d9cfb6');
  R(g, 4, 13, 5, 3, PAL.ink); R(g, 5, 13, 3, 2, '#fbf4e2'); R(g, 6, 15, 1, 2, PAL.ink);
  const c = '#3f7fbf';
  R(g, 5, 3, 4, 1, c); R(g, 9, 4, 1, 2, c); R(g, 4, 4, 1, 1, c); R(g, 7, 6, 2, 1, c); R(g, 6, 7, 1, 2, c); R(g, 6, 10, 2, 2, c);
}
/** Thinking bubble. 18×12 */
export function drawThink(g: CanvasRenderingContext2D, frame: number) {
  R(g, 2, 0, 16, 9, PAL.ink); R(g, 3, 1, 14, 7, '#fbf4e2');
  for (let i = 0; i < 3; i++) R(g, 5 + i * 4, 4, 2, 2, i === frame % 3 ? PAL.ink : '#b7ad95');
  R(g, 1, 9, 3, 3, PAL.ink); R(g, 2, 9, 1, 1, '#fbf4e2');
}

/** Line sign at the head of each line. 64×12 */
export function drawSafetyStripe(g: CanvasRenderingContext2D, w: number) {
  for (let x = 0; x < w; x += 8) { R(g, x, 0, 4, 2, PAL.stripeY); R(g, x + 4, 0, 4, 2, '#2a2520'); }
}
