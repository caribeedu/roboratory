// App state: the latest snapshot from the main process plus UI choices.
import { useEffect, useRef, useState } from 'react';
import type { LogEntry, Snapshot } from '../shared/types';

export const api = () => window.promptory;

export function errText(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export function usePromptory() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [demoPath, setDemoPath] = useState('');
  const [msgTick, setMsgTick] = useState<Record<string, number>>({});
  const loaded = useRef(false);
  useEffect(() => {
    const offs = [
      api().onSnapshot((s) => setSnapshot(s)),
      api().onLogs((l) => setLogs((prev) => { const next = prev.concat(l); return next.length > 2500 ? next.slice(-2000) : next; })),
      api().onMessages((k) => setMsgTick((m) => ({ ...m, [k]: (m[k] ?? 0) + 1 }))),
    ];
    if (!loaded.current) {
      loaded.current = true;
      void api().state().then((s) => { setSnapshot(s.snapshot); setLogs(s.logs); setRecent(s.recent); setDemoPath(s.demoPath); });
    }
    return () => offs.forEach((f) => f());
  }, []);
  const refreshRecent = () => api().state().then((s) => { setRecent(s.recent); setLogs(s.logs); });
  return { snapshot, logs, setLogs, recent, demoPath, msgTick, refreshRecent };
}

/** A short square-wave chirp for attention (Web Audio; no asset files). */
let audio: AudioContext | null = null;
export function chirp(kind: 'fire' | 'gate') {
  try {
    audio ||= new AudioContext();
    const t = audio.currentTime;
    const notes = kind === 'fire' ? [660, 440, 660] : [520, 780];
    notes.forEach((f, i) => {
      const o = audio!.createOscillator(), g = audio!.createGain();
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.05, t + i * 0.09 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.08);
      o.connect(g).connect(audio!.destination);
      o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.09);
    });
  } catch { /* sound is optional */ }
}

/** The current time, refreshed every second, for durations that keep counting. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export const clockTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const ago = (t: number, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};
