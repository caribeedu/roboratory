// The text that tells a machine its place in the line (D25): the line in order, its goal, where its box comes from and goes, and what
// each piece after it does. It is part of what a piece's version is made of (D47), so it lives apart from the engine.
import { describe } from '../shared/expr';
import type { LineDef } from '../shared/types';

/**
 * Where a machine stands in its line, for its prompt: the line in order, what feeds it, where its
 * box goes (rules in plain words) and which machines come after it, so it does its own step only.
 */
export function linePlace(line: LineDef, pieceId: string): string {
  const pieces = line.model.pieces;
  const name = (id: string) => { const p = pieces.find((x) => x.id === id); return p ? (p.kind === 'intake' ? `${line.model.intake.label || 'Intake'} (intake)` : p.kind === 'pallet' ? `${p.label} (pallet)` : `${p.label} (${p.kind})`) : id; };
  const me = pieces.find((p) => p.id === pieceId);
  if (!me) return '';
  const goalOf = (p: typeof me) => p.goal ?? (p.machine ? line.model.machines[p.machine]?.goal : undefined);
  const ins = me.needs.map((n) => `- ${n.back ? 'sent back by' : 'from'} ${name(n.from)}${n.when ? ` when ${describe(n.when)}` : ''}`);
  const outs = pieces.flatMap((p) => p.needs.filter((n) => n.from === pieceId).map((n) => `- ${n.back ? 'back to' : 'to'} ${name(p.id)}${n.when ? ` when ${describe(n.when)}` : ''}`));
  const after = new Set<string>(); const stack = [pieceId];
  while (stack.length) { const id = stack.pop()!; for (const p of pieces) if (p.needs.some((n) => n.from === id && !n.back) && !after.has(p.id)) { after.add(p.id); stack.push(p.id); } }
  const later = pieces.filter((p) => after.has(p.id) && p.kind !== 'pallet').map((p) => `- ${name(p.id)}${goalOf(p) ? `: ${goalOf(p)}` : ''}`);
  return [
    `Your place in the line "${line.name}":`,
    `The line, in order: ${pieces.map((p) => (p.id === pieceId ? `${name(p.id)} ← you` : name(p.id))).join(' → ')}`,
    goalOf(me) ? `Your goal: ${goalOf(me)}` : '',
    ins.length ? `Your box comes:\n${ins.join('\n')}` : '',
    outs.length ? `Your box goes:\n${outs.join('\n')}` : '',
    later.length ? `After you, each piece does its own step:\n${later.join('\n')}\nDo only your step; leave theirs to them.` : '',
  ].filter(Boolean).join('\n');
}
