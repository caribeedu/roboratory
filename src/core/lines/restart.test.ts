// Restarting: the floor is rebuilt from the run files, and the engine can pause to restart without losing a step.
import {
  buildFactory, eventsOf, LINE, line, quietFor, restartEngine, simMachine, startEngine, stateOf, statusOf, strictMachine, until,
  whenDone, whenState,
} from '../../test/harness';

describe('Restarting the engine', () => {
  describe('after a stop', () => {
    it('restores the floor from the run files: the gate still holds, the last box is back, and the run goes on', async () => {
      const { f, root } = buildFactory(line('  - { id: m, machine: m }\n  - { id: g, gate: { confirmations: 1 } }'), { m: strictMachine() });
      const e = startEngine(f);
      const id = await e.run(LINE, {});
      await whenState(e, 'g', 'holding');

      e.dispose();
      const again = restartEngine(root);
      expect(stateOf(again, 'g')).toBe('holding');
      expect(again.lineView(LINE).pieces.m.lastBox).toEqual({ ok: true });
      again.release(LINE, 'g', 1);
      await until(() => statusOf(again, id) === 'done');
    });

    it('remembers a halted line, and finishes the runs that were started while it was halted', async () => {
      const { f, root } = buildFactory(line('  - { id: g, gate: { confirmations: 1 } }'), {});
      const e = startEngine(f);
      e.halt(LINE);
      const id = await e.run(LINE, {});

      e.dispose();
      const again = restartEngine(root);
      expect(again.lineView(LINE).halted).toBe(true);
      again.resume(LINE);
      await whenState(again, 'g', 'holding');
      expect(again.lineView(LINE).pieces.g.runId).toBe(id);
    });
  });

  describe('when it pauses to restart', () => {
    // a is slow enough to still be running when the pause starts
    const twoSteps = () => buildFactory(line('  - { id: a, machine: a }\n  - { id: b, machine: b }\n  - { id: ok, label: OK, gate: {} }'), {
      a: simMachine({ seconds: 40 }), b: simMachine(),
    });

    it('lets the busy step finish, starts nothing new, and refuses new runs', async () => {
      const e = startEngine(twoSteps().f);
      const id = await e.run(LINE, {});
      await until(() => e.runningCount() === 1);
      e.pauseDispatch();
      await until(() => e.runningCount() === 0);

      const started = () => eventsOf(e, id, 'piece.start').map((x) => x.piece);
      expect(started()).toEqual(['a']);
      await quietFor(100);
      expect(started()).toEqual(['a']);
      expect(stateOf(e, 'b')).toBe('idle');
      await expect(e.run(LINE, {})).rejects.toThrow(/restarting/);

      e.resumeDispatch();
      await whenState(e, 'ok', 'holding');
      expect(started()).toEqual(['a', 'b']);
    });

    it('comes back after the restart with the gate holding and no step on fire', async () => {
      const { f, root } = twoSteps();
      const e = startEngine(f);
      const id = await e.run(LINE, {});
      await until(() => e.runningCount() === 1);
      e.pauseDispatch();
      await until(() => e.runningCount() === 0);

      e.dispose();
      const again = restartEngine(root);
      await whenState(again, 'ok', 'holding');
      expect(Object.values(again.lineView(LINE).pieces).some((p) => p.state === 'fire')).toBe(false);
      again.release(LINE, 'ok', 1);
      await until(() => statusOf(again, id) === 'done');
      expect(eventsOf(again, id, 'piece.start').map((x) => x.piece)).toEqual(['a', 'b']);
    });

    it('refuses an answer or a retry, since neither would survive the restart', async () => {
      const asker = simMachine({ attempts: 1, ask: { question: 'Which?' } });
      const flaky = strictMachine({ attempts: 1, failFirstRun: true, badOutput: { ok: false } });
      const { f } = buildFactory(line('  - { id: ask, machine: asker }\n  - { id: flaky, machine: flaky }'), { asker, flaky });
      const e = startEngine(f);
      await e.run(LINE, {});
      await whenState(e, 'ask', 'asking');
      e.pauseDispatch();
      expect(() => e.answer(LINE, 'ask', 'this one')).toThrow(/restarting/);
      e.resumeDispatch();
      e.answer(LINE, 'ask', 'this one');

      await whenState(e, 'flaky', 'fire');
      e.pauseDispatch();
      expect(() => e.retry(LINE, 'flaky', 'again')).toThrow(/restarting/);
      e.resumeDispatch();
      e.retry(LINE, 'flaky', 'again');
      await whenDone(e);
    });

  });
});
