let ccWindow = null;
let isQuitting = false;

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
app.on('before-quit', () => isQuitting = true);

/**
 * Init CC IPC — ONLY registers cc: prefixed handlers.
 * All shared handlers (get-agents, get-history, get-initial-state, set-theme,
 * set-provider, set-api-key, get-api-key, get-mcp-servers, set-mcp-servers,
 * launch-agent) already live in main.js. The CC preload reuses them directly.
 * CC chat history is read-only; conversations happen in each agent's chat window.
 */
function initControlCentre() {
  // Window controls are now handled natively by Electron titleBarOverlay

  // Fetch all tool declarations
  ipcMain.handle('cc:get-mcp-tools', async () => {
    const { getToolDeclarations } = require('./mcp-servers/builtin-tools');
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
    webPreferences: {
      preload: path.join(__dirname, 'preload-cc.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  ccWindow.loadFile('renderer/control-centre/control-centre.html', { hash: page });

  ccWindow.once('ready-to-show', () => {
    ccWindow.show();
  });
  
  ccWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      ccWindow.hide();
    }
  });
}

/**
 * True only for IPC sent by the Control Centre window itself. Used to gate
 * settings that can launch processes or change credentials (MCP servers, API keys…),
 * so chat/character/overlay windows — which render model output — can't reach them.
 */
function isControlCentreSender(event) {
  return !!(ccWindow && !ccWindow.isDestroyed() && event.sender === ccWindow.webContents);
}

module.exports = { initControlCentre, openControlCentre, isControlCentreSender };
