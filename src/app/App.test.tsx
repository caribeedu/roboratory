// The whole window, with the Floor's canvas replaced by a stand-in (PixiJS needs a GPU; the real one is driven by the e2e specs).
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { buildView, installBridge, LINE_ID, settle, snapshot, type FakeBridge } from '../test/ui';
import type { AttentionItem, Snapshot } from '../shared/types';

vi.mock('./floor/Floor', () => ({
  Floor: ({ sector, selection, onSelect }: { sector: { id: string; name: string }; selection: { pieceId?: string } | null; onSelect: (s: unknown) => void }) => (
    <div data-testid="floor" data-sector={sector.id} data-selected={selection?.pieceId ?? ''}>
      <button onClick={() => onSelect({ kind: 'piece', lineId: 'releases/orders-api', pieceId: 'build' })}>pick Build</button>
    </div>
  ),
}));

let bridge: FakeBridge;
const attention = (over: Partial<AttentionItem> = {}): AttentionItem => ({
  id: `${LINE_ID}#launch`, severity: 2, kind: 'gate', sectorId: 'releases', lineId: LINE_ID, pieceId: 'launch', runId: 'run-1',
  since: Date.now(), title: 'Launch is waiting for you', detail: 'orders-api releases', ...over,
});
const withState = (snap: Snapshot, engine = { state: 'running', version: '1.0.0', appVersion: '1.0.0' }) => ({ state: vi.fn(async () => ({ snapshot: snap, logs: [], recent: ['/work/acme'], demoPath: '/demo', engine })) });

async function open(over: Record<string, unknown> = {}) {
  bridge = installBridge(over);
  const user = userEvent.setup();
  render(<App />);
  await settle();
  return user;
}
const floor = () => screen.getByTestId('floor');

describe('Opening the window', () => {
  it('waits for the main process before it draws anything', async () => {
    let release: (v: unknown) => void = () => undefined;
    await open({ state: vi.fn(() => new Promise((r) => { release = r; })) });
    expect(screen.getByText('Lighting the lamps…')).toBeInTheDocument();
    await act(async () => release({ snapshot: snapshot(), logs: [], recent: [], demoPath: '/demo', engine: { state: 'running', appVersion: '1' } }));
    expect(await screen.findByTestId('floor')).toBeInTheDocument();
  });

  it('shows the welcome screen while no factory is open', async () => {
    await open(withState({ factory: null, lines: {}, attention: [], now: 0 }));
    expect(await screen.findByRole('button', { name: 'Open the demo factory' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '/work/acme' })).toBeInTheDocument();
  });

  it('shows the factory: its name, the first sector on the floor, the other sectors, and nothing waiting for you', async () => {
    await open();
    expect(await screen.findByText('Test Factory')).toBeInTheDocument();
    expect(await screen.findByTestId('floor')).toHaveAttribute('data-sector', 'releases');
    const sectors = screen.getByRole('navigation', { name: 'Sectors' });
    expect(within(sectors).getAllByRole('button').map((b) => b.textContent)).toEqual(['Releases', 'Incidents']);
    expect(screen.getByRole('button', { name: /All clear/ })).toBeInTheDocument();
  });

  it('changes the room when you pick another sector', async () => {
    const user = await open();
    await screen.findByTestId('floor');
    await user.click(screen.getByRole('button', { name: 'Incidents' }));
    expect(floor()).toHaveAttribute('data-sector', 'incidents');
  });
});

describe('Views and keys', () => {
  it('switches between the Floor and the Ledger with the tabs and with 1 and 2', async () => {
    const user = await open();
    await screen.findByTestId('floor');
    await user.click(screen.getByRole('tab', { name: /Ledger/ }));
    expect(screen.queryByTestId('floor')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Ledger/ })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('1');
    expect(await screen.findByTestId('floor')).toBeInTheDocument();
    await user.keyboard('2');
    expect(screen.queryByTestId('floor')).not.toBeInTheDocument();
  });

  it('opens Metrics with its tab and with 3, and goes back to the Floor with 1', async () => {
    const user = await open();
    await screen.findByTestId('floor');
    await user.click(screen.getByRole('tab', { name: /Metrics/ }));
    expect(screen.queryByTestId('floor')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Metrics/ })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('No lines match.')).toBeInTheDocument();
    await user.keyboard('1');
    expect(await screen.findByTestId('floor')).toBeInTheDocument();
    await user.keyboard('3');
    expect(screen.getByRole('tab', { name: /Metrics/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('does not take the keys while you are typing in a field', async () => {
    const user = await open();
    await screen.findByTestId('floor');
    await user.type(screen.getByRole('textbox', { name: /Message the Releases Manager/ }), '2');
    expect(screen.getByTestId('floor')).toBeInTheDocument();
  });

  it('focuses the manager box on /', async () => {
    const user = await open();
    await screen.findByTestId('floor');
    await user.keyboard('/');
    expect(screen.getByRole('textbox', { name: /Message the Releases Manager/ })).toHaveFocus();
  });
});

describe('What needs you', () => {
  const needing = (): Snapshot => snapshot({ attention: [attention()], states: { launch: { state: 'holding', runId: 'run-1' } } });

  it('jumps to the first item with N, selecting its piece in the right sector', async () => {
    const user = await open(withState(needing()));
    await screen.findByTestId('floor');
    await user.click(screen.getByRole('button', { name: 'Incidents' }));
    await user.keyboard('n');
    await waitFor(() => expect(floor()).toHaveAttribute('data-sector', 'releases'));
    await waitFor(() => expect(floor()).toHaveAttribute('data-selected', 'launch'));
    expect(await screen.findByRole('complementary', { name: 'Launch' })).toBeInTheDocument();
  });

  it('opens the piece from the queue, and closes its panel with Escape', async () => {
    const user = await open(withState(needing()));
    await user.click(await screen.findByRole('button', { name: /Launch is waiting for you/ }));
    expect(await screen.findByRole('complementary', { name: 'Launch' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Launch' })).not.toBeInTheDocument();
  });

  it('says so when something new needs you, but not for what was already waiting', async () => {
    await open(withState(needing()));
    await screen.findByTestId('floor');
    expect(screen.queryByText(/Releases: /)).not.toBeInTheDocument(); // it was there when the window opened
    act(() => bridge.emit.snapshot(snapshot({ attention: [attention(), attention({ id: 'x', severity: 3, kind: 'fire', title: 'Build stopped', pieceId: 'build' })] })));
    expect(await screen.findByText('Releases: Build stopped')).toBeInTheDocument();
  });
});

describe('Acting from a panel', () => {
  it('tells you when an action failed, in words and not as a raw error', async () => {
    const user = await open({ halt: vi.fn(async () => { throw new Error("Error invoking remote method 'halt': Error: The engine is not connected."); }), ...withState(snapshot({ states: { build: { state: 'fire', error: 'boom', runId: 'r' } } })) });
    await screen.findByTestId('floor');
    await user.click(screen.getByRole('button', { name: 'pick Build' }));
    await user.click(await screen.findByRole('button', { name: 'Halt line' }));
    expect(await screen.findByText('The engine is not connected.')).toBeInTheDocument();
  });
});

describe('The top bar', () => {
  it('lists the factory\'s warnings behind a count', async () => {
    const snap = snapshot();
    snap.factory!.warnings = ['MCP server "slack" is not configured in Claude Code.', 'Another warning.'];
    const user = await open(withState(snap));
    await user.click(await screen.findByRole('button', { name: '2 warnings' }));
    const dialog = screen.getByRole('dialog', { name: 'Warnings' });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Warnings' })).not.toBeInTheDocument();
  });

  it('closes the factory, and shows the folder in the file manager', async () => {
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Files' }));
    expect(bridge.api.reveal).toHaveBeenCalledWith('/factory/factory.yaml');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(bridge.api.closeFactory).toHaveBeenCalled();
  });

  it('offers to install the command only while it is missing, and installs it', async () => {
    const user = await open({ cliStatus: vi.fn(async () => 'missing') });
    await user.click(await screen.findByRole('button', { name: 'Install CLI' }));
    expect(bridge.api.cliInstall).toHaveBeenCalled();
    act(() => bridge.emit.cli('installed'));
    expect(screen.queryByRole('button', { name: 'Install CLI' })).not.toBeInTheDocument();
  });

  it('shows the engine banner while the engine has stopped, with a button that starts it', async () => {
    const user = await open();
    await screen.findByTestId('floor');
    act(() => bridge.emit.engine({ state: 'stopped', appVersion: '1.0.0' }));
    expect(screen.getByRole('status')).toHaveTextContent('Engine stopped');
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(bridge.api.engineStart).toHaveBeenCalled();
  });

  it('offers a restart when the engine is another build, once nothing is running', async () => {
    const user = await open();
    await screen.findByTestId('floor');
    act(() => bridge.emit.engine({ state: 'older', version: '1.0.0', appVersion: '1.0.0' }));
    await user.click(screen.getByRole('button', { name: 'Restart when idle' }));
    expect(bridge.api.engineRestartWhenIdle).toHaveBeenCalled();
    expect(await screen.findByText('The engine restarts once nothing is running')).toBeInTheDocument();
  });

  it('shows no banner when there is no factory open', async () => {
    await open(withState({ factory: null, lines: {}, attention: [], now: 0 }));
    await screen.findByRole('button', { name: 'Open the demo factory' });
    act(() => bridge.emit.engine({ state: 'stopped', appVersion: '1.0.0' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('Build mode', () => {
  const start = (view = buildView()) => ({ buildStart: vi.fn(async () => view) });

  it('starts for the sector on the floor, and leaves at once when nothing was changed', async () => {
    const user = await open(start());
    await user.click(await screen.findByRole('button', { name: 'Build' }));
    expect(bridge.api.buildStart).toHaveBeenCalledWith('releases');
    expect(await screen.findByText('Building')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(bridge.api.buildDiscard).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Building')).not.toBeInTheDocument());
  });

  it('shows how many changes and problems the draft has', async () => {
    const view = buildView({ changes: [{ path: 'a.yaml', status: 'changed' }, { path: 'b.yaml', status: 'added' }], issues: [{ kind: 'rule', message: 'A belt has no rule.', lineIds: [LINE_ID] }] });
    const user = await open(start(view));
    await user.click(await screen.findByRole('button', { name: 'Build' }));
    expect(await screen.findByText(/2 changes/)).toBeInTheDocument();
    expect(screen.getByText('1 problem')).toBeInTheDocument();
  });

  it('asks to save or discard before it leaves, when the draft has changes', async () => {
    const user = await open(start(buildView({ changes: [{ path: 'a.yaml', status: 'changed', before: 'a: 1\n', after: 'a: 2\n' }] })));
    await user.click(await screen.findByRole('button', { name: 'Build' }));
    await user.click(await screen.findByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('dialog', { name: 'Save build changes' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save the files' }));
    expect(bridge.api.buildSave).toHaveBeenCalledWith({});
  });

  it('will not open the Ledger over unsaved changes, and says why', async () => {
    const user = await open(start(buildView({ changes: [{ path: 'a.yaml', status: 'changed' }] })));
    await user.click(await screen.findByRole('button', { name: 'Build' }));
    await screen.findByText('Building');
    await user.keyboard('2');
    const dialog = await screen.findByRole('dialog', { name: 'Save build changes' });
    expect(dialog).toHaveTextContent('Save or discard your build changes to open the Ledger.');
  });

  it('will not open Metrics over unsaved changes either', async () => {
    const user = await open(start(buildView({ changes: [{ path: 'a.yaml', status: 'changed' }] })));
    await user.click(await screen.findByRole('button', { name: 'Build' }));
    await screen.findByText('Building');
    await user.keyboard('3');
    expect(await screen.findByRole('dialog', { name: 'Save build changes' })).toHaveTextContent('Save or discard your build changes to open Metrics.');
  });

  it('undoes with the keyboard', async () => {
    const user = await open({ ...start(buildView({ canUndo: true })), buildUndo: vi.fn(async () => buildView()) });
    await user.click(await screen.findByRole('button', { name: 'Build' }));
    await screen.findByText('Building');
    await user.keyboard('{Control>}z{/Control}');
    expect(bridge.api.buildUndo).toHaveBeenCalled();
  });

  it('is left when the main process says the draft is gone', async () => {
    const user = await open(start());
    await user.click(await screen.findByRole('button', { name: 'Build' }));
    await screen.findByText('Building');
    act(() => bridge.emit.build(null));
    await waitFor(() => expect(screen.queryByText('Building')).not.toBeInTheDocument());
  });

  it('tells you when it could not start', async () => {
    const user = await open({ buildStart: vi.fn(async () => { throw new Error('Build mode is already open with unsaved changes.'); }) });
    await user.click(await screen.findByRole('button', { name: 'Build' }));
    expect(await screen.findByText('Build mode is already open with unsaved changes.')).toBeInTheDocument();
  });
});
