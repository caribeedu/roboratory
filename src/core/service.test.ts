import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EngineClient } from './client';
import { createDemoFactory } from './demo';
import { startServer } from './server';
import type { ManagerMessage, Snapshot } from '../shared/types';

process.env.ROBORATORY_SIM_SPEED = '200';

// The factory service is driven the way the app and the command drive it: through a real engine, over its socket.
describe('the factory service, through the engine', () => {
  it('opens a factory, snapshots it, pushes it, and picks up a manager change after it is accepted', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-svc-'));
    const root = createDemoFactory(path.join(dir, 'factory'), path.join(dir, 'repos'));
    await expect(startServer(dir, { version: '1.0.0' })).rejects.toThrow(/not a Roboratory factory/);

    const srv = await startServer(root, { version: '1.0.0' });
    const client = await EngineClient.connect(root, { client: 'app' });
    try {
      const pushed: Snapshot[] = [];
      client.on('snapshot', (s: Snapshot) => pushed.push(s));
      const state = () => client.call<{ snapshot: Snapshot }>('state').then((s) => s.snapshot);
      const s = await state();
      expect(s.factory!.sectors.map((x) => x.name)).toEqual(['Engineering', 'Incidents', 'Releases']);
      const plan = s.factory!.sectors[0].lines[0].pieces.find((p) => p.id === 'plan')!;
      expect(plan).toMatchObject({ agent: 'sim', sharedMachine: true, definedIn: 'shared/machines/planner', usedBy: { lines: 2, sectors: 1 } });

      const scope = { kind: 'sector', sectorId: 'incidents' };
      await client.call('ask', scope, 'add a smoke signal');
      const msg = (await client.call<ManagerMessage[]>('messages', scope)).at(-1)!;
      await client.call('acceptProposal', scope, msg.id, msg.proposals![0].id);
      expect((await state()).factory!.sectors[1].lines[0].pieces.some((p) => p.id === 'smoke')).toBe(true);
      await new Promise((r) => setTimeout(r, 150));
      expect(pushed.length).toBeGreaterThan(0);
    } finally {
      client.close();
      await srv.close();
    }
  });
});
