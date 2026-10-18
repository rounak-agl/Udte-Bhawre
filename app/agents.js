const state = require('./state');
const appEvents = require('./events');
const { Character } = require('./character');
const { isDBConnected, Agent, ChatSession } = require('../utils/db');
const { resolveProviderKey, isKnownProvider } = require('../sessions/providers');

/**
 * Bots on the desktop: launching them from saved agents, keeping them in sync with the
 * database, removing them, and per-bot changes that must reach a running bot.
 */

const THEME_COLORS = {
  Moss: ['#8c9480', '#666b5d'],
  Peach: ['#f28ca6', '#c86f87'],
  Cloud: ['#0078d6', '#005bb5'],
  Midnight: ['#ff6600', '#cc5200']
};

/** The running bot for an agent id, if any. */
function findCharacter(agentId) {
  return state.characters.find(c => c.agentId && c.agentId === String(agentId));
}

/** The bot whose chat window sent this IPC event. */
function charForChatSender(event) {
  return state.characters.find(c =>
    c.chatWindow && !c.chatWindow.isDestroyed() && c.chatWindow.webContents === event.sender
  );
}

/**
 * Load an agent's most recently updated conversation from the database into
 * `char.restoredHistory`; its first session starts from there (see createSession).
 */
async function loadLatestConversation(char) {
  if (!char.agentId || !isDBConnected()) return;
  try {
    const latest = await ChatSession.findOne({ agentId: char.agentId }).sort({ updatedAt: -1 });
    if (!latest || char.session) return; // nothing saved, or a session already started
    char.sessionId = latest._id;
    char.restoredHistory = latest.toObject().messages.map(({ role, text, isTool, internal, timestamp }) => ({ role, text, isTool, internal, timestamp }));
    console.log(`[DB] Restored ${char.restoredHistory.length} messages for agent "${char.name}"`);
  } catch (err) {
    console.error('[DB] Failed to restore conversation:', err.message);
  }
}

/** Put a saved agent on the desktop (no-op if it's already running). */
function launchAgentInstance(agentObj) {
  if (findCharacter(agentObj._id.toString())) return;

  const [color, colorDark] = THEME_COLORS[agentObj.theme] || THEME_COLORS.Midnight;
  const char = new Character({
    name: agentObj.name,
    color,
    colorDark,
    startPosition: Math.random() * 0.8 + 0.1,
    yOffset: -3,
    initialPause: 500 + Math.random() * 2000,
    isOnboarding: false
  });

  char.agentId = agentObj._id.toString();
  char.systemPromptFile = agentObj.contextFile;

  char.createCharacterWindow();
  state.characters.push(char);

  // Each bot has its own provider, theme and tools setting
  char.provider = agentObj.provider ? resolveProviderKey(agentObj.provider) : null;
  char.theme = agentObj.theme;
  char.toolsEnabled = agentObj.toolsEnabled !== false;
  char.orchestrator = agentObj.orchestrator !== false;
  // Restore the agent's most recent conversation so it picks up where it left off
  char.historyLoaded = Promise.all([
    loadLatestConversation(char),
    char.refreshTeamMemory().catch(() => {})
  ]);

  appEvents.emit('agents-changed');
}

/** Take a bot off the desktop (closes its windows and session). */
function removeAgentInstance(agentId) {
  const char = findCharacter(agentId);
  if (!char) return false;
  char.destroy();
  state.characters.splice(state.characters.indexOf(char), 1);
  appEvents.emit('agents-changed');
  return true;
}

/**
 * Make the desktop match the connected database: launch its agents (already-running
 * ones are skipped) and remove bots that belong to a previously connected database.
 * Runs at startup and after the MongoDB URI is changed in Settings.
 */
async function syncAgentsWithDB() {
  if (!isDBConnected() || state.crewUI) return;
  try {
    const agents = await Agent.find().sort({ createdAt: 1 });
    console.log(`[DB] Found ${agents.length} agents in database.`);
    const ids = new Set(agents.map(a => a._id.toString()));
    for (const char of [...state.characters]) {
      if (char.agentId && !ids.has(char.agentId)) removeAgentInstance(char.agentId);
    }
    for (const agent of agents) {
      launchAgentInstance(agent);
    }
  } catch (err) {
    console.error('[DB] syncAgentsWithDB error:', err.message);
  }
}

/**
 * Give one bot its own provider (chat ⚙ menu, Agents page and tray all use this).
 * A running bot switches immediately and keeps its conversation; the choice is saved
 * on the agent so it survives restarts. Works for agents that aren't running too.
 */
async function setAgentProvider(agentId, providerKey) {
  if (!isKnownProvider(providerKey)) return false;
  const key = resolveProviderKey(providerKey);
  const char = findCharacter(agentId);
  if (char) {
    char.provider = key;
    char.sendToChat('provider-change', key);
    char.sendToChat('chat-turn-complete');
    if (char.session) char.createSession();
  }
  if (agentId && isDBConnected()) {
    try {
      await Agent.findByIdAndUpdate(agentId, { provider: key });
    } catch (err) {
      console.error('[DB] Failed to save agent provider:', err.message);
      return false;
    }
  }
  appEvents.emit('agents-changed');
  return true;
}

/**
 * Apply a settings change to running agents. Only sessions that already exist (chats
 * that were opened) are restarted; the rest are created lazily when their chat opens,
 * so a settings change doesn't spawn a CLI / MCP servers for every agent at once.
 * `notify(char)` runs first for each character, e.g. to message its open chat window.
 */
function restartSessions(notify) {
  state.characters.forEach(c => {
    if (notify) notify(c);
    if (c.session) c.createSession();
  });
  if (state.crewUI) require('./crew-backend').restartAll();
}

module.exports = {
  findCharacter,
  charForChatSender,
  launchAgentInstance,
  removeAgentInstance,
  syncAgentsWithDB,
  setAgentProvider,
  restartSessions
};
