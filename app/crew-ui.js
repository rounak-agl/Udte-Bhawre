const path = require('path');
const { app, BrowserWindow, ipcMain, screen, nativeTheme } = require('electron');
const { ROOT } = require('./paths');
const backend = require('./crew-backend');
const appEvents = require('./events');

const MODES = new Set(['popover', 'panel', 'focus']);
const point = (a) => a && Number.isFinite(a.x) && Number.isFinite(a.y);

const PRELOAD = path.join(ROOT, 'preload-crew.js');
const DEV_URL = process.env.CREW_UI_DEV || '';

const windows = { stage: null, desk: null, home: null };
let deskCrew = null;
let deskMode = 'popover';
let deskAnchor = { x: 0, y: 0 };

function load(win, view, params = {}) {
  const query = { view, ...params };
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') console.log(`[crew:${view}] ${e.message}`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => console.log(`[crew:${view}] failed ${code} ${desc} ${url}`));
  win.webContents.on('did-finish-load', () => console.log(`[crew:${view}] loaded`));
  if (DEV_URL) {
    const qs = new URLSearchParams(query).toString();
    win.loadURL(`${DEV_URL}/?${qs}`);
  } else {
    win.loadFile(path.join(ROOT, 'ui', 'dist', 'index.html'), { query });
  }
}

function prefs() {
  return { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' };
}

function surface() {
  return nativeTheme.shouldUseDarkColors ? '#181818' : '#ffffff';
}

let stageDisplayId = null;

function stageDisplay() {
  return screen.getAllDisplays().find((d) => d.id === stageDisplayId) || screen.getPrimaryDisplay();
}

function workArea() {
  return stageDisplay().workArea;
}

function refitStage() {
  if (windows.stage && !windows.stage.isDestroyed()) {
    const wa = workArea();
    windows.stage.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height });
  }
  if (windows.desk && !windows.desk.isDestroyed()) windows.desk.setBounds(deskBounds(deskMode, deskAnchor));
  appEvents.emit('settings-changed');
}

function moveCrewTo(id) {
  stageDisplayId = id;
  refitStage();
}

function createStage() {
  const wa = workArea();
  const win = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    backgroundColor: '#00000000',
    webPreferences: prefs()
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  console.log('[crew] stage', JSON.stringify(wa));
  win.on('closed', () => {
    windows.stage = null;
  });
  load(win, 'stage');
  windows.stage = win;
}

function deskBounds(mode, anchor) {
  const wa = workArea();
  if (mode === 'panel') {
    const width = Math.min(480, wa.width - 24);
    return { x: wa.x + wa.width - width - 12, y: wa.y + 12, width, height: Math.max(380, wa.height - 120) };
  }
  if (mode === 'focus') {
    const width = Math.max(320, Math.min(1120, wa.width - 80));
    const height = Math.max(380, Math.min(760, wa.height - 60));
    return { x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + (wa.height - height) / 2), width, height };
  }
  const width = 400;
  const at = point(anchor) ? anchor : { x: wa.x + wa.width - 200, y: wa.y + wa.height - 40 };
  const height = Math.max(380, Math.min(560, at.y - wa.y - 28));
  const x = Math.max(wa.x + 12, Math.min(wa.x + wa.width - width - 84, Math.round(at.x - width / 2)));
  const y = Math.max(wa.y + 12, Math.min(wa.y + wa.height - height - 12, Math.round(at.y - height - 16)));
  return { x, y, width, height };
}

function defaultAnchor() {
  const wa = workArea();
  return { x: wa.x + wa.width - 104, y: wa.y + wa.height - 70 };
}

function openDesk(crewId, anchor) {
  deskAnchor = anchor || (deskAnchor.x ? deskAnchor : defaultAnchor());
  if (windows.desk && !windows.desk.isDestroyed()) {
    if (deskCrew !== crewId) {
      deskCrew = crewId;
      windows.desk.webContents.send('crew:desk-crew', crewId);
    }
    if (deskMode === 'popover') windows.desk.setBounds(deskBounds('popover', deskAnchor));
    windows.desk.show();
    windows.desk.focus();
    return;
  }
  deskCrew = crewId;
  deskMode = 'popover';
  const win = new BrowserWindow({
    ...deskBounds('popover', deskAnchor),
    minWidth: 320,
    minHeight: 380,
    frame: false,
    resizable: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: surface(),
    roundedCorners: true,
    webPreferences: prefs()
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    windows.desk = null;
    deskCrew = null;
  });
  load(win, 'desk', { crew: crewId });
  windows.desk = win;
}

function openHome() {
  if (windows.home && !windows.home.isDestroyed()) {
    windows.home.show();
    windows.home.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: surface(),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#e8e8e6' : '#111111', height: 40 },
    webPreferences: prefs()
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    windows.home = null;
  });
  load(win, 'home');
  windows.home = win;
}

/** Whether IPC came from Home base, the crew's settings window (see requireControlCentre). */
function isHomeSender(event) {
  return !!(windows.home && !windows.home.isDestroyed() && event.sender === windows.home.webContents);
}

function all() {
  return Object.values(windows).filter((w) => w && !w.isDestroyed());
}

function registerCrewIpc() {
  ipcMain.on('crew:bus', (event, msg) => {
    for (const w of all()) if (w.webContents !== event.sender) w.webContents.send('crew:bus', msg);
  });
  ipcMain.on('crew:interactive', (_e, on) => {
    if (windows.stage && !windows.stage.isDestroyed()) windows.stage.setIgnoreMouseEvents(!on, { forward: true });
  });
  ipcMain.on('crew:open-desk', (_e, crewId, anchor) => {
    if (!backend.isCrew(crewId)) return;
    const wa = workArea();
    openDesk(crewId, point(anchor) ? { x: wa.x + anchor.x, y: wa.y + anchor.y } : null);
  });
  ipcMain.on('crew:desk-mode', (_e, mode) => {
    if (!MODES.has(mode) || !windows.desk || windows.desk.isDestroyed()) return;
    deskMode = mode;
    windows.desk.setBounds(deskBounds(mode, deskAnchor), true);
  });
  ipcMain.on('crew:desk-close', () => {
    if (windows.desk && !windows.desk.isDestroyed()) windows.desk.close();
  });
  ipcMain.on('crew:desk-pin', (_e, on) => {
    if (windows.desk && !windows.desk.isDestroyed()) windows.desk.setAlwaysOnTop(!!on, 'floating');
  });
  ipcMain.on('crew:open-home', () => openHome());
  ipcMain.on('crew:chat-send', (_e, id, text, images) => backend.send(id, text, images));
  ipcMain.on('crew:decide', (_e, planId, ok) => backend.decide(planId, ok));
  ipcMain.on('crew:stop', (_e, id) => backend.stop(id));
  ipcMain.handle('crew:overview', () => backend.overview());
  ipcMain.handle('crew:set-provider', (_e, id, key) => backend.setProvider(id, key));
  ipcMain.handle('crew:local-detect', () => backend.detectLocal());
  ipcMain.handle('crew:local-add', (_e, model) => backend.addLocal(model));
  ipcMain.handle('crew:set-key', (event, key) => {
    const trusted = [windows.home, windows.desk].some((w) => w && !w.isDestroyed() && w.webContents === event.sender);
    if (!trusted) return { ok: false, error: 'Not allowed from this window' };
    return backend.setGeminiKey(key);
  });
  ipcMain.handle('crew:desk-crew', () => deskCrew);
  ipcMain.on('crew:open-connectors', () => require('./control-centre').openControlCentre('connectors'));
}

function startCrewUI() {
  backend.setSink((evt) => {
    if (windows.stage && !windows.stage.isDestroyed()) windows.stage.webContents.send('crew:backend', evt);
  });
  app.on('before-quit', () => backend.shutdown());
  console.log('[crew] brains', JSON.stringify(backend.overview().assigned));
  createStage();
  for (const evt of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(evt, refitStage);
}

function trayTemplate() {
  const displays = screen.getAllDisplays();
  return [
    { label: 'Open Home base', click: () => openHome() },
    { label: 'Show the crew', click: () => windows.stage && !windows.stage.isDestroyed() && windows.stage.showInactive() },
    { label: 'Hide the crew', click: () => windows.stage && !windows.stage.isDestroyed() && windows.stage.hide() },
    ...(displays.length > 1
      ? [
          {
            label: 'Crew lives on',
            submenu: displays.map((d, i) => ({
              label: `Screen ${i + 1} (${d.size.width}x${d.size.height})${d.id === screen.getPrimaryDisplay().id ? ', main' : ''}`,
              type: 'radio',
              checked: d.id === stageDisplay().id,
              click: () => moveCrewTo(d.id)
            }))
          }
        ]
      : []),
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ];
}

module.exports = { registerCrewIpc, startCrewUI, openHome, trayTemplate, isHomeSender };
