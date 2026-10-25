// The Floor: one sector's room, drawn with PixiJS from procedural pixel art.
// Lines lay themselves out (shared/layout.ts); nothing here is placed by hand.
import 'pixi.js/unsafe-eval';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Application, Container, Graphics, Rectangle, Sprite, Texture, TextureStyle, TilingSprite } from 'pixi.js';
import { layoutSector, pointAt, WALL_TOP, type SectorLayout } from '../../shared/layout';
import type { BuildIssue, Slot } from '../../shared/build';
import type { LineView, Snapshot } from '../../shared/types';
import {
  PAL, canvas, drawBackWall, drawBalloon, drawBeltTile, drawBeltTileV, drawBox, drawFloor, drawGate, drawIntake, drawMachine,
  drawManager, drawPallet, drawQuestion, drawSafetyStripe, drawSideWall, drawSignal, drawThink, drawWorker, hueColor,
} from './sprites';

TextureStyle.defaultOptions.scaleMode = 'nearest';

type SectorSnap = NonNullable<Snapshot['factory']>['sectors'][number];
/** `live` opens the running line's panel even in build mode (from the attention queue). */
export type Selection = { kind: 'piece'; lineId: string; pieceId: string; live?: boolean } | { kind: 'box'; lineId: string; boxId: string } | null;

export interface FloorBuild {
  issues: BuildIssue[];
  connectFrom: { lineId: string; from: string } | null;
  onInsert: (lineId: string, at: Slot, kind: 'machine' | 'signal' | 'gate') => void;
  onConnect: (lineId: string, to: string) => void;
  onLineSettings: (lineId: string) => void;
}

export interface FloorProps {
  sector: SectorSnap;
  lines: Record<string, LineView>;
  selection: Selection;
  onSelect: (s: Selection) => void;
  focus: { lineId: string; pieceId: string; n: number } | null;
  firePanel: { lineId: string; pieceId: string } | null;
  thinking: boolean;
  onHalt: (lineId: string, halted: boolean) => void;
  onManager: () => void;
  /** build mode (D41): slots, broken pieces, connect mode */
  build?: FloorBuild;
}

const texCache = new Map<string, Texture>();
function tex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  let t = texCache.get(key);
  if (!t) { t = Texture.from(canvas(w, h, draw)); texCache.set(key, t); }
  return t;
}

const MIN_Z = 0.75, MAX_Z = 6;
const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));
const SPRITE_ANCHOR = {
  machine: { w: 56, h: 52, ax: 28, ay: 44 },
  signal: { w: 22, h: 40, ax: 11, ay: 36 },
  gate: { w: 40, h: 36, ax: 20, ay: 26 },
  intake: { w: 40, h: 40, ax: 20, ay: 34 },
  pallet: { w: 44, h: 20, ax: 22, ay: 10 },
};

interface PieceGfx { root: Container; body: Sprite; worker?: Sprite; balloon: Sprite; bar: Graphics; kind: string; lineId: string; id: string; roof?: string; boxes: Container }
interface Scene {
  layout: SectorLayout;
  world: Container;
  belts: { ts: TilingSprite; dx: number; dy: number; lineId: string }[];
  pieces: Map<string, PieceGfx>;
  manager: { s: Sprite; think: Sprite };
  boxLayer: Container;
  boxSprites: Map<string, Sprite>;
  fx: Container;
  dim: Graphics;
  owned: Texture[];
  particles: { g: Graphics; x: number; y: number; vx: number; vy: number; life: number; max: number; kind: 'smoke' | 'fire' }[];
}

export function Floor(props: FloorProps) {
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const cam = useRef({ x: 0, y: 0, z: 3 });
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const [ready, setReady] = useState(false);
  const [slotMenu, setSlotMenu] = useState<{ lineId: string; at: Slot; x: number; y: number } | null>(null);
  useEffect(() => { setSlotMenu(null); }, [props.build ? 1 : 0, props.sector.id]);
  const [camTick, setCamTick] = useState(0);
  const sectorKey = useMemo(() => JSON.stringify(props.sector.lines.map((l) => [l.id, l.direction, l.pieces.map((p) => [p.id, p.kind, p.needs])])), [props.sector]);
  const layout = useMemo(() => layoutSector(props.sector.lines.map((l) => ({ id: l.id, direction: l.direction, pieces: l.pieces }))), [sectorKey]);

  // ---------- app lifecycle ----------
  useEffect(() => {
    let disposed = false;
    // React clears the ref when the component unmounts, before this effect's cleanup runs; the element is kept here
    const el = host.current!;
    const app = new Application();
    void app.init({ background: '#0f0d0a', resizeTo: el, antialias: false, resolution: window.devicePixelRatio || 1, autoDensity: true, roundPixels: true }).then(() => {
      if (disposed || !el.isConnected) { app.destroy(true); return; }
      el.prepend(app.canvas);
      app.canvas.style.imageRendering = 'pixelated';
      appRef.current = app;
      app.ticker.add((t) => frame(t.deltaMS));
      setReady(true);
    });
    const ro = new ResizeObserver(() => setCamTick((n) => n + 1));
    ro.observe(el);
    return () => { disposed = true; ro.disconnect(); if (appRef.current) { appRef.current.destroy(true, { children: true }); appRef.current = null; } };
  }, []);

  // ---------- scene build (when the sector's structure changes) ----------
  useEffect(() => {
    const app = appRef.current;
    if (!app || !ready) return;
    if (sceneRef.current) { sceneRef.current.world.destroy({ children: true }); sceneRef.current.owned.forEach((t) => t.destroy(true)); }
    const s = build(props.sector, layout);
    sceneRef.current = s;
    app.stage.addChild(s.world);
    // keep the camera when the same sector is rebuilt (e.g. an accepted change)
    if (fittedFor.current !== props.sector.id) { fittedFor.current = props.sector.id; fit(); } else applyCam();
    if (pendingFocus.current) { const f = pendingFocus.current; pendingFocus.current = null; flyTo(f.lineId, f.pieceId); }
  }, [ready, sectorKey, props.sector.color]);
  const fittedFor = useRef<string | null>(null);
  const pendingFocus = useRef<{ lineId: string; pieceId: string } | null>(null);

  // ---------- focus requests ----------
  useEffect(() => {
    if (!props.focus) return;
    if (!sceneRef.current || !sceneRef.current.layout.lines.some((l) => l.id === props.focus!.lineId)) { pendingFocus.current = props.focus; return; }
    flyTo(props.focus.lineId, props.focus.pieceId);
  }, [props.focus?.n]);
  function flyTo(lineId: string, pieceId: string) {
    const l = sceneRef.current?.layout.lines.find((x) => x.id === lineId);
    const n = l?.nodes[pieceId];
    if (!n || !host.current) return;
    const r = host.current.getBoundingClientRect();
    const z = Math.max(cam.current.z, 2.5);
    cam.current = { z, x: n.x - r.width / 2 / z + 160 / z, y: n.y - r.height / 2 / z };
    applyCam();
  }

  function fit() {
    const el = host.current; const s = sceneRef.current;
    if (!el || !s) return;
    const r = el.getBoundingClientRect();
    const W = s.layout.width + 40, H = s.layout.height + 20;
    // a small room is not blown up to fill the screen
    const z = clampZ(Math.min(3, Math.floor(Math.min((r.width * 0.98) / W, (r.height * 0.96) / H) * 20) / 20));
    cam.current = { z, x: (W - r.width / z) / 2 - 20, y: (H - r.height / z) / 2 - 10 };
    applyCam();
  }
  function applyCam() {
    const s = sceneRef.current;
    if (!s) return;
    const { x, y, z } = cam.current;
    s.world.scale.set(z);
    s.world.position.set(Math.round(-x * z), Math.round(-y * z));
    if (overlay.current) overlay.current.style.transform = `translate(${Math.round(-x * z)}px, ${Math.round(-y * z)}px) scale(${z})`;
  }
  useEffect(() => { applyCam(); }, [camTick]);

  // ---------- input: pan, zoom, click ----------
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { x: e.clientX, y: e.clientY, cx: cam.current.x, cy: cam.current.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    d.moved = true;
    cam.current.x = d.cx - dx / cam.current.z; cam.current.y = d.cy - dy / cam.current.z;
    applyCam();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null;
    if (!d || d.moved || (e.target as HTMLElement).closest('button')) return;
    const r = host.current!.getBoundingClientRect();
    const wx = cam.current.x + (e.clientX - r.left) / cam.current.z, wy = cam.current.y + (e.clientY - r.top) / cam.current.z;
    setSlotMenu(null);
    const picked = hit(wx, wy);
    const b = propsRef.current.build;
    if (b?.connectFrom && picked?.kind === 'piece' && picked.lineId === b.connectFrom.lineId) { b.onConnect(picked.lineId, picked.pieceId); return; }
    propsRef.current.onSelect(picked);
  };
  // Trackpad-first camera: two-finger scroll pans, pinch (or ctrl/cmd + wheel) zooms smoothly
  // around the cursor. A native listener so preventDefault works (React's wheel is passive).
  useEffect(() => {
    const el = host.current!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.floor-zoom')) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * unit, dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const z0 = cam.current.z, z1 = clampZ(z0 * Math.exp(-dy * 0.0085));
        const sx = e.clientX - r.left, sy = e.clientY - r.top;
        const wx = cam.current.x + sx / z0, wy = cam.current.y + sy / z0;
        cam.current = { z: z1, x: wx - sx / z1, y: wy - sy / z1 };
      } else {
        cam.current.x += dx / cam.current.z;
        cam.current.y += dy / cam.current.z;
      }
      applyCam();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const zoomBy = (f: number) => {
    const r = host.current!.getBoundingClientRect();
    const z0 = cam.current.z, z1 = clampZ(z0 * f);
    const cx = cam.current.x + r.width / 2 / z0, cy = cam.current.y + r.height / 2 / z0;
    cam.current = { z: z1, x: cx - r.width / 2 / z1, y: cy - r.height / 2 / z1 };
    applyCam();
  };

  function hit(wx: number, wy: number): Selection {
    const s = sceneRef.current; if (!s) return null;
    // boxes first (they sit on top)
    const p = propsRef.current;
    for (const [id, spr] of s.boxSprites) {
      if (!spr.visible) continue;
      if (Math.abs(wx - (spr.x + 5)) <= 6 && Math.abs(wy - (spr.y + 4)) <= 6) {
        const lineId = Object.values(p.lines).find((l) => l.boxes.some((b) => b.id === id))?.id;
        if (lineId) return { kind: 'box', lineId, boxId: id };
      }
    }
    const mg = s.layout.manager;
    if (Math.abs(wx - mg.x) <= 9 && wy >= mg.y - 20 && wy <= mg.y + 10) { p.onManager(); return null; }
    for (const l of s.layout.lines) for (const n of Object.values(l.nodes)) {
      const a = SPRITE_ANCHOR[n.kind];
      if (wx >= n.x - a.ax && wx <= n.x - a.ax + a.w && wy >= n.y - a.ay && wy <= n.y - a.ay + a.h + 6) return { kind: 'piece', lineId: l.id, pieceId: n.id };
    }
    return null;
  }

  // ---------- per-frame animation ----------
  const clock = useRef(0);
  function frame(dms: number) {
    const s = sceneRef.current; if (!s) return;
    clock.current += dms;
    const t = clock.current / 1000;
    const p = propsRef.current;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const b of s.belts) {
      const halted = p.lines[b.lineId]?.halted;
      if (!halted && !reduced) { b.ts.tilePosition.x += b.dx * dms * 0.03; b.ts.tilePosition.y += b.dy * dms * 0.03; }
    }
    const fr = Math.floor(t * 4);
    // pieces
    for (const g of s.pieces.values()) {
      const lv = p.lines[g.lineId];
      // a piece that exists only in the build-mode draft has no run state yet: draw it idle
      const pv = lv?.pieces[g.id] ?? { id: g.id, state: 'idle' as const, queue: 0 };
      const busy = pv.state === 'busy', fire = pv.state === 'fire', hold = pv.state === 'holding';
      if (g.kind === 'machine') {
        const lamp = fire ? (fr % 2 ? PAL.fail : PAL.failDark) : busy ? PAL.ok : pv.state === 'asking' || pv.queue ? PAL.warn : '#4a443a';
        const glowFrame = busy ? fr % 4 : fire ? fr % 2 : 0;
        const key = `m|${g.roof}|${busy}|${fire}|${lamp}|${glowFrame}`;
        g.body.texture = tex(key, 56, 52, (c) => drawMachine(c, g.roof!, { glow: busy, fire, lamp, frame: glowFrame }));
        if (g.worker) g.worker.texture = tex(`w|${g.roof}|${busy ? fr % 2 : 0}`, 10, 18, (c) => drawWorker(c, g.roof!, busy ? fr % 2 : 0));
        if (busy && !reduced && Math.random() < dms / 220) particle(s, g.root.x + 14, g.root.y - 50, 'smoke');
        if (fire && !reduced) for (let i = 0; i < Math.ceil(dms / 25); i++) particle(s, g.root.x - 20 + Math.random() * 40, g.root.y - 36 + Math.random() * 10, 'fire');
      } else if (g.kind === 'signal') {
        const lamp = fire ? PAL.fail : busy ? PAL.warn : pv.state === 'passed' ? PAL.ok : '#3e3a33';
        const blink = busy && fr % 2 === 1;
        g.body.texture = tex(`s|${lamp}|${blink}`, 22, 40, (c) => drawSignal(c, lamp, blink));
      } else if (g.kind === 'gate') {
        const def = p.sector.lines.find((l) => l.id === g.lineId)?.pieces.find((x) => x.id === g.id);
        g.body.texture = tex(`g|${hold}|${!def?.rule}`, 40, 36, (c) => drawGate(c, hold, !def?.rule));
      }
      // loading bars: signals while checking (D37); a holding gate waits for you, so it shows its balloon instead
      g.bar.clear();
      if (g.kind === 'signal' && busy) {
        const w = 26, y = -46;
        g.bar.rect(-w / 2 - 1, y - 1, w + 2, 5).fill(PAL.ink);
        g.bar.rect(-w / 2, y, w, 3).fill('#2c2722');
        const x = ((t * 18) % (w + 8)) - 8;
        g.bar.rect(-w / 2 + Math.max(0, x), y, Math.min(8, w - Math.max(0, x)), 3).fill(PAL.warn);
      }
      // balloons: anything waiting on you, or stopped
      const asking = pv.state === 'asking';
      const permits = !!pv.permissions?.length; // a request waits for you: the machine is at work, not on fire (D44)
      const needs = hold || fire || asking || permits;
      g.balloon.visible = needs;
      if (needs) {
        g.balloon.texture = asking ? tex('q', 14, 18, drawQuestion) : tex(`b|${fire}`, 14, 18, (c) => drawBalloon(c, fire ? PAL.fail : '#c9473a'));
        g.balloon.y = (g.kind === 'machine' ? -66 : g.kind === 'signal' ? -64 : -54) + (reduced ? 0 : Math.round(Math.sin(t * 5) * 2));
      }
    }
    // the sector's manager
    {
      const m = s.manager;
      const pose = p.thinking ? 'think' : 'idle';
      const f = pose === 'idle' ? Math.floor(t * 1.3) % 2 : 0;
      m.s.texture = tex(`mgr|${p.sector.color}|${pose}|${f}`, 16, 26, (c) => drawManager(c, p.sector.color, pose, f));
      m.think.visible = p.thinking;
      if (p.thinking) m.think.texture = tex(`think|${fr % 3}`, 18, 12, (c) => drawThink(c, fr));
    }
    // boxes
    const seen = new Set<string>();
    const now = Date.now();
    const fireRun = p.firePanel ? p.lines[p.firePanel.lineId]?.pieces[p.firePanel.pieceId]?.runId : undefined;
    for (const l of s.layout.lines) {
      const lv = p.lines[l.id]; if (!lv) continue;
      const stack = new Map<string, number>();
      for (const b of lv.boxes) {
        let x: number, y: number;
        if ('piece' in b.at) {
          const n = l.nodes[b.at.piece]; if (!n) continue;
          const k = stack.get(b.at.piece) ?? 0; stack.set(b.at.piece, k + 1);
          const dir = l.direction === 'right' ? -1 : 1;
          x = n.x + dir * (n.hw + 6 + k * 11); y = n.y + 6;
          if (n.kind === 'machine' && k === 0 && lv.pieces[b.at.piece]?.state === 'busy') { x = n.x - 5; y = n.y + 4; }
        } else {
          const isBack = b.id.endsWith('<');
          const e = l.nodes[b.at.to] && s.layout.lines.find((q) => q.id === l.id)!.edges.find((q) => q.from === (b.at as { from: string }).from && q.to === (b.at as { to: string }).to && !!q.back === isBack);
          if (!e) continue;
          const f = Math.min(1, Math.max(0, (now - b.at.since) / b.at.ms));
          [x, y] = pointAt(e.points, f * e.len);
        }
        let spr = s.boxSprites.get(b.id);
        if (!spr) { spr = new Sprite(); s.boxLayer.addChild(spr); s.boxSprites.set(b.id, spr); }
        spr.texture = tex(`box|${b.color}`, 10, 10, (c) => drawBox(c, b.color));
        spr.position.set(Math.round(x - 5), Math.round(y - 8));
        spr.visible = true;
        spr.tint = fireRun && b.runId === fireRun && !reduced ? (Math.floor(t * 3) % 2 ? 0xff8a70 : 0xffffff) : 0xffffff;
        seen.add(b.id);
      }
    }
    for (const [id, spr] of s.boxSprites) if (!seen.has(id)) { spr.destroy(); s.boxSprites.delete(id); }
    // pallet stacks
    for (const g of s.pieces.values()) if (g.kind === 'pallet') {
      const n = Math.min(9, p.lines[g.lineId]?.pieces['@pallet']?.pallet ?? 0);
      if (g.boxes.children.length !== n) {
        g.boxes.removeChildren().forEach((c) => c.destroy());
        for (let i = 0; i < n; i++) { const b = new Sprite(tex('box|#8bd06b', 10, 10, (c) => drawBox(c, '#8bd06b'))); b.position.set(-16 + (i % 3) * 11, -12 - Math.floor(i / 3) * 7); g.boxes.addChild(b); }
      }
    }
    // dim other lines while a fire panel is open
    s.dim.clear();
    if (p.firePanel) for (const l of s.layout.lines) if (l.id !== p.firePanel.lineId) s.dim.rect(0, l.top - 12, s.layout.width, l.bottom - l.top + 24).fill({ color: 0x0a0806, alpha: 0.62 });
    // particles
    for (let i = s.particles.length - 1; i >= 0; i--) {
      const q = s.particles[i];
      q.life -= dms / 1000;
      if (q.life <= 0) { q.g.destroy(); s.particles.splice(i, 1); continue; }
      q.x += q.vx * dms / 1000; q.y += q.vy * dms / 1000;
      const a = q.life / q.max;
      q.g.clear();
      if (q.kind === 'smoke') { const sz = 2 + Math.round((1 - a) * 4); q.g.rect(Math.round(q.x), Math.round(q.y), sz, sz).fill({ color: 0x9a9184, alpha: a * 0.5 }); }
      else { const c = a > 0.7 ? 0xffe28a : a > 0.45 ? 0xff9a3c : a > 0.25 ? 0xef5a3c : 0x50463c; q.g.rect(Math.round(q.x), Math.round(q.y), a > 0.5 ? 3 : 2, a > 0.5 ? 3 : 2).fill({ color: c, alpha: a > 0.25 ? 1 : 0.6 }); }
    }
  }

  function particle(s: Scene, x: number, y: number, kind: 'smoke' | 'fire') {
    if (s.particles.length > 400) return;
    const g = new Graphics();
    s.fx.addChild(g);
    const max = kind === 'smoke' ? 1.8 : 0.8;
    s.particles.push({ g, x, y, vx: (Math.random() - 0.5) * (kind === 'smoke' ? 5 : 8), vy: kind === 'smoke' ? -9 - Math.random() * 6 : -16 - Math.random() * 16, life: max, max, kind });
  }

  // ---------- labels (DOM, crisp at any zoom) ----------
  const sel = props.selection;
  const b = props.build;
  const broken = (lineId: string, pieceId: string) => b?.issues.filter((i) => i.pieceId === pieceId && i.lineIds.includes(lineId)) ?? [];
  const openSlot = (e: React.MouseEvent, lineId: string, at: Slot) => {
    const r = host.current!.getBoundingClientRect();
    // keep the menu inside the floor: flip it left or up near an edge
    const x = Math.min(e.clientX - r.left, r.width - 230), y = Math.min(e.clientY - r.top, r.height - 190);
    setSlotMenu({ lineId, at, x, y });
  };
  return (
    <div className={`floor${b ? ' building' : ''}${b?.connectFrom ? ' connecting' : ''}`} ref={host} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => { drag.current = null; }}>
      <div className="floor-vignette" aria-hidden />
      <div className="floor-overlay" ref={overlay}>
        {layout.lines.map((l) => {
          const line = props.sector.lines.find((x) => x.id === l.id)!;
          const lv = props.lines[l.id];
          const intake = l.nodes['@intake'];
          const dir = l.direction === 'right' ? 1 : -1;
          return (
            <div key={l.id}>
              <div className="line-sign" style={{ left: dir > 0 ? 18 : layout.width - 18, top: l.top - 10, transform: dir > 0 ? 'none' : 'translateX(-100%)' }}>
                <span className="line-name">{line.name}</span>
                {line.sharedModel && <span className="tag" title="This line is built from a shared model">shared</span>}
                {lv?.halted && <span className="tag warn">halted</span>}
                {b
                  ? <button className="mini" onClick={() => b.onLineSettings(l.id)} title="Line settings: name, direction, parameters, model">⚙ Line</button>
                  : <button className="mini" onClick={() => props.onHalt(l.id, !lv?.halted)} title={lv?.halted ? 'Resume this line' : 'Halt this line where it stands'}>{lv?.halted ? '▶ Resume' : '❚❚ Halt'}</button>}
              </div>
              {b && l.edges.filter((e) => !e.back).map((e) => {
                const [x, y] = pointAt(e.points, e.len / 2);
                return <button key={`${e.from}>${e.to}`} className="slot" style={{ left: x, top: y }} title="Add a piece on this belt" aria-label={`Add a piece between ${e.from} and ${e.to}`} onClick={(ev) => openSlot(ev, l.id, { from: e.from, to: e.to })}>+</button>;
              })}
              {Object.values(l.nodes).map((n) => {
                const def = line.pieces.find((p) => p.id === n.id)!;
                const pv = lv?.pieces[n.id];
                const selected = sel?.kind === 'piece' && sel.lineId === l.id && sel.pieceId === n.id;
                const problems = broken(l.id, n.id);
                return (
                  <div key={n.id} className={`piece-label k-${n.kind} s-${pv?.state ?? 'idle'}${selected ? ' selected' : ''}${problems.length ? ' broken' : ''}`} style={{ left: n.x, top: n.y + (n.kind === 'pallet' ? 12 : 10) }} title={problems.map((x) => x.message).join('\n') || undefined}>
                    <b>{n.kind === 'intake' ? (line.intake.label || 'Intake') : def.label}</b>
                    {n.kind === 'machine' && <i>{def.agent}</i>}
                    {n.kind === 'gate' && <i>{def.rule ? 'automatic' : def.choices ? `${def.choices.length} choices` : 'you release'}</i>}
                    {n.kind === 'pallet' && <i>{pv?.pallet ?? 0} delivered</i>}
                    {n.kind === 'intake' && <i>{line.intake.kind}</i>}
                  </div>
                );
              })}
              <span style={{ display: 'none' }}>{intake.id}</span>
            </div>
          );
        })}
        <div className="manager-tag" style={{ left: layout.manager.x, top: layout.manager.y + 10 }}>{props.thinking ? 'thinking…' : 'Manager'}</div>
      </div>
      {b && slotMenu && (
        <div className="slot-menu frame" style={{ left: slotMenu.x, top: slotMenu.y }} role="menu" aria-label="Add a piece">
          {(['machine', 'signal', 'gate'] as const).map((k) => (
            <button key={k} role="menuitem" onClick={() => { setSlotMenu(null); b.onInsert(slotMenu.lineId, slotMenu.at, k); }}>
              <b>{k === 'machine' ? 'Machine' : k === 'signal' ? 'Signal' : 'Gate'}</b>
              <small>{k === 'machine' ? 'an agent does a step' : k === 'signal' ? 'a script checks the box' : 'waits for you or a rule'}</small>
            </button>
          ))}
        </div>
      )}
      <div className="floor-zoom">
        <button onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in (or pinch)">+</button>
        <button onClick={() => zoomBy(0.8)} aria-label="Zoom out" title="Zoom out (or pinch)">−</button>
        <button onClick={fit} aria-label="Fit the room" title="Fit the room">⤢</button>
      </div>
    </div>
  );
}

// ---------- scene construction ----------

function build(sector: SectorSnap, layout: SectorLayout): Scene {
  const world = new Container();
  const W = layout.width, H = layout.height;
  // static background: back wall, floor, side walls, lane markings
  const bg = canvas(W + 24, H + 8, (g) => {
    drawFloor(g, 12, WALL_TOP, W, H - WALL_TOP);
    const wall = canvas(W, WALL_TOP, (w) => drawBackWall(w, W, WALL_TOP, sector.color));
    g.drawImage(wall, 12, 0);
    // wall shadow on the floor
    const sh = g.createLinearGradient(0, WALL_TOP, 0, WALL_TOP + 24);
    sh.addColorStop(0, 'rgba(10,8,6,0.45)'); sh.addColorStop(1, 'rgba(10,8,6,0)');
    g.fillStyle = sh; g.fillRect(12, WALL_TOP, W, 24);
    for (const l of layout.lines) {
      // painted safety lanes around each line
      const stripe = canvas(W - 32, 2, (s) => drawSafetyStripe(s, W - 32));
      g.globalAlpha = 0.55;
      g.drawImage(stripe, 28, l.top - 14);
      g.drawImage(stripe, 28, l.bottom + 10);
      g.globalAlpha = 1;
    }
    const side = canvas(12, H, (s) => drawSideWall(s, H));
    g.drawImage(side, 0, 0); g.drawImage(side, W + 12, 0);
    // front lip
    g.fillStyle = PAL.ink; g.fillRect(0, H, W + 24, 8);
    g.fillStyle = '#4b2f24'; g.fillRect(1, H, W + 22, 3);
  });
  const bgTex = Texture.from(bg);
  const bgSprite = new Sprite(bgTex);
  bgSprite.position.set(-12, 0);
  world.addChild(bgSprite);

  // warm light pools under hanging lamps, added on top of the floor
  const light = new Graphics();
  for (let x = 112; x < W; x += 224) for (const l of layout.lines) {
    const cy = (l.top + l.bottom) / 2;
    for (const [rx, ry, a] of [[150, 60, 0.035], [110, 44, 0.035], [70, 28, 0.04]] as const) light.ellipse(x, cy, rx, ry).fill({ color: 0xffb85c, alpha: a });
  }
  light.blendMode = 'add';
  world.addChild(light);

  const belts: Scene['belts'] = [];
  const beltLayer = new Container();
  world.addChild(beltLayer);
  const hTex = Texture.from(canvas(8, 12, drawBeltTile));
  const vTex = Texture.from(canvas(12, 8, drawBeltTileV));
  for (const l of layout.lines) for (const e of l.edges) {
    for (let i = 1; i < e.points.length; i++) {
      const [x0, y0] = e.points[i - 1], [x1, y1] = e.points[i];
      if (y0 === y1) {
        const w = Math.abs(x1 - x0) + 12; if (w <= 12) continue;
        const ts = new TilingSprite({ texture: hTex, width: w, height: 12 });
        ts.position.set(Math.min(x0, x1) - 6, y0 - 6);
        if (e.back) ts.tint = 0xd8b06a;
        beltLayer.addChild(ts);
        belts.push({ ts, dx: Math.sign(x1 - x0), dy: 0, lineId: l.id });
      } else {
        const h = Math.abs(y1 - y0); if (!h) continue;
        const ts = new TilingSprite({ texture: vTex, width: 12, height: h });
        ts.position.set(x0 - 6, Math.min(y0, y1));
        if (e.back) ts.tint = 0xd8b06a;
        beltLayer.addChild(ts);
        belts.push({ ts, dx: 0, dy: Math.sign(y1 - y0), lineId: l.id });
      }
    }
  }

  const pieceLayer = new Container();
  pieceLayer.sortableChildren = true;
  world.addChild(pieceLayer);
  const boxLayer = new Container();
  const pieces = new Map<string, PieceGfx>();
  for (const l of layout.lines) {
    const line = sector.lines.find((x) => x.id === l.id)!;
    for (const n of Object.values(l.nodes)) {
      const def = line.pieces.find((p) => p.id === n.id)!;
      const a = SPRITE_ANCHOR[n.kind];
      const root = new Container();
      root.position.set(n.x, n.y);
      root.zIndex = n.y;
      const body = new Sprite();
      body.position.set(-a.ax, -a.ay);
      root.addChild(body);
      const gfx: PieceGfx = { root, body, kind: n.kind, lineId: l.id, id: n.id, balloon: new Sprite(), bar: new Graphics(), boxes: new Container() };
      if (n.kind === 'machine') {
        gfx.roof = hueColor(def.machine ?? n.id);
        const w = new Sprite();
        w.position.set(l.direction === 'right' ? -36 : 26, -18);
        root.addChild(w);
        gfx.worker = w;
      }
      if (n.kind === 'intake') body.texture = tex(`in|${line.intake.kind}|${sector.color}`, 40, 40, (c) => drawIntake(c, line.intake.kind, sector.color));
      if (n.kind === 'pallet') { body.texture = tex('pallet', 44, 20, drawPallet); root.addChild(gfx.boxes); }
      gfx.balloon.position.set(6, -60);
      gfx.balloon.visible = false;
      root.addChild(gfx.bar, gfx.balloon);
      pieceLayer.addChild(root);
      pieces.set(`${l.id}#${n.id}`, gfx);
    }
  }
  const mg = layout.manager;
  const ms = new Sprite();
  ms.anchor.set(0.5, 1);
  ms.position.set(mg.x, mg.y + 8);
  if (mg.flip) ms.scale.x = -1;
  ms.zIndex = mg.y;
  const think = new Sprite();
  think.position.set(mg.x + (mg.flip ? -20 : 2), mg.y - 34);
  think.visible = false;
  pieceLayer.addChild(ms, think);
  world.addChild(boxLayer);
  const fx = new Container();
  world.addChild(fx);
  const dim = new Graphics();
  world.addChild(dim);
  // invisible hit area so the stage reports pointer positions everywhere
  world.hitArea = new Rectangle(-12, 0, W + 24, H + 8);
  return { layout, world, belts, pieces, manager: { s: ms, think }, boxLayer, boxSprites: new Map(), fx, dim, particles: [], owned: [bgTex, hTex, vTex] };
}
