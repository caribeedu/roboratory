// A command outside a machine's list waits for a person (D44): the machine is working, not broken, you allow it once or
// refuse it with a reason, and what the factory never allows is refused without asking. The agent here is the
// simulated one, which tries the commands it is given and stops with the refusal when one is denied.
import fs from 'node:fs';
import path from 'node:path';
import { buildFactory, eventsOf, LINE, line, restartEngine, simMachine, startEngine, stateOf, until, whenDone, whenState, errorOf, type SimSpec } from '../../test/harness';

type Engine = ReturnType<typeof startEngine>;
const asks = (e: Engine) => e.attention().filter((a) => a.kind === 'permission');

async function runWith(spec: SimSpec, o: { machineYaml?: string; files?: Record<string, string>; lineHead?: string } = {}) {
  const machine = simMachine({ requests: ['npm test'], stopIfDenied: true, ...spec });
  if (o.machineYaml) machine['machine.yaml'] = machine['machine.yaml'] + o.machineYaml;
  const { f } = buildFactory(`${o.lineHead ?? ''}${line('  - { id: a, machine: a }')}`, { a: machine }, o.files);
  const e = startEngine(f);
  const runId = await e.run(LINE, {});
  return { e, runId };
}

describe('A command outside the list', () => {
  it('waits for you while the machine stays at work, and goes on once you allow it', async () => {
    const { e, runId } = await runWith({});
    await until(() => asks(e).length === 1);
    const [ask] = asks(e);
    expect(ask).toMatchObject({ kind: 'permission', pieceId: 'a', severity: 3, detail: expect.stringContaining('npm test') });
    expect(stateOf(e, 'a')).toBe('busy');
    expect(e.runSummaries()[0].status).toBe('running');
    expect(e.lineView(LINE).pieces.a.permissions).toEqual([expect.objectContaining({ summary: 'npm test' })]);

    e.allow(ask.requestId!);
    await whenDone(e);
    expect(asks(e)).toEqual([]);
    expect(eventsOf(e, runId, 'permission.request')).toHaveLength(1);
    expect(eventsOf(e, runId, 'verb').find((v) => v.verb === 'allow')).toMatchObject({ actor: 'you', piece: 'a', command: 'npm test' });
    expect(eventsOf(e, runId, 'permission.decision')[0]).toMatchObject({ decision: 'allow' });
  });

  it('is refused with your reason, which is what the agent is told', async () => {
    const { e } = await runWith({});
    await until(() => asks(e).length === 1);
    e.deny(asks(e)[0].requestId!, 'Not on this line: ask the platform team (code 7431).');
    await whenState(e, 'a', 'fire');
    expect(errorOf(e, 'a')).toContain('Blocked: Not on this line: ask the platform team (code 7431).');
  });

  it('is refused with a plain message when you give no reason', async () => {
    const { e } = await runWith({});
    await until(() => asks(e).length === 1);
    e.deny(asks(e)[0].requestId!);
    await whenState(e, 'a', 'fire');
    expect(errorOf(e, 'a')).toContain('A person denied this command.');
  });

  it('sits in the queue ahead of a gate, with the priority of a fire', async () => {
    const { f } = buildFactory(line('  - { id: a, machine: a }\n  - { id: g, gate: { confirmations: 1 } }\n  - { id: b, machine: b }'), {
      a: simMachine({ output: { ok: true } }), b: simMachine({ requests: ['npm test'] }),
    });
    const e = startEngine(f);
    await e.run(LINE, {});
    await whenState(e, 'g', 'holding');
    e.release(LINE, 'g', 1);
    await until(() => asks(e).length === 1);
    await e.run(LINE, {});
    await whenState(e, 'g', 'holding');
    expect(e.attention().map((a) => a.kind)).toEqual(['permission', 'gate']);
  });

  it('is not asked about when a list covers it', async () => {
    const { e } = await runWith({}, { machineYaml: 'allow: ["npm test"]\n' });
    await whenDone(e);
    expect(eventsOf(e, e.runSummaries()[0].id, 'permission.request')).toEqual([]);
  });

  it('is asked about for each command of a compound one that the list does not cover', async () => {
    const { e } = await runWith({ requests: ['npm test && curl example.com'] }, { machineYaml: 'allow: ["npm test"]\n' });
    await until(() => asks(e).length === 1);
    expect(asks(e)[0].detail).toContain('npm test && curl example.com');
    e.allow(asks(e)[0].requestId!);
    await whenDone(e);
  });

  it('keeps the machine from being asked about the local git commands, and asks about git push', async () => {
    const { e } = await runWith({ requests: ['git status', 'git -C . commit -m x', 'git push origin main'] });
    await until(() => asks(e).length === 1);
    expect(asks(e)[0].detail).toContain('git push origin main');
    e.allow(asks(e)[0].requestId!);
    await whenDone(e);
    const run = e.runSummaries()[0].id;
    expect(eventsOf(e, run, 'permission.request').map((r) => r.summary)).toEqual(['git push origin main']);
  });

  it('can be answered while the engine waits to restart, so the machine can finish', async () => {
    const { e } = await runWith({});
    await until(() => asks(e).length === 1);
    e.pauseDispatch();
    e.allow(asks(e)[0].requestId!);
    await whenDone(e);
  });

  it('is asked again when the machine is retried after the engine was killed while it waited', async () => {
    const machine = simMachine({ requests: ['npm test'], stopIfDenied: true });
    const { f, root } = buildFactory(line('  - { id: a, machine: a }'), { a: machine });
    const e = startEngine(f);
    const runId = await e.run(LINE, {});
    await until(() => asks(e).length === 1);

    e.dispose();
    const again = restartEngine(root);
    expect(asks(again)).toEqual([]);
    again.retry(LINE, 'a', '');
    await until(() => asks(again).length === 1);
    again.allow(asks(again)[0].requestId!);
    await whenDone(again, runId);
  });

  it('is unknown once it has been answered', async () => {
    const { e } = await runWith({});
    await until(() => asks(e).length === 1);
    const id = asks(e)[0].requestId!;
    e.allow(id);
    expect(() => e.deny(id)).toThrow(/No permission request/);
    await whenDone(e);
  });
});

describe('What the factory never allows', () => {
  const hard = { files: { 'factory.yaml': 'name: T\ndeny: [rm -rf]\n' } };

  it('is refused at once, without asking you, and the agent is told the factory forbids it', async () => {
    const { e, runId } = await runWith({ requests: ['rm -rf build'] }, hard);
    await whenState(e, 'a', 'fire');
    expect(errorOf(e, 'a')).toContain('Forbidden by this factory: "rm -rf"');
    expect(asks(e)).toEqual([]);
    expect(eventsOf(e, runId, 'permission.denied')[0]).toMatchObject({ summary: 'rm -rf build', by: 'rm -rf' });
  });

  it('holds when git is walked around with its options, even for a machine that may run all of git', async () => {
    const { e } = await runWith({ requests: ['git -C ../other push --force origin main'] }, {
      files: { 'factory.yaml': 'name: T\ndeny: [git push --force]\n' }, machineYaml: 'allow: [git]\n',
    });
    await whenState(e, 'a', 'fire');
    expect(errorOf(e, 'a')).toContain('"git push --force"');
  });

  it('can be added to by the sector, the line and the machine, never taken back', async () => {
    for (const where of ['sector', 'line', 'machine']) {
      const { e } = await runWith({ requests: ['make clean'] }, {
        machineYaml: where === 'machine' ? 'deny: [make clean]\n' : '',
        files: where === 'sector' ? { 'sectors/s/sector.yaml': 'name: S\ndeny: [make clean]\n' } : {},
        lineHead: where === 'line' ? 'deny: [make clean]\n' : '',
      });
      await whenState(e, 'a', 'fire');
      expect(errorOf(e, 'a')).toContain('"make clean"');
    }
    // the machine lists it as allowed, and the factory's denial still wins
    const { e } = await runWith({ requests: ['rm -rf x'] }, { ...hard, machineYaml: 'allow: [rm -rf]\n' });
    await whenState(e, 'a', 'fire');
    expect(errorOf(e, 'a')).toContain('Forbidden by this factory');
  });

  it('includes git push for a read-only machine, whatever it lists, while its other commands run', async () => {
    const { e } = await runWith({ requests: ['gh pr view 1', 'git push origin main'] }, { machineYaml: 'read_only: true\nallow: [gh pr view, git push]\n' });
    await whenState(e, 'a', 'fire');
    expect(errorOf(e, 'a')).toContain('"git push"');
    expect(asks(e)).toEqual([]);
  });

  it('keeps a read-only machine from writing files, where another machine writes them', async () => {
    const wrote = async (machineYaml: string) => {
      const { e, runId } = await runWith({ requests: [], write: { 'out.txt': 'x' } }, { machineYaml });
      await whenDone(e);
      return fs.existsSync(path.join(e.runs.get(runId)!.dir, 'machines', 'a', 'out.txt'));
    };
    expect(await wrote('')).toBe(true);
    expect(await wrote('read_only: true\n')).toBe(false);
  });
});
