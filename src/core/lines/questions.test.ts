// A machine can ask you, or say it is blocked. What you answer, decide and retry is told to the machines that follow.
import {
  buildFactory, errorOf, eventsOf, fakeClaude, claudeMachine, LINE, line, simMachine, startEngine, whenDone, whenState,
} from '../../test/harness';

describe('Questions and blocks', () => {
  describe('when a machine needs you', () => {
    const asker = simMachine({ attempts: 1, ask: { question: 'Which service?', options: ['orders-api', 'storefront'], recommendation: 'orders-api' }, output: { ok: true, answer: '{{box.human_answer.answer}}' } });

    it('parks it with its question in the attention queue, and reruns it with your answer without spending an attempt', async () => {
      const { f } = buildFactory(line('  - { id: a, machine: asker }'), { asker });
      const e = startEngine(f);
      await e.run(LINE, {});
      await whenState(e, 'a', 'asking');
      expect(e.lineView(LINE).pieces.a.question).toMatchObject({ question: 'Which service?', recommendation: 'orders-api' });
      expect(e.attention()[0]).toMatchObject({ kind: 'question', pieceId: 'a' });

      e.answer(LINE, 'a', 'orders-api');
      await whenDone(e);
      expect(e.runSummaries()[0].deliverable).toMatchObject({ answer: 'orders-api' });
    });

    it('refuses an empty answer', async () => {
      const { f } = buildFactory(line('  - { id: a, machine: asker }'), { asker });
      const e = startEngine(f);
      await e.run(LINE, {});
      await whenState(e, 'a', 'asking');
      expect(() => e.answer(LINE, 'a', '   ')).toThrow(/Write an answer/);
    });
  });

  describe('when a machine is blocked by something outside it', () => {
    it('sets it on fire at once without spending its attempts, and a retry goes on', async () => {
      const qa = simMachine({ attempts: 3, outputs: [{ blocked: { reason: 'dev-main is down' } }, { ok: true }] });
      const { f } = buildFactory(line('  - { id: qa, machine: qa }'), { qa });
      const e = startEngine(f);
      const id = await e.run(LINE, {});
      await whenState(e, 'qa', 'fire');
      expect(errorOf(e, 'qa')).toBe('Blocked: dev-main is down');
      expect(eventsOf(e, id, 'piece.start')).toHaveLength(1);

      e.retry(LINE, 'qa', 'it is back');
      await whenDone(e);
    });
  });

  describe('what the machines are told about what you did', () => {
    // the agent here is the real adapter pointed at a fake CLI, so what a machine is told is what the CLI receives
    it('counts a retry and an answer as the same pass of a machine, and lists them in order', async () => {
      const claude = fakeClaude((n) => (n === 0 ? { needs_human: { question: 'Which?' } } : n === 1 ? { nope: 1 } : { ok: true }));
      const work = claudeMachine({ 'contract.json': '{"type":"object","required":["ok"]}', 'machine.yaml': 'agent: claude\nattempts: 1\n' });
      const { f } = buildFactory(line('  - { id: a, label: Work, machine: work }'), { work });
      const e = startEngine(f);
      await e.run(LINE, {});
      await whenState(e, 'a', 'asking');
      e.answer(LINE, 'a', 'this one');
      await whenState(e, 'a', 'fire');
      e.retry(LINE, 'a', 'try again');
      await whenDone(e);

      const last = claude.calls().at(-1)!.prompt;
      expect(last).toContain('- Work, pass 1: asked "Which?"; the human answered "this one".');
      expect(last.indexOf('the human answered "this one"')).toBeLessThan(last.indexOf('the human retried it with the hint "try again"'));
      expect(last).toContain('- Work, pass 1: the human retried it with the hint "try again".');
    });

    it('lists each decision with the pass of the gate it was on, so the next lap sees both', async () => {
      const claude = fakeClaude({ plan: 'v' });
      const plan = claudeMachine();
      const { f } = buildFactory(
        line(`  - { id: plan, machine: plan, needs: ["@intake", { from: ok, when: "decision.choice == 'revise'", back: true, laps: 3 }] }
  - { id: ok, label: Approve, gate: { choices: [approve, revise] } }`, `pallet: { needs: [{ from: ok, when: "decision.choice == 'approve'" }] }`),
        { plan },
      );
      const e = startEngine(f);
      await e.run(LINE, {});
      await whenState(e, 'ok', 'holding');
      e.release(LINE, 'ok', 1, 'you', { choice: 'revise', note: 'use v2' });
      await claude.waitForCalls(2);
      await whenState(e, 'ok', 'holding');
      e.release(LINE, 'ok', 1, 'you', { choice: 'revise', note: 'use v3' });
      await claude.waitForCalls(3);
      await whenState(e, 'ok', 'holding');
      e.release(LINE, 'ok', 1, 'you', { choice: 'approve' });
      await whenDone(e);

      const third = claude.calls()[2].prompt;
      const first = third.indexOf('- Approve, pass 1: the human chose "revise" with the note "use v2".');
      const second = third.indexOf('- Approve, pass 2: the human chose "revise" with the note "use v3".');
      expect(first).toBeGreaterThan(-1);
      expect(second).toBeGreaterThan(first);
    });
  });
});
