# Promptory — Competitors

Tools that orchestrate coding agents, checked against their own READMEs and docs in October 2026. Star counts and releases are from GitHub on 2026-10-19 (2026-10-22 for Orchestrator.inc, OpenAgents and nodeterm). Each section has the same parts: what the tool is and its link; six profile lines (maturity, versionability, similarity, tracing, custom flows and free commercial use); **Inspirations** (ideas to take), **Overlaps** (what it does the same or almost the same) and **Contradictions** (what it does or decided differently).

Similarity is Low, Medium or High against Promptory's model: deterministic lines in files, human gates before outward actions, and a fresh headless step per machine. Reddit could not be searched: it refused every automated access, so the sources are GitHub, Hacker News and web search.

## Archon
A "factory builder": YAML workflows in `.archon/workflows/` run AI agents, scripts and human decisions as a graph. Its `sdlc` pack takes an issue to a merged PR. Link: https://github.com/coleam00/Archon

- Maturity: 23.7k stars, since February 2025, v0.12.1 (October 2026).
- Versionability: Workflows are YAML in `.archon/workflows/` in the repository; run state is in SQLite or PostgreSQL.
- Similarity: High: YAML graph, schema-routed output, approval gates, fresh-context loops and a worktree per run.
- Tracing: Yes: events, transcript and cost per run.
- Custom flows: Yes, YAML workflows, also shared as packs.
- Free commercial use: Yes (MIT).

### Inspirations
- `when:` conditions read fields of an `output_format` JSON Schema (`$classify.output.type == 'BUG'`), and the loader refuses conditions on free-text output.
- Each paused run is one attention item: what it is, why it matters, a recommendation and the choices.
- A `discoveries` workflow records what runs noticed outside their task, so nothing is lost.
- A merge gate checks the review verdict, CI and open threads at the head commit.
- Workflow packs are shared as GitHub repositories (`archon plugin add owner/repo`), a model for sharing lines.

### Overlaps
- A YAML graph in the repo with prompt, bash, script, loop and wait nodes. Loops have `until_bash` checks, `max_iterations` and `fresh_context`; `wait` nodes are approve or reject gates.
- A worktree per run, `model`, `allowed_tools` and `denied_tools` per node, and cost, events and transcript per run.
- Runs Claude Code, Codex and Pi through the user's own CLIs and subscriptions.

### Contradictions
- Run state is in SQLite or PostgreSQL, not in plain files next to the factory.
- Anonymous telemetry to PostHog is on by default.
- Context can be `shared` or resumed from an earlier node, not always fresh.
- A `pr` node can push and open a PR right after one approve gate. The interface is a CLI, a web console and chat apps; there is no visual floor.

## OpenRig
A local control plane (the `rig` CLI and a daemon) that runs persistent teams ("rigs") of Claude Code, Codex and Pi agents in tmux, defined in YAML, with queues, workflows, watchdogs and a TUI. Link: https://github.com/mvschwarz/openrig

- Maturity: 7.9k stars, since April 2026, v0.6.11 (October 2026).
- Versionability: Rigs, agents and workflows are YAML files in git; runtime state is in SQLite under `~/.openrig`.
- Similarity: High: workflow YAML with routing, limited rework loops and human gates; agents are long-lived sessions.
- Tracing: Yes: local history with `rig telemetry` cursors.
- Custom flows: Yes, workflow YAML.
- Free commercial use: Yes (Apache-2.0).

### Inspirations
- Proof contracts: a slice's Definition of Done is its proof, with `rig proof add/judge` and a `proofPolicy`. Plan-lock and proof-lock gates check the proof before release.
- Watchdogs: reminders, context-use thresholds and a keepalive that nudges steps that are late.
- `rig parked` and `crash-cart` list stopped seats that still owe work, a model for the attention queue.
- The text of a gate decision is what the agent acts on ("post comments 1 and 3 only"), more than approve or reject.

### Overlaps
- Workflow YAML with steps, roles, `allowed_exits`, `next_hop` routing and limited rework loops (a failed plan review goes back to the plan).
- Human gates park the work on `human@kernel` until `rig queue resolve`; agents ask the human mid-step through the same queue.
- Specs are files in git; each seat has its own working directory and worktree; a model per seat.

### Contradictions
- Agents are long-lived tmux sessions that keep their context, with `fork`, `snapshot` and context watchdogs. Promptory starts each step with a fresh, headless context.
- A lead agent coordinates the others through queues and messages.
- State is in a daemon with SQLite under `~/.openrig`, and launching it writes hooks and settings into the workspace and skills into `~/.claude/skills`.
- No JSON Schema contract per step.

## Tutti
"Multi-agent orchestration CLI" in Rust (`tt`), with a web dashboard. Link: https://github.com/nutthouse/tutti

- Maturity: 130 stars, since March 2026, v0.10.1 (May 2026); last push July 2026.
- Versionability: Team and workflows in `tutti.toml`, versioned with the code.
- Similarity: High: a factory-floor dashboard, workflows of prompt and shell steps, a worktree per agent and a run ledger.
- Tracing: Yes: run ledger and token and cost tracking.
- Custom flows: Yes, workflows in `tutti.toml`.
- Free commercial use: Yes (MIT).

### Inspirations
- A loop of Intake, Execution, Review, Gate and Record, where gates also check cost and policy limits.
- Swapping the runtime for a whole role at once (`claude-code` to `codex` in `[roles]`).
- Claim leases on GitHub issues for unattended runs, and starter templates (`tt init --template ...`).

### Overlaps
- A "factory floor" dashboard with agents and work items that move through the pipeline, shown as working, idle, stopped or blocked.
- Team and workflows as versioned files (`tutti.toml`), prompt steps chained with shell commands, a worktree per agent, a run ledger and cost tracking.

### Contradictions
- Agents are persistent tmux sessions, not fresh headless steps.
- One TOML file instead of a folder per machine, and no output schema per step.
- The README does not put every outward action behind a human gate.

## Bernstein
A Python "governance layer" and deterministic scheduler for more than 50 CLI coding-agent adapters. One YAML file declares phases, roles, dependencies and conditional edges, and each coding task runs in its own worktree behind merge gates. Link: https://github.com/sipyourdrink-ltd/bernstein

- Maturity: 1.3k stars, since March 2026, v3.22.0 (October 2026); beta, one maintainer.
- Versionability: One YAML file declares the graph, with state in files.
- Similarity: High: no LLM in coordination, conditional edges and retries in YAML, a worktree per task behind merge gates.
- Tracing: Yes: a replay journal, an optional HMAC-chained audit log and cost in the dashboard.
- Custom flows: Yes, YAML graphs.
- Free commercial use: Yes (Apache-2.0).

### Inspirations
- Conditional edges and retry loops in YAML (`condition: "status == 'failed'"`, `retry: max_attempts: 3, until: "status == 'done'"`), the same idea as return belts with lap limits.
- A replay journal and an opt-in HMAC-chained audit log, where non-determinism "surfaces as a hash mismatch at the exact step". It would harden `run.jsonl`.
- A node that does not produce code "finishes on a signed lineage receipt instead of a commit".
- Role fences per phase (`allowed_roles: [qa, security]`) and ready-made graphs in `.bernstein/scenarios/`, a model for starter factories.

### Overlaps
- "No LLM in the coordination loop. Scheduling is plain Python, so a run is reproducible end to end."
- A worktree per coding task behind merge gates, "file-based state, no SaaS hop", a TUI and a browser dashboard with cost.

### Contradictions
- A manager LLM breaks the goal into tasks ("One LLM call, then plain Python from there").
- "Verified work lands in main", and failed tasks are "routed to a different model".
- A much wider scope (SCIM, OIDC, Vault, OPA), in beta, with one maintainer.

## OpenAI Symphony
A language-independent spec and an Elixir reference build: it polls Linear, makes one isolated workspace per issue and runs a Codex session in it, with the policy in a `WORKFLOW.md` in the repository. Link: https://github.com/openai/symphony

- Maturity: 27.7k stars, since February 2026, v0.0.3 (September 2026); "a low-key engineering preview".
- Versionability: The policy is `WORKFLOW.md` in the repository.
- Similarity: Medium: one workspace per issue and a human review state, driven by the tracker.
- Tracing: Partly: token counters per run in the orchestrator state.
- Custom flows: Partly: `WORKFLOW.md` sets the policy and states, not a step graph.
- Free commercial use: Yes (Apache-2.0).

### Inspirations
- The policy is one versioned file: it "keeps the workflow policy in-repo (`WORKFLOW.md`) so teams version the agent prompt and runtime".
- Shell hooks on the workspace lifecycle (`after_create`, `before_run`), close to signals.
- Stall detection (`codex.stall_timeout_ms`, 5 minutes by default) and a retry queue with attempt counts, for the attention queue.
- A run can end at a handoff state such as `Human Review`.

### Overlaps
- One workspace per issue, limited concurrency, and one orchestrator state that decides "dispatch, retry, stop, or release".
- Human review is an explicit state in the flow.

### Contradictions
- The tracker drives the work, and "Ticket writes (state transitions, comments, PR links) are typically performed by the coding agent".
- One long thread per issue with continuation turns up to `agent.max_turns`, not a fresh context per step.
- The spec "does not require a single approval, sandbox, or operator-confirmation policy", and it is "a low-key engineering preview".

## Gas Town
A Go workspace manager that coordinates 20 to 30 Claude Code, Codex, Copilot or Gemini agents, with a "Mayor" coordinator, "Polecat" workers, a "Refinery" merge queue and work state in git and the Beads issue ledger. Link: https://github.com/gastownhall/gastown

- Maturity: 18.4k stars, since December 2025, v1.2.1 (June 2026).
- Versionability: Formulas are TOML files; work state is in git and the Beads ledger.
- Similarity: Medium: a town of named roles with worktrees and a merge queue, coordinated by an agent.
- Tracing: Yes: `.events.jsonl` and OpenTelemetry export.
- Custom flows: Yes, TOML formulas.
- Free commercial use: Yes (MIT).

### Inspirations
- Workflow templates as TOML files ("Formulas") that become tracked runs ("molecules") with checkpoint recovery.
- A problems view that groups agents as stalled, zombie or working, with keys to nudge or hand off.
- The Refinery "batches merge requests, runs verification gates, and merges to main using a Bors-style bisecting queue."
- Escalation by severity (`gt escalate`, P0 to P2), and "Seance", where a new session queries earlier ones through `.events.jsonl`.

### Overlaps
- A town metaphor with named roles, a worktree per worker, a TUI and a web dashboard.
- Workers have "persistent identity but ephemeral sessions".

### Contradictions
- "The Mayor is a Claude Code instance … just tell the Mayor what you want": an agent coordinates.
- OpenTelemetry export of "all agent operations".
- Built for 20 to 50 agents, with watchdog agents that supervise the others.

## LoopX
A local-first "control plane" above Codex and Claude Code that keeps goals, decisions, evidence and gates across sessions, shown as an "agent-native Kanban". Link: https://github.com/loopx-project/loopx

- Maturity: 6.4k stars, since May 2026, v1.4.2 (October 2026).
- Versionability: No: the active state is in `.loopx/`, which the project says not to commit.
- Similarity: Medium: human-owned gates and evidence on a local board, with no fixed routes.
- Tracing: Yes: evidence and receipts per card.
- Custom flows: Partly: gates and operators on cards, not fixed lines.
- Free commercial use: Yes (Apache-2.0).

### Inspirations
- "The board is a projection; LoopX state remains the source of truth", the right rule for the floor and the factory files.
- Cards that "carry identity, authority, evidence, and continuation", moved only by checked operators ("claim, gate, monitor, and writeback").
- Protected changes go "through typed preview, explicit confirmation, and receipts".
- It names a cost risk: "a scheduler can keep spending after no useful transition remains."

### Overlaps
- "Dangerous permissions, publishing, production writes, and final ownership stay with the human."
- A local dashboard of "what needs you, what is running", for Codex and Claude Code.

### Contradictions
- Built for work over days with heartbeat continuation, not short fixed lines.
- Peer agents claim work, and "no durable leader identity is required"; there are no fixed routes.
- Steering through a Lark chat integration.

## Shopify Roast
A Ruby DSL for structured AI workflows that mixes deterministic steps (`cmd`, `ruby`) with agent steps that run Claude Code or Pi locally. Link: https://github.com/Shopify/roast

- Maturity: 1.3k stars, since April 2025, 1.4.0 (October 2026).
- Versionability: Workflows are Ruby files in the repository.
- Similarity: Medium: deterministic workflows that mix shell and agent steps.
- Tracing: Partly: a log with levels (`ROAST_LOG_LEVEL`), an event monitor and custom loggers (`examples/custom_logging.rb`).
- Custom flows: Yes, Ruby workflows.
- Free commercial use: Yes (MIT).

### Inspirations
- Shell steps and agent steps are equal parts of one flow (`cmd(:recent_changes)` feeds `agent(:review)`).
- `map` (serial or parallel over a collection), `repeat` (until a condition) and reusable scopes through `call`.
- Its example workflows are its end-to-end tests, a model for testing sample factories.

### Overlaps
- A fixed workflow drives the agents, as local files in the repository.

### Contradictions
- Workflows are Ruby code, not YAML and JSON Schema.
- No human gates, worktrees, cost ledger or visual interface in the README.

## ruflo
A "meta-harness for Claude Code and Codex" (formerly Claude Flow) with more than 100 agents, swarms, vector memory, federation and a console. Link: https://github.com/ruvnet/ruflo

- Maturity: 76.9k stars, since June 2025, v3.57.0 (October 2026).
- Versionability: Workflows are plugins; it also writes `.claude/` and `.claude-flow/` into the workspace.
- Similarity: Medium: workflows with approval gates and cost tracking, but agents route the work.
- Tracing: Yes: a console with workflows, agents, tokens and cost.
- Custom flows: Yes, through `ruflo-workflows`.
- Free commercial use: Yes (MIT).

### Inspirations
- Control levels (`read`, `write`, `manage`, `full`) with `ask` or `auto`, where "network, spending and destructive actions require confirmation even in `auto`".
- A "Take back control" button that pauses the agent's tools until you restore them, a kill switch.
- `ruflo-workflows` has states `created → running ↔ paused → completed/cancelled` and "approval gates: manual pause points for human review".
- It says what its demo does not prove: "Neither is evidence of completed swarm work".

### Overlaps
- Drives Claude Code and Codex, tracks "workflows, agents, models, tokens and cost", and sets budgets with alerts.

### Contradictions
- "The hooks system automatically routes tasks, learns from successful patterns", with a "Queen-led hierarchy".
- Federation trust changes with "no human in the loop required".
- Writes `.claude/`, `.claude-flow/` and `CLAUDE.md` into the workspace, and its workflows "fan subagents out".

## qm (YC)
"A multiplayer agent harness for work. In Slack and on the web": a self-hosted core with scopes per person and per room, a Postgres store and a sandbox per scope. Link: https://github.com/yc-software/qm

- Maturity: 15.4k stars, since July 2026, v0.1.14 (October 2026).
- Versionability: Low: state is in PostgreSQL; design changes are ADRs in `adrs/`.
- Similarity: Low: a multi-user Slack and web service where agents spawn swarms.
- Tracing: Yes: "everything it does is audited" and workers keep durable transcripts.
- Custom flows: Partly: swarms are started by agents, not defined as flows.
- Free commercial use: Yes (MIT).

### Inspirations
- One security posture per organization (Strict, Auto or Dangerous), and "Narrower scopes can only tighten" it. A factory posture that a line can tighten but never loosen.
- "The predeclared command policy — approval rules and hard denials for things like recursive deletes or destructive SQL — applies in every posture", a hard-deny list beside `allow`.
- Content screening with `observe` and `enforce` modes, a model for signals that only report.

### Overlaps
- "Pi and Claude Code both drive the same core", and "everything it does is audited".
- The requester can allow or deny pending approvals of the workers.

### Contradictions
- A multi-user service in your cloud, with Postgres for "sessions · memory · queue".
- The default Auto posture does not gate tool calls, and swarm workers "can recursively call the same API".
- Long-lived sandboxes and memory, not a fresh context per step.

## multi-agent-shogun
A tmux system that runs up to 10 coding CLIs in a "Shogun → Karo → Ashigaru" hierarchy that talks through YAML files on disk. Link: https://github.com/yohey-w/multi-agent-shogun

- Maturity: 1.4k stars, since January 2026, v5.1.0 (May 2026).
- Versionability: Instructions, reports and roles are YAML and Markdown files you can version.
- Similarity: Low: an LLM hierarchy routes the work with no gates.
- Tracing: Partly: `dashboard.md` and YAML reports.
- Custom flows: Partly: roles in files; routing is done by the Karo agent.
- Free commercial use: Yes (MIT).

### Inspirations
- "Message content is never sent through tmux — only a short 'you have mail' nudge. The agent reads its own file."
- Workers report skill candidates; each one "Appears in dashboard.md → You approve".
- One writer for the dashboard, so "All updates pass through a single quality gate".
- The author later "disbanded his own 10-agent army down to a single agent that carries his judgment". A warning to keep in mind.

### Overlaps
- Every instruction and report "is a plain YAML file you can read, diff, and version-control", with roles in files and a dedicated review role.

### Contradictions
- "The Karo assigns each subtask a Bloom level and routes it": an LLM routes.
- Setup starts with `claude --dangerously-skip-permissions`, with no gates before outward actions.
- Long-lived sessions, and it targets flat-rate plans ("Use AI recklessly").

## Microsoft Conductor
"A CLI tool for defining and running multi-agent workflows with the GitHub Copilot SDK and Anthropic Claude", with agents, prompts and routing in one YAML file. Link: https://github.com/microsoft/conductor

- Maturity: 478 stars, since February 2026, v0.1.42 (October 2026); Copilot, OpenAI and Claude providers "Stable", the Claude Agent SDK provider "Experimental".
- Versionability: Yes: "Plain YAML files. Diff workflows in pull requests, version them with your code", and registries pin workflows by git tag.
- Similarity: High: "repeatable, deterministic, and version-controlled", with "No LLM in the orchestration loop, no tokens spent deciding what runs next."
- Tracing: Yes: an `events.jsonl` per run that `conductor replay` reads, OpenTelemetry export, and tokens and estimated cost in the dashboard.
- Custom flows: Yes: YAML with agent, `human_gate`, `questions`, `script`, `wait` and sub-workflow steps, Jinja2 routes, parallel groups and `output:` schemas.
- Free commercial use: Yes (MIT); the providers have their own pricing.

### Inspirations
- `conductor validate` "Catches stale template references, missing inputs, and undeclared dependencies before runtime", a factory linter.
- `limits.budget_usd` with `budget_mode: audit | enforce`, a cost cap per run.
- On invalid JSON or schema shape, "a correction prompt is sent in the same session", a limited number of times, before the attempt fails.
- A subscription run's cost is labelled an "API-equivalent estimate"; gates "fire a terminal bell".

### Overlaps
- Deterministic routing on structured output declared with schemas, and script steps that "route on exit code or parsed JSON stdout", like signals.
- Human gates, `max_iterations` on loops, a JSONL event log per run, resume from checkpoints, and a live DAG view with gate alerts.

### Contradictions
- GitHub Copilot is the default provider; Codex CLI is not a provider.
- No visual build mode, and worktrees are made by a script step, not built in.
- One YAML file per workflow, not a folder per machine.

## Hive
"An open-source runtime for colonies of AI agents that do real business work": a persistent "queen" agent pilots one unit of work, saves the method as a skill, and fans the rest out to worker clones. Link: https://github.com/aden-hive/hive

- Maturity: 11.1k stars, since January 2026, v1.0.10 (October 2026).
- Versionability: Mostly no: colonies are "plain files under `~/.hive`" (workers, skills, Python playbooks, triggers, a SQLite tracker), outside the project repository.
- Similarity: Low: "There's no workflow graph to draw: the queen shapes the colony as the work unfolds."
- Tracing: Yes: each session keeps its conversation, events and plan, and "Every model call is metered", but "There are no spending limits in dollars yet."
- Custom flows: Indirectly: the queen writes skills and playbooks at run time; you do not write a pipeline first.
- Free commercial use: Yes (Apache-2.0).

### Inspirations
- "Execute first, then systematize": run one unit by hand, then turn the method that worked into a reusable step.
- Playbooks retry with backoff behind a circuit breaker, with a "dead-letter list" for rows that keep failing, and "Re-running a playbook resumes it".
- Any tool result "over 30,000 characters" is saved to a file, and the context keeps a preview and the path.
- Stall and loop detection from "tool-call fingerprints".

### Overlaps
- Local plain files, a confirmation before a chat becomes a colony, `ask_user` that parks the loop, and a budget and concurrency cap per worker.

### Contradictions
- "Orchestration is a tool call, not a compiled graph", and an optional "Sentinel" classifier decides to nudge, finish or escalate.
- The queen is long-lived with memory across sessions.
- Aimed at business work (growth, RevOps, leads) more than code.

## Scion
"An open foundation for agent collaboration": harnesses such as Claude Code and Codex run as containerized agents that delegate and message each other, locally or through a hosted hub. Link: https://github.com/GoogleCloudPlatform/scion

- Maturity: 2k stars, since March 2026, no GitHub release (tags such as `v0.3.0-preview.3`); "an actively developed, pre-1.0 project", "not an officially supported Google product".
- Versionability: Yes for roles: a template is "a small directory of files you can version, share, and reuse" (`scion-agent.yaml`, `agents.md`, `system-prompt.md`, `skills/`).
- Similarity: Low: roles as files and a worktree per agent match, but the collaboration is decided by the agents.
- Tracing: Yes: `scion logs`, session metrics, and logs and traces sent over OTLP from each container; no cost ledger found.
- Custom flows: Only through instructions: "you describe responsibilities and collaboration patterns in instructions".
- Free commercial use: Yes (Apache-2.0).

### Inspirations
- What the agent does (the template) is kept apart from where it runs: image and resources in a template are "ignored ... with a warning". The same line as between `role.md` and `machine.yaml`.
- Model size aliases (`small`, `medium`, `large`, `extra-large`) keep a role portable across providers.
- Limits per template: `max_turns`, `max_model_calls`, `max_duration`.
- Skills referenced by URI and fetched from a versioned skill bank.

### Overlaps
- A worktree or clone, configuration and credentials per agent, roles as files, and a local mode before any hub.

### Contradictions
- "Isolation Over Constraints": it "favors running agents in `--yolo` mode" inside containers.
- "The graph of an agent swarm ... is dynamic and not practical to determine in advance", and agents delegate to each other.
- Needs a container runtime and a hub.

## Maestri
"The infinite canvas for orchestrating AI agents": a native desktop app by Evercraft Labs where each terminal on the canvas runs Claude Code, Codex, OpenCode or a shell, with roles, notes, embedded browsers and devices ("portals") and connections that let agents prompt each other. Link: https://themaestri.app/en

- Maturity: A commercial app for macOS, Windows and Linux; changelog since March 2026, v0.54.2 (October 2026). Its Wire protocol for other devices is in beta.
- Versionability: Partly: configuration is plain JSON and notes are Markdown files; roles carry a `role.json` sidecar that can travel in the project's `.maestri` folder; saved layouts ("partituras") are JSON files in `~/.maestri/partituras/`, outside the repository.
- Similarity: Medium: a visual canvas of agents with roles, shared notes and a worktree per "floor", but the agents talk to each other and a lead agent can build the team.
- Tracing: Partly: chat threads keep their own record, agents post floor status, and usage rings show each CLI's plan limits; no run ledger or cost per run found.
- Custom flows: Partly: routines send scheduled prompts to one terminal, chained with `&&`; partituras save a team layout. No steps, routing or gates in files.
- Free commercial use: Partly: the free tier has all features with one workspace; Pro is $18 once and Teams is per seat. Proprietary; the terms grant a "personal, non-exclusive" license and do not say whether the free tier covers commercial use.

### Inspirations
- Floors clone the project copy-on-write (APFS, btrfs, XFS), so `node_modules` and `.env` come along and the floor starts ready to run, while build caches (`dist`, `.next`, `target`) are skipped. A fast setup for machine worktrees.
- Agents post their state with `maestri floor status "…" --state working|blocked|review --progress 2/5`, and a blocked or ready floor sends a notification. A model for the attention queue.
- Lock Contents makes a note read-only for agents: they still read it, but every write fails. A way to hand a machine a spec it cannot rewrite.
- A partitura is "blueprints, not backups": scrollback, runtime configs and absolute paths are stripped, and an import opens a review sheet that lists the commands it will run before anything starts. A model for sharing lines.
- Usage rings ask each CLI for its plan limits and never read tokens; each provider is a JSON file you can add.

### Overlaps
- A local desktop app that runs the user's own Claude Code, Codex and OpenCode CLIs, with roles injected through a `CLAUDE.md` or `AGENTS.md` per agent.
- A git worktree per floor, landed by a local merge or a pull request through the user's own `gh` or `glab`, with an option to open it as a draft.
- No telemetry and no account; the only server calls are license activation and update checks, which can be turned off.

### Contradictions
- Agents prompt each other directly through a skill on each connection, and a "Maestro" agent recruits, reassigns and dismisses teammates and can provision workspaces and floors. An agent decides the flow.
- Terminals are long-lived interactive sessions (also in tmux), not fresh headless steps, and there is no output schema per step.
- Routines send prompts on a timer with no gate, and an agent on a floor can run `gh pr create` by itself; Maestri then follows that pull request like one opened from the landing sheet.
- Maestri installs its skills and CLI into every agent's environment, and the app is closed source.

## Orchestrator.inc
"Plan, run, and supervise coding agents from one place": a local desktop workspace (macOS, Windows, Linux, with iPhone and Android apps) for Claude Code, Codex and more than 30 coding agents. Each worker is one task, one agent and one worktree; a persistent project orchestrator plans and delegates; a live Kanban follows every worker, pull request, CI run and review. Link: https://github.com/OrchestratorInc/agent-orchestrator

- Maturity: 13.5k stars, since February 2026, v0.14.5 (October 2026), with nightly builds.
- Versionability: No: sessions and their facts are in a local SQLite database behind a daemon; there are no flow files.
- Similarity: Medium: a local desktop app with a worktree per worker and a board of what needs you, but an agent plans and delegates.
- Tracing: Partly: each session keeps its conversation, terminal, changed files, pull request, CI and review state; no cost ledger found.
- Custom flows: No: the flow is fixed (task, worker, pull request, review, merge) and the orchestrator agent shapes the plan.
- Free commercial use: Yes (Apache-2.0).

### Inspirations
- Card positions are derived from facts ("session, pull request, CI, and review facts"), not set by hand. The storage keeps "minimal facts" and the service computes display status on demand, the right split for the floor.
- A "Needs you" column gathers "blocked sessions, missing input, failed CI, requested changes, or lost signals", a model for the attention queue.
- CI failures and review comments go back "to the agent that owns the work", a model for return belts from an outside check.
- A browser per worker: temporary profiles are isolated, and named profiles "deliberately reuse saved cookies and storage across sessions".

### Overlaps
- A local desktop app that runs the user's own Claude Code and Codex, with a branch and worktree per unit of work and a board of live state.
- A local daemon watches agent activity and source-control state, and the desktop app runs it for you.

### Contradictions
- "The orchestrator owns planning and delegation": it can "break it into focused tasks, spawn or redirect workers". An agent decides the flow.
- Workers "own implementation, tests, commits, and pull requests"; the README puts no human gate before an agent opens a pull request.
- Telemetry is on by default and goes to PostHog with an installation ID and the GitHub username (plus the AO Cloud email when signed in); it can be turned off in Settings.
- Workers are long interactive sessions (Chat or the agent's own terminal), not fresh headless steps with an output schema.

## OpenAgents
"The Collaborative OS for Agents": a persistent workspace, "like Slack, but for agents", where local and cloud agents share threads, files and a browser, reached by URL from a browser or phone. The `agn` launcher installs agent runtimes, connects them to a workspace and keeps them running as a daemon. It grew from a Python SDK for agent networks. Link: https://github.com/openagents-org/openagents

- Maturity: 4.2k stars, since March 2025, launcher-v1.1.5 (October 2026); Python package v0.8.5. Several adapters are Beta or Preview, with "real provider E2E pending".
- Versionability: No: agent configuration is in `~/.openagents`, and the workspace keeps threads and files in PostgreSQL.
- Similarity: Low: a shared chat room for agents, with no fixed flow.
- Tracing: Partly: workspace threads and a session per channel; no run ledger or cost per run found.
- Custom flows: Partly: the Network SDK lets developers "define custom collaboration patterns" in code; the workspace itself has none.
- Free commercial use: Yes (Apache-2.0).

### Inspirations
- Careful adapter rules per CLI: Aider runs with `--no-auto-commits --no-dirty-commits` and its cache goes into `.git/info/exclude`, so the user's repository gets no surprise commit and no changed `.gitignore`. Each adapter states its minimum CLI version and refuses older ones "before a task runs".
- "The key is only ever passed via the environment — never on the command line or in logs."
- Limits per run: `--max-turns`, `--max-tool-repetitions` and an inactivity watchdog (900 seconds by default) "so a hung run can't wedge the channel". Stop kills the whole process tree, with "no orphan processes".
- Each adapter documents what was verified and what was not ("Real E2E status: pending"), an honest model for agent adapters.

### Overlaps
- One adapter per agent CLI (Claude Code, Codex, Cursor, OpenCode, Gemini and others), run headless with `stream-json` where the CLI has it.
- Sessions and state are kept outside the project repository.

### Contradictions
- "Agents in the same workspace see each other's work and coordinate naturally", and they can "pick up work on their own". No lines, routing or gates.
- Headless Goose runs with `GOOSE_MODE=auto` ("tools execute without prompting") because it "cannot pause for human approval".
- The default workspace is hosted (`workspace.openagents.org`); self-hosting is possible, and the hosted server sends product analytics to PostHog keyed by account email.
- A session per channel resumes earlier context, not a fresh context per step.

## nodeterm
"A node-based terminal manager — your terminals and agents on an infinite canvas": tmux-backed terminals and agent sessions as draggable nodes, next to notes, editors and diff views, and each project doubles as a Trello-style board of live Claude Code sessions. Desktop for macOS, Linux and Windows (beta), a self-hosted browser Server Edition and an iOS companion. Link: https://github.com/eneskirca/nodeterm

- Maturity: 2.1k stars, since June 2026, v0.4.4 (October 2026); one indie maintainer.
- Versionability: Partly: canvas layouts are saved in `.nodeterm/` folders inside the repository; there are no flow definitions.
- Similarity: Low: a spatial canvas of interactive sessions steered by hand.
- Tracing: Partly: hook-driven agent status, live subagent transcripts and a context meter per node; no run ledger or cost found.
- Custom flows: No.
- Free commercial use: Partly: BUSL-1.1 allows production use, but not offering it as a hosted, embedded or standalone product that competes with nodeterm. Each release becomes MIT four years after it is published.

### Inspirations
- Agent status comes from the CLI's hooks, "no output scraping", and a permission prompt can be answered inside the node. A better source for machine state than parsing transcripts.
- Sessions survive app restarts in tmux, and the macOS app "ships its own tmux".
- An uninstall script with `--dry-run` that "reverts the status-hook/skill entries it merged into your agent CLIs' config", with a documented list of everything it writes.
- Dictation types the text into the prompt and "you press Enter (nothing auto-submits)".
- One core behind a platform seam, with Electron as only one shell; the same renderer runs in a browser. Close to Promptory's `src/core` rule.

### Overlaps
- An Electron app with core logic kept free of Electron, a canvas of agents and a kanban view of the same sessions.
- A worktree per group of agents, and Claude Code and Codex run locally with the user's own CLIs.

### Contradictions
- Agents "can drive the canvas (open nodes, spawn teams, verify each other's work)" and read each other's transcripts through context links.
- Interactive tmux sessions that resume (`claude --resume`), not fresh headless steps, and no output schema per step.
- Anonymous telemetry (version and OS, at launch and once a day) is on by default; it can be turned off in Settings or with `DO_NOT_TRACK`.
- It merges hooks and skills into the agent CLIs' own configuration, and the license is not open source.
