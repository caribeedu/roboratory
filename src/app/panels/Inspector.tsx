// Entity panels (D39): every situation is the panel of the piece it concerns.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogEntry, RunSummary, Snapshot } from '../../shared/types';
import type { Selection } from '../floor/Floor';
import { ago, api, useNow } from '../store';
import { describeParts } from '../../shared/expr';
import { BoxView, fieldDescriptions } from '../BoxView';
import { Markdown } from '../Markdown';

type Line = NonNullable<Snapshot['factory']>['sectors'][number]['lines'][number];
type Piece = Line['pieces'][number];

interface Props {
  selection: NonNullable<Selection>;
  snapshot: Snapshot;
  logs: LogEntry[];
  act: (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
  notify: (t: string, k?: 'ok' | 'fail' | 'info') => void;
  onClose: () => void;
  onOpenRun: (runId: string) => void;
}

const STATE_LABEL: Record<string, [string, string]> = {
  idle: ['Idle', 'idle'], busy: ['Working', 'busy'], fire: ['Stopped', 'fire'], holding: ['Waiting for you', 'hold'],
  passed: ['Passed', 'ok'], skipped: ['Skipped', 'idle'], waiting: ['Waiting', 'idle'], asking: ['Asks you', 'hold'],
};

export function Inspector({ selection, snapshot, logs, act, notify, onClose, onOpenRun }: Props) {
  const f = snapshot.factory!;
  const line = f.sectors.flatMap((s) => s.lines).find((l) => l.id === selection.lineId);
  const lv = snapshot.lines[selection.lineId];
  if (!line || !lv) return null;

  if (selection.kind === 'box') {
    const b = lv.boxes.find((x) => x.id === selection.boxId);
    return (
      <aside className="inspector frame" aria-label="Box">
        <Head title="Box" sub={`${line.name}`} onClose={onClose} />
        <div className="insp-body">
          {!b ? <p className="muted">This box has moved on. Click it again where it is now.</p> : (
            <>
              <dl className="kv">
                <dt>Run</dt><dd><button className="link" onClick={() => onOpenRun(b.runId)}>{b.runId}</button></dd>
                <dt>Where</dt><dd>{'piece' in b.at ? `At ${label(line, b.at.piece)}` : `On the belt ${label(line, b.at.from)} → ${label(line, b.at.to)}`}</dd>
              </dl>
              <BoxSection title="Contents" value={b.payload} descriptions={fieldDescriptions(line)} />
            </>
          )}
        </div>
      </aside>
    );
  }

  const piece = line.pieces.find((p) => p.id === selection.pieceId);
  const pv = lv.pieces[selection.pieceId];
  if (!piece || !pv) return null;
  const [stLabel, stClass] = STATE_LABEL[pv.state] ?? ['Idle', 'idle'];
  const kindName = { intake: `${line.intake.kind[0].toUpperCase()}${line.intake.kind.slice(1)} intake`, machine: 'Machine', signal: 'Signal', gate: piece.rule ? 'Rule gate' : 'Gate', pallet: 'Pallet' }[piece.kind];
  const title = piece.kind === 'intake' ? (line.intake.label || 'Intake') : piece.label;

  return (
    <aside className={`inspector frame${pv.state === 'fire' ? ' on-fire' : ''}`} aria-label={title}>
      <Head title={title} sub={`${kindName} · ${line.name}`} onClose={onClose} state={<span className={`chip ${stClass}`}>{lv.halted ? 'Line halted' : stLabel}</span>} />
      <div className="insp-body">
        {(piece.goal ?? piece.machineGoal) && <p className="goal">{piece.goal ?? piece.machineGoal}</p>}
        {piece.kind === 'machine' && <MachinePanel line={line} piece={piece} pv={pv} logs={logs} act={act} onOpenRun={onOpenRun} halted={lv.halted} />}
        {piece.kind === 'signal' && <SignalPanel line={line} piece={piece} pv={pv} logs={logs} act={act} />}
        {piece.kind === 'gate' && <GatePanel line={line} piece={piece} pv={pv} lv={lv} act={act} />}
        {piece.kind === 'intake' && <IntakePanel line={line} act={act} notify={notify} />}
        {piece.kind === 'pallet' && <PalletPanel line={line} count={pv.pallet ?? 0} onOpenRun={onOpenRun} />}
        {pv.lastBox && piece.kind !== 'pallet' && piece.kind !== 'intake' && (
          <BoxSection title="Last box out" collapsed value={pv.lastBox} descriptions={fieldDescriptions(line, piece.kind === 'machine' ? piece.id : undefined)}>
            {pv.lastRunId && <button className="link" onClick={() => onOpenRun(pv.lastRunId!)}>Open run {pv.lastRunId} in the Ledger</button>}
          </BoxSection>
        )}
        <Flow line={line} piece={piece} />
        <Definition line={line} piece={piece} culture={{ factory: f.hasCulture, sector: !!f.sectors.find((x) => x.id === line.id.split('/')[0])?.hasCulture }} />
      </div>
    </aside>
  );
}

export function Head({ title, sub, onClose, state }: { title: string; sub: string; onClose: () => void; state?: React.ReactNode }) {
  return (
    <div className="insp-head">
      <div className="insp-titles"><h2>{title}</h2><p>{sub}</p></div>
      {state}
      <button className="icon" onClick={onClose} aria-label="Close panel" title="Close (Esc)">✕</button>
    </div>
  );
}

function Waiting({ since }: { since?: number }) {
  const now = useNow();
  return <>{ago(since ?? now, now)}</>;
}

export function Section({ title, children, collapsed, action }: { title: string; children: React.ReactNode; collapsed?: boolean; action?: React.ReactNode }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <section className="sec">
      <div className="sec-head">
        <button className="sec-title" aria-expanded={open} onClick={() => setOpen(!open)}><span>{open ? '▾' : '▸'}</span>{title}</button>
        {open && action}
      </div>
      {open && <div className="sec-body">{children}</div>}
    </section>
  );
}

const label = (line: Line, id: string) => { const p = line.pieces.find((x) => x.id === id); return p ? (p.kind === 'intake' ? line.intake.label || 'Intake' : p.label) : id; };

function Transcript({ logs, lineId, pieceId, runId, limit = 40 }: { logs: LogEntry[]; lineId: string; pieceId: string; runId?: string; limit?: number }) {
  const all = logs.filter((l) => l.lineId === lineId && l.pieceId === pieceId && (!runId || l.runId === runId) && (l.level === 'machine' || l.kind === 'warn' || l.kind === 'fail'));
  const rows = all.slice(-limit);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    // the whole transcript of this step, not only the lines shown
    const text = all.map((r) => `${new Date(r.t).toLocaleTimeString([], { hour12: false })} ${r.text}`).join('\n');
    void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  const list = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const newest = rows.length ? rows[rows.length - 1].t + rows.length : 0;
  useEffect(() => { if (list.current && stick.current) list.current.scrollTop = list.current.scrollHeight; }, [newest]);
  if (!rows.length) return <p className="muted">Nothing yet. Lines appear here as the agent works.</p>;
  return (
    <>
      <ol className="transcript" ref={list} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
        {rows.map((r, i) => <li key={i} className={`t-${r.kind}`}><time>{new Date(r.t).toLocaleTimeString([], { hour12: false })}</time>{r.kind === 'text' ? <Markdown text={r.text} compact /> : <span>{r.text}</span>}</li>)}
      </ol>
      <button className="link small copy-transcript" onClick={copy}>{copied ? 'Copied!' : `Copy transcript${all.length > rows.length ? ` (all ${all.length} lines)` : ''}`}</button>
    </>
  );
}

function MachinePanel({ line, piece, pv, logs, act, onOpenRun, halted }: { line: Line; piece: Piece; pv: Snapshot['lines'][string]['pieces'][string]; logs: LogEntry[]; act: Props['act']; onOpenRun: (id: string) => void; halted: boolean }) {
  const [hint, setHint] = useState('');
  const [answer, setAnswer] = useState('');
  if (pv.state === 'asking' && pv.question) {
    const q = pv.question;
    return (
      <>
        <div className="ask-card">
          <h3>The agent needs you</h3>
          <div className="ask-q"><Markdown text={q.question} /></div>
        </div>
        {q.recommendation && <Section title="Its recommendation" collapsed><Markdown text={q.recommendation} /></Section>}
        {!!q.options?.length && <div className="actions">{q.options.map((o) => <button key={o} className="btn" onClick={() => setAnswer(o)}>{o}</button>)}</div>}
        <form className="field-stack" onSubmit={(e) => { e.preventDefault(); void act(async () => { await api().answer(line.id, piece.id, answer); setAnswer(''); }, 'Answered; the machine runs again'); }}>
          <label htmlFor="ask-answer">Your answer</label>
          <textarea id="ask-answer" rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Answer in a sentence the agent can act on." />
          <div className="actions"><button className="btn primary" type="submit" disabled={!answer.trim()}>Send answer</button></div>
          <p className="muted small">The machine runs again in the same folder with your answer. It does not count as an attempt.</p>
        </form>
        <Section title="What the agent did" collapsed><Transcript logs={logs} lineId={line.id} pieceId={piece.id} runId={pv.runId} limit={12} /></Section>
      </>
    );
  }
  if (pv.state === 'fire') {
    return (
      <>
        <div className="fire-card">
          <h3>Why it stopped</h3>
          <p className="err">{pv.error}</p>
          <p className="muted small">The line behind this machine waits until you act. The highlighted boxes belong to this run.</p>
        </div>
        <Section title="What the agent did last"><Transcript logs={logs} lineId={line.id} pieceId={piece.id} runId={pv.runId} limit={10} /></Section>
        <form className="field-stack" onSubmit={(e) => { e.preventDefault(); void act(async () => { await api().retry(line.id, piece.id, hint); setHint(''); }, 'Retrying'); }}>
          <label htmlFor="retry-hint">Hint for the retry (optional)</label>
          <textarea id="retry-hint" rows={3} value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. Include suspected_cause: you found the pool wait in New Relic." />
          <div className="actions">
            <button className="btn primary" type="submit">Retry{hint ? ' with hint' : ''}</button>
            {!halted && <button className="btn" type="button" onClick={() => act(() => api().halt(line.id), 'Line halted')}>Halt line</button>}
            {pv.runId && <button className="btn ghost" type="button" onClick={() => onOpenRun(pv.runId!)}>Open run</button>}
          </div>
        </form>
      </>
    );
  }
  return (
    <>
      <dl className="kv">
        <dt>Run</dt><dd>{pv.runId ? <button className="link" onClick={() => onOpenRun(pv.runId!)}>{pv.runId}</button> : '—'}</dd>
        <dt>Attempt</dt><dd>{pv.attempt ? `${pv.attempt} of ${pv.attempts}` : '—'}</dd>
        <dt>Queue</dt><dd>{pv.queue ? `${pv.queue} box${pv.queue === 1 ? '' : 'es'} waiting` : 'empty'}</dd>
      </dl>
      <Section title="Live transcript"><Transcript logs={logs} lineId={line.id} pieceId={piece.id} runId={pv.runId ?? pv.lastRunId} /></Section>
    </>
  );
}

function SignalPanel({ line, piece, pv, logs, act }: { line: Line; piece: Piece; pv: Snapshot['lines'][string]['pieces'][string]; logs: LogEntry[]; act: Props['act'] }) {
  return (
    <>
      <dl className="kv"><dt>Runs</dt><dd><code>{piece.run}</code></dd><dt>Passes on</dt><dd>exit code 0</dd></dl>
      {pv.state === 'fire' && (
        <div className="fire-card">
          <h3>The signal stopped the line</h3>
          <p className="err">{pv.error}</p>
          <div className="actions"><button className="btn primary" onClick={() => act(() => api().retry(line.id, piece.id, ''), 'Running the signal again')}>Run again</button></div>
        </div>
      )}
      <Section title="Output"><Transcript logs={logs} lineId={line.id} pieceId={piece.id} runId={pv.runId ?? pv.lastRunId} /></Section>
    </>
  );
}

function GatePanel({ line, piece, pv, lv, act }: { line: Line; piece: Piece; pv: Snapshot['lines'][string]['pieces'][string]; lv: Snapshot['lines'][string]; act: Props['act'] }) {
  const need = piece.rule ? 1 : piece.confirmations ?? 1;
  const [step, setStep] = useState(0);
  useEffect(() => setStep(0), [pv.runId, pv.state]);
  const signals = useMemo(() => {
    const byId = new Map(line.pieces.map((p) => [p.id, p]));
    const out: Piece[] = []; const seen = new Set<string>();
    const walk = (id: string) => { for (const n of byId.get(id)!.needs) { if (seen.has(n.from)) continue; seen.add(n.from); const q = byId.get(n.from)!; if (q.kind === 'signal') out.push(q); if (q.kind !== 'machine') walk(q.id); } };
    walk(piece.id);
    return out;
  }, [line, piece.id]);
  const next = line.pieces.find((p) => p.needs.some((n) => n.from === piece.id));
  const box = lv.boxes.find((b) => 'piece' in b.at && b.at.piece === piece.id && b.runId === pv.runId);
  const confirmText = step === 1 ? 'Are you sure?' : `Are you really sure? The box goes on to ${next ? (next.kind === 'pallet' ? 'the pallet' : next.label) : 'the next step'}.`;
  return (
    <>
      <dl className="kv">
        <dt>Opens</dt><dd>{piece.rule ? <>On its own when <Rule src={piece.rule} /></> : piece.choices ? <>When you choose {piece.choices.map((c, i) => <span key={c}>{i ? ', ' : ''}<span className="rule-val">{c}</span></span>)}</> : `When you release it (${need} confirmation${need === 1 ? '' : 's'})`}</dd>
        {pv.state === 'holding' && <><dt>Waiting</dt><dd><Waiting since={pv.since} />{pv.queue ? ` · ${pv.queue} more behind` : ''}</dd></>}
      </dl>
      {signals.length > 0 && (
        <Section title="Signals before this gate">
          <ul className="checks">
            {signals.map((s) => { const st = lv.pieces[s.id]; const c = st.state === 'fire' ? 'fire' : st.state === 'busy' ? 'busy' : st.lastBox ? 'ok' : 'idle'; return <li key={s.id} className={c}><i />{s.label}<span>{c === 'ok' ? 'passed' : c === 'fire' ? 'failed' : c === 'busy' ? 'checking' : 'not run yet'}</span></li>; })}
          </ul>
        </Section>
      )}
      {pv.state === 'holding' && (
        <>
          {pv.error && <p className="warn-note">{pv.error}</p>}
          {box && <BoxSection title="The box at the gate" value={box.payload} descriptions={fieldDescriptions(line)} />}
          {piece.choices ? <Decision line={line} piece={piece} need={need} act={act} /> : <div className={`release${step ? ' confirming' : ''}`}>
            {step === 0 && <button className="btn primary big" onClick={() => setStep(1)}>{piece.rule ? 'Release anyway' : 'Release'}</button>}
            {step > 0 && (
              <>
                <p className="confirm-q">{need > 1 || piece.rule ? confirmText : 'Are you sure?'}</p>
                <div className="actions">
                  <button className="btn primary" onClick={() => { if (step < need) setStep(step + 1); else { void act(() => api().release(line.id, piece.id, need), `${piece.label} released`); setStep(0); } }}>
                    {step < need ? 'Yes' : 'Yes, release'}
                  </button>
                  <button className="btn ghost" onClick={() => setStep(0)}>Cancel</button>
                </div>
                <p className="muted small">Confirmation {step} of {need}</p>
              </>
            )}
          </div>}
        </>
      )}
      {pv.state !== 'holding' && <p className="muted">Nothing is waiting here right now.</p>}
    </>
  );
}

function Decision({ line, piece, need, act }: { line: Line; piece: Piece; need: number; act: Props['act'] }) {
  const [choice, setChoice] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [step, setStep] = useState(0);
  const routes = line.pieces.filter((p) => p.needs.some((n) => n.from === piece.id && n.when?.includes(`'${choice}'`))).map((p) => (p.kind === 'pallet' ? 'the pallet' : p.label));
  return (
    <div className={`release decision${step ? ' confirming' : ''}`}>
      <p className="confirm-q">Choose the way forward</p>
      <div className="choices">{piece.choices!.map((c) => <button key={c} className={`btn${choice === c ? ' primary' : ''}`} aria-pressed={choice === c} onClick={() => { setChoice(c); setStep(0); }}>{c}</button>)}</div>
      {choice && (
        <>
          <p className="muted small">Goes on to {routes.length ? routes.join(', ') : 'nothing on this line (the run ends here)'}.</p>
          <div className="field-stack">
            <label htmlFor="decision-note">Note for the next machine (optional)</label>
            <textarea id="decision-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. hotfix in orders-api only; post comments 1 and 3" />
          </div>
          {step === 0 ? <button className="btn primary big" onClick={() => setStep(1)}>Go with {choice}</button> : (
            <>
              <p className="confirm-q">{step === 1 ? 'Are you sure?' : 'Are you really sure?'}</p>
              <div className="actions">
                <button className="btn primary" onClick={() => { if (step < need) setStep(step + 1); else { void act(() => api().release(line.id, piece.id, need, { choice, note }), `${piece.label}: ${choice}`); setStep(0); } }}>{step < need ? 'Yes' : `Yes, ${choice}`}</button>
                <button className="btn ghost" onClick={() => setStep(0)}>Cancel</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function IntakePanel({ line, act, notify }: { line: Line; act: Props['act']; notify: Props['notify'] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const kind = line.intake.kind;
  return (
    <>
      {kind !== 'manual' && <p className="muted">This intake starts runs on its own ({kind}) once that kind of intake is available. You can still dispatch a run by hand.</p>}
      <form className="work-order" onSubmit={(e) => {
        e.preventDefault();
        void act(async () => { const id = await api().run(line.id, values); notify(`Run ${id} dispatched to ${line.name}`, 'ok'); setValues({}); });
      }}>
        <h3>Work order</h3>
        {line.intake.inputs.length === 0 && <p className="muted small">This line takes no input.</p>}
        {line.intake.inputs.map((i) => (
          <div className="field-stack" key={i.name}>
            <label htmlFor={`in-${i.name}`}>{i.label || i.name}{i.required ? ' *' : ''}</label>
            {i.multiline
              ? <textarea id={`in-${i.name}`} rows={5} value={values[i.name] ?? ''} placeholder={i.placeholder} required={i.required} onChange={(e) => setValues({ ...values, [i.name]: e.target.value })} />
              : <input id={`in-${i.name}`} value={values[i.name] ?? ''} placeholder={i.placeholder} required={i.required} onChange={(e) => setValues({ ...values, [i.name]: e.target.value })} />}
          </div>
        ))}
        <button className="btn primary big" type="submit">Dispatch</button>
      </form>
    </>
  );
}

function PalletPanel({ line, count, onOpenRun }: { line: Line; count: number; onOpenRun: (id: string) => void }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  useEffect(() => { void api().runs().then((r) => setRuns(r.filter((x) => x.lineId === line.id && x.status === 'done'))); }, [count, line.id]);
  const descriptions = useMemo(() => fieldDescriptions(line), [line]);
  return (
    <>
      <p className="muted">{count} deliverable{count === 1 ? '' : 's'} on this pallet.</p>
      <ul className="deliverables">
        {runs.slice(0, 12).map((r) => {
          const name = Object.values(r.input).join(', ') || r.id;
          const ended = r.endedAt ? new Date(r.endedAt).toLocaleString() : '';
          return (
            <li key={r.id} title={name}>
              {r.deliverable
                ? <BoxSection title={name} collapsed value={r.deliverable} descriptions={descriptions}>
                    <button className="link" onClick={() => onOpenRun(r.id)}>Open run {r.id} in the Ledger</button>
                  </BoxSection>
                : <button className="link" onClick={() => onOpenRun(r.id)}>{name}</button>}
              <span className="muted small">{ended}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** A rule in words, with the compared values set apart. */
/** A box in a section, with its JSON toggle beside the title. */
function BoxSection({ title, value, descriptions, collapsed, children }: { title: string; value: unknown; descriptions?: Record<string, string>; collapsed?: boolean; children?: React.ReactNode }) {
  const [raw, setRaw] = useState(false);
  return (
    <Section title={title} collapsed={collapsed} action={<button className="btn ghost small" onClick={() => setRaw(!raw)}>{raw ? 'Readable' : 'JSON'}</button>}>
      <BoxView value={value} descriptions={descriptions} raw={raw} />
      {children}
    </Section>
  );
}

export function Rule({ src }: { src: string }) {
  return <>{describeParts(src).map((p, i) => (p.value ? <span key={i} className="rule-val">{p.text}</span> : p.field ? <b key={i} className="rule-field">{p.text}</b> : <span key={i}>{p.text}</span>))}</>;
}

/** Where boxes come from and where they go, in plain words. */
function Flow({ line, piece }: { line: Line; piece: Piece }) {
  const name = (id: string) => (id === '@pallet' ? 'the pallet' : label(line, id));
  const q = (id: string) => <>"{name(id)}"</>;
  // pieces are quoted; the pallet is not a name
  const named = (id: string) => (id === '@pallet' ? <>The pallet</> : q(id));
  const laps = (n: { laps?: number }) => <> (at most <span className="rule-val">{n.laps ?? 3}</span> times)</>;
  const incoming = piece.needs.map((n) => (
    <li key={`in-${n.from}`}>
      {n.back
        ? <>Sent back by {q(n.from)} for rework when <Rule src={n.when ?? ''} />{laps(n)}</>
        : <>{named(n.from)}{n.when && <> when <Rule src={n.when} /></>}</>}
    </li>
  ));
  const outgoing = line.pieces.flatMap((p) => p.needs.filter((n) => n.from === piece.id).map((n) => (
    <li key={`out-${p.id}`}>
      {n.back
        ? <>Back to {q(p.id)} for rework when <Rule src={n.when ?? ''} />{laps(n)}</>
        : <>{named(p.id)}{n.when && <> when <Rule src={n.when} /></>}</>}
    </li>
  )));
  if (!incoming.length && !outgoing.length) return null;
  return (
    <Section title="Flow">
      {incoming.length > 0 && <><h4>Receives from</h4><ul className="flow">{incoming}</ul></>}
      {outgoing.length > 0 && <><h4>Sends to</h4><ul className="flow">{outgoing}</ul></>}
    </Section>
  );
}


function Definition({ line, piece, culture }: { line: Line; piece: Piece; culture: { factory: boolean; sector: boolean } }) {
  return (
    <Section title="Definition" collapsed>
      <dl className="kv">
        {piece.kind === 'machine' && <><dt>Agent</dt><dd>{piece.agent}</dd><dt>Tools</dt><dd>{piece.tools?.length ? piece.tools.join(', ') : 'none'}</dd></>}
        <dt>Defined in</dt><dd><code>{piece.definedIn}</code></dd>
        {(piece.kind === 'machine') && <><dt>Culture</dt><dd>{[culture.factory && 'culture.md', culture.sector && `sectors/${line.id.split('/')[0]}/culture.md`].filter(Boolean).join(' + ') || 'none'}</dd></>}
        {piece.usedBy && (piece.sharedMachine || line.sharedModel) && <><dt>Shared</dt><dd className="warn-text">Changing it affects {piece.usedBy.lines} line{piece.usedBy.lines === 1 ? '' : 's'} in {piece.usedBy.sectors} sector{piece.usedBy.sectors === 1 ? '' : 's'}</dd></>}
        <dt>Model</dt><dd>{line.model}{line.sharedModel ? ' (shared)' : ''}</dd>
        {line.repo && <><dt>Repository</dt><dd><code>{line.repo}</code></dd></>}
      </dl>
      {piece.role && <><h4>Role</h4><pre className="prose">{piece.role}</pre></>}
      {piece.contract && <><h4>Contract</h4><pre className="json">{JSON.stringify(piece.contract, null, 2)}</pre></>}
    </Section>
  );
}
