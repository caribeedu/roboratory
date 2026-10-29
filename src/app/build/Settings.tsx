// Build mode's settings above pieces (D41): a line, its sector, the factory, and new lines and sectors.
import { useContext, useEffect, useState } from 'react';
import YAML from 'yaml';
import type { BuildView, ManagerConf } from '../../shared/build';
import { AGENTS, type Policy, type Snapshot, type VerbName } from '../../shared/types';
import { Head, Section } from '../panels/Inspector';
import { api } from '../store';
import { Commit, ListField, Row, slug, useDraftFile, useRefusal } from './forms';
import { modelDir, type Op } from './PieceEditor';
import { RehearsalCtx } from './Rehearsal';

type Factory = NonNullable<Snapshot['factory']>;
type Line = Factory['sectors'][number]['lines'][number];

export type SettingsPanel = { kind: 'line'; lineId: string } | { kind: 'sector' } | { kind: 'factory' } | { kind: 'newLine' } | { kind: 'newSector' };

const COLORS = ['#5b8fd3', '#e0703f', '#8bc96b', '#c58be0', '#e9c46a', '#4ab0a0', '#d4566b'];
/** Verbs a manager may be allowed to run alone; release and apply never are (D34). */
const AUTO_VERBS: VerbName[] = ['run', 'retry', 'halt', 'resume'];

export function Settings({ panel, view, sectorId, op, onClose, onCreateSector }: {
  panel: SettingsPanel; view: BuildView; sectorId: string; op: Op; onClose: () => void;
  onCreateSector: (id: string, name: string, color: string) => void;
}) {
  const sector = view.factory.sectors.find((s) => s.id === sectorId);
  const title = { line: 'Line settings', sector: 'Sector settings', factory: 'Factory settings', newLine: 'New line', newSector: 'New sector' }[panel.kind];
  return (
    <aside className="inspector frame build-insp" aria-label={title}>
      <Head title={title} sub={panel.kind === 'factory' || panel.kind === 'newSector' ? view.factory.name : sector?.name ?? ''} onClose={onClose} />
      <div className="insp-body">
        {panel.kind === 'line' && <LineSettings view={view} line={sector?.lines.find((l) => l.id === panel.lineId)} op={op} onClose={onClose} />}
        {panel.kind === 'sector' && sector && <SectorSettings view={view} sector={sector} op={op} />}
        {panel.kind === 'factory' && <FactorySettings view={view} op={op} />}
        {panel.kind === 'newLine' && <NewLine view={view} sectorId={sectorId} op={op} onClose={onClose} />}
        {panel.kind === 'newSector' && <NewSector view={view} onCreate={onCreateSector} />}
      </div>
    </aside>
  );
}

function LineSettings({ view, line, op, onClose }: { view: BuildView; line?: Line; op: Op; onClose: () => void }) {
  if (!line) return <p className="muted">This line is not in the draft any more.</p>;
  const params = Object.entries(line.params);
  const [paramError, setParamError] = useState('');
  const [fresh, refuse] = useRefusal();
  const setParams = (p: [string, string][]) => {
    const names = p.map(([k]) => k.trim());
    if (names.some((k) => !k)) { setParamError('A parameter needs a name; remove it with ✕ instead.'); refuse(); return; }
    if (new Set(names).size !== names.length) { setParamError('Two parameters cannot share a name.'); refuse(); return; }
    setParamError('');
    void op({ op: 'setLine', lineId: line.id, params: Object.fromEntries(p) });
  };
  const modelRaw = useDraftFile(`${modelDir(line)}/line.yaml`, view);
  let modelConf: Record<string, unknown> = {};
  try { modelConf = YAML.parse(modelRaw ?? '') ?? {}; } catch { /* shown by the checks */ }
  const rehearsal = useContext(RehearsalCtx);
  const found = rehearsal.state?.lineId === line.id ? rehearsal.state.report.findings.length : 0;
  const copies = view.factory.sectors.flatMap((s) => s.lines).filter((l) => l.model === line.model && l.sharedModel === line.sharedModel);
  return (
    <>
      <Row label="Name"><Commit label="Line name" value={line.name} onCommit={(v) => void op({ op: 'setLine', lineId: line.id, name: v })} /></Row>
      <Row label="Grows to the">
        <select aria-label="Direction" value={line.direction} onChange={(e) => void op({ op: 'setLine', lineId: line.id, direction: e.target.value as 'left' | 'right' })}>
          <option value="right">right</option><option value="left">left</option>
        </select>
      </Row>
      <Row label="Target repository" hint="Machines get chained worktrees of it. Leave empty for lines that pick repositories themselves.">
        <Commit label="Target repository" value={line.repo ?? ''} placeholder="~/repos/my-service" onCommit={(v) => void op({ op: 'setLine', lineId: line.id, repo: v || null })} />
      </Row>
      <Row label="Rehearsal" hint="Runs this line once on a copy of the draft, with nobody to answer, and lists what it finds.">
        <button className="btn" onClick={() => rehearsal.open(line.id)}>Rehearse{found ? ` (${found})` : ''}</button>
      </Row>
      <Row label="Model" hint={copies.length > 1 ? `Shared with ${copies.filter((c) => c.id !== line.id).map((c) => c.name).join(', ')}. Select a piece to separate it.` : undefined}><code>{modelDir(line)}</code></Row>
      <Row label="Never allowed" hint="Commands no machine of this line's model may run, added to the sector's and the factory's."><ListField label="Line never allowed" value={listOf(modelConf.deny)} onCommit={(deny) => void op({ op: 'setModel', lineId: line.id, deny })} /></Row>
      {fresh(<Section title="Parameters">
        <ul className="b-list">
          {params.map(([k, v], i) => (
            <li key={i} className="b-grid2">
              <Commit label="Name" value={k} onCommit={(nk) => setParams(params.map((p, j) => (j === i ? [nk, p[1]] : p)))} />
              <span className="b-inline"><Commit label="Value" value={v} onCommit={(nv) => setParams(params.map((p, j) => (j === i ? [p[0], nv] : p)))} /><button className="icon" aria-label={`Remove ${k}`} onClick={() => setParams(params.filter((_, j) => j !== i))}>✕</button></span>
            </li>
          ))}
        </ul>
        {paramError && <p className="err small">{paramError}</p>}
        <button className="link small" onClick={() => { let n = params.length + 1; while (line.params[`param${n}`] !== undefined) n++; setParams([...params, [`param${n}`, '']]); }}>+ parameter</button>
      </Section>)}
      <div className="danger-zone">
        <button className="btn ghost" onClick={() => void op({ op: 'removeLine', lineId: line.id }).then((ok) => ok && onClose())}>Remove this line</button>
        <p className="muted small">The model stays; remove it from the sector settings once no line uses it.</p>
      </div>
    </>
  );
}

function ManagerForm({ value, onCommit }: { value: Record<string, unknown>; onCommit: (m: ManagerConf) => void }) {
  return (
    <>
      <Row label="Agent"><select aria-label="Manager agent" value={String(value.agent ?? 'claude')} onChange={(e) => onCommit({ agent: e.target.value })}>{AGENTS.map((a) => <option key={a}>{a}</option>)}</select></Row>
      <Row label="Model"><Commit label="Manager model" value={String(value.model ?? '')} placeholder="sonnet" onCommit={(v) => onCommit({ model: v || null })} /></Row>
      <Row label="Tools" hint="Read tools only: managers propose, you decide."><ListField label="Manager tools" value={Array.isArray(value.tools) ? value.tools.map(String) : []} onCommit={(tools) => onCommit({ tools })} /></Row>
    </>
  );
}

function PolicyForm({ value, ceiling, onCommit }: { value: Policy; ceiling?: Policy; onCommit: (p: Policy) => void }) {
  return (
    <>
      <p className="b-hint">How many times a manager may run each verb on its own{ceiling ? ', up to the factory ceiling' : ''}. Releasing gates and applying changes are always yours.</p>
      <ul className="b-list">
        {AUTO_VERBS.map((v) => (
          <li key={v} className="b-grid2">
            <span>{v}{ceiling ? <span className="muted small"> (ceiling {ceiling[v]?.auto ?? 0})</span> : null}</span>
            <Commit type="number" label={`${v} on its own`} value={String(value[v]?.auto ?? 0)} onCommit={(n) => onCommit({ ...value, [v]: { auto: Math.max(0, Number(n) || 0) } })} />
          </li>
        ))}
      </ul>
    </>
  );
}

function SectorSettings({ view, sector, op }: { view: BuildView; sector: Factory['sectors'][number]; op: Op }) {
  const raw = useDraftFile(`sectors/${sector.id}/sector.yaml`, view);
  const culture = useDraftFile(`sectors/${sector.id}/culture.md`, view);
  const factoryRaw = useDraftFile('factory.yaml', view);
  const [models, setModels] = useState<string[]>([]);
  useEffect(() => { void api().buildList(`sectors/${sector.id}/models`).then(setModels); }, [view, sector.id]);
  let conf: Record<string, unknown> = {}, fconf: Record<string, unknown> = {};
  try { conf = YAML.parse(raw ?? '') ?? {}; fconf = YAML.parse(factoryRaw ?? '') ?? {}; } catch { /* shown by the checks */ }
  const used = new Set(sector.lines.filter((l) => !l.sharedModel).map((l) => l.model));
  return (
    <>
      <Row label="Name"><Commit label="Sector name" value={sector.name} onCommit={(v) => void op({ op: 'setSector', sectorId: sector.id, name: v })} /></Row>
      <Row label="Color">
        <span className="swatches">{COLORS.map((c) => <button key={c} className={`swatch-btn${c === sector.color ? ' on' : ''}`} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => void op({ op: 'setSector', sectorId: sector.id, color: c })} />)}</span>
      </Row>
      <Row label="Never allowed" hint="Commands no machine of this sector may run, added to the factory's."><ListField label="Sector never allowed" value={listOf(conf.deny)} onCommit={(deny) => void op({ op: 'setSector', sectorId: sector.id, deny })} /></Row>
      <Section title="Sector Manager"><ManagerForm value={(conf.manager as Record<string, unknown>) ?? {}} onCommit={(m) => void op({ op: 'setSector', sectorId: sector.id, manager: m })} /></Section>
      <Section title="Policy" collapsed><PolicyForm value={sector.policy} ceiling={parsePolicy(fconf.ceiling)} onCommit={(policy) => void op({ op: 'setSector', sectorId: sector.id, policy })} /></Section>
      <Section title="Culture" collapsed>
        <p className="b-hint">Added to the role of every machine and the manager in this sector, after the factory's culture.</p>
        {culture !== undefined && <Commit multiline mono rows={10} label="Sector culture" value={culture ?? ''} onCommit={(v) => void op({ op: 'writeFile', path: `sectors/${sector.id}/culture.md`, content: v })} />}
      </Section>
      <Section title="Models" collapsed>
        <ul className="b-list">{models.map((m) => (
          <li key={m} className="belt-row"><code>{m}</code>{used.has(m) ? <span className="muted small">in use</span> : <button className="link small" onClick={() => void op({ op: 'removeModel', sectorId: sector.id, model: m })}>Remove</button>}</li>
        ))}</ul>
      </Section>
      <div className="danger-zone">
        <button className="btn ghost" onClick={() => void op({ op: 'removeSector', sectorId: sector.id })}>Remove this sector</button>
        <p className="muted small">Deletes the sector's folder with all its lines and models when you save.</p>
      </div>
    </>
  );
}

const listOf = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

function parsePolicy(v: unknown): Policy {
  const out: Policy = {};
  if (v && typeof v === 'object') for (const [k, r] of Object.entries(v as Record<string, unknown>)) out[k as VerbName] = { auto: Number((r as { auto?: number })?.auto ?? r) || 0 };
  return out;
}

function FactorySettings({ view, op }: { view: BuildView; op: Op }) {
  const raw = useDraftFile('factory.yaml', view);
  const culture = useDraftFile('culture.md', view);
  let conf: Record<string, unknown> = {};
  try { conf = YAML.parse(raw ?? '') ?? {}; } catch { /* shown by the checks */ }
  return (
    <>
      <Row label="Name"><Commit label="Factory name" value={view.factory.name} onCommit={(v) => void op({ op: 'setFactory', name: v })} /></Row>
      <Row label="Line context" hint="Machines are told their place in the line: the line in order, their goal, where their box comes from and goes, and what comes after them, with each piece's goal. Goals are sent to the model, which can cost a little more.">
        <label className="chk"><input type="checkbox" checked={view.factory.lineContext} onChange={(e) => void op({ op: 'setFactory', lineContext: e.target.checked })} /> on for every machine</label>
      </Row>
      <Row label="Never allowed" hint="Commands no machine may run. A sector, a line and a machine can add to this list, never remove from it."><ListField label="Factory never allowed" value={listOf(conf.deny)} onCommit={(deny) => void op({ op: 'setFactory', deny })} /></Row>
      <Section title="General Manager"><ManagerForm value={(conf.general_manager as Record<string, unknown>) ?? {}} onCommit={(m) => void op({ op: 'setFactory', generalManager: m })} /></Section>
      <Section title="Ceiling" collapsed><PolicyForm value={parsePolicy(conf.ceiling)} onCommit={(ceiling) => void op({ op: 'setFactory', ceiling })} /></Section>
      <Section title="Culture" collapsed>
        <p className="b-hint">Added to the role of every machine and manager in the factory.</p>
        {culture !== undefined && <Commit multiline mono rows={14} label="Factory culture" value={culture ?? ''} onCommit={(v) => void op({ op: 'writeFile', path: 'culture.md', content: v })} />}
      </Section>
    </>
  );
}

function NewLine({ view, sectorId, op, onClose }: { view: BuildView; sectorId: string; op: Op; onClose: () => void }) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'copy' | 'new'>('copy');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    void Promise.all([api().buildList(`sectors/${sectorId}/models`), api().buildList('shared/models')]).then(([own, shared]) => {
      const list = [...own.map((m) => ({ value: m, label: m })), ...shared.filter((m) => !own.includes(m)).map((m) => ({ value: m, label: `${m} (shared)` }))];
      setModels(list); if (list[0] && !model) setModel(list[0].value);
    });
  }, [view, sectorId]);
  const id = slug(name);
  const newModel = slug(model || name);
  const ready = id && (mode === 'copy' ? model : newModel);
  return (
    <>
      <Row label="Name"><input aria-label="New line name" value={name} placeholder="Orders incidents" onChange={(e) => setName(e.target.value)} /></Row>
      <Row label="Built from">
        <span className="seg-inline">
          <label className="chk"><input type="radio" name="line-from" checked={mode === 'copy'} onChange={() => { setMode('copy'); setModel(models[0]?.value ?? ''); }} disabled={!models.length} /> a copy of a model</label>
          <label className="chk"><input type="radio" name="line-from" checked={mode === 'new'} onChange={() => { setMode('new'); setModel(''); }} /> a new model</label>
        </span>
      </Row>
      {mode === 'copy'
        ? <Row label="Model"><select aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)}>{models.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Row>
        : <Row label="Model name" hint="Starts with just an intake and a pallet; build it with the + slots."><input aria-label="New model name" value={model} placeholder={id || 'my-model'} onChange={(e) => setModel(e.target.value)} /></Row>}
      <div className="actions">
        <button className="btn primary" disabled={!ready} onClick={() => void op({ op: 'newLine', sectorId, id, name: name.trim(), model: mode === 'copy' ? model : newModel, newModel: mode === 'new' }).then((ok) => ok && onClose())}>Add the line</button>
      </div>
    </>
  );
}

function NewSector({ view, onCreate }: { view: BuildView; onCreate: (id: string, name: string, color: string) => void }) {
  const [name, setName] = useState('');
  const taken = new Set(view.factory.sectors.map((s) => s.color));
  const [color, setColor] = useState(COLORS.find((c) => !taken.has(c)) ?? COLORS[0]);
  const id = slug(name);
  return (
    <>
      <p className="b-hint">A sector is saved as soon as you create it, then build mode opens in its empty room.</p>
      <Row label="Name"><input aria-label="New sector name" value={name} placeholder="Operations" onChange={(e) => setName(e.target.value)} /></Row>
      <Row label="Color"><span className="swatches">{COLORS.map((c) => <button key={c} className={`swatch-btn${c === color ? ' on' : ''}`} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => setColor(c)} />)}</span></Row>
      <div className="actions"><button className="btn primary" disabled={!id || view.factory.sectors.some((s) => s.id === id)} onClick={() => onCreate(id, name.trim(), color)}>Create the sector</button></div>
    </>
  );
}
