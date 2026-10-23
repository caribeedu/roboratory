// Lays out a sector's lines on the floor. Lines are never placed by hand:
// columns come from the longest path from the intake, lanes spread branches,
// and a left-growing line is mirrored inside the room.
import type { Direction, PieceDef, PieceKind } from './types';

export const TILE = 16;
export const COL = 7 * TILE; // distance between columns
export const LANE = 5 * TILE; // distance between branch lanes
export const WALL_TOP = 6 * TILE; // back wall height drawn above the floor
export const ROOM_PAD_X = 5 * TILE; // room padding left/right (manager stands here)
export const LINE_PAD_Y = 3 * TILE; // vertical padding inside a line band
export const LINE_GAP = 2 * TILE;

export const HALF_WIDTH: Record<PieceKind, number> = { intake: 18, machine: 24, signal: 10, gate: 16, pallet: 18 };

export interface NodePos { id: string; kind: PieceKind; col: number; lane: number; x: number; y: number; hw: number }
export interface EdgePos { from: string; to: string; when?: string; back?: boolean; laps?: number; points: [number, number][]; len: number }
export interface LineLayout {
  id: string;
  direction: Direction;
  top: number; bottom: number;
  nodes: Record<string, NodePos>;
  edges: EdgePos[];
}
/** The sector's one manager stands by the back wall, in the room's left corner. */
export interface ManagerPos { x: number; y: number; flip: boolean }
export interface SectorLayout { width: number; height: number; lines: LineLayout[]; manager: ManagerPos }

interface LineInput { id: string; direction: Direction; pieces: PieceDef[] }

export function columnsAndLanes(pieces: PieceDef[]): { col: Record<string, number>; lane: Record<string, number> } {
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const col: Record<string, number> = {};
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    if (col[id] !== undefined) return col[id];
    if (visiting.has(id)) throw new Error(`Belts form a loop at "${id}"`);
    visiting.add(id);
    const p = byId.get(id);
    if (!p) throw new Error(`Unknown piece "${id}"`);
    const fwd = p.needs.filter((n) => !n.back);
    // a piece with no input yet (build mode) stands one column after the intake
    col[id] = fwd.length ? 1 + Math.max(...fwd.map((n) => depth(n.from))) : p.kind === 'intake' ? 0 : 1;
    visiting.delete(id);
    return col[id];
  };
  pieces.forEach((p) => depth(p.id));
  const kids: Record<string, string[]> = {};
  for (const p of pieces) for (const n of p.needs) if (!n.back) (kids[n.from] ||= []).push(p.id);
  const lane: Record<string, number> = {};
  const ordered = [...pieces].sort((a, b) => col[a.id] - col[b.id]);
  const orphans = ordered.filter((p) => p.kind !== 'intake' && !p.needs.some((n) => !n.back));
  for (const p of ordered) {
    const fwd = p.needs.filter((n) => !n.back);
    if (!fwd.length) lane[p.id] = 0;
    else if (fwd.length > 1) lane[p.id] = fwd.reduce((s, n) => s + lane[n.from], 0) / fwd.length;
    else {
      const parent = fwd[0].from;
      const k = kids[parent];
      lane[p.id] = k.length === 1 ? lane[parent] : lane[parent] + (k.indexOf(p.id) - (k.length - 1) / 2);
    }
  }
  // pieces with no input get their own lanes below the line, and so does what they feed
  if (orphans.length) {
    const below = Math.max(...pieces.filter((p) => !orphans.includes(p)).map((p) => lane[p.id] ?? 0)) + 1;
    orphans.forEach((o, i) => {
      const shift = below + i - lane[o.id];
      const stack = [o.id]; const seen = new Set<string>();
      while (stack.length) { const id = stack.pop()!; if (seen.has(id)) continue; seen.add(id); if (id !== '@pallet') lane[id] += shift; for (const k of kids[id] ?? []) if (!pieces.find((q) => q.id === k)!.needs.some((n) => !n.back && !seen.has(n.from) && n.from !== id)) stack.push(k); }
    });
  }
  return { col, lane };
}

export function layoutSector(lines: LineInput[]): SectorLayout {
  const prepared = lines.map((l) => {
    const { col, lane } = columnsAndLanes(l.pieces);
    const lanes = Object.values(lane);
    return { l, col, lane, minL: Math.min(...lanes), maxL: Math.max(...lanes), maxC: Math.max(...Object.values(col)) };
  });
  const maxCols = Math.max(1, ...prepared.map((p) => p.maxC + 1));
  const width = ROOM_PAD_X * 2 + maxCols * COL;
  let y = WALL_TOP + LINE_PAD_Y;
  const out: LineLayout[] = [];
  for (const { l, col, lane, minL, maxL, maxC } of prepared) {
    const top = y;
    const nodes: Record<string, NodePos> = {};
    for (const p of l.pieces) {
      const c = l.direction === 'right' ? col[p.id] : maxCols - 1 - col[p.id];
      const startOffset = l.direction === 'right' ? 0 : 0;
      nodes[p.id] = {
        id: p.id, kind: p.kind, col: col[p.id], lane: lane[p.id], hw: HALF_WIDTH[p.kind],
        x: ROOM_PAD_X + startOffset + c * COL + COL / 2,
        y: top + LINE_PAD_Y + (lane[p.id] - minL) * LANE,
      };
    }
    void maxC;
    const dir = l.direction === 'right' ? 1 : -1;
    const edges: EdgePos[] = [];
    const hasBack = l.pieces.some((p) => p.needs.some((n) => n.back));
    const backY = top + LINE_PAD_Y * 2 + (maxL - minL) * LANE - TILE;
    for (const p of l.pieces) for (const n of p.needs) {
      const a = nodes[n.from], b = nodes[p.id];
      if (n.back) {
        // return belts run under the line, the other way
        const points: [number, number][] = [[a.x, a.y + 8], [a.x, backY], [b.x, backY], [b.x, b.y + 8]];
        edges.push({ from: n.from, to: p.id, when: n.when, back: true, laps: n.laps, points, len: Math.abs(backY - a.y - 8) * 2 + Math.abs(a.x - b.x) });
        continue;
      }
      const sx = a.x + dir * a.hw, ex = b.x - dir * b.hw;
      let points: [number, number][];
      if (a.y === b.y) points = [[sx, a.y], [ex, b.y]];
      else {
        const mx = p.needs.length > 1 ? ex - dir * TILE : sx + dir * TILE;
        points = [[sx, a.y], [mx, a.y], [mx, b.y], [ex, b.y]];
      }
      let len = 0;
      for (let i = 1; i < points.length; i++) len += Math.abs(points[i][0] - points[i - 1][0]) + Math.abs(points[i][1] - points[i - 1][1]);
      edges.push({ from: n.from, to: p.id, when: n.when, points, len });
    }
    const bandH = LINE_PAD_Y * 2 + (maxL - minL) * LANE + (hasBack ? TILE * 1.5 : 0);
    out.push({ id: l.id, direction: l.direction, top, bottom: top + bandH, nodes, edges });
    y = top + bandH + LINE_GAP;
  }
  const height = Math.max(y + LINE_PAD_Y, WALL_TOP + 8 * TILE);
  const manager: ManagerPos = { x: ROOM_PAD_X / 2, y: WALL_TOP + 14, flip: false };
  return { width, height, lines: out, manager };
}

/** Point at distance `t` along a belt polyline. */
export function pointAt(points: [number, number][], t: number): [number, number] {
  let left = t;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    const seg = Math.abs(x1 - x0) + Math.abs(y1 - y0);
    if (left <= seg) { const f = seg ? left / seg : 0; return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]; }
    left -= seg;
  }
  return points[points.length - 1];
}
