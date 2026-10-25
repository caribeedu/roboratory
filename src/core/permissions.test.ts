import { decideShell, effectiveRules, isToolName, parseCommand, type Rules } from './permissions';

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

describe('Walking around a hard denial', () => {
  const DENY = ['git push --force', 'sudo', 'gh pr merge', 'rm -rf'];
  const closed = effectiveRules({ allow: ['npm test', 'git push'], deny: DENY, readOnly: false, shell: true });
  const open = effectiveRules({ allow: ['Bash'], deny: DENY, readOnly: false, shell: true });
  const verdict = (cmd: string, r: Rules) => decideShell(cmd, r).verdict;

  it.each([
    ['a quote in a comment that hides the next line', "git status # it's\ngit push --force # '"],
    ['a quote after a hash, over three lines', 'ls #"\ngit push --force\n#"'],
    ['a line continuation inside a command', 'git \\\npush --force'],
    ['a continuation with a carriage return', 'git \\\r\npush --force'],
    ['a git option that points somewhere', 'git -C ../other push --force'],
    ['a git option that sets configuration', 'git -c core.pager=x push --force'],
    ['a folder in front of the command', '/usr/bin/git push --force'],
    ['env in front', 'env GIT_X=1 git push --force'],
    ['command in front', 'command git push --force'],
    ['time in front', 'time git push --force'],
    ['a block', '{ git push --force; }'],
    ['an if', 'if true; then git push --force; fi'],
    ['a negation', '! git push --force'],
    ['flags in another order', 'git push origin --force'],
    ['flags in another form', 'git push --force=yes origin'],
    ['rm with the letters apart', 'rm -r -f x'],
    ['rm with the letters swapped', 'rm -fr x'],
    ['gh with a repository option', 'gh -R acme/app pr merge 12'],
  ])('is refused whatever the shell, through %s', (_, cmd) => {
    expect(decideShell(cmd, closed), cmd).toMatchObject({ verdict: 'deny' });
    expect(decideShell(cmd, open), cmd).toMatchObject({ verdict: 'deny' });
  });

  it.each([
    ['a word built by the shell', "git $'push' --force"],
    ['a variable as the subcommand', 'git ${x} --force'],
    ['a brace expansion as the command', '{git,push} --force'],
    ['a glob as the command', 'g*t push --force'],
    ['a glob as the subcommand', 'git pu* origin'],
    ['a variable as the command', '${CMD} push'],
  ])('is asked about, not allowed, even with an open shell, through %s', (_, cmd) => {
    expect(verdict(cmd, open), cmd).toBe('ask');
  });

  it('asks about a command whose redirect might write a file', () => {
    expect(verdict('npm test >&2evil', closed)).toBe('ask');
    expect(verdict('npm test 2>&1', closed)).toBe('allow');
  });

  it('asks about a comment, which is the shell\'s to read and not ours', () => {
    expect(verdict('npm test # then more', closed)).toBe('ask');
  });

  it('is not fooled by a flag spelled another way only when it is listed that way', () => {
    // -f is not --force to the engine: both are listed where both matter
    expect(verdict('git push -f', closed)).toBe('allow');
    expect(verdict('git push -f', effectiveRules({ allow: ['git push'], deny: ['git push -f'], readOnly: false, shell: true }))).toBe('deny');
  });

  it('asks about a git option that runs a program or writes a file, in a command the defaults would allow', () => {
    const rules = effectiveRules({ allow: [], deny: [], readOnly: false, shell: true });
    for (const cmd of ['git diff --output=out.txt', 'git log --output out.txt', 'git grep -O sh pattern', 'git fetch --upload-pack="touch x" .', 'git show --ext-diff HEAD']) expect(verdict(cmd, rules), cmd).toBe('ask');
    expect(verdict('git diff main', rules)).toBe('allow');
  });

  it('does not let a read-only machine delete branches or change remotes, which only the local commands may', () => {
    const rules = effectiveRules({ allow: [], deny: [], readOnly: true, shell: true });
    for (const cmd of ['git branch -D main', 'git remote set-url origin x', 'git rebase -x "git push" main']) expect(verdict(cmd, rules), cmd).toBe('ask');
    expect(verdict('git log --oneline', rules)).toBe('allow');
  });

  it('treats a capitalised word as a command, and a tool only when it is one', () => {
    expect(isToolName('Edit')).toBe(true);
    expect(isToolName('mcp__slack__post')).toBe(true);
    expect(isToolName('Rscript')).toBe(false);
    expect(isToolName('Remove-Item')).toBe(false);
    expect(verdict('Rscript analysis.R', effectiveRules({ allow: ['Rscript'], deny: [], readOnly: false, shell: true }))).toBe('allow');
    expect(verdict('Remove-Item -Recurse build', effectiveRules({ allow: ['Remove-Item'], deny: ['Remove-Item -Recurse'], readOnly: false, shell: true }))).toBe('deny');
  });

  it('still lets a wrapper that runs a string through, because it cannot look inside (D44)', () => {
    expect(verdict('xargs sudo ls', open)).toBe('allow');
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

  it('gives a machine with no shell no commands', () => {
    expect(effectiveRules({ allow: [], deny: [], readOnly: true, shell: false }).allow).toEqual(['Read', 'Grep', 'Glob']);
  });
});
