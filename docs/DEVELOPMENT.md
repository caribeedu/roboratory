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
| `npm test` | Unit and integration tests (Vitest) |
| `npm run typecheck` | TypeScript |
| `npm run package` | Builds the app into `out/` |
| `npm run make` | Builds the distributable archives into `out/make/` |
| `npm run cli -- <command>` | Runs the engine and the `roboratory` command from source (bundled with esbuild into `.vite/cli/`) |
| `node e2e/factory-sim-check.mjs <path>` | Dry-runs every line of a factory with the simulated agent, for free; it starts a real engine and drives it over the socket |
| `node e2e/headless.mjs` | Checks the v0.8 exit criteria on the packaged app and its command: the engine outlives the app, every verb from the command, restart when idle, the build-mode locks and the socket |
| `node e2e/shoot.mjs <dir>` | Drives the packaged app with Playwright and saves screenshots |
| `node e2e/build-mode.mjs <dir>` | Checks build mode through the UI: build a line from scratch, edit a real one, the locks |
| `node e2e/gesture-check.mjs`, `e2e/factory-shots.mjs` | Gesture and screenshot checks on the packaged app |
| `node e2e/readme-shots.mjs`, `e2e/piece-images.mjs`, `e2e/render-svg.mjs` | Regenerate the README's images: a line at work and build mode, one picture per piece drawn with the app's own sprites, and an SVG rendered to PNG |
| `node e2e/scenario.mjs`, `e2e/real-agent-check.mjs` | A staged demo day, and a paid run with the real Claude agent |

The e2e scripts launch the packaged app: they find it in `out/` for your platform (`ROBORATORY_OUT_DIR` changes the folder, `ROBORATORY_EXE` points at a specific executable).

## Layout

- `src/core/`: the logic that runs in the engine process, free of Electron and tested with Vitest: the loader, the engine, agents, git, managers, the service, the socket server (`server.ts`) and its client (`client.ts`). `src/engine.ts` bundles the server and the command (`src/cli.ts`) into `engine.js`. `src/core/build/` is build mode (the draft, its edits, checks and sessions). `src/core/agents/` has one adapter per agent CLI (Claude Code, Codex, the simulated agent).
- `src/shared/`: code and types used by both sides (layout, rule expressions, API types).
- `src/app/`: the renderer: React panels, the PixiJS floor and its procedural sprites. `src/app/build/` holds build mode's panels.
- `src/main.ts` and `src/preload.ts`: the Electron wiring. The main process holds an `EngineClient` and relays the interface's calls to the engine; it keeps no factory state.
- `e2e/`: Playwright scripts and the dry-run checker. `tools/make-icon.mjs` draws the pixel-art logo and writes the app icons.

## Conventions

- TypeScript, strict mode.
- Capability lives in the main-process broker and presentation in the renderer. A feature reachable from the UI and the CLI has one implementation and two thin callers.
- Tests are colocated with the code and test behavior. Add or update tests for every behavior change.
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
- **Build mode writes YAML in place** (`src/core/build/draft.ts`): untouched lines keep their exact text. Keep it that way, check edits against a real factory's files, and keep `e2e/build-mode.mjs` passing.

## Platform notes

- **Signals run through `sh`.** On Windows, install Git for Windows (or use WSL) and keep `sh` on `PATH`.
- **Agent CLIs must be native executables on Windows** (for example `claude.exe`). A `.cmd` shim cannot receive multi-line arguments, so the adapters refuse it with a message. `ROBORATORY_CLAUDE_BIN` and `ROBORATORY_CODEX_BIN` point at a specific executable.
- **There is no executable bit on Windows.** Scripts written by build mode are marked executable on macOS and Linux only.
- **A rebuilt app only takes effect after you quit the running one** (⌘Q on macOS): launching it again can bring the old process back. When the app is open it locks `out/`; build a copy with `ROBORATORY_OUT_DIR=<dir>`.
- **The engine is a separate process** (`.runs/engine.lock`, `.runs/engine.log`). Quitting or rebuilding the app does not restart it: a new build takes effect in the engine when it restarts. Run `npm run cli -- restart --when-idle` (or press "Restart when idle" in the app) to move it to the new build once nothing runs, or `npm run cli -- stop` to end it. Engines of the same version are reused as they are, so after changing engine code in development stop the engine.
- **On Windows the engine listens on a named pipe,** which drops whatever the other side has not read when the server closes it; the server waits a moment before closing connections. A test harness that waits for an app's pipes to close (Playwright) does not return from `close()` while an engine it started is alive, because the engine inherits them; `e2e/headless.mjs` waits for the app's process to exit instead.
