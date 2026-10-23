# Roboratory — Assessment

An assessment of Roboratory as a development tool, measured against its goal: a tool that is visual, deterministic, easy to control and versionable. It is based on the first real run of a ticket line (a dependency-update ticket, US$ 8.03 in 88 minutes) and on the work that led to it. It lists only what is still open; what was fixed after the run is in [CHANGELOG.md](../CHANGELOG.md) (D37, D27, and the ticket line's signals and QA). What to do about it is in [ROADMAP.md](ROADMAP.md) §1.

**In short:** the architecture fits the goal. The next step to maturity is not more features. It is trust in the machines that check work, and in the tool permissions.

## What works

- **Determinism where it matters most.** Order, routing, rework and gates come from files; no agent decides the flow. Signals are scripts, and every machine's output is validated against its contract. In the real run:
  - the implement step asked a question when a library upgrade broke authentication, instead of working around it;
  - a `blocked` answer set the machine on fire at once (D22);
  - the draft PR changed only the lock file, targeted `main` and matched what was approved.
- **Versionable.** The factory is a git repository, a run is an open `run.jsonl`, and the floor survives a restart. Build mode edits YAML in place and keeps untouched lines as written.
- **Traceable.** Every step leaves evidence in its own folder and a cost per step. It was possible to audit the validator after the fact and see why its review was shallow.
- **Reasonable cost.** A real PR, with a root-cause investigation, a test in a shared environment and green CI, cost US$ 8.03. The two opus steps (plan and code review) took two thirds of it.
- **The human decides at the right points.** Plan approval and running tests are real decisions, not ceremony.

## Problems

1. **The flow is deterministic; the quality is not.** A `pass` from a checker that verified everything looks the same as a `pass` from one that verified nothing. The validator passed the plan in 26 seconds and verified almost nothing. The plan had a serious error (the new library version would break authentication on every route), and the tests found it, not the validator. The factory trusts its checkers and does not measure them.
2. **Tool permissions are held by instructions, not by the system.** Machines are now told what their shell allows (D27), after four of six machines in the run took one denied command for a denied shell. But the protection itself is still weak: any machine can edit the user's repositories or run `git push` (§5.5 in ROADMAP), and a command outside a machine's list fails instead of asking you.
3. **Human supervision is heavy, and the best value came from outside the line.** A supervisor beside the run checked the dependency alerts, found that the fix had already been released in an internal library, and spotted the denied commands. Without that, the plan would have been approved on a shallow review, and the implement step's question would have been answered without knowing the fix existed.
4. **The information that matters is not yet on screen.** The pixel art is a strength, but what a run is missing, why, and what it has cost so far are read in panels and transcripts, not on the Floor. A signal's checks show only once it runs.
5. **The engine grows one incident at a time.** D19, D20, D22 and D26 came from real problems and were good decisions. But `line.yaml` now has rules, laps, return belts, joins, signals that send boxes back, answer alternatives and time limits, and build mode has 12 known gaps. For one maintainer, the number of concepts is high.
6. **The simulation gives false confidence.** `e2e/factory-sim-check.mjs` replaces signals with `true` and builds outputs from the contracts. None of the defects found in the run (permissions, an ambiguous role, a wrong plan) would show there. Today only a real run, which costs money, finds them.
7. **The app must stay open.** Quitting it interrupts runs, and a rebuilt app takes effect only after ⌘Q. The engine also depends on details of the Claude Code CLI (no combinator at the schema root, deferred tools, `dontAsk`) that were found only by paying for runs.

## Suggestions

The order of work is the roadmap in [ROADMAP.md](ROADMAP.md) §1: the headless runner (6) comes first, because permission requests and the manager's investigations depend on where the engine lives.

1. **Permissions as a first-class feature.**
   - Permission requests at run time: a command outside the list waits for you to allow it once or deny it, instead of failing.
   - A build-mode check: a role that names commands its `allow` list does not permit gets a warning before any run. It would have caught the `cat` and `cd` that QA and the finalizer tried.
   - Read-only machines get no file edits and no `git push`.
2. **Checkers prove their work, deterministically.** The validator's and code reviewer's contracts require what was verified: each item with the command and its result, or a link. A signal after each checker confirms the list is not empty and the links exist. A `pass` without evidence fails the check itself. It is D18 (publish, record, verify) applied to checkers.
3. **The manager investigates questions and gates.** With a read-only shell, the Sector Manager does what the supervisor did in this run and writes a recommended answer or choice, with the cause it verified. You still decide.
4. **A cheap rehearsal with real permissions.** A dry run that keeps the real roles, signals and permissions and only swaps the model for a cheap one, to find role and permission defects for cents before an expensive run.
5. **Metrics per machine from `run.jsonl`:** cost, duration, laps, denied commands, and passes later proved wrong. With these, model, effort and roles are tuned on data.
6. **A headless runner.** Runs continue without the app, and the app becomes a window onto them. This also makes suggestions 4 and 5 easier.
7. **Freeze the core.** A short specification of `line.yaml`. New needs are solved in the factory (roles, scripts, conventions) before a new concept goes into the engine.

**Not before suggestions 1 and 2:** more automation, such as Slack intakes or a manager that acts. More automatic intakes with weak checkers only multiply the passes that cannot be trusted.
