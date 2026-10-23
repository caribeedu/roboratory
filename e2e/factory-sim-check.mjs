// Dry-runs every line of a factory for free: copies it, swaps every agent for the simulated one
// (outputs shaped by each contract; checks fail once then pass, to exercise return belts),
// replaces signals with `true`, then drives each line to its pallet answering gates and questions.
// Usage: node e2e/factory-sim-check.mjs <factory-dir>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const src = path.resolve(process.argv[2]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-sim-'));
const root = path.join(tmp, 'factory');
fs.cpSync(src, root, { recursive: true, filter: (p) => !p.includes(`${path.sep}.runs`) });
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
for (const f of walk(root)) {
  if (f.endsWith('machine.yaml')) {
    const contract = JSON.parse(fs.readFileSync(path.join(path.dirname(f), 'contract.json'), 'utf8'));
    const props = contract.properties ?? {};
    const sample = (k, s) => s.enum ? s.enum[0] : s.type === 'array' ? [] : s.type === 'boolean' ? true : s.type === 'integer' || s.type === 'number' ? 1 : s.type === 'object' ? {} : s.pattern ? 'https://github.com/acme-corp/demo/pull/1' : `${k} (simulated)`;
    const out = Object.fromEntries(Object.entries(props).map(([k, s]) => [k, sample(k, s)]));
    const lines = ['agent: sim', 'attempts: 2', 'sim:', '  seconds: 1'];
    if (props.verdict) lines.push('  outputs:', `    - ${JSON.stringify({ ...out, verdict: 'fail', top_finding: 'simulated finding' })}`, `    - ${JSON.stringify({ ...out, verdict: 'pass' })}`);
    else lines.push(`  output: ${JSON.stringify(out)}`);
    fs.writeFileSync(f, lines.join('\n') + '\n');
  }
  if (f.endsWith('line.yaml')) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/signal: \{ run: "[^"]*"[^}]*\}/g, 'signal: { run: "true" }'));
}
for (const f of walk(root)) if (f.endsWith('sector.yaml') || f.endsWith('factory.yaml')) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/agent: claude/g, 'agent: sim'));

if (process.argv.includes('--prepare-only')) { console.log(root); process.exit(0); }
process.env.PROMPTORY_SIM_SPEED = '200';
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const out = path.join(tmp, 'core.cjs');
await build({ entryPoints: ['src/core/service.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error' });
const { FactoryService } = require(out);
const svc = new FactoryService({ snapshot: () => {}, logs: () => {}, messages: () => {} });
svc.open(root);
const f = svc.factory;
if (f.warnings.length) { console.log('WARNINGS', f.warnings); process.exit(1); }
const e = svc.engine;
e.beltMs = 5;
// first non-looping choice for every decision gate, except one run per line that takes the loop once
const firstChoice = (choices) => choices.find((c) => !/investigate|revise/.test(c)) ?? choices[0];
let failures = 0;
for (const s of f.sectors) for (const l of s.lines) {
  const input = Object.fromEntries(l.model.intake.inputs.map((i) => [i.name, i.placeholder || 'x']));
  const id = await e.run(l.id, input);
  const looped = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const run = e.runs.get(id).summary;
    if (run.status === 'done' || run.status === 'stopped') break;
    const lv = e.lineView(l.id);
    for (const [pid, pv] of Object.entries(lv.pieces)) {
      if (pv.runId !== id) continue;
      const def = l.model.pieces.find((p) => p.id === pid);
      if (pv.state === 'holding') {
        let choice;
        if (def.choices) {
          const loop = def.choices.find((c) => /investigate|revise/.test(c));
          choice = loop && !looped.has(pid) ? (looped.add(pid), loop) : firstChoice(def.choices);
        }
        e.release(l.id, pid, def.confirmations ?? 1, 'check', choice ? { choice, note: 'simulated note' } : undefined);
      }
      if (pv.state === 'fire') { console.log(`  FIRE ${l.id}#${pid}: ${pv.error}`); failures++; e.runs.get(id).summary.status = 'stopped'; }
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  const run = e.runs.get(id).summary;
  const ev = e.runEvents(id);
  const reworks = ev.filter((x) => x.type === 'rework').map((x) => `${x.from}→${x.to}`);
  console.log(`${run.status === 'done' ? 'OK  ' : 'FAIL'} ${l.id}: ${run.status}; rework: ${reworks.join(', ') || 'none'}; pieces run: ${new Set(ev.filter((x) => x.type === 'piece.done').map((x) => x.piece)).size}`);
  if (run.status !== 'done') failures++;
}
svc.close();
process.exit(failures ? 1 : 0);
