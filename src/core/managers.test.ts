import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDemoFactory } from './demo';
import { Engine } from './engine';
import { loadFactory } from './factory';
import { autoAllowance, Managers } from './managers';

process.env.PROMPTORY_SIM_SPEED = '200';

async function until(fn: () => boolean, ms = 8000) {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); }
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptory-mgr-'));
  const root = createDemoFactory(path.join(dir, 'factory'), path.join(dir, 'repos'));
  let f = loadFactory(root);
  const e = new Engine(f, { beltMs: 5 });
  const m = new Managers(() => f, () => e, () => {});
  return { root, e, m, reload: () => { f = loadFactory(root); return f; } };
}

describe('policy', () => {
  it('takes the stricter of sector policy and factory ceiling, and never automates release or apply', () => {
    expect(autoAllowance({ retry: { auto: 3 } }, { retry: { auto: 1 } }, 'retry')).toBe(1);
    expect(autoAllowance({}, { retry: { auto: 2 } }, 'retry')).toBe(0);
    expect(autoAllowance({ release: { auto: 9 } }, { release: { auto: 9 } }, 'release')).toBe(0);
    expect(autoAllowance({ apply: { auto: 9 } }, { apply: { auto: 9 } }, 'apply')).toBe(0);
  });
});

describe('managers', () => {
  it('diagnoses a fire and proposes a retry as a button when the sector allows nothing alone', async () => {
    const { e, m } = setup();
    await e.run('incidents/orders-api', { alert: 'ALT-1' });
    await until(() => e.lineView('incidents/orders-api').pieces.investigate.state === 'fire');
    const reply = await m.ask({ kind: 'sector', sectorId: 'incidents' }, 'why is it burning?');
    expect(reply.text).toMatch(/Investigate on orders-api incidents stopped/);
    expect(reply.evidence![0]).toMatchObject({ pieceId: 'investigate' });
    const p = reply.proposals![0];
    expect(p).toMatchObject({ kind: 'verb', verb: 'retry', status: 'open', target: { lineId: 'incidents/orders-api', pieceId: 'investigate' } });
    await m.execute(p, 'you');
    await until(() => e.lineView('incidents/orders-api').pieces.confident.state !== 'idle' || e.lineView('incidents/orders-api').pieces.signoff.state === 'holding');
  });

  it('runs an allowed verb on its own, within the policy limit', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptory-mgr-'));
    const root = createDemoFactory(path.join(dir, 'factory'), path.join(dir, 'repos'));
    fs.appendFileSync(path.join(root, 'shared/machines/triager/machine.yaml'), '  fail_first_run: true\n  bad_output: { ticket: 1 }\n');
    const f = loadFactory(root);
    const e = new Engine(f, { beltMs: 5 });
    const m = new Managers(() => f, () => e, () => {});
    await e.run('engineering/orders-api', { ticket: 'T-9' });
    await until(() => e.lineView('engineering/orders-api').pieces.triage.state === 'fire');
    // engineering allows 1 automatic retry and the ceiling allows 2: the manager acts alone once
    const first = await m.ask({ kind: 'sector', sectorId: 'engineering' }, 'what happened?');
    expect(first.proposals![0].status).toBe('auto');
    expect(e.runEvents(e.runSummaries()[0].id).find((x) => x.verb === 'retry')).toMatchObject({ actor: 'Engineering manager (policy 1/1)' });
    await until(() => e.lineView('engineering/orders-api').pieces.triage.state !== 'fire');
    e.dispose();
  });

  it('proposes a sector-local patch; accepting it only writes the file', async () => {
    const { root, m } = setup();
    const reply = await m.ask({ kind: 'sector', sectorId: 'incidents' }, 'add a smoke signal please');
    const p = reply.proposals![0];
    expect(p.kind).toBe('patch');
    expect(p.files![0].path).toBe('sectors/incidents/models/triage-to-mitigation/line.yaml');
    m.applyPatch({ kind: 'sector', sectorId: 'incidents' }, reply.id, p.id);
    expect(fs.readFileSync(path.join(root, p.files![0].path), 'utf8')).toContain('id: smoke');
    expect(m.messages({ kind: 'sector', sectorId: 'incidents' }).at(-1)!.proposals![0].status).toBe('applied');
  });

  it('lets the General Manager build a whole sector', async () => {
    const { m, reload } = setup();
    const reply = await m.ask({ kind: 'factory' }, 'build a sector called Support');
    m.applyPatch({ kind: 'factory' }, reply.id, reply.proposals![0].id);
    const f = reload();
    expect(f.warnings).toEqual([]);
    expect(f.sectors.map((s) => s.id)).toContain('support');
  });

  it('keeps each sector conversation across restarts', async () => {
    const { m, root, e } = setup();
    await m.ask({ kind: 'sector', sectorId: 'releases' }, 'status?');
    const m2 = new Managers(() => loadFactory(root), () => e, () => {});
    expect(m2.messages({ kind: 'sector', sectorId: 'releases' }).map((x) => x.from)).toEqual(['you', 'manager']);
    expect(m2.messages({ kind: 'sector', sectorId: 'incidents' })).toEqual([]);
  });
});

describe('manager regressions', () => {
  it('enforces policy limits for verbs without a run, and reports a failed run proposal', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptory-mgr-'));
    const root = createDemoFactory(path.join(dir, 'factory'), path.join(dir, 'repos'));
    fs.writeFileSync(path.join(root, 'sectors/releases/sector.yaml'), 'name: Releases\npolicy:\n  run: { auto: 1 }\nmanager:\n  agent: sim\n');
    const f = loadFactory(root);
    const e = new Engine(f, { beltMs: 5 });
    const m = new Managers(() => f, () => e, () => {});
    const a = await m.ask({ kind: 'sector', sectorId: 'releases' }, 'start a run please');
    const b = await m.ask({ kind: 'sector', sectorId: 'releases' }, 'start a run please');
    expect(a.proposals![0].status).toBe('auto');
    expect(b.proposals![0].status).toBe('open');
    expect(e.runSummaries()).toHaveLength(1);
    const bad = { ...b.proposals![0], args: {} };
    await expect(m.execute(bad, 'you')).rejects.toThrow(/Missing input/);
    e.dispose();
  });
});
