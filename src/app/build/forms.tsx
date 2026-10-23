// Small form pieces for build mode: fields that save when you leave them, and draft files.
import { createContext, useContext, useEffect, useState } from 'react';
import { GOAL_MAX } from '../../shared/types';
import { api } from '../store';

/** A draft file's content, re-read whenever the draft changes (`rev`). */
export function useDraftFile(path: string | undefined, rev: unknown): string | null | undefined {
  const [text, setText] = useState<string | null | undefined>(undefined);
  useEffect(() => { if (path) void api().buildRead(path).then(setText); else setText(undefined); }, [path, rev]);
  return text;
}

/** Bumped on every new draft and on every refused edit, so fields show what the draft really holds. */
export const DraftRev = createContext(0);

/** For an edit refused before it reaches the draft: re-syncs the fields inside it. */
export function useRefusal(): [(children: React.ReactNode) => React.ReactNode, () => void] {
  const outer = useContext(DraftRev);
  const [n, setN] = useState(0);
  return [(children) => <DraftRev.Provider value={outer * 1000 + n}>{children}</DraftRev.Provider>, () => setN((x) => x + 1)];
}

/** A text input that saves on blur or Enter, not on every keystroke (each save is one undo step). */
export function Commit({ value, onCommit, label, placeholder, multiline, rows = 6, mono, type = 'text' }: {
  value: string; onCommit: (v: string) => void; label?: string; placeholder?: string; multiline?: boolean; rows?: number; mono?: boolean; type?: string;
}) {
  const [v, setV] = useState(value);
  const rev = useContext(DraftRev);
  useEffect(() => { setV(value); }, [value, rev]);
  const commit = () => { if (v !== value) onCommit(v); };
  const cls = mono ? 'mono' : undefined;
  return multiline
    ? <textarea className={cls} aria-label={label} rows={rows} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} />
    : <input className={cls} aria-label={label} type={type} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

/** A goal (GOAL_MAX characters at most), saved on blur, with a counter. */
export function GoalField({ value, onCommit, placeholder }: { value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useState(value);
  const rev = useContext(DraftRev);
  useEffect(() => { setV(value); }, [value, rev]);
  return (
    <span className="goal-field">
      <textarea aria-label="Goal" rows={3} maxLength={GOAL_MAX} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== value) onCommit(v); }} />
      <span className="b-hint goal-count">{v.length}/{GOAL_MAX}</span>
    </span>
  );
}

/** A list of strings edited as one comma-separated field. */
export function ListField({ value, onCommit, label, placeholder }: { value: string[]; onCommit: (v: string[]) => void; label: string; placeholder?: string }) {
  return <Commit label={label} value={value.join(', ')} placeholder={placeholder} onCommit={(v) => onCommit(v.split(',').map((x) => x.trim()).filter(Boolean))} />;
}

export function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="b-row">
      <span className="b-label">{label}</span>
      <span className="b-field">{children}</span>
      {hint && <span className="b-hint">{hint}</span>}
    </div>
  );
}

export const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
