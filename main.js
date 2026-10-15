/**
 * Electron main process — entry point. Wires the modules in app/ together and runs the
 * app lifecycle; the actual behaviour lives in:
 *   app/character.js       a bot: walking window, bubble, chat window, AI session
 *   app/agents.js          launching/syncing/removing bots, per-bot provider
 *   app/tray.js            tray icon + menu
 *   app/overlay.js         step-guide overlay + step panel
 *   app/control-centre.js  Control Centre window
 *   app/security.js        IPC gatekeeping, navigation guards, approval prompts
 *   app/ipc/*.js           IPC handlers, grouped by feature
 */
const { app } = require('electron');

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
  app.commandLine.appendSwitch('disable-gpu');
  app.disableHardwareAcceleration();
}

// Write/validate the ArmorIQ config and policy files before any session code loads
const { runBootstrap } = require('./sessions/bootstrap');
runBootstrap();

const state = require('./app/state');
const { installNavigationGuards } = require('./app/security');
const { launchAgentInstance, syncAgentsWithDB } = require('./app/agents');
const { startWalkLoop } = require('./app/character');
const { setupTray, trayMenuTemplate } = require('./app/tray');
const { createOverlayWindow, destroyOverlay, registerOverlayIpc } = require('./app/overlay');
const { openControlCentre, registerControlCentreIpc } = require('./app/control-centre');
const { registerChatIpc } = require('./app/ipc/chat');
const { registerAgentIpc } = require('./app/ipc/agents');
const { registerDataIpc } = require('./app/ipc/data');
const { registerProviderIpc } = require('./app/ipc/providers');
const { registerSettingsIpc } = require('./app/ipc/settings');
const { migrateSecrets, getMongodbUri } = require('./sessions/agent-session');
const { status: secretStatus } = require('./utils/secret-store');
const { connectDB } = require('./utils/db');

// ── Security + IPC (registered at load, before any window exists) ──
installNavigationGuards(app);
registerChatIpc();
registerAgentIpc();
registerDataIpc();
registerProviderIpc();
registerSettingsIpc();
registerOverlayIpc();
registerControlCentreIpc();

// ── Lifecycle ──
app.whenReady().then(async () => {
  // safeStorage only works from here on: encrypt any secrets still stored as plain text
  const secrets = secretStatus();
  const migrated = migrateSecrets();
  console.log(`[Secrets] ${secrets.encrypted ? `Encrypted at rest (${secrets.backend || secrets.platform})` : '⚠️  No OS credential store — secrets stored unencrypted'}${migrated ? `; encrypted ${migrated} existing value(s)` : ''}`);

  state.screenCapture.start();

  // Connect to the database and put its agents on the desktop
  try {
    const connected = await connectDB(getMongodbUri() || process.env.MONGODB_URI);
    if (connected) {
      console.log('[DB] Loading stored agents...');
      await syncAgentsWithDB();
    }
  } catch (e) {
    console.error('[DB] Connection/Load failed:', e);
  }

  openControlCentre('dashboard');
  setupTray();
  startWalkLoop();
  createOverlayWindow();
});

app.on('window-all-closed', () => {
  // Don't quit when windows close — we're a tray app
});

app.on('before-quit', () => {
  state.isQuitting = true;
  // Stop screen capture and clear ALL screenshots
  state.screenCapture.stop();
  state.characters.forEach(c => c.destroy());
  destroyOverlay();
});

// Used by tests (test/main-harness.js drives the real main process through these)
module.exports = { launchAgentInstance, openControlCentre, trayMenuTemplate };
