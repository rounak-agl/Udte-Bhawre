const { ipcMain } = require('electron');
const state = require('../state');
const { charForChatSender, setAgentProvider } = require('../agents');
const { isDBConnected, Agent } = require('../../utils/db');

/** IPC from the character windows and each bot's chat window. */
function registerChatIpc() {
  ipcMain.on('character-clicked', (event) => {
    // Find which character was clicked
    const clickedChar = state.characters.find(c =>
      c.charWindow && c.charWindow.webContents === event.sender
    );
    if (clickedChar) {
      // If onboarding, complete it
      if (clickedChar.isOnboarding) {
        clickedChar.isOnboarding = false;
        clickedChar.hideBubble();
      }
      clickedChar.createChatWindow().catch(err => console.error('[Chat] Failed to open chat:', err));
    }
  });

  // A chat window finished loading: flush that agent's queued security banners to it
  ipcMain.on('renderer-ready', (event) => {
    const char = charForChatSender(event);
    if (!char) return;
    char.chatReady = true;
    char.pendingSecurityEvents.forEach(e => event.sender.send('security-audit-event', e));
    char.pendingSecurityEvents = [];
  });

  ipcMain.on('chat-minimize', (event) => {
    const char = charForChatSender(event);
    if (char) char.chatWindow.hide();
  });

  ipcMain.on('chat-send', (event, message) => {
    const char = charForChatSender(event);
    if (!char) return;
    if (!char.session) char.createSession();
    char.startThinking();
    char.session.send(message);
  });

  // Provider picker in a chat popover: switches that agent only (not the global default).
  // The conversation carries over to the new provider.
  ipcMain.on('chat-set-provider', async (event, providerKey) => {
    const char = charForChatSender(event);
    if (!char || !char.agentId) return;
    await setAgentProvider(char.agentId, providerKey);
  });

  // Tools toggle next to the message box: desktop tools on/off for that agent only.
  // The conversation carries over; the setting is saved on the agent.
  ipcMain.on('chat-set-tools', async (event, enabled) => {
    const char = charForChatSender(event);
    if (!char || typeof enabled !== 'boolean') return;

    char.toolsEnabled = enabled;
    char.sendToChat('tools-change', enabled);
    if (char.session) char.createSession();

    if (char.agentId && isDBConnected()) {
      try {
        await Agent.findByIdAndUpdate(char.agentId, { toolsEnabled: enabled });
      } catch (err) {
        console.error('[DB] Failed to save agent tools setting:', err.message);
      }
    }
  });
}

module.exports = { registerChatIpc };
