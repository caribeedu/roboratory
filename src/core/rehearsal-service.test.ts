// The rehearsal as the engine offers it to the window and the command (D48): a verb that is audited and needs a yes to spend, a plan before it
// starts, the draft as a source, one at a time, and a stop.
import fs from 'node:fs';
import path from 'node:path';
import { buildFactory, LINE, line, simMachine, until } from '../test/harness';
import type { RehearsalProgress, RehearsalRequest } from '../shared/types';
import { FactoryService } from './service';

const req = (over: Partial<RehearsalRequest> = {}): RehearsalRequest => ({ lineId: LINE, input: {}, mode: 'simulation', source: 'disk', ...over });

function open(lineYaml: string, machines: Record<string, Record<string, string>>) {
  const b = buildFactory(lineYaml, machines);
  const progress: RehearsalProgress[] = [];
  const svc = new FactoryService({ snapshot: () => {}, logs: () => {}, messages: () => {}, rehearsal: (p) => progress.push(p) });
  svc.open(b.root);
  return { b, svc, progress };
}

describe('A rehearsal asked of the engine', () => {
  it('refuses to spend without a yes, and says why', async () => {
    const { svc } = open(line('  - { id: a, machine: a }'), { a: simMachine() });
    await expect(svc.rehearse(req({ mode: 'real' }))).rejects.toThrow(/spends money/);
    // and without a ceiling above zero, however it is asked
    await expect(svc.rehearse(req({ mode: 'real', approved: true }))).rejects.toThrow(/cost ceiling/);
    expect((await svc.rehearse(req({ mode: 'real', approved: true, maxCostUsd: 0.5 }))).status).toBe('done');
    svc.close();
  });

  it('refuses a draft when build mode is not open, and a required input nobody gave in the real mode', async () => {
    const { svc } = open(line('  - { id: a, machine: a }'), { a: simMachine() });
    await expect(svc.rehearse(req({ source: 'draft' }))).rejects.toThrow(/Build mode is not open/);
    svc.close();
    const needs = open(line('  - { id: a, machine: a }').replace('intake: { kind: manual }', 'intake: { kind: manual, inputs: [{ name: ticket, required: true }] }'), { a: simMachine() });
    await expect(needs.svc.rehearse(req({ mode: 'real', approved: true, maxCostUsd: 0.5 }))).rejects.toThrow(/Missing input: ticket/);
    // in the simulation it is filled in, as the dry run always did
    expect((await needs.svc.rehearse(req())).status).toBe('done');
    needs.svc.close();
  });

  it('is audited as a verb of yours, with the mode and where the factory came from', async () => {
    const { b, svc } = open(line('  - { id: a, machine: a }'), { a: simMachine() });
    await svc.rehearse(req());
    const audit = fs.readFileSync(path.join(b.root, '.runs', 's', 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(audit).toEqual([expect.objectContaining({ verb: 'rehearse', actor: 'you', lineId: LINE, mode: 'simulation', from: 'disk' })]);
    svc.close();
  });

  it('pushes its progress as the pieces change, and the last one has the findings', async () => {
    const { svc, progress } = open(line('  - { id: a, machine: a }\n  - { id: ok, gate: {} }'), { a: simMachine({ requests: ['npm test'] }) });
    await svc.rehearse(req({ mode: 'real', approved: true, maxCostUsd: 0.5 }));
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.some((p) => p.pieces.a === 'busy')).toBe(true);
    expect(progress.at(-1)!.findings.map((f) => f.kind)).toEqual(expect.arrayContaining(['uncovered-command', 'gate']));
    svc.close();
  });

  it('rehearses the build-mode draft, with what it changed and not what the disk has, and leaves the disk and the draft as they were', async () => {
    const { b, svc } = open(line('  - { id: a, machine: a }'), { a: simMachine() });
    await svc.buildStart('s');
    // the draft makes the machine ask for a command; the disk does not
    await svc.buildApply({ op: 'writeFile', path: 'sectors/s/models/m/machines/a/machine.yaml', content: 'schema_version: 1\nagent: sim\nsim:\n  seconds: 1\n  requests: ["npm test"]\n  output: { ok: true }\n' });
    const disk = fs.readFileSync(path.join(b.root, 'sectors/s/models/m/machines/a/machine.yaml'), 'utf8');

    const fromDraft = await svc.rehearse(req({ mode: 'real', approved: true, maxCostUsd: 0.5, source: 'draft' }));
    expect(fromDraft.findings.map((f) => f.kind)).toContain('uncovered-command');
    const fromDisk = await svc.rehearse(req({ mode: 'real', approved: true, maxCostUsd: 0.5, source: 'disk' }));
    expect(fromDisk.findings.map((f) => f.kind)).not.toContain('uncovered-command');
    expect(fs.readFileSync(path.join(b.root, 'sectors/s/models/m/machines/a/machine.yaml'), 'utf8')).toBe(disk);
    expect(svc.buildOpen).toBe(true);
    svc.close();
  });

  it('ends a rehearsal that is running when the factory is closed', async () => {
    const { svc } = open(line('  - { id: a, machine: a }'), { a: simMachine({ seconds: 600 }) });
    const running = svc.rehearse(req({ mode: 'real', approved: true, maxCostUsd: 0.5 }));
    await until(() => svc.rehearsalRunning);
    svc.close();
    expect((await running).status).toBe('aborted');
  });

  it('runs one at a time, and a stop ends the one that runs', async () => {
    const { svc } = open(line('  - { id: a, machine: a }'), { a: simMachine({ seconds: 600 }) });
    const first = svc.rehearse(req({ mode: 'real', approved: true, maxCostUsd: 0.5 }));
    await until(() => svc.rehearsalRunning);
    await expect(svc.rehearse(req({ mode: 'real', approved: true, maxCostUsd: 0.5 }))).rejects.toThrow(/already running/);
    svc.rehearsalStop();
    expect((await first).status).toBe('aborted');
    expect(svc.rehearsalRunning).toBe(false);
    svc.close();
  });
});

describe('The plan before it spends', () => {
  it('names what a real run of the line has cost, as a median, when there have been runs', async () => {
    const { svc } = open(line('  - { id: a, machine: a }'), { a: simMachine({ cost: 0.2 }) });
    expect(svc.rehearsalPlan(req({ mode: 'real' })).reference).toBeUndefined();
    const e = svc.engine!;
    await e.run(LINE, {});
    await e.run(LINE, {});
    await until(() => e.runSummaries().every((r) => r.status === 'done') && e.runSummaries().length === 2);
    const plan = svc.rehearsalPlan(req({ mode: 'real', maxCostUsd: 1 }));
    expect(plan.reference).toEqual({ runs: 2, medianUsd: expect.closeTo(0.2, 5) });
    expect(plan).toMatchObject({ maxCostUsd: 1, mode: 'real', machines: [expect.objectContaining({ pieceId: 'a' })] });
    svc.close();
  });
});
