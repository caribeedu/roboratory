# Promptory — Product

What Promptory is and how it behaves. For how it is built, see [ARCHITECTURE.md](ARCHITECTURE.md). For why, see [DECISIONS.md](DECISIONS.md).

Sections marked *planned* describe designed behavior that is not built yet; the list is in [ROADMAP.md](ROADMAP.md) §3.

## 1. Vision

Running several AI agents on real work today means either free-form chat between agents, which is hard to predict, or workflow engines that hide the agents behind logs. Promptory treats agent work like a factory floor. Lines are designed in advance, every step's output is checked against a contract, humans hold the gates that matter, and the whole operation is visible at a glance.

**Principles**

1. **Deterministic lines.** The order of steps, the routing, the checks and the gates are defined in files. Agents fill in each step's content and never decide the flow.
2. **Everything visible.** If something is running, waiting or burning, it shows on the floor, on the minimap and in the log.
3. **Git is the source of truth.** The factory is a repository. Changing the factory means a reviewed diff, never improvisation at runtime.
4. **Managers propose, humans decide.** Agents that talk to you can suggest actions and changes. They act on their own only where a versioned policy allows it.

## 2. Entities

### 2.1 Factory
One git repository. It holds the factory settings, the culture every agent follows (`culture.md`), the General Manager, the shared assets, the policy ceiling and every sector. The factory building grows with its contents: floor and walls expand as lines get longer or more numerous.

### 2.2 Sector
A group of production lines, for example *Engineering*, *Incidents* or *Releases*. You can create as many as you want.
- The Floor shows one sector at a time. The Andon (planned) will show them all.
- Each sector has one Sector Manager and its own policy.
- Each sector has a color on the minimap.

### 2.3 Line model and production line
A **line model** is the design: its intake, machines, belts, signals and gates.

A **production line** is a running copy of a model inside a sector, with its own name, its growth direction (left or right) and parameters, such as the service or the repository it works on. One sector can hold several lines from the same model, for example one incident line per service.

A model can live in a sector or in the factory's shared library, where any sector can use it. Changing a shared model warns how many lines in how many sectors it affects.

You never place lines by hand. A line lays itself out from its model: it starts at its intake and grows in its chosen direction, branching where its belts split.

### 2.4 Intake
The first piece of a line. Its kind decides when a run starts, how the intake looks and what the first item on the belt is:

| Kind | Looks like | First item | Starts a run when |
|---|---|---|---|
| Manual | Hand cart | Work order | You dispatch a run with its inputs |
| Timer | Clock post | Punch card | Its schedule fires |
| Webhook | Pneumatic tube | Sealed capsule | An external system posts to it (Jira, incident.io, GitHub) |
| Chat | Message board | Letter | A Slack message or mention matches |

Only the manual intake starts runs today; the timer, webhook and chat intakes are planned.

### 2.5 Machine
One step of a line, and the only place where an agent works.
- It has a **role** (instructions), a **contract** (the JSON Schema its output must match), an agent template, tools (by name, from MCP servers already configured in the agent CLI) and an attempt budget.
- It runs the agent **headless**, with a fresh context, and gets only the incoming box. The step ends when the process exits.
- If the output does not match the contract, or the agent times out, the machine runs the step again with a fresh agent and the validation errors, up to its attempt budget. When the attempts run out, the machine **catches fire** and the line stops behind it.
- Instead of its contract, a machine may answer that it **needs you**: a question, options and its recommendation. It shows the exclamation balloon and joins the attention queue; your answer runs it again in the same folder without spending an attempt.
- A machine may also answer that it is **blocked** by something outside its work, such as a broken shared environment. It catches fire at once with its reason, without spending an attempt, and you retry it once the cause is fixed.
- Every machine's role is followed by the factory's culture and its sector's culture, if any.
- Machines, signals and gates have a goal: what the piece is for, in at most 250 characters. A machine has a default goal that a line can replace for its own piece.
- A machine is told its place in the line: the line in order, its goal, where its box comes from and goes, and every piece after it with its goal, so it does only its own step. It is also told what you decided in the run so far: gate choices and notes, retry hints and answers to questions. The factory can turn this off.
- Each machine works in its **own folder** for each run. It can read the folders of the other machines in the same line run.
- When the line works on a repository, the machine's folder is its own branch of that repository, starting from the previous machine's work. The agent does its own git work as its role instructs, and anything it leaves uncommitted is committed for it when it finishes.
- A worker character stands at each machine and animates while the agent runs. Machines show no progress bar, because an agent's duration can't be predicted.

### 2.6 Belt
Carries boxes between pieces and runs in the line's direction.

A **splitter belt** divides into two or more paths and routes each box on a field of its contract, for example `type: bug` goes one way and `type: question` the other. Routing never asks a model.

A **return belt** sends a box back to an earlier machine for rework, for example from QA back to the developer when `verdict == 'fail'`. It runs under the line, the other way. The machine at its end works again in the same folder with the checker's findings, and everything after it runs again. Each return belt has a lap limit; when it runs out, the machine catches fire and the decision is yours. A return belt can also start at a signal: when the signal fails, the box goes back with what the signal printed.

### 2.7 Box and Pallet
A **box** is the contract-valid output of a machine: a piece of progress, or a part of the deliverable, travelling on the belts. Clicking a box shows its fields in readable form, with each field's description from the contract and the raw JSON one click away.

The **pallet** sits at the end of a line. Boxes that complete the line are stacked on it, and what is on the pallet is the line's deliverable: a draft PR, a Jira comment, a Slack update, a production release. The pallet does nothing itself. Publishing is done by the agent of the last machine, its contract requires a note of what it published (such as the PR link), and a signal before the pallet checks that it really exists.

### 2.8 Signal
A deterministic check on the line, such as tests, an error-rate threshold or a canary health check.
- It runs a script and passes the box on exit code 0.
- Anything else fails. If a return belt from the signal takes the box, it goes back for rework with `signal: 'fail'` and the last lines the script printed; otherwise the signal stops the line.
- A signal has a time limit, 10 minutes unless the line sets its own `timeout`. A signal stopped at its limit says it timed out and catches fire, even with a return belt.
- A loading bar shows the check while it runs.

### 2.9 Gate
Holds boxes until it opens. There are three kinds:
- **Human gate.** A release button. It can ask "are you sure?" more than once, for example twice before production.
- **Decision gate.** A human gate with choices, such as hotfix, rollback, investigate or monitor. You pick one and can write a note; belts after the gate route on your choice, and the next machine receives your note.
- **Rule gate.** A deterministic expression over the box, such as `confidence >= 0.7`.

A gate that is waiting on you shows a floating exclamation balloon and its bars stay closed. It shows no loading bar: it opens only when you release it.

### 2.10 Sector Manager
One character per sector, standing by the back wall in the room's left corner, apart from the lines. It watches with hands on hips, and switches to a thinking pose while it works on an answer.
- It answers questions about its sector, using the sector's state, run logs, transcripts and contracts. It can also use the MCP tools its sector lists by name, already configured in the agent CLI.
- It runs **read-only**: it has no tool that writes files or opens gates. Everything it wants changed comes back as a proposal.
- **Answers follow a contract:** `answer`, `evidence` (links to the runs and steps behind it) and `proposals`.
- **Proposals become buttons.** Each proposal is a verb with its arguments, such as retrying a machine with a hint or approving a gate. Nothing runs until you press it, unless the sector policy allows that verb to run on its own.
- It can propose changes to its sector's files. They appear as a diff in the conversation panel, and are written only when you accept them (ghost pieces on the Floor are planned, §3.9). It is told to stay inside its sector, and your review is the guard.

### 2.11 General Manager
Works at factory level.
- It answers questions that span sectors, such as "where are we losing the most time this week?".
- It builds whole new sectors for you, delivered as a diff you review and accept, and it can change shared assets the same way.

## 3. Interacting

### 3.1 Floor
The working view. You are inside one sector's room, one sector at a time. The camera is a top-down oblique pixel-art view: a three-quarter angle that shows both the top and the front of objects.
- The floor tiles are the same inside and around the lines.
- Walls show on the sides and at the back, like a cutaway dollhouse.
- Pan by dragging or with a two-finger trackpad scroll; zoom with a pinch, ctrl/cmd + wheel, or the + and − buttons.
- Clicking any piece opens its panel: state, its flow (where boxes come from and where they go, with every belt rule in plain words), definition files, transcript, last box and actions. The floor itself shows no rule text; return belts stand out by their amber color.

### 3.2 Andon (planned)
The director's view: the whole factory building, with every sector as a room side by side.
- Rooms are drawn simplified: state colors, fires and exclamation balloons, without workers, smoke or other fine animation.
- Floor and Andon are two menus over one world. Switching between them is a camera move: opening a room from the Andon zooms into that sector's Floor, and choosing Andon from the Floor pulls the camera back out to the building.

### 3.3 Minimap
Always visible. It shows every sector, and a sector that needs you (a fire, or a gate waiting on you) changes color and plays a sound. Clicking a sector opens it on the Floor.

### 3.4 Attention queue
One list for the whole factory of everything that needs you, ordered by severity: fires first, then gates, each by how long it has waited. Picking an item switches to its sector, flies the camera to the piece and opens its panel. A shortcut jumps to the next item. The minimap shows where attention is needed; the queue shows what and in which order.

### 3.5 Situations are entity panels
There are no special modes. Each situation is the panel of the entity it concerns:
- **A machine on fire** opens the fire panel: the contract error, the agent's last tool calls and a hint field for the retry. While the fire panel is open, the sector's other lines dim, an alarm pulses at the edges and the boxes stalled behind the fire are highlighted. Closing the panel restores the floor.
- **A gate waiting on you** opens the gate panel: the status of the signals before it, and the release button with its confirmations. A production deploy is a gate that asks twice, with signals in front of it.
- **A manual intake** opens a work-order form, with fields taken from the model's inputs, and a dispatch button.

### 3.6 Megaphone
A chat bar fixed at the bottom for talking to the managers in natural language.
- On the Floor it addresses the Sector Manager of that sector; on the Andon, the General Manager. The bar shows who you are talking to, and you can switch.
- Clicking a manager character focuses the bar. The character takes its thinking pose while it answers.
- The answer opens in a conversation panel: the text, the evidence (links to runs and steps) and the proposals as buttons. Proposals that change files also show their diff there; ghosts on the Floor are planned (§3.9).
- Each sector keeps its own conversation history.
- Actions do not go through the chat: the UI has buttons for them, and managers' proposals arrive as buttons.

### 3.7 Ledger
The history of every run, filterable by sector, line, state and period. Opening a run shows:
- a timeline of its steps and how long each took;
- the boxes each machine produced, with their JSON;
- the contract attempts and their errors;
- the agents' transcripts;
- when each gate was released;
- what landed on the pallet;
- the factory commit the run used, plus the exact uncommitted diff if there was one.

Replaying a past run on the Floor is planned.

### 3.8 Build mode
Where you build and change the factory, on the Floor itself, one sector at a time.

**Creating.** "New sector" asks for a name and a color, saves the empty sector at once and opens build mode in its room. "New line" in a sector either copies an existing model (from the sector or from `shared/`), with its own name and parameters, or starts a new model with just an intake and a pallet. "Separate into its own model" copies a line's model so you can change that line alone.

**Editing a line.** A line's edits change its model, so build mode first says how many lines and sectors the change affects. The line re-lays itself out as you edit.
- **Insert:** "+" slots appear on every belt, after the last step and at splits. A slot offers a machine, a signal, a gate or a new path, and the piece arrives already connected.
- **Connect:** select a piece, choose "connect to…", and click the destination. A destination earlier in the line becomes a return belt; it stays red until you give it the rule that sends a box back, and its lap limit. A destination with several inputs becomes a join.
- **Remove:** a removed piece leaves its broken connections in red until you reconnect them. Connections are removed from the Flow section of the inspector. A removed machine's folder is deleted unless another piece uses the same machine.
- **Belt rules:** a guided builder offers only the fields and values that the previous piece's contract has: `decision.choice` with a gate's choices, a machine's properties with their enums. A text mode covers rules with `&&` and `||`, and the rule is always shown in plain words.
- **Undo and redo** step by step within the session.

**Piece settings.**
- **Machine:** `machine.yaml` as a form (agent, model, effort, attempts, timeout, shared roles, folders, and tools picked from the MCP servers configured in the agent CLI), `role.md` as Markdown with a preview, and the contract as a list of fields (name, type, allowed values, required, description), with a JSON view for nested fields.
- **Intake:** the dispatch form's fields and the label. The kind stays manual until the other intakes start runs.
- **Gate:** a release with confirmations, a decision with its choices, or an automatic rule built with the rule builder. Renaming or removing a choice turns the belt rules that used it red.
- **Signal:** the command, its time limit, with suggestions for `{{box.…}}` from the previous piece's contract, and an editor for scripts in `signals/`. New scripts are written executable.
- **Shared roles** in `shared/roles/` are edited from the machine's settings, with the list of machines and lines they affect.

**Line, sector and factory settings.** A line's name, direction, parameters and target repository. A sector's name, color, manager and culture, and its policy, which build mode keeps within the factory ceiling. The factory's culture, General Manager and ceiling. `release` and applying changes can never be made automatic.

**Saving.** Edits stay in a draft until you leave build mode. Leaving shows the file diff, and you save everything or discard it. Switching sectors asks you to do the same first. Saving is allowed only when the factory loads with no warnings, every piece is reachable from the intake and reaches the pallet, no connection is broken, every rule reads a field the previous piece's contract has, and every choice and enum value used for routing has a way out. YAML files keep their comments and style; when the structure changed, the diff points out that a file's summary comment may be stale.

**Safety.**
- Saving is blocked while a line the change affects has a run in progress. Accepting a manager's change follows the same rule, and is unavailable while a build session is open.
- If files change on disk during a session, the diff marks them, and you keep your version or take the one on disk, file by file.
- The sector keeps working during a session: runs continue, and their gates, questions and retries are handled from their live panels, which the attention queue and each piece's "Open the live panel" link open. Dispatching is disabled only on lines the draft changes, since they would run the files on disk, not what the Floor shows.

### 3.9 Proposals as ghosts (planned)
A manager's proposed change appears on the Floor as translucent ghost pieces: additions in blue, removals in red, and the line as it would look. A floating card offers Accept, Reject and View diff.
- A new sector proposed by the General Manager appears as a ghost room in the Andon.
- Changes with no visual form, such as a role's text or a contract's schema, show only as a diff, with a marker on the affected piece.

### 3.10 Blueprint (planned)
The factory's files: the file tree, the pending diff against the last commit, and the commit history. Promptory reads git and never writes to it.
- Accepting a proposal or confirming build mode only writes files. Committing and pushing are up to you, in your own tools.
- Lines always run from the files on disk.

### 3.11 Live log
A floating radio log with three levels:

| Level | Shows |
|---|---|
| Factory | Only line starts and finishes, prefixed with the sector |
| Sector | Every event of every line in the sector |
| Machine | The detailed transcript of one machine's agent |

### 3.12 Actions and audit
Every action is a verb: run, retry, release, halt, resume, and accepting a change. Buttons and manager proposals call the same verbs; a command-line interface is planned. Every verb lands in the audit log with who triggered it and when, for example "you approved the gate *Mitigation OK* at 14:02".

### 3.13 First-factory tutorial (planned)
The first time you create a factory, a step-by-step tutorial walks through each entity in order. Each step focuses the camera on that entity and lets you try it:
1. Sector
2. Sector Manager
3. Production line
4. Machine
5. Belt
6. Signal
7. Gate
8. Box
9. Pallet

## 4. Non-goals (for now)
- A free-form canvas where you place agents and wire them by hand.
- Managers or agents that restructure lines at runtime.
- Remote execution environments. Everything runs on your machine.
