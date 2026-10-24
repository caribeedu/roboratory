# Changelog

What Roboratory delivers. The reasoning behind each choice is in [docs/DECISIONS.md](docs/DECISIONS.md), and what is still open is in [docs/ROADMAP.md](docs/ROADMAP.md).

## v0.8.0

The engine moves out of the app. It runs as its own process, one per factory, and the app and a new `roboratory` command are clients of it: runs go on when the app quits or is rebuilt, and every verb can be driven from a terminal (D43).

### The engine process
- **One engine per factory, started on demand** by the app or the command, with a lock in `.runs/engine.lock`. It ends with `roboratory stop`, or by itself after a minute with no open run and no connected client. Its log is `.runs/engine.log`.
- **A local socket,** with one JSON message per line: the methods of the app's API as calls, and state updates pushed on the same connection. It is a Unix socket at `.runs/engine.sock` on macOS and Linux, a path in the temporary folder when that one is too long, and a named pipe on Windows. No network port is opened, and the engine serves only connections that open with the token in its lock file, which only you can read.
- **Everything the service did now lives in the engine:** runs, build-mode drafts and their locks, managers and their proposals, and reloading the factory. A draft lasts as long as the engine.
- **The app is a window onto it.** The main process relays between the interface and the socket and reconnects when the connection drops. Closing a factory or quitting the app only drops the connection. A banner offers to start an engine that stopped, and to restart one older than the app.
- **Restart when idle.** A global pause of dispatch lets running machines and signals finish, starts nothing new and refuses new runs, answers and retries; the engine then leaves and a client starts the new version. Gates, questions and fires come back as they were and no step catches fire. It is refused while build mode holds a draft. An engine counts as older when its version differs or it runs another build of the bundle (a hash of it), so a rebuilt app does not have to wait for ⌘Q to take effect.

### The command line
- **`roboratory`** with `serve`, `stop`, `status`, `run <line> --input k=v`, `release`, `answer`, `retry`, `halt`, `resume`, `restart --when-idle` and `watch`. Each verb is audited as `you` with the source `cli`, and a refusal (for example a line the open build-mode draft changes) exits non-zero with the engine's message. Build mode stays in the app.
- **`watch`** prints one line for each gate waiting, question, fire, rework and end of a run, with the cost so far.
- **One bundle for both.** The packaged app runs the engine and the command with its own binary in Node mode; File → Install command-line tool writes the `roboratory` launcher to `~/.local/bin` when you confirm. The menu shows whether it is installed, outdated or missing, and the top bar offers an Install CLI button when it is not installed. In development, `npm run cli -- <command>`.

### Logs
- **The app keeps a log** (`app.log` in its user-data folder, File → Show log file) of uncaught errors, a renderer or child process that died, renderer console errors, an engine that stopped and a factory that could not be opened. Every process the engine and the app start on Windows is hidden, so no terminal window flashes.

### Fixed
- **A checker's verdict on an old output reworked a piece again.** When two checkers judge the same output and one is slow, its "fail" could arrive after the piece had already been reworked for the other's finding, and the piece ran a third time. A result about an input that an upstream piece has since replaced is now dropped and the piece looks again at the new one. Found by a CI failure and reproduced with a deliberately slow checker.
- **Cancelling a confirmation of a manager's suggestion rejected it.** "Cancel" now only steps back.
- **Opening the app told you about items that were already waiting** (a toast and a sound for each). Only what arrives afterwards is news.
- **Stopping the engine with `roboratory stop` sent the window back to the welcome screen.** The engine pushed an empty snapshot while closing, which the window took for a closed factory; it now shows the floor with the "Engine stopped" banner and a Start button. (A forced kill never showed it, which is why it went unseen on one platform.)
- **With the engine away, the window logged an error** each time it refreshed a conversation or the Ledger. Those reads now come back empty and the banner says what is wrong.

### Tests
- **Three layers, written as behavior.** The engine's specs moved from one file to `src/core/lines/`, one per thing a line does, on a shared harness (`src/test/harness.ts`) that describes a factory, runs it with simulated agents and reads the floor and the run files. The ones that read private state or called internal functions now watch what an agent receives instead. The interface has 180 tests in jsdom (Testing Library, the bridge to the main process as the only fake), and `e2e/specs/` is a Playwright Test suite on the packaged app, each test in a sandbox of its own: welcome, Floor, work, managers, build mode, the engine and the command, the app shell.
- **A real engine backs the new tests.** Server, client and command are tested against a real engine, in-process and as a separate process; `e2e/tools/factory-sim-check.mjs` drives the engine over the socket.
- **The CI found what a single machine could not:** the graceful-stop bug above, two tests that relied on timing, and a security check that Playwright's own debugging port fooled on Linux. A socket on the shared temporary folder moved to a private folder of the user.
- **Coverage** is measured (`npm run test:coverage`) with a floor in `vitest.config.mts`, and the CI runs the specs on macOS, Windows and Linux.
- The scripts that only screenshot or demo the app moved to `e2e/tools/`.

## v0.7.0

The first release. A factory is a git repository; Roboratory draws it as a pixel-art floor, runs its lines with headless agents and lets you build and change it from the Floor itself.

### The factory and the Floor
- **The Electron app** with a PixiJS Floor: one sector room that grows to fit its lines, a three-quarter pixel-art camera, and pan and zoom (D7, D6).
- **The factory repository loader** for `factory.yaml`, sectors, line models and `lines.yaml` (D4, D11). Several sectors, with one sector room on the Floor at a time (D36).
- **One Sector Manager character per sector**, by the back wall in the room's left corner (D38).
- **The demo factory** (three sectors, two demo target repositories) and the simulated agent (`agent: sim`) that runs it offline for free (D28).

### Lines
- **Headless machines** (D8): Claude Code and Codex adapters, Ajv contract validation with an attempt budget, a fire when the attempts run out, and a retry with a hint.
- **Chained git worktrees, one per machine,** on target repositories: a safety-net commit after each machine, and merges at joins where a conflict sets the next machine on fire (D10).
- **Signals**: scripts that pass the box on exit code 0. A loading bar shows while one runs, and a signal can have its own time limit (D19).
- **Gates**: human gates with optional confirmations (D16), decision gates with choices and a note (D17), and rule gates over box fields.
- **Routing**: splitter belts with a safe rule language that never executes code (D12), and return belts for bounded rework with lap limits (D15). A failing signal can send the box back with what it printed (D20).
- **Culture**: `culture.md` at the factory root and per sector, appended to every machine's and manager's role (D23).
- **Mid-step questions and blocks**: a machine may answer `needs_human` instead of its contract (D21), or `blocked` when something outside its work stops it (D22).
- **Line context**: machines know their place in the line and the goals of the pieces around it (D25), what you decided during the run (D26) and what their shell allows (D27). Goals are at most 250 characters.
- **Shared library** (`shared/`) of roles, contracts, signals and line models, with a warning when a change affects several lines (D24).
- **More machine settings** in `machine.yaml`: shared `roles`, extra `dirs`, `effort`, and `tools` listed by MCP server name, checked against `claude mcp list` on start (D33). Agents cannot start sub-agents.

### Managers and policy
- **Sector Manager and General Manager**, asked through the megaphone and run read-only through the agent CLI (D29, D32, D33). Answers carry `answer`, `evidence` and `proposals`; verb proposals become buttons, and change proposals show a diff that is written only when you accept it. Each sector keeps its own conversation history (D35).
- **Policy per sector, with a factory ceiling** (D31, D34): `retry` counted per run, and `run` and `halt` per line per day. `release` and applying changes are never automatic.
- **Halt and resume**, kept across restarts.

### Seeing and tracing
- **Attention queue** (fires first, then gates, by wait time), a **minimap** that changes color and plays a sound, and **entity panels** instead of modes: the fire panel, the gate panel and the work-order form (D39).
- **The Ledger**: every run, filterable by sector, line, period and status, with its steps, boxes, contract attempts, transcripts, gate releases, pallet, and the factory commit and uncommitted diff it used (D40, D5).
- **The live log** at factory, sector and machine level (D38), and an **audit log** for every verb (D30).
- **Readable boxes and transcripts**: boxes show as labelled fields with descriptions from the contract and the JSON one click away; text written by agents renders as Markdown (raw HTML is never rendered), with a copy button under every transcript.
- **The flow in the inspector**: belt rules in plain words.

### Build mode
- **Building on the Floor** (D41), one sector at a time: new sectors, new lines (a copy of a model or a fresh intake → pallet), separating a line into its own model, "+" slots on every belt, "connect to…" for joins and return belts, and removals that leave their belts red.
- **A rule builder** that offers only the fields and values of the box before the belt, with a text mode and the rule in plain words.
- **Forms** for machines (agent, model, effort, attempts, timeout, tools, folders, allowed commands, roles, the contract as a list of fields), intakes, gates, signals and their scripts, and for line, sector and factory settings, including policy within the ceiling and culture. Long-text intake fields are supported.
- **A draft that loads like the factory**, with YAML edited in place so untouched lines and comments stay as written; undo and redo; and a save screen with every file's diff.
- **Checks before saving:** the factory loads, every piece is reachable and reaches the pallet, rules read real fields, every routed value has a way out, and policy stays within the ceiling.
- **Locks:** saving waits while an affected line has a run in progress; while a session is open, dispatching a changed line is refused for you, managers and policy alike.

### Platforms
- **macOS, Windows and Linux.** Factory-relative paths use `/` everywhere, agent CLIs are found through `PATH` and `PATHEXT` on Windows, and signals stop with their whole process tree. On Windows, signals run through `sh` (Git for Windows) and agent CLIs must be native executables.
- **Releases** are built per platform from a tag, as zip archives attached to a GitHub Release.

### Testing
- Unit and integration tests with Vitest, colocated with the code.
- `e2e/factory-sim-check.mjs` dry-runs every line of a factory with the simulated agent, for free.
- `e2e/shoot.mjs`, `e2e/build-mode.mjs` and `e2e/gesture-check.mjs` drive the packaged app with Playwright.
- `e2e/real-agent-check.mjs` runs a two-machine line with the real Claude agent (32 s, US$ 0.46 in the check that was run).
