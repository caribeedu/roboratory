// How each piece usually behaves, over every run of its version (D47). The Ledger says what happened in a run; this says what to expect.
import { useEffect, useState } from 'react';
import type { Snapshot, Stats } from '../../shared/types';
import { duration, money, visibleRows } from '../../shared/statsview';
import { api } from '../store';

type Factory = NonNullable<Snapshot['factory']>;

const PERIODS: [string, string][] = [['', 'All time'], [String(86_400_000), 'Last 24 hours'], [String(7 * 86_400_000), 'Last 7 days'], [String(30 * 86_400_000), 'Last 30 days']];

export function Metrics({ factory, onPiece }: { factory: Factory; onPiece: (p: { sectorId: string; lineId: string; pieceId: string }) => void }) {
  const [sector, setSector] = useState('');
  const [line, setLine] = useState('');
  const [period, setPeriod] = useState('');
  const [all, setAll] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 3000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let alive = true;
    void api().stats({ sectorId: sector || undefined, lineId: line || undefined, since: period ? Date.now() - Number(period) : undefined, allVersions: all })
      .then((s) => { if (alive) setStats(s); }, () => { if (alive) setStats({ lines: [] }); });
    return () => { alive = false; };
  }, [sector, line, period, all, tick]);
  const linesOf = factory.sectors.filter((s) => !sector || s.id === sector).flatMap((s) => s.lines);

  return (
    <main className="metrics">
      <div className="metrics-filters frame">
        <select value={sector} onChange={(e) => { setSector(e.target.value); setLine(''); }} aria-label="Sector">
          <option value="">All sectors</option>
          {factory.sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={line} onChange={(e) => setLine(e.target.value)} aria-label="Line">
          <option value="">All lines</option>
          {linesOf.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
          {PERIODS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <label className="chk"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All versions</label>
      </div>
      {stats && !stats.lines.length && <p className="muted">No lines match.</p>}
      {stats?.lines.map((l) => (
        <section key={l.lineId} className="metrics-line frame" aria-label={`Metrics of ${l.name}`}>
          <header>
            <h2>{l.name}</h2>
            <span className="muted">{l.runs} run{l.runs === 1 ? '' : 's'} · {money(l.total.cost)} in all</span>
          </header>
          <table>
            <thead>
              <tr><th>Piece</th><th>Version</th><th>Runs</th><th>Cost per run</th><th>Time (median / longest)</th><th>Attempts</th><th>Reworks</th><th>Asks</th><th>Blocks</th><th>Fires</th><th>Checker passes</th><th title="asked / repeated / denied">Permissions</th></tr>
            </thead>
            <tbody>
              {l.pieces.map((p) => {
                const rows = visibleRows(p, all);
                const open = <button className="link" onClick={() => onPiece({ sectorId: l.sectorId, lineId: l.lineId, pieceId: p.pieceId })}>{p.label}</button>;
                if (!rows.length) return <tr key={p.pieceId}><td>{open}</td><td colSpan={11} className="muted">No runs yet.</td></tr>;
                return rows.map((r, i) => (
                  <tr key={`${p.pieceId}@${r.version}`} className={r.current ? '' : 'earlier'}>
                    <td>{i === 0 ? <>{open}{p.checker && <span className="chip idle" title="A piece with a return belt leaving it">checker</span>}</> : null}</td>
                    <td><code>{r.version}</code>{!r.current && <span className="muted small"> {all ? 'earlier' : 'the current version has no runs; this is the one before'}</span>}</td>
                    <td>{r.runs}</td>
                    <td title={`${money(r.cost.total)} in all`}>{money(r.cost.median)}</td>
                    <td>{duration(r.duration.median)} / {duration(r.duration.max)}</td>
                    <td>{r.attempts.mean.toFixed(1)} (most {r.attempts.max})</td>
                    <td>{r.reworks}</td><td>{r.questions}</td><td>{r.blocks}</td><td>{r.fires}</td>
                    <td>{r.passes ? `${r.passes - r.provedWrong} of ${r.passes} held` : '–'}</td>
                    <td title={r.permissions.requests ? `median wait for an answer: ${duration(r.permissions.waitMedianMs)}` : undefined}>{r.permissions.requests} / {r.permissions.repeated} / {r.permissions.denied}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </section>
      ))}
      <p className="muted small">Costs are estimates made by the agent CLI. A version is what the agent is given: a changed role is a new version.</p>
    </main>
  );
}
