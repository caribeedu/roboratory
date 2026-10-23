// Codex CLI adapter: `codex exec` with an output schema file. Codex gets the bare contract;
// it has no question alternative yet.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractJson, short, spawnCollect } from './process';
import type { AgentRequest, AgentResult } from './types';

export async function runCodex(req: AgentRequest): Promise<AgentResult> {
  const bin = process.env.PROMPTORY_CODEX_BIN || 'codex';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'promptory-codex-'));
  const schemaFile = path.join(tmp, 'schema.json'), outFile = path.join(tmp, 'out.txt');
  fs.writeFileSync(schemaFile, JSON.stringify(req.schema));
  const args = ['exec', `${req.role}\n\n${req.prompt}`, '--output-schema', schemaFile, '-o', outFile, '--sandbox', req.readOnly ? 'read-only' : 'workspace-write', '--skip-git-repo-check'];
  if (req.model) args.push('--model', req.model);
  if (!req.readOnly) for (const d of req.addDirs) args.push('--add-dir', d);
  const { code, stderr, timedOut } = await spawnCollect(bin, args, req, (line) => req.onEvent({ kind: 'text', text: short(line, 300) }));
  if (timedOut) return { error: `timed out after ${Math.round(req.timeoutMs / 1000)}s` };
  const text = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  if (code !== 0 && !text) return { error: `codex exited with code ${code}${stderr.trim() ? ': ' + short(stderr.trim(), 300) : ''}` };
  return { output: extractJson(text) ?? (() => { try { return JSON.parse(text); } catch { return undefined; } })(), text };
}
