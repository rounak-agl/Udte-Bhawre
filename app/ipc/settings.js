const { app, BrowserWindow, ipcMain } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const state = require('../state');
const appEvents = require('../events');
const { POLICY_FILE } = require('../paths');
const { requireControlCentre, sanitizeMcpServers } = require('../security');
const { providerFor } = require('../provider-choice');
const { restartSessions, syncAgentsWithDB } = require('../agents');
const { switchDB, isDBConnected } = require('../../utils/db');
const { status: secretStatus } = require('../../utils/secret-store');
const {
  setCurrentProvider, setCurrentTheme, getApiKey, setApiKey,
  getElevenLabsApiKey, setElevenLabsApiKey, getMongodbUri, setMongodbUri,
  getMcpServers, setMcpServers, API_KEY_PROVIDERS, apiKeyProviderFor,
  getAllProviderApiKeys, setProviderApiKey, getArmorIQApiKey, setArmorIQApiKey
} = require('../../sessions/agent-session');
const { isKnownProvider, resolveProviderKey } = require('../../sessions/providers');

/** IPC for Control Centre → Settings / Connectors (and the theme picker in chats). */
function registerSettingsIpc() {
  // ── Appearance & default provider ──
  ipcMain.on('set-theme', (event, theme) => {
    setCurrentTheme(theme);
    BrowserWindow.getAllWindows().forEach(win => win.webContents.send('theme-change', theme));
    appEvents.emit('settings-changed');
  });

  ipcMain.on('set-provider', (event, providerKey) => {
    if (!requireControlCentre(event, 'set-provider')) return;
    if (!isKnownProvider(providerKey)) return;
    setCurrentProvider(resolveProviderKey(providerKey));
    // Only bots without a provider of their own follow the default
    state.characters.forEach(c => {
      if (c.provider || !c.session) return;
      c.sendToChat('provider-change', providerFor(c));
      c.sendToChat('chat-turn-complete');
      c.createSession();
    });
    appEvents.emit('settings-changed');
  });

  // ── MCP servers (Connectors) ──
  ipcMain.handle('get-mcp-servers', (event) => {
    if (!requireControlCentre(event, 'get-mcp-servers')) return {};
    return getMcpServers();
  });

  ipcMain.on('set-mcp-servers', (event, rawServers) => {
    // MCP configs launch arbitrary processes — Control Centre only, and well-formed only.
    if (!requireControlCentre(event, 'set-mcp-servers')) return;
    const servers = sanitizeMcpServers(rawServers);
    if (!servers) {
      console.warn('[MCP] Rejected malformed MCP server config');
      return;
    }
    setMcpServers(servers);
    console.log('[MCP] Updated server configs in settings file.');
    // Reboot open AI sessions so they connect to the new servers immediately
    restartSessions();
  });

  // ── API keys ──
  ipcMain.on('set-api-key', (event, key) => {
    if (!requireControlCentre(event, 'set-api-key')) return;
    setApiKey(key);
    // Recreate open sessions so they use the new key
    restartSessions(c => c.sendToChat('api-key-changed'));
  });

  ipcMain.handle('get-api-key', (event) => {
    if (!requireControlCentre(event, 'get-api-key')) return '';
    return getApiKey();
  });

  // Whether secrets are encrypted at rest — shown in Control Centre → Settings
  ipcMain.handle('get-secret-storage-status', (event) => {
    if (!requireControlCentre(event, 'get-secret-storage-status')) return null;
    return secretStatus();
  });

  // Per-provider API keys (Gemini / Claude / Codex / Copilot)
  ipcMain.handle('get-provider-api-keys', (event) => {
    if (!requireControlCentre(event, 'get-provider-api-keys')) return {};
    return getAllProviderApiKeys();
  });

  ipcMain.on('set-provider-api-key', (event, provider, key) => {
    if (!requireControlCentre(event, 'set-provider-api-key')) return;
    if (!API_KEY_PROVIDERS[provider] || typeof key !== 'string' || key.length > 1000) return;
    setProviderApiKey(provider, key.trim());
    // Restart only the open sessions that use this key, so it applies right away.
    // The conversation carries over (see createSession).
    state.characters.forEach(c => {
      if (!c.session || apiKeyProviderFor(providerFor(c)) !== provider) return;
      c.sendToChat('api-key-changed');
      c.createSession();
    });
    if (state.crewUI) require('../crew-backend').restartAll(c => apiKeyProviderFor(c.provider) === provider);
  });

  ipcMain.on('set-eleven-labs-api-key', (event, key) => {
    if (!requireControlCentre(event, 'set-eleven-labs-api-key')) return;
    setElevenLabsApiKey(key);
  });

  // Chat windows need this for speech-to-text, so it isn't Control-Centre-only
  ipcMain.handle('get-eleven-labs-api-key', () => getElevenLabsApiKey());

  // ── Database ──
  // Save the URI and switch to it now. The new URI is tried before the old connection
  // is dropped; the result goes back to Settings so the user knows whether it worked.
  ipcMain.handle('set-mongodb-uri', async (event, uri) => {
    if (!requireControlCentre(event, 'set-mongodb-uri')) return { connected: false, error: 'Not allowed' };
    if (typeof uri !== 'string' || uri.length > 2000) return { connected: false, error: 'Invalid URI' };
    const value = uri.trim();
    setMongodbUri(value);
    const result = await switchDB(value || process.env.MONGODB_URI || '');
    if (result.connected) await syncAgentsWithDB();
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send('history-updated'));
    return result;
  });

  ipcMain.handle('get-mongodb-uri', (event) => {
    if (!requireControlCentre(event, 'get-mongodb-uri')) return '';
    return getMongodbUri();
  });

  // ── ArmorIQ guard: key + connection test (Settings → Security) ──
  ipcMain.handle('get-armoriq-key', (event) => {
    if (!requireControlCentre(event, 'get-armoriq-key')) return '';
    return getArmorIQApiKey();
  });

  ipcMain.handle('set-armoriq-key', (event, key) => {
    if (!requireControlCentre(event, 'set-armoriq-key')) return false;
    if (typeof key !== 'string' || key.length > 500) return false;
    setArmorIQApiKey(key.trim());
    // Only sessions with guarded desktop tools use the key: restart those (conversation kept)
    state.characters.forEach(c => {
      if (c.session && typeof c.session.guardStatus === 'function') c.createSession();
    });
    if (state.crewUI) require('../crew-backend').restartAll(c => typeof c.session.guardStatus === 'function');
    return true;
  });

  ipcMain.handle('test-armoriq', async (event) => {
    if (!requireControlCentre(event, 'test-armoriq')) return null;
    const { testArmorIQConnection } = require('../../sessions/armoriq-guard');
    return testArmorIQConnection();
  });

  // ── Settings → Security & About (read-only) ──
  ipcMain.handle('get-security-overview', (event) => {
    if (!requireControlCentre(event, 'get-security-overview')) return null;
    const { loadArmorIQConfig } = require('../../sessions/armoriq-guard');
    const { builtinTools } = require('../../mcp-servers/builtin-tools');
    let policy = { allow: [], deny: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8'));
      policy = { allow: parsed.allow || [], deny: parsed.deny || [] };
    } catch (_) { /* shown as empty */ }
    const armor = loadArmorIQConfig();
    const keySources = {
      env: 'the ARMORIQ_API_KEY environment variable',
      settings: 'this page (stored encrypted)',
      openclaw: `${path.join(os.homedir(), '.openclaw', 'openclaw.json')} (legacy, plain text — save a key here to replace it)`
    };
    return {
      guard: {
        active: !!armor.apiKey,
        keySource: keySources[armor.keySource] || null,
        envOverride: armor.keySource === 'env'
      },
      policy: { ...policy, path: POLICY_FILE },
      approvalTools: builtinTools.filter(t => t.requiresApproval).map(t => t.name),
      tools: builtinTools.map(t => t.name),
      fileAccess: `Your home folder (${os.homedir()}), excluding hidden files/folders and key files`,
      secrets: secretStatus()
    };
  });

  ipcMain.handle('get-app-info', () => ({
    name: 'Desktop Assistant',
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: `${process.platform} ${process.arch}`,
    settingsFile: path.join(os.homedir(), '.desktop-assistant-settings.json'),
    policyFile: POLICY_FILE,
    database: isDBConnected() ? 'Connected' : 'Not connected'
  }));
}

module.exports = { registerSettingsIpc };
