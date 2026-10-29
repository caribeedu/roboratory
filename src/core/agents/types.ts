// What the engine and managers hand an agent adapter, and what they get back.
import type { Tokens } from '../../shared/types';
import type { Waits } from './waits';

export type { Tokens };

export interface AgentEvent { kind: 'tool' | 'ret' | 'text' | 'info'; text: string }

/** A tool call the agent wants to make, and what the engine decided (D44). */
export interface PermissionCall { tool: string; input: Record<string, unknown> }
export type PermissionDecision = { behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string };

/** How an agent asks for a permission: the engine decides, and a request that needs a person waits for one. */
export interface PermissionAccess {
  /** names this attempt to the engine, for an agent's permission tool that runs in a process of its own */
  session: string;
  /** the factory the engine belongs to */
  root: string;
  /** how to start `roboratory permission-tool`; without it an agent that asks through a tool of its own is not given one */
  tool?: { command: string; args: string[]; env: Record<string, string> };
  /** for an agent that asks in process */
  decide(call: PermissionCall, gone?: AbortSignal): Promise<PermissionDecision>;
  /** counts the requests waiting on a person; the machine's time limit stops while any does */
  waits: Waits;
}

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
  /** what it may run, as the engine worked it out (D44): command prefixes (`git status`) and tool names (`Edit`, `Bash`) */
  allow: string[];
  /** commands and tools it must never use */
  deny: string[];
  /** MCP tools, by name */
  tools: string[];
  /** no file-editing tools */
  readOnly: boolean;
  /** has a shell; a manager has none */
  shell: boolean;
  /** how it asks for what its rules leave undecided; a manager does not */
  permission?: PermissionAccess;
  timeoutMs: number;
  sim?: Record<string, unknown>;
  simCtx?: Record<string, unknown>;
  simFail?: boolean;
  onEvent: (e: AgentEvent) => void;
  signal?: AbortSignal;
}

export interface AgentResult { output?: unknown; text?: string; error?: string; costUsd?: number; model?: string; tokens?: Tokens }

/**
 * The port the engine and the managers call (D45): one adapter per agent. What is specific to an agent's CLI
 * (its command line, how it holds the answer to the contract, its stream, cost and MCP names) stays in the adapter.
 */
export interface AgentRunner { run(req: AgentRequest): Promise<AgentResult> }
