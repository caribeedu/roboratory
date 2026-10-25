import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDemoFactory } from '../demo';
import { checkFactory } from './checks';
import { Draft } from './draft';
import { apply } from './ops';

const machine = (props = '{"verdict":{"type":"string","enum":["pass","fail"]}}') => ({
  'role.md': 'role\n',
  'contract.json': `{"type":"object","properties":${props}}`,
  'machine.yaml': 'agent: sim\n',
});

function factory(lineYaml: string, machines: Record<string, ReturnType<typeof machine>>) {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-build-')), 'f');
  const files: Record<string, string> = {
    'factory.yaml': 'name: T\n',
    'sectors/s/sector.yaml': 'name: S\n',
    'sectors/s/lines.yaml': 'lines:\n  - { id: a, name: A, model: m }\n  - { id: b, name: B, model: m }\n',
    'sectors/s/models/m/line.yaml': lineYaml,
  };
  for (const [n, f] of Object.entries(machines)) for (const [k, v] of Object.entries(f)) files[`sectors/s/models/m/machines/${n}/${k}`] = v;
  for (const [rel, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), c); }
  return root;
}

const LINE = `# Summary: build -> check
intake: { kind: manual }
pieces:
  # the builder
  - id: build
    machine: build
  - id: check
    machine: check
pallet:
  needs: [check]
`;

const lineOf = (d: Draft) => d.read(path.join(d.root, 'sectors/s/models/m/line.yaml'));
const issues = (d: Draft) => checkFactory(d.load()).map((i) => i.message);

describe('build-mode edits', () => {
  it('starts clean on a valid factory and on the demo', () => {
    expect(issues(new Draft(factory(LINE, { build: machine(), check: machine() })))).toEqual([]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-build-demo-'));
    expect(issues(new Draft(createDemoFactory(path.join(dir, 'f'), path.join(dir, 'repos'))))).toEqual([]);
  });

  it('inserts a machine on an implicit belt with a minimal diff that keeps comments', () => {
    const d = new Draft(factory(LINE, { build: machine(), check: machine() }));
    apply(d, { op: 'insert', lineId: 's/a', at: { from: 'build', to: 'check' }, kind: 'machine', id: 'lint' });
    expect(lineOf(d)).toBe(LINE.replace('  - id: check\n', '  - id: lint\n    machine: lint\n  - id: check\n'));
    expect(d.changes().map((c) => `${c.status} ${c.path}`)).toEqual([
      'changed sectors/s/models/m/line.yaml',
      'added sectors/s/models/m/machines/lint/contract.json',
      'added sectors/s/models/m/machines/lint/machine.yaml',
      'added sectors/s/models/m/machines/lint/role.md',
    ]);
    const m = d.load().sectors[0].lines[0].model;
    expect(m.pieces.find((p) => p.id === 'check')!.needs).toEqual([{ from: 'lint' }]);
    expect(issues(d)).toEqual([]);
  });

  it('moves a belt rule onto the belt into the inserted piece', () => {
    const d = new Draft(factory(LINE, { build: machine(), check: machine() }));
    apply(d, { op: 'setRule', lineId: 's/a', from: 'check', to: '@pallet', when: "verdict == 'pass'" });
    apply(d, { op: 'connect', lineId: 's/a', from: 'check', to: 'build', when: "verdict == 'fail'" });
    expect(issues(d)).toEqual([]);
    apply(d, { op: 'insert', lineId: 's/a', at: { from: 'check', to: '@pallet' }, kind: 'gate', id: 'ship' });
    const p = d.load().sectors[0].lines[0].model.pieces;
    expect(p.find((x) => x.id === 'ship')!.needs).toEqual([{ from: 'check', when: "verdict == 'pass'" }]);
    expect(p.find((x) => x.id === '@pallet')!.needs).toEqual([{ from: 'ship' }]);
  });

  it('leaves a removed piece\'s belts open, then a connection closes them', () => {
    const d = new Draft(factory(LINE, { build: machine(), check: machine() }));
    apply(d, { op: 'remove', lineId: 's/a', pieceId: 'build' });
    expect(d.changes().filter((c) => c.status === 'removed').map((c) => c.path)).toEqual(['contract.json', 'machine.yaml', 'role.md'].map((f) => `sectors/s/models/m/machines/build/${f}`));
    expect(issues(d)).toEqual(['"Intake" has no belt out.', '"Check" has no input belt.']);
    apply(d, { op: 'connect', lineId: 's/a', from: '@intake', to: 'check' });
    expect(issues(d)).toEqual([]);
  });

  it('turns a connection to an earlier piece into a return belt, and checks the rule against the contract', () => {
    const d = new Draft(factory(LINE, { build: machine(), check: machine() }));
    apply(d, { op: 'connect', lineId: 's/a', from: 'check', to: 'build' });
    expect(issues(d)).toEqual(['the return belt from "check" needs a "when" rule']);
    apply(d, { op: 'setRule', lineId: 's/a', from: 'check', to: 'build', back: true, when: "verdict == 'fail'" });
    const build = d.load().sectors[0].lines[0].model.pieces.find((p) => p.id === 'build')!;
    expect(build.needs).toEqual([{ from: '@intake' }, { from: 'check', when: "verdict == 'fail'", back: true, laps: 3 }]);
    apply(d, { op: 'setRule', lineId: 's/a', from: 'check', to: 'build', back: true, when: "verdict == 'oops'", laps: 2 });
    expect(issues(d)).toEqual(['The belt from "Check" to "Build" compares "verdict" to "oops", which is not one of pass, fail.']);
    apply(d, { op: 'disconnect', lineId: 's/a', from: 'check', to: 'build', back: true });
    expect(issues(d)).toEqual([]);
  });

  it('flags a routed value with no belt, and a rule reading a field the box lacks', () => {
    const d = new Draft(factory(LINE, { build: machine(), check: machine() }));
    apply(d, { op: 'insert', lineId: 's/a', at: { from: 'check', to: '@pallet' }, kind: 'gate', id: 'pick' });
    apply(d, { op: 'setPiece', lineId: 's/a', pieceId: 'pick', gate: { kind: 'choices', choices: ['ship', 'hold'] } });
    apply(d, { op: 'setRule', lineId: 's/a', from: 'pick', to: '@pallet', when: "decision.choice == 'ship'" });
    expect(issues(d)).toEqual(['"Pick" can send decision.choice = hold, but no belt takes it.']);
    apply(d, { op: 'setRule', lineId: 's/a', from: 'pick', to: '@pallet', when: "score > 3" });
    expect(issues(d)[0]).toMatch(/reads "score", which "Pick" does not send/);
  });

  it('adds a new path that is open until it reaches the pallet', () => {
    const d = new Draft(factory(LINE, { build: machine(), check: machine() }));
    apply(d, { op: 'insert', lineId: 's/a', at: { from: 'build' }, kind: 'signal', id: 'smoke' });
    expect(d.load().sectors[0].lines[0].model.pieces.find((p) => p.id === 'check')!.needs).toEqual([{ from: 'build' }]);
    expect(issues(d)).toEqual(['"Smoke" has no belt out.']);
    apply(d, { op: 'connect', lineId: 's/a', from: 'smoke', to: '@pallet' });
    expect(issues(d)).toEqual([]);
  });

  it('creates a sector and a line from scratch, and separates a model', () => {
    const d = new Draft(factory(LINE, { build: machine(), check: machine() }));
    apply(d, { op: 'newSector', id: 'ops', name: 'Ops', color: '#4ab0a0' });
    apply(d, { op: 'newLine', sectorId: 'ops', id: 'deploy', name: 'Deploy', model: 'deploy', newModel: true });
    let f = d.load();
    expect(f.sectors.map((s) => s.id)).toEqual(['ops', 's']);
    expect(f.sectors[0].lines[0].model.pieces.map((p) => p.id)).toEqual(['@intake', '@pallet']);
    apply(d, { op: 'insert', lineId: 'ops/deploy', at: { from: '@intake', to: '@pallet' }, kind: 'machine', id: 'deployer' });
    expect(issues(d)).toEqual([]);
    apply(d, { op: 'separateModel', lineId: 's/b', model: 'm-b' });
    f = d.load();
    expect(f.sectors[1].lines.map((l) => path.basename(l.model.dir))).toEqual(['m', 'm-b']);
    expect(() => apply(d, { op: 'removeModel', sectorId: 's', model: 'm-b' })).toThrow(/still used by B/);
    apply(d, { op: 'removeLine', lineId: 's/b' });
    apply(d, { op: 'removeModel', sectorId: 's', model: 'm-b' });
    expect(d.changes().some((c) => c.path.includes('m-b'))).toBe(false);
  });

  it('keeps sector policy within the ceiling and never lets release or apply be automatic', () => {
    const d = new Draft(factory(LINE, { build: machine(), check: machine() }));
    apply(d, { op: 'setFactory', ceiling: { retry: { auto: 1 } } });
    apply(d, { op: 'setSector', sectorId: 's', policy: { retry: { auto: 2 }, release: { auto: 1 } } });
    expect(issues(d)).toEqual(['S: retry 2 on its own is above the factory ceiling (1).', 'S: managers can never release on their own.']);
  });

  it('writes the denials of a machine, a line, a sector and the factory, and removes the key when the list is emptied', () => {
    const root = factory(LINE, { build: machine(), check: machine() });
    const d = new Draft(root);
    const read = (rel: string) => d.read(path.join(root, rel));
    apply(d, { op: 'setMachine', lineId: 's/a', pieceId: 'build', conf: { deny: ['rm -rf'], read_only: true } });
    apply(d, { op: 'setModel', lineId: 's/a', deny: ['make clean'] });
    apply(d, { op: 'setSector', sectorId: 's', deny: ['gh pr merge'] });
    apply(d, { op: 'setFactory', deny: ['sudo'] });
    expect(read('sectors/s/models/m/machines/build/machine.yaml')).toContain('deny: [rm -rf]\nread_only: true');
    expect(lineOf(d)).toContain('deny: [make clean]');
    expect(read('sectors/s/sector.yaml')).toContain('deny: [gh pr merge]');
    expect(read('factory.yaml')).toContain('deny: [sudo]');
    const f = d.load();
    expect(f.deny).toEqual(['sudo']);
    expect(f.sectors[0].deny).toEqual(['gh pr merge']);
    expect(f.sectors[0].lines[0].model).toMatchObject({ deny: ['make clean'] });
    expect(f.sectors[0].lines[0].model.machines.build).toMatchObject({ deny: ['rm -rf'], readOnly: true });
    apply(d, { op: 'setMachine', lineId: 's/a', pieceId: 'build', conf: { deny: [], read_only: false } });
    apply(d, { op: 'setFactory', deny: [] });
    expect(read('sectors/s/models/m/machines/build/machine.yaml')).toBe('agent: sim\n');
    expect(read('factory.yaml')).toBe('name: T\n');
  });

  it('writing back what the disk holds drops the change', () => {
    const root = factory(LINE, { build: machine(), check: machine() });
    const d = new Draft(root);
    const file = path.join(root, 'sectors/s/models/m/machines/build/role.md');
    apply(d, { op: 'writeFile', path: 'sectors/s/models/m/machines/build/role.md', content: 'new\n' });
    expect(d.changes()).toHaveLength(1);
    apply(d, { op: 'writeFile', path: path.relative(root, file), content: 'role\n' });
    expect(d.changes()).toEqual([]);
  });

  it('never replaces or shadows a machine of the same name, and keeps ids to plain folder names', () => {
    const root = factory(LINE, { build: machine(), check: machine() });
    fs.mkdirSync(path.join(root, 'shared/machines/review'), { recursive: true });
    fs.writeFileSync(path.join(root, 'shared/machines/review/role.md'), 'shared\n');
    const d = new Draft(root);
    expect(() => apply(d, { op: 'insert', lineId: 's/a', at: { from: 'build', to: 'check' }, kind: 'machine', id: 'check' })).toThrow(/already has a piece/);
    expect(() => apply(d, { op: 'insert', lineId: 's/a', at: { from: 'build', to: 'check' }, kind: 'machine', id: 'review' })).toThrow(/already exists/);
    expect(() => apply(d, { op: 'removeSector', sectorId: '../.git' })).toThrow(/lowercase/);
    expect(() => apply(d, { op: 'removeModel', sectorId: 's', model: '../../../.git' })).toThrow(/lowercase/);
    expect(() => apply(d, { op: 'writeFile', path: '.git/config', content: 'x' })).toThrow(/not part of the factory/);
    expect(() => apply(d, { op: 'writeFile', path: 'sectors/s', content: 'x' })).toThrow(/is a folder/);
  });

  it('does not count a negated comparison as routing only the values it names', () => {
    const d = new Draft(factory(LINE, { build: machine('{"verdict":{"type":"string","enum":["pass","fail","skip"]}}'), check: machine() }));
    apply(d, { op: 'setRule', lineId: 's/a', from: 'build', to: 'check', when: "verdict == 'pass'" });
    apply(d, { op: 'connect', lineId: 's/a', from: 'build', to: '@pallet', when: "!(verdict == 'pass')" });
    expect(issues(d)).toEqual([]);
  });

  it('keeps brackets inside a label as written', () => {
    const d = new Draft(factory(LINE, { build: machine(), check: machine() }));
    apply(d, { op: 'setPiece', lineId: 's/a', pieceId: 'check', label: 'CI [ not ] green' });
    expect(d.load().sectors[0].lines[0].model.pieces.find((p) => p.id === 'check')!.label).toBe('CI [ not ] green');
  });

  it('keeps a change that only makes a script executable', () => {
    const root = factory(LINE, { build: machine(), check: machine() });
    fs.writeFileSync(path.join(root, 'go.sh'), 'exit 0\n');
    const d = new Draft(root);
    apply(d, { op: 'writeFile', path: 'go.sh', content: 'exit 0\n', executable: true });
    expect(d.changes()).toEqual([{ path: 'go.sh', status: 'changed' }]);
  });

  it('sets and clears a signal timeout without losing its command, and lets a return belt read why a signal failed', () => {
    const SIG = `intake: { kind: manual }
pieces:
  - id: build
    machine: build
  - id: lint
    signal: { run: "make lint" }
pallet:
  needs: [lint]
`;
    const d = new Draft(factory(SIG, { build: machine(), check: machine() }));
    apply(d, { op: 'setPiece', lineId: 's/a', pieceId: 'lint', timeout: '40m' });
    expect(lineOf(d)).toContain('signal: { run: "make lint", timeout: 40m }');
    apply(d, { op: 'setPiece', lineId: 's/a', pieceId: 'lint', run: 'make check' });
    expect(lineOf(d)).toContain('signal: { run: "make check", timeout: 40m }');
    expect(() => apply(d, { op: 'setPiece', lineId: 's/a', pieceId: 'lint', timeout: 'soon' })).toThrow(/not a duration/);
    apply(d, { op: 'setPiece', lineId: 's/a', pieceId: 'lint', timeout: '' });
    expect(lineOf(d)).toContain('signal: { run: "make check" }');
    apply(d, { op: 'connect', lineId: 's/a', from: 'lint', to: 'build', when: "signal == 'fail'" });
    expect(issues(d)).toEqual([]);
    apply(d, { op: 'setRule', lineId: 's/a', from: 'lint', to: 'build', back: true, when: "signal == 'red'" });
    expect(issues(d)).toEqual(['The belt from "Lint" to "Build" compares "signal" to "red", which is not one of fail.']);
    apply(d, { op: 'setRule', lineId: 's/a', from: 'lint', to: 'build', back: true, when: "signal == 'fail'" });
    apply(d, { op: 'setRule', lineId: 's/a', from: 'lint', to: '@pallet', when: "signal == 'fail'" });
    expect(issues(d)).toEqual(['The belt from "Lint" to "Pallet" reads "signal", which "Lint" does not send.']);
  });
});
