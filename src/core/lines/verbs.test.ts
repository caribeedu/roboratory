// Every action on a line is a verb, and each is recorded with who did it and where it came from.
import { buildFactory, eventsOf, LINE, line, simMachine, startEngine, whenState } from '../../test/harness';

describe('Verbs', () => {
  it('record the actor and, for the command line, the source next to it', async () => {
    const { f } = buildFactory(line('  - { id: a, machine: a }\n  - { id: ok, label: OK, gate: {} }'), { a: simMachine() });
    const e = startEngine(f);

    e.source = 'cli';
    const id = await e.run(LINE, {});
    e.source = undefined;
    await whenState(e, 'ok', 'holding');
    e.release(LINE, 'ok', 1);

    expect(eventsOf(e, id, 'verb').find((x) => x.verb === 'run')).toMatchObject({ actor: 'you', source: 'cli' });
    expect(eventsOf(e, id, 'verb').find((x) => x.verb === 'release')).not.toHaveProperty('source');
  });
});
