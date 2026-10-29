// Claude Code adapter (D8): `claude -p` headless with a JSON schema, its stream turned into
// transcript lines, and its MCP naming. Everything specific to Claude Code lives here.
import { spawn } from 'node:child_process';
import { isToolName, READ_TOOLS } from '../permissions';
import { extractJson, launch, short, spawnCollect } from './process';
import type { AgentRequest, AgentResult, Tokens } from './types';

/**
 * The schema Claude Code gets. With alternatives (a question, D21, or blocked, D22), the contract
 * and each alternative go under `result`: Claude's tool schemas refuse anyOf/oneOf/allOf at the
 * root but accept them nested, so the API itself holds the agent to one of them, required fields included.
 */
export function claudeSchema(contract: Record<string, unknown>, question?: Record<string, unknown>): Record<string, unknown> {
  const alternatives = question ? (Array.isArray(question.anyOf) ? question.anyOf : [question]) : [];
  return question ? { type: 'object', required: ['result'], properties: { result: { anyOf: [contract, ...alternatives] } } } : contract;
}

/** The answer inside the `{ result }` wrapper; anything else is left for the contract check to reject. */
export function unwrapClaude(output: unknown): unknown {
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const o = output as Record<string, unknown>;
    if (Object.keys(o).length === 1 && 'result' in o) return o.result;
  }
  return output;
}

/**
 * What the agent may run in the shell, in words, from its allowed tools. Without it, agents try a
 * compound command, get it denied and conclude the whole shell is off.
 */
export function shellRules(prefixes: string[], open: boolean, asks = false): string {
  if (open) return '';
  const list = prefixes.map((x) => `\`${x}\``).join(', ');
  if (!asks) {
    if (!prefixes.length) return 'Shell: you have no shell. Read files with the Read, Grep and Glob tools.';
    return [
      `Shell: you may run only commands that start with ${list}. Anything else is denied.`,
      'Run one allowed command per call. In a compound command (`;`, `&&`, `|`) every part must be allowed, and `cd`, `cat`, `ls`, `echo`, `find` and variable assignments are not, unless listed above. Use `git -C <path>` instead of `cd`.',
      'Read files with the Read, Grep and Glob tools, and write them with Write and Edit. A denied command does not mean the others are denied.',
    ].join('\n');
  }
  // D44: a command outside the list is asked of a person instead of denied
  return [
    `Shell: you may run, without asking, commands that start with ${list || '(none)'}. Any other command is asked of a person, who may allow it once or refuse it with a reason, and you wait for the answer.`,
    'In a compound command (`;`, `&&`, `|`) every part must start with one of those, or the whole command is asked about. Use `git -C <path>` instead of `cd`.',
    'If a command is refused, do not try it again in another form: pick another way, or answer blocked if you cannot go on without it. A refusal does not mean other commands are refused. A command this factory forbids is refused at once.',
    'Read files with the Read, Grep and Glob tools, and write them with Write and Edit.',
  ].join('\n');
}

export function claudeArgs(req: AgentRequest): string[] {
  // The rules are the engine's (D44). With a permission tool every shell command goes to the engine, which allows it,
  // refuses it or asks a person. Without one, the CLI is given the commands as `Bash(<prefix>:*)` rules and refuses the rest.
  const perm = req.shell && req.permission?.tool ? req.permission : undefined;
  const commands = req.shell ? req.allow.filter((a) => !isToolName(a)) : [];
  const bash = (c: string) => `Bash(${c}:*)`;
  const tools = req.allow.filter((a) => isToolName(a) && !(perm && a === 'Bash'));
  const allowed = req.shell ? [...tools, ...(perm ? [] : commands.map(bash)), ...req.tools] : [...READ_TOOLS, ...req.tools];
  const disallowed = ['Agent', ...req.deny.filter((d) => isToolName(d) || !perm).map((d) => (isToolName(d) ? d : bash(d)))];
  const rules = req.shell ? shellRules(commands, req.allow.includes('Bash'), !!perm) : '';
  // no sub-agents: a step's work stays in one clean context, one folder and one transcript (D9)
  const args = ['-p', rules ? `${req.prompt}\n\n${rules}` : req.prompt, '--output-format', 'stream-json', '--verbose', '--json-schema', JSON.stringify(req.schema), '--permission-mode', perm ? 'default' : 'dontAsk', '--allowedTools', allowed.join(','), '--disallowedTools', [...new Set(disallowed)].join(','), '--append-system-prompt', req.role];
  if (perm) {
    const t = perm.tool!;
    const server = { command: t.command, args: t.args, env: { ...t.env, ROBORATORY_FACTORY: perm.root, ROBORATORY_SESSION: perm.session } };
    args.push('--permission-prompt-tool', 'mcp__roboratory__approve', '--mcp-config', JSON.stringify({ mcpServers: { roboratory: server } }));
  }
  if (req.readOnly) args.push('--tools', [...READ_TOOLS, ...(req.shell ? ['Bash'] : [])].join(','));
  if (req.model) args.push('--model', req.model);
  if (req.effort) args.push('--effort', req.effort);
  for (const d of req.addDirs) args.push('--add-dir', d);
  return args;
}

// ---------- transcript lines people can read ----------

/** `mcp__claude_ai_Atlassian__getConfluencePage` → `Atlassian · getConfluencePage`; built-ins stay as they are. */
export function toolLabel(name: string): string {
  const m = /^mcp__(?:claude_ai_)?(.+?)__(.+)$/.exec(name);
  return m ? `${m[1].replace(/_/g, ' ')} · ${m[2]}` : name;
}

/** A tool call's input as `key: value` pairs, one level of nesting flattened. */
export function toolArgs(input: unknown, n = 160): string {
  if (!input || typeof input !== 'object') return short(input ?? '', n);
  const flat: [string, unknown][] = [];
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) flat.push([k2, v2]);
    else flat.push([k, v]);
  }
  return short(flat.map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ').replace(/\s+/g, ' '), n);
}

/** A tool result on one line: whitespace and Read's line numbers collapsed, known notices said plainly. */
export function resultLine(content: unknown, isError = false): string {
  const raw = Array.isArray(content) ? content.map((c: { text?: string }) => c?.text || '').join(' ') : typeof content === 'string' ? content : JSON.stringify(content ?? '');
  const big = /result \(([\d,]+) characters\) exceeds maximum allowed tokens/.exec(raw);
  if (big) return `result too large for one reply (${big[1]} characters); Claude Code saved it to a file, which the agent reads next`;
  const text = raw.replace(/(^|\n)\s*\d+\t/g, '$1').replace(/\s+/g, ' ').trim();
  return short(`${isError ? 'error: ' : ''}${text || '(empty)'}`, 220);
}

/** The model that did most of the work and the tokens of a result event: `usage` for the totals, `modelUsage` for the model by cost. */
export function usageOf(result: Record<string, unknown>): { model?: string; tokens?: Tokens } {
  const n = (v: unknown) => (typeof v === 'number' ? v : 0);
  const u = (result.usage ?? {}) as Record<string, unknown>;
  const byModel = Object.entries((result.modelUsage ?? {}) as Record<string, Record<string, unknown>>);
  const main = byModel.sort((a, b) => n(b[1]?.costUSD) - n(a[1]?.costUSD))[0]?.[0];
  const tokens = { input: n(u.input_tokens), output: n(u.output_tokens), cacheRead: n(u.cache_read_input_tokens), cacheWrite: n(u.cache_creation_input_tokens) };
  return { ...(main ? { model: main } : {}), tokens };
}

export async function runClaude(req: AgentRequest): Promise<AgentResult> {
  const bin = process.env.ROBORATORY_CLAUDE_BIN || 'claude';
  let result: Record<string, unknown> | undefined;
  const { code, stderr, timedOut } = await spawnCollect(bin, claudeArgs({ ...req, schema: claudeSchema(req.schema, req.question) }), req, (line) => {
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(line); } catch { req.onEvent({ kind: 'text', text: line }); return; }
    if (ev.type === 'result') { result = ev; return; }
    const msg = ev.message as { content?: Record<string, unknown>[] } | undefined;
    if ((ev.type === 'assistant' || ev.type === 'user') && Array.isArray(msg?.content)) {
      for (const block of msg!.content!) {
        if (block.type === 'text' && block.text) req.onEvent({ kind: 'text', text: short(block.text, 400) });
        if (block.type === 'tool_use') req.onEvent({ kind: 'tool', text: `${toolLabel(String(block.name))} — ${toolArgs(block.input)}` });
        if (block.type === 'tool_result') {
          const raw = Array.isArray(block.content) ? block.content.map((c: { text?: string }) => c?.text || '').join(' ') : String(block.content ?? '');
          // the denial is already its own line; its long explanation adds nothing
          if (/^Permission to use .* has been denied/.test(raw)) continue;
          req.onEvent({ kind: 'ret', text: resultLine(block.content, !!block.is_error) });
        }
      }
    }
    if (ev.type === 'system' && ev.subtype === 'permission_denied') req.onEvent({ kind: 'info', text: `denied: ${toolLabel(String(ev.tool_name ?? 'a tool'))} was refused` });
  });
  if (timedOut) return { error: `timed out after ${Math.round(req.timeoutMs / 1000)}s` };
  if (!result) return { error: `claude exited with code ${code} and no result${stderr.trim() ? ': ' + short(stderr.trim(), 300) : ''}` };
  const cost = typeof result.total_cost_usd === 'number' ? result.total_cost_usd : undefined;
  if (result.is_error || result.subtype !== 'success') {
    const errs = Array.isArray(result.errors) ? result.errors.join('; ') : String(result.result ?? result.subtype);
    return { error: `${result.subtype}: ${short(errs, 300)}`, costUsd: cost };
  }
  const answer = result.structured_output ?? extractJson(String(result.result ?? ''));
  const output = req.question ? unwrapClaude(answer) : answer;
  return { output, text: String(result.result ?? ''), costUsd: cost, ...usageOf(result) };
}

/** Which MCP servers the user's Claude Code has configured (parsed from `claude mcp list`). */
export function claudeMcpServers(): Promise<string[] | null> {
  return new Promise((resolve) => {
    const run = launch(process.env.ROBORATORY_CLAUDE_BIN || 'claude', ['mcp', 'list']);
    if (run.error) { resolve(null); return; }
    const child = spawn(run.file, run.args, { env: run.env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let out = '';
    const timer = setTimeout(() => child.kill(), 60000);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', () => {
      clearTimeout(timer);
      // claude.ai connectors appear as "claude.ai Name"; their tools are named mcp__claude_ai_<Name>__…
      const names = out.split('\n').map((l) => {
        const m = /^(claude\.ai\s+)?([^:]+):\s/.exec(l.trim());
        if (!m || m[2].startsWith('Checking')) return undefined;
        return m[1] ? `claude_ai_${m[2].trim().replace(/[^A-Za-z0-9_-]/g, '_')}` : m[2].trim();
      }).filter((x): x is string => !!x);
      resolve(names);
    });
  });
}

/** Server part of an MCP tool name: mcp__new-relic__run_nrql_query → new-relic */
export const mcpServerOf = (tool: string) => /^mcp__(.+?)(?:__|$)/.exec(tool)?.[1];
