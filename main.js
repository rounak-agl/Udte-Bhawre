const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, dialog, shell } = require('electron');

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
  app.commandLine.appendSwitch('disable-gpu');
  app.disableHardwareAcceleration();
}

const path = require('path');
const { runBootstrap } = require('./sessions/bootstrap');

// Run bootstrap before any agent classes or windows are initialized
runBootstrap();

const { getTaskbarGeometry } = require('./utils/taskbar');
const { isSoundsEnabled, toggleSounds } = require('./utils/sounds');
const { getCurrentProvider, setCurrentProvider, getCurrentTheme, setCurrentTheme, getApiKey, setApiKey, getElevenLabsApiKey, setElevenLabsApiKey, getMongodbUri, setMongodbUri, getMcpServers, setMcpServers, API_KEY_PROVIDERS, apiKeyProviderFor, getAllProviderApiKeys, setProviderApiKey, migrateSecrets, getArmorIQApiKey, setArmorIQApiKey } = require('./sessions/agent-session');
const { status: secretStatus } = require('./utils/secret-store');
const { connectDB, isDBConnected, Agent, ChatSession, Task } = require('./utils/db');
const {
  DEFAULT_PROVIDER, resolveProviderKey, listProviders, isKnownProvider,
  createSession: createProviderSession, addCustomModel, removeCustomModel
} = require('./sessions/providers');
const { listOllamaModels } = require('./sessions/ollama-session');
const ScreenCapture = require('./utils/screen-capture');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  State
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let tray = null;
let characters = [];
let onboardingDone = false;
let overlayWindow = null;
let isQuitting = false;
const screenCapture = new ScreenCapture({ maxBuffer: 3 });

let stepGuideOwner = null; // the Character whose session produced the active step guide

/** The default provider for agents without their own (falls back if it was removed). */
function defaultProviderKey() {
  const stored = resolveProviderKey(getCurrentProvider());
  return isKnownProvider(stored) ? stored : DEFAULT_PROVIDER;
}

/** The provider an agent actually uses: its own, else the default. */
function providerFor(char) {
  return char.provider ? resolveProviderKey(char.provider) : defaultProviderKey();
}

/**
 * Give one bot its own provider (chat ⚙ menu, Agents page and tray all use this).
 * A running bot switches immediately and keeps its conversation; the choice is saved
 * on the agent so it survives restarts. Works for agents that aren't running too.
 */
async function setAgentProvider(agentId, providerKey) {
  if (!isKnownProvider(providerKey)) return false;
  const key = resolveProviderKey(providerKey);
  const char = characters.find(c => c.agentId && c.agentId === String(agentId));
  if (char) {
    char.provider = key;
    if (char.chatWindow && !char.chatWindow.isDestroyed()) {
      char.chatWindow.webContents.send('provider-change', key);
      char.chatWindow.webContents.send('chat-turn-complete');
    }
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
  rebuildTrayMenu();
  return true;
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

// Thinking bubble phrases
const THINKING_PHRASES = [
  'hmm...', 'thinking...', 'let me see...', 'one sec...',
  'working on it...', 'almost there...', '🤔', 'processing...',
  'figuring it out...', 'brb thinking...', 'hold on...',
  'crunching...', 'analyzing...', 'on it!', '💭'
];

// Theme bubble colors
const BUBBLE_THEMES = {
  'Peach': {
    bubbleBg: 'rgba(255, 242, 230, 0.95)',
    bubbleBorder: 'rgba(242, 140, 166, 0.6)',
    bubbleText: 'rgba(140, 128, 133, 1)',
    bubbleCompletionBorder: 'rgba(77, 191, 128, 0.7)',
    bubbleCompletionText: 'rgba(51, 153, 102, 1)',
    bubbleCornerRadius: '14px'
  },
  'Midnight': {
    bubbleBg: 'rgba(26, 26, 26, 0.92)',
    bubbleBorder: 'rgba(255, 102, 0, 0.6)',
    bubbleText: 'rgba(179, 179, 179, 1)',
    bubbleCompletionBorder: 'rgba(77, 204, 77, 0.7)',
    bubbleCompletionText: 'rgba(77, 217, 77, 1)',
    bubbleCornerRadius: '12px'
  },
  'Cloud': {
    bubbleBg: 'rgba(240, 242, 247, 0.95)',
    bubbleBorder: 'rgba(0, 120, 214, 0.4)',
    bubbleText: 'rgba(115, 120, 133, 1)',
    bubbleCompletionBorder: 'rgba(51, 179, 77, 0.6)',
    bubbleCompletionText: 'rgba(38, 140, 51, 1)',
    bubbleCornerRadius: '12px'
  },
  'Moss': {
    bubbleBg: 'rgba(209, 214, 199, 0.95)',
    bubbleBorder: 'rgba(140, 148, 128, 0.7)',
    bubbleText: 'rgba(102, 107, 97, 1)',
    bubbleCompletionBorder: 'rgba(51, 128, 51, 0.7)',
    bubbleCompletionText: 'rgba(38, 102, 38, 1)',
    bubbleCornerRadius: '8px'
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Character Class
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class Character {
  constructor(config) {
    this.name = config.name || 'Buddy';
    this.color = config.color || '#66b88d';
    this.colorDark = config.colorDark || '#4a9b72';
    this.positionProgress = config.startPosition || 0.5;
    this.direction = 1; // 1 = right, -1 = left
    this.isWalking = false;
    this.isPaused = true;
    this.manuallyVisible = true;
    this.yOffset = config.yOffset || 0;

    // Walk timing
    this.walkSpeed = 0.0015 + Math.random() * 0.001;
    this.pauseEndTime = Date.now() + (config.initialPause || 2000);
    this.walkTarget = 0.5;

    // Windows
    this.charWindow = null;
    this.chatWindow = null;
    this.bubbleWindow = null;

    // Session
    this.session = null;
    this.isOnboarding = config.isOnboarding || false;

    // Bubble
    this.thinkingInterval = null;
    this.bubbleTimeout = null;

    // Flight animation
    this.isFlying = false;
    this.flyStartPos = null;
    this.flyTargetPos = null;
    this.flyStartTime = 0;
    this.flyDuration = 500;
    this.savedTaskbarPos = null;

    // Database linkage
    this.agentId = null;
    this.sessionId = null;            // ChatSession document the conversation is saved to
    this.systemPromptFile = null;
    this.toolsEnabled = true;         // per-agent: desktop tools for Gemini Vision
    this.restoredHistory = null;      // last saved conversation, loaded at launch
    this.historyLoaded = Promise.resolve();
    this._saveChain = Promise.resolve();

    this.guardState = null; // ArmorIQ shield badge state (see setGuardState)

    // Security banners for this agent, held until its chat window is ready
    this.chatReady = false;
    this.pendingSecurityEvents = [];


    // Internal flags
    this._destroying = false;
  }

  createCharacterWindow() {
    this.charWindow = new BrowserWindow({
      width: 64,
      height: 80,
      transparent: true,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      focusable: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.charWindow.setIgnoreMouseEvents(false);
    this.charWindow.loadFile(path.join(__dirname, 'renderer', 'character.html'));

    this.charWindow.webContents.on('did-finish-load', () => {
      this.charWindow.webContents.send('character-config', {
        color: this.color,
        colorDark: this.colorDark,
        name: this.name
      });
    });

    // Prevent closing (unless intentionally destroying or quitting)
    this.charWindow.on('close', (e) => {
      if (!this._destroying && !isQuitting) {
        e.preventDefault();
        this.charWindow.hide();
      }
    });
  }

  async createChatWindow() {
    if (this.chatWindow && !this.chatWindow.isDestroyed()) {
      this.chatWindow.show();
      this.chatWindow.focus();
      return;
    }

    // Start the session before the window loads so its history can be replayed. The
    // first time, wait for the last saved conversation to be restored from the DB.
    if (!this.session) {
      await this.historyLoaded;
      if (!this.session) this.createSession();
    }
    // A second click may have opened the window while we were waiting
    if (this.chatWindow && !this.chatWindow.isDestroyed()) {
      this.chatWindow.show();
      this.chatWindow.focus();
      return;
    }
    if (!this.charWindow || this.charWindow.isDestroyed()) return; // agent deleted meanwhile

    const { workArea } = getTaskbarGeometry();
    const charBounds = this.charWindow.getBounds();

    // Position the chat window above the character
    let chatX = charBounds.x - 150;
    let chatY = charBounds.y - 420;

    // Keep within the primary display's work area (absolute coords — it may not be at 0,0)
    chatX = Math.max(workArea.x + 10, Math.min(chatX, workArea.x + workArea.width - 370));
    chatY = Math.max(workArea.y + 10, chatY);

    this.chatWindow = new BrowserWindow({
      width: 360,
      height: 420,
      x: chatX,
      y: chatY,
      transparent: true,
      frame: false,
      resizable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      minWidth: 280,
      minHeight: 300,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.chatWindow.loadFile(path.join(__dirname, 'renderer', 'chat.html'));

    this.chatWindow.webContents.on('did-finish-load', () => {
      // Initial state is applied silently (unlike 'provider-change', which announces a switch)
      this.chatWindow.webContents.send('chat-init', {
        theme: this.theme || getCurrentTheme(),
        provider: providerFor(this),
        providers: listProviders(),
        toolsEnabled: this.toolsEnabled !== false,
        guard: this.guardState
      });

      // Replay the conversation so reopening the chat continues where it left off
      if (this.session && this.session.history.length > 0) {
        this.chatWindow.webContents.send('chat-history', this.session.history);
      }
    });

    this.chatWindow.on('closed', () => {
      this.chatWindow = null;
      this.chatReady = false;
    });
  }

  /**
   * (Re)create the AI session for this agent.
   * By default the current conversation is carried into the new session — or, for the
   * first session after launch, the last conversation restored from the database — so
   * the agent keeps its memory across settings changes and app restarts, and keeps
   * saving to the same ChatSession document. `fresh: true` starts a new conversation
   * (used when the saved conversation is deleted from the Control Centre).
   */
  createSession({ fresh = false } = {}) {
    const providerKey = providerFor(this);
    const carried = fresh ? [] : (this.session ? this.session.history : (this.restoredHistory || []));
    this.restoredHistory = null;
    if (this.session) {
      this.session.terminate();
      this.session.removeAllListeners();
    }
    if (fresh) {
      this.sessionId = null;
      this._conversationEpoch = (this._conversationEpoch || 0) + 1; // drop queued saves of the old one
    }
    this.stopThinking();

    this.setGuardState(null); // known again once the new session is ready
    // The registry knows every provider (built-in CLIs/APIs and user-added local models)
    this.session = createProviderSession(providerKey, {
      screenCapture,
      toolsEnabled: this.toolsEnabled !== false
    });

    // Agent persona/context file: applied before start so CLI providers get it at launch
    this.session.systemPrompt = this.loadSystemPrompt();

    // Conversation memory (errors are transient and not carried over)
    this.session.history = carried.filter(m => m && m.role !== 'error').map(m => ({ ...m }));
    if (typeof this.session.restoreContext === 'function') {
      this.session.restoreContext(this.session.history);
    }

    // Wire up session events to chat window
    this.session.on('text', (text) => {
      if (this.chatWindow && !this.chatWindow.isDestroyed()) {
        this.chatWindow.webContents.send('chat-text', text);
      }
    });

    this.session.on('error', (text) => {
      if (this.chatWindow && !this.chatWindow.isDestroyed()) {
        this.chatWindow.webContents.send('chat-error', text);
      }
      // stopThinking, not hideBubble: many error paths never emit turnComplete, and the
      // thinking interval would otherwise keep re-showing the bubble forever.
      this.stopThinking();
    });

    this.session.on('toolUse', (name, input) => {
      if (this.chatWindow && !this.chatWindow.isDestroyed()) {
        this.chatWindow.webContents.send('chat-tool-use', name, input);
      }
    });

    this.session.on('toolResult', (summary, isError) => {
      if (this.chatWindow && !this.chatWindow.isDestroyed()) {
        this.chatWindow.webContents.send('chat-tool-result', summary, isError);
      }
    });

    // ── Security events (ArmorIQ) ──
    this.session.on('security:intent-sealed', (data) => {
      emitSecurityEventToUI('intent-sealed', data, this);
      this.setGuardState('active');
    });
    this.session.on('security:intent-failed', (data) => {
      emitSecurityEventToUI('intent-failed', data, this);
      this.setGuardState(data && data.unreachable ? 'unreachable' : 'error', data && data.reason);
    });
    this.session.on('security:tool-allowed', (data) => emitSecurityEventToUI('tool-allowed', data, this));
    this.session.on('security:enforcement-block', (data) => emitSecurityEventToUI('enforcement-block', data, this));
    this.session.on('security:fallback-approved', (data) => emitSecurityEventToUI('fallback-approved', data, this));

    this.session.on('sessionReady', () => {
      if (this.chatWindow && !this.chatWindow.isDestroyed()) {
        this.chatWindow.webContents.send('chat-session-ready');
      }
      // Is this agent's desktop-tool use guarded by ArmorIQ? (null = nothing to guard)
      const gs = typeof this.session.guardStatus === 'function' ? this.session.guardStatus() : null;
      this.setGuardState(gs && gs.covered ? (gs.enabled ? 'active' : 'off') : null);
    });

    this.session.on('turnComplete', () => {
      if (this.chatWindow && !this.chatWindow.isDestroyed()) {
        this.chatWindow.webContents.send('chat-turn-complete');
      }
      this.stopThinking();
      this.showCompletionBubble();

      // Save history to MongoDB if agentId is present
      if (this.agentId && this.session.history.length > 0) {
        this.saveSessionHistory();
      }
    });


    // Vision-specific: step guide event
    this.session.on('stepGuide', (steps) => {
      if (steps.length > 0) {
        stepGuideOwner = this; // fly-to-element must move this agent, not characters[0]
        showOverlay();
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.webContents.send('show-step-guide', steps);
        }
      }
    });

    // Sessions with desktop tools ask the user before risky actions
    if (typeof this.session.setApprovalFunction === 'function') {
      this.session.setApprovalFunction(approveToolCall);
    }
    // The Gemini key is only used by Gemini Vision; other sessions ignore the argument
    this.session.start(getApiKey());
  }

  /**
   * Track ArmorIQ's state for this agent and show it on its chat's shield badge:
   * 'active' | 'off' (no key) | 'unreachable' (asking you instead) | 'error' | null (not applicable).
   */
  setGuardState(state, reason) {
    this.guardState = state ? { state, reason: reason || '' } : null;
    if (this.chatWindow && !this.chatWindow.isDestroyed()) {
      this.chatWindow.webContents.send('guard-status', this.guardState);
    }
  }

  /**
   * Read this agent's persona/context file (chosen in the Control Centre).
   * Returns '' when unset or unreadable; capped so a huge file can't blow up every prompt.
   */
  loadSystemPrompt() {
    if (!this.systemPromptFile) return '';
    const MAX_PROMPT_BYTES = 64 * 1024;
    try {
      const fs = require('fs');
      const os = require('os');
      let promptPath = this.systemPromptFile;
      if (promptPath.startsWith('~/') || promptPath.startsWith('~\\')) {
        promptPath = path.join(os.homedir(), promptPath.slice(2));
      }
      const { size } = fs.statSync(promptPath);
      if (size > MAX_PROMPT_BYTES) {
        console.warn(`[System Prompt] ${promptPath} is larger than ${MAX_PROMPT_BYTES} bytes — ignored`);
        return '';
      }
      const text = fs.readFileSync(promptPath, 'utf-8').trim();
      if (text) console.log('[System Prompt] Applied from', promptPath);
      return text;
    } catch (err) {
      console.error('[System Prompt] Failed to load:', err.message);
      return '';
    }
  }

  // ── Bubble ──
  createBubbleWindow() {
    if (this.bubbleWindow && !this.bubbleWindow.isDestroyed()) return;

    this.bubbleWindow = new BrowserWindow({
      width: 160,
      height: 50,
      transparent: true,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      focusable: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.bubbleWindow.setIgnoreMouseEvents(true);
    this.bubbleWindow.loadFile(path.join(__dirname, 'renderer', 'bubble.html'));
  }

  showBubble(text, isCompletion = false) {
    if (!this.bubbleWindow || this.bubbleWindow.isDestroyed()) {
      this.createBubbleWindow();
    }

    const charBounds = this.charWindow.getBounds();
    const bubbleX = charBounds.x + charBounds.width / 2 - 80;
    const bubbleY = charBounds.y - 55;
    this.bubbleWindow.setBounds({ x: Math.round(bubbleX), y: Math.round(bubbleY), width: 160, height: 50 });
    this.bubbleWindow.show();

    const themeName = this.theme || getCurrentTheme();
    const theme = BUBBLE_THEMES[themeName] || BUBBLE_THEMES['Midnight'];
    this.bubbleWindow.webContents.send('bubble-show', { text, isCompletion, theme });
  }

  hideBubble() {
    if (this.bubbleWindow && !this.bubbleWindow.isDestroyed()) {
      this.bubbleWindow.webContents.send('bubble-hide');
      this.bubbleWindow.hide();
    }
    if (this.bubbleTimeout) {
      clearTimeout(this.bubbleTimeout);
      this.bubbleTimeout = null;
    }
  }

  startThinking() {
    if (this.thinkingInterval) return;
    const showPhrase = () => {
      const phrase = THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];
      this.showBubble(phrase, false);
    };
    showPhrase();
    this.thinkingInterval = setInterval(showPhrase, 3000);
  }

  stopThinking() {
    if (this.thinkingInterval) {
      clearInterval(this.thinkingInterval);
      this.thinkingInterval = null;
    }
    this.hideBubble();
  }

  showCompletionBubble() {
    this.showBubble('done! ✨', true);
    this.bubbleTimeout = setTimeout(() => this.hideBubble(), 3000);
  }

  // ── Flight Animation ──
  flyTo(normX, normY) {
    if (!this.charWindow || this.charWindow.isDestroyed()) return;

    // normX/normY are fractions of the overlay, which covers the primary display's full
    // bounds — so map onto those bounds, including their offset on multi-monitor setups.
    const { x: dx, y: dy, width: sw, height: sh } = screen.getPrimaryDisplay().bounds;
    const bounds = this.charWindow.getBounds();

    // Save current position for return (only once, if already flying between steps)
    if (!this.savedTaskbarPos) this.savedTaskbarPos = { x: bounds.x, y: bounds.y };

    // Target position (offset to be beside the element, not on top)
    const targetX = Math.round(dx + normX * sw + (normX > 0.5 ? -80 : 40));
    const targetY = Math.round(dy + normY * sh - 40);

    this.flyStartPos = { x: bounds.x, y: bounds.y };
    this.flyTargetPos = { x: targetX, y: targetY };
    this.flyStartTime = Date.now();
    this.flyDuration = 500;
    this.isFlying = true;
    this.isWalking = false;
    this.isPaused = true;
  }

  returnToTaskbar() {
    if (!this.savedTaskbarPos || !this.charWindow || this.charWindow.isDestroyed()) {
      this.isFlying = false;
      return;
    }

    const bounds = this.charWindow.getBounds();
    this.flyStartPos = { x: bounds.x, y: bounds.y };
    this.flyTargetPos = this.savedTaskbarPos;
    this.flyStartTime = Date.now();
    this.flyDuration = 400;
    this.isFlying = true;
    this.savedTaskbarPos = null;

    // Resume walking after landing
    setTimeout(() => {
      this.isFlying = false;
      this.isPaused = true;
      this.pauseEndTime = Date.now() + 2000;
    }, 500);
  }

  // ── Walk Logic ──
  update(walkZone) {
    const now = Date.now();

    // Handle flight animation
    if (this.isFlying && this.flyStartPos && this.flyTargetPos) {
      const elapsed = now - this.flyStartTime;
      const t = Math.min(1, elapsed / this.flyDuration);
      // Ease-out cubic
      const ease = 1 - Math.pow(1 - t, 3);

      const x = this.flyStartPos.x + (this.flyTargetPos.x - this.flyStartPos.x) * ease;
      const y = this.flyStartPos.y + (this.flyTargetPos.y - this.flyStartPos.y) * ease;

      if (this.charWindow && !this.charWindow.isDestroyed()) {
        this.charWindow.setBounds({
          x: Math.round(x),
          y: Math.round(y),
          width: 64,
          height: 80
        });
      }

      if (t >= 1) {
        // Flight complete — if returning to taskbar, stop flying
        if (!this.savedTaskbarPos) {
          // Already returned or hovering at target
        }
      }
      return; // Skip normal walk logic during flight
    }

    if (this.isPaused) {
      if (now >= this.pauseEndTime) {
        this.isPaused = false;
        this.isWalking = true;
        this.walkTarget = Math.random() * 0.8 + 0.1;
        this.direction = this.walkTarget > this.positionProgress ? 1 : -1;
      }
    }

    if (this.isWalking) {
      this.positionProgress += this.direction * this.walkSpeed;

      if ((this.direction > 0 && this.positionProgress >= this.walkTarget) ||
          (this.direction < 0 && this.positionProgress <= this.walkTarget) ||
          this.positionProgress <= 0.05 || this.positionProgress >= 0.95) {
        this.positionProgress = Math.max(0.05, Math.min(0.95, this.positionProgress));
        this.isWalking = false;
        this.isPaused = true;
        this.pauseEndTime = now + 3000 + Math.random() * 7000;
      }
    }

    // Update window position
    if (this.charWindow && !this.charWindow.isDestroyed()) {
      const x = walkZone.x + walkZone.width * this.positionProgress - 32;
      const y = walkZone.y - 80 + this.yOffset;

      this.charWindow.setBounds({
        x: Math.round(x),
        y: Math.round(y),
        width: 64,
        height: 80
      });

      this.charWindow.webContents.send('position-update', {
        walking: this.isWalking,
        direction: this.direction > 0 ? 'right' : 'left'
      });

      if (this.bubbleWindow && !this.bubbleWindow.isDestroyed() && this.bubbleWindow.isVisible()) {
        const bubbleX = Math.round(x) + 32 - 80;
        const bubbleY = Math.round(y) - 55;
        this.bubbleWindow.setBounds({ x: bubbleX, y: bubbleY, width: 160, height: 50 });
      }
    }
  }

  setManuallyVisible(visible) {
    this.manuallyVisible = visible;
    if (visible) {
      this.charWindow.show();
    } else {
      this.charWindow.hide();
      this.hideBubble();
      if (this.chatWindow && !this.chatWindow.isDestroyed()) {
        this.chatWindow.close();
      }
    }
  }

  closePopover() {
    if (this.chatWindow && !this.chatWindow.isDestroyed()) {
      this.chatWindow.close();
      this.chatWindow = null;
    }
  }

  destroy() {
    this._destroying = true;
    this.stopThinking();
    this.hideBubble();
    if (this.session) {
      this.session.terminate();
    }
    if (this.charWindow && !this.charWindow.isDestroyed()) {
      this.charWindow.destroy();
    }
    if (this.chatWindow && !this.chatWindow.isDestroyed()) {
      this.chatWindow.destroy();
    }
    if (this.bubbleWindow && !this.bubbleWindow.isDestroyed()) {
      this.bubbleWindow.destroy();
    }
  }

  /**
   * Queue a save of the current conversation. Saves run one at a time, so two quick
   * turns can't both see "no sessionId yet" and create duplicate ChatSession documents.
   */
  saveSessionHistory() {
    if (!this.session) return Promise.resolve();
    // Stamp messages once so their timestamps don't change on every save
    this.session.history.forEach(m => { if (!m.timestamp) m.timestamp = new Date(); });
    const snapshot = this.session.history.slice();
    const epoch = this._conversationEpoch || 0;
    this._saveChain = this._saveChain.then(() => this._writeHistory(snapshot, epoch));
    return this._saveChain;
  }

  async _writeHistory(history, epoch) {
    try {
      if (!this.agentId) return;
      // The conversation was cleared/deleted after this save was queued — drop it
      if (epoch !== (this._conversationEpoch || 0)) return;
      if (!isDBConnected()) {
        console.log('[DB] Not connected — skipping history save.');
        return;
      }

      // Build messages array with safe text fallback
      const messages = history.map(msg => ({
        role: msg.role || 'system',
        text: msg.text || `[${msg.role}]`,
        isTool: msg.isTool || msg.role === 'toolUse' || msg.role === 'toolResult' || false,
        timestamp: msg.timestamp || new Date()
      }));

      let updated = null;
      if (this.sessionId) {
        updated = await ChatSession.findByIdAndUpdate(this.sessionId, {
          messages,
          updatedAt: new Date()
        });
      }
      // No conversation yet, or it was deleted from the Control Centre: start a new one
      if (!updated) {
        const saved = await new ChatSession({
          agentId: this.agentId,
          title: history.find(m => m.role === 'user')?.text?.substring(0, 30) || 'New Conversation',
          messages
        }).save();
        this.sessionId = saved._id;
      }
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) w.webContents.send('history-updated');
      });
    } catch(e) {
      console.error('[DB] Failed to save history:', e.message);
    }
  }
}

const { initControlCentre, openControlCentre, isControlCentreSender } = require('./main-cc');

// Reject privileged IPC that doesn't come from the Control Centre window.
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

// No window may open child windows or navigate away from the bundled UI. Without this, a
// target="_blank" link in a chat reply opens a new Electron window that inherits the
// preload bridge. External http(s)/mailto links go to the system browser instead.
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  App Lifecycle
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.whenReady().then(async () => {
  // safeStorage only works from here on: encrypt any secrets still stored as plain text
  const secrets = secretStatus();
  const migrated = migrateSecrets();
  console.log(`[Secrets] ${secrets.encrypted ? `Encrypted at rest (${secrets.backend || secrets.platform})` : '⚠️  No OS credential store — secrets stored unencrypted'}${migrated ? `; encrypted ${migrated} existing value(s)` : ''}`);

  // Start screen capture service
  screenCapture.start();

  // Connect to DB (blocking for initial load)
  const mongoUri = getMongodbUri() || process.env.MONGODB_URI;
  try {
    const connected = await connectDB(mongoUri);
    if (connected) {
      console.log('[DB] Loading stored agents...');
      await loadAllAgentsFromDB();
    }
  } catch (e) {
    console.error('[DB] Connection/Load failed:', e);
  }

  // Create Control Centre (Unified Dashboard)
  openControlCentre('dashboard');
  
  // Init Control Centre
  initControlCentre();

  setupTray();
  startUpdateLoop();
  createOverlayWindow();
});

app.on('window-all-closed', () => {
  // Don't quit when windows close — we're a tray app
});

app.on('before-quit', () => {
  isQuitting = true;
  // Stop screen capture and clear ALL screenshots
  screenCapture.stop();
  characters.forEach(c => c.destroy());
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  System Tray
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function setupTray() {
  const iconPath = path.join(__dirname, 'assets', 'q.png');
  const icon = nativeImage.createFromPath(iconPath);

  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Desktop Assistant');

  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  // Agents are restored from the DB before the tray exists; setupTray() builds the
  // menu once it does. Throwing here used to abort startup after the first agent.
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()));
}

const providerMenuLabel = (p) => (p.kind === 'ollama' ? `${p.name} (local)` : p.name);

/** The tray menu. Each bot has its own submenu: visibility and its own provider. */
function trayMenuTemplate() {
  const allProviders = listProviders();
  const defaultKey = defaultProviderKey();
  const currentThemeName = getCurrentTheme();
  const themes = ['Peach', 'Midnight', 'Cloud', 'Moss'];

  const template = [
    ...characters.map((char, index) => {
      const own = providerFor(char);
      return {
        label: `${char.name || `Agent ${index + 1}`} — ${allProviders.find(p => p.key === own)?.name || own}`,
        submenu: [
          {
            label: 'Show on desktop',
            type: 'checkbox',
            checked: char.manuallyVisible ?? true,
            click: () => {
              char.setManuallyVisible(!char.manuallyVisible);
              rebuildTrayMenu();
            }
          },
          { type: 'separator' },
          { label: 'Provider', enabled: false },
          ...allProviders.map(p => ({
            label: providerMenuLabel(p),
            type: 'radio',
            checked: p.key === own,
            click: () => {
              if (char.agentId) setAgentProvider(char.agentId, p.key);
            }
          }))
        ]
      };
    }),
    { type: 'separator' },
    {
      label: 'Sounds',
      type: 'checkbox',
      checked: isSoundsEnabled(),
      click: () => { toggleSounds(); rebuildTrayMenu(); }
    },
    {
      // Only pre-selects the provider for new agents; each bot keeps its own
      label: 'Default provider for new agents',
      submenu: allProviders.map(p => ({
        label: providerMenuLabel(p),
        type: 'radio',
        checked: p.key === defaultKey,
        click: () => {
          setCurrentProvider(p.key);
          rebuildTrayMenu();
        }
      }))
    },
    {
      label: 'Style',
      submenu: themes.map(t => ({
        label: t,
        type: 'radio',
        checked: t === currentThemeName,
        click: () => {
          setCurrentTheme(t);
          characters.forEach(c => {
            if (c.chatWindow && !c.chatWindow.isDestroyed()) {
              c.chatWindow.webContents.send('theme-change', t);
            }
          });
          rebuildTrayMenu();
        }
      }))
    },
    { type: 'separator' },
    {
      label: 'Manage MCP Servers...',
      click: () => {
        openControlCentre('connectors');
      }
    },
    {
      label: 'Set ElevenLabs API Key...',
      click: () => {
        openControlCentre('settings');
      }
    },
    {
      label: 'Set MongoDB URI...',
      click: () => {
        openControlCentre('settings');
      }
    },
    { type: 'separator' },
    {
      label: 'Open Dashboard',
      click: () => {
        openControlCentre('dashboard');
      }
    },
    {
      label: 'Settings',
      click: () => {
        openControlCentre('settings');
      }
    },
    {
      label: 'Control Centre',
      click: () => {
        openControlCentre('dashboard');
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        screenCapture.stop();
        characters.forEach(c => c.destroy());
        app.quit();
      }
    }
  ];

  return template;
}


/**
 * Apply a settings change to running agents. Only sessions that already exist (chats
 * that were opened) are restarted; the rest are created lazily when their chat opens,
 * so a settings change doesn't spawn a CLI / MCP servers for every agent at once.
 * `notify(char)` runs first for each character, e.g. to message its open chat window.
 */
function restartSessions(notify) {
  characters.forEach(c => {
    if (notify) notify(c);
    if (c.session) c.createSession();
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Update Loop (replaces CVDisplayLink)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let updateInterval = null;

function startUpdateLoop() {
  // ~30 FPS is enough for walking animation
  updateInterval = setInterval(() => {
    const taskbar = getTaskbarGeometry();
    const walkZone = taskbar.walkZone;

    characters.forEach(char => {
      if (char.manuallyVisible && char.charWindow && !char.charWindow.isDestroyed()) {
        char.update(walkZone);
      }
    });
  }, 33); // ~30fps
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  IPC Handlers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ipcMain.on('character-clicked', (event) => {
  // Find which character was clicked
  const clickedChar = characters.find(c =>
    c.charWindow && c.charWindow.webContents === event.sender
  );
  if (clickedChar) {
    // If onboarding, complete it
    if (clickedChar.isOnboarding) {
      clickedChar.isOnboarding = false;
      clickedChar.hideBubble();
    }
    clickedChar.createChatWindow().catch(err => console.error('[Chat] Failed to open chat:', err));
  }
});

// A chat window finished loading: flush that agent's queued security banners to it
ipcMain.on('renderer-ready', (event) => {
  const char = charForChatSender(event);
  if (!char) return;
  char.chatReady = true;
  char.pendingSecurityEvents.forEach(e => event.sender.send('security-audit-event', e));
  char.pendingSecurityEvents = [];
});

ipcMain.on('chat-minimize', (event) => {
  const char = characters.find(c =>
    c.chatWindow && !c.chatWindow.isDestroyed() && c.chatWindow.webContents === event.sender
  );
  if (char && char.chatWindow && !char.chatWindow.isDestroyed()) {
    char.chatWindow.hide();
  }
});

ipcMain.on('chat-send', (event, message) => {
  const char = characters.find(c =>
    c.chatWindow && !c.chatWindow.isDestroyed() && c.chatWindow.webContents === event.sender
  );
  if (char) {
    if (!char.session) {
      char.createSession();
    }
    char.startThinking();
    char.session.send(message);
  }
});


function charForChatSender(event) {
  return characters.find(c =>
    c.chatWindow && !c.chatWindow.isDestroyed() && c.chatWindow.webContents === event.sender
  );
}

// Provider picker in a chat popover: switches that agent only (not the global default).
// The conversation carries over to the new provider.
ipcMain.on('chat-set-provider', async (event, providerKey) => {
  const char = charForChatSender(event);
  if (!char || !char.agentId) return;
  await setAgentProvider(char.agentId, providerKey);
});

// Agents page: change an agent's own provider (running or not)
ipcMain.handle('set-agent-provider', async (event, agentId, providerKey) => {
  if (!requireControlCentre(event, 'set-agent-provider')) return false;
  if (typeof agentId !== 'string' || !agentId) return false;
  return setAgentProvider(agentId, providerKey);
});

// Tools toggle in a chat popover: enables/disables desktop tools for that agent only.
// The conversation carries over; the setting is saved on the agent.
ipcMain.on('chat-set-tools', async (event, enabled) => {
  const char = charForChatSender(event);
  if (!char || typeof enabled !== 'boolean') return;

  char.toolsEnabled = enabled;
  char.chatWindow.webContents.send('tools-change', enabled);
  if (char.session) char.createSession();

  if (char.agentId && isDBConnected()) {
    try {
      await Agent.findByIdAndUpdate(char.agentId, { toolsEnabled: enabled });
    } catch (err) {
      console.error('[DB] Failed to save agent tools setting:', err.message);
    }
  }
});

ipcMain.handle('get-initial-state', () => {
  return {
    provider: defaultProviderKey(),
    providers: listProviders(),
    theme: getCurrentTheme(),
    user: { name: 'User', avatar: 'U' },
    agents: characters.map(c => ({
      id: c.agentId || c.name,
      name: c.name,
      color: c.color,
      provider: providerFor(c),
      status: c.session ? 'active' : 'idle',
      personality: '',
      role: ''
    }))
  };
});

// ── MCP Servers IPC ──
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

  // 1. Save to the JSON file
  setMcpServers(servers);
  console.log('[MCP] Updated server configs in settings file.');

  // 2. Reboot open AI sessions so they connect to the new servers immediately
  restartSessions();
});

// ── Vision / Overlay IPC ──
ipcMain.on('set-api-key', (event, key) => {
  if (!requireControlCentre(event, 'set-api-key')) return;
  setApiKey(key);
  // Recreate open sessions so they use the new key
  restartSessions(c => {
    if (c.chatWindow && !c.chatWindow.isDestroyed()) {
      c.chatWindow.webContents.send('api-key-changed');
    }
  });
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

// ── Per-provider API keys (Gemini / Claude / Codex / Copilot) ──
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
  characters.forEach(c => {
    if (!c.session || apiKeyProviderFor(providerFor(c)) !== provider) return;
    if (c.chatWindow && !c.chatWindow.isDestroyed()) {
      c.chatWindow.webContents.send('api-key-changed');
    }
    c.createSession();
  });
});

// ── Theme / Provider IPC (from CC Settings) ──
ipcMain.on('set-theme', (event, theme) => {
  setCurrentTheme(theme);
  characters.forEach(c => {
    if (c.chatWindow && !c.chatWindow.isDestroyed()) {
      c.chatWindow.webContents.send('theme-change', theme);
    }
  });
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('theme-change', theme);
  });
  rebuildTrayMenu();
});

ipcMain.on('set-provider', (event, providerKey) => {
  if (!requireControlCentre(event, 'set-provider')) return;
  if (!isKnownProvider(providerKey)) return;
  setCurrentProvider(resolveProviderKey(providerKey));
  // Only bots without a provider of their own follow the default
  characters.forEach(c => {
    if (c.provider || !c.session) return;
    if (c.chatWindow && !c.chatWindow.isDestroyed()) {
      c.chatWindow.webContents.send('provider-change', providerFor(c));
      c.chatWindow.webContents.send('chat-turn-complete');
    }
    c.createSession();
  });
  rebuildTrayMenu();
});

// ── Providers & custom (Ollama) models ──
ipcMain.handle('get-providers', () => listProviders());

// Tell every open chat (⚙ menu) and the tray that the provider list changed
function broadcastProvidersChanged() {
  const providers = listProviders();
  characters.forEach(c => {
    if (c.chatWindow && !c.chatWindow.isDestroyed()) c.chatWindow.webContents.send('providers-changed', providers);
  });
  rebuildTrayMenu();
}

// Models pulled into an Ollama server, for the "Add model" picker
ipcMain.handle('list-ollama-models', async (event, baseUrl) => {
  if (!requireControlCentre(event, 'list-ollama-models')) return { ok: false, error: 'Not allowed' };
  try {
    return { ok: true, models: await listOllamaModels(baseUrl) };
  } catch (err) {
    const unreachable = err.cause?.code === 'ECONNREFUSED' || err.name === 'TimeoutError' || /fetch failed/i.test(err.message);
    return { ok: false, error: unreachable ? 'Ollama isn\'t reachable at that address. Is it running? (ollama serve)' : err.message };
  }
});

ipcMain.handle('add-custom-model', (event, input) => {
  if (!requireControlCentre(event, 'add-custom-model')) return { ok: false, error: 'Not allowed' };
  try {
    const model = addCustomModel(input);
    broadcastProvidersChanged();
    return { ok: true, model };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('remove-custom-model', (event, id) => {
  if (!requireControlCentre(event, 'remove-custom-model')) return false;
  if (typeof id !== 'string' || !removeCustomModel(id)) return false;
  // Agents using it now get a clear "model removed" message in their chat
  characters.forEach(c => {
    if (c.session && providerFor(c) === `ollama:${id}`) c.createSession();
  });
  broadcastProvidersChanged();
  return true;
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
  characters.forEach(c => {
    if (c.session && typeof c.session.guardStatus === 'function') c.createSession();
  });
  return true;
});

ipcMain.handle('test-armoriq', async (event) => {
  if (!requireControlCentre(event, 'test-armoriq')) return null;
  const { testArmorIQConnection } = require('./sessions/armoriq-guard');
  return testArmorIQConnection();
});

// ── Settings → Security & About (read-only) ──
ipcMain.handle('get-security-overview', (event) => {
  if (!requireControlCentre(event, 'get-security-overview')) return null;
  const { loadArmorIQConfig } = require('./sessions/armoriq-guard');
  const { builtinTools } = require('./mcp-servers/builtin-tools');
  const fs = require('fs');
  const os = require('os');
  const policyPath = path.join(__dirname, 'armoriq.policy.json');
  let policy = { allow: [], deny: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
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
    policy: { ...policy, path: policyPath },
    approvalTools: builtinTools.filter(t => t.requiresApproval).map(t => t.name),
    tools: builtinTools.map(t => t.name),
    fileAccess: `Your home folder (${os.homedir()}), excluding hidden files/folders and key files`,
    secrets: secretStatus()
  };
});

ipcMain.handle('get-app-info', () => {
  const os = require('os');
  return {
    name: 'Desktop Assistant',
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: `${process.platform} ${process.arch}`,
    settingsFile: path.join(os.homedir(), '.desktop-assistant-settings.json'),
    policyFile: path.join(__dirname, 'armoriq.policy.json'),
    database: isDBConnected() ? 'Connected' : 'Not connected'
  };
});

ipcMain.on('set-eleven-labs-api-key', (event, key) => {
  if (!requireControlCentre(event, 'set-eleven-labs-api-key')) return;
  setElevenLabsApiKey(key);
});

ipcMain.handle('get-eleven-labs-api-key', () => {
  return getElevenLabsApiKey();
});

ipcMain.on('set-mongodb-uri', async (event, uri) => {
  if (!requireControlCentre(event, 'set-mongodb-uri')) return;
  setMongodbUri(uri);
  await connectDB(uri);
});

ipcMain.handle('get-mongodb-uri', (event) => {
  if (!requireControlCentre(event, 'get-mongodb-uri')) return '';
  return getMongodbUri();
});

ipcMain.on('fly-to-element', (event, element) => {
  // Only the overlay drives step guides; element is normalized (0–1) screen coordinates
  if (!overlayWindow || overlayWindow.isDestroyed() || event.sender !== overlayWindow.webContents) return;
  const nums = element && [element.x, element.y, element.width, element.height];
  if (!nums || !nums.every(n => typeof n === 'number' && Number.isFinite(n))) return;

  // Fly the agent whose answer produced this guide (it may have been deleted since)
  const char = characters.includes(stepGuideOwner) ? stepGuideOwner : characters[0];
  if (char) {
    char.flyTo(element.x + element.width / 2, element.y + element.height / 2);
  }
});

ipcMain.on('return-character', () => {
  characters.forEach(c => c.returnToTaskbar());
  stepGuideOwner = null;
});

ipcMain.on('hide-overlay', () => {
  hideOverlay();
});

ipcMain.on('update-step-panel', (event, data) => {
  if (!stepPanelWindow || stepPanelWindow.isDestroyed()) createStepPanelWindow();
  
  // Add screen bounds offset if primary display is not at 0,0 (multi-monitor)
  const primaryDisplay = screen.getPrimaryDisplay();
  const absX = primaryDisplay.bounds.x + Math.round(data.x);
  const absY = primaryDisplay.bounds.y + Math.round(data.y);

  stepPanelWindow.setBounds({ x: absX, y: absY, width: 280, height: 160 });
  stepPanelWindow.show();
  stepPanelWindow.webContents.send('update-step-panel-data', data);
});

ipcMain.on('hide-step-panel', () => {
  if (stepPanelWindow && !stepPanelWindow.isDestroyed()) stepPanelWindow.hide();
});

ipcMain.on('step-panel-action', (event, action) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('step-panel-action', action);
  }
});

let stepPanelWindow = null;

function createStepPanelWindow() {
  stepPanelWindow = new BrowserWindow({
    width: 280,
    height: 160,
    transparent: true,
    frame: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  stepPanelWindow.loadFile(path.join(__dirname, 'renderer', 'step-panel.html'));
  stepPanelWindow.on('closed', () => { stepPanelWindow = null; });
}

// ── Overlay Window ──
function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { x, y, width: sw, height: sh } = primaryDisplay.bounds;

  overlayWindow = new BrowserWindow({
    x: x,
    y: y,
    width: sw,
    height: sh,
    fullscreen: true,
    transparent: true,
    frame: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  overlayWindow.setIgnoreMouseEvents(true); // Fully click-through on all OSes

  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));

  // Send screen dimensions to overlay for accurate bounding box positioning
  overlayWindow.webContents.on('did-finish-load', () => {
    overlayWindow.webContents.send('screen-dimensions', { width: sw, height: sh });
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function showOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
  }
  overlayWindow.show();
  overlayWindow.setIgnoreMouseEvents(true);
}

function hideOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
  if (stepPanelWindow && !stepPanelWindow.isDestroyed()) stepPanelWindow.hide();
}

// ── Dashboard / MongoDB IPC ──
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

const AGENT_THEMES = ['Peach', 'Midnight', 'Cloud', 'Moss'];

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
      toolsEnabled: config.toolsEnabled !== false
    }).save();
    return true;
  } catch (err) {
    console.error('[DB] save-agent error:', err.message);
    return false;
  }
});

async function loadAllAgentsFromDB() {
  if (!isDBConnected()) return;
  try {
    const agents = await Agent.find().sort({ createdAt: 1 });
    console.log(`[DB] Found ${agents.length} agents in database.`);
    for (const agent of agents) {
      launchAgentInstance(agent);
    }
  } catch (err) {
    console.error('[DB] loadAllAgentsFromDB error:', err.message);
  }
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
    char.restoredHistory = latest.toObject().messages.map(({ role, text, isTool, timestamp }) => ({ role, text, isTool, timestamp }));
    console.log(`[DB] Restored ${char.restoredHistory.length} messages for agent "${char.name}"`);
  } catch (err) {
    console.error('[DB] Failed to restore conversation:', err.message);
  }
}

function launchAgentInstance(agentObj) {
  // Check if already launched
  const exists = characters.find(c => c.agentId === agentObj._id.toString());
  if (exists) return;

  const char = new Character({
    name: agentObj.name,
    color: agentObj.theme === 'Moss' ? '#8c9480' : 
           agentObj.theme === 'Peach' ? '#f28ca6' : 
           agentObj.theme === 'Cloud' ? '#0078d6' : '#ff6600',
    colorDark: agentObj.theme === 'Moss' ? '#666b5d' : 
               agentObj.theme === 'Peach' ? '#c86f87' : 
               agentObj.theme === 'Cloud' ? '#005bb5' : '#cc5200',
    startPosition: Math.random() * 0.8 + 0.1,
    yOffset: -3,
    initialPause: 500 + Math.random() * 2000,
    isOnboarding: false
  });
  
  char.agentId = agentObj._id.toString();
  char.systemPromptFile = agentObj.contextFile;

  char.createCharacterWindow();
  characters.push(char);
  
  // Set provider for this session
  // Since multiple agents can have different providers, we don't use global state here
  // The Character instance needs its own provider handle
  char.provider = agentObj.provider ? resolveProviderKey(agentObj.provider) : null;
  char.theme = agentObj.theme;
  char.toolsEnabled = agentObj.toolsEnabled !== false;
  // Restore the agent's most recent conversation so it picks up where it left off
  char.historyLoaded = loadLatestConversation(char);
  
  rebuildTrayMenu();
}

ipcMain.on('launch-agent', async (event, agentObj) => {
  if (!requireControlCentre(event, 'launch-agent')) return;
  launchAgentInstance(agentObj);
});

ipcMain.handle('get-history', async () => {
  if (!isDBConnected()) return [];
  try {
    const sessions = await ChatSession.find().populate('agentId').sort({ updatedAt: -1 }).limit(50);
    return sessions.map(s => {
      const obj = s.toObject();
      obj._id = obj._id.toString();
      if (obj.agentId && obj.agentId._id) {
        obj.agentId._id = obj.agentId._id.toString();
      }
      return obj;
    });
  } catch (err) {
    console.error('[DB] get-history error:', err.message);
    return [];
  }
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

// ── Task Management IPC ──
ipcMain.handle('get-tasks', async () => {
  if (!isDBConnected()) return [];
  try {
    const tasks = await Task.find().populate('agentId').sort({ createdAt: -1 });
    return tasks.map(t => {
      const obj = t.toObject();
      obj._id = obj._id.toString();
      if (obj.agentId && obj.agentId._id) {
        obj.agentId._id = obj.agentId._id.toString();
      }
      return obj;
    });
  } catch (err) {
    console.error('[DB] get-tasks error:', err.message);
    return [];
  }
});

ipcMain.handle('save-task', async (event, taskData) => {
  if (!isDBConnected()) return false;
  try {
    if (taskData._id) {
      await Task.findByIdAndUpdate(taskData._id, taskData);
    } else {
      await Task.create(taskData);
    }
    return true;
  } catch (err) {
    console.error('[DB] save-task error:', err.message);
    return false;
  }
});

ipcMain.handle('delete-task', async (event, id) => {
  if (!isDBConnected()) return false;
  try {
    await Task.findByIdAndDelete(id);
    return true;
  } catch (err) {
    console.error('[DB] delete-task error:', err.message);
    return false;
  }
});

// ── Specific Chat History IPC ──
ipcMain.handle('get-chat-messages', async (event, sessionId) => {
  if (!isDBConnected()) return [];
  try {
    const session = await ChatSession.findById(sessionId);
    return session ? session.toObject().messages : [];
  } catch (err) {
    console.error('[DB] get-chat-messages error:', err.message);
    return [];
  }
});

// Delete a saved conversation (Control Centre → Chat). If an agent is currently using
// it, that agent forgets it and starts a new conversation.
ipcMain.handle('delete-chat-session', async (event, sessionId) => {
  if (!requireControlCentre(event, 'delete-chat-session')) return false;
  if (!isDBConnected() || typeof sessionId !== 'string') return false;
  try {
    await ChatSession.findByIdAndDelete(sessionId);
    characters
      .filter(c => c.sessionId && c.sessionId.toString() === sessionId)
      .forEach(c => {
        c.restoredHistory = null;
        if (c.session) {
          c.createSession({ fresh: true });
        } else {
          c.sessionId = null;
          c._conversationEpoch = (c._conversationEpoch || 0) + 1;
        }
        if (c.chatWindow && !c.chatWindow.isDestroyed()) {
          c.chatWindow.webContents.send('chat-cleared');
        }
      });
    return true;
  } catch (err) {
    console.error('[DB] delete-chat-session error:', err.message);
    return false;
  }
});

// ── Agent Management IPC ──
ipcMain.handle('delete-agent', async (event, id) => {
  if (!requireControlCentre(event, 'delete-agent')) return false;
  if (!isDBConnected()) return false;
  try {
    // 1. Find and destroy active character instance if running
    const charIndex = characters.findIndex(c => c.agentId === id.toString());
    if (charIndex !== -1) {
      const char = characters[charIndex];
      char.destroy();
      characters.splice(charIndex, 1);
      rebuildTrayMenu();
    }

    // 2. Delete from Database, with the agent's data: its conversations go too,
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

module.exports = { launchAgentInstance, openControlCentre, trayMenuTemplate };
