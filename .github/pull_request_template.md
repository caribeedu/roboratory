<!--
Delete a section that does not apply, but say "none" rather than leave it empty when it is a question a reviewer would ask.
Write in the words of the product (machine, box, belt, gate, pallet, line, sector) and in the present tense. See CONTRIBUTING.md.
-->

## What and why

<!-- What changes for a user, and why now. A paragraph; the CHANGELOG has the detail. -->

## Where to look

<!-- For a large diff: the files that carry the change, in the order to read them. Say what moved or was removed. -->

## Behavior changes

<!-- Anything a user or a maintainer will notice: a new command, a refused action, a different default. "None" if none. -->

## Decisions

<!-- The D# this applies, adds or changes. A design decision goes in docs/DECISIONS.md, with its reasoning, before the code. "None" if none. -->

## Verification

<!-- What you ran and where. Say what you could not run (another operating system, a real agent) and who or what will. -->

- [ ] `npm run typecheck`
- [ ] `npm run test:coverage`
- [ ] `npm run package`, then `npm run test:e2e` (when the window, the main process or the engine changed)
- [ ] CI is green on the last commit

## Checklist

- [ ] Each behavior change has a test at the lowest layer that can see it, and a bug fix has the test that failed first ([docs/DEVELOPMENT.md#tests](../docs/DEVELOPMENT.md#tests))
- [ ] No test calls a real agent; nothing sends data out of the machine; file formats stay open ([AGENTS.md](../AGENTS.md))
- [ ] The docs say what the code now does: README, `docs/`, and a `CHANGELOG.md` entry under the version in progress, without dates
- [ ] A new dependency is pinned and has a reason, given above
