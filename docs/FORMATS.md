# Roboratory — File formats

The two files that define how work is done, `line.yaml` and `machine.yaml`. They are described by the JSON Schemas in [`schemas/`](../schemas), which the loader checks every file against; build mode loads its drafts through the same loader, and an editor can read the same schemas for completion and errors. The reasoning is in [D46](DECISIONS.md#d46-the-core-files-are-versioned-and-strict). The other files of a factory (`factory.yaml`, `sector.yaml`, `lines.yaml`) are described in [ARCHITECTURE.md](ARCHITECTURE.md#2-the-factory-repository).

## The rules

- **`schema_version` is required** at the top of each file. It is the version of the format, an integer, and has nothing to do with the version of the product. This app reads version `1`. A file without it, or with another number, fails to load with a message that says what to write.
- **A key the schema does not know is an error,** named with the place it is in and, when it looks like a known key, which one (`unknown key "alow" in the file (did you mean "allow"?)`). A mistyped key is never ignored.
- **A format that changes later gets the next number,** and the app says how to migrate a file of the one before.
- **A new need is first solved in the factory** (roles, scripts, conventions). A new key is added only when the factory cannot solve it.

To get completion and errors in an editor that understands JSON Schema, point it at the schema. For the YAML extension of VS Code, put this on the first line:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/caribeedu/roboratory/main/schemas/machine.schema.json
```

## `machine.yaml`

A machine runs one agent for one step. A machine folder with no `machine.yaml` runs with the defaults and needs no version.

| Key | Type | Meaning |
|---|---|---|
| `schema_version` | `1` | Required. |
| `agent` | `claude` or `sim` | The agent that runs the step. Default `claude`. `sim` is the simulated agent, free and offline. |
| `model` | string | The model the agent uses; the agent's own default when absent. |
| `effort` | string | The agent's effort level. |
| `goal` | string | What the machine is for, used by any line that gives the piece no goal of its own. |
| `attempts` | integer ≥ 1 | How many times the step is tried before the machine catches fire. Default 3. |
| `timeout` | string or number | How long one attempt may work: `90s`, `10m`, `2h`; a number is seconds. Default `10m`. It counts the agent's work, not the time a request waits for you. |
| `roles` | list of strings | Shared role files, relative to the factory, placed before the machine's own `role.md`. |
| `dirs` | list of strings | Extra folders the agent may use. |
| `tools` | list of strings | MCP servers or tools: `mcp__server` or `mcp__server__tool`. |
| `allow` | list of strings | Commands it may run besides the defaults, as prefixes (`npm test`), or tool names (`Edit`, `Bash`). Anything else is asked of a person. |
| `deny` | list of strings | Commands it must never run, added to the factory's, the sector's and the line's. Its flags may stand anywhere (`rm -rf` is also `rm -fr`), but a flag spelled another way is another word: list `git push -f` as well as `git push --force`. |
| `read_only` | boolean | No file edits and no `git push`. The commands in `allow` still run. |
| `sim` | mapping | How the simulated agent behaves. Free-form. |

A command is read by its parts, but not what it runs inside: `sh -c "…"`, `xargs` and `eval` run a string the engine cannot see. A factory that wants that closed denies them (`deny: [sh -c, bash -c, eval, xargs, sudo]`), as the demo factory does. The defaults, the way commands are read and what a person is asked are in [D44](DECISIONS.md#d44-permissions-requests-at-run-time-hard-denials-read-only-machines).

```yaml
schema_version: 1
agent: claude
model: sonnet
attempts: 2
timeout: 20m
read_only: true
allow: ["gh pr view", "npm test"]
deny: ["gh pr merge"]
```

## `line.yaml`

A line model: where work enters, the pieces a box passes through, and where it ends.

| Key | Type | Meaning |
|---|---|---|
| `schema_version` | `1` | Required. |
| `deny` | list of strings | Commands no machine of this line may run, added to the sector's and the factory's. |
| `intake` | mapping | Where work enters. |
| `intake.kind` | `manual`, `timer`, `webhook`, `chat` | Only manual intakes start runs today. |
| `intake.label` | string | |
| `intake.inputs` | list | The fields a work order asks for: a name, or a mapping with `name`, `label`, `required`, `placeholder`, `multiline`. |
| `pieces` | list | The machines, signals and gates. |
| `pallet` | mapping | Where finished work lands: `label`, and `needs` (default: the last piece). |

A piece has exactly one of `machine`, `signal` or `gate`:

| Key | Type | Meaning |
|---|---|---|
| `id` | string | Required. The piece's name, unique in the line; it cannot start with `@`. |
| `label` | string | |
| `goal` | string | What the piece is for in this line, at most 250 characters (checked when you save in build mode). |
| `needs` | piece id, mapping or list | Where the box comes from; default the piece before. A mapping is `{ from, when, back, laps }`: `when` is a rule over the box, `back: true` makes a return belt for rework (it needs a `when`), and `laps` bounds it. |
| `machine` | string | The machine folder this piece runs. |
| `signal` | string or mapping | A script that passes the box on when it exits 0: a command, or `{ run, timeout }`. |
| `gate` | mapping | A place where the box waits: `confirmations` (integer ≥ 1), `choices` (a list the box is routed on), or `rule` (it passes the box on by itself when the rule holds). |

```yaml
schema_version: 1
intake:
  kind: manual
  label: Jira intake
  inputs:
    - { name: ticket, label: Ticket, required: true }
pieces:
  - id: triage
    machine: triager
  - id: implement
    machine: implementer
    needs: [{ from: triage, when: "type == 'bug'" }]
  - id: review
    gate: { confirmations: 1 }
pallet:
  needs: [review]
```

## Moving a factory to this format

1. Add `schema_version: 1` as the first key of every `line.yaml` and `machine.yaml`.
2. Write `allow` and `deny` as prefixes: `Bash(gh pr view:*)` becomes `gh pr view`. `Bash(git:*)` becomes `git` only where a machine should be able to run all of git, `git push` included; most machines need nothing, since the local git commands are a default.
3. Load the factory. Each file that still does not match is named with the key.
