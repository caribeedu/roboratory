// The Codex adapter, against a fake `codex` that writes down what it was asked and answers as the real one does:
// the answer in the file named by `-o`, progress on stdout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAgent, type AgentEvent, type AgentRequest } from './index';

const base = (over: Partial<AgentRequest> = {}): AgentRequest => ({
  agent: 'codex', role: 'You are the role.', prompt: 'do it', schema: { type: 'object', properties: { ok: { type: 'boolean' } } }, cwd: os.tmpdir(), addDirs: [],
  allow: [], tools: [], readOnly: false, timeoutMs: 10_000, onEvent: () => {}, ...over,
});

/** A `codex` that records its arguments and the schema file it was given, then runs `body` (which can write the answer). */
function fakeCodex(body: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-'));
  const record = path.join(dir, 'record.json');
  const bin = path.join(dir, 'codex');
  fs.writeFileSync(bin, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args, schema: JSON.parse(fs.readFileSync(value('--output-schema'), 'utf8')) }));
const answer = (text) => fs.writeFileSync(value('-o'), text);
${body}
`);
  fs.chmodSync(bin, 0o755);
  process.env.ROBORATORY_CODEX_BIN = bin;
  return () => JSON.parse(fs.readFileSync(record, 'utf8')) as { args: string[]; schema: Record<string, unknown> };
}

afterEach(() => { delete process.env.ROBORATORY_CODEX_BIN; });

describe('The Codex agent', () => {
  it('gets the role and the prompt as one request and the bare contract as its output schema, and returns the JSON it writes', async () => {
    const asked = fakeCodex(`console.log('thinking'); answer('{"ok": true}');`);
    const events: AgentEvent[] = [];
    const r = await runAgent(base({ onEvent: (e) => events.push(e) }));

    expect(r.output).toEqual({ ok: true });
    expect(events).toEqual([{ kind: 'text', text: 'thinking' }]);
    const { args, schema } = asked();
    expect(args[1]).toBe('You are the role.\n\ndo it');
    expect(schema).toEqual({ type: 'object', properties: { ok: { type: 'boolean' } } });
    expect(args).toContain('--skip-git-repo-check');
  });

  it('can write in its folder and the extra ones when it is a machine, and nowhere when it is a manager', async () => {
    const asked = fakeCodex(`answer('{}');`);
    await runAgent(base({ addDirs: ['/run/machines/other'], model: 'gpt-x' }));
    let { args } = asked();
    expect(args[args.indexOf('--sandbox') + 1]).toBe('workspace-write');
    expect(args[args.indexOf('--add-dir') + 1]).toBe('/run/machines/other');
    expect(args[args.indexOf('--model') + 1]).toBe('gpt-x');

    await runAgent(base({ readOnly: true, addDirs: ['/run/machines/other'] }));
    ({ args } = asked());
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
    expect(args).not.toContain('--add-dir');
  });

  it('finds the JSON in an answer that wraps it in words', async () => {
    fakeCodex(`answer('Here you go:\\n\`\`\`json\\n{"ok": true}\\n\`\`\`');`);
    expect((await runAgent(base())).output).toEqual({ ok: true });
  });

  it('keeps the text when the answer is not JSON, with no output', async () => {
    fakeCodex(`answer('I could not do it.');`);
    const r = await runAgent(base());
    expect(r.output).toBeUndefined();
    expect(r.text).toBe('I could not do it.');
  });

  it('reports the exit code and what it printed when it fails without an answer', async () => {
    fakeCodex(`console.error('not signed in'); process.exit(3);`);
    expect((await runAgent(base())).error).toBe('codex exited with code 3: not signed in');
  });

  it('is stopped at the time limit', async () => {
    fakeCodex(`setTimeout(() => {}, 20000);`);
    expect((await runAgent(base({ timeoutMs: 300 }))).error).toMatch(/timed out after/);
  });
});
