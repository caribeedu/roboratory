import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDemoFactory } from './demo';
import { loadFactory, usage } from './factory';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'roboratory-'));

describe('factory loader', () => {
  it('loads the demo factory: sectors, shared model copies, machines and policy', () => {
    const dir = tmp();
    const root = createDemoFactory(path.join(dir, 'factory'), path.join(dir, 'repos'));
    const f = loadFactory(root);
    expect(f.warnings).toEqual([]);
    expect(f.name).toBe('Demo Factory');
    expect(f.sectors.map((s) => s.id)).toEqual(['engineering', 'incidents', 'releases']);
    const eng = f.sectors[0];
    expect(eng.lines.map((l) => l.id)).toEqual(['engineering/orders-api', 'engineering/storefront-ui']);
    // two copies share one model object loaded from shared/
    expect(eng.lines[0].model).toBe(eng.lines[1].model);
    expect(eng.lines[0].model.shared).toBe(true);
    expect(eng.lines[0].repo).toBe(path.join(dir, 'repos', 'orders-api'));
    const pieces = eng.lines[0].model.pieces;
    expect(pieces[0].id).toBe('@intake');
    expect(pieces.at(-1)).toMatchObject({ id: '@pallet', needs: [{ from: 'pr-check' }, { from: 'respond' }] });
    expect(pieces.find((p) => p.id === 'plan')!.needs).toEqual([{ from: 'triage', when: "type == 'bug'" }]);
    // needs default to the previous piece
    expect(pieces.find((p) => p.id === 'implement')!.needs).toEqual([{ from: 'plan' }]);
    expect(eng.lines[0].model.machines.triager.shared).toBe(true);
    expect(eng.policy).toEqual({ retry: { auto: 1 } });
    expect(f.ceiling.retry).toEqual({ auto: 2 });
    const rel = f.sectors[2].lines[0];
    expect(rel.direction).toBe('left');
    expect(rel.model.pieces.find((p) => p.id === 'launch')).toMatchObject({ kind: 'gate', confirmations: 2 });
    const u = usage(f).get(eng.lines[0].model.dir)!;
    expect(u.lines).toBe(2);
    expect(u.sectors.size).toBe(1);
  });

  it('reports a broken line as a warning and keeps loading the rest', () => {
    const dir = tmp();
    const root = createDemoFactory(path.join(dir, 'factory'), path.join(dir, 'repos'));
    fs.appendFileSync(path.join(root, 'sectors/releases/lines.yaml'), '  - id: ghost\n    model: nope\n');
    const f = loadFactory(root);
    expect(f.warnings.join('\n')).toMatch(/line "ghost": model "nope" not found/);
    expect(f.sectors[2].lines).toHaveLength(1);
  });

  it('rejects unknown needs and bad rules with the piece named', () => {
    const dir = tmp();
    const root = createDemoFactory(path.join(dir, 'factory'), path.join(dir, 'repos'));
    const file = path.join(root, 'sectors/incidents/models/triage-to-mitigation/line.yaml');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('confidence >= 0.7', 'confidence >='));
    const f = loadFactory(root);
    expect(f.warnings.join('\n')).toMatch(/incidents.*orders-api/);
  });

  it('composes a machine role from shared role files and reads dirs, effort and culture', () => {
    const dir = tmp();
    const root = createDemoFactory(path.join(dir, 'factory'), path.join(dir, 'repos'));
    fs.mkdirSync(path.join(root, 'shared/roles'), { recursive: true });
    fs.writeFileSync(path.join(root, 'shared/roles/lead.md'), 'Lead guidance.');
    fs.writeFileSync(path.join(root, 'culture.md'), 'Factory culture.');
    fs.writeFileSync(path.join(root, 'sectors/incidents/culture.md'), 'Incident culture.');
    fs.appendFileSync(path.join(root, 'sectors/incidents/models/triage-to-mitigation/machines/correlator/machine.yaml'), 'roles: [shared/roles/lead.md]\ndirs: ["~/repos"]\neffort: high\n');
    const f = loadFactory(root);
    expect(f.warnings).toEqual([]);
    const m = f.sectors[1].lines[0].model.machines.correlator;
    expect(m.role.startsWith('Lead guidance.')).toBe(true);
    expect(m.role).toContain('You correlate an alert');
    expect(m.dirs).toEqual([path.join(os.homedir(), 'repos')]);
    expect(m.effort).toBe('high');
    expect(f.culture).toBe('Factory culture.');
    expect(f.sectors[1].culture).toBe('Incident culture.');
  });

  it('rejects a return belt without a rule', () => {
    const dir = tmp();
    const root = createDemoFactory(path.join(dir, 'factory'), path.join(dir, 'repos'));
    const file = path.join(root, 'sectors/incidents/models/triage-to-mitigation/line.yaml');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('  - id: investigate\n    machine: investigator\n', '  - id: investigate\n    machine: investigator\n    needs: [correlate, { from: mitigate, back: true }]\n'));
    expect(loadFactory(root).warnings.join('\n')).toMatch(/return belt from "mitigate" needs a "when" rule/);
  });
});
