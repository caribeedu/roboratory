# Changelog

What Roboratory delivers. The reasoning behind each choice is in [docs/DECISIONS.md](docs/DECISIONS.md), and what is still open is in [docs/ROADMAP.md](docs/ROADMAP.md).

## v0.10.0

You can now see how each piece of a line behaves over its runs, and try a line before a real run. The Metrics tab and `roboratory stats` show cost, time and trouble per piece version; the Rehearse button of build mode, and `roboratory rehearse`, run a line once on a copy with nobody to answer and report what is wrong.

### Metrics (D47)
- **A version for each piece.** A short hash of what the agent is given (agent, model, effort, role with its cultures, contract, rules, tools, folders, attempts, timeout and the line's context). A changed role starts a new row instead of blurring an average. `piece.start` records it.
- **What a run records.** `cost` events carry the model and the tokens, and every cost is shown as an estimate (`~US$`).
- **The Metrics tab (key `3`) and `roboratory stats`.** Per piece and version: runs, cost, duration, attempts, reworks, questions, blocks, fires, permission requests, and the passes of a checker later proved wrong; per line, the permission figures (requests, repeated allows, denied, median wait). Filters by sector, line and period; `--json` for scripts.
- **A history line in the piece's panel,** in the Floor and in build mode, for the piece's current version.

### Rehearsal (D48)
- **Try a line before a real run.** It runs once on a copy, with nobody to answer: *Real with Haiku* keeps the real roles, contracts, lists and signals on a cheap model; *Simulation* is free and finds shape defects. A command no list covers is denied and reported, a question is answered with its recommendation, a gate is released on the first choice that does not send work back.
- **Findings** are defects (a fire, a command no list covers, a block) or notes (a question asked, an action held back). `roboratory rehearse` exits 1 on defects; the report is under `.runs/rehearsals/<id>/`.
- **Rehearse in build mode.** The Rehearse button in the line's settings shows what will run and the cost ceiling, then the findings, which mark the pieces on the Floor and appear in their panels. **Allow it** and **It acts outside** answer a finding in the draft.
- **`outward:` in `machine.yaml`.** Commands that act outside the factory; the rehearsal removes them from the machine's tools.
- **A cost ceiling.** `--max-cost` (US$ 1.00 by default): once an engine has spent it, no new step starts and the running ones finish. A real rehearsal is refused without one, and it ends with the connection that asked for it (Ctrl-C in the command).
- **Folders it cannot replace.** The `dirs` of a machine are listed in what will run, since the copy does not stand in for them.
- **A rehearsal ends with whoever asked.** Stop, Ctrl-C in the command, a closed connection or a closed factory end it, and no retry of a step starts after that or after the ceiling. A real rehearsal of a line whose repository is not a git repository is an error; the simulation goes on without it.
- **The copy cannot push.** The cloned repository has no `origin`, so a machine allowed to `git push` cannot reach the real one.
- **`rehearse` is a verb:** audited, never automatic and not proposable by a manager.

### Fixed
- **On Windows, Claude Code's PowerShell tool walked around the engine's list.** A machine whose commands the engine decides is no longer given that tool, so every shell command goes through Bash and is read by the engine (D44).

### Tests
- **Rehearsal in simulation replaces `e2e/tools/factory-sim-check.mjs`.** The end-to-end specs use `rehearse --simulation`.

### Upgrading
- **`e2e/tools/factory-sim-check.mjs` is gone.** Use `roboratory rehearse <line> --simulation`.

## v0.9.0

A machine now asks before it runs a command outside its list, and what the factory never allows is refused without asking. The two files that define a line and a machine are versioned and strict, with JSON Schemas for your editor.

### Permissions (D44)
- **A command outside a machine's list waits for you.** The machine pauses, an item joins the attention queue with the exact command, and the machine shows the exclamation balloon in the gate's color, without catching fire. You answer **Allow once**, or **Deny** with a reason that goes back to the agent as the refusal. Nothing is allowed for good. The wait has no limit and does not count against the machine's `timeout`.
- **What the factory never allows.** `deny:` in `factory.yaml` lists commands that are refused at once, without asking; a sector, a line and a machine can add to the list and never remove from it. The app carries no list of its own: the demo factory starts with one.
- **Commands as prefixes.** `allow` and `deny` hold command prefixes (`npm test`, `git push --force`) or tool names (`Edit`). The engine reads a shell command by its parts and drops git's global options, so `git -C dir push` is `git push`. A command it cannot account for (a substitution, a subshell, a redirect to a file) is asked about.
- **Read-only machines.** `read_only: true` takes the file tools away and denies `git push`; the commands in `allow` still run. The demo's triage, correlator and investigator are read-only.
- **Local git by default, not `git push`.** Every machine starts with the file tools and the local git commands. A `git push` is a request, and a machine that should always push lists `git push` in its `allow`.
- **In the window and in the command.** The card in the machine's panel, the Ledger (what was asked, how long it waited, what you answered) and the minimap, which shows the sector as waiting, not as on fire. `roboratory allow <request>`, `deny <request> --reason …`, and `watch` and `status` print each request with its id. Both verbs are audited as you and are never automatic: a manager cannot propose them and no policy grants them.
- **The prompt says so.** A machine is told what it may run without asking, that the rest is asked of a person, and not to repeat a refused command.
- **The Claude adapter asks through `--permission-prompt-tool`.** The tool is a small process of the `roboratory` command that Claude Code starts and that passes each call to the engine; the engine hosts no server. The CLI is given no shell rules, since its own deny rules do not catch `git -C . push`.

### The core formats (D46)
- **`schema_version: 1` is required** in `line.yaml` and `machine.yaml`: the version of the format, not of the product.
- **A key the schema does not know is an error,** named with its place and the key it looks like (`unknown key "alow" in the file (did you mean "allow"?)`). A `Bash(...)` command in `allow` or `deny` is refused with the prefix to write instead.
- **The JSON Schemas** are in `schemas/`, shared by the loader, build mode and any editor, and [docs/FORMATS.md](docs/FORMATS.md) specifies every key.

### Agents behind a port (D45)
- **The engine and the managers call one `AgentRunner` port;** Claude Code and the simulated agent are adapters behind it. An `agent:` the app has no adapter for is an error when the factory loads.

### Build mode
- **Forms for `deny` and `read_only`:** allowed commands, commands never allowed and read-only on a machine; commands never allowed on a line, a sector and the factory.

### Tests
- **A fake agent CLI that speaks MCP** drives the whole chain in the process-level tests: the adapter's flags, the permission tool, the engine, the command's `allow` and `deny`, and the reason reaching the agent. `src/core/permissions.test.ts` covers how commands are read; an end-to-end spec covers the card, the queue and the Ledger on the packaged app.
- **The e2e specs no longer take the focus** when run on your computer: the window stays hidden (`E2E_SHOW=1` shows it). The CI keeps showing it, and now keeps the report and traces of a failed job, which it had been dropping because they sit in hidden folders.
- **`e2e/tools/permission-check.mjs`** checks the mechanism with the real Claude Code on Haiku, and **`e2e/tools/real-permissions-check.mjs`** drives a real engine and a real agent through allow, deny and a hard denial, for cents. The second also runs with `--fake`, free.

### Upgrading
- **Add `schema_version: 1` as the first key of every `line.yaml` and `machine.yaml`.** Without it the file fails to load and says what to write; a key the schema does not know fails the same way.
- **Write `allow` and `deny` as prefixes:** `Bash(gh pr view:*)` becomes `gh pr view`. A machine no longer gets `Bash(git:*)` by default, so a `git push` it used to run on its own now asks you; list `git push` in its `allow` to keep it.
- **`agent:` must be `claude` or `sim`,** and each key must hold the type the schema lists (a number where a string is wanted is an error now).
- **An engine started by v0.8 keeps running** until you use the banner's "Restart when idle".

### Known limits
- **The engine reads commands, not what they do.** A script a listed program runs, and the read-only commands Claude Code allows by itself, are out of its reach, and `read_only` is not a sandbox. With an open shell (`Bash` in `allow`) the denials are a best effort. A flag spelled another way is another word (list `git push -f` as well as `git push --force`). Containers would close this (docs/ROADMAP.md §3).
- **A permission is for one call.** Whether a wider allowance is worth having is measured first (docs/ROADMAP.md, v0.10).
- **The checkers that prove their work and the manager's investigations come next** (docs/ROADMAP.md).
- The archives are not signed or notarized.

## v0.8.0

The engine moves out of the app. It runs as its own process, one per factory, and the app and a new `roboratory` command are clients of it: runs go on when the app quits or is rebuilt, and every verb can be driven from a terminal (D43).

### The engine process
- **One engine per factory, started on demand** by the app or the command, with a lock in `.runs/engine.lock`. It ends with `roboratory stop`, or by itself after a minute with no open run and no connected client. Its log is `.runs/engine.log`.
- **A local socket,** with one JSON message per line: the methods of the app's API as calls, and state updates pushed on the same connection. It is a Unix socket at `.runs/engine.sock` on macOS and Linux, a path in a private folder of the user in the temporary folder when that one is too long, and a named pipe on Windows. No network port is opened, and the engine serves only connections that open with the token in its lock file, which only you can read.
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
- **A checker's verdict on an old output reworked a piece again.** When two checkers judge the same output, the slower one's "fail" could reach the piece after it had already been reworked for the other's finding, and the piece ran a third time. A verdict now carries which output of the piece it judged: if a rework replaced that output on the way, the piece is not reworked again and the checker looks at the new one. A result about an input that has been replaced, or is being replaced, is dropped, and a piece does not start while something upstream of it is still working. Found by a CI failure that came back twice, and reproduced with slow belts.
- **Cancelling a confirmation of a manager's suggestion rejected it.** "Cancel" now only steps back.
- **The Floor could read a canvas host that React had already cleared** when it was closed and reopened quickly, and logged an error.
- **Opening the app told you about items that were already waiting** (a toast and a sound for each). Only what arrives afterwards is news.
- **Stopping the engine with `roboratory stop` sent the window back to the welcome screen.** The engine pushed an empty snapshot while closing, which the window took for a closed factory; it now shows the floor with the "Engine stopped" banner and a Start button. (A forced kill never showed it, which is why it went unseen on one platform.)
- **With the engine away, the window logged an error** each time it refreshed a conversation or the Ledger. Those reads now come back empty and the banner says what is wrong.

### Tests
- **Three layers, written as behavior.** The engine's specs moved from one file to `src/core/lines/`, one per thing a line does, on a shared harness (`src/test/harness.ts`) that describes a factory, runs it with simulated agents and reads the floor and the run files. The ones that read private state or called internal functions now watch what an agent receives instead. The interface has its own tests in jsdom (Testing Library, the bridge to the main process as the only fake), and `e2e/specs/` is a Playwright Test suite on the packaged app, each test in a sandbox of its own: welcome, Floor, work, managers, build mode, the engine and the command, the app shell.
- **A real engine backs the new tests.** Server, client and command are tested against a real engine, in-process and as a separate process; `e2e/tools/factory-sim-check.mjs` drives the engine over the socket.
- **The CI found what a single machine could not:** the graceful-stop bug above, two tests that relied on timing, and a security check that Playwright's own debugging port fooled on Linux. A socket on the shared temporary folder moved to a private folder of the user.
- **Coverage** is measured (`npm run test:coverage`) with a floor in `vitest.config.mts`, and the CI runs the specs on macOS, Windows and Linux.
- The scripts that only screenshot or demo the app moved to `e2e/tools/`.

### Upgrading
- **An engine started by an older build keeps running** after you update the app, so its runs are not cut. The app shows a banner with "Restart when idle"; the engine comes back as the new build once nothing is running.

### Known limits
- Build mode stays in the app; the command does not edit lines.
- The permissions, the checkers that prove their work and the manager's investigations come next ([docs/ROADMAP.md](docs/ROADMAP.md)).
- The archives are not signed or notarized.

## v0.7.0

The first release. A factory is a git repository; Roboratory draws it as a pixel-art floor, runs its lines with headless agents and lets you build and change it from the Floor itself.

### The factory and the Floor
- **The Electron app** with a PixiJS Floor: one sector room that grows to fit its lines, a three-quarter pixel-art camera, and pan and zoom (D7, D6).
- **The factory repository loader** for `factory.yaml`, sectors, line models and `lines.yaml` (D4, D11). Several sectors, with one sector room on the Floor at a time (D36).
- **One Sector Manager character per sector**, by the back wall in the room's left corner (D38).
- **The demo factory** (three sectors, two demo target repositories) and the simulated agent (`agent: sim`) that runs it offline for free (D28).

### Lines
- **Headless machines** (D8): a Claude Code adapter, Ajv contract validation with an attempt budget, a fire when the attempts run out, and a retry with a hint.
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
- `e2e/tools/factory-sim-check.mjs` dry-runs every line of a factory with the simulated agent, for free.
- `e2e/tools/shoot.mjs` drives the packaged app with Playwright to take screenshots; what it checked besides (build mode, gestures) is now in `e2e/specs/`.
- `e2e/tools/real-agent-check.mjs` runs a two-machine line with the real Claude agent (32 s, US$ 0.46 in the check that was run).
