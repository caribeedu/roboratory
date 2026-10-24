import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDemoFactory } from '../demo';
import { FactoryService } from '../service';

const services: FactoryService[] = [];
afterEach(() => { services.splice(0).forEach((s) => s.close()); });

function open() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-session-'));
  const root = createDemoFactory(path.join(dir, 'f'), path.join(dir, 'repos'));
  const svc = new FactoryService({ snapshot: () => {}, logs: () => {}, messages: () => {} });
  svc.open(root);
  services.push(svc);
  return { svc, root };
}

const MODEL = 'sectors/incidents/models/triage-to-mitigation';
const LINE = 'incidents/orders-api';

describe('build sessions', () => {
  it('undoes and redoes edits step by step', () => {
    const { svc } = open();
    svc.buildStart('incidents');
    let v = svc.buildApply({ op: 'insert', lineId: LINE, at: { from: 'mitigate', to: 'error-rate' }, kind: 'signal', id: 'smoke' });
    expect(v.canUndo).toBe(true);
    expect(v.changes.map((c) => c.path)).toEqual([`${MODEL}/line.yaml`]);
    v = svc.buildUndo();
    expect(v.changes).toEqual([]);
    expect(v.canRedo).toBe(true);
    v = svc.buildRedo();
    expect(v.factory.sectors.find((s) => s.id === 'incidents')!.lines[0].pieces.some((p) => p.id === 'smoke')).toBe(true);
  });

  it('saves the draft, warns when the summary comment may be stale, and writes new scripts executable', () => {
    const { svc, root } = open();
    const file = path.join(root, MODEL, 'line.yaml');
    fs.writeFileSync(file, `# Correlate, investigate, then mitigate.\n${fs.readFileSync(file, 'utf8')}`);
    svc.reload();
    svc.buildStart('incidents');
    svc.buildApply({ op: 'insert', lineId: LINE, at: { from: 'mitigate', to: 'error-rate' }, kind: 'signal', id: 'smoke' });
    const v = svc.buildApply({ op: 'writeFile', path: `${MODEL}/signals/smoke.sh`, content: '#!/bin/sh\nexit 0\n', executable: true });
    expect(v.changes.find((c) => c.path.endsWith('line.yaml'))!.staleComment).toBe(true);
    expect(v.blocked).toEqual([]);
    svc.buildSave();
    expect(fs.readFileSync(file, 'utf8')).toMatch(/^# Correlate, investigate, then mitigate\.\n/);
    expect(svc.factory!.sectors.find((s) => s.id === 'incidents')!.lines[0].model.pieces.some((p) => p.id === 'smoke')).toBe(true);
    if (process.platform !== 'win32') expect(fs.statSync(path.join(root, MODEL, 'signals/smoke.sh')).mode & 0o111).toBeTruthy();  // Windows has no executable bit
  });

  it('refuses to save while the problems listed are unfixed', () => {
    const { svc } = open();
    svc.buildStart('incidents');
    const v = svc.buildApply({ op: 'remove', lineId: LINE, pieceId: 'investigate' });
    expect(v.issues.map((i) => i.message)).toEqual(['"Correlate" has no belt out.', '"Confident?" has no input belt.']);
    expect(v.issues[0].lineIds).toEqual([LINE]);
    expect(() => svc.buildSave()).toThrow(/Fix the 2 problems/);
  });

  it('blocks saving and dispatching for a line with a run in progress, and not for other lines', async () => {
    const { svc } = open();
    await svc.run(LINE, { alert: 'ALT-1' });
    svc.buildStart('incidents');
    const v = svc.buildApply({ op: 'setPiece', lineId: LINE, pieceId: 'mitigate', label: 'Mitigate it' });
    expect(v.affected).toEqual([{ lineId: LINE, name: 'orders-api incidents', sectorId: 'incidents', running: true }]);
    expect(v.blocked[0]).toMatch(/Wait for the run in progress on orders-api incidents/);
    expect(() => svc.buildSave()).toThrow(/run in progress/);
    await expect(svc.run(LINE, { alert: 'ALT-2' })).rejects.toThrow(/unsaved changes in build mode/);
    // a line the draft does not touch still dispatches
    await expect(svc.run('releases/orders-api', { tag: 'v1' })).resolves.toBeTruthy();
  });

  it('detects a file changed on disk during the session and saves only with a choice', () => {
    const { svc, root } = open();
    svc.buildStart('incidents');
    const role = `${MODEL}/machines/mitigator/role.md`;
    svc.buildApply({ op: 'writeFile', path: role, content: 'mine\n' });
    fs.writeFileSync(path.join(root, role), 'theirs\n');
    expect(svc.buildView().changes.find((c) => c.path === role)!.conflict).toBe(true);
    expect(() => svc.buildSave()).toThrow(/changed on disk during this session/);
    svc.buildSave({ [role]: 'disk' });
    expect(fs.readFileSync(path.join(root, role), 'utf8')).toBe('theirs\n');
  });

  describe("a manager's change to a line", () => {
    const SCOPE = { kind: 'sector', sectorId: 'incidents' } as const;
    /** asks the sector manager for a change, as a person would, and returns where to accept it */
    const proposal = async (svc: FactoryService) => {
      await svc.ask(SCOPE, 'add a smoke signal');
      const msg = svc.messages(SCOPE).at(-1)!;
      return { msg: msg.id, proposal: msg.proposals![0].id };
    };
    const lineHasSmoke = (root: string) => fs.readFileSync(path.join(root, MODEL, 'line.yaml'), 'utf8').includes('smoke');

    it('waits while build mode is open', async () => {
      const { svc, root } = open();
      const p = await proposal(svc);
      svc.buildStart('incidents');
      await expect(svc.accept(SCOPE, p.msg, p.proposal)).rejects.toThrow(/Finish build mode first/);
      expect(lineHasSmoke(root)).toBe(false);

      svc.buildDiscard();
      await svc.accept(SCOPE, p.msg, p.proposal);
      expect(lineHasSmoke(root)).toBe(true);
    });

    it('waits while the line it changes has a run in progress', async () => {
      const { svc, root } = open();
      const p = await proposal(svc);
      await svc.run(LINE, { alert: 'ALT-1' });
      await expect(svc.accept(SCOPE, p.msg, p.proposal)).rejects.toThrow(/run in progress on orders-api incidents/);
      expect(lineHasSmoke(root)).toBe(false);
    });
  });

  it('keeps scripts executable when a model is separated', () => {
    const { svc, root } = open();
    fs.writeFileSync(path.join(root, MODEL, 'signals/ok.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    svc.buildStart('incidents');
    svc.buildApply({ op: 'separateModel', lineId: LINE, model: 'mine' });
    svc.buildSave();
    if (process.platform !== 'win32') expect(fs.statSync(path.join(root, 'sectors/incidents/models/mine/signals/ok.sh')).mode & 0o111).toBeTruthy();
  });

  it('reports a file added on disk inside a folder the draft removes, and a refused save leaves the draft alone', () => {
    const { svc, root } = open();
    svc.buildStart('releases');
    svc.buildApply({ op: 'removeLine', lineId: 'releases/orders-api' });
    svc.buildApply({ op: 'removeModel', sectorId: 'releases', model: 'ship-to-prod' });
    fs.writeFileSync(path.join(root, 'sectors/releases/models/ship-to-prod/NOTES.md'), 'mine\n');
    expect(svc.buildView().changes.length).toBeGreaterThan(0);
    expect(() => svc.buildSave()).toThrow(/NOTES\.md/);
    const before = svc.buildView().changes.length;
    expect(() => svc.buildSave({ 'sectors/releases/models/ship-to-prod/NOTES.md': 'disk' })).not.toThrow();
    expect(fs.existsSync(path.join(root, 'sectors/releases/models/ship-to-prod/NOTES.md'))).toBe(true);
    expect(before).toBeGreaterThan(0);
  });

  it('applies the dispatch lock to every way a run starts', async () => {
    const { svc } = open();
    svc.buildStart('incidents');
    svc.buildApply({ op: 'setPiece', lineId: LINE, pieceId: 'mitigate', label: 'Mitigate it' });
    await expect(svc.engine!.run(LINE, { alert: 'ALT-3' }, 'Incidents Manager')).rejects.toThrow(/unsaved changes in build mode/);
  });

  it('refuses a new or separated model named like a shared one, and counts a batch or a no-op once', () => {
    const { svc } = open();
    svc.buildStart('engineering');
    expect(() => svc.buildApply({ op: 'newLine', sectorId: 'engineering', id: 'billing', name: 'Billing', model: 'ticket-to-pr', newModel: true })).toThrow(/shared model/);
    expect(() => svc.buildApply({ op: 'separateModel', lineId: 'engineering/orders-api', model: 'ticket-to-pr' })).toThrow(/shared model/);
    expect(svc.buildView().changes).toEqual([]);
    const v = svc.buildApply({ op: 'batch', ops: [
      { op: 'writeFile', path: 'shared/roles/new.md', content: '# new\n' },
      { op: 'writeFile', path: 'shared/roles/other.md', content: '# other\n' },
    ] });
    expect(v.changes).toHaveLength(2);
    svc.buildApply({ op: 'writeFile', path: 'shared/roles/new.md', content: '# new\n' });
    expect(svc.buildUndo().changes).toEqual([]);
  });
});
