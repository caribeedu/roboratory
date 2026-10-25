// What the engine tests share: a way to describe a factory, machines that behave as told, a fake agent CLI that
// records what it is asked, and waiting for what the engine does. Nothing here knows how the engine works inside:
// tests describe a line and watch the floor, the run files and what the agents receive.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import { createTargetRepo } from '../core/demo';
import { Engine, type EngineOptions } from '../core/engine';
import { loadFactory } from '../core/factory';
import type { FactoryDef } from '../shared/types';

// simulated agents work 200 times faster than they say, so `seconds: 1` is a few milliseconds
process.env.ROBORATORY_SIM_SPEED = '200';

export function writeFiles(root: string, files: Record<string, string>) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
    if (rel.endsWith('.sh')) fs.chmodSync(path.join(root, rel), 0o755);
  }
}

export const tmpDir = (prefix = 'roboratory-test-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// ---------- machines ----------

type Files = Record<string, string>;

export interface SimSpec {
  /** what the simulated agent answers every time */
  output?: Record<string, unknown>;
  /** or one answer per call, the last one repeating */
  outputs?: Record<string, unknown>[];
  /** simulated seconds a step takes (the tests run at 200x) */
  seconds?: number;
  attempts?: number;
  ask?: Record<string, unknown>;
  failFirstRun?: boolean;
  badOutput?: Record<string, unknown>;
  /** files the agent writes in its folder, and the commit message when it commits them */
  write?: Record<string, string>;
  commit?: string;
  /** shell commands the agent tries to run, in order; a denial stops it with the reason when `stopIfDenied` */
  requests?: string[];
  stopIfDenied?: boolean;
  goal?: string;
  /** the contract; by default any object */
  contract?: Record<string, unknown>;
  role?: string;
}

/** The files of a machine folder whose agent is the simulated one. */
export function simMachine(spec: SimSpec = {}): Files {
  const sim: Record<string, unknown> = { seconds: spec.seconds ?? 1 };
  if (spec.outputs) sim.outputs = spec.outputs; else sim.output = spec.output ?? { ok: true };
  if (spec.ask) sim.ask = spec.ask;
  if (spec.failFirstRun) sim.fail_first_run = true;
  if (spec.badOutput) sim.bad_output = spec.badOutput;
  if (spec.write) sim.write = spec.write;
  if (spec.commit) sim.commit = spec.commit;
  if (spec.requests) sim.requests = spec.requests;
  if (spec.stopIfDenied) sim.stop_if_denied = true;
  const yaml: Record<string, unknown> = { schema_version: 1, agent: 'sim', ...(spec.attempts ? { attempts: spec.attempts } : {}), ...(spec.goal ? { goal: spec.goal } : {}), sim };
  return {
    'role.md': spec.role ?? 'role',
    'contract.json': JSON.stringify(spec.contract ?? { type: 'object' }),
    'machine.yaml': stringify(yaml),
  };
}

/** A machine that must answer `{ ok: true }`, as a contract. */
export const strictMachine = (spec: SimSpec = {}): Files => simMachine({ ...spec, contract: { type: 'object', required: ['ok'], properties: { ok: { const: true } } } });

/** A checker that gives these verdicts in turn (the last one repeats); a verdict can be an object to carry findings. */
export const checker = (verdicts: (string | Record<string, unknown>)[], extra: SimSpec = {}): Files =>
  simMachine({ outputs: verdicts.map((v) => (typeof v === 'string' ? { verdict: v } : v)), contract: { type: 'object', required: ['verdict'] }, ...extra });

/** A machine whose agent is the real Claude adapter, pointed at the fake CLI. */
export const claudeMachine = (over: Files = {}): Files => ({ 'role.md': 'role', 'contract.json': '{"type":"object"}', 'machine.yaml': 'schema_version: 1\nagent: claude\n', ...over });

// ---------- factories ----------

export interface Built { dir: string; root: string; f: FactoryDef }

/** A one-sector factory (sector `s`, line `l`, model `m`) whose line is `lineYaml`; `withRepo` gives the line a target repository. */
const versioned = (yaml: string) => (/^schema_version:/m.test(yaml) ? yaml : `schema_version: 1\n${yaml}`);

export function buildFactory(lineYaml: string, machines: Record<string, Files>, files: Files = {}, withRepo = false): Built {
  const dir = tmpDir('roboratory-engine-');
  const root = path.join(dir, 'factory');
  if (withRepo) createTargetRepo(path.join(dir, 'repo'), 'repo');
  const machineFiles = Object.entries(machines).reduce<Files>((acc, [name, f]) => {
    // the format's version is not what these tests are about, so a machine file that leaves it out is given one
    for (const [file, text] of Object.entries(f)) acc[`sectors/s/models/m/machines/${name}/${file}`] = file === 'machine.yaml' ? versioned(text) : text;
    return acc;
  }, {});
  writeFiles(root, {
    'factory.yaml': 'name: T\n',
    'sectors/s/sector.yaml': 'name: S\n',
    'sectors/s/lines.yaml': `lines:\n  - id: l\n    model: m\n${withRepo ? '    repo: ../repo\n' : ''}    params: { svc: orders }\n`,
    'sectors/s/models/m/line.yaml': versioned(lineYaml),
    ...machineFiles,
    ...files,
  });
  const f = loadFactory(root);
  if (f.warnings.length) throw new Error(`the test factory has warnings: ${f.warnings.join('; ')}`);
  return { dir, root, f };
}

export const LINE = 's/l';

/** Opening lines for line.yaml: an intake and a list of pieces. */
export const line = (pieces: string, pallet = '') => `schema_version: 1\nintake: { kind: manual }\npieces:\n${pieces}\n${pallet}`;

// ---------- engines ----------

// whatever a test starts is stopped and put back after it, with no hook to remember in each file
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((c) => c()); });

/** An engine on a factory, stopped after the test. `beltMs` is short unless a test wants boxes to stay on a belt. */
export function startEngine(f: FactoryDef, opts: EngineOptions = { beltMs: 5 }): Engine {
  const e = new Engine(f, opts);
  cleanups.push(() => e.dispose());
  return e;
}

/** A new engine on the same files, as after the app or the engine restarted. */
export function restartEngine(root: string): Engine {
  const e = startEngine(loadFactory(root));
  e.restore();
  return e;
}

// ---------- watching the floor and the run ----------

export async function until(fn: () => boolean, ms = 20000) {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 10)); }
}

/** Waits for something that must not happen: nothing moves for this long. */
export const quietFor = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const stateOf = (e: Engine, piece: string, line = LINE) => e.lineView(line).pieces[piece]?.state;
export const errorOf = (e: Engine, piece: string, line = LINE) => e.lineView(line).pieces[piece]?.error;
export const whenState = (e: Engine, piece: string, state: string, ms?: number) => until(() => stateOf(e, piece) === state, ms);
export const statusOf = (e: Engine, runId?: string) => (runId ? e.runSummaries().find((r) => r.id === runId) : e.runSummaries()[0])?.status;
export const whenDone = (e: Engine, runId?: string, ms?: number) => until(() => statusOf(e, runId) === 'done', ms);
export const whenEnded = (e: Engine, runId?: string) => until(() => !['running', 'fire'].includes(statusOf(e, runId) ?? 'running'));

/** The events a run recorded, narrowed by type (and piece). The run file is an open format, so it is fair to read. */
export function eventsOf(e: Engine, runId: string, type?: string, piece?: string) {
  return e.runEvents(runId).filter((x) => (!type || x.type === type) && (!piece || x.piece === piece));
}
export const piecesRun = (e: Engine, runId: string, type = 'piece.done') => eventsOf(e, runId, type).map((x) => x.piece as string);

// ---------- a fake agent CLI ----------

export interface FakeClaude {
  /** what each invocation received, oldest first */
  calls(): { args: string[]; prompt: string; role: string; schema: any }[];
  /** resolves once the agent has been called this many times */
  waitForCalls(n: number): Promise<void>;
}

/**
 * Points the Claude adapter at a script that records its arguments and answers with `structured`
 * (wrapped under `result`, as the adapter asks). Restored after the test.
 */
export function fakeClaude(structured: Record<string, unknown> | ((n: number) => Record<string, unknown>) = { ok: true }): FakeClaude {
  const dir = tmpDir('fake-claude-');
  const log = path.join(dir, 'calls.jsonl');
  const answer = typeof structured === 'function' ? structured : () => structured;
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/usr/bin/env node
const fs = require('fs');
const log = ${JSON.stringify(log)};
const n = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\\n').filter(Boolean).length : 0;
fs.appendFileSync(log, JSON.stringify(process.argv.slice(2)) + '\\n');
const answers = ${JSON.stringify(Array.from({ length: 12 }, (_, i) => answer(i)))};
console.log(JSON.stringify({ type: 'result', subtype: 'success', result: '', structured_output: { result: answers[Math.min(n, answers.length - 1)] } }));
`);
  fs.chmodSync(bin, 0o755);
  const before = process.env.ROBORATORY_CLAUDE_BIN;
  process.env.ROBORATORY_CLAUDE_BIN = bin;
  cleanups.push(() => { if (before === undefined) delete process.env.ROBORATORY_CLAUDE_BIN; else process.env.ROBORATORY_CLAUDE_BIN = before; });
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []).map((l) => {
      const args: string[] = JSON.parse(l);
      const after = (flag: string) => args[args.indexOf(flag) + 1];
      return { args, prompt: after('-p'), role: after('--append-system-prompt'), schema: JSON.parse(after('--json-schema') ?? 'null') };
  });
  return {
    calls,
    waitForCalls: async (n) => {
      const t0 = Date.now();
      while (calls().length < n) {
        if (Date.now() - t0 > 20000) throw new Error(`the agent was called ${calls().length} times, not ${n}`);
        await new Promise((r) => setTimeout(r, 10));
      }
    },
  };
}
