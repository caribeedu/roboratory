import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDemoFactory } from './core/demo';
import { FactoryService } from './core/service';
import type { ScopeArg } from './shared/api';
import type { BuildOp } from './shared/build';

// The macOS menu bar and Dock read this name (dev builds otherwise show "Electron").
app.setName('Promptory');

let win: BrowserWindow | null = null;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const readSettings = (): { recent: string[] } => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return { recent: [] }; } };
const remember = (root: string) => {
  const s = readSettings();
  s.recent = [root, ...s.recent.filter((r) => r !== root)].slice(0, 8);
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
};
const demoPath = process.env.PROMPTORY_DEMO_DIR || path.join(os.homedir(), 'Promptory', 'Demo Factory');
if (process.env.PROMPTORY_USER_DATA) app.setPath('userData', process.env.PROMPTORY_USER_DATA);

const send = (ch: string, payload: unknown) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
const service = new FactoryService({
  snapshot: (s) => send('snapshot', s),
  logs: (l) => send('logs', l),
  messages: (k) => send('messages', k),
  build: (v) => send('build', v),
});

function open(root: string) {
  service.open(root);
  remember(root);
  win?.setTitle(`${service.factory?.name ?? 'Promptory'} — Promptory`);
}

function iconPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(app.getAppPath(), 'assets', 'icon.png');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 980, minHeight: 640,
    backgroundColor: '#14110d',
    icon: iconPath(),
    title: 'Promptory',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 16 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false },
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  // pinch gestures belong to the floor's camera, not to page zoom
  win.webContents.on('did-finish-load', () => { void win?.webContents.setVisualZoomLevelLimits(1, 1); });
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' }; });
}

const handle = (ch: string, fn: (...a: any[]) => unknown) => ipcMain.handle(ch, (_e, ...a) => fn(...a));

handle('state', () => ({ snapshot: service.snapshot(), logs: service.logs(), recent: readSettings().recent.filter((r) => fs.existsSync(r)), demoPath }));
handle('openFactory', async () => {
  const r = await dialog.showOpenDialog(win!, { title: 'Open a factory', properties: ['openDirectory', 'createDirectory'], message: 'Choose a folder with a factory.yaml' });
  if (r.canceled || !r.filePaths[0]) return false;
  open(r.filePaths[0]);
  return true;
});
handle('openFactoryAt', (root: string) => open(root));
handle('createDemo', () => {
  if (!fs.existsSync(path.join(demoPath, 'factory.yaml'))) createDemoFactory(demoPath, path.join(path.dirname(demoPath), 'demo-repos'));
  open(demoPath);
});
handle('closeFactory', () => service.close());
handle('run', (l: string, input: Record<string, string>) => service.run(l, input));
handle('retry', (l: string, p: string, h: string) => service.retry(l, p, h));
handle('release', (l: string, p: string, c: number, d?: { choice: string; note: string }) => service.release(l, p, c, d));
handle('answer', (l: string, p: string, t: string) => service.answer(l, p, t));
handle('halt', (l: string) => service.halt(l));
handle('resume', (l: string) => service.resume(l));
handle('runs', () => service.runs());
handle('runDetail', (id: string) => service.runDetail(id));
handle('ask', (s: ScopeArg, q: string) => service.ask(s, q));
handle('messages', (s: ScopeArg) => service.messages(s));
handle('acceptProposal', (s: ScopeArg, m: string, p: string, c?: number) => service.accept(s, m, p, c));
handle('rejectProposal', (s: ScopeArg, m: string, p: string) => service.reject(s, m, p));
handle('reveal', (t: string) => { if (fs.existsSync(t)) shell.showItemInFolder(t); });
handle('buildStart', (s: string) => service.buildStart(s));
handle('buildApply', (op: BuildOp) => service.buildApply(op));
handle('buildUndo', () => service.buildUndo());
handle('buildRedo', () => service.buildRedo());
handle('buildFields', (l: string, from: string, back?: boolean) => service.buildFields(l, from, back));
handle('buildServers', () => service.buildServers());
handle('buildRead', (p: string) => service.buildRead(p));
handle('buildList', (p: string) => service.buildList(p));
handle('buildSave', (r?: Record<string, 'mine' | 'disk'>) => service.buildSave(r));
handle('buildDiscard', () => service.buildDiscard());

app.whenReady().then(() => {
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(iconPath());
  createWindow();
  const last = readSettings().recent.find((r) => fs.existsSync(path.join(r, 'factory.yaml')));
  if (last) { try { open(last); } catch { /* show the welcome screen */ } }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { service.close(); if (process.platform !== 'darwin') app.quit(); });
