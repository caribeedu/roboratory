# Changelog

What Roboratory delivers. The reasoning behind each choice is in [docs/DECISIONS.md](docs/DECISIONS.md), and what is still open is in [docs/ROADMAP.md](docs/ROADMAP.md).

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
