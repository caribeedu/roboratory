// The bridge between the renderer and the main process (exposed by preload.ts).
import type { BuildOp, BuildView, FieldInfo } from './build';
import type { LogEntry, ManagerMessage, RunSummary, Snapshot } from './types';

export type ScopeArg = { kind: 'sector'; sectorId: string } | { kind: 'factory' };

export interface RunDetail { summary: RunSummary; events: Record<string, any>[]; diff?: string; dir: string }

/** The engine process behind the window (D43). `older`: it runs an earlier version than the app and can restart when idle. */
export interface EngineStatus { state: 'none' | 'running' | 'restarting' | 'stopped' | 'older'; version?: string; appVersion: string }

export interface RoboratoryApi {
  state(): Promise<{ snapshot: Snapshot; logs: LogEntry[]; recent: string[]; demoPath: string; engine: EngineStatus }>;
  /** Whether the `roboratory` command is installed for this build. */
  cliStatus(): Promise<'installed' | 'outdated' | 'missing'>;
  /** Asks, then writes the `roboratory` launcher; resolves to the status afterwards. */
  cliInstall(): Promise<'installed' | 'outdated' | 'missing'>;
  onCli(cb: (s: 'installed' | 'outdated' | 'missing') => void): () => void;
  /** Starts the engine again after it stopped. */
  engineStart(): Promise<void>;
  /** Stops dispatching and restarts the engine once no machine or signal is running. */
  engineRestartWhenIdle(): Promise<void>;
  onEngine(cb: (s: EngineStatus) => void): () => void;
  openFactory(): Promise<boolean>;
  openFactoryAt(root: string): Promise<void>;
  createDemo(): Promise<void>;
  closeFactory(): Promise<void>;
  run(lineId: string, input: Record<string, string>): Promise<string>;
  retry(lineId: string, pieceId: string, hint: string): Promise<void>;
  release(lineId: string, pieceId: string, confirmations: number, decision?: { choice: string; note: string }): Promise<void>;
  answer(lineId: string, pieceId: string, text: string): Promise<void>;
  /** Lets a machine make the call it asked for, this once (D44). */
  allow(requestId: string): Promise<void>;
  /** Refuses it; the reason goes back to the agent. */
  deny(requestId: string, reason: string): Promise<void>;
  halt(lineId: string): Promise<void>;
  resume(lineId: string): Promise<void>;
  runs(): Promise<RunSummary[]>;
  runDetail(runId: string): Promise<RunDetail | null>;
  ask(scope: ScopeArg, question: string): Promise<void>;
  messages(scope: ScopeArg): Promise<ManagerMessage[]>;
  acceptProposal(scope: ScopeArg, messageId: string, proposalId: string, confirmations?: number): Promise<void>;
  rejectProposal(scope: ScopeArg, messageId: string, proposalId: string): Promise<void>;
  reveal(target: string): Promise<void>;
  buildStart(sectorId: string): Promise<BuildView>;
  buildApply(op: BuildOp): Promise<BuildView>;
  buildUndo(): Promise<BuildView>;
  buildRedo(): Promise<BuildView>;
  buildFields(lineId: string, from: string, back?: boolean): Promise<{ fields: FieldInfo[]; open: boolean }>;
  buildServers(): Promise<string[] | null>;
  buildRead(path: string): Promise<string | null>;
  buildList(path: string): Promise<string[]>;
  buildSave(resolutions?: Record<string, 'mine' | 'disk'>): Promise<void>;
  buildDiscard(): Promise<void>;
  onBuild(cb: (v: BuildView | null) => void): () => void;
  onSnapshot(cb: (s: Snapshot) => void): () => void;
  onLogs(cb: (entries: LogEntry[]) => void): () => void;
  onMessages(cb: (scopeKey: string) => void): () => void;
}

declare global {
  interface Window { roboratory: RoboratoryApi }
}
