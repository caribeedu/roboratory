import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItem, shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EngineClient, launchFor } from './core/client';
import { createDemoFactory } from './core/demo';
import { defaultBinDir, installCommand } from './core/install';
import type { EngineStatus } from './shared/api';
import type { Snapshot } from './shared/types';

// The macOS menu bar and Dock read this name (dev builds otherwise show "Electron").
app.setName('Roboratory');

let win: BrowserWindow | null = null;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const readSettings = (): { recent: string[] } => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return { recent: [] }; } };
const remember = (root: string) => {
  const s = readSettings();
  s.recent = [root, ...s.recent.filter((r) => r !== root)].slice(0, 8);
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
};
const demoPath = process.env.ROBORATORY_DEMO_DIR || path.join(os.homedir(), 'Roboratory', 'Demo Factory');
if (process.env.ROBORATORY_USER_DATA) app.setPath('userData', process.env.ROBORATORY_USER_DATA);

const send = (ch: string, payload: unknown) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

// The engine runs in its own process (D43); the window only talks to it through a client.
const engineScript = () => path.join(__dirname, 'engine.js');
const EMPTY: Snapshot = { factory: null, lines: {}, attention: [], now: 0 };
let client: EngineClient | null = null;
let engine: EngineStatus = { state: 'none', appVersion: app.getVersion() };

function setEngine(next: Partial<EngineStatus>) {
  engine = { ...engine, ...next, appVersion: app.getVersion() };
  send('engine', engine);
}

const statusOf = (c: EngineClient): EngineStatus['state'] => (c.info.restarting ? 'restarting' : c.info.version !== app.getVersion() ? 'older' : 'running');

function disconnect() {
  client?.close();
  client = null;
  setEngine({ state: 'none', version: undefined });
}

async function open(root: string) {
  if (!fs.existsSync(path.join(root, 'factory.yaml')) && !fs.existsSync(path.join(root, 'sectors'))) throw new Error(`${root} is not a Roboratory factory (no factory.yaml or sectors/ folder).`);
  disconnect();
  send('snapshot', EMPTY);
  const c = await EngineClient.connect(root, { client: 'app', start: true, launch: launchFor(engineScript()) });
  client = c;
  c.on('snapshot', (s) => send('snapshot', s));
  c.on('logs', (l) => send('logs', l));
  c.on('messages', (k) => send('messages', k));
  c.on('build', (v) => send('build', v));
  c.on('restarting', () => setEngine({ state: 'restarting' }));
  c.on('connected', () => { setEngine({ state: statusOf(c), version: c.info.version }); void refresh(c).catch(() => {}); });
  c.on('stopped', () => setEngine({ state: 'stopped' }));
  setEngine({ state: statusOf(c), version: c.info.version });
  remember(root);
  win?.setTitle(`${c.info.name || 'Roboratory'} — Roboratory`);
  await refresh(c);
}

/** After a reconnect the window starts again from the engine's state. */
async function refresh(c: EngineClient) {
  const s = await c.call<{ snapshot: Snapshot }>('state');
  send('snapshot', s.snapshot);
}

async function openLast() {
  const last = readSettings().recent.find((r) => fs.existsSync(path.join(r, 'factory.yaml')));
  if (last) { try { await open(last); } catch { /* show the welcome screen */ } }
}

function iconPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(app.getAppPath(), 'assets', 'icon.png');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 980, minHeight: 640,
    backgroundColor: '#14110d',
    icon: iconPath(),
    title: 'Roboratory',
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
/** The calls that go to the engine as they are, by the name of the API. */
const forward = (name: string, fallback?: unknown) => handle(name, (...a: unknown[]) => {
  if (!client) { if (fallback !== undefined) return fallback; throw new Error('No factory is open.'); }
  return client.call(name, ...a);
});

handle('state', async () => {
  const s = client ? await client.call<{ snapshot: Snapshot; logs: unknown[] }>('state').catch(() => null) : null;
  return { snapshot: s?.snapshot ?? EMPTY, logs: s?.logs ?? [], recent: readSettings().recent.filter((r) => fs.existsSync(r)), demoPath, engine };
});
handle('openFactory', async () => {
  const r = await dialog.showOpenDialog(win!, { title: 'Open a factory', properties: ['openDirectory', 'createDirectory'], message: 'Choose a folder with a factory.yaml' });
  if (r.canceled || !r.filePaths[0]) return false;
  await open(r.filePaths[0]);
  return true;
});
handle('openFactoryAt', (root: string) => open(root));
handle('createDemo', async () => {
  if (!fs.existsSync(path.join(demoPath, 'factory.yaml'))) createDemoFactory(demoPath, path.join(path.dirname(demoPath), 'demo-repos'));
  await open(demoPath);
});
// closing a factory drops the connection; the engine keeps its runs
handle('closeFactory', () => { disconnect(); send('snapshot', EMPTY); });
handle('engineStart', async () => { if (client) { await client.restart(); setEngine({ state: statusOf(client), version: client.info.version }); } });
handle('engineRestartWhenIdle', () => client?.call('restartWhenIdle'));
for (const name of [
  'run', 'retry', 'release', 'answer', 'halt', 'resume', 'runDetail', 'ask', 'acceptProposal', 'rejectProposal',
  'buildStart', 'buildApply', 'buildUndo', 'buildRedo', 'buildFields', 'buildServers', 'buildRead', 'buildSave', 'buildDiscard',
]) forward(name);
forward('runs', []);
forward('messages', []);
forward('buildList', []);
handle('reveal', (t: string) => { if (fs.existsSync(t)) shell.showItemInFolder(t); });

/** File → Install command-line tool: writes the `roboratory` launcher after you confirm. */
async function installCli() {
  const dir = defaultBinDir();
  const ok = await dialog.showMessageBox(win!, {
    type: 'question', buttons: ['Install', 'Cancel'], defaultId: 0, cancelId: 1,
    message: 'Install the roboratory command?',
    detail: `This writes a small launcher to ${dir}. It runs the same engine as the app, so runs started from the terminal show up in the window.`,
  });
  if (ok.response !== 0) return;
  try {
    const { file, onPath } = installCommand({ dir, execPath: process.execPath, script: engineScript() });
    await dialog.showMessageBox(win!, {
      type: 'info', message: 'The roboratory command is installed.',
      detail: `${file}${onPath ? '' : `\n\n${dir} is not on your PATH yet. Add it to use \`roboratory\` from any folder.`}`,
    });
  } catch (e) { dialog.showErrorBox('Could not install the command', (e as Error).message); }
}

function addMenuItem() {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  const item = new MenuItem({ label: 'Install command-line tool…', click: () => void installCli() });
  const file = menu.items.find((i) => i.role === 'fileMenu' || i.label === 'File');
  if (file?.submenu) file.submenu.append(item);
  else menu.append(new MenuItem({ label: 'Tools', submenu: [{ label: item.label, click: () => void installCli() }] }));
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(iconPath());
  addMenuItem();
  createWindow();
  await openLast();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { createWindow(); if (!client) void openLast(); } });
});
// quitting closes the connection only; the engine and its runs go on
app.on('window-all-closed', () => { disconnect(); if (process.platform !== 'darwin') app.quit(); });
