const { dialog, shell } = require('electron');
const { isControlCentreSender } = require('./control-centre');

/** Reject privileged IPC that doesn't come from the Control Centre window. */
function requireControlCentre(event, channel) {
  if (isControlCentreSender(event)) return true;
  console.warn(`[IPC] Rejected "${channel}" from a non-Control-Centre window`);
  return false;
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/; // RFC 9110 token
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const SOURCES = new Set(['catalog', 'registry', 'custom']);

function stringMap(obj, keyPattern, valueOk = () => true) {
  if (obj === undefined || obj === null) return {};
  if (typeof obj !== 'object' || Array.isArray(obj)) return null;
  const entries = Object.entries(obj);
  if (!entries.every(([k, v]) => keyPattern.test(k) && typeof v === 'string' && valueOk(v))) return null;
  return Object.fromEntries(entries);
}

/** Hosted MCP servers must use https — plain http only to this machine. */
function isAllowedServerUrl(url) {
  if (typeof url !== 'string' || url.length > 2000) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname));
  } catch (_) {
    return false;
  }
}

/**
 * Validate one MCP server config. Two shapes:
 *   local:  { type?: 'stdio', command, args[], env{} }
 *   hosted: { type: 'http', url, headers{} }
 * plus optional metadata { source, catalogId, registryName, registryVersion, displayName }.
 * Returns a clean copy (unknown fields dropped), or null if anything is malformed.
 */
function sanitizeMcpServer(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null;
  const type = cfg.type ?? 'stdio';
  let clean;
  if (type === 'stdio') {
    if (typeof cfg.command !== 'string' || !cfg.command.trim()) return null;
    const args = cfg.args ?? [];
    if (!Array.isArray(args) || !args.every(a => typeof a === 'string')) return null;
    const env = stringMap(cfg.env, ENV_NAME);
    if (!env) return null;
    clean = { command: cfg.command.trim(), args: [...args], env };
  } else if (type === 'http') {
    if (!isAllowedServerUrl(cfg.url)) return null;
    // No CR/LF in values: they'd let a value inject extra headers
    const headers = stringMap(cfg.headers, HEADER_NAME, v => !/[\r\n]/.test(v) && v.length <= 8192);
    if (!headers) return null;
    clean = { type: 'http', url: cfg.url, headers };
  } else {
    return null;
  }
  // Metadata (shown in Connectors → Installed); dropped if malformed rather than rejected
  if (SOURCES.has(cfg.source)) clean.source = cfg.source;
  if (typeof cfg.catalogId === 'string' && /^[\w.-]{1,64}$/.test(cfg.catalogId)) clean.catalogId = cfg.catalogId;
  if (typeof cfg.registryName === 'string' && /^[\w.\/-]{1,200}$/.test(cfg.registryName)) clean.registryName = cfg.registryName;
  if (typeof cfg.registryVersion === 'string' && cfg.registryVersion.length <= 64) clean.registryVersion = cfg.registryVersion;
  if (typeof cfg.displayName === 'string' && cfg.displayName.trim()) clean.displayName = cfg.displayName.trim().slice(0, 100);
  return clean;
}

/**
 * Validate an MCP server map from the renderer: { id: config } (see sanitizeMcpServer).
 * Returns a clean copy, or null if anything is malformed.
 */
function sanitizeMcpServers(servers) {
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return null;
  const clean = {};
  for (const [id, cfg] of Object.entries(servers)) {
    if (!/^[\w.-]{1,64}$/.test(id)) return null;
    const server = sanitizeMcpServer(cfg);
    if (!server) return null;
    clean[id] = server;
  }
  return clean;
}

/**
 * No window may open child windows or navigate away from the bundled UI. Without this,
 * a target="_blank" link in a chat reply opens a new Electron window that inherits the
 * preload bridge. External http(s)/mailto links go to the system browser instead.
 */
function installNavigationGuards(app) {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^(https?:\/\/|mailto:)/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (url.startsWith('file://')) return;
      event.preventDefault();
      if (/^(https?:\/\/|mailto:)/i.test(url)) shell.openExternal(url);
    });
  });
}

/** Ask the user before a desktop tool runs something risky (shell, file write, URL). */
async function approveToolCall(message) {
  const result = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Allow', 'Deny'],
    defaultId: 1,
    title: 'Tool Approval Required',
    message: 'The assistant wants to perform an action:',
    detail: message,
    cancelId: 1
  });
  return result.response === 0; // 0 = Allow
}

const MAX_PENDING_SECURITY_EVENTS = 50;

/**
 * Deliver a security banner to this agent's own chat window. If its chat isn't open
 * (or hasn't finished loading), queue it on the agent and flush when that chat reports
 * ready — never into another agent's chat.
 */
function emitSecurityEventToUI(type, data, char) {
  const event = { type, data, ts: Date.now() };
  if (char.chatReady && char.chatWindow && !char.chatWindow.isDestroyed()) {
    char.chatWindow.webContents.send('security-audit-event', event);
  } else {
    char.pendingSecurityEvents.push(event);
    if (char.pendingSecurityEvents.length > MAX_PENDING_SECURITY_EVENTS) char.pendingSecurityEvents.shift();
  }
}

module.exports = {
  requireControlCentre,
  sanitizeMcpServers,
  sanitizeMcpServer,
  isAllowedServerUrl,
  installNavigationGuards,
  approveToolCall,
  emitSecurityEventToUI
};
