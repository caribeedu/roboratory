// What a machine is given that does not change from run to run, and the version of a piece made from it (D47).
import crypto from 'node:crypto';
import type { FactoryDef, LineDef, MachineDef } from '../shared/types';
import { linePlace } from './lineplace';
import { effectiveRules } from './permissions';

/** The role an agent is given: the machine's own, then the factory's culture and the sector's (D23). */
export function composedRole(f: FactoryDef, line: LineDef, machine: MachineDef): string {
  const sector = f.sectors.find((s) => s.id === line.sectorId);
  return [machine.role, f.culture, sector?.culture].filter((x) => x && x.trim()).join('\n\n');
}

/** What a machine may run (D44): its own lists and the defaults, with the hard denials of every level added. */
export function machineRules(f: FactoryDef, line: LineDef, machine: MachineDef) {
  const sector = f.sectors.find((s) => s.id === line.sectorId);
  const rules = effectiveRules({
    allow: machine.allow, readOnly: machine.readOnly, shell: true,
    deny: [...f.deny, ...(sector?.deny ?? []), ...line.model.deny, ...machine.deny],
  });
  return { ...rules, readOnly: machine.readOnly, shell: true };
}

/**
 * The version of a piece: eight characters of a hash of the role (with the cultures), the contract, the model, the effort, the
 * lists, the tools, the folders, the attempts, the time limit, and the text of the piece's place in the line. A change to any of
 * them is a new version; a change to anything else in the factory is not. Null for a piece that is not a machine.
 */
export function pieceVersion(f: FactoryDef, line: LineDef, pieceId: string): string | null {
  const piece = line.model.pieces.find((p) => p.id === pieceId);
  const machine = piece?.machine ? line.model.machines[piece.machine] : undefined;
  if (!piece || !machine) return null;
  const given = {
    agent: machine.agent, model: machine.model ?? null, effort: machine.effort ?? null,
    role: composedRole(f, line, machine), contract: machine.contract, rules: machineRules(f, line, machine),
    tools: machine.tools, dirs: machine.dirs, attempts: machine.attempts, timeoutMs: machine.timeoutMs,
    context: f.lineContext ? linePlace(line, pieceId) : '',
  };
  return crypto.createHash('sha256').update(JSON.stringify(given)).digest('hex').slice(0, 8);
}
