// Signals: scripts that check a box. A failing one stops the line or sends the work back; a slow one catches fire.
import fs from 'node:fs';
import path from 'node:path';
import { loadFactory } from '../factory';
import {
  buildFactory, errorOf, eventsOf, LINE, line, restartEngine, simMachine, startEngine, tmpDir, until, whenDone, whenState, writeFiles,
} from '../../test/harness';

const dev = simMachine({ output: { built: true, saw: '{{box.feedback.signal_output}}' } });
// fails the first time it runs in a run, passes after
const flakyOnce = { 'sectors/s/models/m/signals/once.sh': '#!/bin/sh\ntest -f "$ROBORATORY_RUN_DIR/once" && exit 0\ntouch "$ROBORATORY_RUN_DIR/once"; echo "lint broke"; exit 1\n' };
const sawBy = (e: ReturnType<typeof startEngine>, id: string) => eventsOf(e, id, 'piece.done', 'dev').map((x) => (x.box as { saw: string }).saw);

describe('Signals', () => {
  describe('when a signal fails', () => {
    it('stops the line at it and puts it in the attention queue', async () => {
      const { f } = buildFactory(line('  - { id: sig, signal: { run: "echo nope; exit 3" } }'), {});
      const e = startEngine(f);
      await e.run(LINE, {});
      await whenState(e, 'sig', 'fire');
      expect(errorOf(e, 'sig')).toBe('exited with 3: nope');
      expect(e.attention()[0].kind).toBe('signal');
    });

    describe('and a return belt takes the box', () => {
      const withBelt = (laps: number, files = {}) => buildFactory(
        line(`  - { id: dev, machine: dev, needs: ["@intake", { from: checks, when: "signal == 'fail'", back: true, laps: ${laps} }] }\n  - { id: checks, signal: { run: "signals/once.sh" } }`),
        { dev }, { ...flakyOnce, ...files },
      );

      it('sends the work back with what the signal printed, and delivers once it passes', async () => {
        const e = startEngine(withBelt(2).f);
        const id = await e.run(LINE, {});
        await whenDone(e);

        expect(eventsOf(e, id, 'rework')).toMatchObject([{ from: 'checks', to: 'dev', lap: 1 }]);
        expect(sawBy(e, id)).toEqual(['', 'lint broke\nexited with 1: lint broke']);
        expect(e.runSummaries()[0].deliverable).toMatchObject({ built: true });
        expect(e.runSummaries()[0].deliverable).not.toHaveProperty('signal');
      });

      it('sets the machine on fire once the signal has used the laps', async () => {
        const { f } = buildFactory(
          line(`  - { id: dev, machine: dev, needs: ["@intake", { from: checks, when: "signal == 'fail'", back: true, laps: 1 }] }\n  - { id: checks, signal: { run: "echo red; exit 1" } }`),
          { dev },
        );
        const e = startEngine(f);
        await e.run(LINE, {});
        await whenState(e, 'dev', 'fire');
        expect(errorOf(e, 'dev')).toMatch(/1 rework lap used and Checks still sends it back/);
      });

      it('still delivers the box that was on the belt if the engine restarted meanwhile', async () => {
        const { f, root } = withBelt(3);
        const e = startEngine(f, { beltMs: 400 });
        const id = await e.run(LINE, {});
        await until(() => e.lineView(LINE).boxes.some((b) => b.id.endsWith('<')));

        e.dispose();
        const again = restartEngine(root);
        await whenDone(again, id);
        expect(sawBy(again, id)).toEqual(['', 'lint broke\nexited with 1: lint broke']);
        expect(eventsOf(again, id, 'piece.done', 'checks').find((x) => x.failed)).toBeDefined();
      });
    });
  });

  describe('when a signal is too slow', () => {
    it('stops it at its own time limit and sets it on fire, even if a return belt could take the box', async () => {
      const { f } = buildFactory(
        line(`  - { id: dev, machine: dev, needs: ["@intake", { from: sig, when: "signal == 'fail'", back: true }] }\n  - { id: sig, signal: { run: "sleep 20; echo late", timeout: 300ms } }`),
        { dev },
      );
      expect(f.sectors[0].lines[0].model.pieces.find((p) => p.id === 'sig')).toMatchObject({ timeout: '300ms', timeoutMs: 300 });
      const e = startEngine(f);
      await e.run(LINE, {});
      await whenState(e, 'sig', 'fire');
      expect(errorOf(e, 'sig')).toBe('timed out after 300ms');
    });

    it('is reported when the time limit is not a duration', () => {
      const dir = tmpDir();
      writeFiles(dir, {
        'factory.yaml': 'name: T\n', 'sectors/s/sector.yaml': 'name: S\n', 'sectors/s/lines.yaml': 'lines:\n  - { id: l, model: m }\n',
        'sectors/s/models/m/line.yaml': line('  - { id: sig, signal: { run: "true", timeout: soon } }'),
      });
      expect(loadFactory(dir, { tolerant: true }).problems?.map((p) => p.message)).toEqual(['signal "sig": timeout "soon" is not a duration like 90s, 40m or 2h']);
      expect(fs.existsSync(path.join(dir, '.runs'))).toBe(false);
    });
  });
});
