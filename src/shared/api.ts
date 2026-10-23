// The bridge between the renderer and the main process (exposed by preload.ts).
import type { BuildOp, BuildView, FieldInfo } from './build';
import type { LogEntry, ManagerMessage, RunSummary, Snapshot } from './types';

export type ScopeArg = { kind: 'sector'; sectorId: string } | { kind: 'factory' };

export interface RunDetail { summary: RunSummary; events: Record<string, any>[]; diff?: string; dir: string }

export interface RoboratoryApi {
  state(): Promise<{ snapshot: Snapshot; logs: LogEntry[]; recent: string[]; demoPath: string }>;
  openFactory(): Promise<boolean>;
  openFactoryAt(root: string): Promise<void>;
  createDemo(): Promise<void>;
  closeFactory(): Promise<void>;
  run(lineId: string, input: Record<string, string>): Promise<string>;
  retry(lineId: string, pieceId: string, hint: string): Promise<void>;
  release(lineId: string, pieceId: string, confirmations: number, decision?: { choice: string; note: string }): Promise<void>;
  answer(lineId: string, pieceId: string, text: string): Promise<void>;
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
