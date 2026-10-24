// The first screen: open the demo, open a folder of your own, or go back to a recent factory.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Welcome } from './Welcome';
import { installBridge, type FakeBridge } from '../../test/ui';

let bridge: FakeBridge;
function setup(recent: string[] = []) {
  bridge = installBridge();
  const onOpened = vi.fn();
  const notify = vi.fn();
  render(<Welcome recent={recent} demoPath="/home/me/Roboratory/Demo Factory" onOpened={onOpened} notify={notify} toast={null} />);
  return { onOpened, notify, user: userEvent.setup() };
}

describe('The welcome screen', () => {
  it('opens the demo factory, and says where it lives and that it costs nothing', async () => {
    const { user, onOpened } = setup();
    expect(screen.getByText(/Demo Factory/)).toBeInTheDocument();
    expect(screen.getByText(/costs nothing and runs offline/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open the demo factory' }));
    expect(bridge.api.createDemo).toHaveBeenCalled();
    await waitFor(() => expect(onOpened).toHaveBeenCalled());
  });

  it('opens a folder you choose', async () => {
    const { user, onOpened } = setup();
    await user.click(screen.getByRole('button', { name: 'Open a factory folder…' }));
    expect(bridge.api.openFactory).toHaveBeenCalled();
    await waitFor(() => expect(onOpened).toHaveBeenCalled());
  });

  it('lists the factories you opened lately and reopens the one you click', async () => {
    const { user } = setup(['/work/acme', '/work/other']);
    await user.click(screen.getByRole('button', { name: '/work/other' }));
    expect(bridge.api.openFactoryAt).toHaveBeenCalledWith('/work/other');
  });

  it('shows no recent list the first time', () => {
    setup();
    expect(screen.queryByText('Recent factories')).not.toBeInTheDocument();
  });

  it('tells you what went wrong, without closing, when the folder is not a factory', async () => {
    const { user, notify, onOpened } = setup();
    bridge.api.openFactory.mockRejectedValueOnce(new Error("Error invoking remote method 'openFactory': Error: /x is not a Roboratory factory (no factory.yaml or sectors/ folder)."));
    await user.click(screen.getByRole('button', { name: 'Open a factory folder…' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('/x is not a Roboratory factory (no factory.yaml or sectors/ folder).', 'fail'));
    expect(onOpened).not.toHaveBeenCalled();
  });
});
