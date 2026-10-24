// What the window keeps from the main process: the floor, the log, the engine and the command's state.
import { act, renderHook, waitFor } from '@testing-library/react';
import { useRoboratory } from './store';
import { installBridge, makeFactory, snapshot, type FakeBridge } from '../test/ui';
import type { LogEntry } from '../shared/types';

let bridge: FakeBridge;
beforeEach(() => { bridge = installBridge(); });

const entry = (text: string): LogEntry => ({ t: Date.now(), level: 'sector', sectorId: 'releases', kind: 'info', text });

describe('The state the window follows', () => {
  it('starts from what the main process says now: floor, log, recent factories and engine', async () => {
    bridge = installBridge({
      state: vi.fn(async () => ({ snapshot: snapshot(), logs: [entry('hello')], recent: ['/work/acme'], demoPath: '/demo', engine: { state: 'running', version: '0.8.0', appVersion: '0.8.0' } })),
      cliStatus: vi.fn(async () => 'missing'),
    });
    const { result } = renderHook(() => useRoboratory());
    await waitFor(() => expect(result.current.snapshot?.factory?.name).toBe('Test Factory'));
    expect(result.current.logs.map((l) => l.text)).toEqual(['hello']);
    expect(result.current.recent).toEqual(['/work/acme']);
    expect(result.current.engine.state).toBe('running');
    await waitFor(() => expect(result.current.cli).toBe('missing'));
  });

  it('follows a new snapshot, and appends log lines as they come', async () => {
    const { result } = renderHook(() => useRoboratory());
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    act(() => bridge.emit.snapshot({ ...snapshot(), factory: { ...makeFactory(), name: 'Renamed' } }));
    expect(result.current.snapshot?.factory?.name).toBe('Renamed');
    act(() => bridge.emit.logs([entry('one'), entry('two')]));
    act(() => bridge.emit.logs([entry('three')]));
    expect(result.current.logs.map((l) => l.text)).toEqual(['one', 'two', 'three']);
  });

  it('keeps the log to a size a window can draw', async () => {
    const { result } = renderHook(() => useRoboratory());
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    act(() => bridge.emit.logs(Array.from({ length: 2600 }, (_, i) => entry(`line ${i}`))));
    expect(result.current.logs.length).toBeLessThanOrEqual(2000);
    expect(result.current.logs.at(-1)?.text).toBe('line 2599');
  });

  it('follows the engine and the command line as they change', async () => {
    const { result } = renderHook(() => useRoboratory());
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    act(() => bridge.emit.engine({ state: 'stopped', appVersion: '0.8.0' }));
    expect(result.current.engine.state).toBe('stopped');
    act(() => bridge.emit.cli('outdated'));
    expect(result.current.cli).toBe('outdated');
  });

  it('counts a manager message per scope, so the conversation of that scope reloads', async () => {
    const { result } = renderHook(() => useRoboratory());
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    act(() => bridge.emit.messages('releases'));
    act(() => bridge.emit.messages('releases'));
    act(() => bridge.emit.messages('_factory'));
    expect(result.current.msgTick).toEqual({ releases: 2, _factory: 1 });
  });

  it('stops listening when the window goes away', async () => {
    const { result, unmount } = renderHook(() => useRoboratory());
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    unmount();
    expect(() => bridge.emit.snapshot(snapshot())).not.toThrow();
  });
});
