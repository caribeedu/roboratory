// Leaving build mode (D41): every changed file with its diff, what still blocks saving,
// files changed on disk meanwhile, and save or discard.
import { useState } from 'react';
import type { BuildView } from '../../shared/build';
import { diffLines } from '../../shared/diff';

export function SaveDialog({ view, reason, onSave, onDiscard, onClose }: {
  view: BuildView; reason?: string;
  onSave: (resolutions: Record<string, 'mine' | 'disk'>) => void; onDiscard: () => void; onClose: () => void;
}) {
  const [resolutions, setResolutions] = useState<Record<string, 'mine' | 'disk'>>({});
  const [open, setOpen] = useState<string | null>(view.changes.length === 1 ? view.changes[0].path : null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const conflicts = view.changes.filter((c) => c.conflict);
  const unresolved = conflicts.filter((c) => !resolutions[c.path]);
  const canSave = view.changes.length > 0 && !view.blocked.length && !unresolved.length;
  return (
    <div className="modal-back" role="presentation" onClick={onClose}>
      <div className="modal frame save-dialog" role="dialog" aria-label="Save build changes" onClick={(e) => e.stopPropagation()}>
        <h2>{view.changes.length ? `Save ${view.changes.length} file change${view.changes.length === 1 ? '' : 's'}?` : 'Nothing to save'}</h2>
        {reason && <p className="muted">{reason}</p>}
        {view.affected.length > 0 && <p className="small">Changes <b>{view.affected.map((a) => a.name).join(', ')}</b>{view.affected.some((a) => a.sectorId !== view.sectorId) ? ', including lines in other sectors' : ''}.</p>}
        {view.blocked.length > 0 && <div className="blocked">{view.blocked.map((b, i) => <p key={i}>{b}</p>)}</div>}
        {view.issues.length > 0 && <ul className="issues">{view.issues.map((i, k) => <li key={k}>{i.message}</li>)}</ul>}
        {conflicts.length > 0 && (
          <div className="conflicts">
            <p><b>Changed on disk during this session.</b> Choose which version to keep for each file.</p>
            {conflicts.map((c) => (
              <div key={c.path} className="conflict-row">
                <code>{c.path}</code>
                <label className="chk"><input type="radio" name={`c-${c.path}`} checked={resolutions[c.path] === 'mine'} onChange={() => setResolutions({ ...resolutions, [c.path]: 'mine' })} /> keep mine</label>
                <label className="chk"><input type="radio" name={`c-${c.path}`} checked={resolutions[c.path] === 'disk'} onChange={() => setResolutions({ ...resolutions, [c.path]: 'disk' })} /> take the one on disk</label>
              </div>
            ))}
          </div>
        )}
        <ul className="file-list">
          {view.changes.map((c) => (
            <li key={c.path}>
              <button className="file-row" aria-expanded={open === c.path} onClick={() => setOpen(open === c.path ? null : c.path)}>
                <span className={`st st-${c.status}`}>{c.status}</span><code>{c.path}</code>
                {c.staleComment && <span className="tag warn" title="The structure of this line changed below a comment at the top of the file">summary comment may be stale</span>}
                {c.conflict && <span className="tag warn">changed on disk</span>}
              </button>
              {open === c.path && (
                <pre className="diffbox">{diffLines(c.before ?? '', c.after ?? '').filter((d, i, arr) => d.t !== ' ' || arr.slice(Math.max(0, i - 2), i + 3).some((x) => x.t !== ' ')).map((d, i) => <span key={i} className={`d${d.t === '+' ? 'a' : d.t === '-' ? 'r' : 'c'}`}>{d.t} {d.s}{'\n'}</span>)}</pre>
              )}
            </li>
          ))}
        </ul>
        <div className="actions">
          <button className="btn primary" disabled={!canSave} onClick={() => onSave(resolutions)}>Save the files</button>
          {!confirmDiscard
            ? <button className="btn ghost" onClick={() => (view.changes.length ? setConfirmDiscard(true) : onDiscard())}>{view.changes.length ? 'Discard everything' : 'Leave build mode'}</button>
            : <><span className="confirm-q small">Discard {view.changes.length} change{view.changes.length === 1 ? '' : 's'}?</span><button className="btn ghost" onClick={onDiscard}>Yes, discard</button></>}
          <button className="btn ghost" onClick={onClose}>Keep editing</button>
        </div>
        <p className="muted small">Promptory only writes files. Commit them with git when you are ready.</p>
      </div>
    </div>
  );
}
