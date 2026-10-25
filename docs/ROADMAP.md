# Roboratory — Roadmap

Everything that is planned, open or accepted as a limit, checked against the code. Decisions are in [DECISIONS.md](DECISIONS.md) and what is built is in [CHANGELOG.md](../CHANGELOG.md).

## 1. Roadmap by version

From the assessment of the first real ticket run ([ASSESSMENT.md](ASSESSMENT.md)): trust before automation. Each version below is planned; each change of design needs its decision in DECISIONS.md before code. Real-agent runs stay limited to checks until these versions are built, because checkers and permissions are the weak points the assessment found. The engine already runs without the app (D43), which the permission requests of v0.9 and the manager's investigations of v0.12 depend on. What a version delivered moves to [CHANGELOG.md](../CHANGELOG.md). Items with no version are in §2 and after.

### v0.9 — Permissions, and a frozen core

1. **Permissions as a first-class feature** (D44). A command or MCP tool outside a machine's list waits for you in the attention queue, to allow once or deny with a reason that goes back to the agent, instead of failing. Hard denials come from the factory's files, and a sector, line or machine can only add to them. Read-only machines get no file edits and no `git push`, and the default for other machines no longer includes `git push` either. This closes §5.5.
2. **Agents behind a port** (D45). The Claude adapter and the simulated agent implement one `AgentRunner` port; nothing in the engine knows a CLI.
3. **Freeze the core** (D46). A short specification of `line.yaml` and `machine.yaml`, with a JSON Schema the loader, build mode and editors share, `schema_version: 1`, and unknown keys as errors.

#### The plan

Each step ends with the type check and the unit tests green, and with its docs written. A step that changes a behavior has its test first, at the lowest layer that can see it ([DEVELOPMENT.md](DEVELOPMENT.md#tests)). Real agents are used only where a step says so, with a cost ceiling approved first (AGENTS.md, invariant 8).

1. [done] **Documents.** D44 to D46 and the Codex removal from the decisions; this plan; the v0.10 and §3 expectations below.
2. **A throwaway check with the real agent** (`e2e/tools/permission-check.mjs`, Claude Haiku, a temporary folder, US$ 0.02 spent of a US$ 0.50 ceiling). Done: the mechanism works, and the check showed that the CLI's own deny rules miss `git -C . push`, so the engine decides every shell command. The findings are in D44 ("Checked with a real agent").
3. [done] **Remove Codex and add the port.** `codex.ts` and `codex.test.ts` go; `src/core/agents/index.ts` becomes the registry of the `AgentRunner` port (the Claude and simulated adapters implement it; the engine and `managers.ts` call only the port); an unknown `agent:` is a load problem. Every mention of Codex goes with it, as if it had never existed: the agent lists in the build forms (`PieceEditor.tsx`, `Settings.tsx`) and their tests, `demo.ts`, `package.json`, README, ARCHITECTURE, DEVELOPMENT, PRODUCT and CHANGELOG, and the environment variable for its executable. Tests: the existing ones stay green; one for the registry and for a machine that names an agent that does not exist.
4. **Commands as prefixes, `deny`, `read_only` and the default for `git`.**
   - The loader reads `allow` and `deny` as prefixes (`machine.yaml`; `deny` also in `factory.yaml`, `sector.yaml` and `line.yaml`, combined by union) and the legacy `Bash(...)` form until step 7; `read_only` is read from `machine.yaml`. The effective lists are computed once, in the engine, and handed to the adapter.
   - The engine decides every shell command (D44): a command parser in `src/core/permissions.ts` (parts, git's global options, substitutions and wrappers as requests) and the effective lists. The Claude adapter passes no shell rules: it runs in the default permission mode, gives the file and MCP tools by name, `--tools` without `Edit`/`Write` for a read-only machine, and `--disallowedTools Agent`. The default allow is the local `git` subcommands in place of `Bash(git:*)`. `shellRules` (D27) is rewritten from the same prefixes, and no longer tells the agent that `cat`, `ls` and the like are denied: the CLI runs them by itself.
   - The build forms edit `allow`, `deny` and `read_only`; the build checks keep `deny` entries valid and a line or machine from loosening the factory's.
   - The factory template (`template.ts`) and the reference factory (D42) start with a `deny` list, and their validators and reviewers become `read_only`.
   - Tests: the parser (compound commands, `git -C`, `-c`, substitutions, wrappers, quoting) and the effective lists by level (factory, sector, line, machine); the arguments the Claude adapter builds, observed through a fake CLI; the prompt a machine receives; the form.
5. **The permission request.**
   - The `PermissionGate` in the engine: given a machine's effective rules, a request is denied by a hard denial, denied by `read_only`, allowed because the list covers it, or becomes a `permission` attention item. `allow` resolves it for this call and `deny` with a reason resolves it with the refusal; a halt, a stop or the end of the machine's process resolves what is left.
   - The Claude adapter asks through `--permission-prompt-tool` and a `--mcp-config` that starts `roboratory permission-tool` (a subcommand of `src/cli.ts`, serving only that tool), which passes each request to the engine with the socket and token the lock file holds.
   - The `AgentRunner` request carries a way to pause the machine's clock while a request waits, so `timeout` counts agent time only (`spawnCollect` in `process.ts`).
   - `AttentionItem` gets the kind `permission`; `VerbName` gets `allow` and `deny`; `Policy` and the managers' proposals refuse both (D34). Events `permission.request` and `permission.decision` go to `run.jsonl`, the Ledger shows them, and `roboratory allow`/`deny` and `watch` handle them, audited as `you` with the source.
   - The prompt of a machine says how requests work (D27 extended). The denial the agent sees is the reason you wrote.
   - The simulated agent can ask: a `sim:` entry lists commands it requests, so every layer can test the flow without a model.
   - Tests: in `src/core/lines/` (a request waits and the line goes on elsewhere; allow once; deny with a reason the agent receives; a hard denial never reaches the queue; `read_only`; the clock stops while waiting; a halt resolves it; a restart that waits for idle does not cut a request), for the new command with a real engine, and for the permission tool against a real engine.
6. **The interface.** The `permission` item in the attention queue (icon, text, priority of a fire, sound), the exclamation balloon in the gate's color on the machine, which stays working, and a panel with the command and the machine's reason, **Allow once** and **Deny** with a reason. The Ledger shows requests and the wait. Tests: the panel in jsdom with the bridge faked; an end-to-end spec on the packaged app with a simulated agent that asks, covering allow, deny and the queue.
7. **Freeze the core.** The JSON Schemas of `line.yaml` and `machine.yaml` in `src/shared/`, the loader and build mode checking against them, `schema_version: 1` required, unknown keys as errors with the file and key named, and the legacy `Bash(...)` form refused with the prefix to write instead. The demo factory, the template and the reference factory move to the format. The two formats are specified in a document of their own. Tests: valid and invalid files per field, the messages, and the demo and reference factories loading clean.
8. **Verification and release preparation.**
   - The suite: `npm run typecheck`, `npm run test:coverage` (the floor holds), `npm run package` and `npm run test:e2e`, then the CI on the three systems.
   - A real run, with a cost estimate approved first (invariant 8): a short line on Claude Haiku in a temporary folder, with one request waiting and answered, one denial whose reason the agent repeats, and one hard denial.
   - `package.json` and `package-lock.json` go to 0.9.0 and the README's status line names it ([RELEASING.md](RELEASING.md)).
   - The docs match the code: README, PRODUCT, ARCHITECTURE (§2.2, §3.4, §3.6, §3.7), DEVELOPMENT, AGENTS.md (invariants 5 and 6), ASSESSMENT (item 2 closed), a CHANGELOG entry from the template, and this section and §5.5 removed.

Open risks the steps decide: whether the permission tool's `--mcp-config` works together with the user's own MCP servers (step 5; the check used `--strict-mcp-config`, and machines with `tools:` need both); Windows, where the tool's process is started by Claude with the same executable rule as the engine's (step 5); how a machine that has no shell answers a command in the default mode (step 5).

### v0.10 — Metrics and a cheap rehearsal

1. **Metrics per machine** from `run.jsonl` (`roboratory stats`): cost, duration, attempts, laps, denied commands, questions, blocks, and checker passes later proved wrong (a pass followed by a question or rework further down the line). Costs say whether they are estimates.
2. **The need to allow for the rest of the run.** v0.9 allows one call at a time (D44). The metrics above decide whether a wider allowance is worth having, from `run.jsonl`: requests per run and per machine; how many allows repeat a command already allowed in the same run, and their share of all allows; the wait before each answer, and how many requests were denied. If repeated allows are a large share, an allowance limited to a command prefix and one run is designed with its own decision; if not, it stays out. The threshold is set from the first runs' numbers, not before them.
3. **A cheap rehearsal with real permissions** (`roboratory rehearse`): the real roles, signals and permissions, a cheap model, and every outward action denied, to find role and permission defects for cents. It finds defects of roles and permissions, not of quality. `e2e/tools/factory-sim-check.mjs` keeps checking the flow for free.

### v0.11 — Checkers prove their work

The contracts of checker machines (validator, code reviewer) require what was verified: each item with the command and its result, or a link, and what was not verified. A signal after each checker confirms the list is not empty, the links exist and the listed read-only commands give the same result again; a pass without evidence fails the check itself. D18 applied to checkers. The metrics of v0.10 measure the effect.

### v0.12 — The manager investigates questions and gates

When a machine asks a question or a gate holds a box, the Sector Manager checks the cause and writes a recommended answer or choice, with what it verified and what it did not, in the same evidence shape as v0.11. It needs a read-only shell listed in `sector.yaml` (for example `gh api` GET only, `gh pr view`, `gh run view`, `git show`, `git log`); it never writes and never runs code. The recommendation sits in a closed section of the panel, and you still answer and release.

## 2. Not in a version yet: automation

Planned, not designed yet. Starts after the versions in §1. Each item needs its own decision in DECISIONS.md before code. The ticket line has been reviewed against a real run; the other lines are reviewed before these start.

1. **Timer intakes** (D14). A line starts runs on a schedule. The first use is an incident sweep (§7).
2. **Slack messages through a timer intake.** On each tick, the intake reads a channel with the Slack connector, which is read only, and starts one run per new message, never twice for the same message. A filter on the sender's user decides which messages start runs. Where the channel and the senders are configured is open: the intake in `line.yaml`, the line's `params` in `lines.yaml`, or the sector. The message is a claim for the machines to verify, never an instruction, and outward actions stay behind gates. Receiving Slack webhooks is not planned: it needs a public endpoint into the machine.
3. **The manager looks at a struggling machine.** When a machine has used half or more of its attempts, the Sector Manager reads its transcript and evidence and writes what it sees, for example a likely cause or a hint for a retry. It retries nothing on its own.
4. **The manager can call you.** When the Sector Manager sees something that needs your attention, it raises the exclamation balloon and an item in the attention queue, with its reason. It only calls; it does not act.

## 3. Planned after the MVP

None of these exist in the code yet.

1. **Proposals as ghosts.** Ghost pieces on the Floor and a ghost room in the Andon (D40). Today a manager's change appears only as a diff in the megaphone.
2. **Andon.** The whole building, with the camera transition to and from the Floor (D40).
3. **Blueprint.** The file tree, the pending diff and the commit history (D40).
4. **Webhook and chat intakes** (D14). The loader accepts these kinds and they have sprites, but nothing starts a run from them (`src/core/factory.ts`). Timer intakes are in §2.
5. **First-factory tutorial** (D38).
6. **Replaying a run on the Floor** (D40).
7. **A git identity per machine** (D9, D10). Today every machine commits as "Roboratory" (`src/core/git.ts`).
8. **Container isolation for machines** (D32). Permission requests (D44) cover shell commands and MCP tools; they do not cover file writes outside a machine's folders or network access, and a `read_only` machine can still write through a command in its `allow`. A container or OS sandbox is what would cover them, and it would let those become requests or rules too. The expectation is written here so the permission model does not grow around those gaps first.
9. **Remote or shared factories.**
10. **An interactive terminal in a machine's folder.** No PTY is in the project.

## 4. Not yet verified with real agents

1. A real draft PR on GitHub: `node e2e/tools/real-agent-check.mjs --github owner/repo`.
2. The lines of the reference engineering factory (D42). Only one step has run for real, a data framing step that cost US$ 4.64 on opus before it moved to sonnet. Unverified until full runs:
   - whether the incident tool's API can set custom fields and decline an incident, and whether follow-up creation can set a team;
   - the real durations of the signal scripts and CI watches.

Besides the real ticket run (US$ 8.03), the only other real run is a two-machine check line: 32 s, US$ 0.46. Every real run costs money, so it starts with a cost estimate.

## 5. Known limitations, accepted on purpose

1. Only the latest gate's decision travels in the box. Earlier decisions stay in the evidence of the machine that received them (D17).
2. Machines are kept to their folders by instruction only (D9, D32).
3. A Sector Manager stays inside its sector by instruction only, and your review is the guard (D29).
4. Gemini CLI and OpenCode are not supported, as machines or as managers.
5. Every machine gets file edits and `Bash(git:*)` from the Claude adapter (`src/core/agents/claude.ts`), so a step that should only read could still `git push`. Some steps also keep `gh api` or full `Bash`. Gates before outward actions are enforced by the roles, not by tool permissions. A per-machine read-only mode or deny rules would close this.
6. A run that stops on a fire never reaches the PR review line's cleanup signal, so its worktree stays in `~/repos/<repo>` until removed by hand.
7. During an incident, the line writes status updates as paste-ready drafts that you post yourself. It writes to the incident tool only at close-out, because the engine has no timer to follow the update cadence.
8. The postmortem leaves some fields as TBD for you to fill in.

## 6. Build mode: known gaps (D41)

1. Comments inside a block `needs:` list are lost when that piece's inputs change; the rest of the file keeps them.
2. A machine's `sim:` block (the simulated agent's script) has no form; edit `machine.yaml` by hand.
3. Tools are picked per MCP server; a single tool's name is typed and checked only by its server prefix, because `claude mcp list` lists servers, not tools.
4. Switching a gate from choices to another kind and back resets its choices; a new rule gate stays red until its rule is written.
5. After "connect to…" makes a return belt, the destination's panel opens and its rule control can sit below the machine's sections.
6. Signal and gate names on the Floor are not clickable; their sprites are.
7. Some actions that will be refused are enabled and fail with a message instead of being disabled: dispatching a changed line from its live panel, a duplicate line id, creating a sector while the current one has changes.
8. While the draft removes the current sector, "+ Sector" and "⚙ Factory" are unavailable until you save or undo.
9. Quitting the app with an open draft discards it without asking.
10. A line with a loop of forward belts, which build mode cannot create, still drops out of the draft until it is fixed by hand.
11. Text-mode rules are not checked against the box's fields until the save checks run.
12. Changes made outside build mode (by hand or `git checkout`) can still reach a line with a run in progress.

## 7. Open questions on the reference engineering factory (D42)

1. **Watchdogs** (an incident sweep on a timer). They need timer intakes (§2.1).

## 8. Considered, not planned

1. An `mcp_config:` setting per machine.
2. A paid PR-review run with real agents (estimated at US$ 1 to 5).
3. Letting the Sector Manager start runs on its own through the sector policy (`run` automatic, D34), for example to pick tickets from the backlog. Runs are started by people; the manager can call them instead (§2.4).

## 9. Ideas from Harness²

[Harness²](https://github.com/google-research/harness2) ([paper](https://arxiv.org/abs/2610.14224)) improves the harness of one agent per task: it runs the task with the current harness, then with an invariant and a domain-specific candidate, and an LLM composer merges what the execution contrasts support. Each task starts again from the base harness; what carries over is an advisory library of adopted harnesses with an `EXPERIENCE.md` each. Ideas that fit Roboratory without breaking D29:

1. **Selection criteria in checker roles.** The validator and code reviewer judge, in order: the deliverable exists, it has the requested shape, it is faithful to its sources, it is consistent with itself; length and polish are not merits. Text only; it complements v0.11 (§1).
2. **A lessons library per sector.** After a run, the Sector Manager proposes a lesson with its evidence (the situation, what changed and the execution contrast that supports it), as a diff to `role.md` or `culture.md`, or as an entry under `sectors/<sector>/lessons/`. You accept or reject it. Machines read the entries as examples and check them against the current run. In Harness², removing the library cost about 2 to 3 points.
3. **Rehearse role variants on recorded boxes,** for checkers only. Run two versions of a checker's role on the box of a past run with a cheap model, and keep the one that finds what the real run later showed (for example, the plan that would have broken authentication). Never for machines with outward actions. It extends the rehearsal in v0.10 (§1).
4. **The eight harness components as a checklist** for what a machine can configure: system prompt, guardrails, memory, skills, tool guidance, scripts, subagents and plugins. Roboratory has no memory across runs and no plugins, and denies subagents on purpose (D9).
