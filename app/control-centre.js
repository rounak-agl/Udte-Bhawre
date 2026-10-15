const { BrowserWindow, ipcMain } = require('electron');
const { rendererFile, webPreferences, PRELOAD_CC } = require('./paths');

/**
 * The Control Centre window (dashboard, agents, chat history, settings…).
 * Its handlers live in app/ipc/*; this module owns the window itself.
 * CC chat history is read-only; conversations happen in each agent's chat window.
 */
let ccWindow = null;

function registerControlCentreIpc() {
  // Fetch all tool declarations
  ipcMain.handle('cc:get-mcp-tools', async () => {
    const { getToolDeclarations } = require('../mcp-servers/builtin-tools');
    return getToolDeclarations();
  });
}

function openControlCentre(page = 'dashboard') {
  if (ccWindow && !ccWindow.isDestroyed()) {
    if (ccWindow.isMinimized()) ccWindow.restore();
    ccWindow.show();
    ccWindow.focus();
    // Signal navigation for existing window
    ccWindow.webContents.send('cc:navigate', page);
    return;
  }

  ccWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#151A17',
      symbolColor: '#E8E4DF',
      height: 38
    },
    backgroundColor: '#151A17',
    show: false,
    webPreferences: webPreferences(PRELOAD_CC)
  });

  ccWindow.loadFile(rendererFile('control-centre', 'control-centre.html'), { hash: page });

  ccWindow.once('ready-to-show', () => {
    ccWindow.show();
  });

  // Closing really closes it: a hidden Control Centre kept a whole renderer process
  // (~115 MB) alive all day. The app keeps running in the tray, and the tray / a bot
  // reopens it in about half a second.
  ccWindow.on('closed', () => { ccWindow = null; });
}

/**
 * True only for IPC sent by the Control Centre window itself. Used to gate
 * settings that can launch processes or change credentials (MCP servers, API keys…),
 * so chat/character/overlay windows — which render model output — can't reach them.
 */
function isControlCentreSender(event) {
  return !!(ccWindow && !ccWindow.isDestroyed() && event.sender === ccWindow.webContents);
}

module.exports = { registerControlCentreIpc, openControlCentre, isControlCentreSender };
