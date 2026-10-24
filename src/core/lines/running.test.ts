// Running a production line: what happens to a work order from the intake to the pallet, and what you can do on the way.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadFactory } from '../factory';
import {
  buildFactory, errorOf, eventsOf, LINE, line, piecesRun, quietFor, simMachine, startEngine, stateOf, statusOf, strictMachine,
  until, whenDone, whenState,
} from '../../test/harness';

describe('Running a line', () => {
  describe('from the intake to the pallet', () => {
    it('chains a worktree per machine, runs a signal, waits at a two-confirmation gate and delivers to the pallet', async () => {
      const { f, dir } = buildFactory(
        line(`  - { id: a, machine: writer-a }
  - { id: b, machine: writer-b }
  - { id: check, signal: { run: "signals/has-b.sh {{box.ok}}" } }
  - { id: gate, gate: { confirmations: 2 } }`).replace('intake: { kind: manual }', 'intake: { kind: manual, inputs: [{ name: ticket, required: true }] }'),
        {
          'writer-a': strictMachine({ write: { 'A.md': 'from a {{box.ticket}}' }, commit: 'a' }),
          'writer-b': strictMachine({ write: { 'B.md': 'from b' } }),
        },
        { 'sectors/s/models/m/signals/has-b.sh': '#!/bin/sh\ntest -f A.md && test -f B.md && echo "both there ($1)"\n' },
        true,
      );
      const e = startEngine(f);

      await expect(e.run(LINE, {})).rejects.toThrow(/Missing input: ticket/);
      const runId = await e.run(LINE, { ticket: 'T-1' });
      await whenState(e, 'gate', 'holding');
      expect(() => e.release(LINE, 'gate', 1)).toThrow(/needs 2 confirmations/);
      e.release(LINE, 'gate', 2);
      await whenDone(e);

      expect(e.runSummaries()[0].deliverable).toMatchObject({ ok: true });
      expect(e.lineView(LINE).pieces['@pallet'].pallet).toBe(1);
      // the second machine started from the first one's branch, and its leftover file was committed for it
      const bDir = path.join(f.root, '.runs/s/l', runId, 'machines/b');
      expect(fs.readFileSync(path.join(bDir, 'A.md'), 'utf8')).toBe('from a T-1');
      const history = execFileSync('git', ['log', '--format=%s', `roboratory/${runId}/b`], { cwd: path.join(dir, 'repo') }).toString();
      expect(history.split('\n')[0]).toMatch(/B: work left uncommitted/);
      expect(history).toContain('a\n');
      // the broker's box file never lands in the target repository
      const tracked = execFileSync('git', ['ls-tree', '-r', '--name-only', `roboratory/${runId}/b`], { cwd: path.join(dir, 'repo') }).toString();
      expect(tracked).not.toContain('box.json');
      // the run file tells the story, ending in the delivery, and the release is recorded with who gave it
      const types = e.runEvents(runId).map((x) => x.type);
      expect(types[0]).toBe('run.start');
      expect(types.at(-1)).toBe('run.end');
      expect(eventsOf(e, runId, 'verb').find((x) => x.verb === 'release')).toMatchObject({ actor: 'you', confirmations: 2 });
    });

    it('leaves a branch alone when the box does not take it, even through a join', async () => {
      const { f } = buildFactory(
        line(`  - { id: triage, machine: t }
  - { id: plan, machine: p, needs: [{ from: triage, when: "type == 'bug'" }] }
  - { id: answer, machine: a, needs: [{ from: triage, when: "type == 'question'" }] }`, 'pallet: { needs: [plan, answer] }'),
        { t: simMachine({ output: { type: 'question' } }), p: strictMachine(), a: strictMachine({ output: { ok: true, answered: 'yes' } }) },
      );
      const e = startEngine(f);
      const id = await e.run(LINE, {});
      await whenDone(e);
      expect(e.runSummaries()[0].deliverable).toMatchObject({ answered: 'yes' });
      expect(piecesRun(e, id, 'piece.skip')).toEqual(['plan']);
    });
  });

  describe('when a machine cannot produce what its contract asks', () => {
    it('sets it on fire when the attempts run out, says so in the attention queue, and a retry recovers it', async () => {
      const { f } = buildFactory(line('  - { id: inv, machine: inv }'), {
        inv: strictMachine({ failFirstRun: true, badOutput: { ok: false }, attempts: 2 }),
      });
      const e = startEngine(f);
      await e.run(LINE, {});
      await whenState(e, 'inv', 'fire');
      expect(errorOf(e, 'inv')).toMatch(/2\/2 attempts used.*must be equal to constant/);
      expect(e.attention()[0]).toMatchObject({ kind: 'fire', pieceId: 'inv', severity: 3 });

      e.retry(LINE, 'inv', 'try harder');
      await whenDone(e);
      expect(e.attention()).toEqual([]);
    });

    it('sets the next machine on fire when two branches changed the same file, and keeps failing on a retry rather than dropping one', async () => {
      const { f } = buildFactory(
        line(`  - { id: x, machine: x }
  - { id: y, machine: y, needs: ["@intake"] }
  - { id: z, machine: z, needs: [x, y] }`),
        {
          x: strictMachine({ write: { 'README.md': 'x side' } }),
          y: strictMachine({ write: { 'README.md': 'y side' } }),
          z: strictMachine(),
        },
        {}, true,
      );
      const e = startEngine(f);
      await e.run(LINE, {});
      await whenState(e, 'z', 'fire');
      expect(errorOf(e, 'z')).toMatch(/merge conflict.*README\.md/);

      e.retry(LINE, 'z');
      await until(() => stateOf(e, 'z') === 'fire' && errorOf(e, 'z')?.includes('merge conflict') === true);
    });
  });

  describe('when you halt it', () => {
    it('holds new work where it stands until you resume', async () => {
      const { f } = buildFactory(line('  - { id: g, gate: { confirmations: 1 } }'), {});
      const e = startEngine(f);
      e.halt(LINE);
      await e.run(LINE, {});
      await quietFor(60);
      expect(stateOf(e, 'g')).toBe('idle');

      e.resume(LINE);
      await whenState(e, 'g', 'holding');
    });
  });

  describe('when the factory files change under a run', () => {
    it('keeps running after a reload removes a piece the run is using', async () => {
      const { f, root } = buildFactory(line('  - { id: a, machine: a }\n  - { id: g, gate: { confirmations: 1 } }'), { a: strictMachine() });
      const e = startEngine(f);
      const errors: unknown[] = [];
      const record = (err: unknown) => errors.push(err);
      process.on('uncaughtException', record);
      try {
        await e.run(LINE, {});
        fs.writeFileSync(path.join(root, 'sectors/s/models/m/line.yaml'), line('  - { id: a, machine: a }'));
        e.reload(loadFactory(root));
        await until(() => stateOf(e, 'g') === 'holding');
      } finally { process.off('uncaughtException', record); }
      expect(errors).toEqual([]);
    });
  });

  describe('when a run is stopped', () => {
    it('is not a delivery, before or after a restart', async () => {
      const { f, root } = buildFactory(line('  - { id: a, machine: a, needs: [{ from: "@intake", when: "go == true" }] }'), { a: strictMachine() });
      const e = startEngine(f);
      await e.run(LINE, { go: false });
      await until(() => statusOf(e) === 'stopped');
      expect(e.lineView(LINE).pieces['@pallet'].pallet).toBe(0);

      e.dispose();
      const again = startEngine(loadFactory(root));
      again.restore();
      expect(again.lineView(LINE).pieces['@pallet'].pallet).toBe(0);
    });
  });
});
