// One factory-wide list of everything that needs you, worst first (D39).
import { useState } from 'react';
import { isBurning, type AttentionItem, type Snapshot } from '../../shared/types';
import { ago, useNow } from '../store';

export function AttentionQueue({ items, factory, onPick }: { items: AttentionItem[]; factory: NonNullable<Snapshot['factory']>; onPick: (i: AttentionItem) => void }) {
  const [open, setOpen] = useState(true);
  const now = useNow();
  const sectorName = (id: string) => factory.sectors.find((s) => s.id === id)?.name ?? id;
  return (
    <section className={`attention frame${items.length ? ' has-items' : ''}`} aria-label="Needs you">
      <button className="panel-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`dot ${items.some(isBurning) ? 'fire' : items.length ? 'hold' : 'ok'}`} />
        <span>{items.length ? `${items.length} need${items.length === 1 ? 's' : ''} you` : 'All clear'}</span>
        {items.length > 0 && <kbd title="Jump to the next one">N</kbd>}
      </button>
      {open && items.length > 0 && (
        <ol>
          {items.slice(0, 8).map((i) => (
            <li key={`${i.id}@${i.runId}`}>
              <button onClick={() => onPick(i)} className={`att ${i.kind}`}>
                <span className="att-icon" aria-hidden>{i.kind === 'gate' || i.kind === 'permission' ? '!' : i.kind === 'question' ? '?' : '✸'}</span>
                <span className="att-text"><b>{i.title}</b><small>{sectorName(i.sectorId)} · {i.detail}</small></span>
                <time>{ago(i.since, now)}</time>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
