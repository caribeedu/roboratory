// A box (any JSON) for people: readable labels, Markdown text, lists and nested blocks,
// with the raw JSON one click away. Field descriptions come from the contracts that produce them.
import { useState } from 'react';
import type { Snapshot } from '../shared/types';
import { Markdown } from './Markdown';

type Line = NonNullable<Snapshot['factory']>['sectors'][number]['lines'][number];

const label = (k: string) => k.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase());

/** Top-level field descriptions from the contracts of a line's machines (or of one piece). */
export function fieldDescriptions(line: Line | undefined, pieceId?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of line?.pieces ?? []) {
    if (pieceId && p.id !== pieceId) continue;
    const props = (p.contract?.properties ?? {}) as Record<string, { description?: unknown }>;
    for (const [k, v] of Object.entries(props)) if (typeof v?.description === 'string' && !out[k]) out[k] = v.description;
  }
  return out;
}

function Value({ v, depth }: { v: unknown; depth: number }) {
  if (v === null || v === undefined || v === '') return <span className="muted">—</span>;
  if (typeof v === 'string') return <Markdown text={v} compact />;
  if (typeof v === 'number' || typeof v === 'boolean') return <span className="rule-val">{String(v)}</span>;
  if (Array.isArray(v)) {
    if (!v.length) return <span className="muted">none</span>;
    if (v.every((x) => x === null || typeof x !== 'object')) return <ul className="box-list">{v.map((x, i) => <li key={i}><Value v={x} depth={depth + 1} /></li>)}</ul>;
    return <ol className="box-items">{v.map((x, i) => <li key={i}><Value v={x} depth={depth + 1} /></li>)}</ol>;
  }
  if (typeof v === 'object') return <Fields obj={v as Record<string, unknown>} depth={depth + 1} />;
  return <span>{String(v)}</span>;
}

function Fields({ obj, depth, descriptions = {} }: { obj: Record<string, unknown>; depth: number; descriptions?: Record<string, string> }) {
  const entries = Object.entries(obj);
  if (!entries.length) return <span className="muted">empty</span>;
  return (
    <dl className={`box-dl${depth ? ' nested' : ''}`}>
      {entries.map(([k, v]) => (
        <div key={k} className="box-row">
          <dt title={depth === 0 ? descriptions[k] : undefined}>{label(k)}</dt>
          <dd><Value v={v} depth={depth} /></dd>
        </div>
      ))}
    </dl>
  );
}

/** With `raw` given, the caller owns the JSON toggle (e.g. beside a section title); otherwise it sits below. */
export function BoxView({ value, descriptions, raw: rawProp }: { value: unknown; descriptions?: Record<string, string>; raw?: boolean }) {
  const [rawOwn, setRaw] = useState(false);
  const raw = rawProp ?? rawOwn;
  return (
    <div className="box-view">
      {raw || value === null || typeof value !== 'object' || Array.isArray(value)
        ? <pre className="json">{JSON.stringify(value, null, 2)}</pre>
        : <Fields obj={value as Record<string, unknown>} depth={0} descriptions={descriptions} />}
      {rawProp === undefined && <button className="btn ghost small" onClick={() => setRaw(!raw)}>{raw ? 'Readable' : 'JSON'}</button>}
    </div>
  );
}
