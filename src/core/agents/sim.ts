// The built-in simulated agent (D28): scripted transcript, files and answers, for demos and tests.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { render, renderDeep } from '../template';
import type { AgentRequest, AgentResult } from './types';

/** Speeds up the simulated agent; tests set PROMPTORY_SIM_SPEED=50. */
const simSpeed = () => Number(process.env.PROMPTORY_SIM_SPEED || 1);
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
});

export async function runSim(req: AgentRequest): Promise<AgentResult> {
  const sim = req.sim || {};
  const ctx = req.simCtx || {};
  const seconds = Number(sim.seconds ?? 3) / simSpeed();
  const lines = Array.isArray(sim.transcript) ? sim.transcript.map((l) => String(render(String(l), ctx))) : [];
  const step = (seconds * 1000) / (lines.length + 1);
  try {
    for (const l of lines) {
      await sleep(step, req.signal);
      req.onEvent({ kind: l.startsWith('◂') ? 'ret' : l.startsWith('▸') ? 'tool' : 'text', text: l.replace(/^[▸◂]\s*/, '') });
    }
    await sleep(step, req.signal);
  } catch { return { error: 'stopped' }; }
  if (!req.readOnly && sim.write && typeof sim.write === 'object') {
    for (const [rel, content] of Object.entries(sim.write as Record<string, unknown>)) {
      const p = path.join(req.cwd, String(render(rel, ctx)));
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, String(render(String(content), ctx)));
    }
  }
  if (!req.readOnly && sim.commit && fs.existsSync(path.join(req.cwd, '.git'))) {
    try {
      const env = { ...process.env, GIT_AUTHOR_NAME: 'Promptory', GIT_AUTHOR_EMAIL: 'machine@promptory.local', GIT_COMMITTER_NAME: 'Promptory', GIT_COMMITTER_EMAIL: 'machine@promptory.local' };
      execFileSync('git', ['add', '-A'], { cwd: req.cwd, env });
      execFileSync('git', ['commit', '-q', '-m', String(render(String(sim.commit), ctx))], { cwd: req.cwd, env });
    } catch { /* nothing to commit */ }
  }
  const box = (ctx.box ?? {}) as Record<string, unknown>;
  if (sim.ask && !box.human_answer) {
    const needs = renderDeep(sim.ask, ctx);
    req.onEvent({ kind: 'text', text: `needs you: ${JSON.stringify(needs)}` });
    return { output: { needs_human: needs } };
  }
  const seq = Array.isArray(sim.outputs) ? sim.outputs : null;
  const call = Number(ctx.call ?? 0);
  const out = req.simFail && sim.bad_output ? sim.bad_output : seq ? seq[Math.min(call, seq.length - 1)] : sim.output;
  const output = renderDeep(out ?? {}, ctx);
  req.onEvent({ kind: 'text', text: JSON.stringify(output) });
  return { output };
}
