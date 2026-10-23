import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDemoFactory } from './demo';
import { FactoryService } from './service';

process.env.PROMPTORY_SIM_SPEED = '200';

describe('factory service', () => {
  it('opens a factory, snapshots it, and picks up a manager change after it is accepted', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptory-svc-'));
    const root = createDemoFactory(path.join(dir, 'factory'), path.join(dir, 'repos'));
    const snaps: number[] = [];
    const svc = new FactoryService({ snapshot: () => snaps.push(1), logs: () => {}, messages: () => {} });
    expect(() => svc.open(dir)).toThrow(/not a Promptory factory/);
    svc.open(root);
    const s = svc.snapshot();
    expect(s.factory!.sectors.map((x) => x.name)).toEqual(['Engineering', 'Incidents', 'Releases']);
    const plan = s.factory!.sectors[0].lines[0].pieces.find((p) => p.id === 'plan')!;
    expect(plan).toMatchObject({ agent: 'sim', sharedMachine: true, definedIn: 'shared/machines/planner', usedBy: { lines: 2, sectors: 1 } });
    await svc.ask({ kind: 'sector', sectorId: 'incidents' }, 'add a smoke signal');
    const msg = svc.messages({ kind: 'sector', sectorId: 'incidents' }).at(-1)!;
    await svc.accept({ kind: 'sector', sectorId: 'incidents' }, msg.id, msg.proposals![0].id);
    expect(svc.snapshot().factory!.sectors[1].lines[0].pieces.some((p) => p.id === 'smoke')).toBe(true);
    await new Promise((r) => setTimeout(r, 120));
    expect(snaps.length).toBeGreaterThan(0);
    svc.close();
    expect(svc.snapshot().factory).toBeNull();
  });
});
