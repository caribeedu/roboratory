// How the metrics are shown, for the command and the window alike (D47).
import type { PieceStats, VersionRow } from './types';

/** A time as seconds, minutes or hours. */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

/** The dollars are the agent CLI's estimate, so they carry a tilde. */
export const money = (usd: number) => (usd >= 10 ? `~US$ ${usd.toFixed(2)}` : `~US$ ${usd.toFixed(usd >= 0.01 ? 2 : 3)}`);

/** The rows to show for a piece: its current version, or when that has no runs, the newest one before; all of them with `allVersions`. */
export function visibleRows(p: PieceStats, allVersions = false): VersionRow[] {
  if (allVersions) return p.rows;
  const current = p.rows.filter((r) => r.current);
  return current.length ? current : p.rows.slice(0, 1);
}
