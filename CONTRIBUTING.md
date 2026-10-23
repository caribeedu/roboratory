# Contributing

Thanks for your interest in Promptory. Before proposing a change, read the invariants in [AGENTS.md](AGENTS.md) and the reasoning in [docs/DECISIONS.md](docs/DECISIONS.md): the product is deliberately deterministic, and changes that break an invariant need a new decision first.

## Setup

You need Node 22.12 or later (`.nvmrc` pins 24) and git. Promptory runs on macOS, Windows and Linux.

```bash
npm ci
```

```bash
npm test
```

```bash
npm run typecheck
```

Code layout, conventions and platform notes are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Pull requests

- Keep a change focused, and add or update tests next to the code. Bug fixes come with a regression test.
- Tests, the demo and dry runs use the simulated agent (`agent: sim`). Never make a test call a real agent: real runs spend money.
- When behavior changes, update `docs/` in the same change. A design decision goes into [docs/DECISIONS.md](docs/DECISIONS.md) with its reasoning, before the code.
- Work on what the [roadmap](docs/ROADMAP.md) lists, or open an issue to discuss something else first.
- Write code, comments and documentation in English.

## Reporting problems

Open an issue with what you did, what you expected and what happened. For security problems, follow [SECURITY.md](SECURITY.md) instead.
