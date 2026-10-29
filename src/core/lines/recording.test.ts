// What a run writes down for the metrics (D47): the version of each machine piece when it starts, and what a step used when it ends.
import fs from 'node:fs';
import path from 'node:path';
import { buildFactory, claudeMachine, eventsOf, LINE, line, simMachine, startEngine, tmpDir, whenDone } from '../../test/harness';
import { pieceVersion } from '../version';

/** An agent CLI whose result carries the usage a real one reports. */
function claudeWithUsage() {
  const bin = path.join(tmpDir('fake-usage-'), 'claude');
  fs.writeFileSync(bin, `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'result', subtype: 'success', result: '', total_cost_usd: 0.0123,
  usage: { input_tokens: 1200, output_tokens: 340, cache_read_input_tokens: 5000, cache_creation_input_tokens: 800 },
  modelUsage: { 'claude-haiku-9': { costUSD: 0.0100 }, 'claude-opus-9': { costUSD: 0.0023 } },
  structured_output: { result: { ok: true } } }));
`);
  fs.chmodSync(bin, 0o755);
  const before = process.env.ROBORATORY_CLAUDE_BIN;
  process.env.ROBORATORY_CLAUDE_BIN = bin;
  return () => { if (before === undefined) delete process.env.ROBORATORY_CLAUDE_BIN; else process.env.ROBORATORY_CLAUDE_BIN = before; };
}

describe('What a run records for the metrics', () => {
  it('writes the version of a machine piece in its piece.start, and none for a signal', async () => {
    const { f } = buildFactory(line('  - { id: a, machine: a }\n  - { id: check, signal: { run: "true" } }'), { a: simMachine() });
    const e = startEngine(f);
    const id = await e.run(LINE, {});
    await whenDone(e, id);

    const starts = eventsOf(e, id, 'piece.start');
    expect(starts.find((s) => s.piece === 'a')!.version).toBe(pieceVersion(f, f.sectors[0].lines[0], 'a'));
    expect(starts.find((s) => s.piece === 'check')!.version).toBeUndefined();
  });

  it("writes the model and the tokens of a step in its cost, from the agent's own report, with the model that did most of the work", async () => {
    const restore = claudeWithUsage();
    try {
      const { f } = buildFactory(line('  - { id: a, machine: a }'), { a: claudeMachine() });
      const e = startEngine(f);
      const id = await e.run(LINE, {});
      await whenDone(e, id);
      expect(eventsOf(e, id, 'cost')).toEqual([expect.objectContaining({
        piece: 'a', usd: 0.0123, model: 'claude-haiku-9', tokens: { input: 1200, output: 340, cacheRead: 5000, cacheWrite: 800 },
      })]);
    } finally { restore(); }
  });

  it('writes no cost for the simulated agent, which has none', async () => {
    const { f } = buildFactory(line('  - { id: a, machine: a }'), { a: simMachine() });
    const e = startEngine(f);
    const id = await e.run(LINE, {});
    await whenDone(e, id);
    expect(eventsOf(e, id, 'cost')).toEqual([]);
  });
});
