// The rehearsal in build mode (D48): the dialog that shows what will run and what it found, a finding's two answers, the section in a piece's
// panel, and the marks. The engine's side is tested in src/core; here the bridge answers and the window shows.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FindingRow, isStale, marksOf, PieceRehearsal, RehearsalCtx, RehearsalDialog, type RehearsalState } from './Rehearsal';
import { installBridge, LINE_ID, makeFactory, settle, type FakeBridge } from '../../test/ui';
import type { BuildOp } from '../../shared/build';
import type { Finding, RehearsalPlan, RehearsalReport } from '../../shared/types';

const factory = makeFactory();
const plan = (over: Partial<RehearsalPlan> = {}): RehearsalPlan => ({
  lineId: LINE_ID, lineName: 'orders-api releases', mode: 'simulation', source: 'draft',
  inputs: [{ name: 'tag', label: 'Release tag', required: true, placeholder: 'v1.2.3' }],
  machines: [{ pieceId: 'build', label: 'Build', agent: 'sim', allow: ['npm test'], tools: [], outward: ['git push'], dirs: ['/repos/shared'] }],
  signals: [{ pieceId: 'checks', label: 'Checks', command: 'make test', runs: false }, { pieceId: 'lint', label: 'Lint', command: 'make lint', runs: true }],
  ...over,
});
const finding = (over: Partial<Finding> = {}): Finding => ({ id: 'f1', class: 'defect', kind: 'uncovered-command', pieceId: 'build', message: 'Asked to run `npm install`, which no list covers.', where: 'allow in machine.yaml of build', command: 'npm install', suggestion: 'npm install', version: 'aaaa1111', ...over });
const report = (findings: Finding[], over: Partial<RehearsalReport> = {}): RehearsalReport => ({
  id: 'r1', lineId: LINE_ID, mode: 'simulation', startedAt: 0, endedAt: 4000, status: 'done', costUsd: 0, pieces: [], findings, ...over,
});

let bridge: FakeBridge;
let op: ReturnType<typeof vi.fn>;
async function open(o: { plan?: RehearsalPlan | ((req: unknown) => RehearsalPlan); result?: RehearsalReport | Error } = {}) {
  const planFor = o.plan ?? plan();
  bridge = installBridge({
    rehearsalPlan: vi.fn(async (req: { mode: 'real' | 'simulation' }) => (typeof planFor === 'function' ? planFor(req) : { ...planFor, mode: req.mode })),
    rehearse: vi.fn(async () => { if (o.result instanceof Error) throw o.result; return o.result ?? report([]); }),
    rehearsalStop: vi.fn(async () => {}),
  });
  op = vi.fn(async (_o: BuildOp) => true);
  const onClose = vi.fn(), onReport = vi.fn(), onPiece = vi.fn();
  const view = render(<RehearsalDialog lineId={LINE_ID} factory={factory} op={op as never} onClose={onClose} onReport={onReport} onPiece={onPiece} />);
  await settle();
  return { unmount: view.unmount, onClose, onReport, onPiece, user: userEvent.setup() };
}
const dialog = () => screen.getByRole('dialog', { name: 'Rehearse orders-api releases' });

describe('The rehearsal dialog', () => {
  describe('before it starts', () => {
    it('asks for the plan of the draft, and shows what will run: the machines, what each refuses, and the signals', async () => {
      await open();
      expect(bridge.api.rehearsalPlan).toHaveBeenCalledWith({ lineId: LINE_ID, input: {}, mode: 'simulation', source: 'draft', maxCostUsd: undefined });
      const d = within(dialog());
      expect(d.getByText('npm test', { exact: false })).toBeInTheDocument();
      expect(d.getByText('refused, because it acts outside: git push')).toBeInTheDocument();
      expect(d.getByText('make lint')).toBeInTheDocument();
      expect(d.getByText('passes without running', { exact: false })).toBeInTheDocument();
    });

    it('turns the ceiling off in the simulation, which costs nothing, and back on in the real mode', async () => {
      const { user } = await open();
      const ceiling = screen.getByLabelText('Cost ceiling (US$)');
      expect(ceiling).toBeDisabled();
      expect(ceiling).toHaveValue('free');
      expect(screen.getByRole('button', { name: 'Start (free)' })).toBeEnabled();

      await user.click(screen.getByLabelText('Real with Haiku (spends money)'));
      expect(ceiling).toBeEnabled();
      expect(ceiling).toHaveValue('1.00');
      expect(screen.getByRole('button', { name: 'Start (spends up to US$ 1.00)' })).toBeDisabled(); // the tag is required
      await user.clear(ceiling);
      await user.type(ceiling, '2.5');
      expect(screen.getByRole('button', { name: 'Start (spends up to US$ 2.50)' })).toBeInTheDocument();
      await waitFor(() => expect(bridge.api.rehearsalPlan).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'real', maxCostUsd: 2.5 })));
    });

    it('needs the required inputs in the real mode, and fills them in itself in the simulation', async () => {
      const { user } = await open();
      expect(screen.getByPlaceholderText('v1.2.3 (filled in if you leave it empty)')).toBeInTheDocument();
      await user.click(screen.getByLabelText('Real with Haiku (spends money)'));
      expect(screen.getByText('Fill in Release tag first.')).toBeInTheDocument();
      await user.type(screen.getByLabelText('Release tag *'), 'v9');
      expect(screen.getByRole('button', { name: /Start \(spends/ })).toBeEnabled();
    });

    it('does not start with a ceiling that is not an amount', async () => {
      const { user } = await open();
      await user.click(screen.getByLabelText('Real with Haiku (spends money)'));
      await user.type(screen.getByLabelText('Release tag *'), 'v9');
      await user.clear(screen.getByLabelText('Cost ceiling (US$)'));
      await user.type(screen.getByLabelText('Cost ceiling (US$)'), 'lots');
      expect(screen.getByRole('button', { name: /Start/ })).toBeDisabled();
    });

    it('names what a real run of the line has cost, when it has', async () => {
      const { user } = await open({ plan: plan({ mode: 'real', reference: { runs: 3, medianUsd: 1.5 } }) });
      await user.click(screen.getByLabelText('Real with Haiku (spends money)'));
      expect(screen.getByText('A real run of this line has cost ~US$ 1.50 (median of 3).')).toBeInTheDocument();
    });

    it('says what went wrong when the draft cannot be rehearsed', async () => {
      bridge = installBridge({ rehearsalPlan: vi.fn(async () => { throw new Error('The draft has problems that stop it from running: piece "a" has no machine'); }) });
      render(<RehearsalDialog lineId={LINE_ID} factory={factory} op={vi.fn() as never} onClose={vi.fn()} onReport={vi.fn()} onPiece={vi.fn()} />);
      await settle();
      expect(screen.getByRole('alert')).toHaveTextContent('problems that stop it from running');
      expect(screen.getByRole('button', { name: 'Start (free)' })).toBeDisabled();
    });
  });

  describe('while it runs', () => {
    it('starts the simulation without asking for approval, shows the pieces as they change, and can be stopped', async () => {
      let finish!: (r: RehearsalReport) => void;
      const { user } = await open();
      (bridge.api.rehearse as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise((r) => { finish = r; }));
      await user.click(screen.getByRole('button', { name: 'Start (free)' }));
      expect(bridge.api.rehearse).toHaveBeenCalledWith({ lineId: LINE_ID, input: {}, mode: 'simulation', source: 'draft', maxCostUsd: undefined, approved: false });

      act(() => bridge.emit.rehearsal({ pieces: { '@intake': 'idle', build: 'busy', checks: 'idle' }, costUsd: 0, findings: [] }));
      const progress = within(screen.getByRole('list', { name: 'Progress' }));
      expect(progress.getByText('Build').closest('li')).toHaveTextContent('working');
      expect(progress.queryByText('Intake')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Stop' }));
      expect(bridge.api.rehearsalStop).toHaveBeenCalled();
      await act(async () => { finish(report([], { status: 'aborted' })); });
      expect(await screen.findByText('The rehearsal was stopped.')).toBeInTheDocument();
    });

    it('stops a rehearsal that is running when the dialog goes away, since nobody could stop it then', async () => {
      const { user, unmount } = await open();
      (bridge.api.rehearse as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));
      await user.click(screen.getByRole('button', { name: 'Start (free)' }));
      unmount();
      expect(bridge.api.rehearsalStop).toHaveBeenCalledTimes(1);
    });

    it('stops nothing when the dialog goes away before it started', async () => {
      const { unmount } = await open();
      unmount();
      expect(bridge.api.rehearsalStop).not.toHaveBeenCalled();
    });

    it('stops nothing when the dialog goes away after the rehearsal ended', async () => {
      const { user, unmount } = await open();
      await user.click(screen.getByRole('button', { name: 'Start (free)' }));
      await settle();
      expect(await screen.findByText('The line reached the pallet.')).toBeInTheDocument();
      unmount();
      expect(bridge.api.rehearsalStop).not.toHaveBeenCalled();
    });

    it('starts the real mode with your approval, and shows what it has cost so far', async () => {
      let finish!: (r: RehearsalReport) => void;
      const { user } = await open({ plan: plan({ mode: 'real' }) });
      (bridge.api.rehearse as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise((r) => { finish = r; }));
      await user.click(screen.getByLabelText('Real with Haiku (spends money)'));
      await user.type(screen.getByLabelText('Release tag *'), 'v9');
      await user.click(screen.getByRole('button', { name: /Start \(spends/ }));
      expect(bridge.api.rehearse).toHaveBeenCalledWith({ lineId: LINE_ID, input: { tag: 'v9' }, mode: 'real', source: 'draft', maxCostUsd: 1, approved: true });
      act(() => bridge.emit.rehearsal({ pieces: { build: 'busy' }, costUsd: 0.034, findings: [finding()] }));
      expect(screen.getByText('~US$ 0.03 so far')).toBeInTheDocument();
      expect(screen.getByText('1 finding so far.')).toBeInTheDocument();
      await act(async () => { finish(report([])); });
    });

    it('goes back to the setup with the reason when the rehearsal cannot start', async () => {
      const { user } = await open({ result: new Error('A rehearsal is already running.') });
      await user.click(screen.getByRole('button', { name: 'Start (free)' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('A rehearsal is already running.');
      expect(screen.getByRole('button', { name: 'Start (free)' })).toBeInTheDocument();
    });
  });

  describe('when it is over', () => {
    const found = [
      finding({ id: 'n1', class: 'note', kind: 'question', message: 'Asked: Which one?', where: 'role.md of build, if it should not need to ask', suggestion: undefined, command: undefined }),
      finding({ id: 'd1' }),
      finding({ id: 'd2', kind: 'fire', message: 'Build caught fire', where: 'build', suggestion: undefined, command: undefined, pieceId: 'checks' }),
    ];

    it('says how it ended and lists the defects before the notes, each with where to look', async () => {
      const { user, onReport } = await open({ result: report(found) });
      await user.click(screen.getByRole('button', { name: 'Start (free)' }));
      expect(await screen.findByText('The line reached the pallet.')).toBeInTheDocument();
      expect(onReport).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
      expect(screen.getByText('2 defects, 1 note. Pick a piece to see it on the Floor.')).toBeInTheDocument();
      const rows = within(screen.getByRole('list', { name: 'Findings' })).getAllByRole('listitem');
      expect(rows.map((r) => r.className.split(' ')[1])).toEqual(['defect', 'defect', 'note']);
      expect(rows[0]).toHaveTextContent('Look at: allow in machine.yaml of build');
    });

    it('selects the piece on the Floor when you pick it, and closes to let you see it', async () => {
      const { user, onPiece, onClose } = await open({ result: report(found) });
      await user.click(screen.getByRole('button', { name: 'Start (free)' }));
      await user.click(await screen.findByRole('button', { name: 'Checks' }));
      expect(onPiece).toHaveBeenCalledWith('checks');
      expect(onClose).toHaveBeenCalled();
    });

    it('says there are no defects, and offers to rehearse again', async () => {
      const { user } = await open({ result: report([]) });
      await user.click(screen.getByRole('button', { name: 'Start (free)' }));
      expect(await screen.findByText('No defects. Pick a piece to see it on the Floor.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Rehearse again' }));
      expect(screen.getByRole('button', { name: 'Start (free)' })).toBeInTheDocument();
    });

    it('says the cost, as an estimate, when there was one', async () => {
      const { user } = await open({ result: report([], { costUsd: 0.07, status: 'ceiling' }) });
      await user.click(screen.getByRole('button', { name: 'Start (free)' }));
      expect(await screen.findByText('The line stopped at the cost ceiling.')).toBeInTheDocument();
      expect(screen.getByText(/~US\$ 0\.07 \(an estimate\)/)).toBeInTheDocument();
    });
  });
});

describe('A finding of a command no list covers', () => {
  const row = (f: Finding, stale = false) => {
    op = vi.fn(async (_o: BuildOp) => true);
    render(<ul><FindingRow finding={f} lineId={LINE_ID} stale={stale} label={(id) => id} op={op as never} /></ul>);
    return userEvent.setup();
  };

  it('adds the command to the allowed list of the machine, and says to rehearse again', async () => {
    const user = row(finding());
    await user.click(screen.getByRole('button', { name: 'Allow it' }));
    expect(op).toHaveBeenCalledWith({ op: 'addCommand', lineId: LINE_ID, pieceId: 'build', list: 'allow', command: 'npm install' });
    expect(await screen.findByText('Added "npm install" to allow. Rehearse again to check.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow it' })).not.toBeInTheDocument();
  });

  it('adds it to the list of what acts outside the machine instead', async () => {
    const user = row(finding());
    await user.click(screen.getByRole('button', { name: 'It acts outside' }));
    expect(op).toHaveBeenCalledWith({ op: 'addCommand', lineId: LINE_ID, pieceId: 'build', list: 'outward', command: 'npm install' });
    expect(await screen.findByText('Added "npm install" to outward. Rehearse again to check.')).toBeInTheDocument();
  });

  it('says nothing was added when the draft refused the edit', async () => {
    op = vi.fn(async () => false);
    render(<ul><FindingRow finding={finding()} lineId={LINE_ID} stale={false} label={(id) => id} op={op as never} /></ul>);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Allow it' }));
    expect(screen.queryByText(/Rehearse again to check/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow it' })).toBeInTheDocument();
  });

  it('offers no buttons for another kind of finding, or one from an earlier version of the piece', () => {
    row(finding({ kind: 'fire', suggestion: undefined }));
    expect(screen.queryByRole('button', { name: 'Allow it' })).not.toBeInTheDocument();
    render(<ul><FindingRow finding={finding({ id: 'f2' })} lineId={LINE_ID} stale label={(id) => id} op={op as never} /></ul>);
    expect(screen.queryByRole('button', { name: 'Allow it' })).not.toBeInTheDocument();
    expect(screen.getByText('(from an earlier version of this piece)')).toBeInTheDocument();
  });
});

describe('What a rehearsal leaves in build mode', () => {
  const state = (findings: Finding[], versions: Record<string, string> = { build: 'aaaa1111' }): RehearsalState => ({ lineId: LINE_ID, report: report(findings), versions });

  it('marks a piece by the worst of its findings, and a piece whose version changed as out of date', () => {
    const s = state([finding({ id: 'a', pieceId: 'build', class: 'note', kind: 'question' }), finding({ id: 'b', pieceId: 'build' }), finding({ id: 'c', pieceId: 'checks', class: 'note', kind: 'question', version: 'bbbb2222' })], { build: 'aaaa1111', checks: 'cccc3333' });
    expect(marksOf(s)).toEqual({ [`${LINE_ID}#build`]: 'defect', [`${LINE_ID}#checks`]: 'stale' });
    expect(marksOf(state([finding()], { build: 'changed' }))).toEqual({ [`${LINE_ID}#build`]: 'stale' });
    expect(marksOf(null)).toEqual({});
  });

  it('knows a finding is out of date only when it has a version and the draft has another', () => {
    expect(isStale(state([]), finding())).toBe(false);
    expect(isStale(state([], { build: 'zzzz9999' }), finding())).toBe(true);
    expect(isStale(state([], { build: 'zzzz9999' }), finding({ version: undefined }))).toBe(false);
    expect(isStale(state([], {}), finding())).toBe(false);
    expect(isStale(null, finding())).toBe(false);
  });

  it("shows a piece its own findings in a section of its panel, greying the ones out of date, and nothing when it has none", () => {
    const s = state([finding(), finding({ id: 'x', pieceId: 'checks', message: 'something else' })], { build: 'changed' });
    op = vi.fn(async () => true);
    const { rerender } = render(
      <RehearsalCtx.Provider value={{ state: s, open: vi.fn(), marks: marksOf(s) }}>
        <PieceRehearsal lineId={LINE_ID} pieceId="build" label={(id) => id} op={op as never} />
      </RehearsalCtx.Provider>,
    );
    const section = screen.getByRole('region', { name: 'Rehearsal' });
    expect(within(section).getAllByRole('listitem')).toHaveLength(1);
    expect(section).toHaveTextContent('(from an earlier version of this piece)');
    expect(screen.queryByText('something else')).not.toBeInTheDocument();
    rerender(
      <RehearsalCtx.Provider value={{ state: s, open: vi.fn(), marks: {} }}>
        <PieceRehearsal lineId={LINE_ID} pieceId="launch" label={(id) => id} op={op as never} />
      </RehearsalCtx.Provider>,
    );
    expect(screen.queryByRole('region', { name: 'Rehearsal' })).not.toBeInTheDocument();
  });
});
