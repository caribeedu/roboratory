// The Ledger: every run, in full, after the fact (D40).
import { useEffect, useMemo, useState } from 'react';
import type { RunDetail } from '../../shared/api';
import type { RunSummary, Snapshot } from '../../shared/types';
import { api } from '../store';
import { BoxView, fieldDescriptions } from '../BoxView';
import { Markdown } from '../Markdown';

type Factory = NonNullable<Snapshot['factory']>;

const STATUS: Record<string, string> = { running: 'Running', done: 'Done', stopped: 'Stopped', fire: 'On fire', halted: 'Halted' };

export function Ledger({ factory, runId, onRun, notify, onPiece }: { factory: Factory; runId: string | null; onRun: (id: string) => void; notify: (t: string, k?: 'ok' | 'fail' | 'info') => void; onPiece: (p: { sectorId: string; lineId: string; pieceId: string }) => void }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [sector, setSector] = useState('');
  const [lineF, setLineF] = useState('');
  const [period, setPeriod] = useState('');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 1500); return () => clearInterval(t); }, []);
  useEffect(() => { void api().runs().then(setRuns); }, [tick]);
  useEffect(() => { if (runId) void api().runDetail(runId).then(setDetail); else setDetail(null); }, [runId, tick]);
  const lines = useMemo(() => new Map(factory.sectors.flatMap((s) => s.lines.map((l) => [l.id, l] as const))), [factory]);
  const since = period ? Date.now() - Number(period) : 0;
  const filtered = runs.filter((r) => (!sector || r.sectorId === sector) && (!lineF || r.lineId === lineF) && r.startedAt >= since && (!status || r.status === status) && (!query || JSON.stringify(r.input).toLowerCase().includes(query.toLowerCase()) || r.id.includes(query)));
  useEffect(() => { if (!runId && filtered[0]) onRun(filtered[0].id); }, [filtered.length]);

  return (
    <main className="ledger">
      <aside className="runs frame">
        <div className="ledger-filters">
          <input placeholder="Search input or run id" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search runs" />
          <select value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Sector">
            <option value="">All sectors</option>
            {factory.sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={lineF} onChange={(e) => setLineF(e.target.value)} aria-label="Line">
            <option value="">All lines</option>
            {factory.sectors.filter((s) => !sector || s.id === sector).flatMap((s) => s.lines).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
            <option value="">Any time</option>
            <option value={String(3600e3)}>Last hour</option>
            <option value={String(86400e3)}>Last 24 hours</option>
            <option value={String(7 * 86400e3)}>Last 7 days</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <ol className="run-list">
          {filtered.length === 0 && <li className="muted pad">No runs yet. Dispatch one from an intake on the Floor.</li>}
          {filtered.map((r) => {
            const l = lines.get(r.lineId);
            const dur = (r.endedAt ?? Date.now()) - r.startedAt;
            return (
              <li key={r.id}>
                <button className={`run-row${r.id === runId ? ' current' : ''}`} onClick={() => onRun(r.id)}>
                  <span className={`chip ${r.status}`}>{STATUS[r.status]}</span>
                  <span className="run-main"><b>{Object.values(r.input).join(', ') || 'no input'}</b><small>{l?.name ?? r.lineId}</small></span>
                  <span className="run-meta"><time>{new Date(r.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time><small>{fmtDur(dur)}</small></span>
                </button>
              </li>
            );
          })}
        </ol>
      </aside>
      <section className="run-detail frame">
        {!detail ? <p className="muted pad">Pick a run to see everything that happened in it.</p> : <RunView d={detail} line={lines.get(detail.summary.lineId)} notify={notify} onPiece={onPiece} />}
      </section>
    </main>
  );
}

const fmtDur = (ms: number) => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };

interface Step { piece: string; start?: number; end?: number; status: 'done' | 'failed' | 'fire' | 'running' | 'skipped' | 'held' | 'released'; attempts: { n: number; error?: string }[]; events: { t: number; kind: string; text: string }[]; box?: unknown; branch?: string; cost: number }

function RunView({ d, line, notify, onPiece }: { d: RunDetail; line?: Factory['sectors'][number]['lines'][number]; notify: (t: string, k?: 'ok' | 'fail' | 'info') => void; onPiece: (p: { sectorId: string; lineId: string; pieceId: string }) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const { steps, verbs, end } = useMemo(() => {
    const steps = new Map<string, Step>();
    const get = (p: string) => { let s = steps.get(p); if (!s) { s = { piece: p, status: 'running', attempts: [], events: [], cost: 0 }; steps.set(p, s); } return s; };
    const verbs: { t: number; verb: string; actor: string; piece?: string; hint?: string; confirmations?: number; choice?: string; note?: string; answer?: string; question?: string }[] = [];
    let end: Record<string, any> | undefined;
    for (const e of d.events) {
      if (e.type === 'piece.start') { const s = get(e.piece); s.start ??= e.t; s.status = 'running'; if (e.attempt) s.attempts.push({ n: e.attempt }); }
      if (e.type === 'attempt.rejected') { const s = get(e.piece); const a = s.attempts.find((x) => x.n === e.attempt); if (a) a.error = e.error; }
      if (e.type === 'agent') get(e.piece).events.push({ t: e.t, kind: e.kind, text: e.text });
      if (e.type === 'piece.done') { const s = get(e.piece); s.start ??= e.t; s.end = e.t; s.status = e.failed ? 'failed' : s.status === 'held' ? 'released' : 'done'; s.box = e.box; s.branch = e.branch; }
      if (e.type === 'piece.fire') { const s = get(e.piece); s.end = e.t; s.status = 'fire'; s.events.push({ t: e.t, kind: 'fail', text: e.error }); }
      if (e.type === 'piece.hold') { const s = get(e.piece); s.start ??= e.t; s.status = 'held'; }
      if (e.type === 'piece.skip') { const s = get(e.piece); s.status = 'skipped'; }
      if (e.type === 'cost') get(e.piece).cost += e.usd;
      if (e.type === 'rework') { get(e.to).events.push({ t: e.t, kind: 'warn', text: `Sent back by ${e.from} (lap ${e.lap} of ${e.laps})` }); get(e.to).status = 'running'; }
      if (e.type === 'piece.ask') get(e.piece).events.push({ t: e.t, kind: 'warn', text: `Asked you: ${e.question?.question}` });
      if (e.type === 'verb') verbs.push(e as any);
      if (e.type === 'run.end') end = e;
    }
    return { steps, verbs, end };
  }, [d]);
  const s = d.summary;
  const t0 = s.startedAt, t1 = s.endedAt ?? Date.now();
  const span = Math.max(1, t1 - t0);
  const order = (line?.pieces ?? []).map((p) => p.id).filter((id) => steps.has(id));
  const labelOf = (id: string) => { const p = line?.pieces.find((x) => x.id === id); return p ? (p.kind === 'intake' ? line!.intake.label || 'Intake' : p.label) : id; };
  const totalCost = [...steps.values()].reduce((a, b) => a + b.cost, 0);

  return (
    <div className="run-view">
      <header className="run-head">
        <div>
          <h2>{Object.values(s.input).join(', ') || 'Run'} <span className={`chip ${s.status}`}>{STATUS[s.status]}</span></h2>
          <p className="muted">{line?.name} · run <code>{s.id}</code> · started {new Date(s.startedAt).toLocaleString()} · {fmtDur(t1 - t0)}{totalCost ? ` · $${totalCost.toFixed(3)}` : ''}</p>
        </div>
        <button className="btn ghost" onClick={() => api().reveal(`${d.dir}/run.jsonl`)}>Show run files</button>
      </header>
      <div className="version">
        <span>Factory version</span>
        <code>{s.baseCommit ? s.baseCommit.slice(0, 10) : 'not a git repository'}</code>
        {s.dirty ? <button className="link small" onClick={() => setShowDiff(!showDiff)}>+ uncommitted changes {showDiff ? '▾' : '▸'}</button> : <span className="muted small">clean</span>}
      </div>
      {showDiff && d.diff && <pre className="json diffbox">{d.diff}</pre>}
      {end?.why && <p className="warn-note">{end.why}</p>}

      <h3 className="h">Timeline</h3>
      <div className="gantt">
        {order.map((id) => {
          const st = steps.get(id)!;
          const a = ((st.start ?? t0) - t0) / span * 100, b = ((st.end ?? (st.status === 'skipped' ? st.start ?? t0 : t1)) - t0) / span * 100;
          return (
            <div className="g-row" key={id}>
              <button className="g-label link-plain" onClick={() => setOpen(open === id ? null : id)}>{labelOf(id)}</button>
              <div className="g-track"><i className={`g-bar ${st.status}`} style={{ left: `${a}%`, width: `${Math.max(0.6, b - a)}%` }} title={`${fmtDur((st.end ?? t1) - (st.start ?? t0))}`} /></div>
              <span className="g-dur">{st.status === 'skipped' ? 'skipped' : fmtDur((st.end ?? t1) - (st.start ?? t0))}</span>
            </div>
          );
        })}
      </div>

      <h3 className="h">Steps</h3>
      <ol className="steps">
        {order.map((id) => {
          const st = steps.get(id)!;
          const piece = line?.pieces.find((p) => p.id === id);
          return (
            <li key={id} className={`step ${st.status}`}>
              <button className="step-head" onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id}>
                <span className={`chip ${st.status === 'done' || st.status === 'released' ? 'ok' : st.status === 'fire' || st.status === 'failed' ? 'fire' : st.status === 'held' ? 'hold' : 'idle'}`}>{st.status}</span>
                <b>{labelOf(id)}</b>
                <small>{piece?.kind}{st.attempts.length > 1 ? ` · ${st.attempts.length} attempts` : ''}{st.branch ? ` · ${st.branch}` : ''}</small>
              </button>
              {open === id && (
                <div className="step-body">
                  {st.attempts.filter((a) => a.error).map((a) => <p key={a.n} className="warn-note">Attempt {a.n} rejected: {a.error}</p>)}
                  {st.events.length > 0 && <ol className="transcript">{st.events.map((e, i) => <li key={i} className={`t-${e.kind}`}><time>{new Date(e.t).toLocaleTimeString([], { hour12: false })}</time>{e.kind === 'text' ? <Markdown text={e.text} compact /> : <span>{e.kind === 'tool' ? `▸ ${e.text}` : e.kind === 'ret' ? `◂ ${e.text}` : e.text}</span>}</li>)}</ol>}
                  {st.box !== undefined && <BoxView value={st.box} descriptions={fieldDescriptions(line, piece?.kind === 'machine' ? id : undefined)} />}
                  {line && piece && <button className="link small" onClick={() => onPiece({ sectorId: line.id.split('/')[0], lineId: line.id, pieceId: id })}>Show on the floor</button>}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <h3 className="h">Who did what</h3>
      <ul className="verbs">
        {verbs.map((v, i) => (
          <li key={i}><time>{new Date(v.t).toLocaleTimeString([], { hour12: false })}</time><b>{v.actor}</b> {v.verb === 'release' && v.choice ? `chose ${v.choice} at ${labelOf(v.piece!)}${v.note ? ` — "${v.note}"` : ''}` : v.verb === 'answer' ? `answered ${labelOf(v.piece!)}: "${v.answer}"` : v.verb === 'release' ? `released ${labelOf(v.piece!)}${v.confirmations ? ` after ${v.confirmations} confirmation${v.confirmations === 1 ? '' : 's'}` : ''}` : v.verb === 'retry' ? `retried ${labelOf(v.piece!)}${v.hint ? ` with hint "${v.hint}"` : ''}` : `${v.verb === 'run' ? 'started the run' : v.verb === 'halt' ? 'halted the line' : 'resumed the line'}`}</li>
        ))}
      </ul>

      {s.deliverable && (
        <>
          <h3 className="h">On the pallet</h3>
          <BoxView value={s.deliverable} descriptions={fieldDescriptions(line)} />
          {typeof s.deliverable.pr_url === 'string' && <button className="link" onClick={() => { void navigator.clipboard.writeText(String(s.deliverable!.pr_url)).then(() => notify('Copied', 'ok')).catch(() => {}); }}>Copy {String(s.deliverable.pr_url)}</button>}
        </>
      )}
    </div>
  );
}
