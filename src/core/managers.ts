// Sector Managers and the General Manager (D29, D33, D34).
// Managers run read-only and answer under a contract: answer, evidence, proposals.
// Proposals become buttons; the policy may let some verbs run on their own.
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import type { FactoryDef, ManagerDef, ManagerMessage, Policy, Proposal, SectorDef, VerbName } from '../shared/types';
import { runAgent } from './agents';
import type { Engine } from './engine';
import { RUNS_DIR } from './engine';
import { relPosix } from './paths';

export const MANAGER_CONTRACT = {
  type: 'object',
  required: ['answer'],
  properties: {
    answer: { type: 'string' },
    evidence: { type: 'array', items: { type: 'object', properties: { runId: { type: 'string' }, lineId: { type: 'string' }, pieceId: { type: 'string' }, note: { type: 'string' } } } },
    proposals: {
      type: 'array',
      items: {
        type: 'object', required: ['kind', 'why'],
        properties: {
          kind: { enum: ['verb', 'patch'] },
          why: { type: 'string' },
          verb: { enum: ['run', 'retry', 'release', 'halt', 'resume'] },
          lineId: { type: 'string' }, pieceId: { type: 'string' }, hint: { type: 'string' },
          input: { type: 'object' },
          files: { type: 'array', items: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } } },
        },
      },
    },
  },
};
const validate = new Ajv({ allErrors: true, strict: false }).compile(MANAGER_CONTRACT);
const NEVER_AUTO: VerbName[] = ['release', 'apply', 'resume', 'allow', 'deny'];

/** How many times per run a manager may run a verb alone: the stricter of sector policy and factory ceiling. */
export function autoAllowance(sector: Policy, ceiling: Policy, verb: VerbName): number {
  if (NEVER_AUTO.includes(verb)) return 0;
  return Math.max(0, Math.min(sector[verb]?.auto ?? 0, ceiling[verb]?.auto ?? 0));
}

export type Scope = { kind: 'sector'; sectorId: string } | { kind: 'factory' };
const scopeKey = (s: Scope) => (s.kind === 'factory' ? '_factory' : s.sectorId);
let msgSeq = 0;
const mid = () => `${Date.now().toString(36)}${(++msgSeq).toString(36)}`;

export class Managers {
  private history = new Map<string, ManagerMessage[]>();
  constructor(private getFactory: () => FactoryDef, private engine: () => Engine, private onChange: (scope: string) => void) {}

  private file(key: string) { return path.join(this.getFactory().root, RUNS_DIR, 'conversations', `${key}.jsonl`); }

  messages(scope: Scope): ManagerMessage[] {
    const key = scopeKey(scope);
    if (!this.history.has(key)) {
      const f = this.file(key);
      this.history.set(key, fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
    }
    return this.history.get(key)!;
  }

  private save(scope: Scope) {
    const key = scopeKey(scope);
    const f = this.file(key);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, this.messages(scope).filter((m) => !m.pending).map((m) => JSON.stringify(m)).join('\n') + '\n');
    this.onChange(key);
  }

  async ask(scope: Scope, question: string): Promise<ManagerMessage> {
    const f = this.getFactory();
    const sector = scope.kind === 'sector' ? f.sectors.find((s) => s.id === scope.sectorId) : undefined;
    if (scope.kind === 'sector' && !sector) throw new Error(`Unknown sector ${scope.sectorId}`);
    const def: ManagerDef = sector ? sector.manager : f.generalManager;
    const list = this.messages(scope);
    list.push({ id: mid(), t: Date.now(), from: 'you', text: question });
    const reply: ManagerMessage = { id: mid(), t: Date.now(), from: 'manager', text: '', pending: true };
    list.push(reply);
    this.onChange(scopeKey(scope));
    const brief = this.brief(scope);
    const res = def.agent === 'sim'
      ? { output: simManager(f, this.engine(), scope, question) }
      : await runAgent({
        agent: def.agent, model: def.model, readOnly: true, shell: false, tools: def.tools, allow: [], deny: [], addDirs: [],
        cwd: sector ? sector.dir : f.root, timeoutMs: 5 * 60000, schema: MANAGER_CONTRACT,
        role: [def.role || (sector ? `You are the Sector Manager of "${sector.name}".` : 'You are the General Manager of this factory.'), f.culture, sector?.culture].filter((x) => x && x.trim()).join('\n\n'),
        prompt: managerPrompt(scope, sector, brief, question, this.messages(scope).slice(-8, -2)), onEvent: () => {},
      });
    if (def.agent === 'sim') await new Promise((r) => setTimeout(r, 1200 / Number(process.env.ROBORATORY_SIM_SPEED || 1)));
    reply.pending = false;
    if ('error' in res && res.error) reply.error = res.error;
    else if (!validate(res.output)) reply.error = `The answer did not match the manager contract: ${JSON.stringify(validate.errors?.[0]?.message)}`;
    else {
      const out = res.output as { answer: string; evidence?: ManagerMessage['evidence']; proposals?: Record<string, unknown>[] };
      reply.text = out.answer;
      reply.evidence = out.evidence ?? [];
      reply.proposals = (out.proposals ?? []).map((p) => this.toProposal(scope, p)).filter((p): p is Proposal => !!p);
      for (const p of reply.proposals) await this.maybeAuto(scope, p);
    }
    this.save(scope);
    return reply;
  }

  /** Turns a raw proposal into a checked one; invalid verbs are dropped. */
  private toProposal(scope: Scope, raw: Record<string, unknown>): Proposal | undefined {
    const f = this.getFactory();
    const why = String(raw.why ?? '');
    if (raw.kind === 'patch') {
      const files = (raw.files as { path: string; content: string }[] | undefined) ?? [];
      const safe = files.filter((x) => { const abs = path.resolve(f.root, x.path); return abs.startsWith(f.root + path.sep) && !abs.includes(`${path.sep}${RUNS_DIR}${path.sep}`); });
      if (!safe.length) return undefined;
      return { id: mid(), kind: 'patch', why, status: 'open', files: safe.map((x) => { const abs = path.resolve(f.root, x.path); return { path: x.path, content: x.content, before: fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined }; }) };
    }
    const verb = raw.verb as VerbName;
    const lineId = String(raw.lineId ?? '');
    const line = this.engine().lines.get(lineId);
    if (!line || !['run', 'retry', 'release', 'halt', 'resume'].includes(verb)) return undefined;
    if (scope.kind === 'sector' && line.def.sectorId !== scope.sectorId) return undefined;
    const pieceId = raw.pieceId ? String(raw.pieceId) : undefined;
    if ((verb === 'retry' || verb === 'release') && (!pieceId || !line.pieces.has(pieceId))) return undefined;
    const args: Record<string, string> = {};
    if (raw.hint) args.hint = String(raw.hint);
    if (raw.input && typeof raw.input === 'object') for (const [k, v] of Object.entries(raw.input)) args[`input.${k}`] = String(v);
    const runId = pieceId ? line.pieces.get(pieceId)?.current?.runId : undefined;
    return { id: mid(), kind: 'verb', why, verb, target: { lineId, pieceId, runId }, args, status: 'open' };
  }

  /** Verbs without a run (run, halt) are counted per line per day. */
  private lineUses = new Map<string, number>();

  private async maybeAuto(scope: Scope, p: Proposal) {
    if (p.kind !== 'verb' || scope.kind !== 'sector' || !p.verb) return;
    const f = this.getFactory();
    const sector = f.sectors.find((s) => s.id === scope.sectorId)!;
    const allowed = autoAllowance(sector.policy, f.ceiling, p.verb);
    if (!allowed) return;
    const runId = p.target?.runId;
    const dayKey = `${p.target!.lineId}|${p.verb}|${new Date().toDateString()}`;
    const used = runId ? this.engine().autoUses(runId, p.verb) : this.lineUses.get(dayKey) ?? 0;
    if (used >= allowed) return;
    try {
      await this.execute(p, `${sector.name} manager (policy ${used + 1}/${allowed})`);
      if (runId) this.engine().noteAuto(runId, p.verb); else this.lineUses.set(dayKey, used + 1);
      p.status = 'auto';
    } catch { /* leave it as a button */ }
  }

  /** Runs a verb proposal through the engine, like a button would. */
  async execute(p: Proposal, actor: string, confirmations = 0) {
    const e = this.engine();
    const t = p.target!;
    switch (p.verb) {
      case 'retry': e.retry(t.lineId, t.pieceId!, p.args?.hint ?? '', actor); break;
      case 'release': e.release(t.lineId, t.pieceId!, confirmations, actor); break;
      case 'halt': e.halt(t.lineId, actor); break;
      case 'resume': e.resume(t.lineId, actor); break;
      case 'run': {
        const input = Object.fromEntries(Object.entries(p.args ?? {}).filter(([k]) => k.startsWith('input.')).map(([k, v]) => [k.slice(6), v]));
        await e.run(t.lineId, input, actor);
        break;
      }
    }
  }

  /** Accepting a patch only writes files (D5). */
  applyPatch(scope: Scope, messageId: string, proposalId: string) {
    const p = this.find(scope, messageId, proposalId);
    if (p.kind !== 'patch' || p.status !== 'open') throw new Error('This change is not open');
    const root = this.getFactory().root;
    for (const file of p.files!) {
      const abs = path.resolve(root, file.path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, file.content);
    }
    p.status = 'applied';
    this.engine().audit(scope.kind === 'sector' ? scope.sectorId : '_factory', { verb: 'apply', actor: 'you', files: p.files!.map((x) => x.path), why: p.why });
    this.save(scope);
  }

  setStatus(scope: Scope, messageId: string, proposalId: string, status: Proposal['status']) {
    this.find(scope, messageId, proposalId).status = status;
    this.save(scope);
  }

  find(scope: Scope, messageId: string, proposalId: string): Proposal {
    const m = this.messages(scope).find((x) => x.id === messageId);
    const p = m?.proposals?.find((x) => x.id === proposalId);
    if (!p) throw new Error('Proposal not found');
    return p;
  }

  /** What a manager is told about its part of the factory. */
  brief(scope: Scope): string {
    const f = this.getFactory();
    const e = this.engine();
    const sectors = scope.kind === 'sector' ? f.sectors.filter((s) => s.id === scope.sectorId) : f.sectors;
    const lines: string[] = [];
    for (const s of sectors) {
      lines.push(`Sector ${s.name} (${s.id}), folder ${relPosix(f.root, s.dir)}`);
      for (const l of s.lines) {
        const v = e.lineView(l.id);
        lines.push(`  Line ${l.name} (${l.id})${v.halted ? ' HALTED' : ''}, model ${l.model.name}${l.model.shared ? ' (shared)' : ''}`);
        for (const p of l.model.pieces) {
          const pv = v.pieces[p.id];
          lines.push(`    ${p.id} [${p.kind}] ${p.label}: ${pv.state}${pv.queue ? `, ${pv.queue} queued` : ''}${pv.error ? ` — ${pv.error}` : ''}`);
        }
      }
    }
    const runs = e.runSummaries().filter((r) => sectors.some((s) => s.id === r.sectorId)).slice(0, 15);
    lines.push('Recent runs:');
    for (const r of runs) lines.push(`  ${r.id} ${r.lineId} ${r.status} ${JSON.stringify(r.input)}${r.endedAt ? ` ${Math.round((r.endedAt - r.startedAt) / 1000)}s` : ''}`);
    const logs = e.logs.filter((l) => l.level !== 'machine' && (scope.kind === 'factory' || l.sectorId === scope.sectorId)).slice(-30);
    lines.push('Recent events:');
    for (const l of logs) lines.push(`  ${new Date(l.t).toISOString().slice(11, 19)} ${l.text}`);
    return lines.join('\n');
  }
}

function managerPrompt(scope: Scope, sector: SectorDef | undefined, brief: string, question: string, earlier: ManagerMessage[]) {
  return [
    scope.kind === 'sector'
      ? `You manage the sector "${sector!.name}". You may only propose changes to files inside ${path.basename(sector!.dir)}/ (relative to the factory root: sectors/${sector!.id}/).`
      : 'You manage the whole factory. You may propose new sectors (a new folder under sectors/) and changes to shared/.',
    'You are read-only. Never try to change anything yourself. To change something, add a proposal: a verb (run, retry, release, halt, resume) with lineId and pieceId, or a patch with whole-file contents and paths relative to the factory root. The person decides.',
    'Cite the runs and pieces you rely on in evidence.',
    `Current state:\n${brief}`,
    earlier.length ? `Earlier in this conversation:\n${earlier.map((m) => `${m.from}: ${m.text}`).join('\n')}` : '',
    `Question: ${question}`,
  ].filter(Boolean).join('\n\n');
}

// ---------- simulated managers (demo factory) ----------

function simManager(f: FactoryDef, e: Engine, scope: Scope, question: string): Record<string, unknown> {
  const q = question.toLowerCase();
  const sectors = scope.kind === 'sector' ? f.sectors.filter((s) => s.id === scope.sectorId) : f.sectors;
  const fires: { line: string; lineName: string; piece: string; label: string; error: string; runId?: string }[] = [];
  const holds: { line: string; lineName: string; piece: string; label: string; runId?: string }[] = [];
  for (const s of sectors) for (const l of s.lines) {
    const v = e.lineView(l.id);
    for (const p of l.model.pieces) {
      const pv = v.pieces[p.id];
      if (pv.state === 'fire') fires.push({ line: l.id, lineName: l.name, piece: p.id, label: p.label, error: pv.error ?? '', runId: pv.runId });
      if (pv.state === 'holding') holds.push({ line: l.id, lineName: l.name, piece: p.id, label: p.label, runId: pv.runId });
    }
  }
  const runs = e.runSummaries().filter((r) => sectors.some((s) => s.id === r.sectorId));
  if (scope.kind === 'factory') {
    const m = /sector (?:called |named |for )?["']?([a-z][\w -]{1,30})["']?/i.exec(question);
    if (m && /(build|create|make|add|new|monte|crie)/.test(q)) {
      const name = m[1].trim().replace(/\b\w/g, (c) => c.toUpperCase());
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return {
        answer: `Here is a starting point for a ${name} sector: one manual intake line that triages what comes in, using the shared triager machine. Accept it to write the files, then adjust the line in sectors/${id}/.`,
        evidence: [],
        proposals: [{
          kind: 'patch', why: `New sector "${name}" with a triage line.`,
          files: [
            { path: `sectors/${id}/sector.yaml`, content: `name: ${name}\npolicy: {}\nmanager:\n  agent: sim\n` },
            { path: `sectors/${id}/manager/role.md`, content: `You are the ${name} Sector Manager.\n` },
            { path: `sectors/${id}/models/intake-triage/line.yaml`, content: 'schema_version: 1\nintake:\n  kind: manual\n  label: Request\n  inputs:\n    - { name: ticket, label: Ticket, required: true }\npieces:\n  - id: triage\n    machine: triager\npallet:\n  label: Triaged\n' },
            { path: `sectors/${id}/lines.yaml`, content: 'lines:\n  - id: main\n    name: Incoming requests\n    model: intake-triage\n' },
          ],
        }],
      };
    }
    const done = runs.filter((r) => r.status === 'done');
    const durations = done.map((r) => (r.endedAt! - r.startedAt) / 1000);
    const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    return {
      answer: `Across ${f.sectors.length} sectors: ${runs.length} runs, ${done.length} finished${durations.length ? ` (average ${avg}s)` : ''}, ${fires.length} stopped piece${fires.length === 1 ? '' : 's'} and ${holds.length} gate${holds.length === 1 ? '' : 's'} waiting for you.${fires.length ? ` The most urgent is ${fires[0].label} on ${fires[0].lineName}.` : ''} Ask me to build a sector, for example "build a sector called Support".`,
      evidence: fires.slice(0, 3).map((x) => ({ lineId: x.line, pieceId: x.piece, runId: x.runId, note: x.error })),
      proposals: [],
    };
  }
  if (fires.length) {
    const x = fires[0];
    const missing = /property "?'?([a-z_]+)/i.exec(x.error)?.[1];
    const hint = missing ? `Include ${missing} in your answer; you already have the data for it.` : 'Read the validation error and answer with every required field.';
    return {
      answer: `${x.label} on ${x.lineName} stopped: ${x.error}. ${missing ? `The agent keeps leaving out "${missing}", although its transcript shows it found the data. A retry with a hint should fix it.` : 'A retry with a hint is the cheapest next step.'}`,
      evidence: [{ runId: x.runId, lineId: x.line, pieceId: x.piece, note: 'contract rejected every attempt' }],
      proposals: [{ kind: 'verb', verb: 'retry', lineId: x.line, pieceId: x.piece, hint, why: 'Retry with the missing field named.' }],
    };
  }
  if (/(signal|smoke|check|lint|sinal)/.test(q)) {
    const local = sectors[0]?.lines.find((l) => !l.model.shared);
    if (local) {
      const file = path.join(local.model.dir, 'line.yaml');
      const text = fs.readFileSync(file, 'utf8');
      const piece = '  - id: smoke\n    label: Smoke test\n    signal: { run: "echo smoke test ok" }\n';
      const content = text.includes('\npallet:') ? text.replace('\npallet:', `\n${piece}pallet:`) : `${text}${piece}`;
      return {
        answer: `I can add a smoke-test signal right before the pallet of the ${local.model.name} model. It affects every line built from that model in this sector.`,
        evidence: [{ lineId: local.id, note: relPosix(f.root, file) }],
        proposals: [{ kind: 'patch', why: 'Add a smoke-test signal before the pallet.', files: [{ path: relPosix(f.root, file), content }] }],
      };
    }
    return { answer: 'Every line in this sector uses a shared model. Changes to shared models belong to the General Manager.', evidence: [], proposals: [] };
  }
  if (holds.length) {
    return {
      answer: `${holds.length} gate${holds.length === 1 ? ' is' : 's are'} waiting for you: ${holds.map((h) => `${h.label} on ${h.lineName}`).join(', ')}. Releasing is always your call.`,
      evidence: holds.map((h) => ({ runId: h.runId, lineId: h.line, pieceId: h.piece })),
      proposals: holds.slice(0, 2).map((h) => ({ kind: 'verb', verb: 'release', lineId: h.line, pieceId: h.piece, why: `Release ${h.label}.` })),
    };
  }
  const line = sectors[0]?.lines[0];
  const done = runs.filter((r) => r.status === 'done').length;
  return {
    answer: `All quiet: ${runs.length} run${runs.length === 1 ? '' : 's'} in this sector, ${done} finished, nothing stopped and no gate waiting.${line ? ` I can start a run on ${line.name} if you want.` : ''}`,
    evidence: [],
    proposals: line && line.model.intake.inputs.length <= 1 && /(run|start|go|rode|inicia)/.test(q) ? [{ kind: 'verb', verb: 'run', lineId: line.id, why: `Start a run on ${line.name}.`, input: Object.fromEntries(line.model.intake.inputs.map((i) => [i.name, i.placeholder || 'demo'])) }] : [],
  };
}
