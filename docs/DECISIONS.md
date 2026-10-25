# Roboratory — Decision log

Each decision states what was chosen, the alternatives considered and why. Decisions are grouped by topic, and related ones point to each other.

# Foundations

## D1. Build a new product instead of adopting one
**Decision:** build Roboratory.

**Requirements that drove it:**
- Strong visibility of agent work while it runs and afterwards.
- Roles and workflows versioned in git.
- Usable for broad work processes, not only coding.

**Why not adopt something:**
- **[Kestra](https://github.com/kestra-io/kestra):** git-native YAML and a strong execution UI. But governance features (RBAC, secret backends) are Enterprise-only, and it has no concept of a role.
- **[Archon](https://github.com/coleam00/Archon):** YAML workflows and run transcripts. But about 80% of its commits come from one person, it ships breaking changes often, and it is centered on coding.
- **Other tools reviewed** (Paperclip, CLI Agent Orchestrator, Omnigent, SuperPlane, Gas Town and others): the ones with rich visibility keep their definitions in a database, and the git-native ones have weak visibility.

**Cost:** the project has no community behind it. It is maintained by its author.

## D2. One product with one purpose
**Decision:** the deterministic factory floor is the whole product. There is no free canvas, no sticky notes and no manager agent that rewires the team at runtime.

**Alternatives:** two modes in one app, one free and one deterministic.

**Why:**
- A manager that lets a model rewire the team at runtime is the kind of unpredictability the product exists to remove.
- Two modes would double what one maintainer has to keep working.

## D3. What Roboratory deliberately does not do
**Decision:** each of these is a choice, not a gap:

| Common approach | In Roboratory |
|---|---|
| A step ends when the terminal goes quiet; output is captured from the screen | A step ends when the process exits; output is the agent's JSON (D8) |
| Agent-agnostic code | Per-agent headless templates and output parsing (D8) |
| A free canvas of terminals | A floor generated from line models (D7) |
| A manager agent that recruits and rewires | Managers only propose, within versioned policy (D29, D31) |

Kept as principles: everything runs locally, there is no telemetry, and files use open formats.

## D4. The factory repository is the only source of truth
**Decision:** every sector, line model, machine, role, contract, signal and policy is a file in the factory's git repository. The app keeps no definition library of its own.

**Alternatives:** a global library with per-repo overrides; an app library with export/import.

**Why:** changes become reviewable diffs, history is free, and nothing about how the factory behaves lives only in one person's app data.

## D5. Roboratory never writes to the factory repository's git
**Decision:**
- Accepting a proposal or confirming build mode only writes files. Roboratory never commits, pushes or branches, and records no origin for changes.
- Lines run from the files on disk.
- Each run records the commit it started from and any uncommitted diff in effect.

**Alternatives:** an automatic commit per accepted change; running only from the last commit; full git controls in the app.

**Why:**
- You keep using git your own way, and there is less to build.
- Recording the commit and diff per run still answers "which version of this line ran?" without forcing a commit before every test.

## D6. Stack: Electron, TypeScript, PixiJS, React
**Decision:**
- Electron and TypeScript for the app.
- PixiJS for the Floor and Andon, React for the panels.
- Ajv for contracts and JSONL for runtime state.

**Alternatives:** a local daemon with a browser UI; a game engine such as Godot.

**Why:** Electron gives local files, child processes and native notifications on every OS from one codebase, and a main-process broker keeps capability apart from presentation. PixiJS handles sprite-heavy 2D with a camera, without a game engine's friction for process, file and diff work.

## D7. The workflow is the center; the floor is drawn from it
**Decision:** lines lay themselves out from their model, growing left or right; nothing is dragged. The floor is pixel art from a three-quarter top-down camera. Contracts, signals, gates and deterministic lines are the core.

**Alternatives:**
- Terminals at the center, with workflows as an overlay.
- A separate production view next to a free canvas.

**Why:** a layout generated from files can be versioned and reused across projects. A hand-placed canvas ties every workflow to one arrangement.

# Lines and machines

## D8. Machines run agents headless; a step ends when the process exits
**Decision:** each machine starts its agent CLI in non-interactive mode. Process exit ends the step, and the JSON output is validated against the contract.

**Alternatives:**
- Detecting the end of a turn from terminal silence.
- Agent lifecycle hooks with silence as a fallback.

**Why:** silence detection is a guess. It can capture a partial answer and re-prompt an agent that is still working, and in a chain of steps each wrong guess spreads. Process exit is exact.

**Checked against the agent CLIs' documentation and local help:**
- Claude Code (`-p`, `--json-schema`) enforces the schema natively.
- Gemini CLI and OpenCode have headless JSON modes.

**Vendor-specific on purpose:** per-agent templates and output parsing are allowed.

## D9. Clean context per machine; boxes and machine folders carry the work
**Decision:**
- Each machine starts a fresh agent context.
- It receives the incoming box, works in its own folder, and can read the folders of the other machines in the same line run. Read access is not restricted beyond that instruction.
- One folder per machine exists so that machines can get separate git identities. Identities themselves are planned, not built.


**Alternatives:** resuming the previous agent's session; choosing per belt.

**Why:**
- A step can be re-run on its own with the same box.
- Errors in one agent's reasoning don't carry into the next.
- Per-machine folders make authorship traceable.

## D10. Target repositories: one worktree per machine, chained
**Decision:**
- Each machine gets a worktree of the target repository, on a branch created from the previous machine's branch.
- The broker commits anything the agent left uncommitted when it finishes.
- Joins merge branches, and a conflict sets the next machine on fire.
- D5 applies to the factory repository only.

**Alternatives:** one shared worktree per run; choosing per line.

**Why:**
- Each machine's contribution is traceable in history.
- It prepares per-machine git identities without rework.

## D11. Line models and production lines
**Decision:** a model defines a line, and a sector holds any number of lines made from models, each with its own parameters. Models are YAML files. After the MVP, build mode on the Floor edits them with clicks (D40).

**Why:** the same process often runs for many targets, for example one incident line per service. Copying definitions would let them drift apart.

## D12. Splitters are belts
**Decision:** a split is a property of the belt (`needs: [{ from, when }]`), not a separate piece.

**Why:** a split only decides where a box travels. It does no work and holds nothing, so it belongs to the belt.

## D13. Boxes travel; the pallet holds the deliverable
**Decision:**
- A **box** is a machine's contract-valid output: progress, or a piece of the deliverable, moving along the belts.
- The **pallet** sits at the end of a line, and what is stacked on it is the deliverable.

**Why:** finished work and work in progress need different shapes on the floor.

## D14. The intake kind decides the line's first item
**Decision:** each intake kind (manual, timer, webhook and more) has its own sprite and start condition, and puts its own kind of first item on the belt.

**Why:** you can tell at a glance how work enters each line.

## D15. Return belts for bounded rework
**Decision:**
- A belt can be declared as a return belt: `needs: [{ from: verify, when: "verdict == 'fail'", back: true, laps: 3 }]`.
- The machine at the end of a return belt runs again in the same folder and branch, with the checker's box under `feedback`. Everything between it and the checker runs again after it.
- When the laps run out, the piece catches fire and the decision is yours; a retry grants its return belts a fresh set of laps.
- Inputs that reach the reopened stretch from outside it are kept, and two checkers sending the same piece back together rework it once, with both findings.
- Layout ignores return belts when it places columns; they are drawn under the line, running the other way.

**Alternatives:** no loops (a failed check is a fire to retry by hand); free loops capped by one limit per run.

**Why:** rework is part of real workflows (QA sends a fix back, a validator sends a plan back). A rule on the box decides each loop and a per-belt limit says where a line is spinning. **Related:** D7.

## D16. Human gates confirm, they don't collect approvers
**Decision:** a human gate is a release button that can ask "are you sure?" several times (`confirmations: 2`). There are no named approvers and no checklists.

**Why:** Roboratory has one user. The friction is the point, and a second person's key has no way to arrive in a local app.

## D17. Decision gates route on your choice
**Decision:**
- A human gate can offer choices (`gate: { choices: [hotfix, rollback, investigate, monitor] }`).
- You pick one and may write a note. The box leaves the gate carrying `decision: { choice, note }`.
- Outgoing belts route on it with the usual rule, for example `when: "decision.choice == 'hotfix'"`.
- The next machine receives your note in the box and does exactly what was approved. Confirmations still apply to the button you press.
- Only the latest gate's decision travels in the box; machines that need an earlier one read it from the evidence of the machine that received it.

**Alternatives:** a separate "decision" piece; chains of plain gates.

**Why:** a decision is a gate that asks which way to go. Routing stays on belts (D12), so no second routing mechanism exists.

## D18. Delivery: the agent publishes, the contract records it, a signal verifies it
**Decision:**
- The last machine's agent does the git work and publishes the deliverable (for example opens the PR), as its role instructs.
- Its contract requires a note of it (for example `pr_url`, branch, title).
- A signal before the pallet checks that it really exists.
- The pallet is passive.

**Alternatives:** a deterministic delivery script on the pallet; trusting the note alone.

**Why:**
- Agents do the git work anyway.
- The signal turns a claim into a verified fact, so an invented link can't look delivered.

## D19. A signal can have its own time limit
**Decision:** a signal in `line.yaml` takes an optional `timeout` (for example `signal: { run: signals/plan-checks.sh, timeout: 40m }`), in the same format as a machine's. Without it, the limit is 10 minutes. When the limit is reached, the signal is stopped and its error says that it timed out, so a slow check is not mistaken for a failed one.

**Alternatives:** a time limit inside each script, below the 10 minutes (a slow CI sends good work back for rework); one higher limit for every signal (a stuck signal on any line holds its run for that long).

**Why:** a signal that waits for CI on a pull request needs more than 10 minutes, and only the line knows how long its checks take.

## D20. A failing signal can send the box back
**Decision:** when a signal fails and it has a return belt whose rule holds, the box goes back along that belt instead of the signal catching fire. The box that goes back has `signal: 'fail'` and `signal_output`, the last lines the signal printed, so the machine at the end of the belt sees why. A failing signal with no such belt catches fire as before, and so does a signal stopped at its time limit (D19). When the belt's laps run out, the machine at its end catches fire (D15). Rules on belts from a signal can read `signal` and `signal_output`.

**Alternatives:** checks as machines that give a verdict (an agent paid to run scripts, and the check is no longer deterministic); a fire on every failure, with a manual retry of the machine before it.

**Why:** a deterministic check that fails is the most common reason for rework, and the fix belongs to the machine before it, as when a checker machine sends work back.

**Related:** D15.

## D21. Agents can ask you mid-step
**Decision:** besides its contract, every machine may answer `{ "needs_human": { "question", "options", "recommendation" } }`. The machine shows the exclamation balloon and joins the attention queue. Your answer runs the same machine again in the same folder, with the answer in the box, without spending an attempt.

**Alternatives:** no questions mid-step; questions relayed through the Sector Manager.

**Why:** a decision that is missing from the ticket or the plan belongs to you. The agent should neither guess nor stop the line.

## D22. A machine can say it is blocked
**Decision:** besides its contract and a question (D21), a machine can answer `{"blocked": {"reason": "..."}}` when something outside the work stops it, for example a broken shared environment. It catches fire at once with that reason, without spending its attempts. You fix the cause and retry it, with a hint if you want.

**Alternatives:** a `blocked` verdict in the contract (no belt takes it, so the run stops instead of waiting for you); failing on purpose until the attempts run out (costs attempts and shows "contract invalid").

**Why:** a failure of the environment is not a failure of the work. It must not go back for rework, and it needs you, which is what fire means on the floor.

**Related:** D21.

## D23. A shared culture for every agent
**Decision:** `culture.md` at the factory root is appended to the role of every machine and manager. A sector can add `sectors/<sector>/culture.md`, appended after it. The panel lists the culture files an agent receives.

**Alternatives:** listing culture files in each `machine.yaml`; keeping culture in each target repository's `CLAUDE.md`.

**Why:** the rules every seat follows (gates, evidence, writing, code) live in one place and cannot be forgotten by a new machine. Lines without a repository and managers get them too.

## D24. A shared library at factory level, including line models
**Decision:** `shared/` holds roles, contracts, signals and line models that any sector can reference. Changing a shared item warns how many lines and sectors it affects. The General Manager curates it, by instruction.

**Alternatives:** no sharing; sharing roles and contracts only.

**Why:** copies drift. The same model-and-copies logic as D11 applies one level up.

## D25. Machines know their place in the line, and pieces have goals
**Decision:**
- A machine's prompt says where it stands: the line in order with the machine marked, its own goal, where its box comes from and where it goes (belt rules in plain words), and every piece after it with that piece's goal, with the instruction to do only its own step.
- Machines, signals and gates have a **goal**: what the piece is for, in at most 250 characters. A machine's `machine.yaml` holds its default goal; a piece's `goal` in `line.yaml` replaces it in that line. Goals are shown to you in the piece's panel.
- Line context is on by default; `line_context: false` in `factory.yaml` turns it off for every machine. There is no per-machine switch.

**Alternatives:** writing the context into each role by hand (it drifts as the line changes); repeating only the pieces' names, which are not always self-explanatory; a per-machine switch (more settings for little gain).

**Why:** in a real data investigation, the framing step did the code probe's work, at a cost, because nothing told it a code probe came next. The context comes from the line's own files, so it stays true as lines change. Goals make it say what each piece is for, and they help you read the line too. Goals are sent to the model while line context is on, so build mode says so where you write them.

**Related:** D9. The context is the line's shape and purpose, not other machines' work: each machine still starts clean.

## D26. Machines see what you did in the run
**Decision:** with line context on (D25), a machine's prompt lists the human actions of its run, in order: each gate decision with its note, each retry with its hint, and each answer to a machine's question, with the piece it was on and which pass of that piece it was. Every machine of the run gets the list, also the machines before the action in the line.

**Alternatives:** only the machines after the action (a machine reworked after a gate would not see the note that sent it back); only retry hints (gate notes stay with one machine).

**Why:** a hint given at a retry reached only that machine. The checker after it still saw the old disagreement and sent the work back again for the same reason. What you decided is part of the run's facts, and every machine must work from it.

**Related:** D25.

## D27. Machines are told what their shell allows
**Decision:** the Claude adapter appends the machine's shell rules to its prompt, built from its allowed tools: the command prefixes it may run, that every part of a compound command must be allowed, and that a denied command does not mean the others are denied. A machine with an open shell (`Bash`) gets no rules; managers have no shell and get none. Where a command outside the list is asked of a person instead of denied (D44), the rules say so.

**Alternatives:** writing the rules into each role (they drift from `allow`); leaving the agent to find out by trial (a real ticket run lost four steps to it).

**Why:** in that real run, four machines sent a compound command such as `R=...; ls`, got it denied, concluded the whole shell was off, and either skipped their checks or answered `blocked`. The rules come from the same list that permits the commands, so they stay true.

## D28. A simulated agent for the demo and the tests
**Decision:** besides `claude`, a machine or manager can use `agent: sim`. It is configured in `machine.yaml` (how long it works, what it says, which files it writes, what it answers) and runs inside the app.

**Why:** the demo factory has to work offline and cost nothing, and the tests have to exercise the whole runtime (worktrees, contracts, fires, gates, managers) without calling a model. Running real agents always spends money, so it stays an explicit choice in each `machine.yaml`.

# Managers and policy

## D29. Managers talk; humans and policy decide
**Decision:**
- Every natural-language question goes to a manager.
- Managers answer under a contract with `answer`, `evidence` and `proposals`, and proposals become buttons.
- A Sector Manager is instructed to propose diffs only inside its own sector folder. Review by a person is the guard; the broker does not enforce folder scope.
- A General Manager handles factory-wide questions and proposes whole sectors.

**Why:**
- Free-form answers are fine for conversation. Anything that changes the factory has to be a valid verb or a diff that a person accepts.
- Splitting the managers by scope keeps each one's context and permissions small.

## D30. Actions are verbs behind the UI, not commands in the chat
**Decision:** there are no slash commands in the megaphone. Buttons, manager proposals and, after the MVP, a command-line interface all call one verb API, and every call is audited.

**Alternative:** typed verbs in the chat bar.

**Why:** the UI already offers every action as a button, so typed verbs would only duplicate it. One API keeps the audit log complete whoever acted.

## D31. Manager autonomy is a versioned policy per verb
**Decision:** each sector's policy lists which verbs its manager may run on its own and how often. A factory-level ceiling caps every sector, and the stricter rule wins.

**Alternatives:** managers never act alone; autonomy per sector as on/off.

**Why:** autonomy can be granted where it has been earned, such as one automatic retry with a hint. It stays reviewable in git, and it never extends to releasing gates or applying changes (D34).

## D32. Scope: machines by instruction, managers read-only by the CLI
**Decision:**
- **Machines:** read access is not restricted beyond their instructions.
- **Managers:** they run read-only through the agent CLI and deliver changes as patches that Roboratory writes only when you accept them (D33).
- **Sector Manager scope:** staying inside its sector is an instruction, and your review is the guard.

**Why:** restricting machines needs containers or an OS sandbox, which costs more than it buys today. Making managers read-only costs nothing, because the CLIs already support it, and it guarantees that nothing changes without you.

**Related:** D29, D9 and D44 (what the engine decides about the commands of a machine).

## D33. Manager tools: factory data plus MCP tools listed by name
**Decision:**
- Managers see the factory's state, runs, transcripts and files, plus MCP tools listed by tool name: in `sector.yaml` for a Sector Manager, in `factory.yaml` for the General Manager.
- MCP servers are configured in the agent CLI, never by Roboratory, and machines' `tools:` work the same way.
- On start, Roboratory checks that listed tools exist and warns about missing ones.
- Managers run read-only through the CLI (`--tools` on Claude Code). They return changes as patches inside their contract answer, and Roboratory writes them only when you accept.

**Why:** managers can diagnose alongside you without any path to act outside verbs and review.

## D34. Policy defaults
**Decision:**
- A new sector allows no automatic verb.
- The factory ceiling allows `retry`, `run` and `halt` to be granted per sector, with limits.
- `release` and applying changes can never be automatic. The ceiling and the managers' read-only mode (D33) both guarantee this.

**Why:** autonomy is earned case by case. The two actions with the most power to do harm stay with you.

## D35. The megaphone
**Decision:**
- A chat bar fixed at the bottom. On the Floor it addresses that sector's manager and on the Andon the General Manager; you can switch.
- Clicking a manager character focuses the bar.
- Answers open in a panel with evidence and proposal buttons. Proposals that change files also appear as ghosts.
- Each sector keeps its own conversation history.

**Alternatives:** speech balloons on the character only; a permanent side chat.

**Why:** the character gives the manager presence, and the bar fits answers with evidence and buttons.

# Views and visibility

## D36. Sectors group lines; the Floor shows one sector at a time
**Decision:**
- A sector is a group of production lines with its own manager, policy and minimap color.
- The Floor shows one sector at a time; the Andon shows them all (D40).
- The minimap shows all sectors, and a sector that needs attention changes color and plays a sound.

**Why:** working in one room keeps a large factory readable, and the minimap means attention is never lost to whatever is off-screen.

## D37. Loading bars on signals and loading, never on machines or gates
**Decision:** loading bars appear on signal checks and on loading screens. Machines show animated workers instead. A holding gate shows its balloon and closed bars, not a loading bar.

**Why:** an agent's run time can't be predicted, so a percentage on a machine would mislead.. A holding gate is waiting for you, not working: a bar that fills suggests it will open by itself.

## D38. Attention and visibility
**Decision:**
- **Attention:** a floating exclamation balloon marks anything waiting on you, and a burning machine marks a fire.
- **Sector Manager:** one character per sector, standing by the back wall in the room's left corner, apart from the lines; its spot follows the room as lines are added or change. It has hands on hips while watching and a thinking pose while answering.
- **Live log:** three levels.
  - Factory: line starts and finishes, prefixed with the sector.
  - Sector: every event in the sector.
  - Machine: one agent's detailed transcript.
- **Floor:** the same tiles everywhere, walls on the sides and back, and a room that grows with its lines.
- **Tutorial (planned):** a step-by-step first-factory tutorial covers Sector, Sector Manager, Production line, Machine, Belt, Signal, Gate, Box and Pallet.

**Why:** these keep the factory readable at every scale.

## D39. Situations are entity panels, reached through one attention queue
**Decision:**
- There are no special modes. A fire opens the fire panel, a waiting gate opens the gate panel, and a manual intake opens a work-order form.
- A production deploy is a gate that asks "are you sure?" twice, with signals in front of it (D16).
- One factory-wide attention queue, ordered by severity, takes you to each item.
- While the fire panel is open, the sector's other lines dim and the stalled boxes are highlighted.

**Alternatives:** fixed modes such as "Firefight" and "Ship to prod"; modes declared per sector in YAML.

**Why:** fixed modes only fit the example lines they came from. Entity panels work in any factory and need no configuration. The queue answers "what should I do now" without moving the camera on its own.

## D40. Views: Floor, Andon, Ledger, Blueprint, with building on the Floor
**Decision:**
- **Floor:** one sector's room, where you work.
- **Andon:** the whole building, every sector as a room at a lower level of detail. Floor and Andon are one world, joined by a camera transition.
- **Ledger:** the history of every run, with steps, boxes, attempts, transcripts, gate releases and the factory version used. Replay on the Floor is planned.
- **Build mode on the Floor:** the line modeler, with "+" slots, automatic re-layout and a warning when a change affects several lines.
- **Proposals:** a manager's proposal appears as ghost pieces on the Floor, or a ghost room in the Andon, with the diff one click away.
- **Blueprint:** files, pending diff and history.

**Alternatives:** a separate graph editor; reviewing proposals as file diffs only; an Andon board that duplicates the minimap.

**Why:** every view is the same factory at a different scale or moment, which keeps the factory-game feel and avoids parallel representations.

# Building and running

## D41. Build mode is where the factory is made
**Decision:** build mode on the Floor is where sectors, lines and models are created from scratch and everything a line is made of is edited. The behavior is in PRODUCT §3.8. The choices behind it:
- **A line's edits change its model, with the reach shown first.** "Separate into its own model" lets one line differ. Per-line overrides would add a second layer of definition that the Floor and the diff cannot show (refines D11).
- **A draft per sector, saved at once after the diff.** One edit often touches several files (a new machine is a `line.yaml` change plus a folder of three files), and a half-written line would break the factory, which reloads on every file change (refines D5).
- **Saving waits while an affected line has a run in progress.** A run that started on one definition and continued on another would mix two versions. Freezing definitions per run and showing two versions on the Floor was considered and left out. Accepting a manager's change follows the same rule.
- **Insert with "+" slots, connect by clicking the destination.** Lines lay themselves out (D7), so the only question an insert answers is between which pieces it goes. Whether a connection is a return belt follows from where its destination is.
- **A removal leaves broken connections in red** for you to reconnect, instead of reconnecting by guess.
- **Rules come from a builder that reads the previous piece's contract**, with a text fallback. Rules reading fields the previous box did not have were the most common defect when the reference engineering factory was designed (D42).
- **Machines, contracts and tools are forms.** The contract feeds the rule builder, and tool names come from the configured MCP servers, so wrong names cannot be typed.
- **Saving needs static checks, not a simulated run.** The factory loads clean, every piece is reachable and reaches the pallet, no connection is broken, rules read real fields, and every routed value has a way out.
- **Policy and the ceiling are editable**, validated against the ceiling. `release` and applying changes stay impossible to make automatic (D34).
- **YAML is edited in place**, keeping comments and style, so the diff shows only what changed. Summary comments are not rewritten; the diff warns when one may be stale.
- **External changes during a session are detected**, file by file, instead of being overwritten or discarding the draft.
- **A new sector is saved when you create it.** Sessions are per sector, so an unsaved sector could not be opened; an empty sector touches nothing else.

**Out of scope:** proposals as ghosts, the Andon and the Blueprint. Changes made outside build mode (by hand or by `git checkout`) can still reach a line with a run in progress.

**Related:** D11, D40, D5.

## D42. Factories follow the process a team really uses
**Decision:** a factory is designed from how the work is actually done, from its documented process and from real examples (tickets, pull requests, reviews, incidents, postmortems), not ported from another tool's workflow definitions. A reference engineering factory covers three sectors:
- **Delivery:** ticket lines that implement, test and open draft pull requests, and review lines.
- **Fire:** incident response and postmortem lines.
- **Research:** data investigation and docs drift lines.

Machines use real agents, so every run costs money and you start each one.

**Why:** a line that does not match the real process is not used. Copies of one model let several runs go at once.

**Design points that came from real examples:**
- **Ticket line:** pushing and opening draft PRs wait for a gate. One ticket may open several PRs. The line watches CI and can test in a shared environment, and it ends at "ready for review".
- **PR review line:** it judges an existing AI reviewer's findings instead of repeating them, and turns unconfirmed findings into questions. It posts one review in the state you choose and verifies it on GitHub.
- **Incident line:** it has a decline path for false alarms. Mitigation is a rollback or config PR, a manual act or a hotfix handoff, not an in-line code fix. Recovery is verified on telemetry.
- **Postmortem line:** it fills the incident tool's template.
- **Research lines:** a quick framing step plans the probes, which then run straight away; you decide once you see the answer. An independent step re-runs every query. Docs drift checks one document at a time.

A rework drops the arrivals and skips that the last lap left downstream (D15).

## D43. The engine runs without the app
**Decision:**
- The engine runs in its own process, one per factory, started on demand by the app or the `roboratory` command. It keeps running when the app quits, and ends with `roboratory stop` or when no run is open and no client is connected. A lock file in the factory allows one engine per factory.
- Clients talk to it over a local socket open to the user only, with one JSON message per line: the methods of `src/shared/api.ts`, and state updates pushed back. On macOS and Linux it is a Unix socket at `.runs/engine.sock` (a hashed path in the temporary folder when that one is too long); on Windows, where Node does not give a file path to a socket, it is a named pipe, which Node creates for the creating user only. The lock file records which one. No network port is opened. A socket's permissions cannot be relied on everywhere, so the lock file (mode 0600, in your factory) also holds a random token, and the engine serves only connections that open with it. The Electron main process relays between the interface and the socket.
- Everything in `FactoryService` moves into the engine: runs, build-mode sessions and their locks, managers and proposals, and reloading the factory. The app keeps only the interface.
- The `roboratory` command offers `serve`, `stop`, `status`, `run`, `release`, `answer`, `retry`, `halt`, `resume` and `watch`. Every action is a verb, audited as `you` with the source `cli`. Build mode stays in the app.
- The packaged app's binary runs the engine in Node mode (`ELECTRON_RUN_AS_NODE`), so the app and the command share one engine bundle and need no other runtime. The command is installed in `~/.local/bin` only when you ask, from the app's menu.
- When the app or the command finds an engine of an older version, or another build of the same version (a hash of its bundle), it offers to restart it when idle: the engine stops dispatching new work and restarts once no machine or signal is running.
- Tests drive a real engine through the same client as the command.

**Alternatives:** an always-on system service for every factory (installs something into the system and mixes factories); a process per run (lines share state such as halts, queues and managers); HTTP on loopback (an open port any local process can reach, which needs a token); the app starting the engine as its child over stdin and stdout (the engine dies with the app); a separate npm package on the system Node (the app and the command can drift apart).

**Why:** runs stop every time the app is rebuilt or quit. Permission requests at run time and the manager's investigations (see [ROADMAP.md](ROADMAP.md)) need a process that waits for you, so the engine must move before they are built, not after. Tests that drive the real engine through one client are simpler to write and keep than tests that reach inside the app.

**Related:** D30 (the verbs get a command-line interface), D41 (build-mode locks cover the command too).

# Permissions and the core formats

## D44. Permissions: requests at run time, hard denials, read-only machines
**Decision:**
- **Requests.** A machine's `allow` lists the commands it may run. A shell command or MCP tool outside the list, and not hard-denied, is a permission request: the machine waits, and the engine raises a `permission` item in the attention queue with the machine, the line, the tool and the exact command. It shows the exclamation balloon and sits in the queue at the priority of a fire, but the machine is not on fire: it is waiting, not broken, and the line does not stop. You answer with one of two verbs: `allow`, for this call only, or `deny` with a reason, which goes back to the agent as the tool's refusal. Nothing is allowed for good, and not for the rest of the run either.
- **The wait.** It has no limit and no automatic denial, and it does not count against the machine's `timeout`: the clock runs only while the agent works. A request lives as long as the machine's process; if the engine is killed the step reruns and asks again.
- **Hard denials.** `deny:` in `factory.yaml` lists commands that are never allowed. A sector (`sector.yaml`), a line (`line.yaml`) and a machine (`machine.yaml`) may add entries and never remove one, so each level can only tighten the one above. The app and the engine carry no list of their own: the factory template and the reference factory start with one (for example `git push --force`, `rm -rf`, `sudo`, `gh pr merge`), and a factory edits it. A hard denial is never asked about; the agent is told it is forbidden by the factory. The engine enforces it (see **Who decides a command**).
- **Syntax.** `allow` and `deny` hold command prefixes, as written: `npm test`, `git push --force`. A tool name stands for the tool (`Edit`, `mcp__server__tool`).
- **Who decides a command.** The engine, not the agent's CLI, decides every shell command, because the CLI's own rules can be walked around (`git -C . push` passes a rule on `git push`). The adapter passes the agent no allow or deny rules for the shell and sends every command it does not run by itself to the engine through the permission tool. The engine takes the whole command, splits it at `;`, `&&`, `||`, `|` and line breaks, and for each part drops git's global options (`-C <path>`, `--git-dir`, `--work-tree`, `--no-pager`) before reading the subcommand; `-c <key>=<value>` can set an alias or a pager, so a command with it is a request. A part that matches a hard denial denies the command. The command is allowed without asking when every part starts with an entry of `allow`. Anything else is a request to you. A command the engine cannot account for (a substitution `$(…)` or backticks, a subshell, a redirect to a file) is never allowed by itself: it is a request, with the command in front of you. A wrapper such as `sh -c`, `env` or `xargs` is not looked into: it matches only if it is itself listed, and otherwise it is a request. Commands the CLI treats as read-only (`ls`, `cat`, `git status`) it allows by itself and never asks about, so a hard denial cannot take away reading. Where there is no permission tool (an engine run in process by a test), the CLI is given the lists as its own rules instead and refuses what is not listed.
- **Read-only machines.** `read_only: true` in `machine.yaml` (off by default) gives a machine no file-editing tools and denies `git push`. The commands in its `allow` still run, so it can run tests and read from a remote. It is not a sandbox: a listed command can still write files (D32).
- **Defaults.** Every machine starts with the file tools and the local git subcommands, and its `allow` adds to them. The local subcommands are the ones that do not send anything to a remote (`status`, `diff`, `log`, `add`, `commit`, `switch`, `checkout`, `merge`, `rebase`, `stash`, `worktree`, `fetch`, `pull` and the like). `git push` is a request. A machine that should always push lists `git push` in its `allow`.
- **Who is not asked.** Managers get no requests: a command outside their list fails, as they run read-only (D29, D33). Signals are scripts of the factory, not agents, and are not asked either.
- **The verbs.** `allow` and `deny` are audited like every verb (D30), as `you` from the app or the command (`roboratory allow`, `roboratory deny`). Like `release`, they are never automatic: no policy grants them and a manager cannot propose them (D34).
- **Trace.** `run.jsonl` records each request and its decision, and the Ledger shows them with the wait.
- **What the agent is told.** The prompt (D27) says which commands it may run, that anything else is asked of a person and can be denied with a reason, and that a denial is not repeated: it picks another way or answers `blocked` (D22).
- **The Claude adapter.** It asks through `--permission-prompt-tool`, which Claude Code calls only when its rules do not decide. The tool is a small process of the `roboratory` command that Claude starts and that passes the request to the engine over its socket and token, and the answer back. It serves that one tool and runs nothing; the engine hosts no MCP server and does not stand between the agent and its tools. The adapter runs Claude Code in its default permission mode instead of `dontAsk`, gives it the file and MCP tools by name, and `--disallowedTools Agent` as before.

**Checked with a real agent** (Claude Code 2.1.226 on Haiku, `e2e/tools/permission-check.mjs`, US$ 0.02 in all):
- The tool is called only for what the allow and deny rules leave undecided, with `{tool_name, input: {command, description}, tool_use_id}`. It answers `{"behavior":"allow","updatedInput":<the input>}` or `{"behavior":"deny","message":…}`, and the agent repeats the message word for word.
- It works with `--output-format stream-json` and `--json-schema`. The tool's process starts with the run and connects within seconds, and a request that waited 190 s before an answer ran normally.
- In this mode Claude Code allows read-only commands (`date`, `ls`, `cat`, `git status`) by itself, which `dontAsk` did not, and asks for the rest. A `--disallowedTools` rule holds and the tool is not called.
- Through Roboratory itself (`e2e/tools/real-permissions-check.mjs`, one machine on Haiku, US$ 0.01 in all): a command outside the list waited for an answer and ran after `allow`; a command refused with a reason was not run and the agent repeated the reason; a command on the factory's list was refused with no request. A model may decline a destructive command on its own before it reaches the tool, so a check of the factory's list uses a harmless one.
- A deny rule such as `Bash(git push:*)` does **not** catch `git -C . push`, wildcards included: with `Bash(git:*)` allowed, that push went through. An allow list that names the local subcommands, in the plain and the `git * <subcommand>` forms, asks for the `git -C . push`.

**Alternatives:**
- A shell run by the engine and offered to the agent as an MCP tool, with the native shell off. Models use their own shell better, and the engine would then run the commands, which asks for the sandbox of D32. (What was chosen decides a command in the engine but leaves running it to the agent.)
- Leaving the rules to the CLI: deny and allow rules passed as flags. The check found they miss the `git -C` form, so a hard denial would hold only for the plain command.
- Answering over the agent's standard input with the control protocol of its SDK. Its messages are not documented for the CLI, so it would break with an update.
- A hook on every tool call. It costs a process per call and repeats the rules outside the engine.
- Allowing a command for the rest of the run. It is left for v0.10, which measures how often the same command is allowed again within a run.
- Denying by time. A person may take longer than any limit, and a denial by timeout reads to the agent as a refusal of the command.
- A build-mode warning when a role names a command its `allow` list does not permit. It would be a guess over prose that is wrong in both directions; the request at run time shows the same defect with the real command.

**Why:** the first real ticket run found tool permissions held by instruction only: four of six machines took a denied command for a denied shell, and any machine could run `git push`. A command that fails stops the work; one that waits for you lets you decide with the exact command in front of you, and the agent hears why. Hard denials stay in the factory's files so they can be read, reviewed and changed like every other rule.

**Not guaranteed:** the engine reads commands, not what they do. A command the agent builds inside a listed program (a script that pushes) is out of its reach, and so is a command the CLI allows by itself; only a container or sandbox (D32) closes those.

**Related:** D27 (the prompt's shell rules), D29 and D33 (managers), D30, D31 and D34 (verbs and policy), D32 (what stays open without a sandbox), D43 (the engine is the process that waits), D45.

## D45. Agents sit behind a port
**Decision:**
- The engine and the managers call one port, `AgentRunner`: a request (role, prompt, contract, folders, permissions, timeout) in, a result (output, transcript events, cost) out. Each agent is an adapter behind it, and `agent:` in `machine.yaml` names the adapter. The adapters are Claude Code (D8) and the simulated agent (D28). A name that is not an adapter is a problem found when the factory loads.
- Everything specific to an agent CLI stays inside its adapter: the command line, how it enforces the contract, the stream it writes, its cost, how its MCP tools are named, its read-only mode and how it asks for a permission (D44). The engine does not know a CLI.
- Another agent means one more adapter and a line where adapters are listed, and nothing else.

**Alternatives:** keeping several CLIs as adapters (each needs its own way of asking for permissions and of read-only mode, and one that is never exercised for real is a risk with no use); one adapter written inline in the engine (it works until the second agent).

**Why:** the permission request, the read-only mode and the contract each depend on what an agent's CLI can do. With one port, the engine states what it needs and an adapter says how, so a new agent never touches the engine.

**Related:** D8 (headless machines), D28 (the simulated agent), D44.

## D46. The core files are versioned and strict
**Decision:**
- `line.yaml` and `machine.yaml` carry `schema_version: 1`, an integer that is the version of the format and has nothing to do with the version of the product. It is required.
- A JSON Schema describes each file (`schemas/`). The loader checks every file against it, build mode loads its drafts through the same loader, and any editor can read the same files; [FORMATS.md](FORMATS.md) specifies the two formats.
- A key the schema does not know is an error, not a warning. A mistyped `alow:` would otherwise be ignored without a word.
- A file without `schema_version`, or with one the app does not know, fails with a message that says what to change. A format that changes later gets the next number and a note on how to migrate.
- A new need is first solved in the factory (roles, scripts, conventions); a new field goes into the schema only when the factory cannot solve it.

**Alternatives:** unknown keys as warnings (a format that accepts anything is not frozen); the product's version as the format's (a release that changes nothing in the files would still break every factory); a schema only in the docs (the loader and the forms would drift from it).

**Why:** the files are the product's contract with the people who write factories, so they are specified once and checked the same way everywhere.

**Related:** D4 (the factory repository is the source of truth), D41 (build mode writes these files).
