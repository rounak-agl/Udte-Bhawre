let ccWindow = null;
let isQuitting = false;

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
app.on('before-quit', () => isQuitting = true);

/**
 * Init CC IPC — ONLY registers cc: prefixed handlers.
 * All shared handlers (get-agents, get-history, get-initial-state, set-theme,
 * set-provider, set-api-key, get-api-key, get-mcp-servers, set-mcp-servers)
 * already live in main.js. The CC preload reuses them directly.
 */
function initControlCentre({ characters }) {
  // Window controls are now handled natively by Electron titleBarOverlay

  // Launch an agent from the CC (reuses same logic as dashboard)
  ipcMain.on('cc:launch-agent', (event, agentObj) => {
    // Delegate to main.js launchAgentInstance
    const { launchAgentInstance } = require('./main');
    if (typeof launchAgentInstance === 'function') {
      launchAgentInstance(agentObj);
    }
  });

  // Fetch all tool declarations
  ipcMain.handle('cc:get-mcp-tools', async () => {
    const { getToolDeclarations } = require('./mcp-servers/builtin-tools');
    return getToolDeclarations();
  });

  // Chat implementation
  ipcMain.on('cc:send-message', async (event, sessionId, text) => {
    const { ChatSession } = require('./utils/db');
    try {
      const session = await ChatSession.findById(sessionId).populate('agentId');
      if (!session) return;

      // Find if this agent is already "launched" in a character window
      let targetChar = characters.find(c => c.dbAgentId?.toString() === session.agentId._id.toString());
      
      if (targetChar && targetChar.session) {
        // Use the existing active session
        targetChar.session.sendMessage(text);
        // We'll trust the main.js listeners to broadcast 'chat-text' 
        // but CC needs its own 'cc:chat-text' for now or we broadcast to all
      } else {
        // Background session (no character)
        const { createSessionForAgent } = require('./main');
        const bgSession = createSessionForAgent(session.agentId);
        
        bgSession.on('text', (chunk) => {
          ccWindow?.webContents.send('cc:chat-text', sessionId, chunk);
        });
        
        bgSession.on('turnComplete', () => {
          ccWindow?.webContents.send('cc:chat-turn-complete', sessionId);
        });

        bgSession.sendMessage(text);
      }
    } catch (err) {
      console.error('[CC] cc:send-message error:', err.message);
    }
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

module.exports = { initControlCentre, openControlCentre };
