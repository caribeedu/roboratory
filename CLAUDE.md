# Roboratory — instructions for Claude

Follow the invariants in [AGENTS.md](AGENTS.md), which this file imports:

@AGENTS.md

## Working with the engine process

The engine runs apart from the app (D43). Rebuilding or quitting the app does not stop runs or load new engine code: the app offers "Restart when idle" for an engine of another build, or stop it with `npm run cli -- stop --factory <dir>` so the next open starts the current build. Its log is `.runs/engine.log`. Tests drive a real engine through `EngineClient`; `e2e/specs/engine.spec.ts` checks the engine against the packaged app and its command.

## Writing and running tests

The guide is [docs/DEVELOPMENT.md#tests](docs/DEVELOPMENT.md#tests); the rules are in AGENTS.md. In practice:

- **Start from the shared code, not a blank file:** `src/test/harness.ts` (engine), `src/test/ui.ts` (interface), `e2e/support/app.ts` (Playwright). Copy the shape of a neighbouring test in the same file, including how it is named.
- **Name a case as a sentence in the product's words** ("refuses an answer or a retry while it waits to restart"), with `describe` for the situation. Comments say why the scenario is built that way. No dates, no ticket numbers, `D#` when a decision explains it.
- **Check the test can fail.** Run it against the code before the fix, or break the code, once. A race is reproduced with slow belts or a slow machine first.
- **Run what you changed before the whole suite:** `npx vitest run <file>`; then `npm test`, then `npm run package` and `npm run test:e2e` when the window, the main process or the engine changed. Repeat a spec (`--repeat-each=5`) before calling it stable.
- **`npm run test:coverage` has a floor** in `vitest.config.mts`; if it fails, the new code needs a test, not a lower floor.
- **A failure that shows only in CI** is reproduced on that system (Windows can run Linux through WSL) before it is "fixed". Windows CI is slow on purpose-built waits (`patience()`, one worker); a wait that fails only there is a real cost to find first.
