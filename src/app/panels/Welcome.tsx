import { useEffect, useRef } from 'react';
import { canvas, drawBackWall, drawBox, drawFloor, drawMachine, drawManager, drawWorker, hueColor } from '../floor/sprites';
import { api, errText } from '../store';
import logo from '../../../assets/logo-64.png';

export function Welcome({ recent, demoPath, onOpened, notify, toast }: { recent: string[]; demoPath: string; onOpened: () => void; notify: (t: string, k?: 'ok' | 'fail' | 'info') => void; toast: { text: string; kind: string } | null }) {
  const art = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = art.current!;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    let raf = 0, t = 0;
    const memo = new Map<string, HTMLCanvasElement>();
    const m = (k: string, w: number, h: number, d: (c: CanvasRenderingContext2D) => void) => { let v = memo.get(k); if (!v) { v = canvas(w, h, d); memo.set(k, v); } return v; };
    const loop = () => {
      t++;
      g.drawImage(m('room', 320, 120, (w) => { drawBackWall(w, 320, 64, '#f0a845'); drawFloor(w, 0, 64, 320, 56); }), 0, 0);
      for (const [x, n] of [[60, 'triager'], [150, 'planner'], [240, 'implementer']] as const) {
        const roof = hueColor(n);
        const fr = Math.floor(t / 12) % 4, wf = Math.floor(t / 10) % 2;
        g.drawImage(m(`m${n}${fr}`, 56, 52, (w) => drawMachine(w, roof, { glow: true, fire: false, lamp: '#8bd06b', frame: fr })), x - 28, 52);
        g.drawImage(m(`w${n}${wf}`, 10, 18, (w) => drawWorker(w, roof, wf)), x - 40, 78);
      }
      g.fillStyle = '#2a2523'; g.fillRect(0, 99, 320, 8);
      for (let i = 0; i < 6; i++) { const x = ((t * 0.6 + i * 60) % 340) - 20; g.drawImage(m(`b${i}`, 10, 10, (w) => drawBox(w, hueColor(String(i)))), Math.round(x), 93); }
      const mf = Math.floor(t / 40) % 2;
      g.drawImage(m(`mgr${mf}`, 16, 26, (w) => drawManager(w, '#f0a845', 'idle', mf)), 8, 78);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);
  const go = async (fn: () => Promise<unknown>) => { try { await fn(); onOpened(); } catch (e) { notify(errText(e), 'fail'); } };
  return (
    <div className="welcome">
      <div className="welcome-card frame">
        <canvas ref={art} width={320} height={120} className="welcome-art" aria-hidden />
        <h1><img src={logo} alt="" width={48} height={48} className="welcome-logo" />Roboratory</h1>
        <p className="tagline">A factory for AI agents. Build deterministic production lines, watch every machine work, and keep every rule in git.</p>
        <div className="welcome-actions">
          <button className="btn primary big" onClick={() => go(() => api().createDemo())}>Open the demo factory</button>
          <button className="btn big" onClick={() => go(() => api().openFactory())}>Open a factory folder…</button>
        </div>
        <p className="muted small">The demo lives in <code>{demoPath}</code>. Its machines use a simulated agent, so it costs nothing and runs offline.</p>
        {recent.length > 0 && (
          <div className="recent">
            <h2>Recent factories</h2>
            <ul>{recent.map((r) => <li key={r}><button className="link" onClick={() => go(() => api().openFactoryAt(r))}>{r}</button></li>)}</ul>
          </div>
        )}
      </div>
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </div>
  );
}
