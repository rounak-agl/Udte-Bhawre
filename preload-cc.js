const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ccBridge', {
  // ── Reused from main.js (same handlers as dashboard preload) ──
  getInitialState: () => ipcRenderer.invoke('get-initial-state'),
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  setApiKey: (key) => ipcRenderer.send('set-api-key', key),
  getElevenLabsApiKey: () => ipcRenderer.invoke('get-eleven-labs-api-key'),
  setElevenLabsApiKey: (key) => ipcRenderer.send('set-eleven-labs-api-key', key),
  getMongodbUri: () => ipcRenderer.invoke('get-mongodb-uri'),
  setMongodbUri: (uri) => ipcRenderer.send('set-mongodb-uri', uri),
  getMcpServers: () => ipcRenderer.invoke('get-mcp-servers'),
  setMcpServers: (servers) => ipcRenderer.send('set-mcp-servers', servers),
  setProvider: (provider) => ipcRenderer.send('set-provider', provider),
  setTheme: (theme) => ipcRenderer.send('set-theme', theme),
  onProviderChange: (cb) => ipcRenderer.on('provider-change', (_, provider) => cb(provider)),
  onThemeChange: (cb) => ipcRenderer.on('theme-change', (_, theme) => cb(theme)),
  onNavigate: (cb) => ipcRenderer.on('cc:navigate', (_, page) => cb(page)),

  // ── DB: Agents & History (reuse main.js handlers) ──
  getAgents: () => ipcRenderer.invoke('get-agents'),
  saveAgent: (config) => ipcRenderer.invoke('save-agent', config),
  deleteAgent: (id) => ipcRenderer.invoke('delete-agent', id),
  launchAgent: (agent) => ipcRenderer.send('launch-agent', agent),
  getHistory: () => ipcRenderer.invoke('get-history'),
  getChatMessages: (sessionId) => ipcRenderer.invoke('get-chat-messages', sessionId),
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  saveTask: (task) => ipcRenderer.invoke('save-task', task),
  deleteTask: (id) => ipcRenderer.invoke('delete-task', id),
  chooseContextFile: () => ipcRenderer.invoke('choose-context-file'),

  // ── CC Specific: Chat & Tools ──
  getMcpTools: () => ipcRenderer.invoke('cc:get-mcp-tools'),
  sendMessage: (sessionId, text) => ipcRenderer.send('cc:send-message', sessionId, text),
  onChatText: (cb) => ipcRenderer.on('cc:chat-text', (_, sessionId, text) => cb(sessionId, text)),
  onChatTurnComplete: (cb) => ipcRenderer.on('cc:chat-turn-complete', (_, sessionId) => cb(sessionId)),
});
