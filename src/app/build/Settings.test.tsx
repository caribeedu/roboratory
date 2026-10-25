// Build mode above the pieces: a line, its sector, the whole factory, and making new lines and sectors.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings, type SettingsPanel } from './Settings';
import { buildView, installBridge, LINE_ID, makeFactory } from '../../test/ui';
import type { BuildOp } from '../../shared/build';

interface Options { files?: Record<string, string>; lists?: Record<string, string[]>; view?: ReturnType<typeof buildView> }

function open(panel: SettingsPanel, o: Options = {}) {
  const files: Record<string, string> = {
    'sectors/releases/sector.yaml': 'name: Releases\nmanager:\n  agent: claude\n  model: sonnet\n  tools: [mcp__slack]\n',
    'factory.yaml': 'name: Test Factory\nceiling:\n  retry: { auto: 3 }\n',
    'sectors/releases/culture.md': 'Sector rule.\n',
    'culture.md': 'Factory rule.\n',
    ...o.files,
  };
  const lists: Record<string, string[]> = { 'sectors/releases/models': ['ship', 'spare'], 'shared/models': ['ticket-to-pr'], ...o.lists };
  installBridge({ buildRead: vi.fn(async (p: string) => files[p] ?? null), buildList: vi.fn(async (p: string) => lists[p] ?? []) });
  const op = vi.fn(async (_o: BuildOp) => true);
  const onClose = vi.fn(), onCreateSector = vi.fn();
  render(<Settings panel={panel} view={o.view ?? buildView()} sectorId="releases" op={op} onClose={onClose} onCreateSector={onCreateSector} />);
  return { op, onClose, onCreateSector, user: userEvent.setup() };
}

async function commit(user: ReturnType<typeof userEvent.setup>, label: string, text: string, i = 0) {
  const field = screen.getAllByLabelText(label)[i];
  await user.clear(field);
  if (text) await user.type(field, text);
  await user.tab();
}

describe('Line settings', () => {
  const line = { kind: 'line', lineId: LINE_ID } as const;

  it('lists the commands no machine of its model may run', async () => {
    const { op, user } = open(line);
    await commit(user, 'Line never allowed', 'make clean');
    expect(op).toHaveBeenLastCalledWith({ op: 'setModel', lineId: LINE_ID, deny: ['make clean'] });
  });

  it('renames the line, sets its direction and its target repository', async () => {
    const { op, user } = open(line);
    await commit(user, 'Line name', 'Releases of orders');
    expect(op).toHaveBeenLastCalledWith({ op: 'setLine', lineId: LINE_ID, name: 'Releases of orders' });
    await user.selectOptions(screen.getByLabelText('Direction'), 'left');
    expect(op).toHaveBeenLastCalledWith({ op: 'setLine', lineId: LINE_ID, direction: 'left' });
    await commit(user, 'Target repository', '~/repos/orders');
    expect(op).toHaveBeenLastCalledWith({ op: 'setLine', lineId: LINE_ID, repo: '~/repos/orders' });
  });

  it('adds a parameter with a free name, edits it, and removes it', async () => {
    const f = makeFactory();
    f.sectors[0].lines[0].params = { service: 'orders' };
    const { op, user } = open(line, { view: buildView({ factory: f }) });
    await user.click(screen.getByRole('button', { name: '+ parameter' }));
    expect(op).toHaveBeenLastCalledWith({ op: 'setLine', lineId: LINE_ID, params: { service: 'orders', param2: '' } });
    await commit(user, 'Value', 'billing');
    expect(op).toHaveBeenLastCalledWith({ op: 'setLine', lineId: LINE_ID, params: { service: 'billing' } });
    await user.click(screen.getByRole('button', { name: 'Remove service' }));
    expect(op).toHaveBeenLastCalledWith({ op: 'setLine', lineId: LINE_ID, params: {} });
  });

  it('refuses two parameters with the same name, and a parameter with none', async () => {
    const f = makeFactory();
    f.sectors[0].lines[0].params = { a: '1', b: '2' };
    const { op, user } = open(line, { view: buildView({ factory: f }) });
    await commit(user, 'Name', 'a', 1);
    expect(await screen.findByText('Two parameters cannot share a name.')).toBeInTheDocument();
    await commit(user, 'Name', '', 0);
    expect(await screen.findByText(/A parameter needs a name/)).toBeInTheDocument();
    expect(op).not.toHaveBeenCalled();
  });

  it('removes the line and closes the panel', async () => {
    const { op, onClose, user } = open(line);
    await user.click(screen.getByRole('button', { name: 'Remove this line' }));
    expect(op).toHaveBeenCalledWith({ op: 'removeLine', lineId: LINE_ID });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('says so when the line is not in the draft any more', () => {
    open({ kind: 'line', lineId: 'releases/gone' });
    expect(screen.getByText('This line is not in the draft any more.')).toBeInTheDocument();
  });
});

describe('Sector settings', () => {
  const sector = { kind: 'sector' } as const;

  it('renames the sector and picks its color', async () => {
    const { op, user } = open(sector);
    await commit(user, 'Sector name', 'Shipping');
    expect(op).toHaveBeenLastCalledWith({ op: 'setSector', sectorId: 'releases', name: 'Shipping' });
    await user.click(screen.getByRole('button', { name: 'Color #5b8fd3' }));
    expect(op).toHaveBeenLastCalledWith({ op: 'setSector', sectorId: 'releases', color: '#5b8fd3' });
  });

  it('lists the commands no machine of the sector may run', async () => {
    const { op, user } = open(sector);
    await commit(user, 'Sector never allowed', 'gh pr merge');
    expect(op).toHaveBeenLastCalledWith({ op: 'setSector', sectorId: 'releases', deny: ['gh pr merge'] });
  });

  it('shows the manager as configured and changes it', async () => {
    const { op, user } = open(sector);
    await waitFor(() => expect(screen.getByLabelText('Manager agent')).toHaveValue('claude'));
    await waitFor(() => expect(screen.getByLabelText('Manager model')).toHaveValue('sonnet'));
    expect(screen.getByLabelText('Manager tools')).toHaveValue('mcp__slack');
    await user.selectOptions(screen.getByLabelText('Manager agent'), 'sim');
    expect(op).toHaveBeenLastCalledWith({ op: 'setSector', sectorId: 'releases', manager: { agent: 'sim' } });
    await commit(user, 'Manager tools', 'mcp__slack, mcp__jira');
    expect(op).toHaveBeenLastCalledWith({ op: 'setSector', sectorId: 'releases', manager: { tools: ['mcp__slack', 'mcp__jira'] } });
  });

  it('sets how many times the manager may act alone, up to the factory ceiling, never below zero', async () => {
    const { op, user } = open(sector);
    await user.click(screen.getByRole('button', { name: /Policy/ }));
    expect(await screen.findByText('(ceiling 3)')).toBeInTheDocument();
    await commit(user, 'retry on its own', '2');
    expect(op).toHaveBeenLastCalledWith({ op: 'setSector', sectorId: 'releases', policy: { retry: { auto: 2 } } });
    await commit(user, 'run on its own', '-4');
    expect(op).toHaveBeenLastCalledWith(expect.objectContaining({ policy: expect.objectContaining({ run: { auto: 0 } }) }));
    expect(screen.queryByLabelText('release on its own')).not.toBeInTheDocument(); // releasing is always yours
  });

  it('edits the sector culture', async () => {
    const { op, user } = open(sector);
    await user.click(screen.getByRole('button', { name: /Culture/ }));
    const box = await screen.findByLabelText('Sector culture');
    expect(box).toHaveValue('Sector rule.\n');
    await user.type(box, 'More.');
    await user.tab();
    expect(op).toHaveBeenLastCalledWith({ op: 'writeFile', path: 'sectors/releases/culture.md', content: 'Sector rule.\nMore.' });
  });

  it('lists the models, lets an unused one go, and keeps one a line uses', async () => {
    const { op, user } = open(sector);
    await user.click(screen.getByRole('button', { name: /Models/ }));
    expect(await screen.findByText('ship')).toBeInTheDocument();
    expect(screen.getByText('in use')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(op).toHaveBeenLastCalledWith({ op: 'removeModel', sectorId: 'releases', model: 'spare' });
  });

  it('removes the sector', async () => {
    const { op, user } = open(sector);
    await user.click(screen.getByRole('button', { name: 'Remove this sector' }));
    expect(op).toHaveBeenCalledWith({ op: 'removeSector', sectorId: 'releases' });
  });
});

describe('Factory settings', () => {
  const factory = { kind: 'factory' } as const;

  it('renames the factory and turns line context on or off', async () => {
    const { op, user } = open(factory);
    await commit(user, 'Factory name', 'Acme');
    expect(op).toHaveBeenLastCalledWith({ op: 'setFactory', name: 'Acme' });
    await user.click(screen.getByLabelText('on for every machine'));
    expect(op).toHaveBeenLastCalledWith({ op: 'setFactory', lineContext: false });
  });

  it('sets the ceiling a sector\'s policy cannot pass', async () => {
    const { op, user } = open(factory);
    await user.click(screen.getByRole('button', { name: /Ceiling/ }));
    expect(await screen.findByLabelText('retry on its own')).toHaveValue(3);
    await commit(user, 'halt on its own', '5');
    expect(op).toHaveBeenLastCalledWith({ op: 'setFactory', ceiling: { retry: { auto: 3 }, halt: { auto: 5 } } });
  });

  it('lists the commands no machine may run', async () => {
    const { op, user } = open(factory);
    await commit(user, 'Factory never allowed', 'sudo, rm -rf');
    expect(op).toHaveBeenLastCalledWith({ op: 'setFactory', deny: ['sudo', 'rm -rf'] });
  });

  it('configures the General Manager and the factory culture', async () => {
    const { op, user } = open(factory);
    await user.selectOptions(await screen.findByLabelText('Manager agent'), 'sim');
    expect(op).toHaveBeenLastCalledWith({ op: 'setFactory', generalManager: { agent: 'sim' } });
    await user.click(screen.getByRole('button', { name: /Culture/ }));
    const culture = await screen.findByLabelText('Factory culture');
    await user.type(culture, 'Be kind.');
    await user.tab();
    expect(op).toHaveBeenLastCalledWith({ op: 'writeFile', path: 'culture.md', content: 'Factory rule.\nBe kind.' });
  });
});

describe('A new line', () => {
  const newLine = { kind: 'newLine' } as const;

  it('is a copy of a model of the sector or of the shared library, under the id made from its name', async () => {
    const { op, onClose, user } = open(newLine);
    const create = screen.getByRole('button', { name: 'Add the line' });
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText('New line name'), 'Orders incidents');
    await screen.findByRole('option', { name: 'ticket-to-pr (shared)' });
    await user.selectOptions(screen.getByLabelText('Model'), 'ticket-to-pr');
    await user.click(create);
    expect(op).toHaveBeenCalledWith({ op: 'newLine', sectorId: 'releases', id: 'orders-incidents', name: 'Orders incidents', model: 'ticket-to-pr', newModel: false });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('can start a model of its own, named after the line unless you name it', async () => {
    const { op, user } = open(newLine);
    await user.type(screen.getByLabelText('New line name'), 'Deploy');
    await user.click(screen.getByLabelText('a new model'));
    await user.click(screen.getByRole('button', { name: 'Add the line' }));
    expect(op).toHaveBeenCalledWith({ op: 'newLine', sectorId: 'releases', id: 'deploy', name: 'Deploy', model: 'deploy', newModel: true });
  });
});

describe('A new sector', () => {
  it('is created as soon as you ask, with the color you picked, and needs a name nobody has', async () => {
    const { onCreateSector, user } = open({ kind: 'newSector' });
    const create = screen.getByRole('button', { name: 'Create the sector' });
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText('New sector name'), 'Operations');
    await user.click(screen.getByRole('button', { name: 'Color #d4566b' }));
    await user.click(create);
    expect(onCreateSector).toHaveBeenCalledWith('operations', 'Operations', '#d4566b');
  });

  it('refuses the name of a sector that exists', async () => {
    const { user } = open({ kind: 'newSector' });
    await user.type(screen.getByLabelText('New sector name'), 'Releases');
    expect(screen.getByRole('button', { name: 'Create the sector' })).toBeDisabled();
  });
});
