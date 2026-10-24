// The Ledger: every run, after the fact. Pick one to see its steps, what each cost and what you did.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ledger } from './Ledger';
import { installBridge, LINE_ID, makeFactory, type FakeBridge } from '../../test/ui';
import type { RunSummary } from '../../shared/types';

const factory = makeFactory();
const run = (over: Partial<RunSummary>): RunSummary => ({ id: 'r1', sectorId: 'releases', lineId: LINE_ID, status: 'done', startedAt: Date.now() - 120_000, endedAt: Date.now() - 60_000, input: { tag: 'v1.0.0' }, ...over });

const t = Date.now() - 100_000;
const events = [
  { type: 'run.start', t, input: { tag: 'v1.0.0' }, actor: 'you' },
  { type: 'piece.start', t: t + 1000, piece: 'build', attempt: 1 },
  { type: 'cost', t: t + 5000, piece: 'build', usd: 0.25 },
  { type: 'piece.done', t: t + 6000, piece: 'build', box: { ok: true } },
  { type: 'piece.hold', t: t + 7000, piece: 'launch' },
  { type: 'verb', t: t + 8000, verb: 'release', actor: 'you', piece: 'launch', confirmations: 2 },
  { type: 'piece.done', t: t + 9000, piece: 'launch', box: { ok: true } },
  { type: 'run.end', t: t + 10_000, status: 'done' },
];

let bridge: FakeBridge;
function setup(runs: RunSummary[], runId: string | null = null) {
  bridge = installBridge({
    runs: vi.fn(async () => runs),
    runDetail: vi.fn(async (id: string) => { const summary = runs.find((r) => r.id === id); return summary ? { summary, events, dir: '/factory/.runs/x', diff: undefined } : null; }),
  });
  const onRun = vi.fn();
  render(<Ledger factory={factory} runId={runId} onRun={onRun} notify={vi.fn()} onPiece={vi.fn()} />);
  return { onRun, user: userEvent.setup() };
}

describe('The Ledger', () => {
  it('says there are no runs yet, and where to start one', async () => {
    setup([]);
    expect(await screen.findByText(/No runs yet/)).toBeInTheDocument();
    expect(screen.getByText(/Pick a run to see everything/)).toBeInTheDocument();
  });

  it('lists the runs with their input, line and status, and opens the first by itself', async () => {
    const { onRun } = setup([run({ id: 'r1' }), run({ id: 'r2', input: { tag: 'v2.0.0' }, status: 'fire' })]);
    await screen.findByText('v1.0.0');
    const list = screen.getByRole('list');
    expect(within(list).getByText('v1.0.0')).toBeInTheDocument();
    expect(within(list).getByText('On fire')).toBeInTheDocument();
    expect(within(list).getAllByText('orders-api releases')).toHaveLength(2);
    expect(onRun).toHaveBeenCalledWith('r1');
  });

  it('narrows the list by status and by what you search for', async () => {
    const { user } = setup([run({ id: 'r1' }), run({ id: 'r2', input: { tag: 'v2.0.0' }, status: 'fire' })]);
    await screen.findByText('v2.0.0');
    await user.selectOptions(screen.getByLabelText('Status'), 'fire');
    expect(screen.queryByText('v1.0.0')).not.toBeInTheDocument();
    expect(screen.getByText('v2.0.0')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), '');
    await user.type(screen.getByLabelText('Search runs'), 'v1.0');
    expect(screen.queryByText('v2.0.0')).not.toBeInTheDocument();
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
  });

  it('opens the run you click', async () => {
    const { user, onRun } = setup([run({ id: 'r1' }), run({ id: 'r2', input: { tag: 'v2.0.0' } })], 'r1');
    await user.click(await screen.findByRole('button', { name: /v2\.0\.0/ }));
    expect(onRun).toHaveBeenCalledWith('r2');
  });

  it('shows the steps of a run with what it cost, and what you did on the way', async () => {
    setup([run({ id: 'r1' })], 'r1');
    expect(await screen.findByRole('heading', { name: /v1\.0\.0/ })).toBeInTheDocument();
    expect(screen.getByText(/\$0\.250/)).toBeInTheDocument();
    expect(await screen.findAllByText('Build')).not.toHaveLength(0);
    expect(screen.getAllByText('Launch')).not.toHaveLength(0);
    const who = screen.getByRole('heading', { name: 'Who did what' }).nextElementSibling as HTMLElement;
    expect(who).toHaveTextContent('you released Launch after 2 confirmations');
  });
});
