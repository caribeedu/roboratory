import { columnsAndLanes, layoutSector, pointAt, COL, WALL_TOP } from './layout';
import type { PieceDef } from './types';

const P = (id: string, kind: PieceDef['kind'], needs: string[] | { from: string; when?: string }[] = []): PieceDef => ({
  id, kind, label: id, needs: needs.map((n) => (typeof n === 'string' ? { from: n } : n)),
});

const split: PieceDef[] = [
  P('@intake', 'intake'),
  P('triage', 'machine', ['@intake']),
  P('plan', 'machine', [{ from: 'triage', when: "type == 'bug'" }]),
  P('answer', 'machine', [{ from: 'triage', when: "type == 'question'" }]),
  P('join', 'gate', ['plan', 'answer']),
  P('@pallet', 'pallet', ['join']),
];

describe('layout', () => {
  it('places pieces by longest path and spreads branches into lanes', () => {
    const { col, lane } = columnsAndLanes(split);
    expect(col).toEqual({ '@intake': 0, triage: 1, plan: 2, answer: 2, join: 3, '@pallet': 4 });
    expect(lane.plan).toBe(-0.5);
    expect(lane.answer).toBe(0.5);
    expect(lane.join).toBe(0);
  });

  it('rejects loops', () => {
    expect(() => columnsAndLanes([P('a', 'machine', ['b']), P('b', 'machine', ['a'])])).toThrow(/loop/);
  });

  it('mirrors left-growing lines inside the same room', () => {
    const line = [P('@intake', 'intake'), P('m', 'machine', ['@intake']), P('@pallet', 'pallet', ['m'])];
    const s = layoutSector([
      { id: 'r', direction: 'right', pieces: line },
      { id: 'l', direction: 'left', pieces: line },
    ]);
    const r = s.lines[0].nodes, l = s.lines[1].nodes;
    expect(r['@intake'].x).toBeLessThan(r['@pallet'].x);
    expect(l['@intake'].x).toBeGreaterThan(l['@pallet'].x);
    expect(r['@intake'].x).toBe(l['@pallet'].x);
    expect(s.lines[1].top).toBeGreaterThan(s.lines[0].bottom);
  });

  it('places one manager per sector, by the back wall in the left corner, clear of every line', () => {
    const line = [P('@intake', 'intake'), P('m', 'machine', ['@intake']), P('@pallet', 'pallet', ['m'])];
    const s = layoutSector([
      { id: 'a', direction: 'right', pieces: line },
      { id: 'b', direction: 'left', pieces: line },
    ]);
    expect(s.manager.x).toBeLessThan(Math.min(...s.lines.flatMap((l) => Object.values(l.nodes).map((n) => n.x - n.hw))));
    expect(s.manager.y).toBeGreaterThan(WALL_TOP);
    expect(s.manager.y).toBeLessThan(s.lines[0].top);
  });

  it('grows the room with the longest line', () => {
    const short = layoutSector([{ id: 'a', direction: 'right', pieces: [P('@intake', 'intake'), P('@pallet', 'pallet', ['@intake'])] }]);
    const long = layoutSector([{ id: 'a', direction: 'right', pieces: split }]);
    expect(long.width - short.width).toBe(3 * COL);
  });

  it('walks along belts', () => {
    expect(pointAt([[0, 0], [10, 0], [10, 10]], 15)).toEqual([10, 5]);
    expect(pointAt([[0, 0], [10, 0]], 99)).toEqual([10, 0]);
  });

  it('keeps return belts out of the column order and routes them under the line', () => {
    const rework: PieceDef[] = [
      P('@intake', 'intake'),
      P('dev', 'machine', [{ from: '@intake' }, { from: 'qa', when: "verdict == 'fail'" }]),
      P('qa', 'machine', ['dev']),
      P('@pallet', 'pallet', ['qa']),
    ];
    rework[1].needs[1].back = true;
    const { col } = columnsAndLanes(rework);
    expect(col).toEqual({ '@intake': 0, dev: 1, qa: 2, '@pallet': 3 });
    const s = layoutSector([{ id: 'r', direction: 'right', pieces: rework }]);
    const back = s.lines[0].edges.find((e) => e.back)!;
    expect(back.points[1][1]).toBeGreaterThan(s.lines[0].nodes.dev.y);
    expect(back.points[0][0]).toBeGreaterThan(back.points[3][0]);
  });

  it('draws a piece with no input below the line instead of on top of the intake', () => {
    const s = layoutSector([{ id: 'a', direction: 'right', pieces: [P('@intake', 'intake'), P('m', 'machine', []), P('@pallet', 'pallet', ['m'])] }]);
    const n = s.lines[0].nodes;
    expect(n.m.x).toBeGreaterThan(n['@intake'].x);
    expect(n.m.y).toBeGreaterThan(n['@intake'].y);
  });
});
