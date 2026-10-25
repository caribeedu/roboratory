// What a machine may run (D44): command prefixes in `allow` and `deny`, the defaults every machine starts with, and the
// reading of a shell command that decides it. The engine, not the agent's CLI, decides a shell command, because a CLI's
// own rules can be walked around (`git -C . push` passes a rule on `git push`).

/** Tools every machine reads with. */
export const READ_TOOLS = ['Read', 'Grep', 'Glob'];
/** Tools that edit files; a read-only machine has none. */
export const WRITE_TOOLS = ['Edit', 'Write'];

/** The local git subcommands that only look. */
const GIT_LOOK = ['status', 'diff', 'log', 'show', 'branch', 'rev-parse', 'rev-list', 'ls-files', 'ls-tree', 'blame', 'grep', 'describe', 'merge-base', 'cat-file', 'shortlog', 'remote'];
/** The ones that change the local repository or take from a remote. None of them sends anything to one. */
const GIT_LOCAL = ['add', 'commit', 'switch', 'checkout', 'restore', 'merge', 'rebase', 'stash', 'worktree', 'fetch', 'pull', 'reset', 'clean', 'cherry-pick', 'revert', 'tag', 'mv', 'rm', 'apply', 'am', 'reflog'];

export interface Rules { allow: string[]; deny: string[] }

/** A tool name (`Edit`, `Bash`, `mcp__server__tool`) as opposed to a command prefix (`npm test`). */
export const isToolName = (entry: string) => /^[A-Z]/.test(entry) || entry.startsWith('mcp__');

/** The older `Bash(npm test:*)` form as the prefix it stands for; a bare `Bash` stays the tool. */
export function prefixOf(entry: string): string {
  const m = /^Bash\((.*?)(?::\*)?\)$/.exec(entry.trim());
  return (m ? m[1] : entry).trim();
}

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
    ...o.allow.map(prefixOf),
  ];
  const deny = [...o.deny.map(prefixOf), ...(o.readOnly ? ['git push', ...WRITE_TOOLS] : [])];
  return { allow: [...new Set(allow)].filter(Boolean), deny: [...new Set(deny)].filter(Boolean) };
}

// ---------- reading a shell command ----------

/**
 * A shell command as the parts it runs, each a list of words, or null when the command cannot be accounted for: a
 * substitution (`$(…)`, backticks), a subshell, a here-document, a redirect to a file, a variable assignment, or a
 * quote left open. Parts are split at `;`, `&&`, `||`, `|`, `&` and line breaks outside quotes.
 */
export function parseCommand(cmd: string): string[][] | null {
  const parts: string[][] = [];
  let words: string[] = [], cur = '', has = false, q = '';
  const endWord = () => { if (has) { words.push(cur); cur = ''; has = false; } };
  const endPart = () => { endWord(); if (words.length) parts.push(words); words = []; };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q === "'") { if (c === "'") q = ''; else cur += c; continue; }
    if (q === '"') {
      if (c === '"') q = '';
      else if (c === '`' || (c === '$' && cmd[i + 1] === '(')) return null;
      else if (c === '\\' && i + 1 < cmd.length) cur += cmd[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (c === '\\') { if (i + 1 < cmd.length) { cur += cmd[++i]; has = true; } continue; }
    if (c === '`' || c === '(' || c === ')' || (c === '$' && cmd[i + 1] === '(')) return null;
    if (c === '>' || c === '<' || (c === '&' && cmd[i + 1] === '>')) {
      // only the redirects that write nowhere: to another stream, or to /dev/null. A number just before is the stream (2>&1).
      if (has && /^\d+$/.test(cur)) { cur = ''; has = false; } else endWord();
      const m = /^&?>{1,2}\s*(?:&\d+|\/dev\/null(?![\w/]))/.exec(cmd.slice(i));
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

/** Git's options that come before the subcommand, dropped so `git -C dir push` reads as `git push`. Null: one it cannot account for (`-c`, which can set an alias or a pager). */
function withoutGitOptions(words: string[]): string[] | null {
  if (words[0] !== 'git') return words;
  let i = 1;
  for (; i < words.length; i++) {
    const w = words[i];
    if (w === '-C' || w === '--git-dir' || w === '--work-tree') { i++; continue; }
    if (/^--(git-dir|work-tree)=/.test(w) || ['--no-pager', '--paginate', '--no-optional-locks', '--literal-pathspecs'].includes(w)) continue;
    if (w.startsWith('-')) return null;
    break;
  }
  return ['git', ...words.slice(i)];
}

const startsWith = (words: string[], entry: string) => {
  const e = entry.split(/\s+/).filter(Boolean);
  return e.length > 0 && words.length >= e.length && e.every((w, i) => words[i] === w);
};

export type Verdict = { verdict: 'allow' } | { verdict: 'deny'; by: string } | { verdict: 'ask'; why: string };

/**
 * What to do with a shell command. A part that starts with a hard denial denies the whole command. It is allowed
 * without asking when every part starts with an entry of `allow` (or the shell is open, `Bash`). Anything else, and any
 * command that cannot be accounted for, is a request to a person. A wrapper such as `sh -c` or `xargs` is not looked
 * into: it counts only if it is itself listed.
 */
export function decideShell(command: string, rules: Rules): Verdict {
  const commands = rules.allow.filter((a) => !isToolName(a));
  const denies = rules.deny.filter((d) => !isToolName(d));
  const parts = parseCommand(command);
  if (!parts) {
    // not read as parts, so a hard denial is looked for in the words themselves
    const loose = command.split(/[^\w./=:@%+,-]+/).filter(Boolean);
    const hit = denies.find((d) => loose.some((_, i) => startsWith(loose.slice(i), d)));
    return hit ? { verdict: 'deny', by: hit } : { verdict: 'ask', why: 'the command has a substitution, a subshell, a redirect to a file or an assignment, which cannot be checked' };
  }
  const read = parts.map(withoutGitOptions);
  for (const w of read) {
    if (!w) continue;
    const hit = denies.find((d) => startsWith(w, d));
    if (hit) return { verdict: 'deny', by: hit };
  }
  if (read.includes(null)) return { verdict: 'ask', why: 'a git option that changes how git runs (-c) cannot be checked' };
  if (rules.allow.includes('Bash')) return { verdict: 'allow' };
  const missing = (read as string[][]).find((w) => !commands.some((a) => startsWith(w, a)));
  return missing ? { verdict: 'ask', why: `"${missing.join(' ')}" is not in the list` } : { verdict: 'allow' };
}

/** What to do with a tool call: a shell command by its parts, anything else by the tool's name. */
export function decideTool(tool: string, input: Record<string, unknown>, rules: Rules): Verdict {
  if (tool === 'Bash') return decideShell(String(input.command ?? ''), rules);
  if (rules.deny.includes(tool)) return { verdict: 'deny', by: tool };
  if (rules.allow.includes(tool)) return { verdict: 'allow' };
  return { verdict: 'ask', why: `${tool} is not in the list` };
}
