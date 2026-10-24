import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItem, shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EngineClient, launchFor } from './core/client';
import { createDemoFactory } from './core/demo';
import { appLog } from './core/applog';
import { buildIdOf, engineIsOlder } from './core/buildid';
import { defaultBinDir, installCommand, installStatus, type InstallState } from './core/install';
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

const log = appLog(path.join(app.getPath('userData'), 'logs', 'app.log'));

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

// the engine counts as older when its version differs or it runs another build of the bundle than the one this app would start
let appBuild: string | null = null;
const statusOf = (c: EngineClient): EngineStatus['state'] => {
  appBuild ??= buildIdOf(engineScript());
  return c.info.restarting ? 'restarting' : engineIsOlder(c.info, { version: app.getVersion(), build: appBuild }) ? 'older' : 'running';
};

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
  c.on('stopped', () => { log.error(`the engine for ${root} stopped (its log: ${path.join(root, '.runs', 'engine.log')})`); setEngine({ state: 'stopped' }); });
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
  if (last) { try { await open(last); } catch (e) { log.error(`could not reopen ${last}`, e); /* show the welcome screen */ } }
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
  win.webContents.on('console-message', (e) => { if (e.level === 'error') log.error(`renderer: ${e.message} (${e.sourceId}:${e.lineNumber})`); });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => log.error(`the window failed to load ${url}: ${desc} (${code})`));
  win.on('unresponsive', () => log.error('the window stopped responding'));
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' }; });
}

const handle = (ch: string, fn: (...a: any[]) => unknown) => ipcMain.handle(ch, (_e, ...a) => fn(...a));
/** The calls that go to the engine as they are, by the name of the API. */
// A call with a fallback is a read the window repeats on its own (the Ledger polls, a conversation reloads): with no
// factory open or the engine away it gets the empty answer instead of an error, and the banner says what is wrong.
const forward = (name: string, fallback?: unknown) => handle(name, async (...a: unknown[]) => {
  if (!client) { if (fallback !== undefined) return fallback; throw new Error('No factory is open.'); }
  if (fallback === undefined) return client.call(name, ...a);
  try { return await client.call(name, ...a); } catch { return fallback; }
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
handle('openFactoryAt', (root: string) => open(root).catch((e) => { log.error(`could not open ${root}`, e); throw e; }));
handle('createDemo', async () => {
  if (!fs.existsSync(path.join(demoPath, 'factory.yaml'))) createDemoFactory(demoPath, path.join(path.dirname(demoPath), 'demo-repos'));
  await open(demoPath).catch((e) => { log.error('could not open the demo factory', e); throw e; });
});
// closing a factory drops the connection; the engine keeps its runs
handle('closeFactory', () => { disconnect(); send('snapshot', EMPTY); });
handle('engineStart', async () => { if (client) { await client.restart(); setEngine({ state: statusOf(client), version: client.info.version }); } });
handle('engineRestartWhenIdle', () => client?.call('restartWhenIdle'));
for (const name of [
  'run', 'retry', 'release', 'answer', 'halt', 'resume', 'ask', 'acceptProposal', 'rejectProposal',
  'buildStart', 'buildApply', 'buildUndo', 'buildRedo', 'buildFields', 'buildRead', 'buildSave', 'buildDiscard',
]) forward(name);
forward('runs', []);
forward('messages', []);
forward('buildList', []);
forward('runDetail', null);
forward('buildServers', null);
handle('reveal', (t: string) => { if (fs.existsSync(t)) shell.showItemInFolder(t); });

// ---------- the roboratory command ----------

const cliSpec = () => ({ dir: defaultBinDir(), execPath: process.execPath, script: engineScript() });
const cliState = (): InstallState => installStatus(cliSpec()).state;

let cliItem: MenuItem | null = null;
const cliLabel: Record<InstallState, string> = {
  installed: 'Command-line tool: installed',
  outdated: 'Update command-line tool…',
  missing: 'Install command-line tool…',
};

/** Checks the launcher and tells the menu and the window. */
function refreshCli(): InstallState {
  const state = cliState();
  if (cliItem) { cliItem.label = cliLabel[state]; cliItem.enabled = state !== 'installed'; }
  const menu = Menu.getApplicationMenu();
  if (menu) Menu.setApplicationMenu(menu);
  send('cli', state);
  return state;
}

/** Writes the `roboratory` launcher after you confirm. */
async function installCli(): Promise<InstallState> {
  const spec = cliSpec();
  const update = cliState() === 'outdated';
  const ok = await dialog.showMessageBox(win!, {
    type: 'question', buttons: [update ? 'Update' : 'Install', 'Cancel'], defaultId: 0, cancelId: 1,
    message: update ? 'Update the roboratory command?' : 'Install the roboratory command?',
    detail: `This writes a small launcher to ${spec.dir}. It runs the same engine as the app, so runs started from the terminal show up in the window.`,
  });
  if (ok.response !== 0) return refreshCli();
  try {
    const { file, onPath } = installCommand(spec);
    log.info(`installed the roboratory command at ${file}`);
    await dialog.showMessageBox(win!, {
      type: 'info', message: 'The roboratory command is installed.',
      detail: `${file}${onPath ? '' : `\n\n${spec.dir} is not on your PATH yet. Add it to use \`roboratory\` from any folder.`}`,
    });
  } catch (e) {
    log.error('could not install the roboratory command', e);
    dialog.showErrorBox('Could not install the command', (e as Error).message);
  }
  return refreshCli();
}

handle('cliStatus', () => cliState());
handle('cliInstall', () => installCli());

/** File menu: the command's state and how to install it, and where the log is. */
function addMenuItems() {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  cliItem = new MenuItem({ label: cliLabel[cliState()], enabled: cliState() !== 'installed', click: () => void installCli() });
  const logItem = new MenuItem({ label: 'Show log file', click: () => { if (fs.existsSync(log.file)) shell.showItemInFolder(log.file); else void dialog.showMessageBox(win!, { message: 'Nothing has gone wrong yet.', detail: `Problems are written to ${log.file}.` }); } });
  const file = menu.items.find((i) => i.role === 'fileMenu' || i.label === 'File');
  if (file?.submenu) { file.submenu.append(new MenuItem({ type: 'separator' })); file.submenu.append(cliItem); file.submenu.append(logItem); }
  else { const tools = new Menu(); tools.append(cliItem); tools.append(logItem); menu.append(new MenuItem({ label: 'Tools', submenu: tools })); }
  Menu.setApplicationMenu(menu);
}

// ---------- what went wrong, in a file (userData/logs/app.log) ----------

process.on('uncaughtException', (e) => {
  log.error('uncaught exception in the main process', e);
  dialog.showErrorBox('Roboratory hit an error', `${e.message}\n\nDetails are in ${log.file}`);
});
process.on('unhandledRejection', (e) => log.error('unhandled rejection in the main process', e));
app.on('render-process-gone', (_e, _wc, d) => log.error(`the window's renderer process is gone (${d.reason}, exit code ${d.exitCode})`));
app.on('child-process-gone', (_e, d) => log.error(`a ${d.type} process is gone (${d.reason}, exit code ${d.exitCode})`));

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(iconPath());
  addMenuItems();
  createWindow();
  await openLast();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { createWindow(); if (!client) void openLast(); } });
  app.on('browser-window-focus', () => { refreshCli(); }); // installed or removed from a terminal meanwhile
});
// quitting closes the connection only; the engine and its runs go on
app.on('window-all-closed', () => { disconnect(); if (process.platform !== 'darwin') app.quit(); });
