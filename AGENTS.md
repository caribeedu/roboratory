# AGENTS.md — Invariants

Roboratory is a desktop app that runs AI agents as machines on deterministic production lines, rendered as a pixel-art factory. Read [README.md](README.md) and [docs/DECISIONS.md](docs/DECISIONS.md) before proposing any change to behavior; the code layout, commands and conventions are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

These hold unless a person explicitly signs off a change, recorded as a new decision in `docs/DECISIONS.md`:

1. **The factory repository is the only source of truth.** The app stores runtime state only, never definitions, and never writes to the factory's git. (D4, D5)
2. **Lines are deterministic.** Order, routing, checks and gates come from files. No agent decides the flow at runtime. (D7, D12)
3. **A machine step ends when its process exits,** and its output must pass the machine's contract or ask the human. (D8, D21)
4. **Each machine starts with a clean context.** It works in its own folder; the box and the other machines' folders in the same run carry information forward. It is told its place in the line and the goals around it, not other machines' work. (D9, D25)
5. **Managers propose; humans and policy decide.** Managers run read-only and return changes as patches that land only when a person accepts them. No verb runs without a human or an explicit policy entry, and releasing gates, applying changes and allowing a machine's command are never automatic. (D29, D31, D32, D33, D34, D44)
6. **Every action is a verb through the broker,** and every verb is audited. (D30)
7. **Everything stays local:** no telemetry, and open file formats.
8. **Real agents spend money.** Tests, the demo and dry runs use `agent: sim`. A real run needs a cost estimate and approval first.
9. **The engine decides what a machine may run, from files.** A command outside the list is asked of a person, what the factory never allows is refused without asking, and the app carries no list of its own. The core formats are versioned and strict. (D44, D46)

## Tests

How the suite is organized and written is in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#tests). The rules that hold for every change:

1. **Every behavior change comes with a test, at the lowest layer that can see it:** `src/core/lines/` for what a line does, a test beside the code for a function, `src/app/**/*.test.tsx` for the window, `e2e/specs/` only for what needs the packaged app. A bug fix starts with the test that fails, reproduced deterministically when the cause is a race.
2. **A test is a sentence about behavior** in the product's words, and reaches in through what a person or the next layer can see: the floor, the run files, what an agent receives, what the window shows. Not private fields, not the order of internal calls.
3. **Mock only the boundary you do not own.** The engine, the sockets and the files are real; an agent CLI is a fake script; the interface tests fake only the bridge to the main process. No test calls a real agent (invariant 8).
4. **Wait for what you expect, never a fixed time.** A fixed wait is only for something that must not happen, and it says so (`quietFor`).
5. **Keep it short.** Test a thing once; delete a test whose behavior is gone; build the data in the test, in a temporary folder, never in the real home folder.
