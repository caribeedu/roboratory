// Talking to the managers: you ask, the answer comes with evidence, and anything it suggests is a button you decide on.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Megaphone } from './Megaphone';
import { installBridge, LINE_ID, makeFactory, settle, type FakeBridge } from '../../test/ui';
import type { ManagerMessage, Proposal } from '../../shared/types';

const factory = makeFactory();
const sector = factory.sectors[0];
const message = (over: Partial<ManagerMessage>): ManagerMessage => ({ id: 'm1', t: Date.now(), from: 'manager', text: 'Here is what I see.', ...over });

let bridge: FakeBridge;
/** Renders the megaphone; with messages, the conversation is opened, as it is when you click the arrow. */
async function setup(messages: ManagerMessage[] = []) {
  bridge = installBridge({ messages: vi.fn(async () => messages) });
  const notify = vi.fn();
  const onThinking = vi.fn();
  const onEvidence = vi.fn();
  render(<Megaphone factory={factory} sector={sector} msgTick={{}} notify={notify} onThinking={onThinking} onEvidence={onEvidence} />);
  const user = userEvent.setup();
  await settle();
  if (messages.length) await user.click(screen.getByRole('button', { name: 'Show conversation' }));
  return { notify, onThinking, onEvidence, user };
}

describe('Asking a manager', () => {
  it('sends your question to the sector manager and clears the box', async () => {
    const { user } = await setup();
    const box = screen.getByRole('textbox', { name: 'Message the Releases Manager' });
    await user.type(box, 'Why did it stop?');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(bridge.api.ask).toHaveBeenCalledWith({ kind: 'sector', sectorId: 'releases' }, 'Why did it stop?');
    expect(box).toHaveValue('');
  });

  it('cannot send an empty question', async () => {
    await setup();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('puts a suggestion in the box for you to edit before sending', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Add a smoke signal' }));
    expect(screen.getByRole('textbox', { name: 'Message the Releases Manager' })).toHaveValue('Add a smoke signal');
  });

  it('switches to the General Manager, whose questions are about the whole factory', async () => {
    const { user } = await setup();
    await user.click(screen.getByTitle('Switch between the Sector Manager and the General Manager'));
    await user.type(screen.getByRole('textbox', { name: 'Message the General Manager' }), 'Where are we slow?');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(bridge.api.ask).toHaveBeenCalledWith({ kind: 'factory' }, 'Where are we slow?');
  });

  it('tells you when the manager could not be asked', async () => {
    const { user, notify } = await setup();
    bridge.api.ask.mockRejectedValueOnce(new Error("Error invoking remote method 'ask': Error: No factory is open."));
    await user.type(screen.getByRole('textbox', { name: 'Message the Releases Manager' }), 'hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('No factory is open.', 'fail'));
  });
});

describe('A manager\'s answer', () => {
  it('shows the conversation, and a note that the manager is thinking while it works', async () => {
    const { onThinking } = await setup([message({ id: 'q', from: 'you', text: 'What needs me?' }), message({ id: 'a', pending: true, text: '' })]);
    expect(await screen.findByText('Thinking…')).toBeInTheDocument();
    expect(onThinking).toHaveBeenCalledWith('releases', true);
  });

  it('turns evidence into buttons that take you to it', async () => {
    const { user, onEvidence } = await setup([message({ evidence: [{ lineId: LINE_ID, pieceId: 'build', note: 'it burned' }, { runId: 'run-4' }] })]);
    await user.click(await screen.findByRole('button', { name: 'orders-api · build' }));
    expect(onEvidence).toHaveBeenCalledWith({ lineId: LINE_ID, pieceId: 'build', note: 'it burned' });
    expect(screen.getByRole('button', { name: 'run run-4' })).toBeInTheDocument();
  });

  it('shows an error instead of an answer when the manager failed', async () => {
    await setup([message({ error: 'The agent exited with 1' })]);
    expect(await screen.findByText('The agent exited with 1')).toHaveClass('err');
  });
});

describe('A manager\'s proposals', () => {
  const patch: Proposal = {
    id: 'p1', kind: 'patch', status: 'open', why: 'A smoke signal catches a bad deploy early.',
    files: [{ path: 'sectors/releases/models/ship/line.yaml', before: 'a: 1\n', content: 'a: 1\nsmoke: true\n' }],
  };
  const release: Proposal = { id: 'p2', kind: 'verb', verb: 'release', status: 'open', why: 'CI is green.', target: { lineId: LINE_ID, pieceId: 'launch' } };

  it('shows a change as a diff, and writes the files only when you accept', async () => {
    const { user, notify } = await setup([message({ proposals: [patch] })]);
    expect(await screen.findByText('Change 1 file')).toBeInTheDocument();
    const diff = screen.getByText('sectors/releases/models/ship/line.yaml').closest('.diff') as HTMLElement;
    expect(within(diff).getByText(/\+ smoke: true/)).toBeInTheDocument();
    expect(bridge.api.acceptProposal).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Accept (write files)' }));
    expect(bridge.api.acceptProposal).toHaveBeenCalledWith({ kind: 'sector', sectorId: 'releases' }, 'm1', 'p1', 0);
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Files written. Commit them when you are ready.', 'ok'));
  });

  it('rejects a change without writing anything', async () => {
    const { user } = await setup([message({ proposals: [patch] })]);
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(bridge.api.rejectProposal).toHaveBeenCalledWith({ kind: 'sector', sectorId: 'releases' }, 'm1', 'p1');
    expect(bridge.api.acceptProposal).not.toHaveBeenCalled();
  });

  it('asks you to confirm a release as many times as the gate asks, then runs it', async () => {
    const { user } = await setup([message({ proposals: [release] })]);
    await user.click(await screen.findByRole('button', { name: 'Release Launch' }));
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    expect(screen.getByText('Are you really sure?')).toBeInTheDocument();
    expect(bridge.api.acceptProposal).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Yes, release' }));
    expect(bridge.api.acceptProposal).toHaveBeenCalledWith({ kind: 'sector', sectorId: 'releases' }, 'm1', 'p2', 2);
  });

  it('starts over when you cancel a confirmation', async () => {
    const { user } = await setup([message({ proposals: [release] })]);
    await user.click(await screen.findByRole('button', { name: 'Release Launch' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Release Launch' })).toBeInTheDocument();
    expect(bridge.api.rejectProposal).not.toHaveBeenCalled();
  });

  it('tells you a proposal was already dealt with, and offers no buttons', async () => {
    await setup([message({ proposals: [{ ...patch, status: 'applied' }, { ...release, status: 'auto' }] })]);
    expect(await screen.findByText('applied')).toBeInTheDocument();
    expect(screen.getByText('done by the manager (policy)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });
});
