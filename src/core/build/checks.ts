// What must hold before build mode may save (D41): the factory loads, every piece is reachable
// and reaches the pallet, rules read real fields, every routed value has a way out, and policy
// stays within the ceiling.
import { ruleFields } from '../../shared/expr';
import { GOAL_MAX, type FactoryDef, type LineModel, type VerbName } from '../../shared/types';
import { beltFields, fieldsAt, hasField } from './fields';

export interface Issue {
  kind: 'load' | 'reach' | 'rule' | 'route' | 'policy';
  message: string;
  /** model folder the issue is in; the UI marks every line built from it */
  model?: string;
  pieceId?: string;
  sectorId?: string;
}

/** Fields the engine itself adds to boxes: rework feedback and your answer to a question. */
const ENGINE_FIELDS = new Set(['feedback', 'human_answer']);

function checkModel(m: LineModel): Issue[] {
  const out: Issue[] = [];
  const add = (kind: Issue['kind'], message: string, pieceId?: string) => out.push({ kind, message, model: m.dir, pieceId });
  const fwdOut = (id: string) => m.pieces.filter((q) => q.needs.some((n) => n.from === id && !n.back));
  const label = (id: string) => m.pieces.find((p) => p.id === id)?.label ?? id;

  // reachability, both ways
  const reached = new Set(['@intake']); const stack = ['@intake'];
  while (stack.length) for (const q of fwdOut(stack.pop()!)) if (!reached.has(q.id)) { reached.add(q.id); stack.push(q.id); }
  const reaches = new Set(['@pallet']); const st2 = ['@pallet'];
  while (st2.length) { const id = st2.pop()!; const p = m.pieces.find((x) => x.id === id); for (const n of p?.needs ?? []) if (!n.back && !reaches.has(n.from)) { reaches.add(n.from); st2.push(n.from); } }
  // report where a line is broken, not every piece the break cuts off
  const noInput = new Set(m.pieces.filter((p) => p.kind !== 'intake' && !p.needs.some((n) => !n.back)).map((p) => p.id));
  const noOutput = new Set(m.pieces.filter((p) => p.kind !== 'pallet' && !fwdOut(p.id).length).map((p) => p.id));
  const up = (id: string) => { const s = new Set<string>(); const st = [id]; while (st.length) { const cur = st.pop(); for (const n of m.pieces.find((x) => x.id === cur)?.needs ?? []) if (!n.back && !s.has(n.from)) { s.add(n.from); st.push(n.from); } } return s; };
  const down = (id: string) => { const s = new Set<string>(); const st = [id]; while (st.length) for (const q of fwdOut(st.pop()!)) if (!s.has(q.id)) { s.add(q.id); st.push(q.id); } return s; };
  for (const p of m.pieces) {
    if (noInput.has(p.id)) add('reach', `"${p.label}" has no input belt.`, p.id);
    else if (!reached.has(p.id) && ![...up(p.id)].some((x) => noInput.has(x))) add('reach', `"${p.label}" cannot be reached from the intake.`, p.id);
    if (noOutput.has(p.id)) add('reach', `"${p.label}" has no belt out.`, p.id);
    else if (p.kind !== 'pallet' && !reaches.has(p.id) && ![...down(p.id)].some((x) => noOutput.has(x))) add('reach', `"${p.label}" has no way to the pallet.`, p.id);
  }

  for (const p of m.pieces) {
    if (p.goal && p.goal.length > GOAL_MAX) add('load', `"${p.label}": its goal is ${p.goal.length} characters; keep it within ${GOAL_MAX}.`, p.id);
    const mg = p.machine ? m.machines[p.machine]?.goal : undefined;
    if (mg && mg.length > GOAL_MAX) add('load', `"${p.label}": its machine's default goal is ${mg.length} characters; keep it within ${GOAL_MAX}.`, p.id);
    // a rule gate reads the box it receives
    if (p.kind === 'gate' && p.rule) {
      let fs: ReturnType<typeof ruleFields> = [];
      try { fs = ruleFields(p.rule); } catch { /* reported by the loader */ }
      const ins = p.needs.filter((n) => !n.back).map((n) => fieldsAt(m, n.from));
      const box = { open: ins.some((x) => x.open), fields: ins.flatMap((x) => x.fields) };
      for (const f of fs) if (!ENGINE_FIELDS.has(f.path[0]) && ins.length && !hasField(box, f.path)) add('rule', `"${p.label}" checks "${f.path.join('.')}", which its input does not send.`, p.id);
    }
    // rules read fields the box has, and compare enum fields only to their values
    for (const n of p.needs) {
      if (!n.when) continue;
      let fields: ReturnType<typeof ruleFields>;
      try { fields = ruleFields(n.when); } catch { continue; } // the loader already reported it
      const box = beltFields(m, n.from, !!n.back);
      for (const f of fields) {
        const name = f.path.join('.');
        if (ENGINE_FIELDS.has(f.path[0])) continue;
        if (!hasField(box, f.path)) { add('rule', `The belt from "${label(n.from)}" to "${p.label}" reads "${name}", which "${label(n.from)}" does not send.`, p.id); continue; }
        const values = box.fields.find((x) => x.path === name)?.values;
        if (values) for (const v of f.values) if (!values.includes(String(v))) add('rule', `The belt from "${label(n.from)}" to "${p.label}" compares "${name}" to "${String(v)}", which is not one of ${values.join(', ')}.`, p.id);
      }
    }
    // every value a piece routes on has a belt that takes it. Only checked for a field that
    // every outgoing belt compares with == or in; anything looser could take any value.
    const outs = m.pieces.flatMap((q) => q.needs.filter((n) => n.from === p.id).map((n) => n.when));
    if (!outs.length || outs.some((w) => !w)) continue;
    const box = fieldsAt(m, p.id);
    const parsed = outs.map((w) => { try { return ruleFields(w!); } catch { return null; } });
    if (parsed.some((x) => !x)) continue;
    const keys = new Set(parsed.flatMap((fs) => fs!.map((f) => f.path.join('.'))));
    for (const k of keys) {
      const per = parsed.map((fs) => fs!.find((f) => f.path.join('.') === k));
      if (per.some((f) => !f || f.ops.some((o) => o !== '==' && o !== 'in'))) continue;
      const seen = new Set(per.flatMap((f) => f!.values.map(String)));
      const values = box.fields.find((x) => x.path === k)?.values;
      if (!values || !seen.size) continue;
      const missing = values.filter((v) => !seen.has(v));
      if (missing.length) add('route', `"${p.label}" can send ${k} = ${missing.join(', ')}, but no belt takes ${missing.length === 1 ? 'it' : 'them'}.`, p.id);
    }
  }
  return out;
}

const NEVER_AUTO: VerbName[] = ['release', 'apply'];

export function checkFactory(f: FactoryDef): Issue[] {
  const out: Issue[] = f.warnings.map((w) => ({ kind: 'load' as const, message: w }));
  for (const p of f.problems ?? []) out.push({ kind: 'load', message: p.message, model: p.model, pieceId: p.pieceId });
  const models = new Map<string, LineModel>();
  for (const s of f.sectors) for (const l of s.lines) models.set(l.model.dir, l.model);
  for (const m of models.values()) out.push(...checkModel(m));
  for (const verb of NEVER_AUTO) if ((f.ceiling[verb]?.auto ?? 0) > 0) out.push({ kind: 'policy', message: `The factory ceiling cannot let managers ${verb} on their own.` });
  for (const s of f.sectors) for (const [verb, rule] of Object.entries(s.policy)) {
    const auto = rule?.auto ?? 0;
    if (!auto) continue;
    if (NEVER_AUTO.includes(verb as VerbName)) out.push({ kind: 'policy', sectorId: s.id, message: `${s.name}: managers can never ${verb} on their own.` });
    else if (auto > (f.ceiling[verb as VerbName]?.auto ?? 0)) out.push({ kind: 'policy', sectorId: s.id, message: `${s.name}: ${verb} ${auto} on its own is above the factory ceiling (${f.ceiling[verb as VerbName]?.auto ?? 0}).` });
  }
  return out;
}
