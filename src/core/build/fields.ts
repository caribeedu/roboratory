// What a belt rule can read: the fields of the box that leaves a piece (D41).
// A machine's box is its contract output; gates and signals pass their incoming box on,
// and a gate with choices adds `decision`.
import type { LineModel } from '../../shared/types';

export interface Field { path: string; type?: string; values?: string[]; description?: string }
/** `open` means some upstream box has no declared shape, so any field may be there. */
export interface Fields { fields: Field[]; open: boolean }

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function contractFields(contract: Obj): Fields {
  const props = contract.properties;
  if (!isObj(props)) return { fields: [], open: true };
  return {
    open: false,
    fields: Object.entries(props).map(([k, s]) => {
      const spec = isObj(s) ? s : {};
      const values = Array.isArray(spec.enum) ? spec.enum.map(String) : spec.const !== undefined ? [String(spec.const)] : spec.type === 'boolean' ? ['true', 'false'] : undefined;
      return { path: k, type: typeof spec.type === 'string' ? spec.type : undefined, values, description: typeof spec.description === 'string' ? spec.description : undefined };
    }),
  };
}

/** The fields of the box a piece sends down its belts. */
export function fieldsAt(model: LineModel, pieceId: string, seen = new Set<string>()): Fields {
  const p = model.pieces.find((x) => x.id === pieceId);
  if (!p || seen.has(pieceId)) return { fields: [], open: true };
  seen.add(pieceId);
  if (p.kind === 'intake') return { open: false, fields: model.intake.inputs.map((i) => ({ path: i.name, type: 'string', description: i.label })) };
  if (p.kind === 'machine') {
    const m = p.machine ? model.machines[p.machine] : undefined;
    return m ? contractFields(m.contract) : { fields: [], open: true };
  }
  // gates and signals pass on what they received, merged over every forward input
  const merged = new Map<string, Field>();
  let open = false;
  for (const n of p.needs.filter((x) => !x.back)) {
    const up = fieldsAt(model, n.from, new Set(seen));
    open ||= up.open;
    for (const f of up.fields) if (!merged.has(f.path)) merged.set(f.path, f);
  }
  if (p.kind === 'gate' && p.choices) {
    merged.set('decision.choice', { path: 'decision.choice', type: 'string', values: p.choices, description: 'your choice at this gate' });
    merged.set('decision.note', { path: 'decision.note', type: 'string', description: 'your note at this gate' });
  }
  return { fields: [...merged.values()], open };
}

/** Whether a rule path is a field of the box (only the top-level name is checked for nested objects). */
export function hasField(f: Fields, path: string[]): boolean {
  if (f.open) return true;
  const full = path.join('.');
  return f.fields.some((x) => x.path === full || x.path === path[0] || full.startsWith(`${x.path}.`));
}

/** The fields a rule on a belt leaving `from` can read: on a return belt, a failing signal adds why it failed (D20). */
export function beltFields(model: LineModel, from: string, back: boolean): Fields {
  const f = fieldsAt(model, from);
  if (!back || model.pieces.find((x) => x.id === from)?.kind !== 'signal') return f;
  return {
    open: f.open,
    fields: [
      ...f.fields,
      { path: 'signal', type: 'string', values: ['fail'], description: 'set when the signal failed' },
      { path: 'signal_output', type: 'string', description: 'the last lines the failing signal printed' },
    ],
  };
}
