// The panel of a piece: whatever needs you is a button here. These tests do what a person does with it.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Inspector } from './Inspector';
import { installBridge, LINE_ID, makeFactory, snapshot, type FakeBridge } from '../../test/ui';
import type { PieceView, Snapshot } from '../../shared/types';

let bridge: FakeBridge;
beforeEach(() => { bridge = installBridge(); });

/** Opens the panel of one piece, with the action wrapper the app gives it. */
function open(pieceId: string, states: Record<string, Partial<PieceView>>, over: { snapshot?: Partial<Snapshot>; confirmations?: number; factory?: Snapshot['factory'] } = {}) {
  const act = vi.fn(async (fn: () => Promise<unknown>) => { await fn(); });
  const notify = vi.fn();
  const onClose = vi.fn();
  const onOpenRun = vi.fn();
  const snap = snapshot({ states, confirmations: over.confirmations, ...over.snapshot });
  if (over.factory) snap.factory = over.factory;
  render(<Inspector selection={{ kind: 'piece', lineId: LINE_ID, pieceId, live: true }} snapshot={snap} logs={[]} act={act} notify={notify} onClose={onClose} onOpenRun={onOpenRun} />);
  return { act, notify, onClose, onOpenRun, user: userEvent.setup() };
}

describe('A machine on fire', () => {
  const fire = { state: 'fire' as const, error: '2/2 attempts used. Last error: output must have required property ok', runId: 'run-7' };

  it('says why it stopped', () => {
    open('build', { build: fire });
    expect(screen.getByRole('heading', { name: 'Why it stopped' })).toBeInTheDocument();
    expect(screen.getByText(/2\/2 attempts used/)).toBeInTheDocument();
  });

  it('retries with the hint you wrote', async () => {
    const { user } = open('build', { build: fire });
    await user.type(screen.getByLabelText('Hint for the retry (optional)'), 'look at the lock file');
    await user.click(screen.getByRole('button', { name: 'Retry with hint' }));
    expect(bridge.api.retry).toHaveBeenCalledWith(LINE_ID, 'build', 'look at the lock file');
  });

  it('retries with no hint when you wrote none', async () => {
    const { user } = open('build', { build: fire });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(bridge.api.retry).toHaveBeenCalledWith(LINE_ID, 'build', '');
  });

  it('lets you halt the line, or open the run, from there', async () => {
    const { user, onOpenRun } = open('build', { build: fire });
    await user.click(screen.getByRole('button', { name: 'Halt line' }));
    expect(bridge.api.halt).toHaveBeenCalledWith(LINE_ID);
    await user.click(screen.getByRole('button', { name: 'Open run' }));
    expect(onOpenRun).toHaveBeenCalledWith('run-7');
  });

  it('does not offer to halt a line that is already halted', () => {
    open('build', { build: fire }, { snapshot: { lines: { [LINE_ID]: { ...snapshot().lines[LINE_ID], halted: true, pieces: { ...snapshot({ states: { build: fire } }).lines[LINE_ID].pieces } } } } });
    expect(screen.queryByRole('button', { name: 'Halt line' })).not.toBeInTheDocument();
  });
});

describe('A machine that asks you', () => {
  const asking = { state: 'asking' as const, runId: 'run-3', question: { question: 'Which service?', options: ['orders-api', 'storefront'], recommendation: 'orders-api, it owns the table' } };

  it('shows the question and its recommendation', async () => {
    const { user } = open('build', { build: asking });
    expect(screen.getByText('Which service?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Its recommendation/ }));
    expect(screen.getByText(/it owns the table/)).toBeInTheDocument();
  });

  it('cannot be answered with nothing', () => {
    open('build', { build: asking });
    expect(screen.getByRole('button', { name: 'Send answer' })).toBeDisabled();
  });

  it('answers with an option you pick, as it is', async () => {
    const { user } = open('build', { build: asking });
    await user.click(screen.getByRole('button', { name: 'storefront' }));
    expect(screen.getByLabelText('Your answer')).toHaveValue('storefront');
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(bridge.api.answer).toHaveBeenCalledWith(LINE_ID, 'build', 'storefront');
  });

  it('answers with your own words', async () => {
    const { user } = open('build', { build: asking });
    await user.type(screen.getByLabelText('Your answer'), 'both, one after the other');
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(bridge.api.answer).toHaveBeenCalledWith(LINE_ID, 'build', 'both, one after the other');
  });
});

describe('A machine that asks to run a command', () => {
  const working = { state: 'busy' as const, runId: 'run-4', permissions: [{ id: 'ab12cd34', tool: 'Bash', summary: 'npm test && curl example.com', since: Date.now() - 30_000 }] };

  it('shows the command it asks for, and that it is paused until you answer', () => {
    open('build', { build: working });
    const card = screen.getByRole('form', { name: 'Permission request' });
    expect(within(card).getByText('npm test && curl example.com')).toBeInTheDocument();
    expect(card).toHaveTextContent('paused until you answer');
  });

  it('lets it run this once', async () => {
    const { user } = open('build', { build: working });
    await user.click(screen.getByRole('button', { name: 'Allow once' }));
    expect(bridge.api.allow).toHaveBeenCalledWith('ab12cd34');
  });

  it('refuses it with the reason you wrote, which is what the agent reads', async () => {
    const { user } = open('build', { build: working });
    await user.type(screen.getByLabelText(/refuse it, with a reason/), 'Use npm run lint:ci; this line may not call out.');
    await user.click(screen.getByRole('button', { name: 'Deny' }));
    expect(bridge.api.deny).toHaveBeenCalledWith('ab12cd34', 'Use npm run lint:ci; this line may not call out.');
  });

  it('can be refused with no reason', async () => {
    const { user } = open('build', { build: working });
    await user.click(screen.getByRole('button', { name: 'Deny' }));
    expect(bridge.api.deny).toHaveBeenCalledWith('ab12cd34', '');
  });

  it('shows one card for each command it waits on', () => {
    open('build', { build: { ...working, permissions: [...working.permissions, { id: 'ef56', tool: 'WebFetch', summary: 'WebFetch {"url":"https://example.com"}', since: Date.now() }] } });
    expect(screen.getAllByRole('form', { name: 'Permission request' })).toHaveLength(2);
  });

  it('shows nothing of the kind while it works inside its list', () => {
    open('build', { build: { state: 'busy' as const, runId: 'run-4' } });
    expect(screen.queryByRole('form', { name: 'Permission request' })).not.toBeInTheDocument();
  });
});

describe('A gate that waits for you', () => {
  const holding = { state: 'holding' as const, runId: 'run-5', since: Date.now() - 65_000 };

  it('needs each confirmation it asks for before it releases the box', async () => {
    const { user } = open('launch', { launch: holding }, { confirmations: 2 });
    await user.click(screen.getByRole('button', { name: 'Release' }));
    expect(screen.getByText('Confirmation 1 of 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    expect(screen.getByText('Confirmation 2 of 2')).toBeInTheDocument();
    expect(bridge.api.release).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Yes, release' }));
    expect(bridge.api.release).toHaveBeenCalledWith(LINE_ID, 'launch', 2);
  });

  it('starts over when you cancel', async () => {
    const { user } = open('launch', { launch: holding }, { confirmations: 2 });
    await user.click(screen.getByRole('button', { name: 'Release' }));
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Release' })).toBeInTheDocument();
    expect(bridge.api.release).not.toHaveBeenCalled();
  });

  it('releases after one confirmation when that is all it asks for', async () => {
    const { user } = open('launch', { launch: holding }, { confirmations: 1 });
    await user.click(screen.getByRole('button', { name: 'Release' }));
    await user.click(screen.getByRole('button', { name: 'Yes, release' }));
    expect(bridge.api.release).toHaveBeenCalledWith(LINE_ID, 'launch', 1);
  });

  it('shows what the signals before it said', () => {
    open('launch', { launch: holding, checks: { state: 'passed', lastBox: { ok: true } } });
    expect(screen.getByRole('button', { name: /Signals before this gate/ })).toBeInTheDocument();
    const row = screen.getByText('Checks').closest('li')!;
    expect(within(row).getByText('passed')).toBeInTheDocument();
  });

  it('says there is nothing to release when nothing waits', () => {
    open('launch', { launch: { state: 'idle' } });
    expect(screen.getByText('Nothing is waiting here right now.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Release' })).not.toBeInTheDocument();
  });

  it('offers to release a box its rule does not accept, and says why it was held', async () => {
    const { user } = open('launch', { launch: { ...holding, error: 'Rule "confidence >= 0.7" does not hold for this box.' } }, { factory: makeFactory({ rule: 'confidence >= 0.7' }) });
    expect(screen.getByText(/does not hold/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Release anyway' }));
    await user.click(screen.getByRole('button', { name: 'Yes, release' }));
    expect(bridge.api.release).toHaveBeenCalledWith(LINE_ID, 'launch', 1);
  });
});

describe('A decision gate', () => {
  const holding = { state: 'holding' as const, runId: 'run-9' };
  const decision = () => makeFactory({ choices: ['approve', 'revise'], confirmations: 1 });

  it('releases with the choice and the note you gave', async () => {
    const { user } = open('launch', { launch: holding }, { factory: decision() });
    await user.click(screen.getByRole('button', { name: 'revise' }));
    await user.type(screen.getByLabelText('Note for the next machine (optional)'), 'use v2');
    await user.click(screen.getByRole('button', { name: 'Go with revise' }));
    await user.click(screen.getByRole('button', { name: /^Yes/ }));
    expect(bridge.api.release).toHaveBeenCalledWith(LINE_ID, 'launch', 1, { choice: 'revise', note: 'use v2' });
  });

  it('asks for a choice before it offers to go on', () => {
    open('launch', { launch: holding }, { factory: decision() });
    expect(screen.getByText('Choose the way forward')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Go with/ })).not.toBeInTheDocument();
  });
});

describe('A signal that stopped the line', () => {
  it('shows its output and runs it again on request', async () => {
    const { user } = open('checks', { checks: { state: 'fire', error: 'exited with 1: lint broke', runId: 'run-2' } });
    expect(screen.getByText('exited with 1: lint broke')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run again' }));
    expect(bridge.api.retry).toHaveBeenCalledWith(LINE_ID, 'checks', '');
  });
});

describe('The intake', () => {
  it('dispatches a work order with what you typed, and says which run it started', async () => {
    const { user, notify } = open('@intake', {});
    await user.type(screen.getByLabelText('Tag *'), 'v4.18.0');
    await user.click(screen.getByRole('button', { name: 'Dispatch' }));
    expect(bridge.api.run).toHaveBeenCalledWith(LINE_ID, { tag: 'v4.18.0' });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('run-1'), 'ok');
  });

  it('does not dispatch while a required field is empty', async () => {
    const { user } = open('@intake', {});
    await user.click(screen.getByRole('button', { name: 'Dispatch' }));
    expect(bridge.api.run).not.toHaveBeenCalled();
  });
});

describe('The panel', () => {
  it('names the piece and where it lives, and closes on request', async () => {
    const { user, onClose } = open('build', {});
    const panel = screen.getByRole('complementary', { name: 'Build' });
    expect(within(panel).getByText(/Machine · orders-api releases/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows where boxes come from and where they go', () => {
    open('launch', {});
    expect(screen.getByText('Receives from')).toBeInTheDocument();
    expect(screen.getByText('"Checks"')).toBeInTheDocument();
    expect(screen.getByText('The pallet')).toBeInTheDocument();
  });
});
