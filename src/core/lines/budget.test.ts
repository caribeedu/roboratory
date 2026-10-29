// The cost ceiling (D48): once what the runs of an engine have cost passes it, no new step starts, and the ones running finish.
import { buildFactory, strictMachine, LINE, line, piecesRun, quietFor, simMachine, startEngine, stateOf, until, whenDone } from '../../test/harness';

const steps = (n: number) => Array.from({ length: n }, (_, i) => `  - { id: s${i}, machine: s${i} }`).join('\n');
const machines = (n: number, cost: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`s${i}`, simMachine({ cost })]));

describe('The cost ceiling', () => {
  it('lets a line run to its end when what it costs stays under the ceiling', async () => {
    const { f } = buildFactory(line(steps(3)), machines(3, 0.1));
    const e = startEngine(f, { beltMs: 5, maxCostUsd: 1 });
    await e.run(LINE, {});
    await whenDone(e);
    expect(e.costSoFar).toBeCloseTo(0.3);
    expect(e.costCeilingHit).toBe(false);
  });

  it('starts no new step once the cost passes it, says so, and leaves the run where it stands', async () => {
    const { f } = buildFactory(line(steps(4)), machines(4, 0.4));
    const e = startEngine(f, { beltMs: 5, maxCostUsd: 0.5 });
    const hit = new Promise<number>((r) => e.once('budget', r));
    const id = await e.run(LINE, {});
    // the first step costs 0.4, the second takes it to 0.8, and the third never starts
    expect(await hit).toBeCloseTo(0.8);
    await quietFor(150);
    expect(piecesRun(e, id)).toEqual(['@intake', 's0', 's1']);
    expect(['s2', 's3'].map((p) => stateOf(e, p))).not.toContain('busy');
    expect(e.runSummaries()[0].status).toBe('running');
    expect(e.costCeilingHit).toBe(true);
    expect(e.logs.some((l) => /cost ceiling of US\$ 0\.50 is reached/.test(l.text))).toBe(true);
  });

  it('starts no retry of a step once the cost has passed it', async () => {
    const { f } = buildFactory(line('  - { id: a, machine: a }'), { a: strictMachine({ cost: 0.6, attempts: 3, output: { ok: false } }) });
    const e = startEngine(f, { beltMs: 5, maxCostUsd: 0.5 });
    await e.run(LINE, {});
    await until(() => stateOf(e, 'a') === 'fire');
    expect(e.costSoFar).toBeCloseTo(0.6);
    expect(e.lineView(LINE).pieces.a.error).toMatch(/Stopped at the cost ceiling after 1\/3 attempts/);
  });

  it('starts no retry of a step once the engine is disposed', async () => {
    const { f } = buildFactory(line('  - { id: a, machine: a }'), { a: strictMachine({ seconds: 1, attempts: 3, output: { ok: false } }) });
    const e = startEngine(f, { beltMs: 5 });
    await e.run(LINE, {});
    await until(() => stateOf(e, 'a') === 'busy');
    e.dispose();
    await quietFor(400);
    expect(e.logs.filter((l) => /attempt 2\/3/.test(l.text))).toEqual([]);
  });

  it('lets the steps that were running when the ceiling was reached finish', async () => {
    const wide = line('  - { id: a, machine: a }\n  - { id: b, machine: b, needs: ["@intake"] }\n  - { id: c, machine: c, needs: [a, b] }');
    const { f } = buildFactory(wide, { a: simMachine({ cost: 0.6, seconds: 1 }), b: simMachine({ cost: 0.6, seconds: 2 }), c: simMachine({ cost: 0.1 }) });
    const e = startEngine(f, { beltMs: 5, maxCostUsd: 0.5 });
    const id = await e.run(LINE, {});
    await until(() => e.costCeilingHit);
    // b was already working when a took the cost past the ceiling: it ends, and c does not start
    await until(() => piecesRun(e, id).includes('b'));
    await quietFor(150);
    expect(piecesRun(e, id)).not.toContain('c');
    expect(e.costSoFar).toBeCloseTo(1.2);
  });

  it('has no ceiling unless it is given one', async () => {
    const { f } = buildFactory(line(steps(2)), machines(2, 50));
    const e = startEngine(f);
    await e.run(LINE, {});
    await whenDone(e);
    expect(e.costCeilingHit).toBe(false);
  });
});
