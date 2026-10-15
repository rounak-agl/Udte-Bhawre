const { BrowserWindow, ipcMain, dialog } = require('electron');
const state = require('../state');
const { requireControlCentre } = require('../security');
const { defaultProviderKey, providerFor } = require('../provider-choice');
const { launchAgentInstance, removeAgentInstance, setAgentProvider } = require('../agents');
const { isDBConnected, Agent, ChatSession, Task } = require('../../utils/db');
const { getCurrentTheme } = require('../../sessions/agent-session');
const { listProviders, isKnownProvider, resolveProviderKey } = require('../../sessions/providers');

const AGENT_THEMES = ['Peach', 'Midnight', 'Cloud', 'Moss'];

/** IPC for creating, launching, configuring and removing agents (Control Centre). */
function registerAgentIpc() {
  ipcMain.handle('get-initial-state', () => ({
    provider: defaultProviderKey(),
    providers: listProviders(),
    theme: getCurrentTheme(),
    user: { name: 'User', avatar: 'U' },
    agents: state.characters.map(c => ({
      id: c.agentId || c.name,
      name: c.name,
      color: c.color,
      provider: providerFor(c),
      status: c.session ? 'active' : 'idle',
      personality: '',
      role: ''
    }))
  }));

  ipcMain.handle('get-agents', async () => {
    if (!isDBConnected()) return [];
    try {
      const agents = await Agent.find().sort({ createdAt: -1 });
      return agents.map(a => Object.assign(a.toObject(), { _id: a._id.toString() }));
    } catch (err) {
      console.error('[DB] get-agents error:', err.message);
      return [];
    }
  });

  ipcMain.handle('save-agent', async (event, config) => {
    if (!requireControlCentre(event, 'save-agent')) return false;
    if (!isDBConnected()) return false;
    if (!config || typeof config !== 'object') return false;

    // Only known fields, with values the app can actually use (the form uses selects,
    // but never trust the renderer — e.g. an unknown provider silently became Vision)
    const name = typeof config.name === 'string' ? config.name.trim().slice(0, 60) : '';
    const provider = isKnownProvider(config.provider) ? resolveProviderKey(config.provider) : null;
    const theme = AGENT_THEMES.includes(config.theme) ? config.theme : null;
    if (!name || !provider || !theme) {
      console.warn('[DB] save-agent rejected: invalid name/provider/theme');
      return false;
    }
    try {
      await new Agent({
        name,
        provider,
        theme,
        contextFile: typeof config.contextFile === 'string' ? config.contextFile.trim() : '',
        toolsEnabled: config.toolsEnabled !== false,
        orchestrator: config.orchestrator !== false
      }).save();
      return true;
    } catch (err) {
      console.error('[DB] save-agent error:', err.message);
      return false;
    }
  });

  ipcMain.on('launch-agent', (event, agentObj) => {
    if (!requireControlCentre(event, 'launch-agent')) return;
    launchAgentInstance(agentObj);
  });

  // Agents page: change an agent's own provider (running or not)
  ipcMain.handle('set-agent-provider', async (event, agentId, providerKey) => {
    if (!requireControlCentre(event, 'set-agent-provider')) return false;
    if (typeof agentId !== 'string' || !agentId) return false;
    return setAgentProvider(agentId, providerKey);
  });

  ipcMain.handle('choose-context-file', async (event) => {
    if (!requireControlCentre(event, 'choose-context-file')) return null;
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('delete-agent', async (event, id) => {
    if (!requireControlCentre(event, 'delete-agent')) return false;
    if (!isDBConnected()) return false;
    try {
      // 1. Take it off the desktop if it's running
      removeAgentInstance(id.toString());

      // 2. Delete from the database, with the agent's data: its conversations go too,
      //    while its tasks are kept but unassigned (they're the user's to-dos).
      await Agent.findByIdAndDelete(id);
      await ChatSession.deleteMany({ agentId: id });
      await Task.updateMany({ agentId: id }, { $unset: { agentId: 1 } });
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('history-updated'));
      return true;
    } catch (err) {
      console.error('[DB] delete-agent error:', err.message);
      return false;
    }
  });
}

module.exports = { registerAgentIpc };
