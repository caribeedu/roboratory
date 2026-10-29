# Roboratory — Development

How to work on Roboratory: set it up, find your way around the code, and the lessons about the agent CLIs that cost time to learn. The product's behavior is in [PRODUCT.md](PRODUCT.md), how it is built in [ARCHITECTURE.md](ARCHITECTURE.md), and the reasoning in [DECISIONS.md](DECISIONS.md).

## Setup

You need Node 22.12 or later (`.nvmrc` pins 24), npm and git. Roboratory runs on macOS, Windows and Linux.

```bash
npm ci
```

```bash
npm start
```

| Command | What it does |
|---|---|
| `npm start` | Runs the app in development |
| `npm test` | Unit and integration tests (Vitest): the engine, the loader, the command, and the interface in jsdom |
| `npm run test:coverage` | The same, with coverage; it fails under the floor set in `vitest.config.mts` |
| `npm run test:e2e` | The end-to-end specs (Playwright) against the packaged app; run `npm run package` first |
| `npm run typecheck` | TypeScript |
| `npm run package` | Builds the app into `out/` |
| `npm run make` | Builds the distributable archives into `out/make/` |
| `npm run cli -- <command>` | Runs the engine and the `roboratory` command from source (bundled with esbuild into `.vite/cli/`) |
| `roboratory rehearse <line> --simulation` | Rehearses a line with the simulated agent, for free (the `e2e/tools/factory-shots.mjs` tool does it for every line of the demo) |
| `node e2e/tools/shoot.mjs <dir>`, `factory-shots.mjs` | Drive the packaged app and save screenshots |
| `node e2e/tools/readme-shots.mjs`, `piece-images.mjs`, `render-svg.mjs` | Regenerate the README's images: a line at work and build mode, one picture per piece drawn with the app's own sprites, and an SVG rendered to PNG |
| `node e2e/tools/scenario.mjs`, `real-agent-check.mjs` | A staged demo day, and a paid run with the real Claude agent |

The e2e specs and tools launch the packaged app: they find it in `out/` for your platform (`ROBORATORY_OUT_DIR` changes the folder, `ROBORATORY_EXE` points at a specific executable). **Locally the specs keep the window hidden** (`ROBORATORY_BACKGROUND=1`, set by `launch` in `e2e/support/app.ts`), so they never take the focus of whoever is using the computer; `E2E_SHOW=1` shows it, to watch a spec. The CI always shows it.

## Tests

### Philosophy

A test says what a person (or the next layer) can see, in the words of the product. It is a sentence about behavior, it fails when the behavior breaks and not when the code is rearranged, and it is written so that someone who has never read the implementation can tell what was promised.

- **Test through the public surface:** the floor view, the run files (`run.jsonl` is an open format, so it is fair to read), what an agent receives, what the window shows, the bridge, the command. Never private fields, never the order of internal calls. If a behavior cannot be seen from outside, make it visible (an event in the run file) instead of reading the inside.
- **Mock only the boundary you do not own.** An agent CLI is a fake script on disk, the engine is a real engine, a socket is a real socket. The one fake in the interface tests is the bridge to the main process, because that is where the renderer ends.
- **A bug fix starts with the test that fails.** When the cause is a race, reproduce it deterministically (slow belts, a slow machine, a checker that takes longer) before fixing; a flake you cannot reproduce is not fixed, only unseen.
- **Test it once, at the lowest layer that can see it.** The e2e suite is for what only the packaged app can show (Electron, the canvas, real processes, packaging); a rule of the engine belongs in `src/core/lines/`, a form in an interface test. A capability gets one journey in e2e, not one per detail.
- **A green test must be able to go red.** Before trusting a new test, break the code it covers (or run it against the old code) and watch it fail.

### Which layer, and where it lives

| You are testing | Write it in | Using |
|---|---|---|
| What a line does: routing, gates, rework, signals, questions, restarting, what an agent is given, verbs | `src/core/lines/<thing>.test.ts` | `src/test/harness.ts` |
| A pure function or a loader with a clear input and output | next to the code, `<file>.test.ts` | plain Vitest |
| The socket server, the client, the command | `src/core/server.test.ts`, `client.test.ts`, `cli-main.test.ts` (in-process), `cli.test.ts` (as a separate process) | a real engine |
| An agent CLI adapter | `src/core/agents/*.test.ts` | a fake CLI script |
| A panel or form | `src/app/**/*.test.tsx` | Testing Library, `src/test/ui.ts` |
| The whole window | `src/app/App.test.tsx` (the PixiJS floor is a stand-in there) | the fake bridge |
| What needs Electron, the real canvas, a real engine process or the packaged app | `e2e/specs/<capability>.spec.ts` | `e2e/support/app.ts` |

`src/test/` holds what the Vitest layers share. `e2e/support/` holds the Playwright fixtures. `e2e/tools/` are scripts that screenshot or demo the app, not tests.

### Writing a case

- **Name:** a present-tense sentence in the product's words. `describe` names a situation ("when two checkers send the same piece back"), `it` names what happens ("reworks it once, with both findings, when they report together"). Say *what the person gets*, not what the function does. No "should", no "test that", no ticket numbers; refer to a decision as `D#` when it explains why.
- **Shape:** describe the factory, act, watch the outcome. One behavior per test; several assertions are fine when they are facets of that one behavior.
- **Comments** say why the scenario is built the way it is ("b is slow: it judges the first output of t after t was already reworked"), never what a line of code does.
- **Waits:** wait for the thing you expect (`until`, `whenState`, `whenDone`, `expect.poll`, `findBy…`), never a fixed time. A fixed wait is only for something that must *not* happen, and it goes through `quietFor` so it says so.
- **Data:** build it in the test with the harness, in a temporary folder; do not read fixtures from the repository or touch the real home folder (the e2e sandbox sets `HOME`).
- **Delete** a test when the behavior is removed, and fold a test into its neighbour when it only repeats it. A shorter suite that says the same is better.

### What the shared code gives you

- **Engine (`src/test/harness.ts`):** `buildFactory(lineYaml, machines, files, withRepo)` and `line(pieces, pallet)` describe a factory; `simMachine`, `strictMachine`, `checker([...verdicts])` and `claudeMachine` are machines; `fakeClaude(answers)` stands in for the Claude CLI and records what it was given (`calls()`, `waitForCalls(n)`); `startEngine` and `restartEngine` run an engine that is stopped after the test; `until`, `whenState`, `whenDone`, `whenEnded`, `quietFor` wait; `eventsOf` and `piecesRun` read the run file. Simulated agents run 200 times faster than they say.
- **Interface (`src/test/ui.ts`):** `installBridge(overrides)` installs the fake `window.roboratory` (calls are `vi.fn`, `emit` pushes from the main process); `makeFactory`, `snapshot`, `lineView`, `buildView` give a small factory to look at; `settle()` lets what the bridge answered reach the screen. Query by role and label, as a person would.
- **E2E (`e2e/support/app.ts`):** `test` gives each case its own sandbox (`sandbox`: user data, home, demo factory), the app (`app`, `window`), the page object (`roboratory`: `openDemo`, `run`, `piece`, `openPiece`, `panel`, `attention`, `goToSector`, `pieceState`…) and the command (`cli`). `launch`, `quit` and `cliFor` are for cases that start the app themselves. A page error fails the case unless `allowPageErrors` is set. `patience(ms)` scales a wait for a slow CI machine.

### Pitfalls we met

- **A push is not a promise.** The engine sends a state update when something changes; a test that needs one makes a change (`halt`, a run) instead of hoping one is on its way.
- **`act` warnings are races.** A state update after the test moved on means the test did not wait for what the component fetched. `await settle()` after rendering, and prefer `findBy…` to `getBy…` for anything that arrives later.
- **Do not name a Playwright fixture `window`** if you also use the browser's `window` inside `evaluate`; the closure sees the fixture. Put the call in the `Roboratory` page object.
- **Ports and processes the test harness adds.** Playwright gives the app a remote-debugging port and a child can inherit it, so a "no network port" check leaves out what the app itself listens on.
- **Graceful and forced stops differ by platform.** A kill is forced on Windows and graceful elsewhere; test the graceful path (`roboratory stop`) as well as the abrupt one.
- **Windows CI is slow.** One worker, longer timeouts and `patience()` exist for it. When a wait fails only there, look for the real cost (Electron start, the engine, Git's `sh`) before raising a number.
- **Spawn with `windowsHide: true`**, in tests too, or a console window opens for every child.
- **Paths:** build them with `path`, write factory-relative paths with `/`, and put a literal Windows path in `String.raw`.
- **Reproduce a CI failure on its own system.** Windows can run Linux through WSL; a fix that only makes the failure disappear on your machine is a guess.

### Running them

| | |
|---|---|
| `npm test` | every Vitest test: the engine, the loader, the command and the interface |
| `npm run test:coverage` | the same, and fails under the floor in `vitest.config.mts` (a floor, not a goal) |
| `npm run package`, then `npm run test:e2e` | the Playwright specs against the packaged app; `ROBORATORY_OUT_DIR` and `ROBORATORY_EXE` choose the build |
| `npx playwright test <file> --repeat-each=5` | how stable a spec is |

The CI (`.github/workflows/tests.yml`) runs the Vitest layers and the e2e suite on macOS, Windows and Linux, and keeps the report and the traces of a failed e2e job.

## Layout

- `src/core/`: the logic that runs in the engine process, free of Electron and tested with Vitest: the loader, the engine, agents, git, managers, the service, the socket server (`server.ts`) and its client (`client.ts`). `src/engine.ts` bundles the server and the command (`src/cli.ts`) into `engine.js`. `src/core/build/` is build mode (the draft, its edits, checks and sessions). `src/core/agents/` has one adapter per agent behind the `AgentRunner` port (Claude Code, the simulated agent; D45). `src/core/permissions.ts` reads a machine's lists and its shell commands (D44), `src/core/permission-tool.ts` is the process an agent's CLI starts to ask the engine, and `src/core/stats.ts` and `src/core/version.ts` are the metrics (D47), `src/core/rehearsal.ts` is the rehearsal (D48), and `src/core/formats.ts` checks `line.yaml` and `machine.yaml` against `schemas/` (D46).
- `schemas/`: the JSON Schemas of `line.yaml` and `machine.yaml`; `docs/FORMATS.md` is their specification. Change them together, and the version only with a decision.
- `src/shared/`: code and types used by both sides (layout, rule expressions, API types).
- `src/app/`: the renderer: React panels, the PixiJS floor and its procedural sprites. `src/app/build/` holds build mode's panels.
- `src/main.ts` and `src/preload.ts`: the Electron wiring. The main process holds an `EngineClient` and relays the interface's calls to the engine; it keeps no factory state.
- `src/test/`: what the tests share (the engine harness, the interface fixtures and the fake bridge).
- `e2e/`: the Playwright specs (`specs/`), what they stand on (`support/`), and scripts that screenshot or demo the app (`tools/`). `tools/make-icon.mjs` draws the pixel-art logo and writes the app icons.

## Conventions

- TypeScript, strict mode.
- Capability lives in the main-process broker and presentation in the renderer. A feature reachable from the UI and the CLI has one implementation and two thin callers.
- Tests are colocated with the code and test behavior (see Tests above). Add or update tests for every behavior change.
- Factory-relative paths are written with `/` on every platform (`src/core/paths.ts`).
- When behavior changes, update `docs/` in the same change, and record design decisions in `DECISIONS.md` with their reasoning.

## Real agents cost money

Tests, the demo and simulated rehearsals use `agent: sim`. Do not run a line with `agent: claude`, or `e2e/tools/real-agent-check.mjs`, `e2e/tools/permission-check.mjs` or `e2e/tools/real-permissions-check.mjs`, without a cost estimate and approval. To keep an unavoidable real call to cents, use `--model haiku --tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}'`.

## Lessons about the agent CLIs

- **Claude's tool schemas refuse `anyOf`/`oneOf`/`allOf` at the root.** The Claude adapter puts the contract-or-question choice under `result` and unwraps it (`claudeSchema` in `src/core/agents/claude.ts`). Any new schema sent to `claude -p --json-schema` must keep a plain object at the root.
- **Check what the CLI sends without paying:** point it at a local server that only records the request (`ANTHROPIC_BASE_URL=http://127.0.0.1:<port> claude -p …`); the tool list and schemas are in the captured body.
- **Claude Code asks a program of ours about what its rules leave undecided** with `--permission-prompt-tool mcp__<server>__<tool>`: a tool of an MCP server started from `--mcp-config`, which gets `{tool_name, input, tool_use_id}` and answers `{behavior: "allow", updatedInput}` or `{behavior: "deny", message}`. The agent reads the message word for word, and a request can wait for minutes. `e2e/tools/permission-check.mjs` checks this with Haiku for cents.
- **Claude Code's deny rules can be walked around:** `Bash(git push:*)` does not catch `git -C . push`, so the engine decides shell commands itself (D44). In the default permission mode it also allows read-only commands (`ls`, `cat`, `date`, `git status`) by itself, without asking the tool.
- **Machines cannot start sub-agents** (`--disallowedTools Agent`): a step's work stays in one context and transcript.
- **Each agent CLI has its own adapter** in `src/core/agents/`. The engine hands every adapter the contract and the question alternative; anything specific to one CLI (arguments, schema shape, MCP naming, transcript wording) stays in its file.
- **Machines get line context** (D25): the line in order, goals, belts in and out. Writing a role, do not restate the line; give the piece a goal instead.
- **A failing signal is rework, a slow one is fire** (D19, D20): a return belt from a signal takes the box when the script exits non-zero, with `signal_output`; a signal stopped at its `timeout` always catches fire. A machine that cannot work because of something outside it answers `blocked` (D22).
- **Build mode writes YAML in place** (`src/core/build/draft.ts`): untouched lines keep their exact text. Keep it that way, check edits against a real factory's files, and keep `e2e/specs/build-mode.spec.ts` passing.

## Platform notes

- **Signals run through `sh`.** On Windows, install Git for Windows (or use WSL) and keep `sh` on `PATH`.
- **Agent CLIs must be native executables on Windows** (for example `claude.exe`). A `.cmd` shim cannot receive multi-line arguments, so the adapters refuse it with a message. `ROBORATORY_CLAUDE_BIN` points at a specific executable.
- **There is no executable bit on Windows.** Scripts written by build mode are marked executable on macOS and Linux only.
- **A rebuilt app only takes effect after you quit the running one** (⌘Q on macOS): launching it again can bring the old process back. When the app is open it locks `out/`; build a copy with `ROBORATORY_OUT_DIR=<dir>`.
- **Spawn with `windowsHide: true`, always.** The engine runs detached with no console, so on Windows any console program it starts (git, an agent CLI, `sh`) opens a visible terminal window unless it is hidden. This includes the tests' and e2e scripts' own spawns.
- **Where problems are logged.** The app writes `app.log` under its user-data folder (`logs/`; File → Show log file): uncaught errors, a renderer or child process that died, renderer console errors, a window that failed to load or stopped responding, an engine that stopped, a factory that could not be opened. The engine writes `.runs/engine.log`. Both stay on the machine.
- **The engine is a separate process** (`.runs/engine.lock`, `.runs/engine.log`). Quitting or rebuilding the app does not restart it: a new build takes effect in the engine when it restarts. Run `npm run cli -- restart --when-idle` (or press "Restart when idle" in the app) to move it to the new build once nothing runs, or `npm run cli -- stop` to end it. The app and the command compare the engine's version and a hash of its bundle, so a rebuilt bundle is offered the same restart.
- **On Windows the engine listens on a named pipe,** which drops whatever the other side has not read when the server closes it; the server waits a moment before closing connections. A test harness that waits for an app's pipes to close (Playwright) does not return from `close()` while an engine it started is alive, because the engine inherits them; `quit` in `e2e/support/app.ts` waits for the app's process to exit instead. The same app can also hand its remote-debugging port to the engine it starts, so the "no network port" spec leaves out whatever the app itself listens on.
