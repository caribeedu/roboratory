import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EngineBanner, InstallCliButton } from './EngineBanner';
import type { EngineStatus } from '../../shared/api';

const status = (state: EngineStatus['state'], over: Partial<EngineStatus> = {}): EngineStatus => ({ state, version: '0.8.0', appVersion: '0.8.0', ...over });

describe('The engine banner', () => {
  it('says nothing while the engine is running or there is no factory open', () => {
    const { container, rerender } = render(<EngineBanner engine={status('running')} onStart={vi.fn()} onRestartWhenIdle={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<EngineBanner engine={status('none')} onStart={vi.fn()} onRestartWhenIdle={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers to start an engine that stopped', async () => {
    const onStart = vi.fn();
    render(<EngineBanner engine={status('stopped')} onStart={onStart} onRestartWhenIdle={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Engine stopped. Runs are paused until it starts again.');
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onStart).toHaveBeenCalled();
  });

  it('offers to restart an engine older than the app once nothing is running, naming both versions', async () => {
    const onRestart = vi.fn();
    render(<EngineBanner engine={status('older', { version: '0.7.0', appVersion: '0.8.0' })} onStart={vi.fn()} onRestartWhenIdle={onRestart} />);
    expect(screen.getByRole('status')).toHaveTextContent('The engine is older than the app (0.7.0 and 0.8.0).');
    await userEvent.click(screen.getByRole('button', { name: 'Restart when idle' }));
    expect(onRestart).toHaveBeenCalled();
  });

  it('says an engine of the same version is another build, since the versions would not tell them apart', () => {
    render(<EngineBanner engine={status('older')} onStart={vi.fn()} onRestartWhenIdle={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('The engine runs an earlier build than the app.');
  });

  it('explains the wait while it restarts, with nothing to press', () => {
    render(<EngineBanner engine={status('restarting')} onStart={vi.fn()} onRestartWhenIdle={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('No new work starts until then.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('The install button for the command line', () => {
  it('is not shown once the command is installed', () => {
    const { container } = render(<InstallCliButton state="installed" onInstall={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([['missing', 'Install CLI'], ['outdated', 'Update CLI']] as const)('is offered when the command is %s', async (state, label) => {
    const onInstall = vi.fn();
    render(<InstallCliButton state={state} onInstall={onInstall} />);
    await userEvent.click(screen.getByRole('button', { name: label }));
    expect(onInstall).toHaveBeenCalled();
  });
});
