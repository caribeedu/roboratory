// How the pieces of a factory behave, worked out from the runs' files (D47). A piece is a machine in a line, and its version is what
// the agent is given (version.ts), so a changed role is a new row and not a blur in an average. The calculation is one function of the
// factory and the events of its runs; the command, the Metrics tab and a piece's history line all show what it returns.
import type { FactoryDef, LineDef, LineStats, PieceStats, RunSummary, Stats, StatsFilter, Tokens, VersionRow } from '../shared/types';
import { pieceVersion } from './version';

type Event = Record<string, any>;
export interface RunEvents { summary: RunSummary; events: Event[] }

/** What happened to one piece in one run, in one version. */
interface Visit {
  version: string;
  firstStart: number;
  attempts: number;
  durationMs: number;
  cost: number;
  tokens: Tokens;
  models: Set<string>;
  reworks: number; questions: number; blocks: number; fires: number;
  passes: number; provedWrong: number;
  requests: number; repeated: number; denied: number; waits: number[];
}

const zero = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const add = (a: Tokens, b?: Partial<Tokens>) => { a.input += b?.input ?? 0; a.output += b?.output ?? 0; a.cacheRead += b?.cacheRead ?? 0; a.cacheWrite += b?.cacheWrite ?? 0; };
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** The pieces that return work (D15): a piece with a return belt leaving it. */
export const checkersOf = (line: LineDef) => new Set(line.model.pieces.flatMap((p) => p.needs.filter((n) => n.back).map((n) => n.from)));

/** Every piece reachable from `id` along forward belts. */
function downstream(line: LineDef, id: string): Set<string> {
  const out = new Set<string>(); const stack = [id];
  while (stack.length) { const at = stack.pop()!; for (const p of line.model.pieces) if (p.needs.some((n) => n.from === at && !n.back) && !out.has(p.id)) { out.add(p.id); stack.push(p.id); } }
  return out;
}

/** Reads one run: a visit for each machine piece that started in it. */
function visitsOf(line: LineDef, events: Event[]): Map<string, Visit> {
  const checkers = checkersOf(line);
  const visits = new Map<string, Visit>();
  const version = new Map<string, string>(); // the version each piece last started in
  const open = new Map<string, number>(); // when its current span of work began
  const lastSeen = new Map<string, number>(); // the last thing recorded about a piece
  const allowed = new Set<string>(); // commands allowed so far in the run
  const at = (piece: string) => { const v = version.get(piece); return v ? visits.get(`${piece}@${v}`) : undefined; };

  events.forEach((e, i) => {
    if (e.piece && e.type !== 'piece.start') lastSeen.set(e.piece, e.t);
    switch (e.type) {
      case 'piece.start': {
        if (!e.version) break; // a signal, which has no version
        // a first attempt while a span is open: the engine closed in between and the step was started again, so the span ends where the record does
        const t0 = open.get(e.piece);
        if (t0 !== undefined && (e.attempt ?? 1) <= 1) {
          const gone = at(e.piece);
          if (gone) gone.durationMs += Math.max(0, (lastSeen.get(e.piece) ?? t0) - t0);
          open.delete(e.piece);
        }
        version.set(e.piece, e.version);
        const key = `${e.piece}@${e.version}`;
        let v = visits.get(key);
        if (!v) { v = { version: e.version, firstStart: e.t, attempts: 0, durationMs: 0, cost: 0, tokens: zero(), models: new Set(), reworks: 0, questions: 0, blocks: 0, fires: 0, passes: 0, provedWrong: 0, requests: 0, repeated: 0, denied: 0, waits: [] }; visits.set(key, v); }
        v.attempts++;
        if (!open.has(e.piece)) open.set(e.piece, e.t);
        break;
      }
      case 'piece.done': case 'piece.fire': case 'piece.ask': case 'piece.blocked': {
        const v = at(e.piece);
        const t0 = open.get(e.piece);
        if (v && t0 !== undefined) v.durationMs += Math.max(0, e.t - t0);
        open.delete(e.piece);
        if (!v) break;
        if (e.type === 'piece.fire') v.fires++;
        if (e.type === 'piece.ask') v.questions++;
        if (e.type === 'piece.blocked') v.blocks++;
        if (e.type === 'piece.done' && checkers.has(e.piece) && !e.failed) {
          // a pass: no return belt was taken when it finished
          let sentBack = false;
          for (let j = i + 1; j < events.length && events[j].type !== 'piece.done'; j++) if (events[j].type === 'edge' && events[j].from === e.piece && events[j].back && events[j].taken) sentBack = true;
          if (!sentBack) {
            v.passes++;
            const after = downstream(line, e.piece);
            const wrong = events.slice(i + 1).some((x) =>
              (x.type === 'rework' && x.from !== e.piece && Array.isArray(x.reopened) && x.reopened.includes(e.piece))
              || ((x.type === 'piece.ask' || x.type === 'piece.blocked' || x.type === 'piece.fire') && after.has(x.piece)));
            if (wrong) v.provedWrong++;
          }
        }
        break;
      }
      case 'cost': {
        const v = at(e.piece);
        if (!v) break;
        v.cost += e.usd ?? 0; add(v.tokens, e.tokens); if (e.model) v.models.add(e.model);
        break;
      }
      case 'rework': { const v = at(e.to); if (v) v.reworks++; break; }
      case 'permission.request': { const v = at(e.piece); if (v) v.requests++; break; }
      case 'permission.denied': { const v = at(e.piece); if (v) v.denied++; break; }
      case 'permission.decision': { const v = at(e.piece); if (v) { v.waits.push(e.waitedMs ?? 0); if (e.decision === 'deny') v.denied++; } break; }
      case 'verb': {
        if (e.verb !== 'allow' || !e.command) break;
        const v = at(e.piece);
        if (v && allowed.has(e.command)) v.repeated++;
        allowed.add(e.command);
        break;
      }
    }
  });
  return visits;
}

/**
 * The metrics of the factory's lines. A row is a piece in a line in one version, over the runs of that version that the filter keeps;
 * the current version of a piece is the one `pieceVersion` gives for the factory as it is now, so a piece with no runs of it shows only
 * the versions before. Runs of a line that is no longer in the factory are left out.
 */
export function computeStats(f: FactoryDef, runs: RunEvents[], filter: StatsFilter = {}): Stats {
  const lines: LineStats[] = [];
  for (const sector of f.sectors) {
    if (filter.sectorId && sector.id !== filter.sectorId) continue;
    for (const line of sector.lines) {
      if (filter.lineId && line.id !== filter.lineId) continue;
      const kept = runs.filter((r) => r.summary.lineId === line.id && (!filter.runId || r.summary.id === filter.runId) && (!filter.since || r.summary.startedAt >= filter.since));
      const byKey = new Map<string, Visit[]>();
      for (const r of kept) for (const [key, v] of visitsOf(line, r.events)) { const arr = byKey.get(key) ?? []; arr.push(v); byKey.set(key, arr); }
      const checkers = checkersOf(line);
      const pieces: PieceStats[] = [];
      const everything: VersionRow[] = []; // every version, whatever is shown: the line's cost is that of its runs
      for (const p of line.model.pieces) {
        if (!p.machine) continue;
        const current = pieceVersion(f, line, p.id)!;
        const rows: VersionRow[] = [];
        for (const [key, visits] of byKey) {
          if (!key.startsWith(`${p.id}@`)) continue;
          const version = key.slice(p.id.length + 1);
          const tokens = zero(); visits.forEach((v) => add(tokens, v.tokens));
          const waits = visits.flatMap((v) => v.waits);
          const sum = (pick: (v: Visit) => number) => visits.reduce((a, v) => a + pick(v), 0);
          rows.push({
            version, current: version === current, firstSeen: Math.min(...visits.map((v) => v.firstStart)), runs: visits.length,
            models: [...new Set(visits.flatMap((v) => [...v.models]))], tokens,
            cost: { total: sum((v) => v.cost), median: median(visits.map((v) => v.cost)) },
            duration: { median: median(visits.map((v) => v.durationMs)), max: Math.max(...visits.map((v) => v.durationMs)) },
            attempts: { mean: sum((v) => v.attempts) / visits.length, max: Math.max(...visits.map((v) => v.attempts)) },
            reworks: sum((v) => v.reworks), questions: sum((v) => v.questions), blocks: sum((v) => v.blocks), fires: sum((v) => v.fires),
            passes: sum((v) => v.passes), provedWrong: sum((v) => v.provedWrong),
            permissions: { requests: sum((v) => v.requests), repeated: sum((v) => v.repeated), denied: sum((v) => v.denied), waitMedianMs: median(waits) },
          });
        }
        rows.sort((a, b) => b.firstSeen - a.firstSeen);
        // the current version, or while it has no runs the newest one before it; every version on request
        everything.push(...rows);
        const now = rows.filter((r) => r.current);
        pieces.push({ pieceId: p.id, label: p.label, machine: p.machine, checker: checkers.has(p.id), currentVersion: current, rows: filter.allVersions ? rows : now.length ? now : rows.slice(0, 1) });
      }
      const shown = everything;
      const tokens = zero(); shown.forEach((r) => add(tokens, r.tokens));
      const sum = (pick: (r: VersionRow) => number) => shown.reduce((a, r) => a + pick(r), 0);
      lines.push({
        lineId: line.id, sectorId: line.sectorId, name: line.name, runs: kept.length, pieces,
        total: {
          cost: sum((r) => r.cost.total), tokens, reworks: sum((r) => r.reworks), questions: sum((r) => r.questions), blocks: sum((r) => r.blocks), fires: sum((r) => r.fires),
          passes: sum((r) => r.passes), provedWrong: sum((r) => r.provedWrong),
          permissions: { requests: sum((r) => r.permissions.requests), repeated: sum((r) => r.permissions.repeated), denied: sum((r) => r.permissions.denied) },
        },
      });
    }
  }
  return { lines };
}
