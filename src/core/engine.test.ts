import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTargetRepo } from './demo';
import { Engine, humanActions, linePlace } from './engine';
import { loadFactory } from './factory';

process.env.ROBORATORY_SIM_SPEED = '200';

function writeFiles(root: string, files: Record<string, string>) {
  for (const [rel, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), c);
    if (rel.endsWith('.sh')) fs.chmodSync(path.join(root, rel), 0o755);
  }
}

const machine = (out: string, extra = '') => ({
  'role.md': 'role',
  'contract.json': JSON.stringify({ type: 'object', required: ['ok'], properties: { ok: { const: true } } }),
  'machine.yaml': `agent: sim\nattempts: 2\nsim:\n  seconds: 1\n${extra}  output: ${out}\n`,
});
const pre = (dir: string, f: Record<string, string>) => Object.fromEntries(Object.entries(f).map(([k, v]) => [`${dir}/${k}`, v]));

/** A one-sector factory whose line is described by `lineYaml`. */
function factory(lineYaml: string, machines: Record<string, Record<string, string>>, files: Record<string, string> = {}, withRepo = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-engine-'));
  const root = path.join(dir, 'factory');
  if (withRepo) createTargetRepo(path.join(dir, 'repo'), 'repo');
  const ms = Object.entries(machines).reduce((acc, [n, f]) => ({ ...acc, ...pre(`sectors/s/models/m/machines/${n}`, f) }), {});
  writeFiles(root, {
    'factory.yaml': 'name: T\n',
    'sectors/s/sector.yaml': 'name: S\n',
    'sectors/s/lines.yaml': `lines:\n  - id: l\n    model: m\n${withRepo ? '    repo: ../repo\n' : ''}    params: { svc: orders }\n`,
    'sectors/s/models/m/line.yaml': lineYaml,
    ...ms, ...files,
  });
  const f = loadFactory(root);
  expect(f.warnings).toEqual([]);
  return { dir, root, f };
}

async function until(fn: () => boolean, ms = 8000) {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 10)); }
}

const engines: Engine[] = [];
const make = (f: ReturnType<typeof loadFactory>) => { const e = new Engine(f, { beltMs: 5 }); engines.push(e); return e; };
afterEach(() => { engines.splice(0).forEach((e) => e.dispose()); });

describe('engine', () => {
  it('runs a line end to end: chained worktrees, a signal, a two-confirmation gate and the pallet', async () => {
    const { f, dir } = factory(
      `intake: { kind: manual, inputs: [{ name: ticket, required: true }] }
pieces:
  - { id: a, machine: writer-a }
  - { id: b, machine: writer-b }
  - { id: check, signal: { run: "signals/has-b.sh {{box.ok}}" } }
  - { id: gate, gate: { confirmations: 2 } }
`,
      {
        'writer-a': machine('{ ok: true }', '  write: { A.md: "from a {{box.ticket}}" }\n  commit: "a"\n'),
        'writer-b': machine('{ ok: true }', '  write: { B.md: "from b" }\n'),
      },
      { 'sectors/s/models/m/signals/has-b.sh': '#!/bin/sh\ntest -f A.md && test -f B.md && echo "both there ($1)"\n' },
    );
    const e = make(f);
    await expect(e.run('s/l', {})).rejects.toThrow(/Missing input: ticket/);
    const runId = await e.run('s/l', { ticket: 'T-1' });
    await until(() => e.lineView('s/l').pieces.gate.state === 'holding');
    expect(() => e.release('s/l', 'gate', 1)).toThrow(/needs 2 confirmations/);
    e.release('s/l', 'gate', 2);
    await until(() => e.runSummaries()[0].status === 'done');
    const sum = e.runSummaries()[0];
    expect(sum.deliverable).toMatchObject({ ok: true });
    // b's worktree started from a's branch, and b's leftover file was committed for it
    const bDir = path.join(f.root, '.runs/s/l', runId, 'machines/b');
    expect(fs.readFileSync(path.join(bDir, 'A.md'), 'utf8')).toBe('from a T-1');
    const log = execFileSync('git', ['log', '--format=%s', `roboratory/${runId}/b`], { cwd: path.join(dir, 'repo') }).toString();
    expect(log.split('\n')[0]).toMatch(/B: work left uncommitted/);
    expect(log).toContain('a\n');
    // the broker's box file never lands in the target repository
    const files = execFileSync('git', ['ls-tree', '-r', '--name-only', `roboratory/${runId}/b`], { cwd: path.join(dir, 'repo') }).toString();
    expect(files).not.toContain('box.json');
    const types = e.runEvents(runId).map((x) => x.type);
    expect(types[0]).toBe('run.start');
    expect(types).toContain('verb');
    expect(types.at(-1)).toBe('run.end');
    expect(e.runEvents(runId).find((x) => x.type === 'verb' && x.verb === 'release')).toMatchObject({ actor: 'you', confirmations: 2 });
    expect(e.lineView('s/l').pieces['@pallet'].pallet).toBe(1);
  });

  it('sets a machine on fire when attempts run out, and a retry recovers it', async () => {
    const { f } = factory('intake: { kind: manual }\npieces:\n  - { id: inv, machine: inv }\n', {
      inv: machine('{ ok: true }', '  fail_first_run: true\n  bad_output: { ok: false }\n'),
    }, {}, false);
    const e = make(f);
    await e.run('s/l', {});
    await until(() => e.lineView('s/l').pieces.inv.state === 'fire');
    const v = e.lineView('s/l').pieces.inv;
    expect(v.error).toMatch(/2\/2 attempts used.*must be equal to constant/);
    expect(e.attention()[0]).toMatchObject({ kind: 'fire', pieceId: 'inv', severity: 3 });
    e.retry('s/l', 'inv', 'try harder');
    await until(() => e.runSummaries()[0].status === 'done');
    expect(e.attention()).toEqual([]);
  });

  it('routes on splitter belts and skips the branch not taken, even through a join', async () => {
    const { f } = factory(`intake: { kind: manual }
pieces:
  - { id: triage, machine: t }
  - { id: plan, machine: p, needs: [{ from: triage, when: "type == 'bug'" }] }
  - { id: answer, machine: a, needs: [{ from: triage, when: "type == 'question'" }] }
pallet: { needs: [plan, answer] }
`, {
      t: { ...machine('{ ok: true }'), 'contract.json': '{"type":"object"}', 'machine.yaml': 'agent: sim\nsim:\n  seconds: 1\n  output: { type: question }\n' },
      p: machine('{ ok: true }'),
      a: machine('{ ok: true, answered: yes }'),
    }, {}, false);
    const e = make(f);
    const id = await e.run('s/l', {});
    await until(() => e.runSummaries()[0].status === 'done');
    expect(e.runSummaries()[0].deliverable).toMatchObject({ answered: 'yes' });
    expect(e.runEvents(id).filter((x) => x.type === 'piece.skip').map((x) => x.piece)).toEqual(['plan']);
  });

  it('stops the line at a failing signal and holds a box whose rule does not hold', async () => {
    const { f } = factory(`intake: { kind: manual }
pieces:
  - { id: sure, gate: { rule: "confidence >= 0.7" } }
  - { id: sig, signal: { run: "echo nope; exit 3" } }
`, {}, {}, false);
    const e = make(f);
    await e.run('s/l', { confidence: 0.5 });
    await until(() => e.lineView('s/l').pieces.sure.state === 'holding');
    expect(e.lineView('s/l').pieces.sure.error).toMatch(/does not hold/);
    e.release('s/l', 'sure', 0);
    await until(() => e.lineView('s/l').pieces.sig.state === 'fire');
    expect(e.lineView('s/l').pieces.sig.error).toBe('exited with 3: nope');
    expect(e.attention()[0].kind).toBe('signal');
  });

  it('halts and resumes a line where it stands', async () => {
    const { f } = factory('intake: { kind: manual }\npieces:\n  - { id: g, gate: { confirmations: 1 } }\n', {}, {}, false);
    const e = make(f);
    e.halt('s/l');
    await e.run('s/l', {});
    await new Promise((r) => setTimeout(r, 60));
    expect(e.lineView('s/l').pieces.g.state).toBe('idle');
    e.resume('s/l');
    await until(() => e.lineView('s/l').pieces.g.state === 'holding');
  });

  it('restores the floor from run files after a restart', async () => {
    const { f, root } = factory('intake: { kind: manual }\npieces:\n  - { id: m, machine: m }\n  - { id: g, gate: { confirmations: 1 } }\n', { m: machine('{ ok: true }') }, {}, false);
    const e1 = make(f);
    const id = await e1.run('s/l', {});
    await until(() => e1.lineView('s/l').pieces.g.state === 'holding');
    e1.dispose();
    const e2 = make(loadFactory(root));
    e2.restore();
    expect(e2.lineView('s/l').pieces.g.state).toBe('holding');
    expect(e2.lineView('s/l').pieces.m.lastBox).toEqual({ ok: true });
    e2.release('s/l', 'g', 1);
    await until(() => e2.runSummaries().find((r) => r.id === id)!.status === 'done');
  });

  it('sets the next machine on fire when joined branches conflict', async () => {
    const { f } = factory(`intake: { kind: manual }
pieces:
  - { id: x, machine: x }
  - { id: y, machine: y, needs: ["@intake"] }
  - { id: z, machine: z, needs: [x, y] }
`, {
      x: machine('{ ok: true }', '  write: { README.md: "x side" }\n'),
      y: machine('{ ok: true }', '  write: { README.md: "y side" }\n'),
      z: machine('{ ok: true }'),
    });
    const e = make(f);
    await e.run('s/l', {});
    await until(() => e.lineView('s/l').pieces.z.state === 'fire');
    expect(e.lineView('s/l').pieces.z.error).toMatch(/merge conflict.*README\.md/);
  });
});

describe('engine regressions', () => {
  it('survives a reload that removes a piece while a run is in flight', async () => {
    const { f, root } = factory('intake: { kind: manual }\npieces:\n  - { id: a, machine: a }\n  - { id: g, gate: { confirmations: 1 } }\n', { a: machine('{ ok: true }') }, {}, false);
    const e = make(f);
    const errors: unknown[] = [];
    const onErr = (err: unknown) => errors.push(err);
    process.on('uncaughtException', onErr);
    await e.run('s/l', {});
    fs.writeFileSync(path.join(root, 'sectors/s/models/m/line.yaml'), 'intake: { kind: manual }\npieces:\n  - { id: a, machine: a }\n');
    e.reload(loadFactory(root));
    await until(() => e.lineView('s/l').pieces.g?.state === 'holding');
    process.off('uncaughtException', onErr);
    expect(errors).toEqual([]);
  });

  it('retries a merge conflict from scratch instead of dropping a branch', async () => {
    const { f } = factory(`intake: { kind: manual }
pieces:
  - { id: x, machine: x }
  - { id: y, machine: y, needs: ["@intake"] }
  - { id: z, machine: z, needs: [x, y] }
`, {
      x: machine('{ ok: true }', '  write: { README.md: "x side" }\n'),
      y: machine('{ ok: true }', '  write: { README.md: "y side" }\n'),
      z: machine('{ ok: true }'),
    });
    const e = make(f);
    await e.run('s/l', {});
    await until(() => e.lineView('s/l').pieces.z.state === 'fire');
    e.retry('s/l', 'z');
    await until(() => e.lineView('s/l').pieces.z.state === 'fire' && e.lineView('s/l').pieces.z.error?.includes('merge conflict') === true);
  });

  it('remembers a halted line across restarts and finishes runs started while halted', async () => {
    const { f, root } = factory('intake: { kind: manual }\npieces:\n  - { id: g, gate: { confirmations: 1 } }\n', {}, {}, false);
    const e1 = make(f);
    e1.halt('s/l');
    const id = await e1.run('s/l', {});
    e1.dispose();
    const e2 = make(loadFactory(root));
    e2.restore();
    expect(e2.lineView('s/l').halted).toBe(true);
    e2.resume('s/l');
    await until(() => e2.lineView('s/l').pieces.g.state === 'holding');
    expect(e2.lineView('s/l').pieces.g.runId).toBe(id);
  });

  it('does not count a stopped run as a delivery after a restart', async () => {
    const { f, root } = factory(`intake: { kind: manual }
pieces:
  - { id: a, machine: a, needs: [{ from: "@intake", when: "go == true" }] }
`, { a: machine('{ ok: true }') }, {}, false);
    const e1 = make(f);
    await e1.run('s/l', { go: false });
    await until(() => e1.runSummaries()[0].status === 'stopped');
    expect(e1.lineView('s/l').pieces['@pallet'].pallet).toBe(0);
    e1.dispose();
    const e2 = make(loadFactory(root));
    e2.restore();
    expect(e2.lineView('s/l').pieces['@pallet'].pallet).toBe(0);
  });
});

describe('Decision gates, return belts, culture and questions (D15, D17, D21, D23)', () => {
  it('routes a decision gate on the chosen option and hands the note to the next machine', async () => {
    const { f } = factory(`intake: { kind: manual }
pieces:
  - { id: decision, gate: { choices: [hotfix, monitor] } }
  - { id: fix, machine: fix, needs: [{ from: decision, when: "decision.choice == 'hotfix'" }] }
  - { id: watch, machine: watch, needs: [{ from: decision, when: "decision.choice == 'monitor'" }] }
pallet: { needs: [fix, watch] }
`, {
      fix: machine('{ ok: true, note: "{{box.decision.note}}" }'),
      watch: machine('{ ok: true }'),
    }, {}, false);
    const e = make(f);
    const id = await e.run('s/l', {});
    await until(() => e.lineView('s/l').pieces.decision.state === 'holding');
    expect(() => e.release('s/l', 'decision', 1, 'you', { choice: 'nuke', note: '' })).toThrow(/not one of/);
    expect(() => e.release('s/l', 'decision', 1)).toThrow(/choose/);
    e.release('s/l', 'decision', 1, 'you', { choice: 'hotfix', note: 'only orders-api' });
    await until(() => e.runSummaries()[0].status === 'done');
    expect(e.runSummaries()[0].deliverable).toMatchObject({ note: 'only orders-api' });
    expect(e.runEvents(id).filter((x) => x.type === 'piece.skip').map((x) => x.piece)).toEqual(['watch']);
    expect(e.runEvents(id).find((x) => x.verb === 'release')).toMatchObject({ choice: 'hotfix', note: 'only orders-api' });
  });

  it('sends rework back along a return belt and stops when the laps run out', async () => {
    const line = (laps: number) => `intake: { kind: manual }
pieces:
  - { id: dev, machine: dev, needs: ["@intake", { from: qa, when: "verdict == 'fail'", back: true, laps: ${laps} }] }
  - { id: qa, machine: qa }
pallet: { needs: [{ from: qa, when: "verdict == 'pass'" }] }
`;
    const qa = { ...machine('{ ok: true }'), 'contract.json': '{"type":"object","required":["verdict"]}', 'machine.yaml': 'agent: sim\nsim:\n  seconds: 1\n  outputs:\n    - { verdict: fail, why: "no test" }\n    - { verdict: pass }\n' };
    const dev = { ...machine('{ ok: true }'), 'contract.json': '{"type":"object"}', 'machine.yaml': 'agent: sim\nsim:\n  seconds: 1\n  output: { built: true, saw: "{{box.feedback.why}}" }\n' };
    const ok = factory(line(2), { dev, qa }, {}, false);
    const e = make(ok.f);
    const id = await e.run('s/l', {});
    await until(() => e.runSummaries()[0].status === 'done');
    const ev = e.runEvents(id);
    expect(ev.filter((x) => x.type === 'rework')).toHaveLength(1);
    expect(ev.filter((x) => x.type === 'piece.done' && x.piece === 'dev').map((x) => (x.box as { saw: string }).saw)).toEqual(['', 'no test']);

    const tight = factory(line(1), { dev, qa: { ...qa, 'machine.yaml': 'agent: sim\nsim:\n  seconds: 1\n  output: { verdict: fail, why: "still no test" }\n' } }, {}, false);
    const e2 = make(tight.f);
    await e2.run('s/l', {});
    await until(() => e2.lineView('s/l').pieces.dev.state === 'fire');
    expect(e2.lineView('s/l').pieces.dev.error).toMatch(/1 rework lap used/);
  });

  it('parks a machine that needs you and reruns it with your answer, without spending an attempt', async () => {
    const asker = { ...machine('{ ok: true, answer: "{{box.human_answer.answer}}" }'), 'machine.yaml': 'agent: sim\nattempts: 1\nsim:\n  seconds: 1\n  ask: { question: "Which service?", options: [orders-api, storefront], recommendation: orders-api }\n  output: { ok: true, answer: "{{box.human_answer.answer}}" }\n' };
    const { f } = factory('intake: { kind: manual }\npieces:\n  - { id: a, machine: asker }\n', { asker }, {}, false);
    const e = make(f);
    await e.run('s/l', {});
    await until(() => e.lineView('s/l').pieces.a.state === 'asking');
    expect(e.lineView('s/l').pieces.a.question).toMatchObject({ question: 'Which service?', recommendation: 'orders-api' });
    expect(e.attention()[0]).toMatchObject({ kind: 'question', pieceId: 'a' });
    e.answer('s/l', 'a', 'orders-api');
    await until(() => e.runSummaries()[0].status === 'done');
    expect(e.runSummaries()[0].deliverable).toMatchObject({ answer: 'orders-api' });
  });

  it('appends the factory and sector culture to every agent role', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'));
    const argsFile = path.join(dir, 'args.json');
    const bin = path.join(dir, 'claude');
    fs.writeFileSync(bin, `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));\nconsole.log(JSON.stringify({ type: 'result', subtype: 'success', result: '', structured_output: { ok: true } }));\n`);
    fs.chmodSync(bin, 0o755);
    process.env.ROBORATORY_CLAUDE_BIN = bin;
    const { f } = factory('intake: { kind: manual }\npieces:\n  - { id: a, machine: a }\n', {
      a: { ...machine('{ ok: true }'), 'role.md': 'I am the role.', 'machine.yaml': 'agent: claude\n' },
    }, { 'culture.md': 'Factory rule: be honest.', 'sectors/s/culture.md': 'Sector rule: Slack first.' }, false);
    const e = make(f);
    await e.run('s/l', {});
    await until(() => e.runSummaries()[0].status === 'done');
    delete process.env.ROBORATORY_CLAUDE_BIN;
    const args: string[] = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
    const role = args[args.indexOf('--append-system-prompt') + 1];
    expect(role.indexOf('I am the role.')).toBeLessThan(role.indexOf('Factory rule: be honest.'));
    expect(role.indexOf('Factory rule: be honest.')).toBeLessThan(role.indexOf('Sector rule: Slack first.'));
    const schema = JSON.parse(args[args.indexOf('--json-schema') + 1]);
    expect(JSON.stringify(schema)).toContain('needs_human');
  });
});

describe('rework regressions', () => {
  const qaSeq = (outs: string[]) => ({ ...machine('{ ok: true }'), 'contract.json': '{"type":"object","required":["verdict"]}', 'machine.yaml': `agent: sim\nsim:\n  seconds: 1\n  outputs:\n${outs.map((o) => `    - { verdict: ${o} }`).join('\n')}\n` });
  const dev = { ...machine('{ ok: true }'), 'contract.json': '{"type":"object"}', 'machine.yaml': 'agent: sim\nsim:\n  seconds: 1\n  output: { built: true }\n' };
  const loop = (laps: number, extra = '') => `intake: { kind: manual }
pieces:
  - { id: dev, machine: dev, needs: ["@intake", { from: qa, when: "verdict == 'fail'", back: true, laps: ${laps} }] }
  - { id: qa, machine: qa }
${extra}pallet: { needs: [{ from: qa, when: "verdict == 'pass'" }] }
`;

  it('survives a restart while a box is on a return belt', async () => {
    const { f, root } = factory(loop(3), { dev, qa: qaSeq(['fail', 'pass']) }, {}, false);
    const e1 = new Engine(f, { beltMs: 400 }); engines.push(e1);
    const id = await e1.run('s/l', {});
    await until(() => e1.lineView('s/l').boxes.some((b) => b.id.endsWith('<')));
    e1.dispose();
    const e2 = make(loadFactory(root));
    e2.restore();
    expect(e2.runSummaries().find((r) => r.id === id)!.status).not.toBe('stopped');
  });

  it('lets a retry continue the run after the laps run out, and keeps the fire across a restart', async () => {
    const { f, root } = factory(loop(1), { dev, qa: qaSeq(['fail', 'fail', 'pass']) }, {}, false);
    const e1 = make(f);
    const id = await e1.run('s/l', {});
    await until(() => e1.lineView('s/l').pieces.dev.state === 'fire');
    e1.dispose();
    const e2 = make(loadFactory(root));
    e2.restore();
    expect(e2.lineView('s/l').pieces.dev.state).toBe('fire');
    e2.retry('s/l', 'dev');
    await until(() => e2.runSummaries().find((r) => r.id === id)!.status !== 'running' && e2.runSummaries().find((r) => r.id === id)!.status !== 'fire');
    expect(e2.runSummaries().find((r) => r.id === id)!.status).toBe('done');
  });

  it('keeps a join input that comes from outside the reworked stretch', async () => {
    const { f } = factory(`intake: { kind: manual }
pieces:
  - { id: t, machine: dev, needs: ["@intake", { from: qa, when: "verdict == 'fail'", back: true, laps: 3 }] }
  - { id: x, machine: dev, needs: ["@intake"] }
  - { id: j, gate: { rule: "built == true" }, needs: [t, x] }
  - { id: qa, machine: qa }
pallet: { needs: [{ from: qa, when: "verdict == 'pass'" }] }
`, { dev, qa: qaSeq(['fail', 'pass']) }, {}, false);
    const e = make(f);
    await e.run('s/l', {});
    await until(() => e.runSummaries()[0].status === 'done');
  });

  it('reworks a piece once when two checkers send it back together', async () => {
    const { f } = factory(`intake: { kind: manual }
pieces:
  - { id: t, machine: dev, needs: ["@intake", { from: a, when: "verdict == 'fail'", back: true, laps: 3 }, { from: b, when: "verdict == 'fail'", back: true, laps: 3 }] }
  - { id: a, machine: qa, needs: [t] }
  - { id: b, machine: qa2, needs: [t] }
pallet: { needs: [{ from: a, when: "verdict == 'pass'" }, { from: b, when: "verdict == 'pass'" }] }
`, { dev, qa: qaSeq(['fail', 'pass']), qa2: qaSeq(['fail', 'pass']) }, {}, false);
    const e = make(f);
    const id = await e.run('s/l', {});
    await until(() => e.runSummaries()[0].status === 'done');
    expect(e.runEvents(id).filter((x) => x.type === 'piece.done' && x.piece === 't')).toHaveLength(2);
  });

  it('forgets a skip from the first lap when a reworked gate takes the other branch', async () => {
    const { f } = factory(`intake: { kind: manual }
pieces:
  - { id: dev, machine: dev, needs: ["@intake", { from: chk, when: "verdict == 'fail'", back: true, laps: 3 }] }
  - { id: g, gate: { choices: [test, skip] } }
  - { id: chk, machine: qa, needs: [{ from: g, when: "decision.choice == 'test'" }] }
  - { id: fin, machine: dev, needs: [{ from: g, when: "decision.choice == 'skip'" }, { from: chk, when: "verdict == 'pass'" }] }
pallet: { needs: [fin] }
`, { dev, qa: qaSeq(['fail']) }, {}, false);
    const e = make(f);
    const id = await e.run('s/l', {});
    await until(() => e.lineView('s/l').pieces.g.state === 'holding');
    e.release('s/l', 'g', 1, 'me', { choice: 'test', note: '' });
    await until(() => e.runEvents(id).some((x) => x.type === 'rework') && e.lineView('s/l').pieces.g.state === 'holding');
    e.release('s/l', 'g', 1, 'me', { choice: 'skip', note: '' });
    await until(() => e.runSummaries()[0].status !== 'running');
    expect(e.runSummaries()[0].status).toBe('done');
  });

  const recheck = `intake: { kind: manual }
pieces:
  - { id: dev, machine: dev }
  - { id: ci, machine: qa, needs: [dev, { from: hold, when: "decision.choice == 'recheck'", back: true, laps: 2 }] }
  - { id: green, machine: dev, needs: [{ from: ci, when: "verdict == 'pass'" }] }
  - { id: hold, gate: { choices: [recheck, accept] }, needs: [{ from: ci, when: "verdict == 'fail'" }] }
  - { id: next, machine: dev, needs: [green, { from: hold, when: "decision.choice == 'accept'" }] }
pallet: { needs: [next] }
`;

  it('runs a piece that was skipped on the first lap when the rework now reaches it', async () => {
    const { f } = factory(recheck, { dev, qa: qaSeq(['fail', 'pass']) }, {}, false);
    const e = make(f);
    const id = await e.run('s/l', {});
    await until(() => e.lineView('s/l').pieces.hold.state === 'holding');
    e.release('s/l', 'hold', 1, 'me', { choice: 'recheck', note: '' });
    await until(() => e.runSummaries()[0].status !== 'running');
    expect(e.runSummaries()[0].status).toBe('done');
    expect(e.runEvents(id).some((x) => x.type === 'piece.done' && x.piece === 'green')).toBe(true);
  });

  it('keeps that reopening across a restart', async () => {
    const { f, root } = factory(recheck, { dev, qa: qaSeq(['fail', 'pass']) }, {}, false);
    const e1 = make(f);
    const id = await e1.run('s/l', {});
    await until(() => e1.lineView('s/l').pieces.hold.state === 'holding');
    e1.release('s/l', 'hold', 1, 'me', { choice: 'recheck', note: '' });
    await until(() => e1.runEvents(id).some((x) => x.type === 'rework'));
    e1.dispose();
    const e2 = make(loadFactory(root));
    e2.restore();
    if (e2.lineView('s/l').pieces.ci.state === 'fire') e2.retry('s/l', 'ci');
    await until(() => !['running', 'fire'].includes(e2.runSummaries().find((r) => r.id === id)!.status));
    expect(e2.runSummaries().find((r) => r.id === id)!.status).toBe('done');
  });

  it('tells a machine its place in the line and the goals around it, unless the factory turns it off', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'));
    const argsFile = path.join(dir, 'args.json');
    const bin = path.join(dir, 'claude');
    fs.writeFileSync(bin, `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));\nconsole.log(JSON.stringify({ type: 'result', subtype: 'success', result: '', structured_output: { result: { ok: true } } }));\n`);
    fs.chmodSync(bin, 0o755);
    process.env.ROBORATORY_CLAUDE_BIN = bin;
    const promptFor = async (machineYaml: string, factoryYaml = 'name: T\n') => {
      const { f } = factory('intake: { kind: manual }\npieces:\n  - { id: a, label: Draft, goal: Write the first draft., machine: a }\n  - { id: b, label: Check, goal: Find what the draft gets wrong., machine: b }\n', {
        a: { ...machine('{ ok: true }'), 'machine.yaml': machineYaml },
        b: { ...machine('{ ok: true }'), 'machine.yaml': 'agent: sim\ngoal: A default goal.\n' },
      }, { 'factory.yaml': factoryYaml }, false);
      const e = make(f);
      await e.run('s/l', {});
      await until(() => fs.existsSync(argsFile));
      const args: string[] = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
      fs.rmSync(argsFile);
      return args[args.indexOf('-p') + 1];
    };
    const on = await promptFor('agent: claude\ngoal: Machine default, overridden by the line.\n');
    expect(on).toContain('Your place in the line');
    expect(on).toContain('Draft (machine) ← you → Check (machine)');
    expect(on).toContain('Your goal: Write the first draft.');
    expect(on).toContain('- Check (machine): Find what the draft gets wrong.');
    expect(await promptFor('agent: claude\n', 'name: T\nline_context: false\n')).not.toContain('Your place in the line');
    delete process.env.ROBORATORY_CLAUDE_BIN;
  });

  it('uses a machine\'s default goal where the line gives none', () => {
    const { f } = factory('intake: { kind: manual }\npieces:\n  - { id: a, label: Draft, machine: a }\n  - { id: b, label: Check, goal: Line goal wins., machine: b }\n', {
      a: { ...machine('{ ok: true }'), 'machine.yaml': 'agent: sim\ngoal: Write the first draft.\n' },
      b: { ...machine('{ ok: true }'), 'machine.yaml': 'agent: sim\ngoal: Machine default.\n' },
    }, {}, false);
    const l = f.sectors[0].lines[0];
    expect(linePlace(l, 'a')).toContain('Your goal: Write the first draft.');
    expect(linePlace(l, 'a')).toContain('- Check (machine): Line goal wins.');
  });

  it('hands claude the contract or a question nested under result, never a combinator at the root, and unwraps the answer', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'));
    const argsFile = path.join(dir, 'args.json');
    const bin = path.join(dir, 'claude');
    fs.writeFileSync(bin, `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));\nconsole.log(JSON.stringify({ type: 'result', subtype: 'success', result: '', structured_output: { result: { ok: true } } }));\n`);
    fs.chmodSync(bin, 0o755);
    process.env.ROBORATORY_CLAUDE_BIN = bin;
    const { f } = factory('intake: { kind: manual }\npieces:\n  - { id: a, machine: a }\n', { a: { ...machine('{ ok: true }'), 'machine.yaml': 'agent: claude\n' } }, {}, false);
    const e = make(f);
    await e.run('s/l', {});
    await until(() => e.runSummaries()[0].status === 'done');
    delete process.env.ROBORATORY_CLAUDE_BIN;
    const args: string[] = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
    const schema = JSON.parse(args[args.indexOf('--json-schema') + 1]);
    expect(schema.type).toBe('object');
    expect(Object.keys(schema).filter((k) => ['anyOf', 'oneOf', 'allOf'].includes(k))).toEqual([]);
    expect(schema.required).toEqual(['result']);
    expect(schema.properties.result.anyOf[0].properties.ok).toBeDefined();
    expect(schema.properties.result.anyOf[1].required).toEqual(['needs_human']);
    expect(schema.properties.result.anyOf[2].required).toEqual(['blocked']);
  });
});

describe('signals and human actions (D19, D20, D22, D26)', () => {
  it('stops a signal at its own time limit and sets it on fire, even with a return belt', async () => {
    const dev = { ...machine('{ ok: true }'), 'contract.json': '{"type":"object"}' };
    const { f } = factory(`intake: { kind: manual }
pieces:
  - { id: dev, machine: dev, needs: ["@intake", { from: sig, when: "signal == 'fail'", back: true }] }
  - { id: sig, signal: { run: "sleep 20; echo late", timeout: 300ms } }
`, { dev }, {}, false);
    expect(f.sectors[0].lines[0].model.pieces.find((p) => p.id === 'sig')).toMatchObject({ timeout: '300ms', timeoutMs: 300 });
    const e = make(f);
    await e.run('s/l', {});
    await until(() => e.lineView('s/l').pieces.sig.state === 'fire');
    expect(e.lineView('s/l').pieces.sig.error).toBe('timed out after 300ms');
  });

  it('delivers a failed signal\'s box that was on its return belt when Roboratory closed', async () => {
    const dev = { ...machine('{ ok: true }'), 'contract.json': '{"type":"object"}', 'machine.yaml': 'agent: sim\nsim:\n  seconds: 1\n  output: { built: true, saw: "{{box.feedback.signal_output}}" }\n' };
    const { f, root } = factory(`intake: { kind: manual }
pieces:
  - { id: dev, machine: dev, needs: ["@intake", { from: checks, when: "signal == 'fail'", back: true }] }
  - { id: checks, signal: { run: "signals/once.sh" } }
`, { dev }, { 'sectors/s/models/m/signals/once.sh': '#!/bin/sh\ntest -f "$ROBORATORY_RUN_DIR/once" && exit 0\ntouch "$ROBORATORY_RUN_DIR/once"; echo "lint broke"; exit 1\n' }, false);
    const e1 = new Engine(f, { beltMs: 400 }); engines.push(e1);
    const id = await e1.run('s/l', {});
    await until(() => e1.lineView('s/l').boxes.some((b) => b.id.endsWith('<')));
    e1.dispose();
    const e2 = make(loadFactory(root));
    e2.restore();
    await until(() => e2.runSummaries().find((r) => r.id === id)!.status === 'done');
    expect(e2.runEvents(id).filter((x) => x.type === 'piece.done' && x.piece === 'dev').map((x) => (x.box as { saw: string }).saw)).toEqual(['', 'lint broke\nexited with 1: lint broke']);
    expect(e2.runEvents(id).find((x) => x.type === 'piece.done' && x.piece === 'checks')).toMatchObject({ failed: true });
  });

  it('reports a signal timeout that is not a duration', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-engine-'));
    writeFiles(dir, {
      'factory.yaml': 'name: T\n', 'sectors/s/sector.yaml': 'name: S\n', 'sectors/s/lines.yaml': 'lines:\n  - { id: l, model: m }\n',
      'sectors/s/models/m/line.yaml': 'intake: { kind: manual }\npieces:\n  - { id: sig, signal: { run: "true", timeout: soon } }\n',
    });
    expect(loadFactory(dir, { tolerant: true }).problems?.map((p) => p.message)).toEqual(['signal "sig": timeout "soon" is not a duration like 90s, 40m or 2h']);
  });

  it('sends the box back when a signal fails and a return belt takes it, with what the signal printed', async () => {
    const dev = { ...machine('{ ok: true }'), 'contract.json': '{"type":"object"}', 'machine.yaml': 'agent: sim\nsim:\n  seconds: 1\n  output: { built: true, saw: "{{box.feedback.signal_output}}" }\n' };
    const { f } = factory(`intake: { kind: manual }
pieces:
  - { id: dev, machine: dev, needs: ["@intake", { from: checks, when: "signal == 'fail'", back: true, laps: 2 }] }
  - { id: checks, signal: { run: "signals/once.sh" } }
`, { dev }, { 'sectors/s/models/m/signals/once.sh': '#!/bin/sh\ntest -f "$ROBORATORY_RUN_DIR/once" && exit 0\ntouch "$ROBORATORY_RUN_DIR/once"; echo "lint broke"; exit 1\n' }, false);
    const e = make(f);
    const id = await e.run('s/l', {});
    await until(() => e.runSummaries()[0].status === 'done');
    const ev = e.runEvents(id);
    expect(ev.filter((x) => x.type === 'rework')).toMatchObject([{ from: 'checks', to: 'dev', lap: 1 }]);
    expect(ev.filter((x) => x.type === 'piece.done' && x.piece === 'dev').map((x) => (x.box as { saw: string }).saw)).toEqual(['', 'lint broke\nexited with 1: lint broke']);
    expect(e.runSummaries()[0].deliverable).toMatchObject({ built: true });
    expect(e.runSummaries()[0].deliverable).not.toHaveProperty('signal');
  });

  it('sets the machine on fire when a failing signal has used its laps', async () => {
    const dev = { ...machine('{ ok: true }'), 'contract.json': '{"type":"object"}', 'machine.yaml': 'agent: sim\nsim:\n  seconds: 1\n  output: { built: true }\n' };
    const { f } = factory(`intake: { kind: manual }
pieces:
  - { id: dev, machine: dev, needs: ["@intake", { from: checks, when: "signal == 'fail'", back: true, laps: 1 }] }
  - { id: checks, signal: { run: "echo red; exit 1" } }
`, { dev }, {}, false);
    const e = make(f);
    await e.run('s/l', {});
    await until(() => e.lineView('s/l').pieces.dev.state === 'fire');
    expect(e.lineView('s/l').pieces.dev.error).toMatch(/1 rework lap used and Checks still sends it back/);
  });

  it('sets a blocked machine on fire at once, without spending its attempts, and a retry goes on', async () => {
    const qa = { ...machine('{ ok: true }'), 'machine.yaml': 'agent: sim\nattempts: 3\nsim:\n  seconds: 1\n  outputs:\n    - { blocked: { reason: "dev-main is down" } }\n    - { ok: true }\n' };
    const { f } = factory('intake: { kind: manual }\npieces:\n  - { id: qa, machine: qa }\n', { qa }, {}, false);
    const e = make(f);
    const id = await e.run('s/l', {});
    await until(() => e.lineView('s/l').pieces.qa.state === 'fire');
    expect(e.lineView('s/l').pieces.qa.error).toBe('Blocked: dev-main is down');
    expect(e.runEvents(id).filter((x) => x.type === 'piece.start')).toHaveLength(1);
    e.retry('s/l', 'qa', 'it is back');
    await until(() => e.runSummaries()[0].status === 'done');
  });

  it('counts a retry and an answer as the same pass of a machine', async () => {
    const asker = { ...machine('{ ok: true }'), 'machine.yaml': 'agent: sim\nattempts: 1\nsim:\n  seconds: 1\n  fail_first_run: true\n  bad_output: { ok: false }\n  ask: { question: "Which?" }\n  output: { ok: true }\n' };
    const { f } = factory('intake: { kind: manual }\npieces:\n  - { id: a, label: Work, machine: asker }\n', { asker }, {}, false);
    const e = make(f);
    const id = await e.run('s/l', {});
    await until(() => e.lineView('s/l').pieces.a.state === 'asking');
    e.answer('s/l', 'a', 'this one');
    await until(() => e.lineView('s/l').pieces.a.state === 'fire');
    e.retry('s/l', 'a', 'try again');
    await until(() => e.runSummaries()[0].status === 'done');
    const run = (e as unknown as { runs: Map<string, Parameters<typeof humanActions>[0]> }).runs.get(id)!;
    expect(humanActions(run).split('\n').slice(1)).toEqual([
      '- Work, pass 1: asked "Which?"; the human answered "this one".',
      '- Work, pass 1: the human retried it with the hint "try again".',
    ]);
  });

  it('lists the human actions of the run, in order, with the pass they were on', async () => {
    const plan = { ...machine('{ ok: true }'), 'contract.json': '{"type":"object"}', 'machine.yaml': 'agent: sim\nsim:\n  seconds: 1\n  output: { plan: v }\n' };
    const { f } = factory(`intake: { kind: manual }
pieces:
  - { id: plan, machine: plan, needs: ["@intake", { from: ok, when: "decision.choice == 'revise'", back: true }] }
  - { id: ok, label: Approve, gate: { choices: [approve, revise] } }
pallet: { needs: [{ from: ok, when: "decision.choice == 'approve'" }] }
`, { plan }, {}, false);
    const e = make(f);
    const id = await e.run('s/l', {});
    await until(() => e.lineView('s/l').pieces.ok.state === 'holding');
    e.release('s/l', 'ok', 1, 'you', { choice: 'revise', note: 'use v2' });
    await until(() => e.lineView('s/l').pieces.ok.state === 'holding' && e.runEvents(id).filter((x) => x.type === 'piece.hold').length === 2);
    e.release('s/l', 'ok', 1, 'you', { choice: 'approve' });
    await until(() => e.runSummaries()[0].status === 'done');
    const run = (e as unknown as { runs: Map<string, Parameters<typeof humanActions>[0]> }).runs.get(id)!;
    expect(humanActions(run)).toBe([
      'What the human decided in this run so far, in order. Treat it as fact:',
      '- Approve, pass 1: the human chose "revise" with the note "use v2".',
      '- Approve, pass 2: the human chose "approve".',
    ].join('\n'));
  });
});
