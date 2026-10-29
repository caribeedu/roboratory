// The Metrics tab and the line of history in a machine's panel (D47): what the numbers say, what the filters ask for, and what a click opens.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Metrics } from './Metrics';
import { PieceHistory } from './PieceHistory';
import { installBridge, LINE_ID, makeFactory, settle, type FakeBridge } from '../../test/ui';
import type { PieceStats, Stats, VersionRow } from '../../shared/types';

const factory = makeFactory();
const row = (over: Partial<VersionRow> = {}): VersionRow => ({
  version: 'ab12cd34', current: true, firstSeen: 1, runs: 3, models: ['haiku'], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  cost: { total: 1.5, median: 0.5 }, duration: { median: 190_000, max: 400_000 }, attempts: { mean: 1.3, max: 2 },
  reworks: 1, questions: 2, blocks: 0, fires: 1, passes: 0, provedWrong: 0, permissions: { requests: 4, repeated: 2, denied: 1, waitMedianMs: 0 }, ...over,
});
const piece = (over: Partial<PieceStats> = {}): PieceStats => ({ pieceId: 'build', label: 'Build', machine: 'build', checker: false, currentVersion: 'ab12cd34', rows: [row()], ...over });
const stats = (pieces: PieceStats[]): Stats => ({
  lines: [{
    lineId: LINE_ID, sectorId: 'releases', name: 'orders-api releases', runs: 3,
    total: { cost: 1.5, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reworks: 1, questions: 2, blocks: 0, fires: 1, passes: 0, provedWrong: 0, permissions: { requests: 4, repeated: 2, denied: 1 } },
    pieces,
  }],
});

let bridge: FakeBridge;
async function open(result: Stats = stats([piece()])) {
  bridge = installBridge({ stats: vi.fn(async () => result) });
  const onPiece = vi.fn();
  render(<Metrics factory={factory} onPiece={onPiece} />);
  await settle();
  return { onPiece, user: userEvent.setup() };
}

describe('The Metrics tab', () => {
  it("shows each line's pieces with what they cost, how long they take and what happened, and says the dollars are estimates", async () => {
    await open(stats([piece({ checker: true, rows: [row({ passes: 4, provedWrong: 1 })] })]));
    const table = within(screen.getByRole('region', { name: 'Metrics of orders-api releases' }));
    expect(table.getByText('3 runs · ~US$ 1.50 in all')).toBeInTheDocument();
    const cells = within(table.getAllByRole('row')[1]);
    expect(cells.getByText('ab12cd34')).toBeInTheDocument();
    expect(cells.getByText('~US$ 0.50')).toHaveAttribute('title', '~US$ 1.50 in all');
    expect(cells.getByText('3m10s / 6m40s')).toBeInTheDocument();
    expect(cells.getByText('3 of 4 held')).toBeInTheDocument();
    expect(cells.getByText('4 / 2 / 1')).toBeInTheDocument();
    expect(cells.getByText('checker')).toBeInTheDocument();
    expect(screen.getByText(/Costs are estimates made by the agent CLI/)).toBeInTheDocument();
  });

  it('says a piece has no runs yet', async () => {
    await open(stats([piece({ rows: [] })]));
    expect(screen.getByText('No runs yet.')).toBeInTheDocument();
  });

  it('says when the current version has no runs and shows the one before, in grey', async () => {
    await open(stats([piece({ currentVersion: 'ffffffff', rows: [row({ current: false })] })]));
    expect(screen.getByText(/the current version has no runs; this is the one before/)).toBeInTheDocument();
    expect(screen.getByText('ab12cd34').closest('tr')).toHaveClass('earlier');
  });

  it('asks for what the filters say, and for every version when you ask', async () => {
    const { user } = await open();
    expect(bridge.api.stats).toHaveBeenLastCalledWith({ sectorId: undefined, lineId: undefined, since: undefined, allVersions: false });
    await user.selectOptions(screen.getByLabelText('Sector'), 'releases');
    await user.selectOptions(screen.getByLabelText('Line'), LINE_ID);
    await user.selectOptions(screen.getByLabelText('Period'), 'Last 7 days');
    await user.click(screen.getByLabelText('All versions'));
    await waitFor(() => expect(bridge.api.stats).toHaveBeenLastCalledWith(expect.objectContaining({ sectorId: 'releases', lineId: LINE_ID, allVersions: true, since: expect.any(Number) })));
    const since = (bridge.api.stats as unknown as { mock: { lastCall: { since: number }[] } }).mock.lastCall[0].since;
    expect(Date.now() - since).toBeGreaterThan(6.9 * 86_400_000);
    expect(Date.now() - since).toBeLessThan(7.1 * 86_400_000);
  });

  it('lists the earlier versions of a piece below its current one when asked, marked as earlier', async () => {
    const { user } = await open(stats([piece({ rows: [row(), row({ version: '11111111', current: false, firstSeen: 0 })] })]));
    await user.click(screen.getByLabelText('All versions'));
    expect(screen.getByText('11111111').closest('tr')).toHaveClass('earlier');
    expect(screen.getByText('earlier')).toBeInTheDocument();
  });

  it("opens a piece's panel when you pick it", async () => {
    const { onPiece, user } = await open();
    await user.click(screen.getByRole('button', { name: 'Build' }));
    expect(onPiece).toHaveBeenCalledWith({ sectorId: 'releases', lineId: LINE_ID, pieceId: 'build' });
  });

  it('says no line matches', async () => {
    await open({ lines: [] });
    expect(screen.getByText('No lines match.')).toBeInTheDocument();
  });
});

describe('The line of history in a machine panel', () => {
  async function history(result: Stats, draft = false) {
    bridge = installBridge({ stats: vi.fn(async () => result) });
    render(<PieceHistory lineId={LINE_ID} pieceId="build" draft={draft} />);
    await settle();
  }

  it('says what this version usually takes and costs', async () => {
    await history(stats([piece()]));
    expect(screen.getByText('Usually 3m10s · ~US$ 0.50 · 1.3 attempts (3 runs)')).toBeInTheDocument();
    expect(bridge.api.stats).toHaveBeenCalledWith({ lineId: LINE_ID, draft: false, allVersions: true });
  });

  it('asks for the versions of the draft in build mode', async () => {
    await history(stats([piece()]), true);
    expect(bridge.api.stats).toHaveBeenCalledWith({ lineId: LINE_ID, draft: true, allVersions: true });
  });

  it('says there are no runs of this version, and what the one before did', async () => {
    await history(stats([piece({ currentVersion: 'ffffffff', rows: [row({ current: false, runs: 1 })] })]));
    expect(screen.getByText('No runs of this version yet. The one before: 3m10s · ~US$ 0.50 · 1.3 attempts (1 run)')).toBeInTheDocument();
  });

  it('says there are no runs at all', async () => {
    await history(stats([piece({ rows: [] })]));
    expect(screen.getByText('No runs yet.')).toBeInTheDocument();
  });

  it('shows nothing for a piece that is not in the stats', async () => {
    await history({ lines: [] });
    expect(screen.queryByText(/runs?/)).not.toBeInTheDocument();
  });
});
