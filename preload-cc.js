const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ccBridge', {
  // ── Reused from main.js (same handlers as dashboard preload) ──
  getInitialState: () => ipcRenderer.invoke('get-initial-state'),
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  setApiKey: (key) => ipcRenderer.send('set-api-key', key),
  getProviders: () => ipcRenderer.invoke('get-providers'),
  setAgentProvider: (agentId, provider) => ipcRenderer.invoke('set-agent-provider', agentId, provider),
  // Orchestrator agents: delegate to sub-agents; their shared team memory
  setAgentOrchestrator: (agentId, enabled) => ipcRenderer.invoke('set-agent-orchestrator', agentId, enabled),
  getTeamMemory: (agentId) => ipcRenderer.invoke('get-team-memory', agentId),
  deleteTeamMemory: (agentId, noteId) => ipcRenderer.invoke('delete-team-memory', agentId, noteId),
  clearTeamMemory: (agentId) => ipcRenderer.invoke('clear-team-memory', agentId),
  onTasksUpdated: (cb) => ipcRenderer.on('tasks-updated', () => cb()),
  listOllamaModels: (baseUrl) => ipcRenderer.invoke('list-ollama-models', baseUrl),
  addCustomModel: (model) => ipcRenderer.invoke('add-custom-model', model),
  removeCustomModel: (id) => ipcRenderer.invoke('remove-custom-model', id),
  getSecurityOverview: () => ipcRenderer.invoke('get-security-overview'),
  getArmorIQKey: () => ipcRenderer.invoke('get-armoriq-key'),
  setArmorIQKey: (key) => ipcRenderer.invoke('set-armoriq-key', key),
  testArmorIQ: () => ipcRenderer.invoke('test-armoriq'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  getProviderApiKeys: () => ipcRenderer.invoke('get-provider-api-keys'),
  getSecretStorageStatus: () => ipcRenderer.invoke('get-secret-storage-status'),
  setProviderApiKey: (provider, key) => ipcRenderer.send('set-provider-api-key', provider, key),
  getElevenLabsApiKey: () => ipcRenderer.invoke('get-eleven-labs-api-key'),
  setElevenLabsApiKey: (key) => ipcRenderer.send('set-eleven-labs-api-key', key),
  getMongodbUri: () => ipcRenderer.invoke('get-mongodb-uri'),
  setMongodbUri: (uri) => ipcRenderer.invoke('set-mongodb-uri', uri), // → { connected, error, keptPrevious }
  getMcpServers: () => ipcRenderer.invoke('get-mcp-servers'),
  setMcpServers: (servers) => ipcRenderer.send('set-mcp-servers', servers),
  // Connectors → Marketplace (installs are built and test-started in the main process)
  getMarketplaceCatalog: () => ipcRenderer.invoke('marketplace-catalog'),
  searchMarketplace: (query, cursor) => ipcRenderer.invoke('marketplace-search', query, cursor), // → { ok, servers, nextCursor } | { ok: false, error }
  installMcpServer: (request) => ipcRenderer.invoke('marketplace-install', request),          // → { ok, id, tools } | { ok: false, error, canForce }
  testMcpServer: (idOrConfig) => ipcRenderer.invoke('mcp-test-server', idOrConfig),             // → { ok, tools } | { ok: false, error }
  saveMcpServer: (request) => ipcRenderer.invoke('mcp-save-server', request),                  // { id, config, previousId }
  uninstallMcpServer: (id) => ipcRenderer.invoke('mcp-uninstall', id),
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
  deleteChatSession: (sessionId) => ipcRenderer.invoke('delete-chat-session', sessionId),
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  saveTask: (task) => ipcRenderer.invoke('save-task', task),
  deleteTask: (id) => ipcRenderer.invoke('delete-task', id),
  chooseContextFile: () => ipcRenderer.invoke('choose-context-file'),

  // ── CC Specific: Tools ──
  getMcpTools: () => ipcRenderer.invoke('cc:get-mcp-tools'),
});
