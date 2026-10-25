// Runs one agent turn headless. A step ends when the process exits (D8).
// The engine and the managers call the AgentRunner port (D45); each agent is an adapter behind it:
// claude, and sim (a built-in simulated agent for demos and tests). A new agent is a new adapter listed here.
import { AGENTS, type AgentName } from '../../shared/types';
import { runClaude } from './claude';
import { runSim } from './sim';
import type { AgentRequest, AgentResult, AgentRunner } from './types';

export type { AgentEvent, AgentRequest, AgentResult, AgentRunner, PermissionAccess, PermissionCall, PermissionDecision } from './types';
export { claudeMcpServers, mcpServerOf } from './claude';

// typed by AgentName: an agent named in AGENTS without an adapter here does not compile
const runners: Record<AgentName, AgentRunner> = {
  claude: { run: runClaude },
  sim: { run: runSim },
};

export const isAgent = (name: string): name is AgentName => Object.prototype.hasOwnProperty.call(runners, name);

export async function runAgent(req: AgentRequest): Promise<AgentResult> {
  if (!isAgent(req.agent)) return { error: `Unknown agent "${req.agent}". Use ${AGENTS.join(' or ')}.` };
  return runners[req.agent].run(req);
}
