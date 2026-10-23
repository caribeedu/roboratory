// The factory as the renderer sees it: definitions only, no run state.
import path from 'node:path';
import type { FactoryDef, Snapshot } from '../shared/types';
import { usage } from './factory';
import { relPosix } from './paths';

export function factoryView(f: FactoryDef): NonNullable<Snapshot['factory']> {
  const u = usage(f);
  return {
    root: f.root, name: f.name, warnings: f.warnings, hasCulture: !!f.culture.trim(), lineContext: f.lineContext,
    sectors: f.sectors.map((s) => ({
      id: s.id, name: s.name, color: s.color, policy: s.policy, hasCulture: !!s.culture.trim(),
      lines: s.lines.map((l) => ({
        id: l.id, name: l.name, direction: l.direction, model: l.model.name, sharedModel: l.model.shared, repo: l.repo, params: l.params, intake: l.model.intake,
        pieces: l.model.pieces.map((p) => {
          const m = p.machine ? l.model.machines[p.machine] : undefined;
          const uu = m ? u.get(m.dir) : u.get(l.model.dir);
          return {
            ...p,
            role: m?.role, contract: m?.contract, agent: m?.agent, tools: m?.tools, sharedMachine: m?.shared, machineGoal: m?.goal,
            definedIn: relPosix(f.root, m ? m.dir : path.join(l.model.dir, 'line.yaml')),
            usedBy: uu ? { lines: uu.lines, sectors: uu.sectors.size } : undefined,
          };
        }),
      })),
    })),
  };
}
