// Build-mode edits (D41). Each one changes files in a draft; the Floor redraws from the draft.
// A piece without `needs` implicitly needs the piece before it in the list, so before an edit
// would change who comes before a piece, that piece's needs are written out explicitly.
import path from 'node:path';
import { isMap, isSeq, type Document, type YAMLMap, type YAMLSeq } from 'yaml';
import type { BuildOp, GateSpec, MachineConf, ManagerConf } from '../../shared/build';
import type { FactoryDef, LineDef, Need, Policy } from '../../shared/types';
import { Draft, idOf, needsNode, nodeLike, seqOf } from './draft';

const fail = (msg: string): never => { throw new Error(msg); };
// ids become folder names, so they are checked before any path is built from them
const ID = /^[a-z0-9][a-z0-9-]*$/;
const checkId = (id: string, what: string) => { if (!ID.test(id)) fail(`${what} "${id}" must use lowercase letters, digits and dashes.`); };

function findLine(f: FactoryDef, lineId: string): LineDef {
  for (const s of f.sectors) for (const l of s.lines) if (l.id === lineId) return l;
  return fail(`Line ${lineId} not found.`);
}
const sectorDir = (d: Draft, sectorId: string) => { checkId(sectorId, 'A sector id'); return d.abs(path.join('sectors', sectorId)); };
const lineFile = (l: LineDef) => path.join(l.model.dir, 'line.yaml');

/** Whether a piece (or the pallet) lists its needs; reading it never adds a missing pallet. */
function hasNeeds(doc: Document, id: string) {
  if (id === '@pallet') { const p = doc.get('pallet', true); return isMap(p) && p.has('needs'); }
  const node = seqOf(doc, 'pieces').items.find((x) => idOf(x) === id);
  return isMap(node) && node.has('needs');
}

/** The YAML node holding a piece's needs: the piece mapping, or the pallet mapping. */
function holder(doc: Document, id: string): YAMLMap {
  if (id === '@pallet') {
    let p = doc.get('pallet', true);
    if (!isMap(p)) { doc.set('pallet', doc.createNode({})); p = doc.get('pallet', true); }
    return p as YAMLMap;
  }
  const node = seqOf(doc, 'pieces').items.find((x) => idOf(x) === id);
  return isMap(node) ? node : fail(`Piece "${id}" not found.`);
}

const needsOf = (l: LineDef, id: string): Need[] => (l.model.pieces.find((p) => p.id === id)?.needs ?? []).map((n) => ({ ...n }));
/** Rewrites a piece's needs, keeping a block list a block list. */
function setNeeds(doc: Document, id: string, needs: Need[]) {
  const h = holder(doc, id);
  const old = h.get('needs', true);
  const node = needsNode(doc, needs);
  if (isSeq(old) && !old.flow && needs.length) node.flow = false;
  h.set('needs', node);
}
/** Writes a piece's implicit need on the piece before it as an explicit list. */
const materialize = (doc: Document, l: LineDef, id: string) => { if (!hasNeeds(doc, id)) setNeeds(doc, id, needsOf(l, id)); };

/** Folders a machine name resolves from for this line: the model's, the sector's, then shared. */
const machineDirs = (d: Draft, l: LineDef) => [path.join(l.model.dir, 'machines'), path.join(d.root, 'sectors', l.sectorId, 'machines'), path.join(d.root, 'shared', 'machines')];
/** A new machine must not replace or shadow a machine of the same name. */
const machineTaken = (d: Draft, l: LineDef, id: string) => !!l.model.machines[id] || machineDirs(d, l).some((m) => d.exists(path.join(m, id)));

function uniqueId(l: LineDef, d: Draft, base: string) {
  const taken = (id: string) => l.model.pieces.some((p) => p.id === id) || machineTaken(d, l, id);
  if (!taken(base)) return base;
  for (let i = 2; ; i++) if (!taken(`${base}-${i}`)) return `${base}-${i}`;
}

/** Pieces upstream of `id` on forward belts. */
function ancestors(l: LineDef, id: string) {
  const out = new Set<string>(); const stack = [id];
  while (stack.length) for (const n of needsOf(l, stack.pop()!)) if (!n.back && !out.has(n.from)) { out.add(n.from); stack.push(n.from); }
  return out;
}

const NEW_CONTRACT = JSON.stringify({ type: 'object', required: ['summary'], properties: { summary: { type: 'string', description: 'What this step found or did, in a paragraph a person can act on' } } }, null, 2) + '\n';

function pieceValue(kind: 'machine' | 'signal' | 'gate', id: string, label?: string): Record<string, unknown> {
  const base: Record<string, unknown> = { id, ...(label ? { label } : {}) };
  if (kind === 'machine') return { ...base, machine: id };
  if (kind === 'signal') return { ...base, signal: { run: 'true' } };
  return { ...base, gate: { confirmations: 1 } };
}

function insert(d: Draft, l: LineDef, op: Extract<BuildOp, { op: 'insert' }>) {
  const { from, to } = op.at;
  if (from === '@pallet') fail('Nothing comes after the pallet.');
  if (!l.model.pieces.some((p) => p.id === from)) fail(`Piece "${from}" not found.`);
  if (to && !needsOf(l, to).some((n) => n.from === from && !n.back)) fail(`There is no belt from "${from}" to "${to}".`);
  const id = op.id ?? uniqueId(l, d, op.kind);
  checkId(id, 'A piece id');
  if (l.model.pieces.some((p) => p.id === id)) fail(`The line already has a piece "${id}".`);
  if (op.kind === 'machine' && machineTaken(d, l, id)) fail(`A machine named "${id}" already exists for this line; choose another id.`);
  d.editYaml(lineFile(l), (doc) => {
    const seq = seqOf(doc, 'pieces');
    const node = nodeLike(doc, seq, pieceValue(op.kind, id, op.label));
    const indexOf = (pid: string) => seq.items.findIndex((x) => idOf(x) === pid);
    if (to) {
      const implicit = !hasNeeds(doc, to);
      const at = to === '@pallet' ? seq.items.length : indexOf(to);
      seq.items.splice(at, 0, node);
      if (!implicit) {
        // the belt's rule moves onto the belt into the new piece
        const old = needsOf(l, to).find((n) => n.from === from && !n.back)!;
        node.set('needs', needsNode(doc, [{ from, when: old.when }]));
        setNeeds(doc, to, needsOf(l, to).map((n) => (n.from === from && !n.back ? { from: id } : n)));
      }
    } else {
      // a new path out of `from`: the piece after `from` keeps its own input
      const at = from === '@intake' ? 0 : indexOf(from) + 1;
      const next = idOf(seq.items[at]) || '@pallet';
      materialize(doc, l, next);
      seq.items.splice(at, 0, node);
    }
  });
  if (op.kind === 'machine') {
    const dir = path.join(l.model.dir, 'machines', id);
    d.write(path.join(dir, 'role.md'), `## This step\n\nDescribe what this machine does, what it writes in its folder, and what it returns.\n`);
    d.write(path.join(dir, 'contract.json'), NEW_CONTRACT);
    d.write(path.join(dir, 'machine.yaml'), 'agent: claude\nmodel: sonnet\nattempts: 2\ntimeout: 20m\n');
  }
}

function remove(d: Draft, l: LineDef, pieceId: string) {
  if (pieceId.startsWith('@')) fail('The intake and the pallet stay; remove the line instead.');
  const piece = l.model.pieces.find((p) => p.id === pieceId) ?? fail(`Piece "${pieceId}" not found.`);
  d.editYaml(lineFile(l), (doc) => {
    const seq = seqOf(doc, 'pieces');
    // every piece fed by it loses that belt; written out, so the piece after it does not
    // silently take the removed piece's own input instead
    for (const p of l.model.pieces) if (p.id !== pieceId && p.needs.some((n) => n.from === pieceId)) setNeeds(doc, p.id, needsOf(l, p.id).filter((n) => n.from !== pieceId));
    seq.items.splice(seq.items.findIndex((x) => idOf(x) === pieceId), 1);
  });
  if (piece.machine && !l.model.pieces.some((p) => p.id !== pieceId && p.machine === piece.machine)) {
    const own = path.join(l.model.dir, 'machines', piece.machine);
    if (d.exists(own)) d.remove(own);
  }
}

function connect(d: Draft, l: LineDef, op: Extract<BuildOp, { op: 'connect' }>) {
  const { from, to } = op;
  if (from === '@pallet') fail('Nothing comes after the pallet.');
  if (to === '@intake') fail('Nothing goes into the intake.');
  for (const id of [from, to]) if (!l.model.pieces.some((p) => p.id === id)) fail(`Piece "${id}" not found.`);
  const back = from === to || ancestors(l, from).has(to);
  if (needsOf(l, to).some((n) => n.from === from && !!n.back === back)) fail('These pieces are already connected.');
  d.editYaml(lineFile(l), (doc) => setNeeds(doc, to, [...needsOf(l, to), { from, when: op.when, ...(back ? { back: true, laps: op.laps ?? 3 } : {}) }]));
}

function disconnect(d: Draft, l: LineDef, op: Extract<BuildOp, { op: 'disconnect' }>) {
  const needs = needsOf(l, op.to);
  if (!needs.some((n) => n.from === op.from && !!n.back === !!op.back)) fail('These pieces are not connected.');
  d.editYaml(lineFile(l), (doc) => setNeeds(doc, op.to, needs.filter((n) => !(n.from === op.from && !!n.back === !!op.back))));
}

function setRule(d: Draft, l: LineDef, op: Extract<BuildOp, { op: 'setRule' }>) {
  const needs = needsOf(l, op.to);
  const n = needs.find((x) => x.from === op.from && !!x.back === !!op.back) ?? fail('These pieces are not connected.');
  if (op.when !== undefined) { if (op.when === null || !op.when.trim()) { if (n.back) fail('A return belt needs a rule.'); delete n.when; } else n.when = op.when.trim(); }
  if (op.laps !== undefined && n.back) n.laps = Math.max(1, Math.round(op.laps));
  d.editYaml(lineFile(l), (doc) => setNeeds(doc, op.to, needs));
}

function gateValue(g: GateSpec): Record<string, unknown> {
  if (g.kind === 'rule') return { rule: g.rule };
  if (g.kind === 'choices') return { choices: g.choices, ...(g.confirmations && g.confirmations > 1 ? { confirmations: g.confirmations } : {}) };
  return { confirmations: Math.max(1, g.confirmations) };
}

/** A map or list node; it keeps the style of the node it replaces, and is compact when new. */
function flowNode(doc: Document, v: unknown, old?: unknown) {
  const n = doc.createNode(v) as YAMLMap | YAMLSeq;
  n.flow = old !== undefined && (isMap(old) || isSeq(old)) ? !!old.flow : true;
  return n;
}

function setPiece(d: Draft, l: LineDef, op: Extract<BuildOp, { op: 'setPiece' }>) {
  const p = l.model.pieces.find((x) => x.id === op.pieceId) ?? fail(`Piece "${op.pieceId}" not found.`);
  if (op.gate && p.kind !== 'gate') fail(`"${p.label}" is not a gate.`);
  if ((op.run !== undefined || op.timeout !== undefined) && p.kind !== 'signal') fail(`"${p.label}" is not a signal.`);
  if (op.timeout?.trim() && !/^\d+(\.\d+)?\s*(ms|s|m|h)?$/.test(op.timeout.trim())) fail(`"${op.timeout}" is not a duration like 90s, 40m or 2h.`);
  d.editYaml(lineFile(l), (doc) => {
    const node = holder(doc, op.pieceId);
    if (op.label !== undefined) { if (op.label.trim()) node.set('label', op.label.trim()); else node.delete('label'); }
    if (op.goal !== undefined) { if (op.goal.trim()) node.set('goal', op.goal.trim()); else node.delete('goal'); }
    if (op.gate) node.set('gate', flowNode(doc, gateValue(op.gate), node.get('gate', true)));
    if (op.run !== undefined || op.timeout !== undefined) {
      // edit the keys in place, so the untouched one keeps how it is written
      const old: unknown = node.get('signal', true);
      const m = isMap(old) ? old : flowNode(doc, { run: p.run ?? '' }, old) as YAMLMap;
      if (!isMap(old)) node.set('signal', m);
      if (op.run !== undefined) m.set('run', op.run);
      if (op.timeout !== undefined) { if (op.timeout.trim()) m.set('timeout', op.timeout.trim()); else m.delete('timeout'); }
    }
  });
}

function setMap(doc: Document, node: YAMLMap, values: Record<string, unknown>) {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    if (v === null || (typeof v === 'string' && !v.trim())) node.delete(k);
    else node.set(k, Array.isArray(v) || (typeof v === 'object' && v !== null) ? flowNode(doc, v, node.get(k, true)) : v);
  }
}

function setMachine(d: Draft, l: LineDef, op: Extract<BuildOp, { op: 'setMachine' }>) {
  const p = l.model.pieces.find((x) => x.id === op.pieceId);
  const m = p?.machine ? l.model.machines[p.machine] : undefined;
  if (!m) fail(`"${op.pieceId}" is not a machine.`);
  const conf: MachineConf = op.conf;
  d.editYaml(path.join(m!.dir, 'machine.yaml'), (doc) => setMap(doc, doc.contents as YAMLMap, { ...conf }));
}

function managerValues(m: ManagerConf) { return { agent: m.agent, model: m.model, tools: m.tools }; }
const policyValue = (p: Policy) => Object.fromEntries(Object.entries(p).filter(([, r]) => (r?.auto ?? 0) > 0).map(([k, r]) => [k, { auto: r!.auto }]));

function lineNode(doc: Document, lineId: string) {
  const short = lineId.split('/').slice(1).join('/');
  const node = seqOf(doc, 'lines').items.find((x) => idOf(x) === short);
  return isMap(node) ? node : fail(`Line ${lineId} not found.`);
}

/** A sector's own model takes over a shared model of the same name for every line in the sector. */
function modelNameFree(d: Draft, f: FactoryDef, sectorId: string, name: string) {
  if (d.exists(d.abs(path.join('shared', 'models', name)))) fail(`"${name}" is the name of a shared model; a sector model with that name would replace it for every line in this sector. Choose another name.`);
  const users = f.sectors.find((s) => s.id === sectorId)?.lines.filter((l) => l.model.name === name) ?? [];
  if (users.length) fail(`"${name}" is already the model of ${users.map((l) => l.name).join(', ')}. Choose another name.`);
}

export function apply(d: Draft, op: BuildOp) {
  if (op.op === 'batch') { for (const o of op.ops) apply(d, o); return; }
  const f = d.load();
  switch (op.op) {
    case 'newSector': {
      checkId(op.id, 'A sector id');
      const dir = sectorDir(d, op.id);
      if (d.exists(dir)) fail(`Sector "${op.id}" already exists.`);
      d.editYaml(path.join(dir, 'sector.yaml'), (doc) => setMap(doc, doc.contents as YAMLMap, { name: op.name, color: op.color, manager: { agent: 'claude', model: 'sonnet' } }));
      d.write(path.join(dir, 'lines.yaml'), 'lines: []\n');
      d.write(path.join(dir, 'manager', 'role.md'), `You are the ${op.name} Sector Manager. You know its lines, read their runs and evidence, and propose the next action.\n`);
      return;
    }
    case 'newLine': {
      checkId(op.id, 'A line id');
      const sdir = sectorDir(d, op.sectorId);
      if (!f.sectors.some((s) => s.id === op.sectorId)) fail(`Sector "${op.sectorId}" not found.`);
      if (f.sectors.find((s) => s.id === op.sectorId)!.lines.some((l) => l.id === `${op.sectorId}/${op.id}`)) fail(`The sector already has a line "${op.id}".`);
      if (op.newModel) {
        checkId(op.model, 'A model name');
        const mdir = path.join(sdir, 'models', op.model);
        if (d.exists(mdir)) fail(`Model "${op.model}" already exists.`);
        modelNameFree(d, f, op.sectorId, op.model);
        d.write(path.join(mdir, 'line.yaml'), 'intake:\n  kind: manual\n  label: Start\n  inputs: []\npieces: []\npallet:\n  label: Delivered\n');
      } else {
        checkId(op.model, 'A model name');
        if (!d.exists(path.join(sdir, 'models', op.model, 'line.yaml')) && !d.exists(d.abs(path.join('shared', 'models', op.model, 'line.yaml')))) fail(`Model "${op.model}" not found.`);
      }
      d.editYaml(path.join(sdir, 'lines.yaml'), (doc) => {
        const seq = seqOf(doc, 'lines');
        seq.items.push(nodeLike(doc, seq, { id: op.id, name: op.name, model: op.model, ...(op.direction === 'left' ? { direction: 'left' } : {}), ...(op.params && Object.keys(op.params).length ? { params: op.params } : {}) }));
      });
      return;
    }
    case 'separateModel': {
      const l = findLine(f, op.lineId);
      checkId(op.model, 'A model name');
      const to = path.join(sectorDir(d, l.sectorId), 'models', op.model);
      if (d.exists(to)) fail(`Model "${op.model}" already exists.`);
      modelNameFree(d, f, l.sectorId, op.model);
      d.copyDir(l.model.dir, to);
      d.editYaml(path.join(sectorDir(d, l.sectorId), 'lines.yaml'), (doc) => lineNode(doc, l.id).set('model', op.model));
      return;
    }
    case 'insert': return insert(d, findLine(f, op.lineId), op);
    case 'remove': return remove(d, findLine(f, op.lineId), op.pieceId);
    case 'connect': return connect(d, findLine(f, op.lineId), op);
    case 'disconnect': return disconnect(d, findLine(f, op.lineId), op);
    case 'setRule': return setRule(d, findLine(f, op.lineId), op);
    case 'setPiece': return setPiece(d, findLine(f, op.lineId), op);
    case 'setMachine': return setMachine(d, findLine(f, op.lineId), op);
    case 'setIntake': {
      const l = findLine(f, op.lineId);
      d.editYaml(lineFile(l), (doc) => {
        let intake = doc.get('intake', true);
        if (!isMap(intake)) { doc.set('intake', doc.createNode({ kind: 'manual' })); intake = doc.get('intake', true); }
        const node = intake as YAMLMap;
        if (op.label !== undefined) { if (op.label.trim()) node.set('label', op.label.trim()); else node.delete('label'); }
        if (op.inputs) {
          const seq = doc.createNode(op.inputs.map((i) => ({ name: i.name, ...(i.label ? { label: i.label } : {}), ...(i.required ? { required: true } : {}), ...(i.placeholder ? { placeholder: i.placeholder } : {}), ...(i.multiline ? { multiline: true } : {}) }))) as YAMLSeq;
          for (const it of seq.items) if (isMap(it)) it.flow = true;
          node.set('inputs', seq);
        }
      });
      return;
    }
    case 'writeFile': d.write(d.abs(op.path), op.content, !!op.executable); return;
    case 'setLine': {
      const l = findLine(f, op.lineId);
      d.editYaml(path.join(sectorDir(d, l.sectorId), 'lines.yaml'), (doc) => {
        const node = lineNode(doc, l.id);
        setMap(doc, node, { name: op.name, params: op.params && !Object.keys(op.params).length ? null : op.params, repo: op.repo });
        if (op.direction) { if (op.direction === 'left') node.set('direction', 'left'); else node.delete('direction'); }
      });
      return;
    }
    case 'setSector': {
      if (!f.sectors.some((s) => s.id === op.sectorId)) fail(`Sector "${op.sectorId}" not found.`);
      d.editYaml(path.join(sectorDir(d, op.sectorId), 'sector.yaml'), (doc) => {
        const root = doc.contents as YAMLMap;
        setMap(doc, root, { name: op.name, color: op.color });
        if (op.policy) root.set('policy', flowNode(doc, policyValue(op.policy), root.get('policy', true)));
        if (op.manager) { let m = root.get('manager', true); if (!isMap(m)) { root.set('manager', doc.createNode({})); m = root.get('manager', true); } setMap(doc, m as unknown as YAMLMap, managerValues(op.manager)); }
      });
      return;
    }
    case 'setFactory': {
      d.editYaml(d.abs('factory.yaml'), (doc) => {
        const root = doc.contents as YAMLMap;
        setMap(doc, root, { name: op.name });
        // on is the default, so only "off" is written
        if (op.lineContext !== undefined) { if (op.lineContext) root.delete('line_context'); else root.set('line_context', false); }
        if (op.ceiling) root.set('ceiling', flowNode(doc, policyValue(op.ceiling), root.get('ceiling', true)));
        if (op.generalManager) { let m = root.get('general_manager', true); if (!isMap(m)) { root.set('general_manager', doc.createNode({})); m = root.get('general_manager', true); } setMap(doc, m as unknown as YAMLMap, managerValues(op.generalManager)); }
      });
      return;
    }
    case 'removeLine': {
      const l = findLine(f, op.lineId);
      d.editYaml(path.join(sectorDir(d, l.sectorId), 'lines.yaml'), (doc) => {
        const seq = seqOf(doc, 'lines');
        seq.items.splice(seq.items.indexOf(lineNode(doc, l.id)), 1);
      });
      return;
    }
    case 'removeModel': {
      checkId(op.model, 'A model name');
      const dir = path.join(sectorDir(d, op.sectorId), 'models', op.model);
      if (!d.exists(dir)) fail(`Model "${op.model}" not found.`);
      const users = f.sectors.flatMap((s) => s.lines).filter((l) => l.model.dir === dir);
      if (users.length) fail(`Model "${op.model}" is still used by ${users.map((l) => l.name).join(', ')}.`);
      d.remove(dir);
      return;
    }
    case 'removeSector': {
      const dir = sectorDir(d, op.sectorId);
      if (!d.exists(dir)) fail(`Sector "${op.sectorId}" not found.`);
      d.remove(dir);
      return;
    }
  }
}
