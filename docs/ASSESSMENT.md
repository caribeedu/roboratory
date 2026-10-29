# Roboratory — Assessment

An assessment of Roboratory as a development tool, measured against its goal: a tool that is visual, deterministic, easy to control and versionable. It is based on the first real run of a ticket line (a dependency-update ticket, US$ 8.03 in 88 minutes) and on the work that led to it. It lists only what is still open; what was fixed after the run is in [CHANGELOG.md](../CHANGELOG.md) (D37, D27, D44, and the ticket line's signals and QA). What to do about it is in [ROADMAP.md](ROADMAP.md) §1.

**In short:** the architecture fits the goal. The next step to maturity is not more features. It is trust in the machines that check work.

## What works

- **Determinism where it matters most.** Order, routing, rework and gates come from files; no agent decides the flow. Signals are scripts, and every machine's output is validated against its contract. In the real run:
  - the implement step asked a question when a library upgrade broke authentication, instead of working around it;
  - a `blocked` answer set the machine on fire at once (D22);
  - the draft PR changed only the lock file, targeted `main` and matched what was approved.
- **Versionable.** The factory is a git repository, a run is an open `run.jsonl`, and the floor survives a restart. Build mode edits YAML in place and keeps untouched lines as written.
- **Traceable.** Every step leaves evidence in its own folder and a cost per step. It was possible to audit the validator after the fact and see why its review was shallow.
- **Reasonable cost.** A real PR, with a root-cause investigation, a test in a shared environment and green CI, cost US$ 8.03. The two opus steps (plan and code review) took two thirds of it.
- **The human decides at the right points.** Plan approval and running tests are real decisions, not ceremony.
- **The system holds the permissions.** A command outside a machine's list waits for you with the command in front of you, what the factory never allows is refused without asking, and a read-only machine can neither edit files nor push (D44). The core files are versioned and strict (D46).

## Problems

1. **The flow is deterministic; the quality is not.** A `pass` from a checker that verified everything looks the same as a `pass` from one that verified nothing. The validator passed the plan in 26 seconds and verified almost nothing. The plan had a serious error (the new library version would break authentication on every route), and the tests found it, not the validator. The factory trusts its checkers and does not measure them.
2. **Human supervision is heavy, and the best value came from outside the line.** A supervisor beside the run checked the dependency alerts, found that the fix had already been released in an internal library, and spotted the denied commands. Without that, the plan would have been approved on a shallow review, and the implement step's question would have been answered without knowing the fix existed.
3. **The information that matters is not yet on screen.** The pixel art is a strength, but what a run is missing, why, and what it has cost so far are read in panels and transcripts, not on the Floor. A signal's checks show only once it runs.
4. **The engine grows one incident at a time.** D19, D20, D22 and D26 came from real problems and were good decisions. But `line.yaml` now has rules, laps, return belts, joins, signals that send boxes back, answer alternatives and time limits, and build mode has 12 known gaps. For one maintainer, the number of concepts is high. The formats are now specified and strict ([FORMATS.md](FORMATS.md)), which stops them growing by accident.
5. **The simulation gives false confidence.** The free simulation (`rehearse --simulation`, D48) replaces signals with `true` and builds outputs from the contracts. None of the defects found in the run (an ambiguous role, a wrong plan) would show there. Today only a real run, which costs money, finds them.
6. **The engine depends on details of the Claude Code CLI** (no combinator at the schema root, deferred tools, a permission tool started as an MCP server, deny rules that miss `git -C`) that were found only by paying for runs. (The app no longer has to stay open: the engine runs apart from it, D43.)

## Suggestions

The order of work is the roadmap in [ROADMAP.md](ROADMAP.md) §1. The engine already runs without the app (D43), and permission requests and the frozen core are built (D44, D46); checkers that prove their work (1) come next; the metrics and the cheap rehearsal (3, 4) are built (D47, D48).

1. **Checkers prove their work, deterministically.** The validator's and code reviewer's contracts require what was verified: each item with the command and its result, or a link. A signal after each checker confirms the list is not empty and the links exist. A `pass` without evidence fails the check itself. It is D18 (publish, record, verify) applied to checkers.
2. **The manager investigates questions and gates.** With a read-only shell, the Sector Manager does what the supervisor did in this run and writes a recommended answer or choice, with the cause it verified. You still decide.
3. **A cheap rehearsal with real permissions.** A dry run that keeps the real roles, signals and permissions and only swaps the model for a cheap one, to find role and permission defects for cents before an expensive run. The engine now being its own process makes it easier to drive.
4. **Metrics per machine from `run.jsonl`:** cost, duration, laps, permission requests and denied commands, and passes later proved wrong. With these, model, effort and roles are tuned on data.

**Not before suggestion 1:** more automation, such as Slack intakes or a manager that acts. More automatic intakes with weak checkers only multiply the passes that cannot be trusted.
