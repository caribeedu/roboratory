// The floor radio: factory, sector or machine level (D38).
import { useEffect, useRef, useState } from 'react';
import type { Level, LogEntry, Snapshot } from '../../shared/types';
import { Markdown } from '../Markdown';

export function LiveLog({ logs, factory, sectorId, selection }: { logs: LogEntry[]; factory: NonNullable<Snapshot['factory']>; sectorId: string; selection: { lineId: string; pieceId: string } | null }) {
  const [level, setLevel] = useState<Level>('sector');
  const [open, setOpen] = useState(true);
  const list = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const sectorName = (id?: string) => factory.sectors.find((s) => s.id === id)?.name ?? '';
  const machine = selection;
  const pieceLabel = machine ? factory.sectors.flatMap((s) => s.lines).find((l) => l.id === machine.lineId)?.pieces.find((p) => p.id === machine.pieceId)?.label : undefined;
  const rows = logs.filter((l) => {
    if (level === 'factory') return l.level === 'factory';
    if (level === 'sector') return l.sectorId === sectorId && l.level !== 'machine';
    return !!machine && l.lineId === machine.lineId && l.pieceId === machine.pieceId;
  }).slice(-200);
  const newest = rows.length ? rows[rows.length - 1].t + rows.length : 0;
  useEffect(() => { const el = list.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [newest, level, open]);
  useEffect(() => { stick.current = true; }, [level, machine?.lineId, machine?.pieceId]);
  return (
    <section className={`radio frame${open ? '' : ' closed'}`} aria-label="Live log">
      <div className="panel-head static">
        <button className="link-plain" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '▾' : '▸'} Live log</button>
        <div className="seg" role="group" aria-label="Log level">
          {(['factory', 'sector', 'machine'] as Level[]).map((l) => (
            <button key={l} aria-pressed={level === l} onClick={() => { setLevel(l); setOpen(true); }} title={l === 'machine' && !machine ? 'Select a machine or signal on the floor' : undefined}>
              {l === 'factory' ? 'Factory' : l === 'sector' ? 'Sector' : pieceLabel ? pieceLabel : 'Machine'}
            </button>
          ))}
        </div>
      </div>
      {open && (
        <ol ref={list} aria-live="polite" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
          {level === 'machine' && !machine && <li className="muted">Select a machine or a signal on the floor to follow its agent.</li>}
          {rows.map((r, i) => (
            <li key={i} className={`ev ${r.kind}`}>
              <time>{new Date(r.t).toLocaleTimeString([], { hour12: false })}</time>
              {level === 'factory' && <b>{sectorName(r.sectorId)}</b>}
              {level === 'machine' && r.kind === 'text' ? <Markdown text={r.text} compact /> : <span>{r.text}</span>}
            </li>
          ))}
          {rows.length === 0 && (level !== 'machine' || machine) && <li className="muted">Quiet so far.</li>}
        </ol>
      )}
    </section>
  );
}
