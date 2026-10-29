// The piece panel of build mode: every form says, through `op`, what it asks the draft to do. The draft itself
// (what those operations do to the files) is tested in src/core/build; here is what a person can ask of it.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PieceEditor } from './PieceEditor';
import { buildView, installBridge, LINE_ID, makeFactory, settle } from '../../test/ui';
import type { BuildOp } from '../../shared/build';
import type { Snapshot } from '../../shared/types';

type Factory = NonNullable<Snapshot['factory']>;
const MACHINE_DIR = 'sectors/releases/models/ship/build';

interface Options {
  factory?: Factory;
  files?: Record<string, string>;
  servers?: string[] | null;
  library?: string[];
  fields?: { path: string; type?: string; description?: string }[];
  issues?: { kind: 'rule'; message: string; lineIds: string[]; pieceId?: string }[];
  roles?: { path: string; machines: string[]; lines: number }[];
  live?: boolean;
}

/** Opens the editor of one piece of the test line; `op` records what it asks for and says yes. */
async function edit(pieceId: string, o: Options = {}) {
  const factory = o.factory ?? makeFactory();
  const line = factory.sectors[0].lines[0];
  const files: Record<string, string> = {
    [`${MACHINE_DIR}/machine.yaml`]: 'agent: sim\nattempts: 2\n',
    [`${MACHINE_DIR}/role.md`]: 'You build.\n',
    [`${MACHINE_DIR}/contract.json`]: JSON.stringify({ type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }),
    ...o.files,
  };
  const bridge = installBridge({
    buildRead: vi.fn(async (p: string) => files[p] ?? null),
    buildServers: vi.fn(async () => (o.servers === undefined ? ['slack', 'jira'] : o.servers)),
    buildList: vi.fn(async () => o.library ?? ['team.md', 'style.md']),
    buildFields: vi.fn(async () => ({ fields: o.fields ?? [{ path: 'tag', type: 'string' }, { path: 'ok', type: 'boolean' }], open: false })),
  });
  const op = vi.fn(async (_o: BuildOp) => true);
  const onConnect = vi.fn(), onClose = vi.fn(), onLive = vi.fn();
  const view = buildView({ factory, issues: o.issues ?? [], roles: o.roles ?? [] });
  render(<PieceEditor view={view} line={line} piece={line.pieces.find((p) => p.id === pieceId)!} op={op} onConnect={onConnect} onClose={onClose} onLive={o.live ? onLive : undefined} />);
  // the panel reads its files and lists when it opens; let those land before anyone acts on it
  await settle();
  return { op, onConnect, onClose, onLive, bridge, user: userEvent.setup() };
}

const withPiece = (id: string, over: object) => {
  const f = makeFactory();
  const p = f.sectors[0].lines[0].pieces.find((x) => x.id === id)!;
  Object.assign(p, over);
  return f;
};

/** Types into a field that saves on leaving it, then leaves it. */
async function commit(user: ReturnType<typeof userEvent.setup>, label: string, text: string, i = 0) {
  const field = screen.getAllByLabelText(label)[i];
  await user.clear(field);
  if (text) await user.type(field, text);
  await user.tab();
}

describe('Any piece', () => {
  it('names the piece being edited, its kind and its line', async () => {
    await edit('build');
    expect(screen.getByRole('complementary', { name: 'Edit Build' })).toBeInTheDocument();
    expect(screen.getByText('Machine · orders-api releases · editing')).toBeInTheDocument();
  });

  it('renames it when you leave the Name field', async () => {
    const { op, user } = await edit('checks');
    await commit(user, 'Name', 'Smoke test');
    expect(op).toHaveBeenCalledWith({ op: 'setPiece', lineId: LINE_ID, pieceId: 'checks', label: 'Smoke test' });
  });

  it('sets its goal, with the line-context note', async () => {
    const { op, user } = await edit('build');
    expect(screen.getByText(/Line context is on/)).toBeInTheDocument();
    const goal = screen.getAllByLabelText('Goal')[0]; // the line's goal comes first, the machine's default after
    expect(goal).toHaveValue('Build the release.');
    await user.clear(goal);
    await user.type(goal, 'Build and verify the release.');
    await user.tab();
    expect(op).toHaveBeenCalledWith({ op: 'setPiece', lineId: LINE_ID, pieceId: 'build', goal: 'Build and verify the release.' });
  });

  it('removes the piece and closes, and warns that its belts stay red', async () => {
    const { op, onClose, user } = await edit('checks');
    expect(screen.getByText(/Its belts stay open in red/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove this signal' }));
    expect(op).toHaveBeenCalledWith({ op: 'remove', lineId: LINE_ID, pieceId: 'checks' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('keeps the panel open when the removal is refused', async () => {
    const { op, onClose, user } = await edit('checks');
    op.mockResolvedValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Remove this signal' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cannot remove the intake or the pallet', async () => {
    await edit('@pallet');
    expect(screen.queryByRole('button', { name: /Remove this (machine|signal|gate)/ })).not.toBeInTheDocument();
  });

  it('lists the problems the checks found with this piece, and no others', async () => {
    await edit('launch', { issues: [{ kind: 'rule', message: 'Launch can send revise, but no belt takes it.', lineIds: [LINE_ID], pieceId: 'launch' }, { kind: 'rule', message: 'Something about build.', lineIds: [LINE_ID], pieceId: 'build' }] });
    const problems = screen.getByRole('list', { name: 'Problems' });
    expect(within(problems).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Launch can send revise, but no belt takes it.']);
  });

  it('opens the live panel of the piece when it exists on disk', async () => {
    const { onLive, user } = await edit('build', { live: true });
    await user.click(screen.getByRole('button', { name: /Open the live panel/ }));
    expect(onLive).toHaveBeenCalled();
  });
});

describe('A model shared by several lines', () => {
  const shared = () => {
    const f = makeFactory();
    const first = f.sectors[0].lines[0];
    f.sectors[1].lines = [{ ...first, id: 'incidents/orders-api', name: 'orders-api incidents' }];
    return f;
  };

  it('says how many lines a change reaches, in how many sectors', async () => {
    await edit('build', { factory: shared() });
    expect(screen.getByText(/shared by/)).toHaveTextContent('2 lines');
    expect(screen.getByText(/orders-api releases, orders-api incidents/)).toBeInTheDocument();
  });

  it('separates the line into a model of its own, under a name you can change', async () => {
    const { op, user } = await edit('build', { factory: shared() });
    await user.click(screen.getByRole('button', { name: 'Separate this line into its own model' }));
    const name = screen.getByLabelText('New model name');
    expect(name).toHaveValue('ship-orders-api');
    await user.clear(name);
    await user.type(name, 'mine');
    await user.click(screen.getByRole('button', { name: 'Copy the model' }));
    expect(op).toHaveBeenCalledWith({ op: 'separateModel', lineId: LINE_ID, model: 'mine' });
  });

  it('says nothing about sharing when the model is used once', async () => {
    await edit('build');
    expect(screen.queryByText(/shared by/)).not.toBeInTheDocument();
  });
});

describe('The belts of a piece', () => {
  it('lists where its boxes come from and where they go, and says when there is nowhere', async () => {
    await edit('checks');
    expect(screen.getByText('Comes from')).toBeInTheDocument();
    expect(screen.getByText(/"Build" → "Checks"/)).toBeInTheDocument();
    expect(screen.getByText(/"Checks" → "Launch"/)).toBeInTheDocument();
  });

  it('flags a piece with no way in or out', async () => {
    const f = makeFactory();
    f.sectors[0].lines[0].pieces.find((p) => p.id === 'checks')!.needs = [];
    f.sectors[0].lines[0].pieces.find((p) => p.id === 'launch')!.needs = [];
    await edit('checks', { factory: f });
    expect(screen.getByText('Nothing: connect a piece into this one.')).toBeInTheDocument();
    expect(screen.getByText('Nowhere yet.')).toBeInTheDocument();
  });

  it('adds a rule to a belt through the rule builder, and closes it once the draft accepts', async () => {
    const { op, user } = await edit('checks');
    await user.click(screen.getAllByRole('button', { name: 'Add rule' })[1]);
    await screen.findByRole('option', { name: 'tag' });
    await user.selectOptions(screen.getByLabelText('Field'), 'tag');
    await user.type(screen.getByLabelText('Value'), 'v1');
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(op).toHaveBeenCalledWith({ op: 'setRule', lineId: LINE_ID, from: 'checks', to: 'launch', back: undefined, when: "tag == 'v1'" });
    await waitFor(() => expect(screen.queryByLabelText('Field')).not.toBeInTheDocument());
  });

  it('removes a belt', async () => {
    const { op, user } = await edit('checks');
    await user.click(screen.getAllByRole('button', { name: 'Remove this belt' })[1]);
    expect(op).toHaveBeenCalledWith({ op: 'disconnect', lineId: LINE_ID, from: 'checks', to: 'launch', back: undefined });
  });

  it('connects to another piece through the floor', async () => {
    const { onConnect, user } = await edit('checks');
    await user.click(screen.getByRole('button', { name: 'Connect to…' }));
    expect(onConnect).toHaveBeenCalledWith('checks');
  });

  it('adds a new path from the piece, of the kind you pick', async () => {
    const { op, user } = await edit('checks');
    await user.click(screen.getByRole('button', { name: 'Add a new path from here' }));
    await user.click(screen.getByRole('button', { name: '+ gate' }));
    expect(op).toHaveBeenCalledWith({ op: 'insert', lineId: LINE_ID, at: { from: 'checks' }, kind: 'gate' });
  });

  it('sets the laps of a return belt', async () => {
    const f = makeFactory();
    f.sectors[0].lines[0].pieces.find((p) => p.id === 'build')!.needs.push({ from: 'launch', back: true, when: "decision.choice == 'revise'", laps: 2 });
    const { op, user } = await edit('build', { factory: f });
    await user.click(screen.getByRole('button', { name: 'Edit rule' }));
    await commit(user, 'Laps', '4');
    expect(op).toHaveBeenCalledWith({ op: 'setRule', lineId: LINE_ID, from: 'launch', to: 'build', back: true, laps: 4 });
  });
});

describe('The intake', () => {
  it('names the intake and edits the dispatch form field by field', async () => {
    const { op, user } = await edit('@intake');
    await commit(user, 'Intake name', 'Release tag!');
    expect(op).toHaveBeenLastCalledWith({ op: 'setIntake', lineId: LINE_ID, label: 'Release tag!' });

    await commit(user, 'Label', 'Version');
    expect(op).toHaveBeenLastCalledWith({ op: 'setIntake', lineId: LINE_ID, inputs: [{ name: 'tag', label: 'Version', required: true, placeholder: 'v4.18.0' }] });

    await user.click(screen.getByLabelText('long text'));
    expect(op).toHaveBeenLastCalledWith({ op: 'setIntake', lineId: LINE_ID, inputs: [{ name: 'tag', label: 'Tag', required: true, placeholder: 'v4.18.0', multiline: true }] });
  });

  it('adds a field with a name that is free, and removes one', async () => {
    const { op, user } = await edit('@intake');
    await user.click(screen.getByRole('button', { name: '+ field' }));
    expect(op).toHaveBeenLastCalledWith({ op: 'setIntake', lineId: LINE_ID, inputs: [expect.objectContaining({ name: 'tag' }), { name: 'field2' }] });
    await user.click(screen.getByRole('button', { name: 'Remove field' }));
    expect(op).toHaveBeenLastCalledWith({ op: 'setIntake', lineId: LINE_ID, inputs: [] });
  });
});

describe('A gate', () => {
  it('opens when you release it, by default, asking for the confirmations you set', async () => {
    const { op, user } = await edit('launch');
    expect(screen.getByLabelText('when you release it')).toBeChecked();
    await commit(user, 'Confirmations', '3');
    expect(op).toHaveBeenCalledWith({ op: 'setPiece', lineId: LINE_ID, pieceId: 'launch', gate: { kind: 'release', confirmations: 3 } });
  });

  it('can ask you to choose, with the choices you list', async () => {
    const { op, user } = await edit('launch');
    await user.click(screen.getByLabelText('when you choose'));
    expect(op).toHaveBeenLastCalledWith(expect.objectContaining({ op: 'setPiece', pieceId: 'launch', gate: expect.objectContaining({ kind: 'choices' }) }));
  });

  it('lists the choices of a decision gate as one field', async () => {
    const { op, user } = await edit('launch', { factory: withPiece('launch', { choices: ['ship', 'revise'] }) });
    expect(screen.getByLabelText('Choices')).toHaveValue('ship, revise');
    await commit(user, 'Choices', 'ship, revise, hold');
    expect(op).toHaveBeenLastCalledWith(expect.objectContaining({ gate: expect.objectContaining({ kind: 'choices', choices: ['ship', 'revise', 'hold'] }) }));
  });

  it('opens by itself on a rule, written with the rule builder over the box before it', async () => {
    const { op, user } = await edit('launch', { factory: withPiece('launch', { rule: 'ok == true', confirmations: undefined }) });
    expect(screen.queryByLabelText('Confirmations')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByRole('option', { name: 'ok' });
    await user.selectOptions(screen.getByLabelText('Field'), 'tag');
    await user.clear(screen.getByLabelText('Value'));
    await user.type(screen.getByLabelText('Value'), 'v1');
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(op).toHaveBeenCalledWith({ op: 'setPiece', lineId: LINE_ID, pieceId: 'launch', gate: { kind: 'rule', rule: "tag == 'v1'" } });
  });

  it('says a rule gate needs an input first', async () => {
    const f = withPiece('launch', { rule: 'ok == true', needs: [] });
    const { user } = await edit('launch', { factory: f });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Connect an input first; the rule reads its box.')).toBeInTheDocument();
  });
});

describe('A signal', () => {
  const sigFiles = { [`sectors/releases/models/ship/signals/checks.sh`]: '#!/bin/sh\nexit 0\n' };
  const withRun = (run: string) => withPiece('checks', { run });

  it('saves its command when you leave the field', async () => {
    const { op, user } = await edit('checks', { factory: withRun('echo hi') });
    const cmd = screen.getByLabelText('Command');
    await user.clear(cmd);
    await user.type(cmd, 'npm test');
    await user.tab();
    expect(op).toHaveBeenCalledWith({ op: 'setPiece', lineId: LINE_ID, pieceId: 'checks', run: 'npm test' });
  });

  it('sets its time limit', async () => {
    const { op, user } = await edit('checks');
    await commit(user, 'Timeout', '40m');
    expect(op).toHaveBeenCalledWith({ op: 'setPiece', lineId: LINE_ID, pieceId: 'checks', timeout: '40m' });
  });

  it('offers the fields of the box before it, to put in the command', async () => {
    const { op, user } = await edit('checks', { factory: withRun('check.sh') });
    await user.click(await screen.findByRole('button', { name: '{{box.tag}}' }));
    expect(screen.getByLabelText('Command')).toHaveValue('check.sh {{box.tag}}');
    expect(op).toHaveBeenCalledWith({ op: 'setPiece', lineId: LINE_ID, pieceId: 'checks', run: 'check.sh {{box.tag}}' });
  });

  it('shows the script it runs, and saves it as an executable file', async () => {
    const { op, user } = await edit('checks', { factory: withRun('signals/checks.sh'), files: sigFiles });
    const script = await screen.findByLabelText('Script');
    expect(script).toHaveValue('#!/bin/sh\nexit 0\n');
    await user.type(script, '# more');
    await user.tab();
    expect(op).toHaveBeenCalledWith({ op: 'writeFile', path: 'sectors/releases/models/ship/signals/checks.sh', content: '#!/bin/sh\nexit 0\n# more', executable: true });
  });

  it('says when the script it names is missing', async () => {
    await edit('checks', { factory: withRun('signals/gone.sh') });
    expect(await screen.findByText('signals/gone.sh does not exist yet.')).toBeInTheDocument();
  });

  it('writes a starter script for a signal that has none, and points the signal at it', async () => {
    const { op, user } = await edit('checks', { factory: withRun('true') });
    await user.click(screen.getByRole('button', { name: 'Write a script for this signal' }));
    const ops = (op.mock.calls[0][0] as Extract<BuildOp, { op: 'batch' }>).ops;
    expect(ops[0]).toMatchObject({ op: 'writeFile', path: 'sectors/releases/models/ship/signals/checks.sh', executable: true });
    expect(ops[1]).toEqual({ op: 'setPiece', lineId: LINE_ID, pieceId: 'checks', run: 'signals/checks.sh' });
  });
});

describe('A machine', () => {
  it('picks its agent, and says when it is the free simulated one', async () => {
    const { op, user } = await edit('build');
    expect(await screen.findByText('The simulated agent costs nothing.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Agent'), 'sim');
    expect(op).toHaveBeenCalledWith({ op: 'setMachine', lineId: LINE_ID, pieceId: 'build', conf: { agent: 'sim' } });
  });

  it('warns that real agents cost money', async () => {
    await edit('build', { files: { [`${MACHINE_DIR}/machine.yaml`]: 'agent: claude\n' } });
    expect(await screen.findByText('Real agents spend money on every run.')).toBeInTheDocument();
  });

  it('sets the model, the effort and the attempts, and never fewer than one attempt', async () => {
    const { op, user } = await edit('build');
    await commit(user, 'Model', 'opus');
    expect(op).toHaveBeenLastCalledWith(expect.objectContaining({ conf: { model: 'opus' } }));
    await user.selectOptions(screen.getByLabelText('Effort'), 'high');
    expect(op).toHaveBeenLastCalledWith(expect.objectContaining({ conf: { effort: 'high' } }));
    await commit(user, 'Attempts', '5');
    expect(op).toHaveBeenLastCalledWith(expect.objectContaining({ conf: { attempts: 5 } }));
    await commit(user, 'Attempts', '0');
    expect(op).toHaveBeenLastCalledWith(expect.objectContaining({ conf: { attempts: 1 } }));
  });

  it('lists the folders and the commands it may use', async () => {
    const { op, user } = await edit('build');
    await commit(user, 'Folders', '~/repos/a, ~/repos/b');
    expect(op).toHaveBeenLastCalledWith(expect.objectContaining({ conf: { dirs: ['~/repos/a', '~/repos/b'] } }));
    await commit(user, 'Allowed commands', 'gh pr view, npm test');
    expect(op).toHaveBeenLastCalledWith(expect.objectContaining({ conf: { allow: ['gh pr view', 'npm test'] } }));
  });

  it('lists the commands it must never run, and makes it read-only', async () => {
    const { op, user } = await edit('build');
    await commit(user, 'Never allowed', 'rm -rf, git push --force');
    expect(op).toHaveBeenLastCalledWith(expect.objectContaining({ conf: { deny: ['rm -rf', 'git push --force'] } }));
    await commit(user, 'Acts outside', 'git push, gh pr create');
    expect(op).toHaveBeenLastCalledWith(expect.objectContaining({ conf: { outward: ['git push', 'gh pr create'] } }));
    await user.click(screen.getByLabelText('Read-only'));
    expect(op).toHaveBeenLastCalledWith(expect.objectContaining({ conf: { read_only: true } }));
  });

  describe('tools', () => {
    const tools = { [`${MACHINE_DIR}/machine.yaml`]: 'agent: claude\ntools: [mcp__slack__post, mcp__ghost__x]\n' };

    it('shows the tools it has, and marks one whose server is not configured', async () => {
      await edit('build', { files: tools });
      expect(await screen.findByTitle('mcp__slack__post')).toBeInTheDocument();
      expect(await screen.findByTitle('No MCP server "ghost" in Claude Code')).toHaveClass('warn');
    });

    it('adds a whole server from the list, or one tool by name, and removes one', async () => {
      const { op, user } = await edit('build', { files: tools });
      await user.selectOptions(await screen.findByLabelText('Add a whole MCP server'), 'jira');
      expect(op).toHaveBeenLastCalledWith(expect.objectContaining({ conf: { tools: ['mcp__slack__post', 'mcp__ghost__x', 'mcp__jira'] } }));
      await user.type(screen.getByLabelText('One tool'), 'mcp__jira__get_issue');
      await user.click(screen.getByRole('button', { name: 'Add tool' }));
      expect(op).toHaveBeenLastCalledWith(expect.objectContaining({ conf: { tools: ['mcp__slack__post', 'mcp__ghost__x', 'mcp__jira__get_issue'] } }));
      await user.click(screen.getByRole('button', { name: 'Remove mcp__slack__post' }));
      expect(op).toHaveBeenLastCalledWith(expect.objectContaining({ conf: { tools: ['mcp__ghost__x'] } }));
    });

    it('refuses a tool name of the wrong shape or from a server that is not there', async () => {
      const { user } = await edit('build', { files: tools });
      await screen.findByLabelText('Add a whole MCP server');
      await user.type(screen.getByLabelText('One tool'), 'ghost');
      expect(screen.getByRole('button', { name: 'Add tool' })).toBeDisabled();
      expect(screen.getByText(/Use mcp__server__tool/)).toBeInTheDocument();
      await user.clear(screen.getByLabelText('One tool'));
      await user.type(screen.getByLabelText('One tool'), 'mcp__ghost__x');
      expect(screen.getByRole('button', { name: 'Add tool' })).toBeDisabled();
    });

    it('says the servers could not be checked when Claude Code is not there', async () => {
      await edit('build', { files: tools, servers: null });
      expect(await screen.findByText(/server names are not checked/)).toBeInTheDocument();
      expect(screen.queryByLabelText('Add a whole MCP server')).not.toBeInTheDocument();
    });
  });

  describe('role', () => {
    it('edits the machine\'s own role, and previews it as Markdown', async () => {
      const { op, user } = await edit('build');
      const role = await screen.findByLabelText('Role');
      expect(role).toHaveValue('You build.\n');
      await user.type(role, 'Be brief.');
      await user.tab();
      expect(op).toHaveBeenLastCalledWith({ op: 'writeFile', path: `${MACHINE_DIR}/role.md`, content: 'You build.\nBe brief.' });
      await user.click(screen.getByRole('button', { name: 'Preview' }));
      expect(screen.getByText('You build.')).toBeInTheDocument();
    });

    it('uses a shared role from the library, and stops using one', async () => {
      const files = { [`${MACHINE_DIR}/machine.yaml`]: 'agent: sim\nroles: [shared/roles/style.md]\n', 'shared/roles/style.md': '# style\n' };
      const { op, user } = await edit('build', { files, roles: [{ path: 'shared/roles/style.md', machines: ['a/build', 'b/build'], lines: 2 }] });
      expect(await screen.findByText(/used by 2 machines in 2 lines/)).toBeInTheDocument();
      await user.selectOptions(screen.getByLabelText('Use a shared role'), 'shared/roles/team.md');
      expect(op).toHaveBeenLastCalledWith(expect.objectContaining({ conf: { roles: ['shared/roles/style.md', 'shared/roles/team.md'] } }));
      await user.click(screen.getByRole('button', { name: 'Stop using shared/roles/style.md' }));
      expect(op).toHaveBeenLastCalledWith(expect.objectContaining({ conf: { roles: [] } }));
    });

    it('warns, when you open a shared role, how many machines the edit changes', async () => {
      const files = { [`${MACHINE_DIR}/machine.yaml`]: 'agent: sim\nroles: [shared/roles/style.md]\n', 'shared/roles/style.md': '# style\n' };
      const { user } = await edit('build', { files, roles: [{ path: 'shared/roles/style.md', machines: ['a/build', 'b/qa'], lines: 2 }] });
      await user.click(await screen.findByRole('button', { name: 'Edit' }));
      expect(screen.getByText(/Editing this changes 2 machines in 2 lines: build, qa/)).toBeInTheDocument();
    });

    it('writes a new shared role and uses it, with a name made of lowercase words', async () => {
      const { op, user } = await edit('build');
      const name = await screen.findByLabelText('New shared role name');
      const create = screen.getByRole('button', { name: 'New shared role' });
      await user.type(name, 'Bad Name');
      expect(create).toBeDisabled();
      await user.clear(name);
      await user.type(name, 'reviewer');
      await user.click(create);
      const ops = (op.mock.calls.at(-1)![0] as Extract<BuildOp, { op: 'batch' }>).ops;
      expect(ops[0]).toEqual({ op: 'writeFile', path: 'shared/roles/reviewer.md', content: '# reviewer\n\n' });
      expect(ops[1]).toMatchObject({ op: 'setMachine', conf: { roles: ['shared/roles/reviewer.md'] } });
    });
  });

  describe('contract', () => {
    const written = (op: Awaited<ReturnType<typeof edit>>['op']) => JSON.parse((op.mock.calls.at(-1)![0] as Extract<BuildOp, { op: 'writeFile' }>).content);

    it('lists the fields the agent must answer with', async () => {
      await edit('build');
      expect(await screen.findByLabelText('Field')).toHaveValue('ok');
      expect(screen.getByLabelText('Type')).toHaveValue('boolean');
      expect(screen.getByLabelText('required')).toBeChecked();
    });

    it('adds a field with a name that is free', async () => {
      const { op, user } = await edit('build');
      await user.click(await screen.findByRole('button', { name: '+ field' }));
      expect(written(op).properties).toEqual({ ok: { type: 'boolean' }, field: { type: 'string' } });
    });

    it('renames a field and keeps it required, and refuses a name another field has', async () => {
      const { op, user } = await edit('build');
      await screen.findByLabelText('Field');
      await user.click(screen.getByRole('button', { name: '+ field' }));
      await commit(user, 'Field', 'done');
      expect(written(op).required).toEqual(['done']);

    });

    it('refuses a name another field already has, and says so', async () => {
      const two = JSON.stringify({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } });
      const { op, user } = await edit('build', { files: { [`${MACHINE_DIR}/contract.json`]: two } });
      await screen.findAllByLabelText('Field');
      await commit(user, 'Field', 'a', 1);
      expect(await screen.findByText('There is already a field "a".')).toBeInTheDocument();
      expect(op.mock.calls.filter(([o]) => o.op === 'writeFile')).toHaveLength(0);
    });

    it('changes a field\'s type, its allowed values and whether it is required', async () => {
      const { op, user } = await edit('build');
      await user.selectOptions(await screen.findByLabelText('Type'), 'string');
      expect(written(op).properties.ok.type).toBe('string');
      await commit(user, 'Allowed values', 'yes, no');
      expect(written(op).properties.ok.enum).toEqual(['yes', 'no']);
      await user.click(screen.getByLabelText('required'));
      expect(written(op).required).toEqual([]);
    });

    it('removes a field', async () => {
      const { op, user } = await edit('build');
      await user.click(await screen.findByRole('button', { name: 'Remove field ok' }));
      expect(written(op).properties).toEqual({});
    });

    it('can be edited as JSON, and refuses JSON that does not parse', async () => {
      const { op, user } = await edit('build');
      await user.click(await screen.findByRole('button', { name: 'Edit as JSON' }));
      const box = screen.getByLabelText('Contract JSON');
      await user.clear(box);
      await user.type(box, '{{ nope');
      await user.tab();
      expect(await screen.findByText(/JSON/, { selector: '.err' })).toBeInTheDocument();
      await user.clear(box);
      await user.click(box);
      await user.paste('{"type":"object"}');
      await user.tab();
      expect(op).toHaveBeenLastCalledWith({ op: 'writeFile', path: `${MACHINE_DIR}/contract.json`, content: '{"type":"object"}\n' });
    });

    it('shows a contract that is not valid JSON as text to fix', async () => {
      await edit('build', { files: { [`${MACHINE_DIR}/contract.json`]: '{ broken' } });
      expect(await screen.findByText('The contract is not valid JSON; fix it here.')).toBeInTheDocument();
    });
  });
});

