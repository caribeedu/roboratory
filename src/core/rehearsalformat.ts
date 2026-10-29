// The rehearsal as text for a terminal (D48): what will run, how it goes, and what it found.
import type { RehearsalPlan, RehearsalProgress, RehearsalReport } from '../shared/types';
import { duration, money } from '../shared/statsview';

export function formatPlan(p: RehearsalPlan): string {
  const out: string[] = [`Rehearsal of ${p.lineName} (${p.lineId}), ${p.mode === 'real' ? 'real, with Haiku' : 'in simulation, which is free'}, from the ${p.source === 'draft' ? 'draft' : 'files on disk'}.`, ''];
  out.push('Machines:');
  for (const m of p.machines) {
    out.push(`  ${m.label}: ${m.agent}${m.model ? ` (${m.model})` : ''}${m.allow.length ? `, allowed ${m.allow.join(', ')}` : ''}${m.tools.length ? `, tools ${m.tools.join(', ')}` : ''}`);
    if (m.outward.length) out.push(`    refused, because it acts outside: ${m.outward.join(', ')}`);
  }
  if (p.signals.length) {
    out.push('', 'Signals:');
    for (const s of p.signals) out.push(`  ${s.label}: ${s.runs ? `runs \`${s.command}\` for real, in the copy` : 'does not run (it passes)'}`);
  }
  if (p.mode === 'real') {
    out.push('', `Ceiling: ${p.maxCostUsd !== undefined ? `US$ ${p.maxCostUsd.toFixed(2)}` : 'none'}.${p.reference ? ` A real run of this line has cost ${money(p.reference.medianUsd)} (median of ${p.reference.runs}).` : ''}`);
  }
  return out.join('\n') + '\n';
}

/** One line for each piece whose state changed since the last progress. */
export function formatProgress(previous: Record<string, string>, p: RehearsalProgress, label: (id: string) => string): string[] {
  const lines: string[] = [];
  for (const [id, state] of Object.entries(p.pieces)) if (previous[id] !== undefined && previous[id] !== state && state !== 'idle') lines.push(`  ${label(id)}: ${state}`);
  return lines;
}

export function formatReport(r: RehearsalReport): string {
  const out: string[] = [];
  const status = { done: 'reached the pallet', stopped: 'stopped', ceiling: 'stopped at the cost ceiling', timeout: 'did not end in time', aborted: 'was stopped' }[r.status];
  out.push(`The line ${status}${r.costUsd ? `, ${money(r.costUsd)} (an estimate)` : ''}, in ${duration(r.endedAt - r.startedAt)}.`);
  for (const p of r.pieces) out.push(`  ${p.label}: ${p.attempts} attempt${p.attempts === 1 ? '' : 's'}${p.reworks ? `, ${p.reworks} rework${p.reworks === 1 ? '' : 's'}` : ''}${p.questions ? `, ${p.questions} question${p.questions === 1 ? '' : 's'}` : ''}${p.denied ? `, ${p.denied} refused` : ''}${p.costUsd ? `, ${money(p.costUsd)}` : ''}`);
  const defects = r.findings.filter((f) => f.class === 'defect');
  const notes = r.findings.filter((f) => f.class === 'note');
  out.push('');
  if (!defects.length) out.push('No defects.');
  else {
    out.push(`${defects.length} defect${defects.length === 1 ? '' : 's'}:`);
    for (const f of defects) out.push(`  - ${f.pieceId || 'the line'}: ${f.message}\n    Look at: ${f.where}`);
  }
  if (notes.length) {
    out.push('', `${notes.length} note${notes.length === 1 ? '' : 's'}:`);
    for (const f of notes) out.push(`  - ${f.pieceId}: ${f.message}`);
  }
  if (r.kept) out.push('', `The copy was kept at ${r.kept}`);
  out.push('', `Report: .runs/rehearsals/${r.id}/report.json`);
  return out.join('\n') + '\n';
}
