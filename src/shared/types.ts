// Types shared by the main process (core) and the renderer (app).

export type IntakeKind = 'manual' | 'timer' | 'webhook' | 'chat';
export type Direction = 'right' | 'left';

export interface InputField {
  name: string;
  label?: string;
  required?: boolean;
  placeholder?: string;
  /** a long answer, such as a question: the form shows a text area */
  multiline?: boolean;
}

/** An incoming belt. `when` makes it a splitter branch. */
/** The longest goal a piece may have, in characters. */
export const GOAL_MAX = 250;

export interface Need {
  from: string;
  when?: string;
  /** a return belt: rework flows back to an earlier machine (D15) */
  back?: boolean;
  /** how many times a box may come back along this belt in one run */
  laps?: number;
}

export type PieceKind = 'intake' | 'machine' | 'signal' | 'gate' | 'pallet';

export interface PieceDef {
  id: string;
  kind: PieceKind;
  label: string;
  needs: Need[];
  /** machine: name of the machine folder */
  machine?: string;
  /** signal: shell command template */
  run?: string;
  /** signal: time limit as written in line.yaml, e.g. "40m" (D19) */
  timeout?: string;
  /** signal: time limit in milliseconds, when `timeout` is set */
  timeoutMs?: number;
  /** gate: rule expression over the box */
  rule?: string;
  /** gate: how many "are you sure?" confirmations a release asks for */
  confirmations?: number;
  /** decision gate: the choices offered to the human (D17) */
  choices?: string[];
  /** what this piece is for in this line, in a sentence or two (GOAL_MAX); a machine piece without one uses its machine's goal (D25) */
  goal?: string;
}

/** The agents a machine or manager can use: one adapter each, behind the AgentRunner port (D45). */
export const AGENTS = ['claude', 'sim'] as const;
export type AgentName = (typeof AGENTS)[number];

export interface MachineDef {
  name: string;
  /** folder the machine is defined in */
  dir: string;
  role: string;
  contract: Record<string, unknown>;
  agent: string;
  model?: string;
  attempts: number;
  timeoutMs: number;
  /** MCP tool names, e.g. mcp__new-relic__run_nrql_query */
  tools: string[];
  /** commands the machine may run besides the defaults, as prefixes (`npm test`) or tool names (`Edit`) (D44) */
  allow: string[];
  /** commands it must never run; adds to the factory's, the sector's and the line's (D44) */
  deny: string[];
  /** no file-editing tools and no `git push` (D44) */
  readOnly: boolean;
  /** extra directories the agent may use, e.g. ~/repos */
  dirs: string[];
  /** Claude Code effort level (low, medium, high, max) */
  effort?: string;
  /** the machine's default goal, used by pieces whose line gives none (D25) */
  goal?: string;
  /** options for the built-in simulated agent */
  sim?: Record<string, unknown>;
  shared: boolean;
}

export interface LineModel {
  name: string;
  dir: string;
  shared: boolean;
  intake: { kind: IntakeKind; inputs: InputField[]; label?: string };
  pieces: PieceDef[]; // includes intake (id '@intake') and pallet (id '@pallet')
  machines: Record<string, MachineDef>;
  /** commands no machine of the line may run, added to the sector's and the factory's (D44) */
  deny: string[];
}

export interface LineDef {
  id: string;
  name: string;
  sectorId: string;
  model: LineModel;
  direction: Direction;
  params: Record<string, string>;
  /** absolute path to a target git repository, if the line works on one */
  repo?: string;
}

export interface VerbPolicy {
  auto?: number; // how many times per run a manager may run it alone
}
export type Policy = Partial<Record<VerbName, VerbPolicy>>;

export interface ManagerDef {
  agent: string;
  model?: string;
  role: string;
  tools: string[];
}

export interface SectorDef {
  id: string;
  name: string;
  color: string;
  dir: string;
  /** sectors/<id>/culture.md, appended after the factory culture (D23) */
  culture: string;
  policy: Policy;
  /** commands no machine of the sector may run, added to the factory's (D44) */
  deny: string[];
  manager: ManagerDef;
  lines: LineDef[];
}

export interface FactoryDef {
  root: string;
  name: string;
  ceiling: Policy;
  /** commands no machine may run (D44); the template starts a factory with a list */
  deny: string[];
  generalManager: ManagerDef;
  /** culture.md at the root, appended to every agent's role (D23) */
  culture: string;
  /** machines are told their place in the line unless a machine says otherwise (D25) */
  lineContext: boolean;
  sectors: SectorDef[];
  /** problems found while loading; the factory still loads what it can */
  warnings: string[];
  /** Structural problems a tolerant load (build mode's draft) kept instead of failing on. */
  problems?: LoadProblem[];
}

export interface LoadProblem { model?: string; pieceId?: string; message: string }

export type VerbName = 'run' | 'retry' | 'release' | 'halt' | 'resume' | 'apply' | 'answer' | 'allow' | 'deny';

// ---------- runtime state ----------

export type PieceState = 'idle' | 'busy' | 'fire' | 'holding' | 'passed' | 'skipped' | 'waiting' | 'asking';

export interface HumanQuestion { question: string; options?: string[]; recommendation?: string }

export interface BoxView {
  id: string;
  runId: string;
  /** where the box is: on a belt (edge) or at a piece */
  at: { piece: string } | { from: string; to: string; since: number; ms: number };
  color: string;
  payload: Record<string, unknown>;
}

export interface PieceView {
  id: string;
  state: PieceState;
  runId?: string;
  queue: number;
  attempt?: number;
  attempts?: number;
  error?: string;
  /** gate: confirmations given so far for the current box */
  confirmed?: number;
  /** signal/gate: when the current check or hold started (for loading bars) */
  since?: number;
  lastBox?: Record<string, unknown>;
  lastRunId?: string;
  pallet?: number;
  /** a machine that needs you (D21) */
  question?: HumanQuestion;
  /** permission requests this machine waits on you for (D44) */
  permissions?: PermissionAsk[];
}

/** A command or tool a machine asks to use, and is waiting on a person for. */
export interface PermissionAsk { id: string; tool: string; /** the command, or the tool and what it was given */ summary: string; since: number }

export interface LineView {
  id: string;
  sectorId: string;
  halted: boolean;
  pieces: Record<string, PieceView>;
  boxes: BoxView[];
}

export type RunStatus = 'running' | 'done' | 'stopped' | 'fire' | 'halted';

export interface RunSummary {
  id: string;
  sectorId: string;
  lineId: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  input: Record<string, unknown>;
  baseCommit?: string;
  dirty?: boolean;
  deliverable?: Record<string, unknown>;
}

export type Level = 'factory' | 'sector' | 'machine';

export interface LogEntry {
  t: number;
  level: Level;
  sectorId?: string;
  lineId?: string;
  pieceId?: string;
  runId?: string;
  kind: 'info' | 'ok' | 'warn' | 'fail' | 'tool' | 'text' | 'you' | 'manager';
  text: string;
}

export interface AttentionItem {
  id: string;
  severity: number; // higher first
  kind: 'fire' | 'gate' | 'signal' | 'proposal' | 'question' | 'permission';
  /** a permission request waiting for `allow` or `deny` (D44) */
  requestId?: string;
  sectorId: string;
  lineId: string;
  pieceId: string;
  runId?: string;
  since: number;
  title: string;
  detail: string;
}

export interface Proposal {
  id: string;
  kind: 'verb' | 'patch';
  why: string;
  verb?: VerbName;
  target?: { lineId: string; pieceId?: string; runId?: string };
  args?: Record<string, string>;
  files?: { path: string; content: string; before?: string }[];
  status: 'open' | 'applied' | 'rejected' | 'auto';
}

export interface ManagerMessage {
  id: string;
  t: number;
  from: 'you' | 'manager';
  text: string;
  evidence?: { runId?: string; lineId?: string; pieceId?: string; note?: string }[];
  proposals?: Proposal[];
  pending?: boolean;
  error?: string;
}

export interface Snapshot {
  factory: {
    root: string;
    name: string;
    warnings: string[];
    hasCulture: boolean;
    lineContext: boolean;
    sectors: {
      hasCulture: boolean;
      id: string;
      name: string;
      color: string;
      policy: Policy;
      lines: {
        id: string;
        name: string;
        direction: Direction;
        model: string;
        sharedModel: boolean;
        repo?: string;
        params: Record<string, string>;
        intake: LineModel['intake'];
        pieces: (PieceDef & {
          role?: string;
          contract?: Record<string, unknown>;
          agent?: string;
          tools?: string[];
          sharedMachine?: boolean;
          /** the machine's default goal from machine.yaml */
          machineGoal?: string;
          definedIn?: string;
          usedBy?: { lines: number; sectors: number };
        })[];
      }[];
    }[];
  } | null;
  lines: Record<string, LineView>;
  attention: AttentionItem[];
  now: number;
}
