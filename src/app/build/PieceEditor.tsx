// Build mode's piece panel (D41): what a piece is, what it reads and sends, and where its belts go.
import { useContext, useEffect, useState } from 'react';
import YAML from 'yaml';
import type { BuildOp, BuildView, FieldInfo, MachineConf } from '../../shared/build';
import { AGENTS, type Snapshot } from '../../shared/types';
import { Markdown } from '../Markdown';
import { Head, Rule, Section } from '../panels/Inspector';
import { api } from '../store';
import { Commit, DraftRev, GoalField, ListField, Row, useDraftFile, useRefusal } from './forms';
import { PieceHistory } from '../panels/PieceHistory';
import { PieceRehearsal } from './Rehearsal';
import { RuleBuilder } from './RuleBuilder';

type Line = NonNullable<Snapshot['factory']>['sectors'][number]['lines'][number];
type Piece = Line['pieces'][number];
export type Op = (op: BuildOp) => Promise<boolean>;

const KIND = { intake: 'Intake', machine: 'Machine', signal: 'Signal', gate: 'Gate', pallet: 'Pallet' } as const;
const labelOf = (line: Line, id: string) => { const p = line.pieces.find((x) => x.id === id); return p ? (p.kind === 'intake' ? line.intake.label || 'Intake' : p.label) : id; };
export const modelDir = (line: Line) => (line.sharedModel ? `shared/models/${line.model}` : `sectors/${line.id.split('/')[0]}/models/${line.model}`);

export function PieceEditor({ view, line, piece, op, onConnect, onClose, onLive }: {
  view: BuildView; line: Line; piece: Piece; op: Op; onConnect: (from: string) => void; onClose: () => void;
  /** opens the running piece's own panel (gates, fires, dispatch), when it exists on disk */
  onLive?: () => void;
}) {
  const lines = view.factory.sectors.flatMap((s) => s.lines);
  const sameModel = lines.filter((l) => l.model === line.model && l.sharedModel === line.sharedModel);
  const sectors = new Set(sameModel.map((l) => l.id.split('/')[0]));
  return (
    <aside className="inspector frame build-insp" aria-label={`Edit ${piece.label}`}>
      <Head title={piece.kind === 'intake' ? line.intake.label || 'Intake' : piece.label} sub={`${KIND[piece.kind]} · ${line.name} · editing`} onClose={onClose} />
      <div className="insp-body">
        {(() => {
          const mine = view.issues.filter((i) => i.pieceId === piece.id && i.lineIds.includes(line.id));
          return mine.length ? <ul className="issue-list" aria-label="Problems">{mine.map((i, k) => <li key={k}>{i.message}</li>)}</ul> : null;
        })()}
        <PieceRehearsal lineId={line.id} pieceId={piece.id} label={(id) => labelOf(line, id)} op={op} />
        {onLive && <button className="link small live-link" onClick={onLive}>Open the live panel (runs, gates, dispatch)</button>}
        {sameModel.length > 1 && (
          <div className="reach-note">
            <p>This line is built from the model <b>{line.model}</b>, shared by <b>{sameModel.length} lines</b>{sectors.size > 1 ? <> in <b>{sectors.size} sectors</b></> : null}: {sameModel.map((l) => l.name).join(', ')}. Changes here change all of them.</p>
            <SeparateModel line={line} op={op} />
          </div>
        )}
        {piece.kind === 'intake' && <IntakeForm line={line} op={op} />}
        {piece.kind !== 'intake' && (
          <Row label="Name"><Commit label="Name" value={piece.label} onCommit={(v) => void op({ op: 'setPiece', lineId: line.id, pieceId: piece.id, label: v })} /></Row>
        )}
        {piece.kind === 'machine' && piece.usedBy && piece.usedBy.lines > 1 && (
          <p className="reach-note">This machine (<code>{piece.definedIn}</code>) is used by {piece.usedBy.lines} lines in {piece.usedBy.sectors} sector{piece.usedBy.sectors === 1 ? '' : 's'}.</p>
        )}
        {(piece.kind === 'machine' || piece.kind === 'signal' || piece.kind === 'gate') && view.factory.lineContext && (
          <p className="reach-note">Line context is on: goals are sent to the model with every run of the line, which can cost a little more.</p>
        )}
        {(piece.kind === 'machine' || piece.kind === 'signal' || piece.kind === 'gate') && (
          <Row label="Goal" hint={piece.kind === 'machine' ? 'In this line. Leave it empty to use the machine\'s default goal.' : 'What this piece is for, for you and for the agents.'}>
            <GoalField value={piece.goal ?? ''}
              placeholder={piece.machineGoal ? `Machine default: ${piece.machineGoal}` : 'What this step is for, in a sentence or two'}
              onCommit={(goal) => void op({ op: 'setPiece', lineId: line.id, pieceId: piece.id, goal })} />
          </Row>
        )}
        {piece.kind === 'machine' && <MachineForms view={view} line={line} piece={piece} op={op} />}
        {piece.kind === 'gate' && <GateForm line={line} piece={piece} op={op} />}
        {piece.kind === 'signal' && <SignalForm view={view} line={line} piece={piece} op={op} />}
        <FlowEditor line={line} piece={piece} op={op} onConnect={onConnect} />
        {piece.kind !== 'intake' && piece.kind !== 'pallet' && (
          <div className="danger-zone">
            <button className="btn ghost" onClick={() => void op({ op: 'remove', lineId: line.id, pieceId: piece.id }).then((ok) => ok && onClose())}>Remove this {piece.kind}</button>
            <p className="muted small">Its belts stay open in red until you connect what it fed.{piece.kind === 'machine' ? ' Its folder is deleted unless another piece uses the same machine.' : ''}</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function SeparateModel({ line, op }: { line: Line; op: Op }) {
  const [name, setName] = useState<string | null>(null);
  if (name === null) return <button className="btn ghost small" onClick={() => setName(`${line.model}-${line.id.split('/')[1]}`)}>Separate this line into its own model</button>;
  return (
    <div className="inline-form">
      <input aria-label="New model name" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn primary small" onClick={() => void op({ op: 'separateModel', lineId: line.id, model: name }).then((ok) => ok && setName(null))}>Copy the model</button>
      <button className="btn ghost small" onClick={() => setName(null)}>Cancel</button>
    </div>
  );
}

// ---------- flow: belts in and out ----------

function FlowEditor({ line, piece, op, onConnect }: { line: Line; piece: Piece; op: Op; onConnect: (from: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [newPath, setNewPath] = useState(false);
  const outs = line.pieces.flatMap((p) => p.needs.filter((n) => n.from === piece.id).map((n) => ({ to: p.id, need: n })));
  const belt = (from: string, to: string, n: Piece['needs'][number]) => {
    const key = `${from}>${to}>${n.back ? 'b' : 'f'}`;
    return (
      <li key={key}>
        <div className="belt-row">
          <span>{n.back ? <>Back from "{labelOf(line, from)}" to "{labelOf(line, to)}"</> : <>"{labelOf(line, from)}" → "{labelOf(line, to)}"</>}{n.when ? <> when <Rule src={n.when} /></> : null}{n.back ? <> (at most <span className="rule-val">{n.laps ?? 3}</span> times)</> : null}</span>
          <span className="belt-actions">
            <button className="link small" onClick={() => setEditing(editing === key ? null : key)}>{n.when ? 'Edit rule' : 'Add rule'}</button>
            <button className="icon" aria-label="Remove this belt" title="Remove this belt" onClick={() => void op({ op: 'disconnect', lineId: line.id, from, to, back: n.back })}>✕</button>
          </span>
        </div>
        {editing === key && (
          <>
            <RuleBuilder lineId={line.id} from={from} value={n.when} required={n.back} back={n.back} onCancel={() => setEditing(null)}
              onSave={(when) => void op({ op: 'setRule', lineId: line.id, from, to, back: n.back, when }).then((ok) => ok && setEditing(null))} />
            {n.back && <Row label="Laps"><Commit type="number" label="Laps" value={String(n.laps ?? 3)} onCommit={(v) => void op({ op: 'setRule', lineId: line.id, from, to, back: true, laps: Number(v) })} /></Row>}
          </>
        )}
      </li>
    );
  };
  return (
    <Section title="Flow">
      {piece.kind !== 'intake' && <><p className="flow-h">Comes from</p><ul className="flow">{piece.needs.length ? piece.needs.map((n) => belt(n.from, piece.id, n)) : <li className="err">Nothing: connect a piece into this one.</li>}</ul></>}
      {piece.kind !== 'pallet' && <><p className="flow-h">Goes to</p><ul className="flow">{outs.length ? outs.map((o) => belt(piece.id, o.to, o.need)) : <li className="err">Nowhere yet.</li>}</ul></>}
      {piece.kind !== 'pallet' && (
        <div className="actions">
          <button className="btn small" onClick={() => onConnect(piece.id)}>Connect to…</button>
          {!newPath
            ? <button className="btn ghost small" onClick={() => setNewPath(true)}>Add a new path from here</button>
            : (['machine', 'signal', 'gate'] as const).map((k) => <button key={k} className="btn ghost small" onClick={() => { setNewPath(false); void op({ op: 'insert', lineId: line.id, at: { from: piece.id }, kind: k }); }}>+ {k}</button>)}
        </div>
      )}
    </Section>
  );
}

// ---------- intake ----------

function IntakeForm({ line, op }: { line: Line; op: Op }) {
  const inputs = line.intake.inputs;
  const save = (next: typeof inputs) => void op({ op: 'setIntake', lineId: line.id, inputs: next });
  return (
    <>
      <Row label="Name"><Commit label="Intake name" value={line.intake.label ?? ''} placeholder="Intake" onCommit={(v) => void op({ op: 'setIntake', lineId: line.id, label: v })} /></Row>
      <Row label="Starts" hint="Timer, webhook and chat intakes come later; this one starts when you dispatch it."><span>by hand (manual)</span></Row>
      <Section title="Dispatch form">
        <ul className="b-list">
          {inputs.map((i, k) => (
            <li key={k} className="b-grid4">
              <Commit label="Field name" value={i.name} onCommit={(v) => save(inputs.map((x, j) => (j === k ? { ...x, name: v } : x)))} />
              <Commit label="Label" value={i.label ?? ''} placeholder="Label" onCommit={(v) => save(inputs.map((x, j) => (j === k ? { ...x, label: v || undefined } : x)))} />
              <Commit label="Example" value={i.placeholder ?? ''} placeholder="Example" onCommit={(v) => save(inputs.map((x, j) => (j === k ? { ...x, placeholder: v || undefined } : x)))} />
              <span className="b-inline">
                <label className="chk"><input type="checkbox" checked={!!i.required} onChange={(e) => save(inputs.map((x, j) => (j === k ? { ...x, required: e.target.checked } : x)))} /> required</label>
                <label className="chk"><input type="checkbox" checked={!!i.multiline} onChange={(e) => save(inputs.map((x, j) => (j === k ? { ...x, multiline: e.target.checked || undefined } : x)))} /> long text</label>
                <button className="icon" aria-label="Remove field" onClick={() => save(inputs.filter((_, j) => j !== k))}>✕</button>
              </span>
            </li>
          ))}
        </ul>
        <button className="link small" onClick={() => save([...inputs, { name: `field${inputs.length + 1}` }])}>+ field</button>
      </Section>
    </>
  );
}

// ---------- gate ----------

function GateForm({ line, piece, op }: { line: Line; piece: Piece; op: Op }) {
  const kind = piece.rule !== undefined ? 'rule' : piece.choices ? 'choices' : 'release';
  const [ruleOpen, setRuleOpen] = useState(false);
  const input = piece.needs.find((n) => !n.back)?.from;
  const set = (g: Parameters<typeof gateOp>[2]) => void op(gateOp(line, piece, g));
  return (
    <>
      <Row label="Opens">
        <span className="seg-inline">
          {(['release', 'choices', 'rule'] as const).map((k) => (
            <label key={k} className="chk"><input type="radio" name="gate-kind" checked={kind === k} onChange={() => set(k === 'release' ? { kind: 'release', confirmations: piece.confirmations ?? 1 } : k === 'choices' ? { kind: 'choices', choices: piece.choices ?? ['approve', 'revise'] } : { kind: 'rule', rule: piece.rule ?? '' })} />
              {k === 'release' ? 'when you release it' : k === 'choices' ? 'when you choose' : 'automatically, by a rule'}</label>
          ))}
        </span>
      </Row>
      {kind !== 'rule' && <Row label="Confirmations" hint="How many times it asks &quot;are you sure?&quot;"><Commit type="number" label="Confirmations" value={String(piece.confirmations ?? 1)} onCommit={(v) => set(kind === 'choices' ? { kind: 'choices', choices: piece.choices ?? [], confirmations: Number(v) } : { kind: 'release', confirmations: Number(v) })} /></Row>}
      {kind === 'choices' && <Row label="Choices" hint="Belts out of this gate route on decision.choice; renaming a choice turns the rules that use it red."><ListField label="Choices" value={piece.choices ?? []} onCommit={(v) => set({ kind: 'choices', choices: v, confirmations: piece.confirmations })} /></Row>}
      {kind === 'rule' && (
        <Row label="Rule">
          {!ruleOpen ? <span>{piece.rule ? <Rule src={piece.rule} /> : <span className="err">No rule yet.</span>} <button className="link small" onClick={() => setRuleOpen(true)}>Edit</button></span>
            : input ? <RuleBuilder lineId={line.id} from={input} value={piece.rule} required onCancel={() => setRuleOpen(false)} onSave={(w) => { setRuleOpen(false); if (w) set({ kind: 'rule', rule: w }); }} />
              : <span className="err">Connect an input first; the rule reads its box.</span>}
        </Row>
      )}
    </>
  );
}
const gateOp = (line: Line, piece: Piece, gate: Extract<BuildOp, { op: 'setPiece' }>['gate']): BuildOp => ({ op: 'setPiece', lineId: line.id, pieceId: piece.id, gate });

// ---------- signal ----------

function SignalForm({ view, line, piece, op }: { view: BuildView; line: Line; piece: Piece; op: Op }) {
  const [fields, setFields] = useState<FieldInfo[]>([]);
  const input = piece.needs.find((n) => !n.back)?.from;
  useEffect(() => { if (input) void api().buildFields(line.id, input).then((r) => setFields(r.fields)); }, [line.id, input, view]);
  const script = /(?:^|\s)signals\/([\w.-]+)/.exec(piece.run ?? '')?.[1];
  const local = script ? `${modelDir(line)}/signals/${script}` : undefined;
  const localText = useDraftFile(local, view);
  const shared = script && localText === null ? `shared/signals/${script}` : undefined;
  const sharedText = useDraftFile(shared, view);
  const file = localText != null ? local : sharedText != null ? shared : undefined;
  const text = localText ?? sharedText;
  const setRun = (run: string) => void op({ op: 'setPiece', lineId: line.id, pieceId: piece.id, run });
  const [cmd, setCmd] = useState(piece.run ?? '');
  const rev = useContext(DraftRev);
  useEffect(() => { setCmd(piece.run ?? ''); }, [piece.run, rev]);
  const newScript = () => {
    const name = `${piece.id}.sh`;
    void op({ op: 'batch', ops: [
      { op: 'writeFile', path: `${modelDir(line)}/signals/${name}`, content: '#!/bin/sh\n# Exit 0 to pass the box on; anything else fails: a return belt can send the box back.\n# The incoming box is in "$ROBORATORY_BOX" (JSON).\nexit 0\n', executable: true },
      { op: 'setPiece', lineId: line.id, pieceId: piece.id, run: `signals/${name}` },
    ] });
  };
  return (
    <>
      <Row label="Command" hint="Exit code 0 passes the box on. Anything else sends the box back along a return belt that takes it, or stops the line here.">
        <input className="mono" aria-label="Command" value={cmd} onChange={(e) => setCmd(e.target.value)}
          onBlur={() => { if (cmd !== (piece.run ?? '')) setRun(cmd); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </Row>
      <Row label="Timeout" hint="How long the command may run before it is stopped as failed.">
        <Commit label="Timeout" value={piece.timeout ?? ''} placeholder="10m" onCommit={(v) => void op({ op: 'setPiece', lineId: line.id, pieceId: piece.id, timeout: v })} />
      </Row>
      {fields.length > 0 && (
        <p className="b-hint">From the box: {fields.map((f) => (
          <button key={f.path} className="chip ev" title={f.description} onMouseDown={(e) => e.preventDefault()}
            onClick={() => { const next = `${cmd} {{box.${f.path}}}`.trim(); setCmd(next); setRun(next); }}>{`{{box.${f.path}}}`}</button>
        ))}</p>
      )}
      {file ? (
        <Section title={`Script · ${file}`}>
          {shared && <p className="muted small">This script is in <code>shared/signals</code>; other lines may use it.</p>}
          <Commit multiline mono rows={10} label="Script" value={text ?? ''} onCommit={(v) => void op({ op: 'writeFile', path: file, content: v, executable: true })} />
        </Section>
      ) : script ? <p className="err small">signals/{script} does not exist yet.</p> : <button className="btn ghost small" onClick={newScript}>Write a script for this signal</button>}
    </>
  );
}

// ---------- machine ----------

const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];

function MachineForms({ view, line, piece, op }: { view: BuildView; line: Line; piece: Piece; op: Op }) {
  const dir = piece.definedIn!;
  const raw = useDraftFile(`${dir}/machine.yaml`, view);
  let conf: Record<string, unknown> = {};
  try { conf = YAML.parse(raw ?? '') ?? {}; } catch { /* shown by the checks */ }
  const set = (c: MachineConf) => void op({ op: 'setMachine', lineId: line.id, pieceId: piece.id, conf: c });
  const arr = (k: string) => (Array.isArray(conf[k]) ? (conf[k] as unknown[]).map(String) : []);
  return (
    <>
      <PieceHistory lineId={line.id} pieceId={piece.id} draft rev={view} />
      <Section title="Agent">
        <Row label="Agent" hint={String(conf.agent ?? 'claude') === 'sim' ? 'The simulated agent costs nothing.' : 'Real agents spend money on every run.'}>
          <select aria-label="Agent" value={String(conf.agent ?? 'claude')} onChange={(e) => set({ agent: e.target.value })}>{AGENTS.map((a) => <option key={a}>{a}</option>)}</select>
        </Row>
        <Row label="Model"><Commit label="Model" value={String(conf.model ?? '')} placeholder="sonnet" onCommit={(v) => set({ model: v || null })} /></Row>
        <Row label="Effort"><select aria-label="Effort" value={String(conf.effort ?? '')} onChange={(e) => set({ effort: e.target.value || null })}>{EFFORTS.map((x) => <option key={x} value={x}>{x || 'default'}</option>)}</select></Row>
        <Row label="Attempts"><Commit type="number" label="Attempts" value={String(conf.attempts ?? 3)} onCommit={(v) => set({ attempts: Math.max(1, Number(v) || 1) })} /></Row>
        <Row label="Timeout"><Commit label="Timeout" value={String(conf.timeout ?? '10m')} placeholder="10m" onCommit={(v) => set({ timeout: v })} /></Row>
        <Row label="Default goal" hint="In machine.yaml: used by every line that gives this machine no goal of its own.">
          <GoalField value={String(conf.goal ?? '')} placeholder="What this machine is for, in any line" onCommit={(goal) => set({ goal: goal || null })} />
        </Row>
      </Section>
      <Section title="Access">
        <Tools value={arr('tools')} onChange={(tools) => set({ tools })} />
        <Row label="Folders" hint="Extra folders the agent may read and edit, besides its run folder."><ListField label="Folders" value={arr('dirs')} placeholder="~/repos/my-service" onCommit={(dirs) => set({ dirs })} /></Row>
        <Row label="Allowed commands" hint="Commands it may run besides the defaults, as prefixes: npm test, gh pr view. Anything else waits for you."><ListField label="Allowed commands" value={arr('allow')} onCommit={(allow) => set({ allow })} /></Row>
        <Row label="Never allowed" hint="Commands it must never run, added to the factory's, the sector's and the line's."><ListField label="Never allowed" value={arr('deny')} onCommit={(deny) => set({ deny })} /></Row>
        <Row label="Acts outside" hint="Its commands and tools that act outside the machine, such as git push or mcp__slack__post. A rehearsal refuses them; a run does not care."><ListField label="Acts outside" value={arr('outward')} onCommit={(outward) => set({ outward })} /></Row>
        <Row label="Read-only" hint="No file edits and no git push. Commands it is allowed still run."><label><input type="checkbox" aria-label="Read-only" checked={conf.read_only === true} onChange={(e) => set({ read_only: e.target.checked })} /> read-only</label></Row>
      </Section>
      <RoleForms view={view} dir={dir} roles={arr('roles')} setRoles={(roles) => set({ roles })} op={op}
        addRole={(path, content) => op({ op: 'batch', ops: [{ op: 'writeFile', path, content }, { op: 'setMachine', lineId: line.id, pieceId: piece.id, conf: { roles: [...arr('roles'), path] } }] })} />
      <ContractForm view={view} dir={dir} op={op} />
    </>
  );
}

function Tools({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [servers, setServers] = useState<string[] | null | undefined>(undefined);
  const [tool, setTool] = useState('');
  useEffect(() => { void api().buildServers().then(setServers); }, []);
  const server = (t: string) => /^mcp__(.+?)(?:__|$)/.exec(t)?.[1];
  const known = (t: string) => !servers || !server(t) || servers.includes(server(t)!);
  const add = (t: string) => { const v = t.trim(); if (v && !value.includes(v)) onChange([...value, v]); };
  const typedOk = !tool || (/^mcp__[\w-]+(__[\w-]+)?$/.test(tool) && known(tool));
  return (
    <div className="b-row">
      <span className="b-label">Tools</span>
      <span className="b-field">
        <span className="chips">{value.map((t) => <span key={t} className={`chip${known(t) ? '' : ' warn'}`} title={known(t) ? t : `No MCP server "${server(t)}" in Claude Code`}>{t}<button className="icon" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>✕</button></span>)}</span>
        {servers && (
          <select aria-label="Add a whole MCP server" value="" onChange={(e) => add(e.target.value)}>
            <option value="">+ a whole server…</option>
            {servers.map((s) => <option key={s} value={`mcp__${s}`}>{s}</option>)}
          </select>
        )}
        <span className="inline-form">
          <input aria-label="One tool" placeholder="mcp__server__tool" value={tool} onChange={(e) => setTool(e.target.value)} />
          <button className="btn small" disabled={!tool || !typedOk} onClick={() => { add(tool); setTool(''); }}>Add tool</button>
        </span>
        {!typedOk && <span className="err small">Use mcp__server__tool with a server configured in Claude Code.</span>}
        {servers === null && <span className="muted small">Could not run <code>claude mcp list</code>; server names are not checked.</span>}
      </span>
    </div>
  );
}

function RoleForms({ view, dir, roles, setRoles, op, addRole }: { view: BuildView; dir: string; roles: string[]; setRoles: (r: string[]) => void; op: Op; addRole: (path: string, content: string) => Promise<boolean> }) {
  const own = useDraftFile(`${dir}/role.md`, view);
  const [preview, setPreview] = useState(false);
  const [library, setLibrary] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [newRole, setNewRole] = useState('');
  useEffect(() => { void api().buildList('shared/roles').then((l) => setLibrary(l.filter((x) => x.endsWith('.md')).map((x) => `shared/roles/${x}`))); }, [view]);
  return (
    <Section title="Role">
      <p className="b-hint">The agent's instructions: the shared roles below, then this machine's own text, then the factory's and the sector's culture.</p>
      <ul className="b-list">
        {roles.map((r) => {
          const u = view.roles.find((x) => x.path === r);
          return (
            <li key={r}>
              <div className="belt-row">
                <span><code>{r}</code>{u && u.machines.length > 1 ? <span className="muted small"> · used by {u.machines.length} machines in {u.lines} lines</span> : null}</span>
                <span className="belt-actions">
                  <button className="link small" onClick={() => setOpen(open === r ? null : r)}>{open === r ? 'Close' : 'Edit'}</button>
                  <button className="icon" aria-label={`Stop using ${r}`} onClick={() => setRoles(roles.filter((x) => x !== r))}>✕</button>
                </span>
              </div>
              {open === r && <SharedRole view={view} path={r} op={op} users={u} />}
            </li>
          );
        })}
      </ul>
      <span className="inline-form">
        <select aria-label="Use a shared role" value="" onChange={(e) => e.target.value && setRoles([...roles, e.target.value])}>
          <option value="">+ use a shared role…</option>
          {library.filter((r) => !roles.includes(r)).map((r) => <option key={r} value={r}>{r.replace('shared/roles/', '')}</option>)}
        </select>
        <input aria-label="New shared role name" placeholder="new-role" value={newRole} onChange={(e) => setNewRole(e.target.value)} />
        <button className="btn small" disabled={!/^[a-z0-9-]+$/.test(newRole)} onClick={() => { const p = `shared/roles/${newRole}.md`; void addRole(p, `# ${newRole}\n\n`).then((ok) => ok && setNewRole('')); }}>New shared role</button>
      </span>
      <div className="b-head-row"><b>This machine's own role</b> <button className="link small" onClick={() => setPreview(!preview)}>{preview ? 'Edit' : 'Preview'}</button></div>
      {own === undefined ? null : preview
        ? <div className="md-preview"><Markdown text={own ?? ''} /></div>
        : <Commit multiline mono rows={12} label="Role" value={own ?? ''} onCommit={(v) => void op({ op: 'writeFile', path: `${dir}/role.md`, content: v })} />}
    </Section>
  );
}

function SharedRole({ view, path, op, users }: { view: BuildView; path: string; op: Op; users?: BuildView['roles'][number] }) {
  const text = useDraftFile(path, view);
  return (
    <div className="shared-role">
      {users && users.machines.length > 1 && <p className="reach-note">Editing this changes {users.machines.length} machines in {users.lines} lines: {users.machines.map((m) => m.split('/').pop()).join(', ')}.</p>}
      {text !== undefined && <Commit multiline mono rows={10} label={path} value={text ?? ''} onCommit={(v) => void op({ op: 'writeFile', path, content: v })} />}
    </div>
  );
}

// ---------- contract ----------

type Spec = { type?: string; enum?: unknown[]; description?: string; [k: string]: unknown };
const TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object'];

function ContractForm({ view, dir, op }: { view: BuildView; dir: string; op: Op }) {
  const raw = useDraftFile(`${dir}/contract.json`, view);
  const [json, setJson] = useState(false);
  const [jsonError, setJsonError] = useState('');
  const [nameError, setNameError] = useState('');
  const [fresh, refuse] = useRefusal();
  let contract: { properties?: Record<string, Spec>; required?: string[]; [k: string]: unknown } | null = null;
  try { contract = JSON.parse(raw ?? '{"type":"object"}'); } catch { contract = null; }
  const save = (c: object) => void op({ op: 'writeFile', path: `${dir}/contract.json`, content: JSON.stringify(c, null, 2) + '\n' });
  if (raw === undefined) return null;
  const props = contract?.properties ?? {};
  const required = new Set(contract?.required ?? []);
  const setField = (name: string, next: { name?: string; spec?: Spec; required?: boolean } | null) => {
    if (!contract) return;
    const nk = next?.name?.trim();
    if (next?.name !== undefined && (!nk || (nk !== name && props[nk]))) { setNameError(!nk ? 'A field needs a name.' : `There is already a field "${nk}".`); refuse(); return; }
    setNameError('');
    const out: Record<string, Spec> = {};
    for (const [k, v] of Object.entries(props)) {
      if (k !== name) { out[k] = v; continue; }
      if (next) out[nk ?? k] = next.spec ?? v;
    }
    // `required` keeps its order; a renamed field keeps its place in it
    const was = contract.required ?? [];
    let req = was.map((r) => (r === name ? (next ? nk ?? r : null) : r)).filter((r): r is string => !!r);
    if (next?.required === false) req = req.filter((r) => r !== (nk ?? name));
    if (next?.required === true && !req.includes(nk ?? name)) req = [...req, nk ?? name];
    save({ ...contract, type: 'object', properties: out, required: req });
  };
  return fresh(
    <Section title="Contract">
      <p className="b-hint">The JSON the agent must answer with. Belts after this machine route on these fields.</p>
      {json || !contract ? (
        <>
          {!contract && <p className="err small">The contract is not valid JSON; fix it here.</p>}
          <Commit multiline mono rows={12} label="Contract JSON" value={raw ?? ''} onCommit={(v) => { try { JSON.parse(v); setJsonError(''); void op({ op: 'writeFile', path: `${dir}/contract.json`, content: v.endsWith('\n') ? v : v + '\n' }); } catch (e) { setJsonError(`Not saved: ${(e as Error).message}`); } }} />
          {jsonError && <p className="err small">{jsonError}</p>}
          {contract && !jsonError && <button className="link small" onClick={() => setJson(false)}>Back to the field list</button>}
        </>
      ) : (
        <>
          {nameError && <p className="err small">{nameError}</p>}
          <ul className="b-list">
            {Object.entries(props).map(([k, v], i) => (
              <li key={i} className="b-grid4">
                <Commit label="Field" value={k} onCommit={(nk) => nk && setField(k, { name: nk })} />
                <select aria-label="Type" value={v.type ?? 'string'} onChange={(e) => setField(k, { spec: { ...v, type: e.target.value } })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                <Commit label="Allowed values" placeholder="any value" value={(v.enum ?? []).map(String).join(', ')} onCommit={(s) => { const vals = s.split(',').map((x) => x.trim()).filter(Boolean); const { enum: _e, ...rest } = v; setField(k, { spec: vals.length ? { ...rest, enum: vals } : rest }); }} />
                <span className="b-inline">
                  <label className="chk"><input type="checkbox" checked={required.has(k)} onChange={(e) => setField(k, { required: e.target.checked })} /> required</label>
                  <button className="icon" aria-label={`Remove field ${k}`} onClick={() => setField(k, null)}>✕</button>
                </span>
                <Commit label="Description" placeholder="what it means" value={v.description ?? ''} onCommit={(d) => setField(k, { spec: { ...v, description: d || undefined } })} />
              </li>
            ))}
          </ul>
          <div className="actions">
            <button className="link small" onClick={() => { let n = 'field'; for (let i = 2; props[n]; i++) n = `field${i}`; save({ ...contract, type: 'object', properties: { ...props, [n]: { type: 'string' } } }); }}>+ field</button>
            <button className="link small" onClick={() => setJson(true)}>Edit as JSON</button>
          </div>
        </>
      )}
    </Section>
  );
}
