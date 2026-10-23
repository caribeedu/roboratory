<p align="center">
  <img src="https://raw.githubusercontent.com/caribeedu/roboratory/main/assets/banner.svg?v=3" alt="Roboratory: a factory for AI agents, with deterministic production lines in pixel art" width="100%">
</p>

<p align="center">
  <a href="https://github.com/caribeedu/roboratory/actions/workflows/tests.yml"><img src="https://github.com/caribeedu/roboratory/actions/workflows/tests.yml/badge.svg" alt="tests"></a>
  <a href="https://github.com/caribeedu/roboratory/releases"><img src="https://img.shields.io/github/v/release/caribeedu/roboratory?include_prereleases&style=flat-square&color=c07a2c" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-2a2825?style=flat-square" alt="macOS, Windows and Linux">
  <a href="https://github.com/caribeedu/roboratory/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-c07a2c?style=flat-square" alt="MIT"></a>
</p>

# Roboratory

**A factory for AI agents.** You build production lines out of machines, belts, signals and gates. Agents work the machines, and you watch the whole floor in pixel art.

Roboratory is for work that has to be repeatable and auditable: turning tickets into pull requests, answering incidents, shipping to production. Each line is a deterministic workflow defined in files and versioned in git. The agents only produce what goes inside each step, and every step's output has to pass a contract before it moves on.

![The Releases sector on the Floor, with a release line at work](https://raw.githubusercontent.com/caribeedu/roboratory/main/docs/screenshots/floor-releases.png)

## Why

Running several AI agents on real work today means either free-form chat between agents, which is hard to predict, or workflow engines that hide the agents behind logs. Roboratory treats agent work like a factory floor:

- **Deterministic lines.** The order of steps, the routing, the checks and the gates are defined in files. Agents fill in each step's content and never decide the flow.
- **Contracts at every step.** A machine's output is validated against a JSON Schema. If it does not match, the step runs again; when attempts run out, the machine catches fire and the line stops behind it.
- **Humans hold the gates that matter.** Releasing a gate or applying a change is never automatic. Managers answer questions and propose, and you decide.
- **Everything visible.** If something is running, waiting or burning, it shows on the floor, on the minimap and in the log.
- **Git is the source of truth.** The factory is a repository. Changing it means a reviewed diff, never improvisation at runtime.
- **Local.** No telemetry, open file formats, and your own agent CLIs and subscriptions.

## Build any flow you want

Roboratory does not come with one fixed pipeline: **you design the flow**, and it runs exactly as designed. A line is a set of pieces you can connect however your process needs:

- **A sequence** of machines, with signals and gates wherever a check or a decision belongs.
- **Branches:** a splitter belt routes each box on a field of its contract (`type: bug` one way, `type: question` the other), and never asks a model to decide.
- **Joins:** a piece can wait for several belts to arrive before it runs.
- **Loops with a limit:** a return belt sends work back for rework (a failing test, a reviewer's findings), with a lap limit so a line cannot spin forever.
- **Many lines from one model:** one incident line per service, one release line per repository, all kept in sync.
- **Your own sectors:** group lines by team or purpose, each with its own manager and policy.

You can write these as plain YAML in the factory repository, or build them with clicks on the Floor in build mode, which checks the line before saving.

## How it works

<p align="center">
  <img src="https://raw.githubusercontent.com/caribeedu/roboratory/main/assets/how-it-works.svg?v=2" alt="How Roboratory works: an intake starts a run; machines, signals and gates carry validated boxes to a pallet; return belts send work back; managers propose and you decide; everything is files in a git repository" width="100%">
</p>

A run starts at an **intake** with a work order. Each **machine** runs a headless agent (Claude Code or Codex) with a fresh context, and the step ends when the process exits. The output is a **box** that must match the machine's contract. **Signals** (scripts) and **gates** (you, or a rule) check the box before it moves on, **return belts** send work back for rework within a lap limit, and the last box lands on the **pallet**: the deliverable.

### The pieces

| Piece | Concept | What it is |
|---|---|---|
| **Machine** <img src="https://raw.githubusercontent.com/caribeedu/roboratory/main/docs/pieces/machine.png?v=2" height="56" alt=""> | One agent | One step. An agent runs headless with a role and a contract, and the step ends when the process exits. |
| **Box** <img src="https://raw.githubusercontent.com/caribeedu/roboratory/main/docs/pieces/box.png?v=2" height="56" alt=""> | Outcome | The contract-validated output of a machine: a piece of progress travelling on the belts. |
| **Belt** <img src="https://raw.githubusercontent.com/caribeedu/roboratory/main/docs/pieces/belt.png?v=2" height="56" alt=""> | Routing | Carries boxes from one piece to the next. A splitter belt routes on a box field. |
| **Signal** <img src="https://raw.githubusercontent.com/caribeedu/roboratory/main/docs/pieces/signal.png?v=2" height="56" alt=""> | Eval | A deterministic check: a script whose exit code passes the box or stops the line. |
| **Gate** <img src="https://raw.githubusercontent.com/caribeedu/roboratory/main/docs/pieces/gate.png?v=2" height="56" alt=""> | Human in the loop | Holds boxes until you release it, or until a rule over the box holds. |
| **Pallet** <img src="https://raw.githubusercontent.com/caribeedu/roboratory/main/docs/pieces/pallet.png?v=2" height="56" alt=""> | End of the flow | Where finished boxes are stacked at the end of a line. What is on the pallet is the deliverable. |
| **Production line** <img src="https://raw.githubusercontent.com/caribeedu/roboratory/main/docs/pieces/production-line.png?v=2" height="56" alt=""> | A multi-agent workflow | A running copy of a line model. A sector can hold many copies of the same model. |
| **Sector** <img src="https://raw.githubusercontent.com/caribeedu/roboratory/main/docs/pieces/sector.png?v=2" height="56" alt=""> | A group of production lines | A group of production lines with its own Sector Manager. You work in one sector at a time; the minimap shows all of them and tells you which one needs you. |
| **Sector Manager** <img src="https://raw.githubusercontent.com/caribeedu/roboratory/main/docs/pieces/sector-manager.png?v=2" height="56" alt=""> | Supervisor of the line | Answers questions about its sector and proposes actions and changes to its sector. |
| **Factory** <img src="https://raw.githubusercontent.com/caribeedu/roboratory/main/docs/pieces/factory.png?v=2" height="56" alt=""> | A group of sectors | One git repository. Holds every sector, line model and policy. |
| **General Manager** <img src="https://raw.githubusercontent.com/caribeedu/roboratory/main/docs/pieces/general-manager.png?v=2" height="56" alt=""> | Supervisor of the factory | Answers factory-wide questions and proposes whole new sectors. |

## What you can do today

- **Run lines** with simulated, Claude Code or Codex agents, on target repositories with one git worktree per machine.

  <img src="https://raw.githubusercontent.com/caribeedu/roboratory/main/docs/screenshots/line.png?v=2" alt="A line at work: an intake, machines, a signal, a gate and a pallet" width="900">

- **Watch and trace everything:** the Floor, an attention queue and minimap, a live log at three levels, and a Ledger of every run with its steps, boxes, attempts, transcripts and gate releases.

  <img src="https://raw.githubusercontent.com/caribeedu/roboratory/main/docs/screenshots/ledger.png?v=2" alt="The Ledger, with every run and its steps" width="900">

- **Ask the managers** through the megaphone: answers come with evidence and proposals as buttons; changes show a diff and are written only when you accept.

  <img src="https://raw.githubusercontent.com/caribeedu/roboratory/main/docs/screenshots/manager-proposal.png?v=2" alt="A Sector Manager proposing a change, shown as a diff" width="900">

- **Stay in control:** when a machine burns or a gate waits for you, the Floor says so and opens the piece's panel: the error and the agent's last steps with a hint field for the retry, or the signals before the gate and its confirmations.

  <img src="https://raw.githubusercontent.com/caribeedu/roboratory/main/docs/screenshots/fire-panel.png?v=2" alt="A machine on fire, with its fire panel" width="440"> <img src="https://raw.githubusercontent.com/caribeedu/roboratory/main/docs/screenshots/gate.png?v=2" alt="A two-confirmation gate" width="440">

- **Build the factory on the Floor:** create sectors and lines, insert machines, signals and gates with "+" slots, connect return belts, edit roles and contracts, and save only after the checks pass. YAML is edited in place, so your diffs stay small.

  <img src="https://raw.githubusercontent.com/caribeedu/roboratory/main/docs/screenshots/build-mode.png?v=2" alt="Build mode on the Floor, with a plus slot on every belt" width="900">

## Getting started

**Requirements:** Node 22.12 or later and git. To run real agents you also need [Claude Code](https://claude.com/claude-code) or [Codex](https://github.com/openai/codex) installed and signed in. Roboratory runs on macOS, Windows and Linux; on Windows, signals run through `sh` (install Git for Windows) and agent CLIs must be native executables. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#platform-notes).

```sh
npm ci
```

```sh
npm start
```

Choose **Open the demo factory** on the welcome screen. It creates a factory in `~/Roboratory/Demo Factory` with three sectors and two demo target repositories. Its machines use the simulated agent, so it runs offline and costs nothing. To build or change lines, press **Build** on the Floor. To run a real agent, choose `claude` (or `codex`) as a machine's agent. **Real agents spend money**, so check a line with the simulated agent first.

## Documentation

| Document | About |
|---|---|
| [Product](docs/PRODUCT.md) | What Roboratory is, entity by entity, and how you use it |
| [Architecture](docs/ARCHITECTURE.md) | File layout, runtime and scope |
| [Decisions](docs/DECISIONS.md) | Every design decision, with its reasoning (D1–D43) |
| [Roadmap](docs/ROADMAP.md) | What is planned and what is still open |
| [Assessment](docs/ASSESSMENT.md) | An honest assessment after the first real run |
| [Competitors](docs/COMPETITORS.md) | Other tools that orchestrate coding agents, and what Roboratory takes from each |
| [Development](docs/DEVELOPMENT.md) | Setup, code layout, conventions and lessons about the agent CLIs |
| [Changelog](CHANGELOG.md) | What is built |

The first interactive concept is [docs/prototype/factory-floor.html](docs/prototype/factory-floor.html); open it in a browser.

## Status

Roboratory is an early release (v0.7): the factory, the Floor, headless machines, managers and build mode are built; a headless engine, permission requests and automatic intakes are planned ([docs/ROADMAP.md](docs/ROADMAP.md)).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[MIT](LICENSE)
