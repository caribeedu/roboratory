// The attention queue, the sector minimap and the live log: what the Floor says is happening.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttentionQueue } from './AttentionQueue';
import { LiveLog } from './LiveLog';
import { Minimap } from './Minimap';
import { LINE_ID, lineView, makeFactory } from '../../test/ui';
import type { AttentionItem, LogEntry } from '../../shared/types';

const factory = makeFactory();
const item = (over: Partial<AttentionItem>): AttentionItem => ({
  id: 'releases/orders-api#launch', severity: 2, kind: 'gate', sectorId: 'releases', lineId: LINE_ID, pieceId: 'launch', since: Date.now() - 5000,
  title: 'Launch is waiting for you', detail: 'orders-api releases', ...over,
});

describe('The attention queue', () => {
  it('says all is clear when nothing needs you', () => {
    render(<AttentionQueue items={[]} factory={factory} onPick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /All clear/ })).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('counts what needs you, names where each is, and opens the one you pick', async () => {
    const onPick = vi.fn();
    const gate = item({});
    const fire = item({ id: 'x', kind: 'fire', severity: 3, title: 'Build stopped', pieceId: 'build', detail: 'orders-api releases · attempts used' });
    render(<AttentionQueue items={[fire, gate]} factory={factory} onPick={onPick} />);
    expect(screen.getByRole('button', { name: /2 need you/ })).toBeInTheDocument();
    const rows = within(screen.getByRole('list')).getAllByRole('button');
    expect(rows[0]).toHaveTextContent('Build stopped');
    expect(rows[0]).toHaveTextContent('Releases · orders-api releases · attempts used');
    await userEvent.click(rows[1]);
    expect(onPick).toHaveBeenCalledWith(gate);
  });

  it('shows a permission request with the gate\'s exclamation, ranked with fires, without calling it a fire', () => {
    const ask = item({ id: 'p', kind: 'permission', severity: 3, requestId: 'ab12', pieceId: 'build', title: 'Build asks to run a command', detail: 'orders-api releases · npm test' });
    const { container } = render(<AttentionQueue items={[ask, item({})]} factory={factory} onPick={vi.fn()} />);
    const first = within(screen.getByRole('list')).getAllByRole('button')[0];
    expect(first).toHaveTextContent('!');
    expect(first).toHaveTextContent('Build asks to run a command');
    expect(first).toHaveClass('permission');
    expect(container.querySelector('.panel-head .dot')).toHaveClass('hold');
  });

  it('says "1 needs you" for one item, and folds away when you click its head', async () => {
    render(<AttentionQueue items={[item({})]} factory={factory} onPick={vi.fn()} />);
    const head = screen.getByRole('button', { name: /1 needs you/ });
    expect(head).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows only the first eight', () => {
    render(<AttentionQueue items={Array.from({ length: 11 }, (_, i) => item({ id: `i${i}`, title: `Item ${i}` }))} factory={factory} onPick={vi.fn()} />);
    expect(within(screen.getByRole('list')).getAllByRole('button')).toHaveLength(8);
  });
});

describe('The minimap', () => {
  it('marks a sector with a permission request as waiting for you, not on fire', () => {
    render(<Minimap factory={factory} lines={{ [LINE_ID]: lineView({ build: { state: 'busy' } }) }} attention={[item({ kind: 'permission', severity: 3 })]} current="releases" onPick={vi.fn()} />);
    const releases = within(screen.getByRole('navigation', { name: 'Sectors' })).getByRole('button', { name: /Releases/ });
    expect(releases).toHaveClass('hold');
    expect(releases).not.toHaveClass('fire');
  });

  it('lists every sector, marks the current one, and how many things need you in each', async () => {
    const onPick = vi.fn();
    render(<Minimap factory={factory} lines={{ [LINE_ID]: lineView({ build: { state: 'busy' } }) }} attention={[item({}), item({ id: 'b', kind: 'fire', severity: 3 })]} current="releases" onPick={onPick} />);
    const nav = screen.getByRole('navigation', { name: 'Sectors' });
    const releases = within(nav).getByRole('button', { name: /Releases/ });
    expect(releases).toHaveAttribute('aria-current', 'true');
    expect(releases).toHaveTextContent('2');
    expect(releases).toHaveClass('fire');
    const incidents = within(nav).getByRole('button', { name: /Incidents/ });
    expect(incidents).toHaveAttribute('aria-current', 'false');
    await userEvent.click(incidents);
    expect(onPick).toHaveBeenCalledWith('incidents');
  });

  it('shows the state of each piece of each line as a light with a name', () => {
    render(<Minimap factory={factory} lines={{ [LINE_ID]: lineView({ build: { state: 'busy' }, launch: { state: 'holding' } }) }} attention={[]} current="releases" onPick={vi.fn()} />);
    expect(screen.getByTitle('orders-api releases: Build (busy)')).toBeInTheDocument();
    expect(screen.getByTitle('orders-api releases: Launch (holding)')).toBeInTheDocument();
    expect(screen.queryByTitle(/Intake/)).not.toBeInTheDocument(); // the intake is not a station
  });
});

describe('The live log', () => {
  const log = (over: Partial<LogEntry>): LogEntry => ({ t: Date.now(), level: 'sector', sectorId: 'releases', kind: 'info', text: 'something', ...over });
  const logs = [
    log({ level: 'factory', text: 'run started', kind: 'info' }),
    log({ level: 'sector', text: 'Build: attempt 1/2' }),
    log({ level: 'machine', lineId: LINE_ID, pieceId: 'build', text: '▸ Read role.md', kind: 'tool' }),
    log({ level: 'sector', sectorId: 'incidents', text: 'a line in another sector' }),
  ];

  it('shows the sector level by default: this sector, without the machines\' own lines', () => {
    render(<LiveLog logs={logs} factory={factory} sectorId="releases" selection={null} />);
    expect(screen.getByText('Build: attempt 1/2')).toBeInTheDocument();
    expect(screen.queryByText('▸ Read role.md')).not.toBeInTheDocument();
    expect(screen.queryByText('a line in another sector')).not.toBeInTheDocument();
  });

  it('switches to the factory level, which names the sector of each line', async () => {
    render(<LiveLog logs={logs} factory={factory} sectorId="releases" selection={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Factory' }));
    expect(screen.getByText('run started')).toBeInTheDocument();
    expect(screen.getByText('Releases')).toBeInTheDocument();
  });

  it('follows the machine you select, and asks you to select one when none is', async () => {
    const { rerender } = render(<LiveLog logs={logs} factory={factory} sectorId="releases" selection={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Machine' }));
    expect(screen.getByText(/Select a machine or a signal on the floor/)).toBeInTheDocument();
    rerender(<LiveLog logs={logs} factory={factory} sectorId="releases" selection={{ lineId: LINE_ID, pieceId: 'build' }} />);
    expect(screen.getByRole('button', { name: 'Build' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('▸ Read role.md')).toBeInTheDocument();
  });

  it('says it is quiet when there is nothing to show, and folds away', async () => {
    render(<LiveLog logs={[]} factory={factory} sectorId="releases" selection={null} />);
    expect(screen.getByText('Quiet so far.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Live log/ }));
    expect(screen.queryByText('Quiet so far.')).not.toBeInTheDocument();
  });
});
