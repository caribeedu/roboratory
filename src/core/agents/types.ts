// What the engine and managers hand an agent adapter, and what they get back.

export interface AgentEvent { kind: 'tool' | 'ret' | 'text' | 'info'; text: string }

export interface AgentRequest {
  agent: string;
  model?: string;
  effort?: string;
  role: string;
  prompt: string;
  /** the contract the answer must match */
  schema: Record<string, unknown>;
  /**
   * What the agent may answer instead of the contract: a question (D21) or blocked (D22), as one
   * schema or an `anyOf` of several. Each adapter decides how to ask its agent for "the contract
   * or one of these", and hands back the answer unwrapped.
   */
  question?: Record<string, unknown>;
  cwd: string;
  addDirs: string[];
  allow: string[];
  tools: string[];
  readOnly: boolean;
  timeoutMs: number;
  sim?: Record<string, unknown>;
  simCtx?: Record<string, unknown>;
  simFail?: boolean;
  onEvent: (e: AgentEvent) => void;
  signal?: AbortSignal;
}

export interface AgentResult { output?: unknown; text?: string; error?: string; costUsd?: number }

/**
 * The port the engine and the managers call (D45): one adapter per agent. What is specific to an agent's CLI
 * (its command line, how it holds the answer to the contract, its stream, cost and MCP names) stays in the adapter.
 */
export interface AgentRunner { run(req: AgentRequest): Promise<AgentResult> }
