// Build mode: the edits the Floor sends, and what the draft looks like (D41).
import type { Direction, InputField, Policy, Snapshot } from './types';

export type GateSpec =
  | { kind: 'release'; confirmations: number }
  | { kind: 'choices'; choices: string[]; confirmations?: number }
  | { kind: 'rule'; rule: string };

export interface MachineConf {
  agent?: string;
  model?: string | null;
  effort?: string | null;
  /** the machine's default goal; empty removes it */
  goal?: string | null;
  attempts?: number;
  timeout?: string;
  roles?: string[];
  dirs?: string[];
  tools?: string[];
  /** commands it may run besides the defaults (D44) */
  allow?: string[];
  /** commands it must never run; an empty list removes the key */
  deny?: string[];
  /** its commands and tools that act outside the machine (D48); an empty list removes the key */
  outward?: string[];
  /** no file edits and no `git push`; false removes the key */
  read_only?: boolean;
}

export interface ManagerConf { agent?: string; model?: string | null; tools?: string[] }

/** Where a new piece goes: on the belt from → to, or as a new path out of `from`. */
export interface Slot { from: string; to?: string }

export type BuildOp =
  | { op: 'newSector'; id: string; name: string; color: string }
  | { op: 'newLine'; sectorId: string; id: string; name: string; model: string; newModel?: boolean; direction?: Direction; params?: Record<string, string> }
  | { op: 'separateModel'; lineId: string; model: string }
  | { op: 'insert'; lineId: string; at: Slot; kind: 'machine' | 'signal' | 'gate'; id?: string; label?: string }
  | { op: 'connect'; lineId: string; from: string; to: string; when?: string; laps?: number }
  | { op: 'disconnect'; lineId: string; from: string; to: string; back?: boolean }
  | { op: 'setRule'; lineId: string; from: string; to: string; back?: boolean; when?: string | null; laps?: number }
  | { op: 'remove'; lineId: string; pieceId: string }
  | { op: 'setPiece'; lineId: string; pieceId: string; label?: string; goal?: string; gate?: GateSpec; run?: string; /** signal time limit; empty removes it (D19) */ timeout?: string }
  | { op: 'setIntake'; lineId: string; label?: string; inputs?: InputField[] }
  | { op: 'setMachine'; lineId: string; pieceId: string; conf: MachineConf }
  | { op: 'writeFile'; path: string; content: string; executable?: boolean }
  | { op: 'setLine'; lineId: string; name?: string; direction?: Direction; params?: Record<string, string>; repo?: string | null }
  /** commands no machine of the line's model may run (D44); an empty list removes the key */
  | { op: 'setModel'; lineId: string; deny?: string[] }
  | { op: 'setSector'; sectorId: string; name?: string; color?: string; policy?: Policy; manager?: ManagerConf; deny?: string[] }
  | { op: 'setFactory'; name?: string; ceiling?: Policy; generalManager?: ManagerConf; lineContext?: boolean; deny?: string[] }
  | { op: 'removeLine'; lineId: string }
  | { op: 'removeModel'; sectorId: string; model: string }
  | { op: 'removeSector'; sectorId: string }
  /** several edits as one undo step */
  | { op: 'batch'; ops: BuildOp[] };

export interface BuildIssue {
  kind: 'load' | 'reach' | 'rule' | 'route' | 'policy';
  message: string;
  /** lines the issue marks on the Floor */
  lineIds: string[];
  pieceId?: string;
}

export interface FileChange {
  path: string;
  status: 'added' | 'changed' | 'removed';
  /** the file on disk when the session first touched it, and the draft's version */
  before?: string;
  after?: string;
  /** the file changed on disk since this session read it */
  conflict?: boolean;
  /** a YAML file whose structure changed under a leading comment that may now be stale */
  staleComment?: boolean;
}

export interface BuildView {
  sectorId: string;
  /** the draft factory, shaped like the live snapshot so the Floor draws it the same way */
  factory: NonNullable<Snapshot['factory']>;
  issues: BuildIssue[];
  changes: FileChange[];
  /** lines the draft changes (including lines in other sectors that share a model or role) */
  affected: { lineId: string; name: string; sectorId: string; running: boolean }[];
  /** shared role files and the machines and lines that use them, for the reach warning */
  roles: { path: string; machines: string[]; lines: number }[];
  canUndo: boolean;
  canRedo: boolean;
  /** why saving is not allowed right now, if it is not */
  blocked: string[];
}

export interface FieldInfo { path: string; type?: string; values?: string[]; description?: string }
