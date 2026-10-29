// The rehearsal (D48): a line run once on a copy, with nobody to answer. These tests run real rehearsals through the module's own entry points,
// with the simulated agent and a fake agent CLI, and read what they leave: the report, the findings, the copy and the factory.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildFactory, checker, claudeMachine, fakeClaude, LINE, line, simMachine, strictMachine } from '../test/harness';
import type { Finding, RehearsalReport, RehearsalRequest } from '../shared/types';
import { apply } from './build/ops';
import { Draft } from './build/draft';
import { loadFactory } from './factory';
import { pieceVersion } from './version';
import { adapt, planOf, prepareCopy, runRehearsal, suggestionFor } from './rehearsal';

const req = (over: Partial<RehearsalRequest> = {}): RehearsalRequest => ({ lineId: LINE, input: {}, mode: 'simulation', source: 'disk', ...over });

/** Rehearses the factory on disk, and gives back the report and the folder of the copy it used. */
async function rehearse(root: string, over: Partial<RehearsalRequest> = {}, env: { signal?: AbortSignal; maxMs?: number } = {}) {
  const request = req(over);
  const copy = await prepareCopy({ kind: 'disk', root }, request.lineId);
  const report = await runRehearsal(copy, request, { sourceRoot: root, beltMs: 5, ...env });
  return { report, copy };
}
const kinds = (r: RehearsalReport) => r.findings.map((f) => `${f.class}:${f.kind}`).sort();
const find = (r: RehearsalReport, kind: Finding['kind']) => r.findings.find((f) => f.kind === kind);

/** A fingerprint of every file of a folder, to see that a rehearsal changed none. */
const fingerprint = (dir: string): string => {
  const hash = crypto.createHash('sha1');
  const walk = (d: string) => { for (const n of fs.readdirSync(d).sort()) { if (n === ".runs") continue; const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else hash.update(p + fs.readFileSync(p)); } };
  walk(dir);
  return hash.digest('hex');
};

describe('A rehearsal in simulation', () => {
  const wire = line(
    `  - { id: dev, machine: dev, needs: ["@intake", { from: qa, when: "verdict == 'fail'", back: true, laps: 3 }] }\n  - { id: qa, machine: qa }\n  - { id: ok, gate: { confirmations: 2 }, needs: [{ from: qa, when: "verdict == 'pass'" }] }`,
    `pallet: { needs: [{ from: ok }] }`,
  );

  it('runs the line to its pallet on a copy, with the gates released and the work sent back once, for nothing', async () => {
    const b = buildFactory(wire, { dev: simMachine(), qa: checker(['pass']) });
    const before = fingerprint(b.root);
    const { report, copy } = await rehearse(b.root);

    expect(report).toMatchObject({ status: 'done', mode: 'simulation', costUsd: 0, lineId: LINE });
    expect(kinds(report)).toEqual(['note:gate', 'note:rework']);
    // nothing in the factory changed, and the copy is gone
    expect(fingerprint(b.root)).toBe(before);
    expect(fs.existsSync(copy.folder)).toBe(false);
  });

  it('writes the report where the factory keeps its runtime files, with the run of the copy beside it', async () => {
    const b = buildFactory(wire, { dev: simMachine(), qa: checker(['pass']) });
    const { report } = await rehearse(b.root);
    const dir = path.join(b.root, '.runs', 'rehearsals', report.id);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'))).toMatchObject({ id: report.id, status: 'done' });
    expect(fs.existsSync(path.join(dir, 'runs', report.runId!, 'run.jsonl'))).toBe(true);
    // the factory's own runs are not touched: a rehearsal is not work
    expect(fs.existsSync(path.join(b.root, '.runs', 's'))).toBe(false);
  });

  it('keeps the copy when asked to', async () => {
    const b = buildFactory(line('  - { id: a, machine: a }'), { a: simMachine() });
    const { report, copy } = await rehearse(b.root, { keep: true });
    expect(report.kept).toBe(copy.folder);
    expect(fs.existsSync(path.join(copy.folder, 'factory.yaml'))).toBe(true);
    copy.cleanup();
  });

  it('turns the signals into true, which a signal that would fail does not stop', async () => {
    const b = buildFactory(line('  - { id: a, machine: a }\n  - { id: check, signal: { run: "exit 1" } }'), { a: simMachine() });
    expect((await rehearse(b.root)).report.status).toBe('done');
  });
});

describe('What nobody answers in a rehearsal', () => {
  it('refuses a command no list covers and says which prefix a list would take', async () => {
    const b = buildFactory(line('  - { id: a, machine: a }'), { a: simMachine({ requests: ['npm test --silent'] }) });
    const { report } = await rehearse(b.root, { mode: 'real' });
    expect(find(report, 'uncovered-command')).toMatchObject({ class: 'defect', pieceId: 'a', command: 'npm test --silent', suggestion: 'npm test' });
    expect(report.pieces[0]).toMatchObject({ pieceId: 'a', denied: 1 });
  });

  it('stamps a finding with the version of the piece as it was given, so it can be compared with the draft', async () => {
    // the rehearsal switches the model, the effort and the agent, and denies the outward items: none of that is the piece's version
    const b = buildFactory(line('  - { id: a, machine: a }'), { a: simMachine({ requests: ['npm test'] }) });
    fs.appendFileSync(path.join(b.root, 'sectors/s/models/m/machines/a/machine.yaml'), 'outward: [gh pr create]\n');
    for (const mode of ['real', 'simulation'] as const) {
      const { report } = await rehearse(b.root, { mode });
      const given = loadFactory(b.root);
      const expected = pieceVersion(given, given.sectors[0].lines[0], 'a');
      expect(expected).toBeTruthy();
      expect(report.pieces[0].version).toBe(expected);
      for (const x of report.findings) expect(x.version).toBe(expected);
    }
  });

  it('holds back what a machine says acts outside, as a note and not as a defect', async () => {
    const b = buildFactory(line('  - { id: a, machine: a }'), { a: simMachine({ requests: ['git push origin main'] }) });
    const file = path.join(b.root, 'sectors/s/models/m/machines/a/machine.yaml');
    fs.appendFileSync(file, 'outward: [git push]\nallow: [git push]\n');
    const { report } = await rehearse(b.root, { mode: 'real' });
    expect(find(report, 'outward')).toMatchObject({ class: 'note', command: 'git push origin main' });
    expect(find(report, 'uncovered-command')).toBeUndefined();
    expect(report.findings.some((f) => f.class === 'defect')).toBe(false);
  });

  it('calls a command the factory never allows a defect', async () => {
    const b = buildFactory(line('  - { id: a, machine: a }'), { a: simMachine({ requests: ['rm -rf build'] }) }, { 'factory.yaml': 'name: T\ndeny: [rm -rf]\n' });
    const { report } = await rehearse(b.root, { mode: 'real' });
    expect(find(report, 'forbidden-command')).toMatchObject({ class: 'defect', command: 'rm -rf build' });
  });

  it("answers a machine's question with its own recommendation, and notes it", async () => {
    const asker = simMachine({ ask: { question: 'Which service?', options: ['orders', 'storefront'], recommendation: 'orders' }, output: { picked: '{{box.human_answer.answer}}' } });
    const b = buildFactory(line('  - { id: a, machine: a }'), { a: asker });
    const { report } = await rehearse(b.root, { mode: 'real' });
    expect(report.status).toBe('done');
    expect(find(report, 'question')).toMatchObject({ class: 'note', pieceId: 'a', message: 'Asked: Which service?' });
    expect(report.pieces[0].questions).toBe(1);
  });

  it('answers with the first option when the machine gives no recommendation', async () => {
    const asker = simMachine({ ask: { question: 'Which service?', options: ['orders', 'storefront'] }, output: { picked: '{{box.human_answer.answer}}' } });
    const b = buildFactory(line('  - { id: a, machine: a }'), { a: asker });
    const { report } = await rehearse(b.root, { mode: 'real' });
    expect(report.status).toBe('done');
  });

  it('lets a gate with choices through on the first choice that does not send the work back', async () => {
    const wire = line(
      `  - { id: dev, machine: dev, needs: ["@intake", { from: g, when: "decision.choice == 'revise'", back: true, laps: 2 }] }\n  - { id: g, gate: { choices: [revise, approve] } }`,
      `pallet: { needs: [{ from: g, when: "decision.choice == 'approve'" }] }`,
    );
    const b = buildFactory(wire, { dev: simMachine() });
    const { report } = await rehearse(b.root, { mode: 'real' });
    expect(report.status).toBe('done');
    expect(kinds(report)).toEqual(['note:gate']);
  });
});

describe('Defects and notes', () => {
  it('ends with the line stopped and says which machine, what happened and where to look', async () => {
    const b = buildFactory(line('  - { id: a, machine: a }'), { a: strictMachine({ attempts: 1, output: { ok: false } }) });
    const { report } = await rehearse(b.root, { mode: 'real' });
    expect(report.status).toBe('stopped');
    expect(find(report, 'contract')).toMatchObject({ class: 'defect', pieceId: 'a', where: expect.stringContaining('role.md') });
  });

  it('calls a rework that ran out of laps a defect', async () => {
    const wire = line(
      `  - { id: dev, machine: dev, needs: ["@intake", { from: qa, when: "verdict == 'fail'", back: true, laps: 1 }] }\n  - { id: qa, machine: qa }`,
      `pallet: { needs: [{ from: qa, when: "verdict == 'pass'" }] }`,
    );
    const b = buildFactory(wire, { dev: simMachine(), qa: checker(['fail']) });
    const { report } = await rehearse(b.root, { mode: 'real' });
    expect(report.status).toBe('stopped');
    expect(find(report, 'rework-exhausted')).toMatchObject({ class: 'defect' });
  });

  it('calls a machine that answers blocked a defect', async () => {
    const b = buildFactory(line('  - { id: a, machine: a }'), { a: simMachine({ output: { blocked: { reason: 'the shared environment is down' } } }) });
    const { report } = await rehearse(b.root, { mode: 'real' });
    expect(find(report, 'blocked')).toMatchObject({ class: 'defect', message: 'Blocked: the shared environment is down' });
    // the fire that follows a block says the same, so it is not a second finding
    expect(report.findings.filter((x) => x.pieceId === 'a')).toHaveLength(1);
  });
});

describe('The real mode', () => {
  it('runs Claude machines on Haiku with a low effort, refuses what a machine says acts outside, and takes an outward tool away', async () => {
    const claude = fakeClaude();
    const b = buildFactory(line('  - { id: a, machine: a }'), {
      a: claudeMachine({ 'machine.yaml': 'schema_version: 1\nagent: claude\nmodel: opus\neffort: max\ntools: [mcp__slack__post, mcp__jira]\noutward: [git push, mcp__slack__post]\n' }),
    });
    const { report } = await rehearse(b.root, { mode: 'real' });
    expect(report.status).toBe('done');
    const args = claude.calls()[0].args;
    const after = (flag: string) => args[args.indexOf(flag) + 1];
    expect(after('--model')).toBe('haiku');
    expect(after('--effort')).toBe('low');
    expect(after('--disallowedTools').split(',')).toEqual(expect.arrayContaining(['Bash(git push:*)', 'mcp__slack__post']));
    expect(after('--allowedTools').split(',')).toEqual(expect.arrayContaining(['mcp__jira']));
    expect(after('--allowedTools').split(',')).not.toContain('mcp__slack__post');
  });

  it('runs the signals for real, so a signal that fails is found, and not when they are skipped', async () => {
    const b = buildFactory(line('  - { id: a, machine: a }\n  - { id: check, label: Check, signal: { run: "exit 3" } }'), { a: simMachine() });
    const real = (await rehearse(b.root, { mode: 'real' })).report;
    expect(real.status).toBe('stopped');
    expect(find(real, 'fire')).toMatchObject({ class: 'defect', pieceId: 'check' });
    expect((await rehearse(b.root, { mode: 'real', skipSignals: true })).report.status).toBe('done');
  });

  it('stops dispatching once the cost passes the ceiling, and calls it a defect', async () => {
    const steps = ['a', 'b', 'c'].map((id) => `  - { id: ${id}, machine: ${id} }`).join('\n');
    const b = buildFactory(line(steps), { a: simMachine({ cost: 0.4 }), b: simMachine({ cost: 0.4 }), c: simMachine({ cost: 0.4 }) });
    const { report } = await rehearse(b.root, { mode: 'real', maxCostUsd: 0.5 });
    expect(report.status).toBe('ceiling');
    expect(report.costUsd).toBeCloseTo(0.8);
    expect(find(report, 'ceiling')).toMatchObject({ class: 'defect' });
    expect(report.pieces.map((p) => p.pieceId)).toEqual(['a', 'b', 'c']);
    expect(report.pieces[2].attempts).toBe(0);
  });

  it('has no ceiling in the simulation, which costs nothing', async () => {
    const b = buildFactory(line('  - { id: a, machine: a }'), { a: simMachine({ cost: 5 }) });
    const { report } = await rehearse(b.root, { maxCostUsd: 0.01 });
    expect(report.status).toBe('done');
  });
});

describe('Stopping and giving up', () => {
  it('ends when it is stopped, and cleans up', async () => {
    const b = buildFactory(line('  - { id: a, machine: a }'), { a: simMachine({ seconds: 600 }) });
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 150);
    // the real mode leaves a simulated machine as it is, with its long step
    const { report, copy } = await rehearse(b.root, { mode: 'real' }, { signal: stop.signal });
    expect(report.status).toBe('aborted');
    expect(fs.existsSync(copy.folder)).toBe(false);
  });

  it('gives up on a rehearsal that does not end, and says so', async () => {
    const b = buildFactory(line('  - { id: a, machine: a }'), { a: simMachine({ seconds: 600 }) });
    const { report } = await rehearse(b.root, { mode: 'real' }, { maxMs: 150 });
    expect(report.status).toBe('timeout');
    expect(find(report, 'timeout')).toMatchObject({ class: 'defect' });
  });
});

describe('The copy', () => {
  it('is a clone of the line\'s repository, so the repository itself is left alone', async () => {
    const b = buildFactory(line('  - { id: a, machine: a }'), { a: simMachine({ write: { 'A.md': 'x' }, commit: 'a' }) }, {}, true);
    const repo = path.join(b.dir, 'repo');
    const branches = () => execFileSync('git', ['branch', '--all'], { cwd: repo }).toString();
    const before = branches();
    const copy = await prepareCopy({ kind: 'disk', root: b.root }, LINE);
    expect(copy.repo).toBeDefined();
    expect(copy.repo).not.toBe(repo);
    const report = await runRehearsal(copy, req(), { sourceRoot: b.root, beltMs: 5 });
    expect(report.status).toBe('done');
    expect(branches()).toBe(before);
    expect(fs.existsSync(path.join(repo, 'A.md'))).toBe(false);
  });

  it('can come from a build-mode draft, with what the draft changed and not what the disk has', async () => {
    const b = buildFactory(line('  - { id: a, machine: a }'), { a: simMachine({ role: 'On disk.' }) });
    const draft = new Draft(b.root);
    apply(draft, { op: 'writeFile', path: 'sectors/s/models/m/machines/a/role.md', content: 'In the draft.' });
    const before = fingerprint(b.root);
    const copy = await prepareCopy({ kind: 'draft', draft }, LINE);
    expect(fs.readFileSync(path.join(copy.folder, 'sectors/s/models/m/machines/a/role.md'), 'utf8')).toBe('In the draft.');
    expect(fs.existsSync(path.join(copy.folder, '.runs'))).toBe(false);
    expect(fingerprint(b.root)).toBe(before);
    copy.cleanup();
  });

  it('refuses a draft that has problems which stop it from running', async () => {
    const b = buildFactory(line('  - { id: a, machine: a }'), { a: simMachine() });
    const draft = new Draft(b.root);
    apply(draft, { op: 'writeFile', path: 'sectors/s/models/m/line.yaml', content: 'schema_version: 1\npieces:\n  - { id: a, machine: ghost }\n' });
    await expect(prepareCopy({ kind: 'draft', draft }, LINE)).rejects.toThrow(/problems that stop it from running/);
  });
});

describe('The plan shown before it spends', () => {
  it('lists the machines with the model they will run on, the signals and what each does, the outward items and the ceiling', () => {
    const b = buildFactory(line('  - { id: a, machine: a }\n  - { id: check, label: Check, signal: { run: "make test" } }'), {
      a: claudeMachine({ 'machine.yaml': 'schema_version: 1\nagent: claude\nmodel: opus\nallow: [npm test]\noutward: [git push]\n' }),
    });
    const f = loadFactory(b.root);
    const real = planOf(f, req({ mode: 'real', maxCostUsd: 2 }), { runs: 3, medianUsd: 1.5 });
    expect(real.machines).toEqual([{ pieceId: 'a', label: 'A', agent: 'claude', model: 'haiku', allow: expect.arrayContaining(['npm test']), tools: [], outward: ['git push'], dirs: [] }]);
    expect(real.signals).toEqual([{ pieceId: 'check', label: 'Check', command: 'make test', runs: true }]);
    expect(real).toMatchObject({ maxCostUsd: 2, reference: { runs: 3, medianUsd: 1.5 }, lineName: expect.any(String) });
    const free = planOf(f, req({ mode: 'simulation', maxCostUsd: 2 }));
    expect(free.machines[0]).toMatchObject({ agent: 'sim' });
    expect(free.signals[0].runs).toBe(false);
    expect(free.maxCostUsd).toBeUndefined();
    expect(planOf(f, req({ mode: 'real', skipSignals: true })).signals[0].runs).toBe(false);
  });

  it('changes the copy of the definitions it works on, and not the factory it is given', () => {
    const b = buildFactory(line('  - { id: a, machine: a }'), { a: claudeMachine({ 'machine.yaml': 'schema_version: 1\nagent: claude\nmodel: opus\n' }) });
    const f = loadFactory(b.root);
    adapt(f, LINE, { mode: 'real' });
    expect(f.sectors[0].lines[0].model.machines.a.model).toBe('opus');
  });

  it('suggests the program and a subcommand, and the program alone when the second word is not one', () => {
    expect(suggestionFor('npm test --silent')).toBe('npm test');
    expect(suggestionFor('gh pr view 12')).toBe('gh pr');
    expect(suggestionFor('cat notes.md')).toBe('cat');
    expect(suggestionFor('git -C x status')).toBe('git');
    expect(suggestionFor('make')).toBe('make');
    // a program that runs whatever it is given is not offered bare
    expect(suggestionFor('python script.py')).toBe('python script.py');
    expect(suggestionFor('rm -rf build')).toBe('rm -rf build');
  });
});
