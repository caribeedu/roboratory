// What the interface tests share: a small factory to look at, and a stand-in for the bridge to the main process
// (`window.roboratory`). The bridge is the one boundary the renderer has, so it is the one thing faked; the
// components under test are the real ones.
import { act } from '@testing-library/react';
import type { RoboratoryApi } from '../shared/api';
import type { LineView, PieceView, Snapshot } from '../shared/types';

type Factory = NonNullable<Snapshot['factory']>;
type Line = Factory['sectors'][number]['lines'][number];
type Piece = Line['pieces'][number];

export const LINE_ID = 'releases/orders-api';

export function piece(over: Partial<Piece> & Pick<Piece, 'id' | 'kind'>): Piece {
  return { label: over.id, needs: [], definedIn: `sectors/releases/models/ship/${over.id}`, ...over } as Piece;
}

/** One sector with one line: intake → build (machine) → checks (signal) → launch (gate, two confirmations) → pallet. */
export function makeFactory(over: { confirmations?: number; rule?: string; choices?: string[] } = {}): Factory {
  const pieces: Piece[] = [
    piece({ id: '@intake', kind: 'intake', label: 'Intake' }),
    piece({ id: 'build', kind: 'machine', label: 'Build', needs: [{ from: '@intake' }], agent: 'sim', role: 'You build.', goal: 'Build the release.' }),
    piece({ id: 'checks', kind: 'signal', label: 'Checks', needs: [{ from: 'build' }], run: 'signals/checks.sh' }),
    piece({ id: 'launch', kind: 'gate', label: 'Launch', needs: [{ from: 'checks' }], confirmations: over.confirmations ?? 2, rule: over.rule, choices: over.choices }),
    piece({ id: '@pallet', kind: 'pallet', label: 'In production', needs: [{ from: 'launch' }] }),
  ];
  return {
    root: '/factory', name: 'Test Factory', warnings: [], hasCulture: false, lineContext: true,
    sectors: [
      {
        id: 'releases', name: 'Releases', color: '#8bc96b', policy: {}, hasCulture: false,
        lines: [{
          id: LINE_ID, name: 'orders-api releases', direction: 'right', model: 'ship', sharedModel: false, params: {},
          intake: { kind: 'manual', label: 'Release tag', inputs: [{ name: 'tag', label: 'Tag', required: true, placeholder: 'v4.18.0' }] },
          pieces,
        }],
      },
      { id: 'incidents', name: 'Incidents', color: '#e0705a', policy: {}, hasCulture: false, lines: [] },
    ],
  } as Factory;
}

export function pieceView(over: Partial<PieceView> & Pick<PieceView, 'id'>): PieceView {
  return { state: 'idle', queue: 0, ...over };
}

/** The state of the line's pieces; any piece not named is idle. */
export function lineView(states: Record<string, Partial<PieceView>> = {}, over: Partial<LineView> = {}): LineView {
  const ids = ['@intake', 'build', 'checks', 'launch', '@pallet'];
  return {
    id: LINE_ID, sectorId: 'releases', halted: false, boxes: [],
    pieces: Object.fromEntries(ids.map((id) => [id, pieceView({ id, ...states[id] })])),
    ...over,
  };
}

export function snapshot(over: Partial<Snapshot> & { states?: Record<string, Partial<PieceView>>; confirmations?: number } = {}): Snapshot {
  const { states, confirmations, ...rest } = over;
  return { now: Date.now(), attention: [], lines: { [LINE_ID]: lineView(states) }, factory: makeFactory({ confirmations }), ...rest };
}

// ---------- the bridge ----------

type Listener<T> = (v: T) => void;

export interface FakeBridge {
  api: { [K in keyof RoboratoryApi]: RoboratoryApi[K] extends (...a: infer A) => infer R ? ((...a: A) => R) & ReturnType<typeof vi.fn> : never };
  /** push something from the main process, as the real bridge would */
  emit: { snapshot(s: Snapshot): void; logs(l: unknown[]): void; messages(key: string): void; build(v: unknown): void; engine(s: unknown): void; cli(s: string): void };
}

/**
 * Installs a `window.roboratory` whose calls resolve to harmless defaults and are recorded, with overrides for the
 * ones a test cares about. Every listener subscribed through it is dropped when the test ends.
 */
export function installBridge(over: Record<string, unknown> = {}): FakeBridge {
  const listeners: Record<string, Set<Listener<any>>> = {};
  const on = (name: string) => (cb: Listener<any>) => { (listeners[name] ??= new Set()).add(cb); return () => { listeners[name].delete(cb); }; };
  const call = (name: string, value: unknown = undefined) => vi.fn(async () => value);
  const api: Record<string, unknown> = {
    state: call('state', { snapshot: snapshot(), logs: [], recent: [], demoPath: '/demo', engine: { state: 'running', appVersion: '1.0.0', version: '1.0.0' } }),
    openFactory: call('openFactory', true), openFactoryAt: call('openFactoryAt'), createDemo: call('createDemo'), closeFactory: call('closeFactory'),
    run: call('run', 'run-1'), retry: call('retry'), release: call('release'), answer: call('answer'), allow: call('allow'), deny: call('deny'), stats: call('stats'), halt: call('halt'), resume: call('resume'),
    runs: call('runs', []), runDetail: call('runDetail', null), ask: call('ask'), messages: call('messages', []),
    acceptProposal: call('acceptProposal'), rejectProposal: call('rejectProposal'), reveal: call('reveal'),
    buildStart: call('buildStart'), buildApply: call('buildApply'), buildUndo: call('buildUndo'), buildRedo: call('buildRedo'),
    buildFields: call('buildFields', { fields: [], open: false }), buildServers: call('buildServers', null), buildRead: call('buildRead', null),
    buildList: call('buildList', []), buildSave: call('buildSave'), buildDiscard: call('buildDiscard'),
    cliStatus: call('cliStatus', 'installed'), cliInstall: call('cliInstall', 'installed'), engineStart: call('engineStart'), engineRestartWhenIdle: call('engineRestartWhenIdle'),
    onBuild: on('build'), onSnapshot: on('snapshot'), onLogs: on('logs'), onMessages: on('messages'), onEngine: on('engine'), onCli: on('cli'),
    ...over,
  };
  (window as unknown as { roboratory: unknown }).roboratory = api;
  const emitter = (name: string) => (v: unknown) => listeners[name]?.forEach((cb) => cb(v));
  afterEach(() => { for (const k of Object.keys(listeners)) delete listeners[k]; delete (window as unknown as { roboratory?: unknown }).roboratory; });
  return {
    api: api as FakeBridge['api'],
    emit: { snapshot: emitter('snapshot'), logs: emitter('logs'), messages: emitter('messages'), build: emitter('build'), engine: emitter('engine'), cli: emitter('cli') },
  };
}

// ---------- build mode ----------

import type { BuildView } from '../shared/build';

/** What the draft says, with nothing changed unless a test says so. */
export function buildView(over: Partial<BuildView> = {}): BuildView {
  return { sectorId: 'releases', factory: makeFactory(), issues: [], changes: [], affected: [], roles: [], canUndo: false, canRedo: false, blocked: [], ...over };
}

/** Lets what the bridge answered reach the screen, so no state update lands after the test has moved on. */
export const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
