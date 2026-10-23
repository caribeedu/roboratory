// Runs a two-machine line with the REAL Claude Code agent. This spends money.
// Usage: node e2e/real-agent-check.mjs [--github owner/repo]
//   without --github: works on a local throwaway repo; the publisher "opens" a local PR note.
//   with --github: the target repo is cloned from GitHub and the publisher opens a real draft PR there.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const gh = process.argv.includes('--github') ? process.argv[process.argv.indexOf('--github') + 1] : null;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptory-real-'));
const repo = path.join(dir, 'repo');
if (gh) execFileSync('gh', ['repo', 'clone', gh, repo], { stdio: 'inherit' });
else {
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'greet.py'), 'def greet(name):\n    return "hello " + name\n');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], { cwd: repo });
}
const root = path.join(dir, 'factory');
const w = (rel, c) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), c); };
w('factory.yaml', 'name: Real check\n');
w('sectors/s/sector.yaml', 'name: S\nmanager: { agent: claude }\n');
w('sectors/s/lines.yaml', `lines:\n  - id: l\n    model: m\n    repo: ${repo}\n`);
w('sectors/s/models/m/line.yaml', `intake: { kind: manual, inputs: [{ name: task, required: true }] }
pieces:
  - { id: implement, machine: implementer }
  - { id: publish, machine: publisher }
${gh ? '  - { id: pr-check, signal: { run: "gh pr view {{box.pr_url}} --json isDraft -q .isDraft | grep -q true" } }\n' : ''}`);
w('sectors/s/models/m/machines/implementer/role.md', 'Make the change asked in the box, keep it minimal, and commit it with git.\n');
w('sectors/s/models/m/machines/implementer/contract.json', JSON.stringify({ type: 'object', required: ['summary', 'files'], properties: { summary: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } } }));
w('sectors/s/models/m/machines/implementer/machine.yaml', 'agent: claude\nmodel: sonnet\nattempts: 2\ntimeout: 8m\n');
w('sectors/s/models/m/machines/publisher/role.md', gh
  ? 'Push the current branch to origin and open a DRAFT pull request with gh. Report pr_url, branch and title.\n'
  : 'Do not push. Write PR.md describing the change on this branch and report pr_url as local://pr/<branch>, plus branch and title.\n');
w('sectors/s/models/m/machines/publisher/contract.json', JSON.stringify({ type: 'object', required: ['pr_url', 'branch', 'title'], properties: { pr_url: { type: 'string' }, branch: { type: 'string' }, title: { type: 'string' } } }));
w('sectors/s/models/m/machines/publisher/machine.yaml', `agent: claude\nmodel: sonnet\nattempts: 2\ntimeout: 8m\nallow: ["Bash(gh pr create:*)", "Bash(git push:*)"]\n`);

// load the compiled core through vite-node-free tsx-less path: use vitest's TS loader via dynamic import of the source with esbuild register
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const out = path.join(dir, 'core.cjs');
await build({ entryPoints: ['src/core/service.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error' });
const { FactoryService } = require(out);
const svc = new FactoryService({ snapshot: () => {}, logs: (l) => l.forEach((e) => console.log(`[${e.level}] ${e.text}`)), messages: () => {} });
svc.open(root);
const id = await svc.run('s/l', { task: 'Make greet() capitalise the name and add a docstring.' });
const t0 = Date.now();
while (Date.now() - t0 < 20 * 60000) {
  const r = svc.runs().find((x) => x.id === id);
  if (r.status !== 'running') { console.log('\nRESULT', r.status, JSON.stringify(r.deliverable)); break; }
  await new Promise((r) => setTimeout(r, 2000));
}
const cost = svc.runDetail(id).events.filter((e) => e.type === 'cost').reduce((a, e) => a + e.usd, 0);
console.log('COST_USD', cost.toFixed(4), 'run dir', svc.runDetail(id).dir);
console.log(execFileSync('git', ['log', '--all', '--oneline', '-8'], { cwd: repo }).toString());
svc.close();
