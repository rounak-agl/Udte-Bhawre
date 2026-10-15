const { ipcMain } = require('electron');
const state = require('../state');
const { charForChatSender, setAgentProvider } = require('../agents');
const { providerFor } = require('../provider-choice');
const { isDBConnected, Agent } = require('../../utils/db');
const { getProviderInfo } = require('../../sessions/providers');

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGES = 4;
const MAX_IMAGE_BASE64 = 11 * 1024 * 1024; // ≈ 8 MB per image (the chat downsizes them first)

/** Images attached in a chat window: [{ mimeType, data (base64) }], or null if malformed. */
function cleanImages(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_IMAGES) return null;
  const out = [];
  for (const img of raw) {
    if (!img || !IMAGE_TYPES.has(img.mimeType) || typeof img.data !== 'string') return null;
    if (!img.data || img.data.length > MAX_IMAGE_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(img.data)) return null;
    out.push({ mimeType: img.mimeType, data: img.data });
  }
  return out;
}

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

  ipcMain.on('chat-send', (event, message, rawImages) => {
    const char = charForChatSender(event);
    if (!char) return;
    const text = typeof message === 'string' ? message : '';
    const images = cleanImages(rawImages);
    if (!images) {
      char.sendToChat('chat-error', 'Couldn\'t send those images (up to 4 PNG/JPEG/WebP/GIF images, 8 MB each).');
      char.sendToChat('chat-turn-complete');
      return;
    }
    if (!text.trim() && !images.length) return;
    if (char.orchestration.isRunning()) {
      char.sendToChat('chat-error', 'Sub-agents are still working on your last request — wait for them, or cancel them on their card.');
      char.sendToChat('chat-turn-complete');
      return;
    }
    const provider = getProviderInfo(providerFor(char));
    if (images.length && !provider?.supportsImages) {
      char.sendToChat('chat-error', `${provider?.name || 'This provider'} can't read images. Switch provider in ⚙ (Gemini Vision, Claude, Codex or a local vision model).`);
      char.sendToChat('chat-turn-complete');
      return;
    }
    if (!char.session) char.createSession();
    char.orchestration.onUserMessage();
    char.startThinking();
    char.session.send(text, images);
  });

  // ✕ on the sub-agents card: stop them; partial results still go to the orchestrator
  ipcMain.on('chat-cancel-subagents', (event) => {
    const char = charForChatSender(event);
    if (char) char.orchestration.cancel();
  });

  // 📷 in a chat: one screenshot, only when the user asks. The chat window steps aside
  // so it isn't in the picture; the image goes back to the chat as an attachment the
  // user can remove before sending.
  ipcMain.handle('chat-capture-screen', async (event) => {
    const char = charForChatSender(event);
    if (!char || !char.chatWindow || char.chatWindow.isDestroyed()) return { ok: false, error: 'Chat not found' };
    const win = char.chatWindow;
    win.hide();
    try {
      await new Promise(r => setTimeout(r, 300)); // let the compositor remove the window
      const { captureScreen } = require('../../utils/screenshot');
      return { ok: true, image: await captureScreen() };
    } catch (err) {
      console.error('[Screenshot] Failed:', err.message);
      return { ok: false, error: `Couldn't take a screenshot: ${err.message}` };
    } finally {
      if (!win.isDestroyed()) { win.show(); win.focus(); }
    }
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

module.exports = { registerChatIpc, cleanImages };
