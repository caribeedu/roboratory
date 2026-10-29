// The metrics as text for a terminal (D47): one table per line, a row for each piece in the version shown.
import type { Stats, VersionRow } from '../shared/types';
import { visibleRows } from './stats';

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

/** The dollars are the agent CLI's estimate, so they carry a tilde. */
export const money = (usd: number) => (usd >= 10 ? `~US$ ${usd.toFixed(2)}` : `~US$ ${usd.toFixed(usd >= 0.01 ? 2 : 3)}`);

/** A period like 90m, 12h or 7d as milliseconds. */
export function parsePeriod(text: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(m|h|d|w)$/.exec(text.trim());
  if (!m) throw new Error(`"${text}" is not a period like 90m, 12h, 7d or 2w`);
  return Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[m[2] as 'm' | 'h' | 'd' | 'w'];
}

const cells = (r: VersionRow): string[] => [
  r.version + (r.current ? '' : ' (earlier)'), String(r.runs),
  `${money(r.cost.median)} (${money(r.cost.total)} in all)`, `${duration(r.duration.median)} / ${duration(r.duration.max)}`,
  `${r.attempts.mean.toFixed(1)} / ${r.attempts.max}`,
  String(r.reworks), String(r.questions), String(r.blocks), String(r.fires),
  r.passes ? `${r.passes - r.provedWrong} of ${r.passes} held` : '-',
  `${r.permissions.requests} / ${r.permissions.repeated} / ${r.permissions.denied}`,
];
const HEAD = ['version', 'runs', 'cost per run', 'time (median / longest)', 'attempts (mean / most)', 'reworks', 'asks', 'blocks', 'fires', 'checker passes', 'permissions (asked / repeated / denied)'];

export function formatStats(stats: Stats, allVersions = false): string {
  if (!stats.lines.length) return 'No lines match.\n';
  const out: string[] = [];
  for (const line of stats.lines) {
    out.push(`${line.name} (${line.lineId}): ${line.runs} run${line.runs === 1 ? '' : 's'}, ${money(line.total.cost)} in all`);
    const rows: string[][] = [];
    for (const p of line.pieces) {
      const shown = visibleRows(p, allVersions);
      if (!shown.length) { rows.push([`${p.label}${p.checker ? ' (checker)' : ''}`, 'no runs']); continue; }
      shown.forEach((r, i) => rows.push([i === 0 ? `${p.label}${p.checker ? ' (checker)' : ''}` : '', ...cells(r)]));
      if (!shown.some((r) => r.current)) rows[rows.length - shown.length][0] += ' (no runs of the current version; this is the one before)';
    }
    const table = [['piece', ...HEAD], ...rows];
    const width = HEAD.length + 1;
    const w = Array.from({ length: width }, (_, c) => Math.max(...table.map((r) => (r[c] ?? '').length)));
    for (const [i, r] of table.entries()) {
      out.push('  ' + r.map((x, c) => (c < 2 || c === width - 1 ? (x ?? '').padEnd(w[c]) : (x ?? '').padStart(w[c]))).join('  ').trimEnd());
      if (i === 0) out.push('  ' + w.map((n) => '-'.repeat(n)).join('  '));
    }
    out.push('');
  }
  out.push('Costs are estimates made by the agent CLI.');
  return out.join('\n') + '\n';
}
