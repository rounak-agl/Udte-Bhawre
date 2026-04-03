const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('assistant', {
  // Character
  onPositionUpdate: (callback) => ipcRenderer.on('position-update', (_, data) => callback(data)),
  onCharacterConfig: (callback) => ipcRenderer.on('character-config', (_, data) => callback(data)),
  characterClicked: () => ipcRenderer.send('character-clicked'),
  requestPosition: () => ipcRenderer.send('request-position'),

  // Chat
  sendMessage: (msg) => ipcRenderer.send('chat-send', msg),
  onChatText: (callback) => ipcRenderer.on('chat-text', (_, text) => callback(text)),
  onChatError: (callback) => ipcRenderer.on('chat-error', (_, text) => callback(text)),
  onChatToolUse: (callback) => ipcRenderer.on('chat-tool-use', (_, name, input) => callback(name, input)),
  onChatToolResult: (callback) => ipcRenderer.on('chat-tool-result', (_, summary, isError) => callback(summary, isError)),
  onChatTurnComplete: (callback) => ipcRenderer.on('chat-turn-complete', () => callback()),
  onChatSessionReady: (callback) => ipcRenderer.on('chat-session-ready', () => callback()),
  onChatHistory: (callback) => ipcRenderer.on('chat-history', (_, history) => callback(history)),
  onThemeChange: (callback) => ipcRenderer.on('theme-change', (_, theme) => callback(theme)),
  onProviderChange: (callback) => ipcRenderer.on('provider-change', (_, provider) => callback(provider)),
  slashCommand: (cmd) => ipcRenderer.send('slash-command', cmd),
  copyLastResponse: () => ipcRenderer.send('copy-last-response'),
  getInitialState: () => ipcRenderer.invoke('get-initial-state'),

  // Bubble
  onBubbleShow: (callback) => ipcRenderer.on('bubble-show', (_, data) => callback(data)),
  onBubbleHide: (callback) => ipcRenderer.on('bubble-hide', () => callback()),

  // Sounds
  onPlaySound: (callback) => ipcRenderer.on('play-sound', (_, soundName) => callback(soundName)),

  // Overlay — bounding box and step guides
  onShowStepGuide: (callback) => ipcRenderer.on('show-step-guide', (_, steps) => callback(steps)),
  onShowBoundingBox: (callback) => ipcRenderer.on('show-bounding-box', (_, bbox) => callback(bbox)),
  onHideBoundingBox: (callback) => ipcRenderer.on('hide-bounding-box', () => callback()),
  flyToElement: (element) => ipcRenderer.send('fly-to-element', element),
  returnCharacter: () => ipcRenderer.send('return-character'),
  hideOverlay: () => ipcRenderer.send('hide-overlay'),
  overlaySetInteractive: (interactive) => ipcRenderer.send('overlay-set-interactive', interactive),

  // Vision / API key
  setApiKey: (key) => ipcRenderer.send('set-api-key', key),
  getApiKey: () => ipcRenderer.invoke('get-api-key'),

  // Screen Capture Handlers
  sendScreenshot: (dataUrl) => ipcRenderer.send('screenshot-captured', dataUrl),
});
