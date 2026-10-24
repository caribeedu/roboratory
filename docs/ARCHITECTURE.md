# Roboratory — Architecture

How Roboratory is built. Product behavior is in [PRODUCT.md](PRODUCT.md); the reasoning behind each choice is in [DECISIONS.md](DECISIONS.md).

## 1. Stack

| Concern | Choice | Why |
|---|---|---|
| App shell | Electron + TypeScript (strict) | Local files, child processes and native notifications on every OS from one codebase |
| Floor renderer | PixiJS (WebGL, nearest-neighbor scaling) | Sprite-based pixel art with many animated pieces and a pannable, zoomable camera |
| HUD panels | React | Inspector, megaphone, minimap chrome, views |
| Contract validation | Ajv | Validates each machine's output against its JSON Schema |
| Engine | A Node process per factory (the app's binary in Node mode), reached over a local socket | Runs go on when the app quits, and the `roboratory` command drives the same engine |
| Agent processes | Child processes running each agent CLI headless | Process exit marks the end of a step |
| Runtime state | JSONL per run and per manager conversation, under `.runs/` | Open, greppable formats with no database server |
| Fonts | Pixelify Sans, Atkinson Hyperlegible, JetBrains Mono, bundled | The app works offline |

PixiJS gives the look: every sprite is drawn procedurally on a canvas at one texel per pixel and scaled with nearest-neighbour filtering. Pixi's `pixi.js/unsafe-eval` module is loaded so it runs under the app's Content Security Policy. Labels are DOM text on a layer that follows the camera, so they stay sharp at any zoom.

## 2. Factory repository layout

A factory is a git repository. Everything that defines behavior is a file in it.

```
my-factory/
  factory.yaml                 # name, policy ceiling, General Manager settings and tools
  general-manager/
    role.md
    contract.json              # answer, evidence, proposals
  shared/                      # roles, contracts, signals and line models any sector can reference; curated by the General Manager
  sectors/
    incidents/
      sector.yaml              # name, minimap color, sound, policy, manager tools
      manager/
        role.md
        contract.json
      models/
        triage-to-mitigation/
          line.yaml            # intake, pieces, belts, gates
          machines/
            investigator/
              role.md
              contract.json
              machine.yaml     # agent template, tools, attempts, timeout
          signals/
            error-rate.sh
      lines.yaml               # production lines: [{ id, model, params, direction }]
  .runs/                       # gitignored runtime state
```

### 2.1 `line.yaml` sketch

```yaml
intake:
  kind: webhook                  # manual | timer | webhook | chat
  source: incident-io
  filter: { severity: [sev1, sev2] }
pieces:
  - id: correlate
    machine: correlator          # machines/correlator/
  - id: investigate
    machine: investigator
    needs: [correlate]
  - id: confident
    gate: { rule: "confidence >= 0.7" }
    needs: [investigate]
  - id: signoff
    gate: { confirmations: 2 }     # a release button that asks "are you sure?" twice
    needs: [confident]
  - id: mitigate
    machine: mitigator
    needs: [signoff]
  - id: error-rate
    signal: { run: "signals/error-rate.sh {{params.service}}", timeout: 20m }   # 10m when not set (D19)
    needs: [mitigate]
pallet:
  needs: [error-rate]            # passive: holds the final box and shows the deliverable
```

Decision gates and return belts:

```yaml
  - id: decision
    gate: { choices: [hotfix, rollback, investigate, monitor] }
  - id: remediate
    machine: developer
    needs:
      - { from: decision, when: "decision.choice == 'hotfix'" }
      - { from: verify, when: "verdict == 'fail'", back: true, laps: 3 }
      - { from: tests, when: "signal == 'fail'", back: true, laps: 3 }   # a failing signal sends the box back (D20)
  - id: verify
    machine: qa
  - id: tests
    signal: { run: "signals/tests.sh" }
```

A splitter belt is declared on the edge, not as a piece:

```yaml
  - id: plan
    machine: planner
    needs: [{ from: triage, when: "type == 'bug'" }]
  - id: respond
    machine: responder
    needs: [{ from: triage, when: "type == 'question'" }]
```

### 2.2 `machine.yaml` sketch

```yaml
agent: claude                     # resolves to a headless template
model: opus
effort: high                      # Claude Code --effort
goal: "Find the likely cause of an alert, with evidence"   # default goal; a piece's goal in line.yaml replaces it (D25)
attempts: 3
timeout: 10m                      # a timeout counts as a failed attempt
roles: [shared/roles/commander.md]   # shared role files (factory-relative), then this folder's role.md
dirs: ["~/repos"]                 # extra directories the agent may use
tools: [mcp__claude_ai_Atlassian, mcp__newrelic]   # a whole server, or mcp__<server>__<tool>
allow: ["Bash(gh:*)"]             # extra permission rules for the agent
```

Roboratory does not configure MCP servers. On start, it reads `claude mcp list` and warns about any server named by a listed tool that is missing.

Headless templates live in the app, one adapter per supported agent CLI in `src/core/agents/`, and machines reference them by name. The engine gives every adapter the contract and its alternatives, a question (D21) or blocked (D22); the adapter decides how to ask its CLI for them:

| Agent | Template | Checked |
|---|---|---|
| `claude` | `claude -p {prompt} --output-format stream-json --verbose --json-schema '{schema}' --permission-mode dontAsk --allowedTools "Read,Grep,Glob,Edit,Write,Bash(git:*),{allow},{tools}" --disallowedTools Agent --append-system-prompt {role} --add-dir {siblings}`. The schema is the contract or an alternative under `result` (§3.2.1); the answer comes back in `structured_output`, and the stream feeds the live transcript. Sub-agents are denied, so a step's work stays in its own context and transcript. Unless the shell is open (`Bash`), the prompt ends with the shell rules built from the allowed tools (D27). | Local `--help` and docs |
| `codex` | `codex exec {role+prompt} --output-schema {contract-file} -o {out} --sandbox workspace-write --add-dir {siblings}` | Local `--help` |
| `sim` | A built-in simulated agent configured by the `sim:` block of `machine.yaml` (duration, transcript, files to write, output). It costs nothing and is what the demo factory uses. | Tests |

Gemini CLI and OpenCode are not supported yet.

## 3. Runtime

### 3.1 A run
A run is one box's trip through one production line. Its folder is `.runs/<sector>/<line>/<run-id>/`:

```
run.jsonl                # every event of the run: boxes, attempts, verbs, timings
machines/
  investigate/           # one folder per machine piece id; the agent's working directory
  correlate/
```

### 3.2 A machine step
1. The broker saves the incoming box as JSON: in the machine's folder, or, on a line with a target repository, in the run's `boxes/` folder so it never gets committed.
2. It starts the agent's headless template with the role, the box, the contract and, unless `factory.yaml` sets `line_context: false`, the machine's place in the line with the goals of the pieces around it (D25). The machine's folder is the working directory, and the other machines' folders of the same run are passed as extra directories.
3. When the process exits, the broker extracts the JSON output and validates it with Ajv.
4. If the output is valid, it becomes the outgoing box.
5. If it is invalid, or the timeout passes, the broker re-runs the step with a fresh agent and the validation errors added, until the attempt budget runs out.
6. When the budget runs out, the machine is on fire and the line stops behind it.

Each machine starts with a clean agent context. Only the box and the machine folders of the run carry information forward.

### 3.2.1 Culture, questions and rework
- **Culture:** the agent's system prompt is its role, then `culture.md`, then `sectors/<sector>/culture.md`.
- **Questions and blocks:** Claude Code gets `{ result: { anyOf: [contract, { needs_human: { question, options, recommendation } }, { blocked: { reason } }] } }`. Claude's tool schemas refuse `anyOf`/`oneOf`/`allOf` at the root but accept them nested, so the API itself holds the agent to one of them, required fields included; the adapter unwraps `result`. Codex gets the bare contract. A question parks the machine; the answer reruns it with `human_answer` in the box and does not count as an attempt. A block records `piece.blocked` and sets the machine on fire with its reason, without spending the remaining attempts; a retry reruns it.
- **Human actions in the prompt (D26):** with line context on, the prompt lists the run's `verb` events for releases, retries and answers, read from `run.jsonl`, with the pass of the piece each one was on (counted from `piece.start` and `piece.hold`). A restart needs nothing more.
- **Rework:** a box sent down a return belt reopens its target and every piece between the target and the checker. The target reruns in its existing folder with the checker's box under `feedback`; on a repository line, a reopened machine first merges its upstream branches into its worktree. Each run counts laps per return belt. The run records `rework` events, the box each step started with, and return belts still in flight, so a restart rebuilds the same state and delivers those boxes. A return belt's own merge never flows backwards: upstream branches are those on forward belts only. A rework also forgets what the last lap left behind downstream: pieces after the target that were skipped are reopened, and every arrival or skip sent by a reopened piece to a piece that has not run yet is dropped, so the new lap routes on its own decisions.
- **Failing signals (D20):** a signal that exits non-zero builds the box it would send back: its input plus `signal: 'fail'` and `signal_output` (its last 40 lines and the reason). If a return belt from the signal accepts that box, the signal finishes along its return belts only, with its `piece.done` marked `failed` (the Ledger shows it failed, and it is not the signal's last box), and the target reworks as above; otherwise the signal catches fire. A signal stopped at its time limit always catches fire: waiting too long is not a fault in the work (D19).
- **A verdict on an old input (stale results):** when a piece starts work it notes how many outputs each piece upstream of it has made. If an upstream piece makes a new output while it works (a rework made it again), the result is about the old input: it is dropped, and the piece takes the new input as soon as it is free. A checker that was slow to judge the first output therefore cannot send the piece back a second time for it; a checker whose verdict arrives while the rework is still queued is merged into it, as above. Build mode offers `signal` and `signal_output` to rules on belts that start at a signal.

### 3.3 Target repositories: one worktree per machine, chained
When a line works on a target repository (for example `orders-api`):
- Each machine's folder is a git worktree of that repository, on its own branch created from the previous machine's branch.
- The agent does its own git work, as its role instructs: commits, pushes, opening a pull request.
- When the process exits successfully, the broker commits anything the agent left uncommitted, so no work is lost.
- The next machine starts from that commit. Signals run in the worktree of the nearest machine before them (at a join, the first one).
- Where belts join, the broker merges the incoming branches. A merge conflict sets the next machine on fire, with the conflict as the error.
- The final branch's history shows which machine did what. Each machine folder is meant to get its own git identity later; identities are out of the MVP.

Delivery follows the same rule as everything else: the agent publishes (for example opens the PR), the contract requires a note of it (`pr_url`, branch, title), and a signal before the pallet verifies it, for example `gh pr view {{box.pr_url}} --json state,isDraft,headRefName`. The pallet itself does nothing.

### 3.4 Scope
- **Machines** are told which folders belong to their run. Nothing stops an agent from reading elsewhere. Containers or an OS sandbox remain an option if this ever matters.
- **Managers** run read-only through the agent CLI: Claude Code with `--tools "Read,Grep,Glob"`, `--permission-mode dontAsk` and only the sector's listed MCP tools allowed; Codex with `--sandbox read-only`. They deliver changes as patches inside their contract answer, and Roboratory writes them only when you accept. A Sector Manager is told to stay inside `sectors/<its-sector>/`; your review is the guard for that.
- Gemini CLI and OpenCode have no verified read-only mode, so they are not supported as managers until one is confirmed.

### 3.5 Git in the factory repository
Roboratory reads the factory repository's git state and never writes to it. (Target repositories are different: see §3.3.)
- It shows the pending diff against the last commit and the commit history.
- It does not commit, push or branch. Accepting a proposal or confirming build mode only writes files.
- Lines run from the files on disk. Each run records in its `run.jsonl` the commit it started from and, when the working tree has uncommitted changes, the exact diff in effect.

### 3.6 Verbs
All actions go through one engine API: `run`, `retry`, `release`, `halt` and `resume`, plus accepting a manager's change.
- UI buttons, manager proposals and the `roboratory` command (D43) call it. Calls from the command also carry `source: "cli"`.
- Every call is appended with the actor and the time: to each affected run's `run.jsonl`, and for halts, resumes and accepted changes also to `.runs/<sector>/audit.jsonl`.
- A halted line stays halted across restarts (`.runs/<sector>/<line>/HALTED`).

### 3.7 Policy
- `sector.yaml` declares which verbs its Sector Manager may run on its own, and how many times: per run for `retry`, per line per day for `run` and `halt`. A new sector allows none.
- `factory.yaml` declares the ceiling. It may allow `retry`, `run` and `halt` to be granted per sector, with limits. `release` and applying changes can never be automatic.
- The broker applies the stricter of the two. Managers also lack any tool that could open a gate or write a file (§3.4), so the ceiling holds even if a policy file is wrong.

### 3.8 Managers
Managers are agents run headless on demand when you ask them something. Each runs read-only under its own contract (`answer`, `evidence`, `proposals`), with the factory's state, runs and files plus the MCP tools listed in `sector.yaml` (or `factory.yaml` for the General Manager). A verb proposal is checked before it is shown: it must name a valid verb and target. A change proposal carries a patch, shown as ghosts and a diff for review.

### 3.9 Build mode
Build mode edits the factory through a draft in the engine process (§3.10); the renderer sends edits and draws what comes back (D41). The code is in `src/core/build/`.
- **Draft.** A draft is an overlay of file changes over the disk (`vfs.ts`): a written file replaces the one on disk, and a deletion hides a file or a whole folder. The loader reads through the overlay, so the Floor draws the draft with the same loader as the live factory. In tolerant mode the loader keeps structural problems (an unknown input, a return belt without a rule, a missing machine, a duplicate id) instead of failing, so a half-edited line can still be drawn.
- **Edits.** Each edit is a function over the draft (`ops.ts`): insert, connect, disconnect, set a rule, remove, piece and machine settings, files, line, sector and factory settings, new sectors, lines and models, separating a model. A piece with no `needs` implicitly needs the piece before it in the list, so before an edit changes which piece comes first, the affected piece's needs are written out explicitly. Ids become folder names and are checked first; nothing outside the factory, nor `.git` or `.runs`, can be touched. A new machine never replaces or shadows a machine of the same name.
- **YAML in place.** An edited YAML file keeps every line the edit did not touch as it was written, comments included; only new or changed lines come from the YAML writer, in the file's style. If re-reading a file would move its line breaks (multi-line strings), the whole file is rewritten.
- **Checks.** Before saving (`checks.ts`): the factory loads with no warnings or problems; every piece has an input and a way out, is reachable from the intake and reaches the pallet; every rule reads a field the previous box has (`fields.ts`: a machine's contract, a gate's choices as `decision.choice`, gates and signals passing their input on) and compares enum fields only to their values; every value a piece routes on with `==` or `in` has a belt that takes it; sector policy stays within the ceiling, and `release` and applying changes are never automatic.
- **Session.** One per sector (`session.ts`), with undo and redo. It remembers what each touched file held on disk, so a file changed on disk meanwhile, or added inside a folder the draft removes, is a conflict you resolve file by file. It lists the lines a draft affects: their model, machines, shared roles, sector and factory culture, shared signals, and their own entry in `lines.yaml`. Saving is refused while problems remain or an affected line has a run in progress; it checks every target, writes new content to temporary files under `.runs/`, removes what the draft removes, then moves the new files into place.
- **Locks.** While a session is open, dispatching a line the draft changes is refused for every caller (you, a manager's proposal, a policy auto-run), and accepting a manager's change is refused. A manager's change to a line with a run in progress waits too.

### 3.10 The engine process (D43)
The engine runs in its own process, one per factory. The app and the `roboratory` command are clients of it, so runs go on when the app quits or is rebuilt.
- **Server (`src/core/server.ts`).** It wraps one `FactoryService` and listens on a local socket: `.runs/engine.sock` with mode 0600 on macOS and Linux, and a named pipe (`\\.\pipe\roboratory-<user>-<hash>`) on Windows. When the socket path would pass about 100 bytes (macOS shortens longer ones without an error), it uses a socket in the temporary folder named after the user and a hash of the factory's path. No network port is opened. The socket's permissions are not what keeps others out (Windows pipes and the temporary folder are shared); the token below is.
- **Lock and token.** `.runs/engine.lock` (mode 0600) holds the pid, the version, the start time, the socket path and a random token. Starting a second engine for the factory is refused. A lock whose pid no longer exists is stale and is replaced; so is one whose pid is alive but where nothing listens after ten seconds (a reused pid). Breaking a lock is a rename, so only one starter does it, and the socket path to clean up is always the one computed for the factory, never one read from the lock. A client works out the socket path itself and sends the token in its first call; the engine answers nothing and pushes nothing to a connection that has not said `hello` with the right token, so only someone who can read your factory's `.runs/` can use the engine.
- **Protocol.** One JSON object per line. A call is `{id, method, params: [...]}` with the methods of `src/shared/api.ts` (`state`, `run`, `release`, the `build*` calls and so on), and its reply is `{id, result}` or `{id, error}`. The engine pushes `{event, data}` on the same connection: `snapshot`, `logs`, `messages`, `build` and `restarting`, and, to clients that called `watch`, `watch` events for what needs you. `hello` takes `{client, token}` (`client: 'cli'` makes the connection's verbs audited with `source: "cli"` next to the actor `you`) and returns the version, the pid and the factory. `status`, `stop`, `restartWhenIdle`, `cancelRestart` and `watch` are the engine's own calls.
- **Client (`src/core/client.ts`).** `EngineClient.connect(root, { start, launch })` reads the lock and connects; with `start`, when no engine runs, it starts the bundle detached, with its output appended to `.runs/engine.log`, and waits for `hello`. It reconnects when the connection drops, starting a newer engine when the old one announced a restart, and reports `stopped` after a few failed tries.
- **Bundle.** `src/engine.ts` is the engine and the command in one file (`engine.js` next to `main.js` in the packaged app). The packaged app runs it with its own binary in Node mode (`ELECTRON_RUN_AS_NODE=1`); `npm run cli` bundles it with esbuild and runs it with the project's Node. `src/cli.ts` holds the commands; the app's menu writes a `roboratory` launcher into `~/.local/bin` (`src/core/install.ts`) when you ask.
- **Lifetime.** The engine ends with `roboratory stop`, or by itself after a minute with no run open and no client connected. Runs, build-mode drafts and their locks, managers and proposals live in the engine; a draft lasts as long as the engine does.
- **New versions.** A client that finds an engine of another version, or of another build of the same version (a hash of the bundle, `src/core/buildid.ts`: a rebuilt app does not wait for ⌘Q to take effect), offers "Restart when idle". `restartWhenIdle` pauses dispatch for every line: queued work waits, and nothing new starts, but gates still take boxes. When no machine or signal is running, the engine leaves and a client starts the new one: the app does it by itself, and `roboratory restart --when-idle` stays connected until the new engine is up. A client that connects to an engine already waiting to restart takes over that job. Everything the new engine needs is in `run.jsonl`: gates come back holding, questions asking, fires on fire, and boxes that were queued are rebuilt from the belts that had delivered them. During the pause new runs, answers and retries are refused (an answer or a retry hint lives in memory until its step starts, so a restart would lose it), and so is the request itself while build mode holds a draft, which also lives only in the engine.
- **Windows.** A pipe closed by the server drops what the client has not read, so the engine waits a moment before closing connections. An engine started by a process that holds pipes (a test harness) inherits them; this only matters to a parent that waits for those pipes to close.

## 4. Visual system
- Three-quarter top-down camera and nearest-neighbor pixel art.
- The Floor renders one sector room in full detail. The Andon renders every room at a lower level of detail (state colors, fires and balloons only), which keeps drawing the whole building affordable.
- Floor and Andon share one world and one camera, and switching between them is a camera transition.
- One floor tile set inside and around lines, with walls on the sides and back. The room resizes to fit the sector's lines.
- State is always shown in form as well as color: the worker's animation, smoke, fire, the exclamation balloon, signal lamps, gate bars.
- Loading bars appear on signals and loading screens, never on machines or gates (D37).
- The minimap is a HUD element and changes a sector's color when it needs you. Attention sounds play once per new event.
