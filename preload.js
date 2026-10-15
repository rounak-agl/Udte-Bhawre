const { contextBridge, ipcRenderer } = require('electron');

// Helper: ensures only one listener per channel, preventing accumulation
const channelHandlers = new Map();
function onChannel(channel, handler) {
  if (channelHandlers.has(channel)) {
    ipcRenderer.removeListener(channel, channelHandlers.get(channel));
  }
  const wrappedHandler = (_, ...args) => handler(...args);
  channelHandlers.set(channel, wrappedHandler);
  ipcRenderer.on(channel, wrappedHandler);
}

contextBridge.exposeInMainWorld('assistant', {
  // Character
  onPositionUpdate: (callback) => onChannel('position-update', callback),
  onCharacterConfig: (callback) => onChannel('character-config', callback),
  characterClicked: () => ipcRenderer.send('character-clicked'),

  // Chat
  minimizeChat: () => ipcRenderer.send('chat-minimize'),
  setTheme: (theme) => ipcRenderer.send('set-theme', theme),
  setChatProvider: (provider) => ipcRenderer.send('chat-set-provider', provider),
  setChatTools: (enabled) => ipcRenderer.send('chat-set-tools', enabled),
  onChatInit: (callback) => onChannel('chat-init', callback),
  onToolsChange: (callback) => onChannel('tools-change', callback),
  onProvidersChanged: (callback) => onChannel('providers-changed', callback),
  onGuardStatus: (callback) => onChannel('guard-status', callback),
  onChatCleared: (callback) => onChannel('chat-cleared', callback),
  // images: [{ mimeType, data (base64) }] attached in the chat (📎 / paste / drop / 📷)
  sendMessage: (msg, images) => ipcRenderer.send('chat-send', msg, images),
  captureScreen: () => ipcRenderer.invoke('chat-capture-screen'), // → { ok, image } | { ok: false, error }
  onChatText: (callback) => onChannel('chat-text', callback),
  onChatError: (callback) => onChannel('chat-error', callback),
  onChatToolUse: (callback) => onChannel('chat-tool-use', (name, input) => callback(name, input)),
  onChatToolResult: (callback) => onChannel('chat-tool-result', (summary, isError) => callback(summary, isError)),
  onChatTurnComplete: (callback) => onChannel('chat-turn-complete', callback),
  onChatSessionReady: (callback) => onChannel('chat-session-ready', callback),
  onChatHistory: (callback) => onChannel('chat-history', callback),
  onThemeChange: (callback) => onChannel('theme-change', callback),
  onProviderChange: (callback) => onChannel('provider-change', callback),
  onApiKeyChange: (callback) => onChannel('api-key-changed', callback),

  // Security telemetry (ArmorIQ)
  onSecurityAuditEvent: (callback) => onChannel('security-audit-event', callback),
  sendRendererReady: () => ipcRenderer.send('renderer-ready'),

  // Bubble
  onBubbleShow: (callback) => onChannel('bubble-show', callback),
  onBubbleHide: (callback) => onChannel('bubble-hide', callback),

  // ElevenLabs key (chat speech-to-text needs it in the renderer).
  // API-key setters and MCP server config are deliberately NOT exposed here: these
  // windows render model output, so they only live on the Control Centre bridge.
  getElevenLabsApiKey: () => ipcRenderer.invoke('get-eleven-labs-api-key'),
});
