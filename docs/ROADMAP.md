# Roboratory — Roadmap

Everything that is planned, open or accepted as a limit, checked against the code. Decisions are in [DECISIONS.md](DECISIONS.md) and what is built is in [CHANGELOG.md](../CHANGELOG.md).

## 1. Roadmap by version

From the assessment of the first real ticket run ([ASSESSMENT.md](ASSESSMENT.md)): trust before automation. Each version below is planned; each change of design needs its decision in DECISIONS.md before code. Real-agent runs stay limited to checks until these versions are built, because checkers and permissions are the weak points the assessment found. What a version delivered moves to [CHANGELOG.md](../CHANGELOG.md). Items with no version are in §2 and after.

### v0.8 — The engine runs without the app (D43)

The engine moves out of the Electron app into its own process; the app becomes a window onto it. The other items depend on where the engine lives: permission requests and the manager's investigations need a process that waits for you.

- **One engine per factory, started on demand** by the app or the CLI (`roboratory serve`). It keeps running when the app quits and ends with `roboratory stop`, or by itself when no run is open and no client is connected. A lock file in the factory allows one engine per factory. State stays in the factory's files.
- **A Unix socket** at `.runs/engine.sock`, open to your user only, with one JSON message per line: the methods of `src/shared/api.ts` as calls, and state updates pushed on the same channel. The Electron main process relays between the interface and the socket; the interface does not change. No network port is opened.
- **Everything in `FactoryService` moves to the engine:** runs, build-mode sessions and their locks (D41), managers and their proposals, and reloading the factory. A draft lives as long as the engine.
- **A CLI for the verbs:** `serve`, `stop`, `status`, `run <line> --input k=v`, `release`, `answer`, `retry`, `halt`, `resume` and `watch` (live events). Each is audited like the app's, as `you` with the source `cli`. Build mode stays in the app.
- **Runtime:** the packaged app's own binary in Node mode (`ELECTRON_RUN_AS_NODE=1`) runs `engine.cjs`, the engine and CLI in one bundle. The app's menu installs the `roboratory` command in `~/.local/bin` when you ask. In development, `npm run cli`.
- **New versions:** when the app finds an older engine, it offers "Restart when idle". The engine stops dispatching new work and restarts when no machine or signal is running; gates, questions and fires survive the restart.
- **The engine's log** is `.runs/engine.log`. When the engine stops unexpectedly, the app says so and offers to start it.
- **Tests** drive a real engine on a temporary factory through the same client as the CLI. Flow tests and `e2e/factory-sim-check.mjs` move to it; the engine's unit tests stay; Playwright tests cover the interface only.

Exit criteria, all with the simulated agent:
1. Quitting the app does not stop runs: a simulated line reaches its pallet with the app closed.
2. The CLI drives a simulated run to its pallet (`run`, `release`, `answer`, `retry`, `halt`, `resume`, `status`, `watch`) with no app.
3. Rebuilding and reopening the app during a run shows the current state, and the run goes on.
4. An older engine with an open run restarts by itself when idle, and no step catches fire because of it.
5. Build-mode locks apply to the CLI: `roboratory run` on a line the open draft changes is refused.
6. Flow tests and the factory dry run go through the real engine over the socket; the existing tests still pass.
7. Only your user can connect to the socket, and no network port is open.

#### Execution plan

Facts the plan rests on:
- `FactoryService` (`src/core/service.ts`) has no Electron import and reports through callbacks (`snapshot`, `logs`, `messages`, `build`); `src/main.ts` only binds it to the IPC handlers. No file under `src/core` or `src/shared` imports Electron.
- The packaged app runs as Node with `ELECTRON_RUN_AS_NODE=1` (Node 24.18.0), no Electron fuse disables it, and in that mode it reads files inside `app.asar`.
- On macOS, Node does not refuse a Unix socket path longer than about 104 bytes: it shortens it without an error, so the socket is not created at the requested path. Long paths need a fallback.

Each step ends with `npm test` and `npm run typecheck` green before the next one starts. Everything runs with the simulated agent; nothing spends money.

1. **The engine server** (`src/core/server.ts`).
   - Wraps one `FactoryService` for one factory.
   - Listens on `.runs/engine.sock` with mode 0600. When that path is too long, it listens on a socket in the temporary folder named after a hash of the factory's path, and records the path it uses in the lock file.
   - The lock file `.runs/engine.lock` holds the pid, the version and the socket path. A lock whose pid no longer exists is stale: the server removes it and its socket.
   - Protocol: one JSON object per line. Calls are `{id, method, params}` with the methods of `src/shared/api.ts`; replies are `{id, result}` or `{id, error}`; pushed events are `{event, data}` for `snapshot`, `logs`, `messages` and `build`. A `hello` call returns the version, the pid and the factory.
   - It exits when no run is open and no client is connected, after one minute of grace.
   - Tests: two servers on one factory (the second one refuses), a stale lock, a long path, the idle exit, calls and pushed events.
2. **Restart when idle** in `Engine`.
   - A global pause of dispatch, like `halt` but for every line and without writing `HALTED`: queued work waits, and nothing new starts.
   - When no machine or signal is running, the server exits and its client starts it again.
   - Tests: a pause during a simulated run lets the busy step finish and starts nothing new; after the restart, gates, questions and fires are back as they were and no step catches fire.
3. **The client** (`src/core/client.ts`).
   - The methods of `api.ts` and the pushed events, over the socket.
   - `connect(root, { start })` reads the lock and connects; with `start`, when no engine runs it starts `engine.cjs` detached, with `ELECTRON_RUN_AS_NODE=1` in the packaged app or the project's Node in development, output appended to `.runs/engine.log`, and waits for `hello`.
   - It reconnects when the socket drops and reports the engine as stopped after a few failed tries.
4. **The bundle** `engine.cjs`.
   - A new entry `src/engine.ts` (the server and the CLI) built with the main-process Vite config, so it ships in the packaged app next to `main.js`.
   - `npm run cli -- <command>` runs it in development.
   - Stop and show the engine running alone: start it from the CLI, run a simulated line to its pallet, quit, check the lock and socket are gone.
5. **The CLI.**
   - `serve`, `stop`, `status`, `run <line> --input k=v`, `release <line> <gate> [--choice c] [--note n] [--confirm n]`, `answer <line> <piece> <text>`, `retry <line> <piece> [--hint h]`, `halt <line>`, `resume <line>`, `restart --when-idle` and `watch`.
   - `watch` prints one line per run event worth acting on: gates waiting, questions, fires, reworks, and the end of a run, with the cost so far.
   - Every action is audited as `you` with the source `cli`. A refused action (for example a build-mode lock) exits non-zero with the engine's message.
6. **The app.**
   - `src/main.ts` replaces `FactoryService` with the client and relays the handlers; dialogs, the recent list and revealing files stay in the main process.
   - Opening a factory connects to its engine, starting it when needed. Quitting the app closes the connection only.
   - A banner "Engine stopped" with Start, and a banner "Engine is older than the app" with "Restart when idle".
   - A menu item "Install command-line tool" that writes `~/.local/bin/roboratory` after you confirm.
7. **Tests through the real engine.**
   - A helper starts a server on a temporary factory and connects with the client. Flow tests move to it; the `Engine` unit tests stay as they are.
   - `e2e/factory-sim-check.mjs` drives the engine through the client.
   - One test starts the engine as a separate process.
   - `e2e/headless.mjs` checks the seven exit criteria against the packaged app and the CLI.
8. **Docs and closing.**
   - PRODUCT.md (the app is a window onto the engine; the CLI), ARCHITECTURE.md §3.10 rewritten as built, CHANGELOG.md v0.8, and v0.8 removed from this roadmap.
   - CLAUDE.md: rebuilding the app no longer stops runs, and how to restart the engine.
   - An independent review by a subagent before the version is closed.

### v0.9 — Permissions, and a frozen core

1. **Permissions as a first-class feature.** Machines are already told what their shell allows (D27).
   - Permission requests at run time, handled by the engine: a command outside the list waits for you in the attention queue, to allow once or deny with a reason that goes back to the agent, instead of failing. Nothing is allowed for good. Managers get no write requests.
   - A list of hard denials that applies in every line; a line can tighten the factory's rules, never loosen them.
   - A build-mode check: a role that names commands its `allow` list does not permit gets a warning before any run.
   - Read-only machines get no file edits and no `git push`. This closes §5.5.
2. **Freeze the core.** A short specification of `line.yaml` and `machine.yaml`, with a JSON Schema the loader, build mode and editors share. New needs are solved in the factory (roles, scripts, conventions) before a new concept goes into the engine.

### v0.10 — Metrics and a cheap rehearsal

1. **Metrics per machine** from `run.jsonl` (`roboratory stats`): cost, duration, attempts, laps, denied commands, questions, blocks, and checker passes later proved wrong (a pass followed by a question or rework further down the line). Costs say whether they are estimates.
2. **A cheap rehearsal with real permissions** (`roboratory rehearse`): the real roles, signals and permissions, a cheap model, and every outward action denied, to find role and permission defects for cents. It finds defects of roles and permissions, not of quality. `e2e/factory-sim-check.mjs` keeps checking the flow for free.

### v0.11 — Checkers prove their work

The contracts of checker machines (validator, code reviewer) require what was verified: each item with the command and its result, or a link, and what was not verified. A signal after each checker confirms the list is not empty, the links exist and the listed read-only commands give the same result again; a pass without evidence fails the check itself. D18 applied to checkers. The metrics of v0.10 measure the effect.

### v0.12 — The manager investigates questions and gates

When a machine asks a question or a gate holds a box, the Sector Manager checks the cause and writes a recommended answer or choice, with what it verified and what it did not, in the same evidence shape as v0.11. It needs a read-only shell listed in `sector.yaml` (for example `gh api` GET only, `gh pr view`, `gh run view`, `git show`, `git log`); it never writes and never runs code. The recommendation sits in a closed section of the panel, and you still answer and release.

## 2. Not in a version yet: automation

Planned, not designed yet. Starts after the versions in §1. Each item needs its own decision in DECISIONS.md before code. The ticket line has been reviewed against a real run; the other lines are reviewed before these start.

1. **Timer intakes** (D14). A line starts runs on a schedule. The first use is an incident sweep (§7).
2. **Slack messages through a timer intake.** On each tick, the intake reads a channel with the Slack connector, which is read only, and starts one run per new message, never twice for the same message. A filter on the sender's user decides which messages start runs. Where the channel and the senders are configured is open: the intake in `line.yaml`, the line's `params` in `lines.yaml`, or the sector. The message is a claim for the machines to verify, never an instruction, and outward actions stay behind gates. Receiving Slack webhooks is not planned: it needs a public endpoint into the machine.
3. **The manager looks at a struggling machine.** When a machine has used half or more of its attempts, the Sector Manager reads its transcript and evidence and writes what it sees, for example a likely cause or a hint for a retry. It retries nothing on its own.
4. **The manager can call you.** When the Sector Manager sees something that needs your attention, it raises the exclamation balloon and an item in the attention queue, with its reason. It only calls; it does not act.

## 3. Planned after the MVP

None of these exist in the code yet.

1. **Proposals as ghosts.** Ghost pieces on the Floor and a ghost room in the Andon (D40). Today a manager's change appears only as a diff in the megaphone.
2. **Andon.** The whole building, with the camera transition to and from the Floor (D40).
3. **Blueprint.** The file tree, the pending diff and the commit history (D40).
4. **Webhook and chat intakes** (D14). The loader accepts these kinds and they have sprites, but nothing starts a run from them (`src/core/factory.ts`). Timer intakes are in §2.
5. **First-factory tutorial** (D38).
6. **Replaying a run on the Floor** (D40).
7. **A git identity per machine** (D9, D10). Today every machine commits as "Roboratory" (`src/core/git.ts`).
8. **Container isolation for machines** (D32).
9. **Remote or shared factories.**
10. **A command-line interface for the verbs** (D30). Planned in v0.8 (§1).
11. **An interactive terminal in a machine's folder.** No PTY is in the project.

## 4. Not yet verified with real agents

1. A real Codex run.
2. A real draft PR on GitHub: `node e2e/real-agent-check.mjs --github owner/repo`.
3. The lines of the reference engineering factory (D42). Only one step has run for real, a data framing step that cost US$ 4.64 on opus before it moved to sonnet. Unverified until full runs:
   - whether the incident tool's API can set custom fields and decline an incident, and whether follow-up creation can set a team;
   - the real durations of the signal scripts and CI watches.

Besides the real ticket run (US$ 8.03), the only other real run is a two-machine check line: 32 s, US$ 0.46. Every real run costs money, so it starts with a cost estimate.

## 5. Known limitations, accepted on purpose

1. Only the latest gate's decision travels in the box. Earlier decisions stay in the evidence of the machine that received them (D17).
2. Machines are kept to their folders by instruction only (D9, D32).
3. A Sector Manager stays inside its sector by instruction only, and your review is the guard (D29).
4. Gemini CLI and OpenCode are not supported, as machines or as managers.
5. Every machine gets file edits and `Bash(git:*)` from the Claude adapter (`src/core/agents/claude.ts`), so a step that should only read could still `git push`. Some steps also keep `gh api` or full `Bash`. Gates before outward actions are enforced by the roles, not by tool permissions. A per-machine read-only mode or deny rules would close this.
6. A run that stops on a fire never reaches the PR review line's cleanup signal, so its worktree stays in `~/repos/<repo>` until removed by hand.
7. During an incident, the line writes status updates as paste-ready drafts that you post yourself. It writes to the incident tool only at close-out, because the engine has no timer to follow the update cadence.
8. The postmortem leaves some fields as TBD for you to fill in.

## 6. Build mode: known gaps (D41)

1. Comments inside a block `needs:` list are lost when that piece's inputs change; the rest of the file keeps them.
2. A machine's `sim:` block (the simulated agent's script) has no form; edit `machine.yaml` by hand.
3. Tools are picked per MCP server; a single tool's name is typed and checked only by its server prefix, because `claude mcp list` lists servers, not tools.
4. Switching a gate from choices to another kind and back resets its choices; a new rule gate stays red until its rule is written.
5. After "connect to…" makes a return belt, the destination's panel opens and its rule control can sit below the machine's sections.
6. Signal and gate names on the Floor are not clickable; their sprites are.
7. Some actions that will be refused are enabled and fail with a message instead of being disabled: dispatching a changed line from its live panel, a duplicate line id, creating a sector while the current one has changes.
8. While the draft removes the current sector, "+ Sector" and "⚙ Factory" are unavailable until you save or undo.
9. Quitting the app with an open draft discards it without asking.
10. A line with a loop of forward belts, which build mode cannot create, still drops out of the draft until it is fixed by hand.
11. Text-mode rules are not checked against the box's fields until the save checks run.
12. Changes made outside build mode (by hand or `git checkout`) can still reach a line with a run in progress.

## 7. Open questions on the reference engineering factory (D42)

1. **Watchdogs** (an incident sweep on a timer). They need timer intakes (§2.1).

## 8. Considered, not planned

1. An `mcp_config:` setting per machine.
2. A paid PR-review run with real agents (estimated at US$ 1 to 5).
3. Letting the Sector Manager start runs on its own through the sector policy (`run` automatic, D34), for example to pick tickets from the backlog. Runs are started by people; the manager can call them instead (§2.4).

## 9. Ideas from Harness²

[Harness²](https://github.com/google-research/harness2) ([paper](https://arxiv.org/abs/2610.14224)) improves the harness of one agent per task: it runs the task with the current harness, then with an invariant and a domain-specific candidate, and an LLM composer merges what the execution contrasts support. Each task starts again from the base harness; what carries over is an advisory library of adopted harnesses with an `EXPERIENCE.md` each. Ideas that fit Roboratory without breaking D29:

1. **Selection criteria in checker roles.** The validator and code reviewer judge, in order: the deliverable exists, it has the requested shape, it is faithful to its sources, it is consistent with itself; length and polish are not merits. Text only; it complements v0.11 (§1).
2. **A lessons library per sector.** After a run, the Sector Manager proposes a lesson with its evidence (the situation, what changed and the execution contrast that supports it), as a diff to `role.md` or `culture.md`, or as an entry under `sectors/<sector>/lessons/`. You accept or reject it. Machines read the entries as examples and check them against the current run. In Harness², removing the library cost about 2 to 3 points.
3. **Rehearse role variants on recorded boxes,** for checkers only. Run two versions of a checker's role on the box of a past run with a cheap model, and keep the one that finds what the real run later showed (for example, the plan that would have broken authentication). Never for machines with outward actions. It extends the rehearsal in v0.10 (§1).
4. **The eight harness components as a checklist** for what a machine can configure: system prompt, guardrails, memory, skills, tool guidance, scripts, subagents and plugins. Roboratory has no memory across runs and no plugins, and denies subagents on purpose (D9).
