# Roboratory — instructions for Claude

Follow the invariants in [AGENTS.md](AGENTS.md), which this file imports:

@AGENTS.md

## Working with the engine process

The engine runs apart from the app (D43). Rebuilding or quitting the app does not stop runs or load new engine code: the app offers "Restart when idle" for an engine of another build, or stop it with `npm run cli -- stop --factory <dir>` so the next open starts the current build. Its log is `.runs/engine.log`. Tests drive a real engine through `EngineClient`; `e2e/headless.mjs` checks the exit criteria against the packaged app.
