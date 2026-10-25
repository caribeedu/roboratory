import { decideShell, effectiveRules, parseCommand, prefixOf, type Rules } from './permissions';

const rules = (allow: string[], deny: string[] = []): Rules => ({ allow, deny });

describe('Reading a shell command', () => {
  it('splits a compound command into the parts it runs, outside quotes only', () => {
    expect(parseCommand('npm test && echo "a; b" | tee out.txt; ls')).toEqual([['npm', 'test'], ['echo', 'a; b'], ['tee', 'out.txt'], ['ls']]);
    expect(parseCommand("echo 'a && b'\ngit status")).toEqual([['echo', 'a && b'], ['git', 'status']]);
  });

  it.each([
    ['a substitution', 'echo $(git push)'],
    ['a substitution inside double quotes', 'echo "$(whoami)"'],
    ['backticks', 'echo `whoami`'],
    ['a subshell', '(cd x && make)'],
    ['a here-document', 'cat <<EOF'],
    ['a redirect to a file', 'echo hi > out.txt'],
    ['an input redirect', 'sort < in.txt'],
    ['a variable assignment', 'R=1; ls'],
    ['a command held in a variable', '$CMD arg'],
    ['a quote left open', 'echo "oops'],
  ])('cannot account for %s', (_, cmd) => {
    expect(parseCommand(cmd)).toBeNull();
  });

  it('lets output go to another stream or to /dev/null', () => {
    expect(parseCommand('make 2>&1 | head')).toEqual([['make'], ['head']]);
    expect(parseCommand('npm test >/dev/null 2>&1')).toEqual([['npm', 'test']]);
    expect(parseCommand('npm test &> /dev/null')).toEqual([['npm', 'test']]);
  });
});

describe('Deciding a shell command', () => {
  it('allows it when every part starts with a listed prefix, at a word boundary', () => {
    const r = rules(['npm test', 'git status']);
    expect(decideShell('npm test -- --watch=false', r)).toEqual({ verdict: 'allow' });
    expect(decideShell('git status && npm test', r)).toEqual({ verdict: 'allow' });
    expect(decideShell('npm testing', r)).toMatchObject({ verdict: 'ask' });
    expect(decideShell('npm test && curl example.com', r)).toMatchObject({ verdict: 'ask', why: '"curl example.com" is not in the list' });
  });

  it('asks about a command that is not listed, and about one it cannot read', () => {
    expect(decideShell('rm -rf build', rules(['npm test']))).toMatchObject({ verdict: 'ask' });
    expect(decideShell('npm test $(whoami)', rules(['npm test']))).toMatchObject({ verdict: 'ask' });
  });

  it('reads git the same with its global options, so a hard denial cannot be walked around', () => {
    const r = rules(['git'], ['git push']);
    expect(decideShell('git push origin main', r)).toEqual({ verdict: 'deny', by: 'git push' });
    expect(decideShell('git -C ../other push origin main', r)).toEqual({ verdict: 'deny', by: 'git push' });
    expect(decideShell('git --no-pager --git-dir=x/.git push', r)).toEqual({ verdict: 'deny', by: 'git push' });
    expect(decideShell('git status && git -C . push', r)).toEqual({ verdict: 'deny', by: 'git push' });
    expect(decideShell('git -C ../other status', r)).toEqual({ verdict: 'allow' });
  });

  it('asks about git -c, which can set an alias or a pager', () => {
    expect(decideShell('git -c alias.p=push p', rules(['git']))).toMatchObject({ verdict: 'ask' });
  });

  it('finds a hard denial in a command it cannot read, rather than asking about what is never allowed', () => {
    expect(decideShell('echo $(true) && git push --force', rules(['echo'], ['git push --force']))).toEqual({ verdict: 'deny', by: 'git push --force' });
    expect(decideShell('echo `true`', rules(['echo'], ['git push --force']))).toMatchObject({ verdict: 'ask' });
  });

  it('lets an open shell run anything that is not denied', () => {
    const r = rules(['Bash'], ['rm -rf']);
    expect(decideShell('make all', r)).toEqual({ verdict: 'allow' });
    expect(decideShell('rm -rf /', r)).toEqual({ verdict: 'deny', by: 'rm -rf' });
  });

  it('does not look inside a wrapper: it counts only if it is listed', () => {
    expect(decideShell('sh -c "git push"', rules(['git'], ['git push']))).toMatchObject({ verdict: 'ask' });
    expect(decideShell('xargs git push', rules(['git'], ['git push']))).toMatchObject({ verdict: 'ask' });
  });
});

describe('The rules of a machine', () => {
  it('starts every machine with the file tools and the local git commands, not git push', () => {
    const r = effectiveRules({ allow: [], deny: [], readOnly: false, shell: true });
    expect(r.allow).toEqual(expect.arrayContaining(['Read', 'Edit', 'Write', 'git status', 'git commit', 'git merge']));
    expect(r.allow).not.toContain('git push');
    expect(decideShell('git push origin main', r)).toMatchObject({ verdict: 'ask' });
    expect(decideShell('git -C wt commit -m x', r)).toEqual({ verdict: 'allow' });
  });

  it('lets a machine that should push say so', () => {
    const r = effectiveRules({ allow: ['git push'], deny: [], readOnly: false, shell: true });
    expect(decideShell('git push origin HEAD', r)).toEqual({ verdict: 'allow' });
  });

  it('takes the file tools and git push away from a read-only machine, whatever its lists say', () => {
    const r = effectiveRules({ allow: ['git push', 'Edit', 'gh pr view'], deny: [], readOnly: true, shell: true });
    expect(r.deny).toEqual(expect.arrayContaining(['git push', 'Edit', 'Write']));
    expect(decideShell('git push', r)).toEqual({ verdict: 'deny', by: 'git push' });
    expect(decideShell('git diff main', r)).toEqual({ verdict: 'allow' });
    expect(decideShell('git commit -m x', r)).toMatchObject({ verdict: 'ask' });
    expect(decideShell('gh pr view 12', r)).toEqual({ verdict: 'allow' });
  });

  it('reads the older Bash(...) form as the prefix it stands for', () => {
    expect(prefixOf('Bash(gh pr view:*)')).toBe('gh pr view');
    expect(prefixOf('Bash(sh test.sh)')).toBe('sh test.sh');
    expect(prefixOf('Bash')).toBe('Bash');
    expect(prefixOf('mcp__slack')).toBe('mcp__slack');
    expect(effectiveRules({ allow: ['Bash(gh:*)'], deny: ['Bash(rm -rf:*)'], readOnly: false, shell: true })).toMatchObject({ deny: ['rm -rf'], allow: expect.arrayContaining(['gh']) });
  });

  it('gives a machine with no shell no commands', () => {
    expect(effectiveRules({ allow: [], deny: [], readOnly: true, shell: false }).allow).toEqual(['Read', 'Grep', 'Glob']);
  });
});
