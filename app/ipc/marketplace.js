const os = require('os');
const { ipcMain } = require('electron');
const { requireControlCentre, sanitizeMcpServer } = require('../security');
const { restartSessions } = require('../agents');
const { getMcpServers, setMcpServers } = require('../../sessions/agent-session');
const { CATALOG, CATEGORIES, RUNTIMES, getCatalogEntry, buildConfig } = require('../../mcp-servers/catalog');
const { searchRegistry, getRegistryServer } = require('../../sessions/mcp-registry');
const { findBinary } = require('../../utils/shell-env');
const McpClientManager = require('../../sessions/mcp-client');

const ID_PATTERN = /^[\w.-]{1,64}$/;

// findBinary shells out (up to a few seconds) — cache the answer for a minute
let runtimeCache = null;
function runtimeAvailability() {
  if (runtimeCache && Date.now() - runtimeCache.at < 60000) return runtimeCache.value;
  const value = Object.fromEntries(Object.entries(RUNTIMES).map(([k, r]) => [k, !!findBinary(r.binary)]));
  runtimeCache = { at: Date.now(), value };
  return value;
}

/** Turn a start-up failure into something a user can act on. */
function friendlyError(err, config) {
  const msg = String(err?.message || err || 'Unknown error');
  if (err?.code === 'ENOENT' || /ENOENT|not found|is not recognized/i.test(msg) && config.command && !err?.serverOutput) {
    const runtime = Object.values(RUNTIMES).find(r => r.binary === config.command);
    return runtime
      ? `${config.command} wasn't found. Install ${runtime.label} (${runtime.installUrl}) and try again.`
      : `"${config.command}" wasn't found on this computer.`;
  }
  if (err?.code === 401 || err?.code === 403 || /\b(401|403)\b|unauthori[sz]ed|forbidden|authorization header/i.test(msg)) {
    return 'The server rejected the credentials. Check the token or key and try again.';
  }
  if (err?.code === -32001 || /timed? ?out/i.test(msg)) {
    return 'The server didn\'t answer within 2 minutes. (The first start downloads it — on a slow connection, try again.)';
  }
  if (err?.serverOutput) {
    const lines = err.serverOutput.split('\n').map(l => l.trim()).filter(Boolean).slice(-4).join('\n');
    return `The server stopped while starting:\n${lines}`;
  }
  return msg.slice(0, 500);
}

/** Start a server once, list its tools, and stop it again. Never throws. */
async function testServer(id, config) {
  let info;
  try {
    info = await McpClientManager.openExternalServer(id, config);
    return { ok: true, tools: (info.tools || []).map(t => t.name).filter(n => typeof n === 'string') };
  } catch (err) {
    console.warn(`[Marketplace] Test start of ${id} failed:`, err.message);
    return { ok: false, error: friendlyError(err, config) };
  } finally {
    try { if (info?.client) await info.client.close(); } catch (_) { /* already closed */ }
    try { if (info?.transport) await info.transport.close(); } catch (_) { /* already closed */ }
  }
}

function missingRuntime(config) {
  if (config.type === 'http') return null;
  const [key, runtime] = Object.entries(RUNTIMES).find(([, r]) => r.binary === config.command) || [];
  if (!runtime || runtimeAvailability()[key]) return null;
  return `${runtime.binary} wasn't found. Install ${runtime.label} (${runtime.installUrl}), then restart the app.`;
}

function saveServer(id, config) {
  const servers = getMcpServers() || {};
  servers[id] = config;
  setMcpServers(servers);
  // Reboot open AI sessions so they connect to the new server right away
  restartSessions();
}

/** A free id for a registry server: its short name, numbered if taken by another server. */
function registryServerId(entry, servers) {
  const existing = Object.entries(servers).find(([, c]) => c.registryName === entry.registryName);
  if (existing) return existing[0];
  const base = entry.registryName.split('/').pop().replace(/[^\w.-]/g, '-').slice(0, 56) || 'server';
  let id = base;
  for (let n = 2; servers[id] || getCatalogEntry(id); n++) id = `${base}-${n}`;
  return id;
}

/** The catalog as sent to the Marketplace ({home} defaults resolved). */
function catalogForUi() {
  const home = os.homedir();
  return CATALOG.map(e => ({
    ...e,
    verified: true,
    installable: true,
    fields: e.fields.map(f => ({ ...f, default: typeof f.default === 'string' ? f.default.replace('{home}', home) : '' }))
  }));
}

/** IPC for Control Centre → Connectors (Marketplace, Installed, custom servers). */
function registerMarketplaceIpc() {
  ipcMain.handle('marketplace-catalog', (event) => {
    if (!requireControlCentre(event, 'marketplace-catalog')) return null;
    return { categories: CATEGORIES, entries: catalogForUi(), runtimes: runtimeAvailability(), runtimeInfo: RUNTIMES };
  });

  ipcMain.handle('marketplace-search', async (event, query, cursor) => {
    if (!requireControlCentre(event, 'marketplace-search')) return { ok: false, error: 'Not allowed' };
    return searchRegistry(typeof query === 'string' ? query : '', typeof cursor === 'string' ? cursor : '');
  });

  // Install from the catalog or the registry. The renderer sends only which server and
  // the field values; the command / URL is always built here from data we looked up.
  ipcMain.handle('marketplace-install', async (event, request) => {
    if (!requireControlCentre(event, 'marketplace-install')) return { ok: false, error: 'Not allowed' };
    const { catalogId, registryName, version, values, force } = request || {};
    const servers = getMcpServers() || {};

    let entry, id, meta;
    if (typeof catalogId === 'string') {
      entry = getCatalogEntry(catalogId);
      if (!entry) return { ok: false, error: 'Unknown server' };
      id = entry.id;
      meta = { source: 'catalog', catalogId: entry.id, displayName: entry.name };
    } else if (typeof registryName === 'string') {
      entry = await getRegistryServer(registryName, typeof version === 'string' ? version : '');
      if (!entry) return { ok: false, error: 'Couldn\'t load this server from the MCP Registry. Try again.' };
      if (!entry.installable) return { ok: false, error: entry.reason };
      id = registryServerId(entry, servers);
      meta = { source: 'registry', registryName: entry.registryName, registryVersion: entry.version, displayName: entry.name };
    } else {
      return { ok: false, error: 'Nothing to install' };
    }

    let config;
    try {
      const fieldValues = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
      config = sanitizeMcpServer({ ...buildConfig(entry, fieldValues), ...meta });
    } catch (err) {
      return { ok: false, error: err.message };
    }
    if (!config) return { ok: false, error: 'This server\'s settings aren\'t valid (hosted servers must use https).' };

    const noRuntime = missingRuntime(config);
    if (noRuntime) return { ok: false, error: noRuntime };

    let tools = [];
    if (!force) {
      const test = await testServer(id, config);
      if (!test.ok) return { ok: false, error: test.error, canForce: true };
      tools = test.tools;
    }
    saveServer(id, config);
    console.log(`[Marketplace] Installed ${id} (${meta.source})`);
    return { ok: true, id, tools };
  });

  // Test a saved server (by id) or an unsaved custom config
  ipcMain.handle('mcp-test-server', async (event, target) => {
    if (!requireControlCentre(event, 'mcp-test-server')) return { ok: false, error: 'Not allowed' };
    let id = 'custom', config;
    if (typeof target === 'string') {
      id = target;
      config = (getMcpServers() || {})[target];
      if (!config) return { ok: false, error: 'Server not found' };
    } else {
      config = sanitizeMcpServer(target);
      if (!config) return { ok: false, error: 'Invalid server settings (hosted servers must use https).' };
    }
    const noRuntime = missingRuntime(config);
    if (noRuntime) return { ok: false, error: noRuntime };
    return testServer(id, config);
  });

  // Add or edit a custom server (Connectors → Add custom). Renaming removes the old id.
  ipcMain.handle('mcp-save-server', (event, request) => {
    if (!requireControlCentre(event, 'mcp-save-server')) return { ok: false, error: 'Not allowed' };
    const { id, config: raw, previousId } = request || {};
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      return { ok: false, error: 'Name can only use letters, numbers, dots, dashes and underscores (max 64).' };
    }
    const servers = getMcpServers() || {};
    if (id !== previousId && servers[id]) return { ok: false, error: `A server named "${id}" already exists.` };
    const config = sanitizeMcpServer({ source: 'custom', ...raw });
    if (!config) return { ok: false, error: 'Invalid server settings. Hosted servers must use https (or http://localhost).' };
    if (typeof previousId === 'string' && previousId !== id) delete servers[previousId];
    servers[id] = config;
    setMcpServers(servers);
    restartSessions();
    return { ok: true, id };
  });

  ipcMain.handle('mcp-uninstall', (event, id) => {
    if (!requireControlCentre(event, 'mcp-uninstall')) return false;
    const servers = getMcpServers() || {};
    if (typeof id !== 'string' || !servers[id]) return false;
    delete servers[id];
    setMcpServers(servers);
    restartSessions();
    console.log(`[Marketplace] Removed ${id}`);
    return true;
  });
}

module.exports = { registerMarketplaceIpc, friendlyError };
