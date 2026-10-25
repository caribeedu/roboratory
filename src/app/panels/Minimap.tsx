// Every sector at a glance; a sector that needs you changes colour (D36).
import { isBurning, type AttentionItem, type LineView, type Snapshot } from '../../shared/types';

export function Minimap({ factory, lines, attention, current, onPick }: { factory: NonNullable<Snapshot['factory']>; lines: Record<string, LineView>; attention: AttentionItem[]; current: string; onPick: (id: string) => void }) {
  return (
    <nav className="minimap frame" aria-label="Sectors">
      <div className="panel-head static">Sectors</div>
      <ul>
        {factory.sectors.map((s) => {
          const items = attention.filter((a) => a.sectorId === s.id);
          const level = items.some(isBurning) ? 'fire' : items.length ? 'hold' : '';
          return (
            <li key={s.id}>
              <button className={`room ${level}${s.id === current ? ' current' : ''}`} onClick={() => onPick(s.id)} aria-current={s.id === current} style={{ ['--sector' as string]: s.color }}>
                <span className="room-name">{s.name}{items.length > 0 && <em>{items.length}</em>}</span>
                <span className="room-lines">
                  {s.lines.map((l) => (
                    <span key={l.id} className="room-line">
                      {l.pieces.filter((p) => p.kind !== 'intake').map((p) => {
                        const st = lines[l.id]?.pieces[p.id]?.state ?? 'idle';
                        return <i key={p.id} className={`st-${st} k-${p.kind}`} title={`${l.name}: ${p.label} (${st})`} />;
                      })}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
