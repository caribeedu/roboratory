// The pieces of build mode that decide what is written: the save dialog, the rule builder and the fields that commit on leaving.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Commit, GoalField, ListField, slug } from './forms';
import { fromRule, RuleBuilder, toRule } from './RuleBuilder';
import { SaveDialog } from './SaveDialog';
import { installBridge, LINE_ID, makeFactory, type FakeBridge } from '../../test/ui';
import type { BuildView, FieldInfo } from '../../shared/build';
import { GOAL_MAX } from '../../shared/types';

const view = (over: Partial<BuildView> = {}): BuildView => ({
  sectorId: 'releases', factory: makeFactory(), issues: [], changes: [], affected: [], roles: [], canUndo: false, canRedo: false, blocked: [], ...over,
});
const change = (path: string, over = {}) => ({ path, status: 'changed' as const, before: 'a: 1\n', after: 'a: 2\n', ...over });

describe('The save dialog', () => {
  function open(v: BuildView, reason?: string) {
    const onSave = vi.fn(), onDiscard = vi.fn(), onClose = vi.fn();
    render(<SaveDialog view={v} reason={reason} onSave={onSave} onDiscard={onDiscard} onClose={onClose} />);
    return { onSave, onDiscard, onClose, user: userEvent.setup() };
  }

  it('counts the files it will write, and writes them when you say so', async () => {
    const { user, onSave } = open(view({ changes: [change('a.yaml'), change('b.yaml')] }));
    expect(screen.getByRole('heading', { name: 'Save 2 file changes?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save the files' }));
    expect(onSave).toHaveBeenCalledWith({});
  });

  it('shows the diff of a file when you open it, and of the only file at once', async () => {
    const { user } = open(view({ changes: [change('a.yaml'), change('b.yaml')] }));
    expect(screen.queryByText(/a: 2/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /a\.yaml/ }));
    expect(screen.getByText(/\+ a: 2/)).toBeInTheDocument();
  });

  it('opens the diff of a single changed file without being asked', () => {
    open(view({ changes: [change('only.yaml')] }));
    expect(screen.getByText(/\+ a: 2/)).toBeInTheDocument();
  });

  it('will not save while something blocks it, and says what', () => {
    open(view({ changes: [change('a.yaml')], blocked: ['A run is in progress on orders-api releases.'] }));
    expect(screen.getByText(/run is in progress/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save the files' })).toBeDisabled();
  });

  it('will not save a draft with nothing in it', () => {
    open(view());
    expect(screen.getByRole('heading', { name: 'Nothing to save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save the files' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Leave build mode' })).toBeInTheDocument();
  });

  it('asks which version of a file changed on disk to keep before it saves, and passes the choice on', async () => {
    const { user, onSave } = open(view({ changes: [change('role.md', { conflict: true })] }));
    expect(screen.getByText(/Changed on disk during this session/)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save the files' });
    expect(save).toBeDisabled();
    await user.click(screen.getByLabelText('take the one on disk'));
    expect(save).toBeEnabled();
    await user.click(save);
    expect(onSave).toHaveBeenCalledWith({ 'role.md': 'disk' });
  });

  it('asks twice before it throws the changes away', async () => {
    const { user, onDiscard } = open(view({ changes: [change('a.yaml')] }));
    await user.click(screen.getByRole('button', { name: 'Discard everything' }));
    expect(screen.getByText('Discard 1 change?')).toBeInTheDocument();
    expect(onDiscard).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Yes, discard' }));
    expect(onDiscard).toHaveBeenCalled();
  });

  it('lets you go on editing', async () => {
    const { user, onClose } = open(view({ changes: [change('a.yaml')] }), 'Save or discard your build changes to open the Ledger.');
    expect(screen.getByText(/to open the Ledger/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('warns that a summary comment at the top of a file may be stale after the structure changed', () => {
    open(view({ changes: [change('line.yaml', { staleComment: true })] }));
    expect(screen.getByText('summary comment may be stale')).toBeInTheDocument();
  });

  it('names the lines the change reaches, including those in other sectors', () => {
    open(view({ changes: [change('a.yaml')], affected: [{ lineId: LINE_ID, name: 'orders-api releases', sectorId: 'releases', running: false }, { lineId: 'incidents/x', name: 'x incidents', sectorId: 'incidents', running: false }] }));
    expect(screen.getByText(/orders-api releases, x incidents/)).toBeInTheDocument();
    expect(screen.getByText(/including lines in other sectors/)).toBeInTheDocument();
  });
});

describe('Rules in words and in symbols', () => {
  const fields: FieldInfo[] = [{ path: 'verdict', type: 'string', values: ['pass', 'fail'] }, { path: 'confidence', type: 'number' }, { path: 'ready', type: 'boolean' }];

  it('writes text values in quotes and numbers and booleans bare', () => {
    expect(toRule([{ field: 'verdict', op: '==', value: 'pass' }], '&&', fields)).toBe("verdict == 'pass'");
    expect(toRule([{ field: 'confidence', op: '>=', value: '0.7' }], '&&', fields)).toBe('confidence >= 0.7');
    expect(toRule([{ field: 'ready', op: '==', value: 'true' }], '&&', fields)).toBe('ready == true');
  });

  it('writes a list of values, and joins conditions as all or any', () => {
    expect(toRule([{ field: 'verdict', op: 'in', value: 'pass, fail' }], '&&', fields)).toBe("verdict in ['pass', 'fail']");
    expect(toRule([{ field: 'verdict', op: '==', value: 'pass' }, { field: 'confidence', op: '>', value: '1' }], '||', fields)).toBe("verdict == 'pass' || confidence > 1");
  });

  it('leaves out a row with no field or no value', () => {
    expect(toRule([{ field: '', op: '==', value: 'x' }, { field: 'verdict', op: '==', value: '' }], '&&', fields)).toBe('');
  });

  it('reads a rule back into rows when it is a flat list, and gives up on anything else', () => {
    expect(fromRule("verdict == 'pass' && confidence >= 0.7")).toEqual({ join: '&&', rows: [{ field: 'verdict', op: '==', value: 'pass' }, { field: 'confidence', op: '>=', value: '0.7' }] });
    expect(fromRule("verdict in ['a', 'b']")).toEqual({ join: '&&', rows: [{ field: 'verdict', op: 'in', value: 'a, b' }] });
    expect(fromRule('')).toEqual({ join: '&&', rows: [] });
    expect(fromRule("a == 1 && b == 2 || c == 3")).toBeNull();
    expect(fromRule('!(a == 1)')).toBeNull();
  });
});

describe('The rule builder', () => {
  const fields: FieldInfo[] = [{ path: 'verdict', type: 'string', values: ['pass', 'fail'] }, { path: 'confidence', type: 'number' }];
  let bridge: FakeBridge;

  function open(over: { value?: string; required?: boolean; open?: boolean } = {}) {
    bridge = installBridge({ buildFields: vi.fn(async () => ({ fields, open: over.open ?? false })) });
    const onSave = vi.fn(), onCancel = vi.fn();
    render(<RuleBuilder lineId={LINE_ID} from="qa" value={over.value} required={over.required} onSave={onSave} onCancel={onCancel} />);
    return { onSave, onCancel, user: userEvent.setup() };
  }

  it('asks the engine which fields the box really has, for the belt it is about', async () => {
    open();
    await waitFor(() => expect(bridge.api.buildFields).toHaveBeenCalledWith(LINE_ID, 'qa', undefined));
    expect(await screen.findByRole('option', { name: 'verdict' })).toBeInTheDocument();
  });

  it('builds a rule from a field, a comparison and one of the values the field can take', async () => {
    const { user, onSave } = open();
    await screen.findByRole('option', { name: 'verdict' });
    await user.selectOptions(screen.getByLabelText('Field'), 'verdict');
    await user.selectOptions(screen.getByLabelText('Value'), 'pass');
    expect(screen.getByText(/Taken when/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(onSave).toHaveBeenCalledWith("verdict == 'pass'");
  });

  it('combines two conditions, all must hold or any may', async () => {
    const { user, onSave } = open();
    await screen.findByRole('option', { name: 'verdict' });
    await user.selectOptions(screen.getByLabelText('Field'), 'confidence');
    await user.type(screen.getByLabelText('Value'), '0.5');
    await user.click(screen.getByRole('button', { name: '+ condition' }));
    const fieldsSelects = screen.getAllByLabelText('Field');
    await user.selectOptions(fieldsSelects[1], 'verdict');
    await user.selectOptions(screen.getAllByLabelText('Value')[1], 'fail');
    await user.selectOptions(screen.getByLabelText('Combine conditions'), '||');
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(onSave).toHaveBeenCalledWith("confidence == 0.5 || verdict == 'fail'");
  });

  it('shows an existing rule in rows', async () => {
    open({ value: "verdict == 'fail'" });
    await screen.findByRole('option', { name: 'verdict' });
    expect(screen.getByLabelText('Field')).toHaveValue('verdict');
    expect(screen.getByLabelText('Value')).toHaveValue('fail');
  });

  it('takes a rule written as text, and refuses one that does not parse', async () => {
    const { user, onSave } = open({ value: "a == 1 && b == 2 || c == 3" });
    const text = await screen.findByLabelText('Rule');
    expect(text).toHaveValue('a == 1 && b == 2 || c == 3');
    await user.clear(text);
    fireEvent.change(text, { target: { value: 'verdict ==' } });
    expect(screen.getByRole('button', { name: 'Save rule' })).toBeDisabled();
    fireEvent.change(text, { target: { value: "verdict == 'pass'" } });
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(onSave).toHaveBeenCalledWith("verdict == 'pass'");
  });

  it('saves no rule when none is written, unless the belt needs one', async () => {
    const { user, onSave } = open();
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it('will not save an empty rule for a return belt, and says it needs one', async () => {
    open({ required: true });
    expect(screen.getByText('A return belt needs a rule.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save rule' })).toBeDisabled();
  });

  it('says any field is accepted when the box before the belt has no declared shape', async () => {
    open({ open: true });
    expect(await screen.findByText(/has no declared shape/)).toBeInTheDocument();
  });

  it('cancels', async () => {
    const { user, onCancel } = open();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('Fields that save when you leave them', () => {
  it('commit on leaving and on Enter, not on every keystroke, and not when nothing changed', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Commit label="Name" value="Deployer" onCommit={onCommit} />);
    const field = screen.getByLabelText('Name');
    await user.type(field, 'X');
    expect(onCommit).not.toHaveBeenCalled();
    await user.tab();
    expect(onCommit).toHaveBeenCalledWith('DeployerX');

    // the draft now holds the new value; leaving the field again changes nothing
    onCommit.mockClear();
    rerender(<Commit label="Name" value="DeployerX" onCommit={onCommit} />);
    await user.click(field);
    await user.tab();
    expect(onCommit).not.toHaveBeenCalled();

    await user.type(field, 'Y{Enter}');
    expect(onCommit).toHaveBeenCalledWith('DeployerXY');
  });

  it('show what the draft holds again when the value changes under them', () => {
    const { rerender } = render(<Commit label="Name" value="One" onCommit={vi.fn()} />);
    rerender(<Commit label="Name" value="Two" onCommit={vi.fn()} />);
    expect(screen.getByLabelText('Name')).toHaveValue('Two');
  });

  it('keep a goal within its length and count it', async () => {
    const user = userEvent.setup();
    render(<GoalField value="" onCommit={vi.fn()} />);
    const box = screen.getByLabelText('Goal');
    expect(box).toHaveAttribute('maxlength', String(GOAL_MAX));
    await user.type(box, 'Find what is wrong.');
    expect(screen.getByText(`19/${GOAL_MAX}`)).toBeInTheDocument();
  });

  it('edit a list as comma-separated words', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<ListField label="Choices" value={['ship', 'revise']} onCommit={onCommit} />);
    const box = screen.getByLabelText('Choices');
    expect(box).toHaveValue('ship, revise');
    await user.clear(box);
    await user.type(box, ' go ,, stop ');
    await user.tab();
    expect(onCommit).toHaveBeenCalledWith(['go', 'stop']);
  });

  it('turn a name into a folder-safe id', () => {
    expect(slug('Ship to Prod!')).toBe('ship-to-prod');
    expect(slug('  Déploiement   rapide ')).toBe('deploiement-rapide');
    expect(slug('a_b  c')).toBe('a-b-c');
  });
});

