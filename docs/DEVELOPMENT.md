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
| `node e2e/tools/factory-sim-check.mjs <path>` | Dry-runs every line of a factory with the simulated agent, for free; it starts a real engine and drives it over the socket |
| `node e2e/tools/shoot.mjs <dir>`, `factory-shots.mjs` | Drive the packaged app and save screenshots |
| `node e2e/tools/readme-shots.mjs`, `piece-images.mjs`, `render-svg.mjs` | Regenerate the README's images: a line at work and build mode, one picture per piece drawn with the app's own sprites, and an SVG rendered to PNG |
| `node e2e/tools/scenario.mjs`, `real-agent-check.mjs` | A staged demo day, and a paid run with the real Claude agent |

The e2e specs and tools launch the packaged app: they find it in `out/` for your platform (`ROBORATORY_OUT_DIR` changes the folder, `ROBORATORY_EXE` points at a specific executable).

## Tests

Three layers, each testing what a person (or the next layer) can see, not how the code is arranged inside:

- **Unit and integration (`src/**/*.test.ts`)**, in Vitest. The engine's specs live in `src/core/lines/`, one file per thing a line does (running, gates, rework, signals, questions, restarting, what an agent is given, verbs). They describe a factory, run it with simulated agents and watch the floor, the run files and what the agents receive; `src/test/harness.ts` has the builders and the waits. Nothing is mocked: an agent CLI is a fake script on disk, the engine is a real engine, a socket is a real socket. The server, the client and the command are tested against a real engine (in-process in `server.test.ts` and `cli-main.test.ts`, as a separate process in `cli.test.ts`).
- **Interface (`src/app/**/*.test.tsx`)**, in Vitest with jsdom and Testing Library. They do what a person does (`getByRole`, type, click) and check what the window shows and what it asks the main process to do. The one thing faked is the bridge to the main process, `window.roboratory` (`installBridge` in `src/test/ui.ts`); the PixiJS floor is replaced by a stand-in in `App.test.tsx` and exercised by the e2e specs instead.
- **End to end (`e2e/specs/*.spec.ts`)**, in Playwright Test, on the packaged app. Each test launches the app in a sandbox of its own (user data, home folder, demo factory and so an engine of its own; `e2e/support/app.ts`), so specs run in parallel and never touch your own factories. They cover the welcome screen, the Floor, dispatching and releasing work, fires, the Ledger, the managers, build mode, the engine outliving the app, the command, and the app's log. A window that logs an error fails the test unless it says it expects one.

Habits that keep the suite honest:

- A test name is a sentence about behavior ("refuses an answer or a retry while it waits to restart"), and a bug fix comes with the test that failed first.
- Wait for what you expect (`until`, `expect.poll`, `findBy…`), never for a fixed time. The only fixed waits are for something that must *not* happen (`quietFor`), and they say so.
- Reach in through the public surface (the floor view, the run files, the bridge, the command), not through private fields or the order of internal calls. If a behavior cannot be seen from outside, make it visible (an event in `run.jsonl`) rather than reading the inside.
- Anything spawned on Windows is spawned with `windowsHide: true`, in tests too.

## Layout

- `src/core/`: the logic that runs in the engine process, free of Electron and tested with Vitest: the loader, the engine, agents, git, managers, the service, the socket server (`server.ts`) and its client (`client.ts`). `src/engine.ts` bundles the server and the command (`src/cli.ts`) into `engine.js`. `src/core/build/` is build mode (the draft, its edits, checks and sessions). `src/core/agents/` has one adapter per agent CLI (Claude Code, Codex, the simulated agent).
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

Tests, the demo and dry runs use `agent: sim`. Do not run a line with `agent: claude` or `codex`, or `e2e/real-agent-check.mjs`, without a cost estimate and approval. To keep an unavoidable real call to cents, use `--model haiku --tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}'`.

## Lessons about the agent CLIs

- **Claude's tool schemas refuse `anyOf`/`oneOf`/`allOf` at the root.** The Claude adapter puts the contract-or-question choice under `result` and unwraps it (`claudeSchema` in `src/core/agents/claude.ts`). Any new schema sent to `claude -p --json-schema` must keep a plain object at the root.
- **Check what the CLI sends without paying:** point it at a local server that only records the request (`ANTHROPIC_BASE_URL=http://127.0.0.1:<port> claude -p …`); the tool list and schemas are in the captured body.
- **Machines cannot start sub-agents** (`--disallowedTools Agent`): a step's work stays in one context and transcript.
- **Each agent CLI has its own adapter** in `src/core/agents/`. The engine hands every adapter the contract and the question alternative; anything specific to one CLI (arguments, schema shape, MCP naming, transcript wording) stays in its file.
- **Machines get line context** (D25): the line in order, goals, belts in and out. Writing a role, do not restate the line; give the piece a goal instead.
- **A failing signal is rework, a slow one is fire** (D19, D20): a return belt from a signal takes the box when the script exits non-zero, with `signal_output`; a signal stopped at its `timeout` always catches fire. A machine that cannot work because of something outside it answers `blocked` (D22).
- **Build mode writes YAML in place** (`src/core/build/draft.ts`): untouched lines keep their exact text. Keep it that way, check edits against a real factory's files, and keep `e2e/specs/build-mode.spec.ts` passing.

## Platform notes

- **Signals run through `sh`.** On Windows, install Git for Windows (or use WSL) and keep `sh` on `PATH`.
- **Agent CLIs must be native executables on Windows** (for example `claude.exe`). A `.cmd` shim cannot receive multi-line arguments, so the adapters refuse it with a message. `ROBORATORY_CLAUDE_BIN` and `ROBORATORY_CODEX_BIN` point at a specific executable.
- **There is no executable bit on Windows.** Scripts written by build mode are marked executable on macOS and Linux only.
- **A rebuilt app only takes effect after you quit the running one** (⌘Q on macOS): launching it again can bring the old process back. When the app is open it locks `out/`; build a copy with `ROBORATORY_OUT_DIR=<dir>`.
- **Spawn with `windowsHide: true`, always.** The engine runs detached with no console, so on Windows any console program it starts (git, an agent CLI, `sh`) opens a visible terminal window unless it is hidden. This includes the tests' and e2e scripts' own spawns.
- **Where problems are logged.** The app writes `app.log` under its user-data folder (`logs/`; File → Show log file): uncaught errors, a renderer or child process that died, renderer console errors, a window that failed to load or stopped responding, an engine that stopped, a factory that could not be opened. The engine writes `.runs/engine.log`. Both stay on the machine.
- **The engine is a separate process** (`.runs/engine.lock`, `.runs/engine.log`). Quitting or rebuilding the app does not restart it: a new build takes effect in the engine when it restarts. Run `npm run cli -- restart --when-idle` (or press "Restart when idle" in the app) to move it to the new build once nothing runs, or `npm run cli -- stop` to end it. The app and the command compare the engine's version and a hash of its bundle, so a rebuilt bundle is offered the same restart.
- **On Windows the engine listens on a named pipe,** which drops whatever the other side has not read when the server closes it; the server waits a moment before closing connections. A test harness that waits for an app's pipes to close (Playwright) does not return from `close()` while an engine it started is alive, because the engine inherits them; `quit` in `e2e/support/app.ts` waits for the app's process to exit instead. The same app can also hand its remote-debugging port to the engine it starts, so the "no network port" spec leaves out whatever the app itself listens on.
