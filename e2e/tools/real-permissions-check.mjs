// Runs permission requests end to end with the REAL Claude Code agent on Haiku. This spends money (cents).
// Usage: node e2e/tools/real-permissions-check.mjs [--ceiling 0.3] [--fake]
//   --fake  plays the agent with a script that asks the permission tool the way Claude Code does, to check this tool for free.
//
// It starts a real engine process on a throwaway factory with one machine whose list does not cover `touch`, and checks:
//   A. the command waits for you, and the machine goes on when you allow it once;
//   B. a command you refuse reaches the agent with your reason, word for word, and is not run;
//   C. a command the factory never allows is refused at once, with no request raised.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const ceiling = Number(arg('--ceiling', '0.3'));
const fake = process.argv.includes('--fake');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-real-perm-'));
const root = path.join(dir, 'factory');
const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };

w('factory.yaml', 'name: Permission check\ndeny: [git push --force]\n');
w('sectors/s/sector.yaml', 'name: S\nmanager: { agent: claude }\n');
w('sectors/s/lines.yaml', 'lines:\n  - { id: l, model: m }\n');
w('sectors/s/models/m/line.yaml', 'schema_version: 1\nintake: { kind: manual, inputs: [{ name: command, required: true }] }\npieces:\n  - { id: worker, machine: worker }\n');
w('sectors/s/models/m/machines/worker/role.md', [
  'You run exactly one shell command, given in the box as `command`, once, from the folder you are in.',
  'Put in `answer` what the command printed, or, if it was refused, the exact refusal text you were given, word for word.',
  'If it is refused, do not try another way and do not run anything else.',
].join('\n'));
w('sectors/s/models/m/machines/worker/contract.json', JSON.stringify({ type: 'object', required: ['answer'], properties: { answer: { type: 'string' } } }));
w('sectors/s/models/m/machines/worker/machine.yaml', 'schema_version: 1\nagent: claude\nmodel: haiku\nattempts: 1\ntimeout: 5m\n');

if (fake) {
  // an agent CLI that does what Claude Code does with --permission-prompt-tool
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/usr/bin/env node
const { spawn } = require('child_process');
const args = process.argv.slice(2);
const command = /"command": "([^"]*)"/.exec(args[args.indexOf('-p') + 1])[1];
const cfg = JSON.parse(args[args.indexOf('--mcp-config') + 1]).mcpServers.roboratory;
const tool = spawn(cfg.command, cfg.args, { env: { ...process.env, ...cfg.env }, stdio: ['pipe', 'pipe', 'inherit'] });
const send = (m) => tool.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n');
let buf = '';
tool.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); on(m); } });
send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
function on(m) {
  if (m.id === 1) { send({ method: 'notifications/initialized' }); send({ id: 2, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'Bash', input: { command }, tool_use_id: 'x' } } }); }
  if (m.id === 2) {
    tool.stdin.end();
    const d = JSON.parse(m.result.content[0].text);
    console.log(JSON.stringify({ type: 'result', subtype: 'success', result: '', total_cost_usd: 0, structured_output: { result: { answer: d.behavior === 'allow' ? 'ran' : d.message } } }));
  }
}
`);
  fs.chmodSync(bin, 0o755);
  process.env.ROBORATORY_CLAUDE_BIN = bin;
}

process.env.ROBORATORY_BELT_MS = '5';
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const bundle = path.join(dir, 'engine.cjs');
await build({ entryPoints: ['src/engine.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: bundle, logLevel: 'error' });
const clientFile = path.join(dir, 'client.cjs');
await build({ entryPoints: ['src/core/client.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: clientFile, logLevel: 'error' });
const { EngineClient, launchFor } = require(clientFile);

const c = await EngineClient.connect(root, { client: 'cli', start: true, launch: launchFor(bundle) });
const call = (m, ...a) => c.call(m, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let spent = 0, failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

async function until(fn, ms = 120_000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(300); }
}

/** Starts a run and returns it once it ends; `onRequest` answers a permission request when one is raised. */
async function runCommand(command, onRequest) {
  const runId = await call('run', 's/l', { command });
  let asked = null;
  const ended = await until(async () => {
    const { snapshot } = await call('state');
    const ask = snapshot.attention.find((a) => a.kind === 'permission' && a.runId === runId);
    if (ask && !asked) { asked = ask; await onRequest?.(ask); }
    const r = (await call('runs')).find((x) => x.id === runId);
    return r.status === 'done' || r.status === 'stopped' || r.status === 'fire' ? r : null;
  });
  const { events } = await call('runDetail', runId);
  const cost = events.filter((e) => e.type === 'cost').reduce((a, e) => a + e.usd, 0);
  spent += cost;
  const box = events.find((e) => e.type === 'piece.done' && e.piece === 'worker')?.box;
  return { runId, asked, ended, events, box, cost, folder: path.join(root, '.runs', 's', 'l', runId, 'machines', 'worker') };
}

try {
  console.log(`factory ${root}${fake ? ' (fake agent)' : ' (real Claude Code, Haiku)'}`);

  const a = await runCommand('touch made.txt', async (ask) => { check(/touch made\.txt/.test(ask.detail), `A. the request shows the command (${ask.detail})`); await call('allow', ask.requestId); });
  check(!!a.asked, 'A. a command outside the list raised a request');
  check(a.ended?.status === 'done', `A. the machine went on after you allowed it (${a.ended?.status})`);
  if (!fake) check(fs.existsSync(path.join(a.folder, 'made.txt')), 'A. the command ran');
  console.log(`     answer: ${JSON.stringify(a.box)} · US$ ${a.cost.toFixed(4)}`);

  if (spent < ceiling) {
    const reason = 'Not on this line: ask the platform team first (code 7431).';
    const b = await runCommand('touch refused.txt', async (ask) => { await call('deny', ask.requestId, reason); });
    check(!!b.asked, 'B. the request was raised');
    check(String(b.box?.answer ?? '').includes('7431'), `B. the agent was told your reason (${JSON.stringify(b.box?.answer)})`);
    if (!fake) check(!fs.existsSync(path.join(b.folder, 'refused.txt')), 'B. the refused command did not run');
    console.log(`     US$ ${b.cost.toFixed(4)}`);
  }

  if (spent < ceiling) {
    const cc = await runCommand('git push --force origin main');
    check(!cc.asked, 'C. a command the factory never allows raised no request');
    check(cc.events.some((e) => e.type === 'permission.denied'), 'C. the engine refused it by the factory\'s list');
    check(/Forbidden by this factory/.test(String(cc.box?.answer ?? '')), `C. the agent was told the factory forbids it (${JSON.stringify(cc.box?.answer)})`);
    console.log(`     US$ ${cc.cost.toFixed(4)}`);
  }
  console.log(`\nTOTAL_COST_USD ${spent.toFixed(4)} (ceiling ${ceiling}) · ${failures ? `${failures} FAILED` : 'all checks passed'}`);
} finally {
  try { await call('stop'); } catch { /* gone */ }
  c.close();
}
process.exitCode = failures ? 1 : 0;
