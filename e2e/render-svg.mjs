// Renders an SVG file to a PNG with the packaged app's browser engine.
// Usage: node e2e/render-svg.mjs <file.svg> <out.png> [scale]
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { appExecutable } from './exe.mjs';

const [svg, out, scale = '1'] = process.argv.slice(2);
if (!svg || !out) { console.error('usage: node e2e/render-svg.mjs <file.svg> <out.png> [scale]'); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-svg-'));
const app = await electron.launch({ executablePath: appExecutable(), env: { ...process.env, ROBORATORY_USER_DATA: path.join(tmp, 'ud') } });
const win = await app.firstWindow();
const m = /viewBox="0 0 (\d+) (\d+)"/.exec(fs.readFileSync(svg, 'utf8'));
const w = Number(m?.[1] ?? 1200), h = Number(m?.[2] ?? 400), s = Number(scale);
const html = `<body style="margin:0;background:#fff"><img id="i" src="${pathToFileURL(path.resolve(svg)).href}" width="${w * s}" height="${h * s}" style="display:block"></body>`;
await win.evaluate((h2) => { document.open(); document.write(h2); document.close(); }, html);
await win.setViewportSize({ width: w * s, height: h * s }).catch(() => {});
await win.waitForFunction(() => { const i = document.getElementById('i'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 }).catch(() => {});
await win.screenshot({ path: out, clip: { x: 0, y: 0, width: w * s, height: h * s } });
console.log('wrote', out);
await app.close();
