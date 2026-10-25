// What a machine may run (D44): the lists in the files, as the agent's CLI receives them. The agent here is the real
// Claude adapter pointed at a fake CLI, so these tests read the rules the CLI would have been started with.
import { buildFactory, claudeMachine, fakeClaude, LINE, line, startEngine, whenDone } from '../../test/harness';

/** The rules of the first machine of a one-machine line: what the CLI may use, and what it must never use. */
async function rulesOf(machine: Record<string, string>, files: Record<string, string> = {}, lineHead = '') {
  const claude = fakeClaude();
  const { f } = buildFactory(`${lineHead}${line('  - { id: a, machine: a }')}`, { a: claudeMachine(machine) }, files);
  const e = startEngine(f);
  await e.run(LINE, {});
  await whenDone(e);
  const { args, prompt } = claude.calls()[0];
  const after = (flag: string) => args[args.indexOf(flag) + 1];
  return { allowed: after('--allowedTools').split(','), denied: after('--disallowedTools').split(','), tools: after('--tools'), prompt };
}

describe('What a machine may run', () => {
  it('starts with the file tools and the local git commands, and git push is not among them', async () => {
    const { allowed, prompt } = await rulesOf({});
    expect(allowed).toEqual(expect.arrayContaining(['Read', 'Edit', 'Write', 'Bash(git commit:*)', 'Bash(git status:*)']));
    expect(allowed).not.toContain('Bash(git:*)');
    expect(allowed).not.toContain('Bash(git push:*)');
    expect(prompt).not.toContain('`git push`');
  });

  it('adds the commands its own allow lists, as prefixes or in the older Bash(...) form', async () => {
    const { allowed } = await rulesOf({ 'machine.yaml': 'agent: claude\nallow: ["npm test", "Bash(gh pr view:*)", "git push"]\n' });
    expect(allowed).toEqual(expect.arrayContaining(['Bash(npm test:*)', 'Bash(gh pr view:*)', 'Bash(git push:*)']));
  });

  it('is denied what the factory, the sector, the line and the machine each deny, added together', async () => {
    const { denied } = await rulesOf(
      { 'machine.yaml': 'agent: claude\ndeny: [rm -rf]\n' },
      { 'factory.yaml': 'name: T\ndeny: [sudo]\n', 'sectors/s/sector.yaml': 'name: S\ndeny: ["gh pr merge"]\n' },
      'deny: [make clean]\n',
    );
    expect(denied).toEqual(expect.arrayContaining(['Agent', 'Bash(sudo:*)', 'Bash(gh pr merge:*)', 'Bash(make clean:*)', 'Bash(rm -rf:*)']));
  });

  it('has no file tools when it is read-only, keeps its shell, and is denied git push whatever it lists', async () => {
    const { allowed, denied, tools } = await rulesOf({ 'machine.yaml': 'agent: claude\nread_only: true\nallow: [git push, gh pr view]\n' });
    expect(tools).toBe('Read,Grep,Glob,Bash');
    expect(allowed).not.toContain('Edit');
    expect(allowed).not.toContain('Bash(git commit:*)');
    expect(allowed).toEqual(expect.arrayContaining(['Bash(git diff:*)', 'Bash(gh pr view:*)']));
    expect(denied).toEqual(expect.arrayContaining(['Bash(git push:*)', 'Edit', 'Write']));
  });
});
