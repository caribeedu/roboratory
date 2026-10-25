import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import machineSchema from '../../schemas/machine.schema.json';
import { AGENTS } from '../shared/types';
import { createDemoFactory } from './demo';
import { loadFactory } from './factory';
import { checkFormat } from './formats';

const check = (kind: 'line' | 'machine', yaml: string) => checkFormat(kind, YAML.parse(yaml));

describe('The file formats', () => {
  describe('machine.yaml', () => {
    it('accepts a file with only its version, and one that uses every key', () => {
      expect(check('machine', 'schema_version: 1\n')).toEqual([]);
      expect(check('machine', `schema_version: 1
agent: claude
model: sonnet
effort: high
goal: Find the cause.
attempts: 3
timeout: 10m
roles: [shared/roles/a.md]
dirs: ["~/repos"]
tools: [mcp__slack]
allow: [npm test, Edit]
deny: [rm -rf]
read_only: true
`)).toEqual([]);
      expect(check('machine', 'schema_version: 1\nagent: sim\ntimeout: 90\nsim: { seconds: 2, anything: [1, 2], at: { all: true } }\n')).toEqual([]);
    });

    it('needs its version, and says what to write', () => {
      expect(check('machine', 'agent: claude\n')).toEqual([expect.stringContaining('schema_version is missing: write "schema_version: 1"')]);
    });

    it('refuses a version this app does not read', () => {
      expect(check('machine', 'schema_version: 2\n')).toEqual(['schema_version 2 is not one this app reads (it reads 1)']);
      expect(check('machine', 'schema_version: "1"\n')).toEqual([expect.stringContaining('is not one this app reads')]);
    });

    it('refuses a key it does not know, and says which known key it looks like', () => {
      const [msg] = check('machine', 'schema_version: 1\nalow: [npm test]\n');
      expect(msg).toContain('unknown key "alow" in the file (did you mean "allow"?)');
      expect(msg).toContain('Known keys:');
      expect(check('machine', 'schema_version: 1\nreadonly: true\n')[0]).toContain('did you mean "read_only"?');
      expect(check('machine', 'schema_version: 1\nzzzz: 1\n')[0]).not.toContain('did you mean');
    });

    it('refuses an agent that has no adapter, and a value of the wrong kind', () => {
      expect(check('machine', 'schema_version: 1\nagent: codex\n')).toEqual(['agent must be claude or sim']);
      expect(check('machine', 'schema_version: 1\nattempts: 0\n')).toEqual([expect.stringContaining('attempts')]);
      expect(check('machine', 'schema_version: 1\nallow: npm test\n')).toEqual(['allow must be array']);
      expect(check('machine', 'schema_version: 1\nread_only: yes please\n')).toEqual(['read_only must be boolean']);
    });

    it('refuses the older Bash(...) form of a command, and writes the prefix instead', () => {
      expect(check('machine', 'schema_version: 1\nallow: ["Bash(gh pr view:*)", "Bash(sh test.sh)"]\ndeny: ["Bash(rm -rf:*)"]\n')).toEqual([
        'allow: "Bash(gh pr view:*)" is the older form; write the command as a prefix: "gh pr view"',
        'allow: "Bash(sh test.sh)" is the older form; write the command as a prefix: "sh test.sh"',
        'deny: "Bash(rm -rf:*)" is the older form; write the command as a prefix: "rm -rf"',
      ]);
    });

    it('lists the agents the app has, and only those', () => {
      expect((machineSchema.properties.agent as { enum: string[] }).enum).toEqual([...AGENTS]);
    });
  });

  describe('line.yaml', () => {
    const LINE = `schema_version: 1
deny: [make clean]
intake:
  kind: manual
  label: Start
  inputs:
    - ticket
    - { name: repo, label: Repo, required: true, placeholder: x, multiline: true }
pieces:
  - { id: a, label: A, goal: Do a., machine: a }
  - id: b
    signal: make
  - id: c
    signal: { run: make, timeout: 5m }
    needs: [a, { from: b, when: "ok == true" }, { from: c, when: "x == 1", back: true, laps: 2 }]
  - id: d
    gate: { choices: [yes, no], confirmations: 2 }
    needs: a
pallet:
  label: Done
  needs: [d]
`;

    it('accepts every key a line uses', () => {
      expect(check('line', LINE)).toEqual([]);
    });

    it('needs its version', () => {
      expect(check('line', 'intake: { kind: manual }\n')).toEqual([expect.stringContaining('schema_version is missing')]);
    });

    it('finds a mistyped key at any depth, and says where', () => {
      expect(check('line', 'schema_version: 1\npieces:\n  - { id: a, mchine: a }\n')[0]).toContain('unknown key "mchine" in pieces[0] (did you mean "machine"?)');
      expect(check('line', 'schema_version: 1\npieces:\n  - id: a\n    needs: [{ from: x, bak: true }]\n')[0]).toContain('unknown key "bak" in pieces[0].needs[0] (did you mean "back"?)');
      expect(check('line', 'schema_version: 1\npieces:\n  - id: g\n    gate: { confirmation: 2 }\n')[0]).toContain('in pieces[0].gate (did you mean "confirmations"?)');
      expect(check('line', 'schema_version: 1\nintake: { kind: manual, inputs: [{ nam: x }] }\n')[0]).toContain('in intake.inputs[0] (did you mean "name"?)');
      expect(check('line', 'schema_version: 1\nintake: { kind: manual }\npalet: {}\n')[0]).toContain('unknown key "palet" in the file (did you mean "pallet"?)');
    });

    it('refuses a piece with no id and an intake that is not one', () => {
      expect(check('line', 'schema_version: 1\npieces:\n  - machine: a\n')).toEqual(['pieces[0] needs "id"']);
      expect(check('line', 'schema_version: 1\nintake: { kind: carrier-pigeon }\n')[0]).toContain('intake.kind must be manual or timer or webhook or chat');
    });
  });

  describe('when a factory loads', () => {
    const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-formats-'));
    const demo = () => { const dir = tmp(); return createDemoFactory(path.join(dir, 'factory'), path.join(dir, 'repos')); };

    it('loads the demo factory, which is written in the format', () => {
      expect(loadFactory(demo()).warnings).toEqual([]);
    });

    it('names the file and the key, and keeps loading the rest', () => {
      const root = demo();
      const file = path.join(root, 'shared/machines/triager/machine.yaml');
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('read_only: true', 'readonly: true'));
      const f = loadFactory(root);
      const warning = f.warnings.join('\n');
      expect(warning).toContain('machine.yaml');
      expect(warning).toContain('unknown key "readonly"');
      expect(f.sectors.map((s) => s.id)).toContain('releases');
    });

    it('says what to add to a line.yaml that has no version', () => {
      const root = demo();
      const file = path.join(root, 'sectors/releases/models/ship-to-prod/line.yaml');
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('schema_version: 1\n', ''));
      expect(loadFactory(root).warnings.join('\n')).toMatch(/line\.yaml: schema_version is missing: write "schema_version: 1"/);
    });

    it('keeps the problem instead of failing when build mode loads a draft', () => {
      const root = demo();
      const file = path.join(root, 'shared/machines/triager/machine.yaml');
      fs.writeFileSync(file, 'agent: sim\n');
      const f = loadFactory(root, { tolerant: true });
      expect(f.problems?.map((p) => p.message).join('\n')).toContain('schema_version is missing');
    });
  });
});
