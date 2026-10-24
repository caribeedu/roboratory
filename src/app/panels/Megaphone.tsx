// Talk to the managers (D35). Answers carry evidence and proposals as buttons.
import { useEffect, useRef, useState } from 'react';
import type { ScopeArg } from '../../shared/api';
import type { ManagerMessage, Proposal, Snapshot } from '../../shared/types';
import { api, errText } from '../store';
import { Markdown } from '../Markdown';
import { diffLines } from '../../shared/diff';

type Factory = NonNullable<Snapshot['factory']>;
type Sector = Factory['sectors'][number];

export function Megaphone({ factory, sector, msgTick, notify, onThinking, onEvidence }: {
  factory: Factory; sector: Sector; msgTick: Record<string, number>; notify: (t: string, k?: 'ok' | 'fail' | 'info') => void;
  onThinking: (key: string, v: boolean) => void; onEvidence: (e: { runId?: string; lineId?: string; pieceId?: string }) => void;
}) {
  const [toGM, setToGM] = useState(false);
  const scope: ScopeArg = toGM ? { kind: 'factory' } : { kind: 'sector', sectorId: sector.id };
  const key = toGM ? '_factory' : sector.id;
  const [messages, setMessages] = useState<ManagerMessage[]>([]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => { void api().messages(scope).then(setMessages); }, [key, msgTick[key]]);
  useEffect(() => { const pending = messages.some((m) => m.pending); onThinking(key, pending); }, [messages, key]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [messages.length, open]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = text.trim(); if (!q) return;
    setText(''); setOpen(true);
    try { await api().ask(scope, q); } catch (err) { notify(errText(err), 'fail'); }
  };
  const who = toGM ? 'General Manager' : `${sector.name} Manager`;
  const suggestions = toGM ? ['Where are we losing the most time?', 'Build a sector called Support'] : ['What needs me right now?', 'Why did it stop?', 'Add a smoke signal'];

  return (
    <div className="megaphone">
      {open && (
        <section className="convo frame" aria-label={`Conversation with the ${who}`}>
          <div className="panel-head static">
            <span>{who}</span>
            <span className="muted small">read-only · proposes, you decide</span>
            <button className="icon" onClick={() => setOpen(false)} aria-label="Hide conversation">▾</button>
          </div>
          <div className="msgs" ref={list}>
            {messages.length === 0 && <p className="muted">Ask about anything on the floor. The manager answers with evidence, and any action it suggests comes back as a button.</p>}
            {messages.map((m) => <Message key={m.id} m={m} scope={scope} factory={factory} notify={notify} onEvidence={onEvidence} />)}
          </div>
        </section>
      )}
      <form className="mega-bar frame" onSubmit={send}>
        <button type="button" className="addressee" onClick={() => setToGM(!toGM)} title="Switch between the Sector Manager and the General Manager" style={{ ['--sector' as string]: toGM ? '#c9a24a' : sector.color }}>
          <span className="mgr-dot" />{who} <span className="swap">⇄</span>
        </button>
        <input id="megaphone-input" value={text} onChange={(e) => setText(e.target.value)} onFocus={() => setOpen(true)} placeholder={`Ask the ${who}…   ( / to focus )`} aria-label={`Message the ${who}`} />
        <div className="suggest">{suggestions.map((s) => <button type="button" key={s} onClick={() => { setText(s); document.getElementById('megaphone-input')?.focus(); }}>{s}</button>)}</div>
        <button className="btn primary" type="submit" disabled={!text.trim()}>Send</button>
        <button type="button" className="icon" onClick={() => setOpen(!open)} aria-label={open ? 'Hide conversation' : 'Show conversation'}>{open ? '▾' : '▴'}</button>
      </form>
    </div>
  );
}

function Message({ m, scope, factory, notify, onEvidence }: { m: ManagerMessage; scope: ScopeArg; factory: Factory; notify: (t: string, k?: 'ok' | 'fail' | 'info') => void; onEvidence: (e: { runId?: string; lineId?: string; pieceId?: string }) => void }) {
  if (m.from === 'you') return <div className="msg you"><p>{m.text}</p></div>;
  if (m.pending) return <div className="msg mgr pending"><p><span className="dots"><i /><i /><i /></span> Thinking…</p></div>;
  return (
    <div className="msg mgr">
      {m.error ? <p className="err">{m.error}</p> : <Markdown text={m.text} />}
      {!!m.evidence?.length && (
        <div className="evidence">
          {m.evidence.map((e, i) => (
            <button key={i} className="chip ev" onClick={() => onEvidence(e)} title={e.note}>
              {e.pieceId ? `${e.lineId?.split('/')[1]} · ${e.pieceId}` : e.runId ? `run ${e.runId}` : e.note}
            </button>
          ))}
        </div>
      )}
      {m.proposals?.map((p) => <ProposalCard key={p.id} p={p} m={m} scope={scope} factory={factory} notify={notify} />)}
    </div>
  );
}

function ProposalCard({ p, m, scope, factory, notify }: { p: Proposal; m: ManagerMessage; scope: ScopeArg; factory: Factory; notify: (t: string, k?: 'ok' | 'fail' | 'info') => void }) {
  const [step, setStep] = useState(0);
  const [showDiff, setShowDiff] = useState(true);
  const piece = p.target ? factory.sectors.flatMap((s) => s.lines).find((l) => l.id === p.target!.lineId)?.pieces.find((x) => x.id === p.target!.pieceId) : undefined;
  const lineName = p.target ? factory.sectors.flatMap((s) => s.lines).find((l) => l.id === p.target!.lineId)?.name : '';
  const need = p.verb === 'release' ? (piece?.rule ? 1 : piece?.confirmations ?? 1) : 0;
  const label = p.kind === 'patch' ? `Change ${p.files!.length} file${p.files!.length === 1 ? '' : 's'}` : `${p.verb![0].toUpperCase()}${p.verb!.slice(1)} ${piece?.label ?? lineName}`;
  const where = p.kind === 'verb' && piece ? lineName : '';
  const accept = async () => {
    if (p.verb === 'release' && step < need) { setStep(step + 1); return; }
    try { await api().acceptProposal(scope, m.id, p.id, need); notify(p.kind === 'patch' ? 'Files written. Commit them when you are ready.' : `${label}: done`, 'ok'); }
    catch (e) { notify(errText(e), 'fail'); }
    setStep(0);
  };
  return (
    <div className={`proposal ${p.status}`}>
      <div className="proposal-head">
        <span className="kind">{p.kind === 'patch' ? 'Change' : 'Action'}</span>
        <b>{label}</b>
        {where && <span className="muted small">on {where}</span>}
        {p.status !== 'open' && <span className={`chip ${p.status === 'applied' || p.status === 'auto' ? 'ok' : 'idle'}`}>{p.status === 'auto' ? 'done by the manager (policy)' : p.status}</span>}
      </div>
      <div className="why"><Markdown text={p.why} />{p.args?.hint ? <p>Hint: <q>{p.args.hint}</q></p> : null}</div>
      {p.kind === 'patch' && (
        <>
          <button className="link small" onClick={() => setShowDiff(!showDiff)}>{showDiff ? 'Hide' : 'Show'} diff</button>
          {showDiff && p.files!.map((f) => (
            <div key={f.path} className="diff">
              <div className="diff-path">{f.before === undefined ? 'new ' : ''}{f.path}</div>
              <pre>{diffLines(f.before ?? '', f.content).filter((d, i, arr) => d.t !== ' ' || arr.slice(Math.max(0, i - 2), i + 3).some((x) => x.t !== ' ')).map((d, i) => <span key={i} className={`d${d.t === '+' ? 'a' : d.t === '-' ? 'r' : 'c'}`}>{d.t} {d.s}{'\n'}</span>)}</pre>
            </div>
          ))}
        </>
      )}
      {p.status === 'open' && (
        <div className="actions">
          {step > 0 && <span className="confirm-q small">{step === 1 ? 'Are you sure?' : 'Are you really sure?'}</span>}
          <button className="btn primary" onClick={() => void accept()}>{p.kind === 'patch' ? 'Accept (write files)' : step > 0 ? (step < need ? 'Yes' : 'Yes, release') : label}</button>
          <button className="btn ghost" onClick={() => { setStep(0); if (step === 0) void api().rejectProposal(scope, m.id, p.id); }}>{step > 0 ? 'Cancel' : 'Reject'}</button>
        </div>
      )}
    </div>
  );
}
