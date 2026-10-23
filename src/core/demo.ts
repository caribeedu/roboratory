// Writes a ready-to-run demo factory. Its machines use the simulated agent,
// so the demo costs nothing and works offline. Swap `agent: sim` for
// `agent: claude` (or codex) in any machine.yaml to run real agents.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

type Files = Record<string, string>;

const write = (root: string, files: Files) => {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    if (rel.endsWith('.sh')) fs.chmodSync(p, 0o755);
  }
};
const json = (o: unknown) => JSON.stringify(o, null, 2) + '\n';

function machine(role: string, contract: object, conf: string): Files {
  return { 'role.md': role, 'contract.json': json(contract), 'machine.yaml': conf };
}
function prefix(dir: string, files: Files): Files {
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [`${dir}/${k}`, v]));
}

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, { cwd, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 'Promptory', GIT_AUTHOR_EMAIL: 'demo@promptory.local', GIT_COMMITTER_NAME: 'Promptory', GIT_COMMITTER_EMAIL: 'demo@promptory.local' } });
}

export function createTargetRepo(dir: string, name: string) {
  write(dir, {
    'README.md': `# ${name}\n\nA demo target repository for Promptory.\n`,
    'src/orders.py': 'def create_order(items):\n    return {"items": items}\n',
    'test.sh': '#!/bin/sh\n# Demo test suite: passes once a fix has been written.\necho "collected 48 items"\ntest -f FIX.md && echo "48 passed" && exit 0\necho "FAILED: no fix found"; exit 1\n',
  });
  fs.chmodSync(path.join(dir, 'test.sh'), 0o755);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Initial commit');
}

export function createDemoFactory(root: string, reposDir = path.join(root, '..', 'promptory-demo-repos')) {
  if (fs.existsSync(path.join(root, 'factory.yaml'))) throw new Error(`${root} already holds a factory`);
  fs.mkdirSync(root, { recursive: true });
  for (const repo of ['orders-api', 'storefront-ui']) {
    const d = path.join(reposDir, repo);
    if (!fs.existsSync(path.join(d, '.git'))) createTargetRepo(d, repo);
  }
  const rel = (repo: string) => path.relative(root, path.join(reposDir, repo));

  const triage = machine(
    'You triage a ticket. Read the ticket id from the box, decide whether it is a bug or a question, and rate its severity.\n',
    { type: 'object', required: ['ticket', 'type', 'severity'], properties: { ticket: { type: 'string' }, type: { enum: ['bug', 'question'] }, severity: { enum: ['low', 'medium', 'high'] }, summary: { type: 'string' } } },
    `agent: sim
attempts: 3
timeout: 5m
sim:
  seconds: 4
  transcript:
    - "▸ jira.getJiraIssue {{box.ticket}}"
    - "◂ summary, labels, components"
    - "▸ read AGENTS.md"
  output:
    ticket: "{{box.ticket}}"
    type: "{{pick bug|bug|bug|question}}"
    severity: "{{pick low|medium|high}}"
    summary: "Orders API returns 500 when items are empty"
`);
  const planner = machine(
    'You plan the fix for a bug. Read the triage box and write a short plan to PLAN.md in your folder.\n',
    { type: 'object', required: ['ticket', 'steps', 'files'], properties: { ticket: { type: 'string' }, steps: { type: 'integer' }, files: { type: 'array', items: { type: 'string' } }, risk: { enum: ['low', 'medium', 'high'] } } },
    `agent: sim
sim:
  seconds: 5
  write:
    PLAN.md: "# Plan for {{box.ticket}}\\n\\n1. Guard empty items in create_order\\n2. Add a regression test\\n"
  transcript:
    - "▸ grep -rn create_order src/"
    - "◂ 1 match"
    - "▸ write PLAN.md"
  output:
    ticket: "{{box.ticket}}"
    steps: "{{int 2 5}}"
    files: ["src/orders.py", "tests/test_orders.py"]
    risk: "{{pick low|medium}}"
`);
  const implementer = machine(
    'You implement the plan. Read PLAN.md from the planner\'s folder, change the code, write FIX.md describing the change, and commit.\n',
    { type: 'object', required: ['ticket', 'branch', 'diff'], properties: { ticket: { type: 'string' }, branch: { type: 'string' }, diff: { type: 'string' }, tests_added: { type: 'integer' } } },
    `agent: sim
attempts: 3
timeout: 15m
allow: ["Bash(git:*)", "Bash(sh test.sh)"]
sim:
  seconds: 8
  write:
    src/orders.py: "def create_order(items):\\n    if not items:\\n        raise ValueError('items must not be empty')\\n    return {'items': items}\\n"
    FIX.md: "Guard empty items in create_order ({{box.ticket}}).\\n"
  commit: "Guard empty items ({{box.ticket}})"
  transcript:
    - "▸ read ../plan/PLAN.md"
    - "▸ edit src/orders.py"
    - "◂ +3 −0"
    - "▸ sh test.sh"
    - "◂ 48 passed"
    - "▸ git commit"
  output:
    ticket: "{{box.ticket}}"
    branch: "{{git.branch}}"
    diff: "+{{int 12 40}} −{{int 1 6}}"
    tests_added: "{{int 1 3}}"
`);
  const publisher = machine(
    'You publish the change: push the branch and open a draft pull request. Leave a note of what you published in your output (pr_url, branch, title).\n',
    { type: 'object', required: ['pr_url', 'branch', 'title'], properties: { pr_url: { type: 'string', pattern: '^(https://github\\.com/.+/pull/\\d+|local://pr/.+)$' }, branch: { type: 'string' }, title: { type: 'string' } } },
    `agent: sim
allow: ["Bash(git:*)", "Bash(gh pr create:*)"]
sim:
  seconds: 4
  write:
    PR.md: "Draft PR local://pr/{{run.id}}\\nBranch: {{git.branch}}\\n"
  commit: "Open draft PR"
  transcript:
    - "▸ git push -u origin {{git.branch}}"
    - "▸ gh pr create --draft"
    - "◂ local://pr/{{run.id}}"
  output:
    pr_url: "local://pr/{{run.id}}"
    branch: "{{git.branch}}"
    title: "Fix {{box.ticket}}: guard empty items"
`);
  const responder = machine(
    'You answer a question ticket with a short, sourced reply.\n',
    { type: 'object', required: ['ticket', 'answer'], properties: { ticket: { type: 'string' }, answer: { type: 'string' }, links: { type: 'integer' } } },
    `agent: sim
sim:
  seconds: 3
  transcript:
    - "▸ confluence.search \\"label printing\\""
    - "◂ 3 pages"
  output:
    ticket: "{{box.ticket}}"
    answer: "Label printing retries 3 times before failing; see the runbook."
    links: "{{int 1 3}}"
`);

  const correlator = machine(
    'You correlate an alert with recent signals: error rate, deploys, traces.\n',
    { type: 'object', required: ['service', 'error_rate'], properties: { service: { type: 'string' }, error_rate: { type: 'number' }, baseline: { type: 'number' }, deploys_in_window: { type: 'array' } } },
    `agent: sim
tools: ["mcp__new-relic__run_nrql_query"]
sim:
  seconds: 4
  transcript:
    - "▸ new-relic.run_nrql_query error rate, 30 min"
    - "◂ 14.2% (baseline 0.4%)"
    - "▸ git log --since=2h"
    - "◂ 1 deploy: v4.17.3"
  output:
    service: "{{params.service}}"
    error_rate: 14.2
    baseline: 0.4
    deploys_in_window: ["v4.17.3"]
`);
  const investigator = machine(
    'You find the most likely cause. Your answer must name the suspected cause and your confidence between 0 and 1.\n',
    { type: 'object', required: ['service', 'suspected_cause', 'confidence'], properties: { service: { type: 'string' }, suspected_cause: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidence: { type: 'integer' } } },
    `agent: sim
attempts: 3
tools: ["mcp__new-relic__run_nrql_query", "mcp__incident-io__alert_show"]
sim:
  seconds: 5
  fail_first_run: true
  bad_output:
    service: "{{params.service}}"
    confidence: "high"
  transcript:
    - "▸ new-relic.run_nrql_query slowest db spans"
    - "◂ pool wait p95 2.8s"
    - "▸ incident-io.alert_show"
    - "◂ sev2 · {{params.service}} 5xx spike"
  output:
    service: "{{params.service}}"
    suspected_cause: "Connection pool exhaustion after v4.17.3"
    confidence: "{{num 0.72 0.9}}"
    evidence: 3
`);
  const mitigator = machine(
    'You apply the agreed mitigation: roll back to the previous release.\n',
    { type: 'object', required: ['action', 'target'], properties: { action: { enum: ['rollback', 'restart', 'scale'] }, target: { type: 'string' } } },
    `agent: sim
sim:
  seconds: 5
  transcript:
    - "▸ helm rollback {{params.service}} 41"
    - "◂ revision 43 deployed"
    - "▸ kubectl rollout status"
    - "◂ 6/6 ready"
  output:
    action: rollback
    target: v4.17.2
`);
  const deployer = machine(
    'You deploy the tagged release with a 10% canary.\n',
    { type: 'object', required: ['tag', 'strategy'], properties: { tag: { type: 'string' }, strategy: { enum: ['canary', 'rolling'] }, canary: { type: 'string' } } },
    `agent: sim
sim:
  seconds: 6
  transcript:
    - "▸ argocd app sync {{params.service}} --revision {{box.tag}}"
    - "◂ canary 10%"
    - "▸ argocd app wait --health"
    - "◂ Healthy"
  output:
    tag: "{{box.tag}}"
    strategy: canary
    canary: "10%"
`);

  write(root, {
    '.gitignore': '.runs/\n',
    'README.md': '# Demo Factory\n\nA Promptory factory. Open this folder in Promptory.\n',
    'factory.yaml': `name: Demo Factory
# What any sector may let its manager do alone. Releasing gates and applying
# changes can never be automatic.
ceiling:
  retry: { auto: 2 }
  run: { auto: 3 }
  halt: { auto: 1 }
general_manager:
  agent: sim
  tools: []
`,
    'general-manager/role.md': 'You are the General Manager. You answer questions that span sectors.\n',
    // shared library: a line model used by two lines
    'shared/models/ticket-to-pr/line.yaml': `intake:
  kind: manual
  label: Jira intake
  inputs:
    - { name: ticket, label: Ticket, required: true, placeholder: PROJ-812 }
pieces:
  - id: triage
    machine: triager
  - id: plan
    machine: planner
    needs: [{ from: triage, when: "type == 'bug'" }]
  - id: implement
    machine: implementer
  - id: tests
    signal: { run: "sh test.sh" }
  - id: review
    label: Review
    gate: { confirmations: 1 }
  - id: publish
    machine: publisher
  - id: pr-check
    label: PR exists
    signal: { run: "signals/check-pr.sh {{box.pr_url}}" }
  - id: respond
    machine: responder
    needs: [{ from: triage, when: "type == 'question'" }]
pallet:
  label: Delivered
  needs: [pr-check, respond]
`,
    'shared/models/ticket-to-pr/signals/check-pr.sh': '#!/bin/sh\n# Verifies the PR the publisher claims to have opened really exists.\n# With GitHub this would be: gh pr view "$1" --json state,isDraft\ngrep -q "$1" PR.md && echo "found $1" && exit 0\necho "PR $1 not found"; exit 1\n',
    ...prefix('shared/machines/triager', triage),
    ...prefix('shared/machines/planner', planner),
    ...prefix('shared/machines/implementer', implementer),
    ...prefix('shared/machines/publisher', publisher),
    ...prefix('shared/machines/responder', responder),

    'sectors/engineering/sector.yaml': `name: Engineering
color: "#5b8fd3"
policy:
  retry: { auto: 1 }
manager:
  agent: sim
  tools: []
`,
    'sectors/engineering/manager/role.md': 'You are the Engineering Sector Manager. You know the ticket-to-PR lines.\n',
    'sectors/engineering/lines.yaml': `lines:
  - id: orders-api
    name: orders-api tickets
    model: ticket-to-pr
    repo: ${rel('orders-api')}
    params: { service: orders-api }
  - id: storefront-ui
    name: storefront-ui tickets
    model: ticket-to-pr
    repo: ${rel('storefront-ui')}
    params: { service: storefront-ui }
`,

    'sectors/incidents/sector.yaml': `name: Incidents
color: "#e0703f"
policy: {}
manager:
  agent: sim
  tools: ["mcp__new-relic__run_nrql_query"]
`,
    'sectors/incidents/manager/role.md': 'You are the Incidents Sector Manager. Help diagnose and suggest the next action.\n',
    'sectors/incidents/models/triage-to-mitigation/line.yaml': `intake:
  kind: manual
  label: Alert
  inputs:
    - { name: alert, label: Alert id, required: true, placeholder: ALT-55102 }
pieces:
  - id: correlate
    machine: correlator
  - id: investigate
    machine: investigator
  - id: confident
    label: Confident?
    gate: { rule: "confidence >= 0.7" }
  - id: signoff
    label: Mitigation OK
    gate: { confirmations: 1 }
  - id: mitigate
    machine: mitigator
  - id: error-rate
    label: Error rate <1%
    signal: { run: "signals/error-rate.sh {{params.service}}" }
pallet:
  label: Resolved
`,
    'sectors/incidents/models/triage-to-mitigation/signals/error-rate.sh': '#!/bin/sh\n# Demo probe: in real life, query your metrics here.\nsleep 2\necho "$1 error rate 0.3% (threshold 1%)"\nexit 0\n',
    ...prefix('sectors/incidents/models/triage-to-mitigation/machines/correlator', correlator),
    ...prefix('sectors/incidents/models/triage-to-mitigation/machines/investigator', investigator),
    ...prefix('sectors/incidents/models/triage-to-mitigation/machines/mitigator', mitigator),
    'sectors/incidents/lines.yaml': `lines:
  - id: orders-api
    name: orders-api incidents
    model: triage-to-mitigation
    params: { service: orders-api }
`,

    'sectors/releases/sector.yaml': `name: Releases
color: "#8bc96b"
policy: {}
manager:
  agent: sim
`,
    'sectors/releases/manager/role.md': 'You are the Releases Sector Manager.\n',
    'sectors/releases/models/ship-to-prod/line.yaml': `intake:
  kind: manual
  label: Release tag
  inputs:
    - { name: tag, label: Tag, required: true, placeholder: v4.18.0 }
pieces:
  - id: ci
    label: CI green
    signal: { run: "signals/ci.sh {{box.tag}}" }
  - id: nonprod
    label: Non-prod applied
    signal: { run: "signals/nonprod.sh {{box.tag}}" }
    needs: ["@intake"]
  - id: launch
    label: Launch
    gate: { confirmations: 2 }
    needs: [ci, nonprod]
  - id: deploy
    machine: deployer
  - id: canary
    label: Canary healthy
    signal: { run: "signals/canary.sh" }
pallet:
  label: In production
`,
    'sectors/releases/models/ship-to-prod/signals/ci.sh': '#!/bin/sh\nsleep 2\necho "required checks: 14/14 passed for $1"\n',
    'sectors/releases/models/ship-to-prod/signals/nonprod.sh': '#!/bin/sh\nsleep 3\necho "staging runs $1"\n',
    'sectors/releases/models/ship-to-prod/signals/canary.sh': '#!/bin/sh\nsleep 3\necho "canary 10%: error rate 0.2%, p95 180ms"\n',
    ...prefix('sectors/releases/models/ship-to-prod/machines/deployer', deployer),
    'sectors/releases/lines.yaml': `lines:
  - id: orders-api
    name: orders-api releases
    model: ship-to-prod
    direction: left
    params: { service: orders-api }
`,
  });
  return root;
}
