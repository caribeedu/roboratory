// One line in a machine's panel: what this version of the piece usually costs and takes (D47).
import { useEffect, useState } from 'react';
import type { PieceStats } from '../../shared/types';
import { duration, money } from '../../shared/statsview';
import { api } from '../store';

/** `draft`: the version is the one in the build-mode draft. `rev` makes it read again when the draft or the runs change. */
export function PieceHistory({ lineId, pieceId, draft = false, rev }: { lineId: string; pieceId: string; draft?: boolean; rev?: unknown }) {
  const [piece, setPiece] = useState<PieceStats | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void api().stats({ lineId, draft, allVersions: true }).then(
      (s) => { if (alive) setPiece(s?.lines?.find((l) => l.lineId === lineId)?.pieces.find((p) => p.pieceId === pieceId) ?? null); },
      () => { if (alive) setPiece(null); },
    );
    return () => { alive = false; };
  }, [lineId, pieceId, draft, rev]);
  if (!piece) return null;
  const now = piece.rows.find((r) => r.current);
  const typical = (r: NonNullable<typeof now>) => `${duration(r.duration.median)} · ${money(r.cost.median)} · ${r.attempts.mean.toFixed(1)} attempt${r.attempts.mean === 1 ? '' : 's'} (${r.runs} run${r.runs === 1 ? '' : 's'})`;
  if (now) return <p className="piece-history muted small" title="This version of the piece, over its runs">Usually {typical(now)}</p>;
  const before = piece.rows[0];
  if (!before) return <p className="piece-history muted small">No runs yet.</p>;
  return <p className="piece-history muted small">No runs of this version yet. The one before: {typical(before)}</p>;
}
