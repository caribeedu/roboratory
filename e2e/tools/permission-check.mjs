// Checks, with the REAL Claude Code agent, what the permission requests of D44 assume. This spends money (Haiku, a few cents).
// Usage: node e2e/tools/permission-check.mjs [--ceiling 0.5] [--only A,B] [--wait-ms 190000]
// It builds a throwaway git repository with a local bare remote, gives Claude Code a tiny MCP server (this same file,
// started with --serve) as its --permission-prompt-tool, and runs short scenarios through the same flags the Claude
// adapter uses (stream-json, --json-schema). It reports what reached the tool, what the agent saw and what it cost.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import { fileURLToPath } from 'node:url';
const here = fileURLToPath(import.meta.url);

// ---------- the permission tool: a minimal MCP server over stdio ----------
if (process.argv.includes('--serve')) {
  const log = (o) => fs.appendFileSync(process.env.PERM_LOG, JSON.stringify({ at: Date.now(), ...o }) + '\n');
  const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  log({ event: 'server-start' });
  readline.createInterface({ input: process.stdin }).on('line', async (line) => {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.method === 'initialize') {
      log({ event: 'initialize' });
      send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'perm', version: '0' } } });
    } else if (m.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'approve', description: 'Decides whether a tool call may run', inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] } }] } });
    } else if (m.method === 'tools/call') {
      const args = m.params?.arguments ?? {};
      log({ event: 'call', args });
      await new Promise((r) => setTimeout(r, Number(process.env.PERM_DELAY_MS || 0)));
      const decision = process.env.PERM_MODE === 'deny'
        ? { behavior: 'deny', message: process.env.PERM_REASON || 'denied' }
        : { behavior: 'allow', updatedInput: args.input ?? {} };
      log({ event: 'answer', decision });
      send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(decision) }] } });
    } else if (m.id !== undefined) {
      send({ jsonrpc: '2.0', id: m.id, result: {} });
    }
  });
} else {
  await main();
}

// ---------- the scenarios ----------
async function main() {
  const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
  const ceiling = Number(arg('--ceiling', '0.5'));
  const only = arg('--only', '')?.split(',').filter(Boolean);
  const waitMs = Number(arg('--wait-ms', '190000'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-perm-'));
  const bare = path.join(dir, 'origin.git');
  const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, stdio: 'pipe' }).toString().trim();
  const fresh = (name) => {
    const repo = path.join(dir, name);
    fs.mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'init');
    const remote = path.join(dir, `${name}.git`);
    git(dir, 'init', '-q', '--bare', '-b', 'main', remote);
    git(repo, 'remote', 'add', 'origin', remote);
    return { repo, remote };
  };
  const SCHEMA = { type: 'object', required: ['note'], properties: { note: { type: 'string' } } };
  const FORMAT = ' Answer with the JSON schema given; put in `note` what the command printed, or the exact refusal text you were given if it was refused. Run only the command asked, once.';
  let spent = 0;

  async function run(name, prompt, o = {}) {
    if (spent >= ceiling) return { name, skipped: `ceiling US$ ${ceiling} reached` };
    const { repo, remote } = fresh(name);
    const logFile = path.join(dir, `${name}.perm.jsonl`);
    const cfg = path.join(dir, `${name}.mcp.json`);
    fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { perm: { command: process.execPath, args: [here, '--serve'], env: { PERM_LOG: logFile, PERM_MODE: o.mode || 'allow', PERM_DELAY_MS: String(o.delayMs || 0), PERM_REASON: o.reason || '' } } } }));
    fs.writeFileSync(logFile, '');
    const args = ['-p', prompt + FORMAT, '--model', 'haiku', '--output-format', 'stream-json', '--verbose', '--json-schema', JSON.stringify(SCHEMA),
      '--permission-prompt-tool', 'mcp__perm__approve', '--mcp-config', cfg, '--strict-mcp-config', '--setting-sources', 'project',
      '--tools', 'Bash', '--max-budget-usd', '0.08'];
    if (o.allowed) args.push('--allowedTools', o.allowed);
    if (o.disallowed) args.push('--disallowedTools', o.disallowed);
    const t0 = Date.now();
    const events = [];
    await new Promise((resolve) => {
      const child = spawn(process.env.ROBORATORY_CLAUDE_BIN || 'claude', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let stderr = '';
      readline.createInterface({ input: child.stdout }).on('line', (l) => { try { events.push(JSON.parse(l)); } catch { /* not json */ } });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', () => { if (stderr.trim()) events.push({ type: 'stderr', text: stderr.trim().slice(0, 300) }); resolve(); });
    });
    const result = events.find((e) => e.type === 'result');
    const cost = result?.total_cost_usd ?? 0; spent += cost;
    const calls = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const shell = [];
    for (const e of events) for (const b of e.message?.content ?? []) {
      if (b.type === 'tool_use') shell.push({ ran: b.input?.command });
      if (b.type === 'tool_result') shell.push({ result: String(Array.isArray(b.content) ? b.content.map((c) => c.text).join(' ') : b.content).slice(0, 200), error: !!b.is_error });
    }
    let pushed = '';
    try { pushed = git(remote, 'rev-parse', '--verify', '-q', 'main'); } catch { /* nothing pushed */ }
    return {
      name, seconds: Math.round((Date.now() - t0) / 1000), cost, subtype: result?.subtype, answer: result?.structured_output,
      toolCalls: calls.filter((c) => c.event === 'call').map((c) => c.args), toolAnswers: calls.filter((c) => c.event === 'answer').map((c) => c.decision),
      serverStarted: calls.some((c) => c.event === 'server-start'), shell, denials: result?.permission_denials, pushedToRemote: !!pushed,
      stderr: events.find((e) => e.type === 'stderr')?.text, error: result?.is_error ? result.result : undefined,
    };
  }

  const S = {
    A: () => run('A-rules-decide', 'Run `git status --short` in the shell.', { allowed: 'Bash(git status:*)' }),
    B: () => run('B-asks-allow', 'Run `touch made.txt` in the shell.', { allowed: 'Bash(git status:*)' }),
    C: () => run('C-long-wait', 'Run `touch made.txt` in the shell.', { allowed: 'Bash(git status:*)', delayMs: waitMs }),
    D: () => run('D-deny-reason', 'Run `touch made.txt` in the shell.', { allowed: 'Bash(git status:*)', mode: 'deny', reason: 'Not allowed on this line: ask a person first (code 7431).' }),
    E: () => run('E-deny-rule', 'Run `git push --force origin HEAD:main` in the shell.', { allowed: 'Bash(git:*)', disallowed: 'Bash(git push --force:*)' }),
    F: () => run('F-deny-rule-and-git-C', 'Run `git -C . push origin HEAD:main` in the shell.', { allowed: 'Bash(git:*)', disallowed: 'Bash(git push:*)' }),
    F2: () => run('F2-deny-wildcard', 'Run `git -C . push origin HEAD:main` in the shell.', { allowed: 'Bash(git:*)', disallowed: 'Bash(git push:*),Bash(git * push:*)' }),
    F3: () => run('F3-deny-wildcard-plain', 'Run `git push origin HEAD:main` in the shell.', { allowed: 'Bash(git:*)', disallowed: 'Bash(git push:*),Bash(git * push:*)' }),
    G: () => run('G-push-asks', 'Run `git push origin HEAD:main` in the shell.', { allowed: 'Bash(git status:*),Bash(git add:*),Bash(git commit:*)', mode: 'deny', reason: 'push needs a person' }),
    I: () => run('I-wildcard-allow', 'Run `git -C . status --short` in the shell.', { allowed: 'Bash(git status:*),Bash(git * status:*)', mode: 'deny', reason: 'asked' }),
    I2: () => run('I2-wildcard-allow-push', 'Run `git -C . push origin HEAD:main` in the shell.', { allowed: 'Bash(git status:*),Bash(git * status:*)', mode: 'deny', reason: 'push needs a person' }),
    H: () => run('H-git-C-allowed', 'Run `git -C . push origin HEAD:main` in the shell.', { allowed: 'Bash(git -C:*),Bash(git status:*)', mode: 'deny', reason: 'push needs a person' }),
  };
  const keys = Object.keys(S).filter((k) => !only.length || only.includes(k));
  // the long wait runs beside the others: it costs nothing while it waits
  const long = keys.includes('C') ? S.C() : null;
  const out = [];
  for (const k of keys.filter((x) => x !== 'C')) { out.push(await S[k]()); console.log(JSON.stringify(out.at(-1))); }
  if (long) { out.push(await long); console.log(JSON.stringify(out.at(-1))); }
  console.log(`\nTOTAL_COST_USD ${spent.toFixed(4)} (ceiling ${ceiling})  folder ${dir}`);
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(out, null, 2));
}
