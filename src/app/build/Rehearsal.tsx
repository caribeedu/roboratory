// The rehearsal in build mode (D48): a dialog that shows what will run, runs the draft once with nobody to answer, and lists what it found;
// a section in a piece's panel for its findings; and the context the Floor's marks and the button's count are read from.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { BuildView } from '../../shared/build';
import type { Finding, RehearsalMode, RehearsalPlan, RehearsalProgress, RehearsalReport, RehearsalRequest } from '../../shared/types';
import { money } from '../../shared/statsview';
import { api, errText } from '../store';
import type { Op } from './PieceEditor';

type Factory = BuildView['factory'];

/** The last rehearsal of a line, and the versions its pieces have in the draft now (a finding of another version is out of date). */
export interface RehearsalState { lineId: string; report: RehearsalReport; versions: Record<string, string> }

export interface RehearsalApi {
  state: RehearsalState | null;
  open: (lineId: string) => void;
  /** where the pieces of a line carry a mark: a defect, a note, or findings that are out of date */
  marks: Record<string, 'defect' | 'note' | 'stale'>;
}
export const RehearsalCtx = createContext<RehearsalApi>({ state: null, open: () => {}, marks: {} });

/** A finding is out of date when its piece has another version in the draft than when it was found. */
export const isStale = (s: RehearsalState | null, f: Finding) => !!s && !!f.version && !!s.versions[f.pieceId] && s.versions[f.pieceId] !== f.version;

/** The marks the Floor draws, from a rehearsal and the versions the draft's pieces have now. */
export function marksOf(s: RehearsalState | null): RehearsalApi['marks'] {
  const out: RehearsalApi['marks'] = {};
  if (!s) return out;
  for (const f of s.report.findings) {
    if (!f.pieceId) continue;
    const key = `${s.lineId}#${f.pieceId}`;
    const kind = isStale(s, f) ? 'stale' : f.class;
    const rank = { stale: 0, note: 1, defect: 2 } as const;
    if (!out[key] || rank[kind] > rank[out[key]]) out[key] = kind;
  }
  return out;
}

const STATE_WORDS: Record<string, string> = { idle: 'waiting', busy: 'working', passed: 'passed', fire: 'caught fire', holding: 'at a gate', asking: 'asking' };
const STATUS_WORDS: Record<RehearsalReport['status'], string> = { done: 'The line reached the pallet.', stopped: 'The line stopped.', ceiling: 'The line stopped at the cost ceiling.', timeout: 'The rehearsal did not end in time.', aborted: 'The rehearsal was stopped.' };

/** One finding: what happened, where to look, and for a command no list covers the two ways to answer it in the draft. */
export function FindingRow({ finding, lineId, stale, label, op, onPiece }: { finding: Finding; lineId: string; stale: boolean; label: (id: string) => string; op: Op; onPiece?: (id: string) => void }) {
  const [done, setDone] = useState('');
  const add = async (list: 'allow' | 'outward') => {
    if (await op({ op: 'addCommand', lineId, pieceId: finding.pieceId, list, command: finding.suggestion! })) setDone(list === 'allow' ? `Added "${finding.suggestion}" to allow. Rehearse again to check.` : `Added "${finding.suggestion}" to outward. Rehearse again to check.`);
  };
  return (
    <li className={`finding ${finding.class}${stale ? ' stale' : ''}`}>
      <span className="finding-icon" aria-label={finding.class === 'defect' ? 'Defect' : 'Note'}>{finding.class === 'defect' ? '✗' : 'i'}</span>
      <div>
        {finding.pieceId && (onPiece ? <button className="link finding-piece" onClick={() => onPiece(finding.pieceId)}>{label(finding.pieceId)}</button> : <b>{label(finding.pieceId)}</b>)}
        <span> {finding.message}</span>
        {stale && <span className="muted small"> (from an earlier version of this piece)</span>}
        {finding.where !== 'nothing to do' && <div className="muted small">Look at: {finding.where}</div>}
        {finding.kind === 'uncovered-command' && finding.suggestion && !stale && !done && (
          <div className="actions">
            <button className="btn small" onClick={() => void add('allow')}>Allow it</button>
            <button className="btn small ghost" onClick={() => void add('outward')} title="Its rehearsal refuses it; a real run still asks you">It acts outside</button>
          </div>
        )}
        {done && <div className="small ok">{done}</div>}
      </div>
    </li>
  );
}

/** The findings of the last rehearsal that belong to one piece, in its panel. */
export function PieceRehearsal({ lineId, pieceId, label, op }: { lineId: string; pieceId: string; label: (id: string) => string; op: Op }) {
  const r = useContext(RehearsalCtx);
  if (!r.state || r.state.lineId !== lineId) return null;
  const mine = r.state.report.findings.filter((f) => f.pieceId === pieceId);
  if (!mine.length) return null;
  return (
    <section className="sec" aria-label="Rehearsal">
      <div className="sec-head"><span className="sec-title">Rehearsal</span></div>
      <ul className="findings">{mine.map((f) => <FindingRow key={`${r.state!.report.id}:${f.id}`} finding={f} lineId={lineId} stale={isStale(r.state, f)} label={label} op={op} />)}</ul>
    </section>
  );
}

export function RehearsalDialog({ lineId, factory, op, onClose, onReport, onPiece }: {
  lineId: string; factory: Factory; op: Op; onClose: () => void; onReport: (r: RehearsalReport) => void; onPiece: (pieceId: string) => void;
}) {
  const line = factory.sectors.flatMap((s) => s.lines).find((l) => l.id === lineId);
  const [mode, setMode] = useState<RehearsalMode>('simulation');
  const [ceiling, setCeiling] = useState('1.00');
  const [input, setInput] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<RehearsalPlan | null>(null);
  const [phase, setPhase] = useState<'setup' | 'running' | 'done'>('setup');
  const [progress, setProgress] = useState<RehearsalProgress | null>(null);
  const [report, setReport] = useState<RehearsalReport | null>(null);
  const [error, setError] = useState('');
  const [planError, setPlanError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const request = (): RehearsalRequest => ({ lineId, input, mode, source: 'draft', maxCostUsd: mode === 'real' ? Number(ceiling) : undefined, approved: mode === 'real' });
  const ceilingOk = mode === 'simulation' || Number(ceiling) > 0;
  useEffect(() => {
    if (phase !== 'setup' || !ceilingOk) return;
    let live = true;
    void api().rehearsalPlan({ lineId, input, mode, source: 'draft', maxCostUsd: mode === 'real' ? Number(ceiling) : undefined })
      .then((p) => { if (live) { setPlan(p); setPlanError(''); } }, (e) => { if (live) { setPlan(null); setPlanError(errText(e)); } });
    return () => { live = false; };
  }, [lineId, mode, ceiling, phase, ceilingOk]);

  const label = (id: string) => { const p = line?.pieces.find((x) => x.id === id); return p ? (p.kind === 'intake' ? line!.intake.label || 'Intake' : p.label) : id; };
  const missing = mode === 'real' ? (plan?.inputs ?? []).filter((i) => i.required && !(input[i.name] ?? '').trim()) : [];

  const start = async () => {
    setPhase('running'); setError(''); setProgress(null);
    const off = api().onRehearsal((p) => { if (alive.current) setProgress(p); });
    try {
      const r = await api().rehearse(request());
      if (!alive.current) return;
      setReport(r); setPhase('done'); onReport(r);
    } catch (e) { if (alive.current) { setError(errText(e)); setPhase('setup'); } } finally { off(); }
  };

  const findings = report?.findings ?? [];
  const defects = findings.filter((f) => f.class === 'defect');
  return (
    <div className="modal-back" role="presentation" onClick={phase === 'running' ? undefined : onClose}>
      <div className="modal frame rehearsal-dialog" role="dialog" aria-label={`Rehearse ${line?.name ?? lineId}`} onClick={(e) => e.stopPropagation()}>
        <h2>Rehearse {line?.name ?? lineId}</h2>
        <p className="muted small">Runs the line once on a copy of your draft, with nobody to answer, to find what is wrong with its roles, permissions and wiring.</p>
        {(error || planError) && <p className="err" role="alert">{error || planError}</p>}

        {phase === 'setup' && (
          <>
            <fieldset className="rehearsal-mode">
              <legend>How</legend>
              <label className="chk"><input type="radio" name="rehearsal-mode" checked={mode === 'simulation'} onChange={() => setMode('simulation')} /> Simulation (free)</label>
              <label className="chk"><input type="radio" name="rehearsal-mode" checked={mode === 'real'} onChange={() => setMode('real')} /> Real with Haiku (spends money)</label>
              <label className="ceiling">Cost ceiling (US$)
                <input aria-label="Cost ceiling (US$)" disabled={mode === 'simulation'} value={mode === 'simulation' ? 'free' : ceiling} onChange={(e) => setCeiling(e.target.value)} inputMode="decimal" />
              </label>
            </fieldset>
            {plan && plan.inputs.length > 0 && (
              <div className="rehearsal-inputs">
                {plan.inputs.map((i) => (
                  <label key={i.name}>{i.label || i.name}{i.required && mode === 'real' ? ' *' : ''}
                    <input value={input[i.name] ?? ''} placeholder={mode === 'simulation' ? `${i.placeholder || 'x'} (filled in if you leave it empty)` : i.placeholder} onChange={(e) => setInput({ ...input, [i.name]: e.target.value })} />
                  </label>
                ))}
              </div>
            )}
            {plan && (
              <div className="rehearsal-plan">
                <h3>What will run</h3>
                <ul>
                  {plan.machines.map((m) => (
                    <li key={m.pieceId}><b>{m.label}</b>: {m.agent}{m.model ? ` (${m.model})` : ''}{m.allow.length ? `, allowed ${m.allow.join(', ')}` : ''}
                      {m.outward.length > 0 && <div className="small muted">refused, because it acts outside: {m.outward.join(', ')}</div>}
                    </li>
                  ))}
                  {plan.signals.map((s) => <li key={s.pieceId}><b>{s.label}</b>: {s.runs ? <>runs <code>{s.command}</code> for real, in the copy</> : 'passes without running'}</li>)}
                </ul>
                {mode === 'real' && plan.reference && <p className="small muted">A real run of this line has cost {money(plan.reference.medianUsd)} (median of {plan.reference.runs}).</p>}
              </div>
            )}
            <div className="actions">
              <button className="btn primary" disabled={!plan || !ceilingOk || missing.length > 0} onClick={() => void start()}>
                {mode === 'simulation' ? 'Start (free)' : `Start (spends up to US$ ${Number(ceiling || 0).toFixed(2)})`}
              </button>
              <button className="btn ghost" onClick={onClose}>Close</button>
            </div>
            {missing.length > 0 && <p className="small muted">Fill in {missing.map((i) => i.label || i.name).join(', ')} first.</p>}
          </>
        )}

        {phase === 'running' && (
          <>
            <ul className="rehearsal-progress" aria-label="Progress">
              {Object.entries(progress?.pieces ?? {}).filter(([id]) => !id.startsWith('@')).map(([id, state]) => (
                <li key={id} className={`s-${state}`}><b>{label(id)}</b> <span className="muted">{STATE_WORDS[state] ?? state}</span></li>
              ))}
            </ul>
            {mode === 'real' && <p className="small muted">{money(progress?.costUsd ?? 0)} so far</p>}
            {(progress?.findings.length ?? 0) > 0 && <p className="small">{progress!.findings.length} finding{progress!.findings.length === 1 ? '' : 's'} so far.</p>}
            <div className="actions"><button className="btn" onClick={() => void api().rehearsalStop()}>Stop</button></div>
          </>
        )}

        {phase === 'done' && report && (
          <>
            <p><b>{STATUS_WORDS[report.status]}</b>{report.costUsd ? ` ${money(report.costUsd)} (an estimate).` : ''}</p>
            <p className="small">{defects.length ? `${defects.length} defect${defects.length === 1 ? '' : 's'}` : 'No defects'}{findings.length - defects.length ? `, ${findings.length - defects.length} note${findings.length - defects.length === 1 ? '' : 's'}` : ''}. Pick a piece to see it on the Floor.</p>
            <ul className="findings" aria-label="Findings">
              {[...defects, ...findings.filter((f) => f.class === 'note')].map((f) => (
                <FindingRow key={f.id} finding={f} lineId={lineId} stale={false} label={label} op={op} onPiece={(id) => { onPiece(id); onClose(); }} />
              ))}
            </ul>
            <div className="actions">
              <button className="btn" onClick={() => { setPhase('setup'); setReport(null); }}>Rehearse again</button>
              <button className="btn ghost" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
