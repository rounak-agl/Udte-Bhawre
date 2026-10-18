/**
 * Electron main process — entry point. Wires the modules in app/ together and runs the
 * app lifecycle; the actual behaviour lives in:
 *   app/character.js       a bot: walking window, bubble, chat window, AI session
 *   app/agents.js          launching/syncing/removing bots, per-bot provider
 *   app/tray.js            tray icon + menu
 *   app/control-centre.js  Control Centre window
 *   app/security.js        IPC gatekeeping, navigation guards, approval prompts
 *   app/ipc/*.js           IPC handlers, grouped by feature (marketplace.js: MCP Connectors)
 */
const { app } = require('electron');

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
  // Software rendering keeps transparent windows working on every Linux setup, but the
  // 3D crew then costs a lot of CPU. GPU=1 renders on the graphics card instead.
  if (process.env.GPU !== '1') {
    app.commandLine.appendSwitch('disable-gpu');
    app.disableHardwareAcceleration();
  }
}

// Node gives each resolved address only 250 ms to connect before moving on; on a slow or
// distant link every attempt is abandoned and fetch() fails with ETIMEDOUT (seen with the
// MCP Registry and hosted MCP servers that curl reaches fine). Give each attempt longer.
require('net').setDefaultAutoSelectFamilyAttemptTimeout(2500);

// Write/validate the ArmorIQ config and policy files before any session code loads
const { runBootstrap } = require('./sessions/bootstrap');
runBootstrap();

const state = require('./app/state');
const { installNavigationGuards } = require('./app/security');
const { launchAgentInstance, syncAgentsWithDB } = require('./app/agents');
const { startWalkLoop } = require('./app/character');
const { setupTray, trayMenuTemplate } = require('./app/tray');
const { openControlCentre, registerControlCentreIpc } = require('./app/control-centre');
const { registerChatIpc } = require('./app/ipc/chat');
const { registerAgentIpc } = require('./app/ipc/agents');
const { registerDataIpc } = require('./app/ipc/data');
const { registerProviderIpc } = require('./app/ipc/providers');
const { registerSettingsIpc } = require('./app/ipc/settings');
const { registerMarketplaceIpc } = require('./app/ipc/marketplace');
const { registerOrchestrationIpc } = require('./app/ipc/orchestration');
const { migrateSecrets, getMongodbUri } = require('./sessions/agent-session');
const { status: secretStatus } = require('./utils/secret-store');
const { connectDB } = require('./utils/db');
const { markInterruptedTasks } = require('./app/orchestrator');
const { registerCrewIpc, startCrewUI } = require('./app/crew-ui');

// The 3D crew is the default UI; CREW_UI=0 brings back the classic Control Centre and 2D bots.
// The crew is a separate build (ui/dist, made by `npm run build:ui`): without it, use classic.
const CREW_BUILT = !!process.env.CREW_UI_DEV || require('fs').existsSync(require('path').join(__dirname, 'ui', 'dist', 'index.html'));
const CREW_UI = process.env.CREW_UI !== '0' && CREW_BUILT;
if (process.env.CREW_UI !== '0' && !CREW_BUILT) {
  console.warn('[crew] The 3D crew UI is not built yet (ui/dist is missing). Run `npm run build:ui`, then restart. Opening the classic UI for now.');
}
state.crewUI = CREW_UI;

// ── Security + IPC (registered at load, before any window exists) ──
installNavigationGuards(app);
registerChatIpc();
registerAgentIpc();
registerDataIpc();
registerProviderIpc();
registerSettingsIpc();
registerMarketplaceIpc();
registerOrchestrationIpc();
registerControlCentreIpc();
registerCrewIpc();

// ── Lifecycle ──
app.whenReady().then(async () => {
  // safeStorage only works from here on: encrypt any secrets still stored as plain text
  const secrets = secretStatus();
  const migrated = migrateSecrets();
  console.log(`[Secrets] ${secrets.encrypted ? `Encrypted at rest (${secrets.backend || secrets.platform})` : '⚠️  No OS credential store — secrets stored unencrypted'}${migrated ? `; encrypted ${migrated} existing value(s)` : ''}`);

  // Connect to the database and put its agents on the desktop
  try {
    const connected = await connectDB(getMongodbUri() || process.env.MONGODB_URI);
    if (connected) {
      await markInterruptedTasks(); // sub-agent tasks cut off by the last quit
      if (!CREW_UI) {
        console.log('[DB] Loading stored agents...');
        await syncAgentsWithDB();
      }
    }
  } catch (e) {
    console.error('[DB] Connection/Load failed:', e);
  }

  setupTray();
  if (CREW_UI) {
    startCrewUI();
    return;
  }
  openControlCentre('dashboard');
  startWalkLoop();
});

app.on('window-all-closed', () => {
  // Don't quit when windows close — we're a tray app
});

app.on('before-quit', () => {
  state.isQuitting = true;
  state.characters.forEach(c => c.destroy());
});

// Used by tests (test/main-harness.js drives the real main process through these)
module.exports = { launchAgentInstance, openControlCentre, trayMenuTemplate };
