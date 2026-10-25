// Loads a factory repository from disk into a FactoryDef.
// The repository is the only source of truth; nothing here is cached elsewhere.
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { parseExpr } from '../shared/expr';
import { columnsAndLanes } from '../shared/layout';
import type {
  Direction, FactoryDef, InputField, IntakeKind, LineDef, LineModel, LoadProblem, MachineDef, ManagerDef, Need, PieceDef, Policy, SectorDef,
} from '../shared/types';
import { AGENTS } from '../shared/types';
import { diskFs, type Vfs } from './vfs';
import { expandHome } from './paths';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : v === undefined || v === null ? d : String(v));

/** Where the loader reads from, and whether structural problems are kept (tolerant) or thrown. */
export interface LoadIo { fs: Vfs; problems?: LoadProblem[] }
const disk: LoadIo = { fs: diskFs };

/** Throws, or in a tolerant load records the problem and lets the caller carry on. */
function problem(io: LoadIo, message: string, model?: string, pieceId?: string) {
  if (!io.problems) throw new Error(message);
  io.problems.push({ model, pieceId, message });
}

function readYaml(io: LoadIo, file: string): Obj {
  const parsed = YAML.parse(io.fs.read(file));
  if (parsed === null || parsed === undefined) return {};
  if (!isObj(parsed)) throw new Error(`${file}: expected a mapping at the top level`);
  return parsed;
}
/** A list of strings, as the files write it: a missing key is an empty list, and a lone string is a list of one. */
const strList = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map((x) => str(x).trim()).filter(Boolean);
const readText = (io: LoadIo, file: string, d = '') => (io.fs.exists(file) ? io.fs.read(file) : d);
const titleCase = (id: string) => id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const SECTOR_COLORS = ['#5b8fd3', '#e0703f', '#8bc96b', '#c58be0', '#e9c46a', '#4ab0a0', '#d4566b'];

function parseDuration(v: unknown, d: number): number {
  if (typeof v === 'number') return v * 1000;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/.exec(str(v).trim());
  if (!m) return d;
  const n = Number(m[1]);
  return n * ({ ms: 1, s: 1000, m: 60000, h: 3600000 }[(m[2] || 's') as 'ms' | 's' | 'm' | 'h']);
}

function parsePolicy(v: unknown): Policy {
  if (!isObj(v)) return {};
  const out: Policy = {};
  for (const [verb, rule] of Object.entries(v)) {
    if (!['run', 'retry', 'release', 'halt', 'resume', 'apply'].includes(verb)) continue;
    out[verb as keyof Policy] = { auto: isObj(rule) ? Number(rule.auto ?? 0) : Number(rule) || 0 };
  }
  return out;
}

/** An agent is one the app has an adapter for (D45); anything else is a structural problem, found when the factory loads. */
function agentName(io: LoadIo, v: unknown, fallback: string, whose: string): string {
  const name = str(v, fallback);
  if (!(AGENTS as readonly string[]).includes(name)) problem(io, `${whose}: agent "${name}" is not one of ${AGENTS.join(', ')}`);
  return name;
}

function parseManager(io: LoadIo, v: unknown, roleFile: string, fallbackAgent: string): ManagerDef {
  const o = isObj(v) ? v : {};
  return {
    agent: agentName(io, o.agent, fallbackAgent, roleFile),
    model: o.model ? str(o.model) : undefined,
    role: readText(io, roleFile, ''),
    tools: Array.isArray(o.tools) ? o.tools.map((t) => str(t)) : [],
  };
}

function parseNeeds(io: LoadIo, v: unknown, fallback: string | undefined, model?: string, pieceId?: string): Need[] {
  if (v === undefined) return fallback ? [{ from: fallback }] : [];
  const list = Array.isArray(v) ? v : [v];
  return list.map((n) => {
    if (typeof n === 'string') return { from: n };
    if (isObj(n)) {
      const need: Need = { from: str(n.from) };
      if (n.when !== undefined) {
        need.when = str(n.when);
        try { parseExpr(need.when); } catch (e) { problem(io, `the rule "${need.when}" from "${need.from}" is not valid: ${(e as Error).message}`, model, pieceId); }
      }
      if (n.back) {
        need.back = true;
        need.laps = Math.max(1, Number(n.laps ?? 3));
        if (!need.when) problem(io, `the return belt from "${need.from}" needs a "when" rule`, model, pieceId);
      }
      return need;
    }
    throw new Error(`needs: expected a piece id or { from, when }`);
  });
}

function loadMachine(io: LoadIo, name: string, dirs: { dir: string; shared: boolean }[], root: string): MachineDef {
  for (const { dir, shared } of dirs) {
    const mdir = path.join(dir, name);
    if (!io.fs.exists(mdir)) continue;
    const conf = io.fs.exists(path.join(mdir, 'machine.yaml')) ? readYaml(io, path.join(mdir, 'machine.yaml')) : {};
    const contractFile = path.join(mdir, 'contract.json');
    let contract: Obj = { type: 'object' };
    if (io.fs.exists(contractFile)) {
      try { contract = JSON.parse(io.fs.read(contractFile)); } catch (e) { throw new Error(`${contractFile}: ${(e as Error).message}`); }
    }
    return {
      name, dir: mdir, shared,
      // shared role files (relative to the factory root) come first, then the machine's own role.md
      role: [...(Array.isArray(conf.roles) ? conf.roles.map((r) => {
        const f = path.resolve(root, str(r));
        if (!io.fs.exists(f)) throw new Error(`${path.join(mdir, 'machine.yaml')}: role file ${str(r)} not found`);
        return readText(io, f);
      }) : []), readText(io, path.join(mdir, 'role.md'))].filter((x) => x.trim()).join('\n\n'),
      dirs: Array.isArray(conf.dirs) ? conf.dirs.map((d) => expandHome(str(d), os.homedir())) : [],
      effort: conf.effort ? str(conf.effort) : undefined,
      goal: conf.goal !== undefined && str(conf.goal).trim() ? str(conf.goal).trim() : undefined,
      contract,
      agent: agentName(io, conf.agent, 'claude', `machine "${name}"`),
      model: conf.model ? str(conf.model) : undefined,
      attempts: Math.max(1, Number(conf.attempts ?? 3)),
      timeoutMs: parseDuration(conf.timeout, 10 * 60000),
      tools: Array.isArray(conf.tools) ? conf.tools.map((t) => str(t)) : [],
      allow: strList(conf.allow),
      deny: strList(conf.deny),
      readOnly: conf.read_only === true,
      sim: isObj(conf.sim) ? conf.sim : undefined,
    };
  }
  throw new Error(`machine "${name}" not found (looked in ${dirs.map((d) => d.dir).join(', ')})`);
}

export function loadModel(dir: string, shared: boolean, machineDirs: { dir: string; shared: boolean }[], root = path.resolve(dir, '..', '..', '..'), io: LoadIo = disk): LineModel {
  const conf = readYaml(io, path.join(dir, 'line.yaml'));
  const intakeConf = isObj(conf.intake) ? conf.intake : {};
  const kind = str(intakeConf.kind, 'manual') as IntakeKind;
  if (!['manual', 'timer', 'webhook', 'chat'].includes(kind)) throw new Error(`intake.kind "${kind}" is not one of manual, timer, webhook, chat`);
  const inputs: InputField[] = Array.isArray(intakeConf.inputs)
    ? intakeConf.inputs.map((i) => (typeof i === 'string' ? { name: i } : { name: str((i as Obj).name), label: (i as Obj).label ? str((i as Obj).label) : undefined, required: Boolean((i as Obj).required), placeholder: (i as Obj).placeholder ? str((i as Obj).placeholder) : undefined, multiline: (i as Obj).multiline ? true : undefined }))
    : [];
  const pieces: PieceDef[] = [{ id: '@intake', kind: 'intake', label: str(intakeConf.label, 'Intake'), needs: [] }];
  const machines: Record<string, MachineDef> = {};
  const list = Array.isArray(conf.pieces) ? conf.pieces : [];
  let prev = '@intake';
  const allMachineDirs = [{ dir: path.join(dir, 'machines'), shared }, ...machineDirs];
  for (const raw of list) {
    if (!isObj(raw)) throw new Error('pieces: each piece must be a mapping');
    const id = str(raw.id);
    if (!id || id.startsWith('@')) throw new Error(`pieces: invalid id "${id}"`);
    if (pieces.some((p) => p.id === id)) { problem(io, `pieces: duplicate id "${id}"`, dir, id); continue; }
    const needs = parseNeeds(io, raw.needs, prev, dir, id);
    const label = str(raw.label, titleCase(id));
    const goal = raw.goal !== undefined && str(raw.goal).trim() ? { goal: str(raw.goal).trim() } : {};
    if (raw.machine !== undefined) {
      const m = str(raw.machine);
      try { machines[m] ||= loadMachine(io, m, allMachineDirs, root); } catch (e) { problem(io, (e as Error).message, dir, id); }
      pieces.push({ id, kind: 'machine', label, needs, machine: m, ...goal });
    } else if (raw.signal !== undefined) {
      const s = isObj(raw.signal) ? raw.signal : { run: raw.signal };
      const timeout = s.timeout !== undefined && str(s.timeout).trim() ? str(s.timeout).trim() : undefined;
      const timeoutMs = timeout ? parseDuration(timeout, NaN) : undefined;
      if (timeout && !(timeoutMs! > 0)) problem(io, `signal "${id}": timeout "${timeout}" is not a duration like 90s, 40m or 2h`, dir, id);
      pieces.push({ id, kind: 'signal', label, needs, run: str(s.run), ...(timeoutMs! > 0 ? { timeout, timeoutMs } : {}), ...goal });
    } else if (raw.gate !== undefined) {
      const g = isObj(raw.gate) ? raw.gate : {};
      if (g.rule !== undefined) try { parseExpr(str(g.rule)); } catch (e) { problem(io, `gate "${id}": the rule "${str(g.rule)}" is not valid: ${(e as Error).message}`, dir, id); }
      const choices = Array.isArray(g.choices) ? g.choices.map((c) => str(c)) : undefined;
      if (choices && g.rule !== undefined) throw new Error(`gate "${id}": a gate has either a rule or choices, not both`);
      pieces.push({ id, kind: 'gate', label, needs, rule: g.rule !== undefined ? str(g.rule) : undefined, confirmations: g.rule !== undefined ? undefined : Math.max(1, Number(g.confirmations ?? 1)), choices , ...goal });
    } else throw new Error(`piece "${id}": needs one of machine, signal or gate`);
    prev = id;
  }
  const palletConf = isObj(conf.pallet) ? conf.pallet : {};
  pieces.push({ id: '@pallet', kind: 'pallet', label: str(palletConf.label, 'Pallet'), needs: parseNeeds(io, palletConf.needs, prev, dir, '@pallet') });
  const ids = new Set(pieces.map((p) => p.id));
  for (const p of pieces) {
    for (const n of p.needs) if (!ids.has(n.from)) problem(io, `piece "${p.id}" needs unknown piece "${n.from}"`, dir, p.id);
    p.needs = p.needs.filter((n) => ids.has(n.from));
  }
  for (const p of pieces) if (p.needs.length && p.needs.every((n) => n.back)) problem(io, `piece "${p.id}" has only return belts; it also needs a forward belt`, dir, p.id);
  columnsAndLanes(pieces); // throws on loops
  return { name: path.basename(dir), dir, shared, intake: { kind, inputs, label: intakeConf.label ? str(intakeConf.label) : undefined }, pieces, machines, deny: strList(conf.deny) };
}

/** Loads from disk, or from a draft overlay. A tolerant load keeps structural problems in `problems` instead of failing. */
export function loadFactory(root: string, opts: { fs?: Vfs; tolerant?: boolean } = {}): FactoryDef {
  root = path.resolve(root);
  const io: LoadIo = { fs: opts.fs ?? diskFs, problems: opts.tolerant ? [] : undefined };
  const fs = io.fs;
  const warnings: string[] = [];
  const fconf = fs.exists(path.join(root, 'factory.yaml')) ? readYaml(io, path.join(root, 'factory.yaml')) : {};
  if (!fs.exists(path.join(root, 'factory.yaml'))) warnings.push('factory.yaml is missing; using defaults.');
  const sharedMachines = { dir: path.join(root, 'shared', 'machines'), shared: true };
  const modelCache = new Map<string, LineModel>();
  const sectors: SectorDef[] = [];
  const sectorsDir = path.join(root, 'sectors');
  const sectorIds = fs.list(sectorsDir).filter((d) => fs.isDir(path.join(sectorsDir, d))).sort();
  sectorIds.forEach((sid, i) => {
    const sdir = path.join(sectorsDir, sid);
    try {
      const sconf = fs.exists(path.join(sdir, 'sector.yaml')) ? readYaml(io, path.join(sdir, 'sector.yaml')) : {};
      const sector: SectorDef = {
        id: sid, dir: sdir, culture: readText(io, path.join(sdir, 'culture.md')),
        name: str(sconf.name, titleCase(sid)),
        color: str(sconf.color, SECTOR_COLORS[i % SECTOR_COLORS.length]),
        policy: parsePolicy(sconf.policy),
        deny: strList(sconf.deny),
        manager: parseManager(io, sconf.manager, path.join(sdir, 'manager', 'role.md'), 'claude'),
        lines: [],
      };
      const lconf = fs.exists(path.join(sdir, 'lines.yaml')) ? readYaml(io, path.join(sdir, 'lines.yaml')) : {};
      const lines = Array.isArray(lconf.lines) ? lconf.lines : [];
      for (const raw of lines) {
        if (!isObj(raw)) continue;
        const id = str(raw.id);
        try {
          if (!id) throw new Error('every line needs an id');
          const modelName = str(raw.model);
          const local = path.join(sdir, 'models', modelName);
          const shared = path.join(root, 'shared', 'models', modelName);
          const mdir = fs.exists(path.join(local, 'line.yaml')) ? local : fs.exists(path.join(shared, 'line.yaml')) ? shared : null;
          if (!mdir) throw new Error(`model "${modelName}" not found in ${sid}/models or shared/models`);
          const isShared = mdir === shared;
          if (!modelCache.has(mdir)) modelCache.set(mdir, loadModel(mdir, isShared, [{ dir: path.join(sdir, 'machines'), shared: false }, sharedMachines], root, io));
          const params: Record<string, string> = {};
          if (isObj(raw.params)) for (const [k, v] of Object.entries(raw.params)) params[k] = str(v);
          const repo = raw.repo ? path.resolve(root, str(raw.repo)) : undefined;
          if (repo && !diskFs.exists(path.join(repo, '.git'))) warnings.push(`${sid}/${id}: repo ${repo} is not a git repository.`);
          const dir = str(raw.direction, 'right') as Direction;
          sector.lines.push({
            id: `${sid}/${id}`, name: str(raw.name, titleCase(id)), sectorId: sid,
            model: modelCache.get(mdir)!, direction: dir === 'left' ? 'left' : 'right', params, repo,
          });
        } catch (e) { warnings.push(`${sid}/lines.yaml, line "${id}": ${(e as Error).message}`); }
      }
      sectors.push(sector);
    } catch (e) { warnings.push(`sectors/${sid}: ${(e as Error).message}`); }
  });
  const gm = parseManager(io, fconf.general_manager, path.join(root, 'general-manager', 'role.md'), 'claude');
  return { root, name: str(fconf.name, titleCase(path.basename(root))), ceiling: parsePolicy(fconf.ceiling), deny: strList(fconf.deny), generalManager: gm, culture: readText(io, path.join(root, 'culture.md')), lineContext: fconf.line_context !== false, sectors, warnings, problems: io.problems };
}

/** How many lines and sectors use each model folder and machine folder. */
export function usage(f: FactoryDef): Map<string, { lines: number; sectors: Set<string> }> {
  const out = new Map<string, { lines: number; sectors: Set<string> }>();
  const add = (k: string, sid: string) => { const u = out.get(k) || { lines: 0, sectors: new Set<string>() }; u.lines++; u.sectors.add(sid); out.set(k, u); };
  for (const s of f.sectors) for (const l of s.lines) {
    add(l.model.dir, s.id);
    for (const m of Object.values(l.model.machines)) add(m.dir, s.id);
  }
  return out;
}

export function findLine(f: FactoryDef, lineId: string): LineDef | undefined {
  for (const s of f.sectors) for (const l of s.lines) if (l.id === lineId) return l;
  return undefined;
}
