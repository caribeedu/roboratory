// What an agent is given: its role with the culture of the factory and the sector, its place in the line, and a contract
// it can answer or ask a question about. The agent here is the real Claude adapter pointed at a fake CLI, so these
// tests read what the CLI would have received.
import { buildFactory, claudeMachine, fakeClaude, LINE, line, simMachine, startEngine, whenDone } from '../../test/harness';

describe('What an agent is given', () => {
  it('a role that starts with its own, then the factory culture, then the sector culture', async () => {
    const claude = fakeClaude();
    const { f } = buildFactory(line('  - { id: a, machine: a }'), { a: claudeMachine({ 'role.md': 'I am the role.' }) }, {
      'culture.md': 'Factory rule: be honest.', 'sectors/s/culture.md': 'Sector rule: Slack first.',
    });
    const e = startEngine(f);
    await e.run(LINE, {});
    await whenDone(e);

    const { role } = claude.calls()[0];
    expect(role.indexOf('I am the role.')).toBeLessThan(role.indexOf('Factory rule: be honest.'));
    expect(role.indexOf('Factory rule: be honest.')).toBeLessThan(role.indexOf('Sector rule: Slack first.'));
  });

  describe('its place in the line', () => {
    /** The prompt the first machine receives, in a two-machine line whose second machine has a goal of its own. */
    const promptFor = async (o: { lineGoal?: boolean; machineYaml?: string; factoryYaml?: string }) => {
      const claude = fakeClaude();
      const goal = o.lineGoal ? 'goal: Write the first draft., ' : '';
      const { f } = buildFactory(
        line(`  - { id: a, label: Draft, ${goal}machine: a }\n  - { id: b, label: Check, goal: Find what the draft gets wrong., machine: b }`),
        { a: claudeMachine({ 'machine.yaml': o.machineYaml ?? 'agent: claude\n' }), b: simMachine({ goal: 'A default goal.' }) },
        { 'factory.yaml': o.factoryYaml ?? 'name: T\n' },
      );
      const e = startEngine(f);
      await e.run(LINE, {});
      await whenDone(e);
      return claude.calls()[0].prompt;
    };

    it("names its neighbours and the goals around it, the line's goal winning over the machine default", async () => {
      const prompt = await promptFor({ lineGoal: true, machineYaml: 'agent: claude\ngoal: Machine default, overridden by the line.\n' });
      expect(prompt).toContain('Your place in the line');
      expect(prompt).toContain('Draft (machine) ← you → Check (machine)');
      expect(prompt).toContain('Your goal: Write the first draft.');
      expect(prompt).toContain('- Check (machine): Find what the draft gets wrong.');
      expect(prompt).not.toContain('Machine default, overridden');
    });

    it("uses the machine's default goal where the line gives none", async () => {
      const prompt = await promptFor({ machineYaml: 'agent: claude\ngoal: Write the first draft.\n' });
      expect(prompt).toContain('Your goal: Write the first draft.');
    });

    it('leaves it out when the factory turns line context off', async () => {
      expect(await promptFor({ factoryYaml: 'name: T\nline_context: false\n' })).not.toContain('Your place in the line');
    });
  });

  describe('its contract', () => {
    it('is the contract or a question or a block nested under `result`, never a combinator at the root of the schema', async () => {
      const claude = fakeClaude();
      const { f } = buildFactory(line('  - { id: a, machine: a }'), { a: claudeMachine({ 'contract.json': '{"type":"object","properties":{"ok":{"type":"boolean"}}}' }) });
      const e = startEngine(f);
      await e.run(LINE, {});
      await whenDone(e);

      const { schema } = claude.calls()[0];
      expect(schema.type).toBe('object');
      expect(Object.keys(schema).filter((k) => ['anyOf', 'oneOf', 'allOf'].includes(k))).toEqual([]);
      expect(schema.required).toEqual(['result']);
      expect(schema.properties.result.anyOf[0].properties.ok).toBeDefined();
      expect(schema.properties.result.anyOf[1].required).toEqual(['needs_human']);
      expect(schema.properties.result.anyOf[2].required).toEqual(['blocked']);
    });
  });
});
