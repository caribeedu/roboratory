// Builds a belt rule from the fields the box really has (D41): pick a field, a comparison and a
// value; enum fields offer their values. Text mode covers anything the rows cannot express.
import { useEffect, useState } from 'react';
import type { FieldInfo } from '../../shared/build';
import { parseExpr } from '../../shared/expr';
import { Rule } from '../panels/Inspector';
import { api } from '../store';

type Op = '==' | '!=' | 'in' | '>=' | '<=' | '>' | '<';
interface Row { field: string; op: Op; value: string }
const OPS: { op: Op; label: string }[] = [
  { op: '==', label: 'is' }, { op: '!=', label: 'is not' }, { op: 'in', label: 'is one of' },
  { op: '>=', label: 'is at least' }, { op: '<=', label: 'is at most' }, { op: '>', label: 'is more than' }, { op: '<', label: 'is less than' },
];

/** A value as the rule writes it: quoted for text fields, bare for numbers and booleans. */
const literal = (v: string, type?: string) => {
  const t = v.trim();
  const bare = type === 'number' || type === 'integer' || type === 'boolean' || (!type && (/^-?\d+(\.\d+)?$/.test(t) || t === 'true' || t === 'false'));
  return bare ? t : `'${t.replace(/'/g, '')}'`;
};

export function toRule(rows: Row[], join: '&&' | '||', fields: FieldInfo[]): string {
  return rows.filter((r) => r.field && r.value.trim()).map((r) => {
    const type = fields.find((f) => f.path === r.field)?.type;
    if (r.op === 'in') return `${r.field} in [${r.value.split(',').map((x) => literal(x, type)).join(', ')}]`;
    return `${r.field} ${r.op} ${literal(r.value, type)}`;
  }).join(` ${join} `);
}

/** Reads a rule back into rows when it is a flat list of simple comparisons. */
export function fromRule(src: string): { rows: Row[]; join: '&&' | '||' } | null {
  if (!src.trim()) return { rows: [], join: '&&' };
  const join = src.includes('||') ? '||' : '&&';
  if (src.includes('&&') && src.includes('||')) return null;
  const rows: Row[] = [];
  for (const part of src.split(join)) {
    const m = /^\s*([A-Za-z_][\w.-]*)\s*(==|!=|>=|<=|>|<|in)\s*(.+?)\s*$/.exec(part);
    if (!m) return null;
    const raw = m[3];
    const value = m[2] === 'in'
      ? (/^\[(.*)\]$/.exec(raw)?.[1] ?? '').split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).join(', ')
      : raw.replace(/^['"]|['"]$/g, '');
    rows.push({ field: m[1], op: m[2] as Op, value });
  }
  return { rows, join };
}

export function RuleBuilder({ lineId, from, value, required, back, onSave, onCancel }: {
  lineId: string; from: string; value?: string; required?: boolean; back?: boolean;
  onSave: (when: string | null) => void; onCancel: () => void;
}) {
  const [fields, setFields] = useState<FieldInfo[]>([]);
  const [open, setOpen] = useState(false);
  const parsed = fromRule(value ?? '');
  const [text, setText] = useState(parsed ? null : value ?? '');
  const [rows, setRows] = useState<Row[]>(parsed?.rows.length ? parsed.rows : [{ field: '', op: '==', value: '' }]);
  const [join, setJoin] = useState<'&&' | '||'>(parsed?.join ?? '&&');
  useEffect(() => { void api().buildFields(lineId, from, back).then((r) => { setFields(r.fields); setOpen(r.open); }); }, [lineId, from, back]);

  const rule = text !== null ? text.trim() : toRule(rows, join, fields);
  let error = '';
  if (rule) { try { parseExpr(rule); } catch (e) { error = (e as Error).message; } }
  const set = (i: number, r: Partial<Row>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...r } : x)));

  return (
    <div className="rule-builder">
      {text === null ? (
        <>
          {rows.map((r, i) => {
            const f = fields.find((x) => x.path === r.field);
            return (
              <div key={i} className="rule-row">
                <select aria-label="Field" value={r.field} onChange={(e) => set(i, { field: e.target.value, value: '' })}>
                  <option value="">field…</option>
                  {fields.map((x) => <option key={x.path} value={x.path} title={x.description}>{x.path}</option>)}
                  {r.field && !f && <option value={r.field}>{r.field} (not sent)</option>}
                </select>
                <select aria-label="Comparison" value={r.op} onChange={(e) => set(i, { op: e.target.value as Op })}>
                  {OPS.filter((o) => (f?.values ? ['==', '!=', 'in'].includes(o.op) : true)).map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
                </select>
                {f?.values && r.op !== 'in'
                  ? <select aria-label="Value" value={r.value} onChange={(e) => set(i, { value: e.target.value })}><option value="">value…</option>{f.values.map((v) => <option key={v} value={v}>{v}</option>)}</select>
                  : <input aria-label="Value" value={r.value} placeholder={r.op === 'in' ? (f?.values?.join(', ') ?? 'a, b') : 'value'} onChange={(e) => set(i, { value: e.target.value })} />}
                <button className="icon" aria-label="Remove condition" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
              </div>
            );
          })}
          <div className="rule-tools">
            <button className="link small" onClick={() => setRows([...rows, { field: '', op: '==', value: '' }])}>+ condition</button>
            {rows.length > 1 && (
              <select aria-label="Combine conditions" value={join} onChange={(e) => setJoin(e.target.value as '&&' | '||')}>
                <option value="&&">all must hold</option><option value="||">any may hold</option>
              </select>
            )}
            <button className="link small" onClick={() => setText(rule)}>Edit as text</button>
          </div>
          {open && <p className="muted small">The box before this belt has no declared shape, so any field is accepted.</p>}
        </>
      ) : (
        <>
          <input className="mono" aria-label="Rule" value={text} onChange={(e) => setText(e.target.value)} placeholder="verdict == 'pass'" />
          <div className="rule-tools"><button className="link small" onClick={() => { const p = fromRule(text); if (p) { setRows(p.rows.length ? p.rows : rows); setJoin(p.join); setText(null); } }} disabled={!fromRule(text)}>Back to the builder</button></div>
        </>
      )}
      <p className="rule-preview">{error ? <span className="err">{error}</span> : rule ? <>Taken when <Rule src={rule} /></> : <span className="muted">{required ? 'A return belt needs a rule.' : 'No rule: every box takes this belt.'}</span>}</p>
      <div className="actions">
        <button className="btn primary" disabled={!!error || (required && !rule)} onClick={() => onSave(rule || null)}>Save rule</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
