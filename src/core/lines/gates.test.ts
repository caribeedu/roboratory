// Gates: a line waits for you at a gate, or for a rule over the box, and a decision gate routes on what you chose.
import { buildFactory, errorOf, eventsOf, LINE, line, piecesRun, simMachine, startEngine, strictMachine, whenDone, whenState } from '../../test/harness';

describe('Gates', () => {
  describe('a decision gate', () => {
    const build = () => buildFactory(
      line(`  - { id: decision, gate: { choices: [hotfix, monitor] } }
  - { id: fix, machine: fix, needs: [{ from: decision, when: "decision.choice == 'hotfix'" }] }
  - { id: watch, machine: watch, needs: [{ from: decision, when: "decision.choice == 'monitor'" }] }`, 'pallet: { needs: [fix, watch] }'),
      { fix: strictMachine({ output: { ok: true, note: '{{box.decision.note}}' } }), watch: strictMachine() },
    );

    it('refuses a release that does not name one of its choices', async () => {
      const e = startEngine(build().f);
      await e.run(LINE, {});
      await whenState(e, 'decision', 'holding');
      expect(() => e.release(LINE, 'decision', 1, 'you', { choice: 'nuke', note: '' })).toThrow(/not one of/);
      expect(() => e.release(LINE, 'decision', 1)).toThrow(/choose/);
    });

    it('sends the box down the chosen branch, skips the other, and hands your note to the next machine', async () => {
      const e = startEngine(build().f);
      const id = await e.run(LINE, {});
      await whenState(e, 'decision', 'holding');
      e.release(LINE, 'decision', 1, 'you', { choice: 'hotfix', note: 'only orders-api' });
      await whenDone(e);

      expect(e.runSummaries()[0].deliverable).toMatchObject({ note: 'only orders-api' });
      expect(piecesRun(e, id, 'piece.skip')).toEqual(['watch']);
      expect(eventsOf(e, id, 'verb').find((x) => x.verb === 'release')).toMatchObject({ choice: 'hotfix', note: 'only orders-api' });
    });
  });

  describe('a rule gate', () => {
    it('holds a box the rule does not accept, says so, and lets it through when you release it', async () => {
      const { f } = buildFactory(line(`  - { id: sure, gate: { rule: "confidence >= 0.7" } }
  - { id: after, machine: after }`), { after: simMachine() });
      const e = startEngine(f);
      await e.run(LINE, { confidence: 0.5 });
      await whenState(e, 'sure', 'holding');
      expect(errorOf(e, 'sure')).toMatch(/does not hold/);

      e.release(LINE, 'sure', 0);
      await whenDone(e);
    });

    it('lets a box through by itself when the rule accepts it', async () => {
      const { f } = buildFactory(line(`  - { id: sure, gate: { rule: "confidence >= 0.7" } }
  - { id: after, machine: after }`), { after: simMachine() });
      const e = startEngine(f);
      await e.run(LINE, { confidence: 0.9 });
      await whenDone(e);
    });
  });
});
