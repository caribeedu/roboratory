// How the pieces behave (D47): the metrics worked out from the runs' files. The runs here are real runs of the engine with the simulated
// agent; what the simulation does not produce (a cost, a permission request) is added to the run's events by hand.
import fs from 'node:fs';
import path from 'node:path';
import { buildFactory, checker, LINE, line, simMachine, startEngine, whenDone, whenState, type Built } from '../test/harness';
import type { Stats, StatsFilter } from '../shared/types';
import { visibleRows } from '../shared/statsview';
import { computeStats } from './stats';
import { pieceVersion } from './version';
import { loadFactory } from './factory';

type Engine = ReturnType<typeof startEngine>;
const runsOf = (e: Engine) => e.runSummaries().map((summary) => ({ summary, events: e.runEvents(summary.id) }));
const statsOf = (e: Engine, b: Built, filter?: StatsFilter): Stats => computeStats(b.f, runsOf(e), filter);
const piece = (s: Stats, id: string) => s.lines[0].pieces.find((p) => p.pieceId === id)!;
const row = (s: Stats, id: string) => piece(s, id).rows[0];

const loop = line(
  `  - { id: dev, machine: dev, needs: ["@intake", { from: qa, when: "verdict == 'fail'", back: true, laps: 3 }] }\n  - { id: qa, machine: qa }`,
  `pallet: { needs: [{ from: qa, when: "verdict == 'pass'" }] }`,
);

describe('Metrics', () => {
  it('ends the time of a step an engine restart interrupted where its record ends, not when it was started again', () => {
    const b = buildFactory(line('  - { id: a, machine: a }'), { a: simMachine() });
    const version = pieceVersion(b.f, b.f.sectors[0].lines[0], 'a');
    const events = [
      { t: 1000, type: 'piece.start', piece: 'a', attempt: 1, version },
      { t: 2000, type: 'cost', piece: 'a', usd: 0 },
      // the engine closed here; the step was started again a long time later
      { t: 100_000, type: 'piece.start', piece: 'a', attempt: 1, version },
      { t: 103_000, type: 'piece.done', piece: 'a' },
    ] as never[];
    const s = computeStats(b.f, [{ summary: { id: 'r', lineId: LINE, startedAt: 0 } as never, events }]);
    expect(row(s, 'a')).toMatchObject({ attempts: { mean: 2 }, duration: { median: 4000 } });
  });

  it('counts the attempts, the rework and the passes of a line that sent work back once', async () => {
    const b = buildFactory(loop, { dev: simMachine({ output: { built: true } }), qa: checker(['fail', 'pass']) });
    const e = startEngine(b.f);
    await e.run(LINE, {});
    await whenDone(e);

    const s = statsOf(e, b);
    expect(s.lines[0]).toMatchObject({ lineId: LINE, runs: 1 });
    expect(piece(s, 'dev')).toMatchObject({ checker: false });
    expect(row(s, 'dev')).toMatchObject({ runs: 1, reworks: 1, current: true, attempts: { mean: 2, max: 2 } });
    expect(piece(s, 'qa').checker).toBe(true);
    expect(row(s, 'qa')).toMatchObject({ passes: 1, provedWrong: 0 });
  });

  it('proves a pass wrong when a later checker sends the work back through it', async () => {
    const wire = line(
      `  - { id: dev, machine: dev, needs: ["@intake", { from: qa, when: "verdict == 'fail'", back: true, laps: 3 }, { from: final, when: "verdict == 'fail'", back: true, laps: 3 }] }\n  - { id: qa, machine: qa }\n  - { id: final, machine: final }`,
      `pallet: { needs: [{ from: final, when: "verdict == 'pass'" }] }`,
    );
    const b = buildFactory(wire, { dev: simMachine({ output: { built: true } }), qa: checker(['pass']), final: checker(['fail', 'pass']) });
    const e = startEngine(b.f);
    await e.run(LINE, {});
    await whenDone(e);

    const s = statsOf(e, b);
    // qa passed twice; the first pass was undone when final sent the box back through it
    expect(row(s, 'qa')).toMatchObject({ passes: 2, provedWrong: 1 });
    expect(row(s, 'final')).toMatchObject({ passes: 1, provedWrong: 0 });
  });

  it('proves a pass wrong when a piece further down then asks, is blocked or catches fire', async () => {
    const wire = line(`  - { id: dev, machine: dev, needs: ["@intake", { from: qa, when: "verdict == 'fail'", back: true, laps: 2 }] }\n  - { id: qa, machine: qa }\n  - { id: build, machine: build }`);
    const b = buildFactory(wire, { dev: simMachine(), qa: checker(['pass']), build: simMachine({ ask: { question: 'Which one?' } }) });
    const e = startEngine(b.f);
    await e.run(LINE, {});
    await whenState(e, 'build', 'asking');

    const s = statsOf(e, b);
    expect(row(s, 'qa')).toMatchObject({ passes: 1, provedWrong: 1 });
    expect(row(s, 'build')).toMatchObject({ questions: 1 });
  });

  it('counts a machine that caught fire', async () => {
    const b = buildFactory(line('  - { id: a, machine: a }'), { a: simMachine({ attempts: 1, output: {}, contract: { type: 'object', required: ['x'] } }) });
    const e = startEngine(b.f);
    await e.run(LINE, {});
    await whenState(e, 'a', 'fire');
    expect(row(statsOf(e, b), 'a')).toMatchObject({ fires: 1, attempts: { mean: 1 } });
  });

  describe('what the simulation does not produce, added to the events of a run', () => {
    const withEvents = async (extra: (id: string, t: number) => Record<string, unknown>[]) => {
      const b = buildFactory(line('  - { id: a, machine: a }'), { a: simMachine() });
      const e = startEngine(b.f);
      const id = await e.run(LINE, {});
      await whenDone(e);
      const t = e.runEvents(id).find((x) => x.type === 'piece.start' && x.piece === 'a')!.t as number;
      const file = path.join(b.root, '.runs', 's', 'l', id, 'run.jsonl');
      fs.appendFileSync(file, extra(id, t as number).map((x) => JSON.stringify(x)).join('\n') + '\n');
      return { b, e, id, s: statsOf(e, b) };
    };

    it('sums the cost and the tokens, and names the model', async () => {
      const { s } = await withEvents((_, t) => [
        { t, type: 'cost', piece: 'a', usd: 0.25, model: 'claude-haiku', tokens: { input: 100, output: 20, cacheRead: 5, cacheWrite: 1 } },
        { t, type: 'cost', piece: 'a', usd: 0.15, model: 'claude-haiku', tokens: { input: 50, output: 10, cacheRead: 0, cacheWrite: 0 } },
      ]);
      expect(row(s, 'a')).toMatchObject({ cost: { total: 0.4, median: 0.4 }, models: ['claude-haiku'], tokens: { input: 150, output: 30, cacheRead: 5, cacheWrite: 1 } });
      expect(s.lines[0].total).toMatchObject({ cost: 0.4, tokens: { input: 150 } });
    });

    it('counts the permission requests, those denied, the wait, and the allows that repeat a command already allowed in the run', async () => {
      const { s } = await withEvents((_, t) => [
        { t, type: 'permission.request', id: '1', piece: 'a', tool: 'Bash', summary: 'npm test' },
        { t, type: 'verb', verb: 'allow', actor: 'you', piece: 'a', tool: 'Bash', command: 'npm test' },
        { t, type: 'permission.decision', id: '1', piece: 'a', decision: 'allow', waitedMs: 4000 },
        { t, type: 'permission.request', id: '2', piece: 'a', tool: 'Bash', summary: 'npm test' },
        { t, type: 'verb', verb: 'allow', actor: 'you', piece: 'a', tool: 'Bash', command: 'npm test' },
        { t, type: 'permission.decision', id: '2', piece: 'a', decision: 'allow', waitedMs: 8000 },
        { t, type: 'permission.request', id: '3', piece: 'a', tool: 'Bash', summary: 'curl x' },
        { t, type: 'permission.decision', id: '3', piece: 'a', decision: 'deny', waitedMs: 2000 },
        { t, type: 'permission.denied', piece: 'a', tool: 'Bash', summary: 'rm -rf x', by: 'rm -rf' },
      ]);
      expect(row(s, 'a').permissions).toEqual({ requests: 3, repeated: 1, denied: 2, waitMedianMs: 4000 });
    });
  });

  describe('filters', () => {
    it('keeps the runs of one run id, one sector or one line, and drops runs older than the period', async () => {
      const b = buildFactory(line('  - { id: a, machine: a }'), { a: simMachine() });
      const e = startEngine(b.f);
      const first = await e.run(LINE, {});
      await whenDone(e);
      const second = await e.run(LINE, {});
      await whenDone(e, second);

      expect(statsOf(e, b).lines[0].runs).toBe(2);
      expect(row(statsOf(e, b), 'a').runs).toBe(2);
      expect(statsOf(e, b, { runId: first }).lines[0].runs).toBe(1);
      expect(statsOf(e, b, { lineId: 's/other' }).lines).toEqual([]);
      expect(statsOf(e, b, { sectorId: 'nowhere' }).lines).toEqual([]);
      expect(statsOf(e, b, { sectorId: 's' }).lines).toHaveLength(1);
      expect(statsOf(e, b, { since: Date.now() + 60_000 }).lines[0].runs).toBe(0);
    });
  });

  describe('versions', () => {
    const ranBefore = async () => {
      const b = buildFactory(line('  - { id: a, machine: a }'), { a: simMachine({ role: 'Be brief.' }) });
      const e = startEngine(b.f);
      await e.run(LINE, {});
      await whenDone(e);
      return { b, e };
    };

    it('counts what the runs of earlier versions cost in the line total, whichever versions are shown', async () => {
      const b = buildFactory(line('  - { id: a, machine: a }'), { a: simMachine({ role: 'Be brief.', cost: 0.2 }) });
      const e = startEngine(b.f);
      await e.run(LINE, {});
      await whenDone(e);
      fs.writeFileSync(path.join(b.root, 'sectors/s/models/m/machines/a/role.md'), 'Be thorough.');
      const changed = loadFactory(b.root);
      const shown = computeStats(changed, runsOf(e));
      expect(shown.lines[0].total.cost).toBeCloseTo(0.2);
      expect(computeStats(changed, runsOf(e), { allVersions: true }).lines[0].total.cost).toBeCloseTo(0.2);
    });

    it('starts a new version when the role changes, and keeps the earlier one as a row of its own', async () => {
      const { b, e } = await ranBefore();
      const before = row(statsOf(e, b), 'a').version;
      fs.writeFileSync(path.join(b.root, 'sectors/s/models/m/machines/a/role.md'), 'Be thorough.');
      const changed = { ...b, f: loadFactory(b.root) };

      const now = computeStats(changed.f, runsOf(e));
      expect(piece(now, 'a').currentVersion).not.toBe(before);
      // the current version has no runs, so the version before it is what is shown, and says so
      expect(piece(now, 'a').rows).toEqual([expect.objectContaining({ version: before, current: false, runs: 1 })]);
      const all = computeStats(changed.f, runsOf(e), { allVersions: true });
      expect(all.lines[0].pieces[0].rows).toHaveLength(1);
      expect(all.lines[0].pieces[0].rows[0]).toMatchObject({ version: before, current: false, runs: 1 });
      expect(visibleRows(all.lines[0].pieces[0])).toHaveLength(1);
    });

    it('is a version of the piece given what the agent receives, not what else changed in the factory', async () => {
      const { b, e } = await ranBefore();
      const before = pieceVersion(b.f, b.f.sectors[0].lines[0], 'a');
      // something that is not given to the machine
      fs.writeFileSync(path.join(b.root, 'sectors/s/lines.yaml'), fs.readFileSync(path.join(b.root, 'sectors/s/lines.yaml'), 'utf8') + '\n# a comment\n');
      fs.writeFileSync(path.join(b.root, 'README.md'), 'hello');
      expect(pieceVersion(loadFactory(b.root), loadFactory(b.root).sectors[0].lines[0], 'a')).toBe(before);
      expect(row(computeStats(loadFactory(b.root), runsOf(e)), 'a')).toMatchObject({ version: before, current: true });
    });

    it.each([
      ['its role', 'machines/a/role.md', () => 'Different role.'],
      ['its contract', 'machines/a/contract.json', () => '{"type":"object","properties":{"z":{"type":"string"}}}'],
      ['the culture of the factory', '../../../../culture.md', () => 'Be kind.'],
      ['the culture of the sector', '../../culture.md', () => 'Sector rule.'],
    ])('changes with %s', async (_, rel, content) => {
      const { b } = await ranBefore();
      const before = pieceVersion(b.f, b.f.sectors[0].lines[0], 'a');
      fs.writeFileSync(path.resolve(b.root, 'sectors/s/models/m', rel), content());
      const f = loadFactory(b.root);
      expect(pieceVersion(f, f.sectors[0].lines[0], 'a')).not.toBe(before);
    });

    it.each([
      ['its model', 'model: opus\n'],
      ['its effort', 'effort: high\n'],
      ['its allowed commands', 'allow: [npm test]\n'],
      ['its denied commands', 'deny: [rm -rf]\n'],
      ['read_only', 'read_only: true\n'],
      ['its attempts', 'attempts: 7\n'],
      ['its time limit', 'timeout: 3m\n'],
      ['its tools', 'tools: [mcp__x]\n'],
    ])('changes with %s', async (_, yaml) => {
      const { b } = await ranBefore();
      const before = pieceVersion(b.f, b.f.sectors[0].lines[0], 'a');
      const file = path.join(b.root, 'sectors/s/models/m/machines/a/machine.yaml');
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + yaml);
      const f = loadFactory(b.root);
      expect(pieceVersion(f, f.sectors[0].lines[0], 'a')).not.toBe(before);
    });

    it('changes with the place of the piece in the line, which the agent is told', async () => {
      const b = buildFactory(line('  - { id: a, machine: a }\n  - { id: b, machine: a, goal: Check it. }'), { a: simMachine() });
      const l = b.f.sectors[0].lines[0];
      expect(pieceVersion(b.f, l, 'a')).not.toBe(pieceVersion(b.f, l, 'b'));
      expect(pieceVersion(b.f, l, '@intake')).toBeNull();
    });
  });
});

void LINE;
