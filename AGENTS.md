# AGENTS.md — Invariants

Promptory is a desktop app that runs AI agents as machines on deterministic production lines, rendered as a pixel-art factory. Read [README.md](README.md) and [docs/DECISIONS.md](docs/DECISIONS.md) before proposing any change to behavior; the code layout, commands and conventions are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

These hold unless a person explicitly signs off a change, recorded as a new decision in `docs/DECISIONS.md`:

1. **The factory repository is the only source of truth.** The app stores runtime state only, never definitions, and never writes to the factory's git. (D4, D5)
2. **Lines are deterministic.** Order, routing, checks and gates come from files. No agent decides the flow at runtime. (D7, D12)
3. **A machine step ends when its process exits,** and its output must pass the machine's contract or ask the human. (D8, D21)
4. **Each machine starts with a clean context.** It works in its own folder; the box and the other machines' folders in the same run carry information forward. It is told its place in the line and the goals around it, not other machines' work. (D9, D25)
5. **Managers propose; humans and policy decide.** Managers run read-only and return changes as patches that land only when a person accepts them. No verb runs without a human or an explicit policy entry, and releasing gates or applying changes is never automatic. (D29, D31, D32, D33, D34)
6. **Every action is a verb through the broker,** and every verb is audited. (D30)
7. **Everything stays local:** no telemetry, and open file formats.
8. **Real agents spend money.** Tests, the demo and dry runs use `agent: sim`. A real run needs a cost estimate and approval first.
