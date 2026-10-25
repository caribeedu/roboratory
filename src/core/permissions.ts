// What a machine may run (D44): command prefixes in `allow` and `deny`, the defaults every machine starts with, and the
// reading of a shell command that decides it. The engine, not the agent's CLI, decides a shell command, because a CLI's
// own rules can be walked around (`git -C . push` passes a rule on `git push`).

/** Tools every machine reads with. */
export const READ_TOOLS = ['Read', 'Grep', 'Glob'];
/** Tools that edit files; a read-only machine has none. */
export const WRITE_TOOLS = ['Edit', 'Write'];

/** The local git subcommands that look. An option that writes a file or runs a program is asked about (see RISKY). */
const GIT_LOOK = ['status', 'diff', 'log', 'show', 'rev-parse', 'rev-list', 'ls-files', 'ls-tree', 'blame', 'grep', 'describe', 'merge-base', 'cat-file', 'shortlog'];
/** The ones that change the local repository or take from a remote. None of them sends anything to one. */
const GIT_LOCAL = ['add', 'commit', 'switch', 'checkout', 'restore', 'merge', 'stash', 'worktree', 'fetch', 'pull', 'reset', 'clean', 'cherry-pick', 'revert', 'tag', 'branch', 'mv', 'rm', 'apply', 'am', 'reflog'];
/** Options of git that run another program or write a file, so a command with one is asked about. */
const RISKY = /^(--exec(=|$)|-x$|--upload-pack|--receive-pack|--output|--open-files-in-pager|-O|--ext-diff)/;

export interface Rules { allow: string[]; deny: string[] }

/** The tools of the agent's CLI that an entry of `allow` or `deny` can name, besides MCP tools. Anything else is a command. */
const TOOL_NAMES = new Set(['Bash', 'BashOutput', 'KillShell', 'Edit', 'Write', 'Read', 'Grep', 'Glob', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task', 'TodoWrite', 'Skill']);

/** A tool name (`Edit`, `Bash`, `mcp__server__tool`) as opposed to a command prefix (`npm test`, `Rscript`). */
export const isToolName = (entry: string) => entry.startsWith('mcp__') || TOOL_NAMES.has(entry);

/**
 * The rules a machine runs with. Every machine can read; one that may edit also gets the file tools; and a shell comes
 * with the local git subcommands (`git push` is not among them, so it is asked about). `read_only` takes the file tools
 * away and denies `git push`, whatever the lists say. `deny` is the union of the factory, sector, line and machine
 * lists, which only ever add to each other.
 */
export function effectiveRules(o: { allow: string[]; deny: string[]; readOnly: boolean; shell: boolean }): Rules {
  const allow = [
    ...READ_TOOLS, ...(o.readOnly ? [] : WRITE_TOOLS),
    ...(o.shell ? [...GIT_LOOK, ...(o.readOnly ? [] : GIT_LOCAL)].map((s) => `git ${s}`) : []),
    ...o.allow.map((a) => a.trim()),
  ];
  const deny = [...o.deny.map((d) => d.trim()), ...(o.readOnly ? ['git push', ...WRITE_TOOLS] : [])];
  return { allow: [...new Set(allow)].filter(Boolean), deny: [...new Set(deny)].filter(Boolean) };
}

// ---------- reading a shell command ----------

/**
 * A shell command as the parts it runs, each a list of words, or null when the command cannot be accounted for: a
 * substitution (`$(…)`, backticks), a subshell, a here-document, a redirect to a file, a variable assignment, a comment,
 * or a quote left open. Parts are split at `;`, `&&`, `||`, `|`, `&` and line breaks outside quotes.
 */
export function parseCommand(cmd: string): string[][] | null {
  const parts: string[][] = [];
  let words: string[] = [], cur = '', has = false, q = '';
  const endWord = () => { if (has) { words.push(cur); cur = ''; has = false; } };
  const endPart = () => { endWord(); if (words.length) parts.push(words); words = []; };
  const continuation = (i: number) => cmd[i + 1] === '\n' ? 1 : cmd[i + 1] === '\r' && cmd[i + 2] === '\n' ? 2 : 0;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q === "'") { if (c === "'") q = ''; else cur += c; continue; }
    if (q === '"') {
      if (c === '"') q = '';
      else if (c === '`' || (c === '$' && cmd[i + 1] === '(')) return null;
      else if (c === '\\' && continuation(i)) i += continuation(i);
      else if (c === '\\' && i + 1 < cmd.length) cur += cmd[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (c === '\\') {
      const n = continuation(i);
      if (n) i += n; // a backslash before a line break joins the lines
      else if (i + 1 < cmd.length) { cur += cmd[++i]; has = true; }
      continue;
    }
    // a comment runs to the end of the line, and what a quote in it would open is not the shell's to see: ask instead
    if (c === '#' && !has) return null;
    if (c === '`' || c === '(' || c === ')' || (c === '$' && cmd[i + 1] === '(')) return null;
    if (c === '>' || c === '<' || (c === '&' && cmd[i + 1] === '>')) {
      // only the redirects that write nowhere: to another stream, or to /dev/null. A number just before is the stream (2>&1).
      if (has && /^\d+$/.test(cur)) { cur = ''; has = false; } else endWord();
      const m = /^&?>{1,2}\s*(?:&\d+(?![\w./-])|\/dev\/null(?![\w/]))/.exec(cmd.slice(i));
      if (!m || c === '<') return null;
      i += m[0].length - 1;
      continue;
    }
    if (c === ';' || c === '\n' || c === '|' || c === '&') {
      endPart();
      if ((c === '|' || c === '&') && cmd[i + 1] === c) i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') { endWord(); continue; }
    cur += c; has = true;
  }
  if (q) return null;
  endPart();
  return parts.every((p) => !/^[A-Za-z_]\w*=/.test(p[0]) && !p[0].startsWith('$')) ? parts : null;
}

/** Words that start a part without being the command, and programs that only run another one. */
const KEYWORDS = new Set(['!', '{', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', 'time', 'command', 'nohup', 'exec', 'nice', 'builtin']);

/** The command of a part: shell keywords, `env VAR=x` and the like dropped. */
function commandOf(words: string[]): string[] {
  let w = words;
  for (;;) {
    if (!w.length) return w;
    if (w[0] === 'env') { w = w.slice(1); while (w.length && (/^[A-Za-z_]\w*=/.test(w[0]) || w[0].startsWith('-'))) w = w.slice(1); continue; }
    if (KEYWORDS.has(w[0])) { w = w.slice(1); while (w.length && w[0].startsWith('-') && w[0].length > 1) w = w.slice(1); continue; }
    return w;
  }
}

/** Where the file system ignores case, a command is the same whatever its case. */
const fold = (s: string) => (process.platform === 'win32' || process.platform === 'darwin' ? s.toLowerCase() : s);

/** A name for matching a denial: no folder, and no `.exe` on Windows. */
function plainName(word: string): string {
  const n = word.slice(Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\')) + 1);
  return process.platform === 'win32' ? n.replace(/\.(exe|cmd|bat|com)$/i, '') : n;
}

/**
 * The words of a part as the command that runs. For `allow` it must be plain: git's global options that only point
 * somewhere (`-C dir`) are dropped, and one it cannot account for (`-c`, which can set an alias or a pager), a word
 * that is not plain where the command or git's subcommand is, or an option that runs a program is null. For a denial the
 * reading is looser, so a command is still caught.
 */
function readPart(words: string[]): { allow: string[] | null; deny: string[] } {
  const w = commandOf(words);
  const name = plainName(w[0] ?? '');
  const isGit = fold(name) === 'git', isGh = fold(name) === 'gh';
  const loose = (word?: string) => !!word && /[$*?[\]{}~`]/.test(word);
  const forDeny = [name, ...w.slice(1)];
  if (isGit) {
    const strict: string[] = ['git'], broad: string[] = ['git'];
    let i = 1, ok = true;
    for (; i < w.length; i++) {
      const x = w[i];
      if (x === '-C' || x === '--git-dir' || x === '--work-tree' || x === '--namespace' || x === '--exec-path') { i++; continue; }
      if (x === '-c') { i++; ok = false; continue; }
      if (/^--(git-dir|work-tree|namespace|exec-path)=/.test(x) || ['--no-pager', '--paginate', '--no-optional-locks', '--literal-pathspecs', '--bare', '--no-replace-objects'].includes(x)) continue;
      if (x.startsWith('-')) { ok = false; continue; }
      break;
    }
    strict.push(...w.slice(i)); broad.push(...w.slice(i));
    const readable = ok && !loose(w[i]) && !w.slice(i).some((x) => RISKY.test(x)) && w[0] === 'git';
    broad[0] = 'git';
    return { allow: readable ? strict : null, deny: broad };
  }
  if (isGh) {
    // gh's option for another repository sits before the subcommand
    const broad: string[] = ['gh'];
    for (let i = 1; i < w.length; i++) {
      if (w[i] === '-R' || w[i] === '--repo') { i++; continue; }
      if (/^--repo=/.test(w[i])) continue;
      broad.push(w[i]);
    }
    return { allow: loose(w[0]) || w[0] !== 'gh' ? null : w, deny: broad };
  }
  return { allow: loose(w[0]) ? null : w, deny: forDeny };
}

const startsWith = (words: string[], entry: string) => {
  const e = entry.split(/\s+/).filter(Boolean);
  return e.length > 0 && words.length >= e.length && e.every((w, i) => words[i] === w);
};

/**
 * Whether a command is one a denial names. The entry's leading words must start the command, and the flags after them
 * may stand anywhere and in any spelling that means the same: `rm -rf` is also `rm -fr` and `rm -r -f`, and
 * `git push --force` is also `git push origin --force`.
 */
function denied(words: string[], entry: string): boolean {
  const e = entry.split(/\s+/).filter(Boolean);
  const at = e.findIndex((x) => x.startsWith('-'));
  const lead = at < 0 ? e : e.slice(0, at);
  if (!lead.length || words.length < lead.length || !lead.every((x, i) => fold(words[i]) === fold(x))) return false;
  const rest = words.slice(lead.length);
  const letters = new Set(rest.filter((x) => /^-[^-]/.test(x)).flatMap((x) => [...x.slice(1)]));
  return (at < 0 ? [] : e.slice(at)).every((x) => {
    if (/^-[^-]/.test(x)) return [...x.slice(1)].every((l) => letters.has(l));
    return rest.some((y) => y === x || (x.startsWith('--') && y.startsWith(`${x}=`)));
  });
}

export type Verdict = { verdict: 'allow' } | { verdict: 'deny'; by: string } | { verdict: 'ask'; why: string };

/**
 * What to do with a shell command. A part that a hard denial names denies the whole command. It is allowed without
 * asking when every part starts with an entry of `allow` (or the shell is open, `Bash`). Anything else, and any command
 * that cannot be accounted for, is a request to a person. `env`, `command`, `time` and the like are looked through; a
 * wrapper that runs a string, such as `sh -c` or `xargs`, is not: it counts only if it is itself listed. With an open
 * shell the denials are a best effort: the engine reads commands, not what they do (D44).
 */
export function decideShell(command: string, rules: Rules): Verdict {
  const commands = rules.allow.filter((a) => !isToolName(a));
  const denies = rules.deny.filter((d) => !isToolName(d));
  const parts = parseCommand(command);
  if (!parts) {
    // not read as parts, so a hard denial is looked for in the words themselves
    const words = command.split(/[^\w./=:@%+,-]+/).filter(Boolean);
    const hit = denies.find((d) => words.some((_, i) => startsWith(words.slice(i), d)));
    return hit ? { verdict: 'deny', by: hit } : { verdict: 'ask', why: 'the command has a comment, a substitution, a subshell, a redirect to a file or an assignment, which cannot be checked' };
  }
  const read = parts.map(readPart);
  for (const r of read) {
    const hit = denies.find((d) => denied(r.deny, d));
    if (hit) return { verdict: 'deny', by: hit };
  }
  const unclear = read.find((r) => !r.allow);
  if (unclear) return { verdict: 'ask', why: `"${unclear.deny.join(' ')}" has a word or an option that cannot be checked` };
  if (rules.allow.includes('Bash')) return { verdict: 'allow' };
  const missing = read.find((r) => !commands.some((a) => startsWith(r.allow!, a)));
  return missing ? { verdict: 'ask', why: `"${missing.allow!.join(' ')}" is not in the list` } : { verdict: 'allow' };
}

/** What to do with a tool call: a shell command by its parts, anything else by the tool's name. */
export function decideTool(tool: string, input: Record<string, unknown>, rules: Rules): Verdict {
  if (tool === 'Bash') return decideShell(String(input.command ?? ''), rules);
  if (rules.deny.includes(tool)) return { verdict: 'deny', by: tool };
  if (rules.allow.includes(tool)) return { verdict: 'allow' };
  return { verdict: 'ask', why: `${tool} is not in the list` };
}
