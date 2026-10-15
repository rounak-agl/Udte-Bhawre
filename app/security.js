const { dialog, shell } = require('electron');
const { isControlCentreSender } = require('./control-centre');

/** Reject privileged IPC that doesn't come from the Control Centre window. */
function requireControlCentre(event, channel) {
  if (isControlCentreSender(event)) return true;
  console.warn(`[IPC] Rejected "${channel}" from a non-Control-Centre window`);
  return false;
}

/**
 * Validate an MCP server map from the renderer: { id: { command, args[], env{} } }.
 * Returns a clean copy, or null if anything is malformed.
 */
function sanitizeMcpServers(servers) {
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return null;
  const clean = {};
  for (const [id, cfg] of Object.entries(servers)) {
    if (!/^[\w.-]{1,64}$/.test(id)) return null;
    if (!cfg || typeof cfg !== 'object') return null;
    if (typeof cfg.command !== 'string' || !cfg.command.trim()) return null;
    const args = cfg.args ?? [];
    if (!Array.isArray(args) || !args.every(a => typeof a === 'string')) return null;
    const env = cfg.env ?? {};
    if (typeof env !== 'object' || Array.isArray(env) ||
        !Object.entries(env).every(([k, v]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && typeof v === 'string')) return null;
    clean[id] = { command: cfg.command.trim(), args: [...args], env: { ...env } };
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
  installNavigationGuards,
  approveToolCall,
  emitSecurityEventToUI
};
