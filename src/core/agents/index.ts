// Runs one agent turn headless. A step ends when the process exits (D8).
// One adapter per agent CLI: claude, codex, and sim (a built-in simulated agent for demos and tests).
import { runClaude } from './claude';
import { runCodex } from './codex';
import { runSim } from './sim';
import type { AgentRequest, AgentResult } from './types';

export type { AgentEvent, AgentRequest, AgentResult } from './types';
export { claudeMcpServers, mcpServerOf } from './claude';

export const SUPPORTED_AGENTS = ['claude', 'codex', 'sim'] as const;

export async function runAgent(req: AgentRequest): Promise<AgentResult> {
  if (req.agent === 'sim') return runSim(req);
  if (req.agent === 'claude') return runClaude(req);
  if (req.agent === 'codex') return runCodex(req);
  return { error: `Unknown agent "${req.agent}". Use claude, codex or sim.` };
}
