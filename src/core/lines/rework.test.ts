// Rework: a checker sends work back along a return belt, within a limit, and the line picks up from there.
import {
  buildFactory, checker, errorOf, eventsOf, LINE, line, restartEngine, simMachine, startEngine, statusOf, until, whenDone, whenEnded,
  whenState,
} from '../../test/harness';

const dev = simMachine({ output: { built: true } });

describe('Rework', () => {
  const loop = (laps: number, extra = '') => line(
    `  - { id: dev, machine: dev, needs: ["@intake", { from: qa, when: "verdict == 'fail'", back: true, laps: ${laps} }] }\n  - { id: qa, machine: qa }\n${extra}`,
    `pallet: { needs: [{ from: qa, when: "verdict == 'pass'" }] }`,
  );

  describe('when a checker sends the work back', () => {
    it('runs the machine again with the findings, once per lap', async () => {
      const finder = simMachine({ output: { built: true, saw: '{{box.feedback.why}}' } });
      const qa = checker([{ verdict: 'fail', why: 'no test' }, 'pass']);
      const { f } = buildFactory(loop(2), { dev: finder, qa });
      const e = startEngine(f);
      const id = await e.run(LINE, {});
      await whenDone(e);

      expect(eventsOf(e, id, 'rework')).toHaveLength(1);
      const saw = eventsOf(e, id, 'piece.done', 'dev').map((x) => (x.box as { saw: string }).saw);
      expect(saw).toEqual(['', 'no test']);
    });

    it('sets the machine on fire when the laps run out, and says how many were used', async () => {
      const { f } = buildFactory(loop(1), { dev, qa: checker(['fail']) });
      const e = startEngine(f);
      await e.run(LINE, {});
      await whenState(e, 'dev', 'fire');
      expect(errorOf(e, 'dev')).toMatch(/1 rework lap used/);
    });

    it('lets a retry carry on after the laps ran out, and keeps the fire across a restart', async () => {
      const { f, root } = buildFactory(loop(1), { dev, qa: checker(['fail', 'fail', 'pass']) });
      const e = startEngine(f);
      const id = await e.run(LINE, {});
      await whenState(e, 'dev', 'fire');

      e.dispose();
      const again = restartEngine(root);
      expect(again.lineView(LINE).pieces.dev.state).toBe('fire');
      again.retry(LINE, 'dev');
      await whenEnded(again, id);
      expect(statusOf(again, id)).toBe('done');
    });
  });

  describe('when two checkers send the same piece back', () => {
    const twoCheckers = (slow = false) => buildFactory(
      line(`  - { id: t, machine: dev, needs: ["@intake", { from: a, when: "verdict == 'fail'", back: true, laps: 3 }, { from: b, when: "verdict == 'fail'", back: true, laps: 3 }] }
  - { id: a, machine: qa, needs: [t] }
  - { id: b, machine: ${slow ? 'slow' : 'qa2'}, needs: [t] }`, `pallet: { needs: [{ from: a, when: "verdict == 'pass'" }, { from: b, when: "verdict == 'pass'" }] }`),
      { dev, qa: checker(['fail', 'pass']), qa2: checker(['fail', 'pass']), slow: checker(['fail', 'pass'], { seconds: 120 }) },
    );

    it('reworks it once, with both findings, when they report together', async () => {
      const e = startEngine(twoCheckers().f);
      const id = await e.run(LINE, {});
      await whenDone(e);
      expect(eventsOf(e, id, 'piece.done', 't')).toHaveLength(2);
    });

    it('does not rework it again for a verdict on its output from before the rework, and has that checker look again', async () => {
      // b is slow: it judges the first output of t after t was already reworked for a's finding
      const e = startEngine(twoCheckers(true).f);
      const id = await e.run(LINE, {});
      await whenDone(e, undefined, 20000);

      expect(eventsOf(e, id, 'piece.done', 't')).toHaveLength(2);
      expect(eventsOf(e, id, 'piece.start', 'b')).toHaveLength(2); // the old verdict was dropped, the new one counted
      expect(eventsOf(e, id, 'rework')).toHaveLength(1);
    });
  });

  describe('when a rework changes which branch the line takes', () => {
    it('keeps a join input that comes from outside the reworked stretch', async () => {
      const { f } = buildFactory(
        line(`  - { id: t, machine: dev, needs: ["@intake", { from: qa, when: "verdict == 'fail'", back: true, laps: 3 }] }
  - { id: x, machine: dev, needs: ["@intake"] }
  - { id: j, gate: { rule: "built == true" }, needs: [t, x] }
  - { id: qa, machine: qa }`, `pallet: { needs: [{ from: qa, when: "verdict == 'pass'" }] }`),
        { dev, qa: checker(['fail', 'pass']) },
      );
      const e = startEngine(f);
      await e.run(LINE, {});
      await whenDone(e);
    });

    it('forgets a skip from the first lap when a reworked gate takes the other branch', async () => {
      const { f } = buildFactory(
        line(`  - { id: dev, machine: dev, needs: ["@intake", { from: chk, when: "verdict == 'fail'", back: true, laps: 3 }] }
  - { id: g, gate: { choices: [test, skip] } }
  - { id: chk, machine: qa, needs: [{ from: g, when: "decision.choice == 'test'" }] }
  - { id: fin, machine: dev, needs: [{ from: g, when: "decision.choice == 'skip'" }, { from: chk, when: "verdict == 'pass'" }] }`, 'pallet: { needs: [fin] }'),
        { dev, qa: checker(['fail']) },
      );
      const e = startEngine(f);
      const id = await e.run(LINE, {});
      await whenState(e, 'g', 'holding');
      e.release(LINE, 'g', 1, 'me', { choice: 'test', note: '' });
      await until(() => eventsOf(e, id, 'rework').length > 0 && e.lineView(LINE).pieces.g.state === 'holding');
      e.release(LINE, 'g', 1, 'me', { choice: 'skip', note: '' });
      await whenEnded(e);
      expect(statusOf(e)).toBe('done');
    });

    describe('a piece skipped on the first lap that the rework now reaches', () => {
      const recheck = line(`  - { id: dev, machine: dev }
  - { id: ci, machine: qa, needs: [dev, { from: hold, when: "decision.choice == 'recheck'", back: true, laps: 2 }] }
  - { id: green, machine: dev, needs: [{ from: ci, when: "verdict == 'pass'" }] }
  - { id: hold, gate: { choices: [recheck, accept] }, needs: [{ from: ci, when: "verdict == 'fail'" }] }
  - { id: next, machine: dev, needs: [green, { from: hold, when: "decision.choice == 'accept'" }] }`, 'pallet: { needs: [next] }');

      it('runs it', async () => {
        const e = startEngine(buildFactory(recheck, { dev, qa: checker(['fail', 'pass']) }).f);
        const id = await e.run(LINE, {});
        await whenState(e, 'hold', 'holding');
        e.release(LINE, 'hold', 1, 'me', { choice: 'recheck', note: '' });
        await whenEnded(e);
        expect(statusOf(e)).toBe('done');
        expect(eventsOf(e, id, 'piece.done', 'green')).not.toHaveLength(0);
      });

      it('still runs it when the engine restarted after the rework', async () => {
        const { f, root } = buildFactory(recheck, { dev, qa: checker(['fail', 'pass']) });
        const e = startEngine(f);
        const id = await e.run(LINE, {});
        await whenState(e, 'hold', 'holding');
        e.release(LINE, 'hold', 1, 'me', { choice: 'recheck', note: '' });
        await until(() => eventsOf(e, id, 'rework').length > 0);

        e.dispose();
        const again = restartEngine(root);
        if (again.lineView(LINE).pieces.ci.state === 'fire') again.retry(LINE, 'ci'); // a step cut off by the restart
        await whenEnded(again, id);
        expect(statusOf(again, id)).toBe('done');
      });
    });
  });

  describe('when the engine restarts', () => {
    it('delivers a box that was on a return belt', async () => {
      const { f, root } = buildFactory(loop(3), { dev, qa: checker(['fail', 'pass']) });
      const e = startEngine(f, { beltMs: 400 });
      const id = await e.run(LINE, {});
      await until(() => e.lineView(LINE).boxes.some((b) => b.id.endsWith('<')));

      e.dispose();
      const again = restartEngine(root);
      expect(statusOf(again, id)).not.toBe('stopped');
    });
  });
});
