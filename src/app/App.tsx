import { useEffect, useMemo, useRef, useState } from 'react';
import type { BuildOp, BuildView, Slot } from '../shared/build';
import type { AttentionItem } from '../shared/types';
import { DraftRev } from './build/forms';
import { PieceEditor } from './build/PieceEditor';
import { SaveDialog } from './build/SaveDialog';
import { Settings, type SettingsPanel } from './build/Settings';
import { Floor, type Selection } from './floor/Floor';
import { Inspector } from './panels/Inspector';
import { AttentionQueue } from './panels/AttentionQueue';
import { Minimap } from './panels/Minimap';
import { LiveLog } from './panels/LiveLog';
import { Megaphone } from './panels/Megaphone';
import { Ledger } from './panels/Ledger';
import { Welcome } from './panels/Welcome';
import { api, chirp, errText, usePromptory } from './store';
import logo from '../../assets/logo-64.png';

export type View = 'floor' | 'ledger';

export function App() {
  const { snapshot, logs, recent, demoPath, msgTick, refreshRecent } = usePromptory();
  const factory = snapshot?.factory ?? null;
  const [view, setView] = useState<View>('floor');
  const [sectorId, setSectorId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [focus, setFocus] = useState<{ lineId: string; pieceId: string; n: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'fail' | 'info' } | null>(null);
  const [thinking, setThinking] = useState<Record<string, boolean>>({});
  const [ledgerRun, setLedgerRun] = useState<string | null>(null);
  const [showWarnings, setShowWarnings] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);
  // build mode (D41)
  const [build, setBuild] = useState<BuildView | null>(null);
  const [connectFrom, setConnectFrom] = useState<{ lineId: string; from: string } | null>(null);
  const [panel, setPanel] = useState<SettingsPanel | null>(null);
  const [saving, setSaving] = useState<{ reason?: string; then?: () => void } | null>(null);
  const [rev, setRev] = useState(0);
  useEffect(() => { setRev((r) => r + 1); }, [build]);
  useEffect(() => api().onBuild((v) => { setBuild(v); if (!v) { setConnectFrom(null); setPanel(null); setSaving(null); } }), []);

  const notify = (text: string, kind: 'ok' | 'fail' | 'info' = 'info') => {
    setToast({ text, kind });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), kind === 'fail' ? 7000 : 3500);
  };
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) notify(ok, 'ok'); } catch (e) { notify(errText(e), 'fail'); }
  };
  const op = async (o: BuildOp) => {
    try { setBuild(await api().buildApply(o)); return true; } catch (e) { notify(errText(e), 'fail'); setRev((r) => r + 1); return false; }
  };
  const undoRedo = (redo: boolean) => void (redo ? api().buildRedo() : api().buildUndo()).then(setBuild, (e) => notify(errText(e), 'fail'));
  const startBuild = async (sid: string) => { try { setBuild(await api().buildStart(sid)); setSelection(null); } catch (e) { notify(errText(e), 'fail'); } };
  const endBuild = async () => { await api().buildDiscard(); setBuild(null); setSelection(null); setConnectFrom(null); setPanel(null); setSaving(null); };
  /** Leaving the session (or switching sector) asks to save or discard when the draft has changes. */
  const leaveBuild = (reason?: string, then?: () => void) => {
    if (!build) return;
    if (!build.changes.length) { void endBuild().then(then); return; }
    setSaving({ reason, then });
  };
  const switchSector = (id: string) => {
    if (!build || id === sectorId) { setSectorId(id); return; }
    leaveBuild('Build mode edits one sector at a time. Save or discard these changes to switch.', () => { setSectorId(id); void startBuild(id); });
  };
  const insert = async (lineId: string, at: Slot, kind: 'machine' | 'signal' | 'gate') => {
    const before = new Set(build?.factory.sectors.flatMap((s) => s.lines).find((l) => l.id === lineId)?.pieces.map((p) => p.id));
    try {
      const v = await api().buildApply({ op: 'insert', lineId, at, kind });
      setBuild(v);
      const added = v.factory.sectors.flatMap((s) => s.lines).find((l) => l.id === lineId)?.pieces.find((p) => !before.has(p.id));
      if (added) { setPanel(null); setSelection({ kind: 'piece', lineId, pieceId: added.id }); }
    } catch (e) { notify(errText(e), 'fail'); }
  };
  const connect = async (lineId: string, to: string) => {
    const from = connectFrom!.from;
    setConnectFrom(null);
    const line = build?.factory.sectors.flatMap((s) => s.lines).find((l) => l.id === lineId);
    // a destination upstream of the source becomes a return belt, which needs a rule: open the piece to add it
    const up = new Set<string>(); const stack = [from];
    while (stack.length) { const id = stack.pop(); for (const n of line?.pieces.find((p) => p.id === id)?.needs ?? []) if (!n.back && !up.has(n.from)) { up.add(n.from); stack.push(n.from); } }
    if (to === from || up.has(to)) {
      if (await op({ op: 'connect', lineId, from, to })) { setPanel(null); setSelection({ kind: 'piece', lineId, pieceId: to }); notify('Return belt added. Give it the rule that sends a box back; it stays red until then.', 'info'); }
      return;
    }
    if (await op({ op: 'connect', lineId, from, to })) notify('Connected', 'ok');
  };

  // keep a valid sector selected
  useEffect(() => {
    if (!factory) { setSectorId(null); return; }
    if (!sectorId || !factory.sectors.some((s) => s.id === sectorId)) setSectorId(factory.sectors[0]?.id ?? null);
  }, [factory?.root, factory?.sectors.map((s) => s.id).join()]);
  useEffect(() => { setSelection(null); }, [sectorId]);

  // attention: chirp when something new needs you
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    const items = snapshot?.attention ?? [];
    const ids = new Set(items.map((i) => `${i.id}@${i.runId}`));
    if (known.current) {
      const fresh = items.filter((i) => !known.current!.has(`${i.id}@${i.runId}`));
      if (fresh.length) {
        chirp(fresh.some((f) => f.severity >= 3) ? 'fire' : 'gate');
        const f = fresh[0];
        notify(`${factory?.sectors.find((s) => s.id === f.sectorId)?.name}: ${f.title}`, f.severity >= 3 ? 'fail' : 'info');
      }
    }
    known.current = ids;
  }, [snapshot?.attention]);

  const liveSector = factory?.sectors.find((s) => s.id === sectorId) ?? null;
  const sector = build ? build.factory.sectors.find((s) => s.id === sectorId) ?? null : liveSector;
  const goTo = (item: { sectorId: string; lineId: string; pieceId: string }) => {
    setView('floor');
    if (build && item.sectorId !== sectorId) { notify('That item is in another sector; leave build mode to go there.', 'info'); return; }
    setSectorId(item.sectorId);
    setTimeout(() => {
      setSelection({ kind: 'piece', lineId: item.lineId, pieceId: item.pieceId, live: !!build });
      setFocus({ lineId: item.lineId, pieceId: item.pieceId, n: Date.now() });
    }, 0);
  };
  const nextAttention = () => { const a = snapshot?.attention[0]; if (a) goTo(a); };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName);
      if (e.key === 'Escape') {
        // in a field, Escape only leaves the field (its text is saved, not thrown away)
        if (typing) { (e.target as HTMLElement).blur(); return; }
        if (saving) setSaving(null); else if (connectFrom) setConnectFrom(null); else if (panel) setPanel(null); else setSelection(null);
      }
      if (build && view === 'floor' && !typing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undoRedo(e.shiftKey);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey) return;
      if (e.key === 'n') nextAttention();
      if (e.key === '1') setView('floor');
      if (e.key === '2') { if (build) leaveBuild('Save or discard your build changes to open the Ledger.', () => setView('ledger')); else setView('ledger'); }
      if (e.key === '/') { e.preventDefault(); document.getElementById('megaphone-input')?.focus(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const selectedPiece = selection?.kind === 'piece' ? selection : null;
  const firePanel = useMemo(() => {
    if (!selectedPiece || !snapshot) return null;
    const pv = snapshot.lines[selectedPiece.lineId]?.pieces[selectedPiece.pieceId];
    return pv?.state === 'fire' ? { lineId: selectedPiece.lineId, pieceId: selectedPiece.pieceId } : null;
  }, [selectedPiece?.lineId, selectedPiece?.pieceId, snapshot]);

  if (!snapshot) return <div className="boot">Lighting the lamps…</div>;
  if (!factory) return <Welcome recent={recent} demoPath={demoPath} onOpened={() => { void refreshRecent(); }} notify={notify} toast={toast} />;

  const attention: AttentionItem[] = snapshot.attention;
  const scopeKey = sector ? sector.id : '_factory';
  const draftLine = build && selectedPiece && !selectedPiece.live ? sector?.lines.find((l) => l.id === selectedPiece.lineId) : undefined;
  const draftPiece = draftLine?.pieces.find((p) => p.id === selectedPiece!.pieceId);
  // a piece undone or removed in the draft closes its panel
  if (build && selectedPiece && !selectedPiece.live && !draftPiece) queueMicrotask(() => setSelection(null));

  return (
    <div className={`app${firePanel ? ' alarm' : ''}`}>
      <header className="topbar">
        <div className="brand"><img className="logo" src={logo} alt="" width={26} height={26} />Promptory</div>
        <div className="factory-name" title={factory.root}>{factory.name}</div>
        {view === 'floor' && liveSector && (
          !build
            ? <button className="pill build-toggle" onClick={() => void startBuild(liveSector.id)} title="Build and change this sector's lines">Build</button>
            : (
              <div className="build-bar" role="toolbar" aria-label="Build mode">
                <span className="build-badge">Building</span>
                <span className="small">{build.changes.length} change{build.changes.length === 1 ? '' : 's'}{build.issues.length ? <> · <b className="err">{build.issues.length} problem{build.issues.length === 1 ? '' : 's'}</b></> : null}</span>
                <button className="mini" disabled={!build.canUndo} onClick={() => undoRedo(false)} title="Undo (⌘Z)">↶</button>
                <button className="mini" disabled={!build.canRedo} onClick={() => undoRedo(true)} title="Redo (⇧⌘Z)">↷</button>
                <button className="mini" onClick={() => { setSelection(null); setPanel({ kind: 'factory' }); }}>⚙ Factory</button>
                <button className="mini" onClick={() => { setSelection(null); setPanel({ kind: 'newSector' }); }}>+ Sector</button>
                <button className="pill" onClick={() => leaveBuild()}>Done</button>
              </div>
            )
        )}
        <nav className="views" role="tablist" aria-label="Views">
          <button role="tab" aria-selected={view === 'floor'} onClick={() => setView('floor')}>Floor <kbd>1</kbd></button>
          <button role="tab" aria-selected={view === 'ledger'} onClick={() => (build ? leaveBuild('Save or discard your build changes to open the Ledger.', () => setView('ledger')) : setView('ledger'))}>Ledger <kbd>2</kbd></button>
        </nav>
        <div className="topbar-right">
          {factory.warnings.length > 0 && (
            <button className="pill warn" onClick={() => setShowWarnings((v) => !v)}>{factory.warnings.length} warning{factory.warnings.length === 1 ? '' : 's'}</button>
          )}
          <button className="pill" onClick={() => api().reveal(factory.root + '/factory.yaml')} title="Show the factory folder">Files</button>
          <button className="pill" onClick={() => (build ? leaveBuild('Save or discard your build changes before closing the factory.', () => void act(() => api().closeFactory())) : void act(() => api().closeFactory()))} title="Close this factory">Close</button>
        </div>
        {showWarnings && (
          <div className="warnings-pop frame" role="dialog" aria-label="Warnings">
            <h3>Factory warnings</h3>
            <ul>{factory.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            <button className="btn" onClick={() => setShowWarnings(false)}>Close</button>
          </div>
        )}
      </header>

      {view === 'floor' && sector && (
        <main className={`stage${selection || panel ? ' with-inspector' : ''}`}>
          <Floor
            sector={sector}
            lines={snapshot.lines}
            selection={selection}
            onSelect={(s) => { setPanel(null); setSelection(s); if (!s) setConnectFrom(null); }}
            focus={focus}
            firePanel={firePanel}
            thinking={!!thinking[scopeKey]}
            onHalt={(lineId, halt) => act(() => (halt ? api().halt(lineId) : api().resume(lineId)), halt ? 'Line halted' : 'Line resumed')}
            onManager={() => document.getElementById('megaphone-input')?.focus()}
            build={build ? {
              issues: build.issues, connectFrom,
              onInsert: (l, at, k) => void insert(l, at, k),
              onConnect: (l, to) => void connect(l, to),
              onLineSettings: (lineId) => { setSelection(null); setPanel({ kind: 'line', lineId }); },
            } : undefined}
          />
          <div className="sector-title">
            <span className="swatch" style={{ background: sector.color }} />
            <h1>{sector.name}</h1>
            <span className="sub">{sector.lines.length} line{sector.lines.length === 1 ? '' : 's'}</span>
            {build && <><button className="mini" onClick={() => { setSelection(null); setPanel({ kind: 'sector' }); }}>⚙ Sector</button><button className="mini" onClick={() => { setSelection(null); setPanel({ kind: 'newLine' }); }}>+ Line</button></>}
          </div>
          {connectFrom && <div className="connect-banner frame" role="status">Click the piece "{sector.lines.find((l) => l.id === connectFrom.lineId)?.pieces.find((p) => p.id === connectFrom.from)?.label}" connects to. <button className="link" onClick={() => setConnectFrom(null)}>Cancel (Esc)</button></div>}
          <AttentionQueue items={attention} factory={factory} onPick={goTo} />
          <Minimap factory={factory} lines={snapshot.lines} attention={attention} current={sector.id} onPick={switchSector} />
          <LiveLog logs={logs} factory={factory} sectorId={sector.id} selection={selectedPiece} />
          <DraftRev.Provider value={rev}>
          {build && panel && (
            <Settings panel={panel} view={build} sectorId={sector.id} op={op} onClose={() => setPanel(null)}
              onCreateSector={(id, name, color) => void (async () => {
                if (build.changes.length) { notify('Save or discard your changes in this sector before creating another.', 'fail'); return; }
                try { await api().buildApply({ op: 'newSector', id, name, color }); await api().buildSave(); setPanel(null); setSectorId(id); await startBuild(id); notify(`Sector ${name} created`, 'ok'); } catch (e) { notify(errText(e), 'fail'); }
              })()} />
          )}
          {build && !panel && draftLine && draftPiece && (
            <PieceEditor key={`${draftLine.id}#${draftPiece.id}`} view={build} line={draftLine} piece={draftPiece} op={op}
              onConnect={(from) => setConnectFrom({ lineId: draftLine.id, from })} onClose={() => setSelection(null)}
              onLive={snapshot.factory?.sectors.some((s) => s.lines.some((l) => l.id === draftLine.id && l.pieces.some((p) => p.id === draftPiece.id))) ? () => setSelection({ kind: 'piece', lineId: draftLine.id, pieceId: draftPiece.id, live: true }) : undefined} />
          )}
          </DraftRev.Provider>
          {selection && (!build || selection.kind === 'box' || selectedPiece?.live) && !(build && panel) && (
            <Inspector
              key={selection.kind === 'piece' ? `${selection.lineId}#${selection.pieceId}` : selection.boxId}
              selection={selection} snapshot={snapshot} logs={logs} act={act} notify={notify}
              onClose={() => setSelection(null)}
              onOpenRun={(id) => { setLedgerRun(id); setView('ledger'); }}
            />
          )}
          <Megaphone
            factory={factory} sector={sector} msgTick={msgTick} notify={notify}
            onThinking={(k, v) => setThinking((t) => ({ ...t, [k]: v }))}
            onEvidence={(ev) => {
              if (ev.lineId && ev.pieceId) goTo({ sectorId: ev.lineId.split('/')[0], lineId: ev.lineId, pieceId: ev.pieceId });
              else if (ev.runId) { setLedgerRun(ev.runId); setView('ledger'); }
            }}
          />
        </main>
      )}
      {view === 'floor' && !sector && build && (
        <main className="stage empty-state">
          <div className="frame empty-card">
            <h2>This sector is removed in your draft</h2>
            <p>Save to delete it, or undo to bring it back.</p>
            <div className="actions"><button className="btn" onClick={() => undoRedo(false)}>Undo</button><button className="btn primary" onClick={() => leaveBuild()}>Review and save</button></div>
          </div>
        </main>
      )}
      {view === 'floor' && !sector && !build && (
        <main className="stage empty-state">
          <div className="frame empty-card">
            <h2>This factory has no sectors yet</h2>
            <p>Create a folder under <code>sectors/</code> with a <code>sector.yaml</code> and a <code>lines.yaml</code>. Promptory picks it up as soon as you save.</p>
          </div>
        </main>
      )}
      {view === 'ledger' && <Ledger factory={factory} runId={ledgerRun} onRun={setLedgerRun} notify={notify} onPiece={goTo} />}

      {build && saving && (
        <SaveDialog view={build} reason={saving.reason} onClose={() => setSaving(null)}
          onDiscard={() => { const then = saving.then; void endBuild().then(then); }}
          onSave={(r) => { const then = saving.then; void api().buildSave(r).then(() => { setBuild(null); setSaving(null); setSelection(null); setPanel(null); notify('Saved. Commit the files when you are ready.', 'ok'); then?.(); }, (e) => notify(errText(e), 'fail')); }} />
      )}
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </div>
  );
}
