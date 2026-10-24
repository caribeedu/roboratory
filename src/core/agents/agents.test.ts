import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeSchema, mcpServerOf, resultLine, shellRules, toolArgs, toolLabel, unwrapClaude } from './claude';
import { runAgent, type AgentEvent, type AgentRequest } from './index';
import { extractJson } from './process';

const base = (over: Partial<AgentRequest> = {}): AgentRequest => ({
  agent: 'claude', role: 'role', prompt: 'do it', schema: { type: 'object' }, cwd: os.tmpdir(), addDirs: [], allow: [], tools: [],
  readOnly: false, timeoutMs: 10000, onEvent: () => {}, ...over,
});

function fakeClaude(script: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'));
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/usr/bin/env node\n${script}`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

describe('agents', () => {
  afterEach(() => { delete process.env.ROBORATORY_CLAUDE_BIN; });

  it('runs claude headless, streams tool calls and returns structured_output', async () => {
    process.env.ROBORATORY_CLAUDE_BIN = fakeClaude(`
const out = (o) => console.log(JSON.stringify(o));
out({ type: 'system', subtype: 'init' });
out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.md' } }] } });
out({ type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'hello' }] }] } });
out({ type: 'result', subtype: 'success', is_error: false, result: 'done', structured_output: { ok: true }, total_cost_usd: 0.01 });
`);
    const events: AgentEvent[] = [];
    const r = await runAgent(base({ onEvent: (e) => events.push(e) }));
    expect(r).toMatchObject({ output: { ok: true }, costUsd: 0.01 });
    expect(events.map((e) => e.kind)).toEqual(['tool', 'ret']);
    expect(events[0].text).toContain('Read');
  });

  it('reports a failed claude run with its subtype', async () => {
    process.env.ROBORATORY_CLAUDE_BIN = fakeClaude(`console.log(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, errors: ['too many turns'] }));`);
    expect((await runAgent(base())).error).toMatch(/error_max_turns: too many turns/);
  });

  it('times out and kills the process', async () => {
    process.env.ROBORATORY_CLAUDE_BIN = fakeClaude(`setTimeout(() => {}, 10000);`);
    expect((await runAgent(base({ timeoutMs: 200 }))).error).toMatch(/timed out/);
  });

  // what the CLI is started with, read from a fake CLI that writes its arguments down
  async function startedWith(over: Partial<AgentRequest>) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-args-')), 'args.json');
    process.env.ROBORATORY_CLAUDE_BIN = fakeClaude(`require('fs').writeFileSync(${JSON.stringify(file)}, JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { ok: true } }));`);
    await runAgent(base(over));
    const args: string[] = JSON.parse(fs.readFileSync(file, 'utf8'));
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    return { args, prompt: value('-p'), value };
  }

  it('tells a machine which shell commands it may run, and nothing when its shell is open', async () => {
    const { prompt } = await startedWith({ allow: ['Bash(gh pr view:*)', 'Bash(curl:*)'] });
    expect(prompt).toContain('Shell: you may run only commands that start with `git`, `gh pr view`, `curl`. Anything else is denied.');
    expect(prompt).toContain('A denied command does not mean the others are denied.');
    expect((await startedWith({ allow: ['Bash'] })).prompt).toBe('do it');
    expect((await startedWith({ readOnly: true })).prompt).toBe('do it');
  });

  it('says a shell is off when no command is allowed at all', () => {
    expect(shellRules(['Read', 'Grep'])).toMatch(/you have no shell/);
  });

  it('starts managers read-only, so no write tools exist in their session', async () => {
    const manager = await startedWith({ readOnly: true, tools: ['mcp__nr__q'] });
    expect(manager.value('--tools')).toBe('Read,Grep,Glob');
    expect(manager.value('--allowedTools')).toBe('Read,Grep,Glob,mcp__nr__q');
    expect(manager.value('--permission-mode')).toBe('dontAsk');
    expect(manager.value('--disallowedTools')).toBe('Agent');
  });

  it('starts machines with file edits, the chosen model and effort, the extra folders, and no sub-agents', async () => {
    const machine = await startedWith({ allow: ['Bash(sh test.sh)'], addDirs: ['/x'], effort: 'high', model: 'opus' });
    expect(machine.value('--effort')).toBe('high');
    expect(machine.value('--model')).toBe('opus');
    expect(machine.args).not.toContain('--tools');
    expect(machine.value('--allowedTools')).toContain('Edit');
    expect(machine.args).toContain('/x');
    expect(machine.value('--disallowedTools')).toBe('Agent');
  });

  it('runs the simulated agent and writes its files', async () => {
    process.env.ROBORATORY_SIM_SPEED = '100';
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-'));
    const r = await runAgent(base({ agent: 'sim', cwd, sim: { seconds: 1, write: { 'A.md': 'hi {{box.t}}' }, output: { t: '{{box.t}}' }, bad_output: { t: 1 } }, simCtx: { box: { t: 'X' } } }));
    expect(r.output).toEqual({ t: 'X' });
    expect(fs.readFileSync(path.join(cwd, 'A.md'), 'utf8')).toBe('hi X');
    const bad = await runAgent(base({ agent: 'sim', cwd, simFail: true, sim: { seconds: 1, output: {}, bad_output: { t: 1 } }, simCtx: {} }));
    expect(bad.output).toEqual({ t: 1 });
  });

  it('extracts JSON from free text', () => {
    expect(extractJson('Sure:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('result {"a":{"b":2}} end')).toEqual({ a: { b: 2 } });
    expect(extractJson('nothing')).toBeUndefined();
    expect(mcpServerOf('mcp__new-relic__run_nrql_query')).toBe('new-relic');
    expect(mcpServerOf('mcp__claude_ai_Atlassian')).toBe('claude_ai_Atlassian');
    expect(mcpServerOf('mcp__claude_ai_Acme_Warehouse__run_sql')).toBe('claude_ai_Acme_Warehouse');
  });

  it('writes transcript lines people can read', () => {
    expect(toolLabel('mcp__claude_ai_Atlassian__getConfluencePage')).toBe('Atlassian · getConfluencePage');
    expect(toolLabel('mcp__newrelic__run_nrql_query')).toBe('newrelic · run_nrql_query');
    expect(toolLabel('Read')).toBe('Read');
    expect(toolArgs({ query_input: { nrql: 'SELECT count(*)\n FROM Log' } })).toBe('nrql: SELECT count(*) FROM Log');
    expect(resultLine('1\t---\n2\tname: x\n')).toBe('--- name: x');
    expect(resultLine('Error: result (82,806 characters) exceeds maximum allowed tokens. Output has been saved to /x')).toMatch(/^result too large for one reply \(82,806 characters\)/);
    expect(resultLine('boom', true)).toBe('error: boom');
  });

  it('asks Claude for the contract or a question under result, and leaves a plain contract alone', () => {
    const contract = { type: 'object', properties: { ok: { type: 'boolean' } } };
    const question = { type: 'object', required: ['needs_human'] };
    expect(claudeSchema(contract)).toBe(contract);
    expect(claudeSchema(contract, question)).toEqual({ type: 'object', required: ['result'], properties: { result: { anyOf: [contract, question] } } });
    expect(unwrapClaude({ result: { ok: true } })).toEqual({ ok: true });
    expect(unwrapClaude({ ok: true })).toEqual({ ok: true });
  });
});
