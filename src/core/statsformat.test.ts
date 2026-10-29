import type { Stats, VersionRow } from '../shared/types';
import { duration, formatStats, money, parsePeriod } from './statsformat';

const row = (over: Partial<VersionRow> = {}): VersionRow => ({
  version: 'ab12cd34', current: true, firstSeen: 0, runs: 3, models: ['haiku'], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  cost: { total: 1.5, median: 0.5 }, duration: { median: 190_000, max: 400_000 }, attempts: { mean: 1.3, max: 2 },
  reworks: 1, questions: 0, blocks: 0, fires: 0, passes: 0, provedWrong: 0, permissions: { requests: 4, repeated: 2, denied: 1, waitMedianMs: 0 }, ...over,
});
const stats = (rows: VersionRow[], extra: object = {}): Stats => ({
  lines: [{
    lineId: 's/l', sectorId: 's', name: 'Orders', runs: 3,
    total: { cost: 1.5, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reworks: 1, questions: 0, blocks: 0, fires: 0, passes: 0, provedWrong: 0, permissions: { requests: 4, repeated: 2, denied: 1 } },
    pieces: [{ pieceId: 'qa', label: 'QA', machine: 'qa', checker: true, currentVersion: 'ab12cd34', rows, ...extra }],
  }],
});

describe('Metrics as text', () => {
  it('writes a time as seconds, minutes or hours', () => {
    expect([duration(4000), duration(190_000), duration(3_725_000)]).toEqual(['4s', '3m10s', '1h02m']);
  });

  it('marks every dollar figure as an estimate', () => {
    expect([money(0.0042), money(0.42), money(12)]).toEqual(['~US$ 0.004', '~US$ 0.42', '~US$ 12.00']);
  });

  it('reads a period, and says what it expected when it cannot', () => {
    expect(parsePeriod('90m')).toBe(5_400_000);
    expect(parsePeriod('7d')).toBe(604_800_000);
    expect(() => parsePeriod('soon')).toThrow(/like 90m, 12h, 7d or 2w/);
  });

  it('shows a row for each piece with its version, its checker mark, and the permission figures', () => {
    const text = formatStats(stats([row({ passes: 4, provedWrong: 1 })]));
    expect(text).toContain('Orders (s/l): 3 runs, ~US$ 1.50 in all');
    expect(text).toContain('QA (checker)');
    expect(text).toContain('ab12cd34');
    expect(text).toContain('~US$ 0.50');
    expect(text).toContain('3m10s / 6m40s');
    expect(text).toContain('3 of 4 held');
    expect(text).toContain('4 / 2 / 1');
    expect(text).toContain('Costs are estimates made by the agent CLI.');
  });

  it('says when the current version has no runs, and shows the one before it', () => {
    const text = formatStats(stats([row({ version: '99999999', current: false })]));
    expect(text).toContain('no runs of the current version; this is the one before');
    expect(text).toContain('99999999 (earlier)');
  });

  it('says a piece has no runs at all, and when no line matches', () => {
    expect(formatStats(stats([]))).toContain('no runs');
    expect(formatStats({ lines: [] })).toBe('No lines match.\n');
  });

  it('lists the earlier versions too when asked', () => {
    const text = formatStats(stats([row(), row({ version: '11111111', current: false, firstSeen: -1 })]), true);
    expect(text).toContain('ab12cd34');
    expect(text).toContain('11111111 (earlier)');
  });
});
