// Dry-runs every line of a factory for free: copies it, swaps every agent for the simulated one
// (outputs shaped by each contract; checks fail once then pass, to exercise return belts),
// replaces signals with `true`, then drives each line to its pallet answering gates and questions.
// It starts a real engine process on the copy and drives it over the socket, as the app and the command line do.
// Usage: node e2e/tools/factory-sim-check.mjs <factory-dir>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const src = path.resolve(process.argv[2]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-sim-'));
const root = path.join(tmp, 'factory');
fs.cpSync(src, root, { recursive: true, filter: (p) => !p.includes(`${path.sep}.runs`) });
// lines point at target repositories next to the factory (../repos/<name>), so those come along
for (const name of ['repos', 'demo-repos']) {
  const repos = path.join(path.dirname(src), name);
  if (fs.existsSync(repos)) fs.cpSync(repos, path.join(tmp, name), { recursive: true });
}
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
process.env.ROBORATORY_SIM_SPEED = '200';
process.env.ROBORATORY_BELT_MS = '5';
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const bundle = path.join(tmp, 'engine.cjs');
await build({ entryPoints: ['src/engine.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: bundle, logLevel: 'error' });
const clientFile = path.join(tmp, 'client.cjs');
await build({ entryPoints: ['src/core/client.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: clientFile, logLevel: 'error' });
const { EngineClient, launchFor } = require(clientFile);
const c = await EngineClient.connect(root, { client: 'cli', start: true, launch: launchFor(bundle) });
const call = (m, ...a) => c.call(m, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const first = await call('state');
const f = first.snapshot.factory;
if (f.warnings.length) { console.log('WARNINGS', f.warnings); await call('stop'); process.exit(1); }
// first non-looping choice for every decision gate, except one run per line that takes the loop once
const firstChoice = (choices) => choices.find((x) => !/investigate|revise/.test(x)) ?? choices[0];
let failures = 0;
for (const s of f.sectors) for (const l of s.lines) {
  const input = Object.fromEntries(l.intake.inputs.map((i) => [i.name, i.placeholder || 'x']));
  const id = await call('run', l.id, input);
  const looped = new Set();
  const t0 = Date.now();
  let status = 'running';
  while (Date.now() - t0 < 90000) {
    status = (await call('runs')).find((r) => r.id === id).status;
    if (status === 'done' || status === 'stopped') break;
    const lv = (await call('state')).snapshot.lines[l.id];
    for (const [pid, pv] of Object.entries(lv.pieces)) {
      if (pv.runId !== id) continue;
      const def = l.pieces.find((p) => p.id === pid);
      if (pv.state === 'holding') {
        let choice;
        if (def.choices) {
          const loop = def.choices.find((x) => /investigate|revise/.test(x));
          choice = loop && !looped.has(pid) ? (looped.add(pid), loop) : firstChoice(def.choices);
        }
        await call('release', l.id, pid, def.confirmations ?? 1, choice ? { choice, note: 'simulated note' } : undefined);
      }
      if (pv.state === 'fire') { console.log(`  FIRE ${l.id}#${pid}: ${pv.error}`); failures++; await call('halt', l.id); status = 'stopped'; }
    }
    if (status === 'stopped') break;
    await sleep(20);
  }
  if (status !== 'done' && status !== 'stopped') status = (await call('runs')).find((r) => r.id === id).status;
  const ev = (await call('runDetail', id)).events;
  const reworks = ev.filter((x) => x.type === 'rework').map((x) => `${x.from}→${x.to}`);
  console.log(`${status === 'done' ? 'OK  ' : 'FAIL'} ${l.id}: ${status}; rework: ${reworks.join(', ') || 'none'}; pieces run: ${new Set(ev.filter((x) => x.type === 'piece.done').map((x) => x.piece)).size}`);
  if (status !== 'done') failures++;
}
c.close();
const { EngineClient: C2 } = require(clientFile);
const stopper = await C2.connect(root, { client: 'cli' });
await stopper.call('stop');
stopper.close();
process.exit(failures ? 1 : 0);
