const { BrowserWindow } = require('electron');
const path = require('path');
const state = require('./state');
const { rendererFile, webPreferences } = require('./paths');
const { providerFor } = require('./provider-choice');
const { approveToolCall, emitSecurityEventToUI } = require('./security');
const { Orchestrator } = require('./orchestrator');
const { getTaskbarGeometry } = require('../utils/taskbar');
const { getCurrentTheme, getApiKey } = require('../sessions/agent-session');
const { listProviders, createSession: createProviderSession } = require('../sessions/providers');
const { buildOrchestratorInstructions } = require('../sessions/orchestration');
const teamMemory = require('../sessions/team-memory');
const { isDBConnected, ChatSession } = require('../utils/db');

/**
 * A bot on the taskbar: its walking character window, speech bubble, chat window and
 * AI session (with memory, persona, provider and desktop-tools setting).
 */

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

    // Database linkage
    this.agentId = null;
    this.sessionId = null;            // ChatSession document the conversation is saved to
    this.systemPromptFile = null;
    this.toolsEnabled = true;         // per-agent: desktop tools for Gemini Vision
    this.orchestrator = true;         // per-agent: may hand sub-tasks to sub-agents
    this.teamMemoryText = '';         // team memory as prompt text (see refreshTeamMemory)
    this.orchestration = new Orchestrator(this);
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
      webPreferences: webPreferences()
    });

    this.charWindow.setIgnoreMouseEvents(false);
    this.charWindow.loadFile(rendererFile('character.html'));

    this.charWindow.webContents.on('did-finish-load', () => {
      this._lastPose = null; // a (re)loaded page needs the current pose
      this.charWindow.webContents.send('character-config', {
        color: this.color,
        colorDark: this.colorDark,
        name: this.name
      });
    });

    // Prevent closing (unless intentionally destroying or quitting)
    this.charWindow.on('close', (e) => {
      if (!this._destroying && !state.isQuitting) {
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
      webPreferences: webPreferences()
    });

    this.chatWindow.loadFile(rendererFile('chat.html'));

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
      toolsEnabled: this.toolsEnabled !== false
    });

    // Persona/context file (+ orchestration instructions): set before start so CLI
    // providers get it at launch
    this.session.systemPrompt = this.buildSystemPrompt(providerKey);

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
    this.session.on('security:plan-extended', (data) => emitSecurityEventToUI('plan-extended', data, this));

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

      // Did the reply hand work to sub-agents (or save team memory)?
      this.orchestration.handleTurn().catch(err => console.error('[Orchestrator]', err));
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

  providerKey() {
    return providerFor(this);
  }

  /** Persona/context file, plus how to delegate (with team memory) for orchestrators. */
  buildSystemPrompt(providerKey = providerFor(this)) {
    const persona = this.loadSystemPrompt();
    if (this.orchestrator === false) return persona;
    const orchestration = buildOrchestratorInstructions({
      providers: listProviders(),
      memory: this.teamMemoryText,
      selfProvider: providerKey
    });
    return [persona, orchestration].filter(Boolean).join('\n\n');
  }

  /**
   * Reload team memory into the prompt. Providers that read the prompt per message
   * (Gemini, Ollama, Codex) see new notes on the next message; Claude gets them in the
   * sub-agent results message.
   */
  async refreshTeamMemory() {
    this.teamMemoryText = await teamMemory.getMemoryText(this.agentId);
    if (this.session) this.session.systemPrompt = this.buildSystemPrompt();
  }

  /** Orchestrator on/off for this agent (Agents page). Applies to the next message. */
  setOrchestrator(enabled) {
    this.orchestrator = !!enabled;
    if (this.session) this.session.systemPrompt = this.buildSystemPrompt();
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
      webPreferences: webPreferences()
    });

    this.bubbleWindow.setIgnoreMouseEvents(true);
    this.bubbleWindow.loadFile(rendererFile('bubble.html'));
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
    const payload = { text, isCompletion, theme };
    const win = this.bubbleWindow;
    // A just-created bubble is still loading; a message sent now would be lost
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', () => { if (!win.isDestroyed()) win.webContents.send('bubble-show', payload); });
    } else {
      win.webContents.send('bubble-show', payload);
    }
    clearTimeout(this.bubbleReleaseTimer);
  }

  hideBubble() {
    if (this.bubbleWindow && !this.bubbleWindow.isDestroyed()) {
      this.bubbleWindow.webContents.send('bubble-hide');
      this.bubbleWindow.hide();
      // Free the bubble's renderer process once the bot has been quiet for a while
      // (it's recreated on the next reply); kept briefly so "thinking…" phrases are cheap
      clearTimeout(this.bubbleReleaseTimer);
      this.bubbleReleaseTimer = setTimeout(() => {
        if (this.bubbleWindow && !this.bubbleWindow.isDestroyed() && !this.bubbleWindow.isVisible()) {
          this.bubbleWindow.destroy();
          this.bubbleWindow = null;
        }
      }, 30000);
      this.bubbleReleaseTimer.unref?.(); // never keeps the app alive on its own
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

  // ── Walk Logic ──
  update(walkZone) {
    const now = Date.now();

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

    // Update window position. Bots stand still most of the time, so only touch the
    // window (an OS call + IPC per bot, 30×/s) when something actually changed.
    if (this.charWindow && !this.charWindow.isDestroyed()) {
      const x = Math.round(walkZone.x + walkZone.width * this.positionProgress - 32);
      const y = Math.round(walkZone.y - 80 + this.yOffset);
      const moved = !this._lastPos || this._lastPos.x !== x || this._lastPos.y !== y;

      if (moved) {
        this._lastPos = { x, y };
        this.charWindow.setBounds({ x, y, width: 64, height: 80 });
        if (this.bubbleWindow && !this.bubbleWindow.isDestroyed() && this.bubbleWindow.isVisible()) {
          this.bubbleWindow.setBounds({ x: x + 32 - 80, y: y - 55, width: 160, height: 50 });
        }
      }

      const pose = `${this.isWalking}:${this.direction}`;
      if (pose !== this._lastPose) {
        this._lastPose = pose;
        this.charWindow.webContents.send('position-update', {
          walking: this.isWalking,
          direction: this.direction > 0 ? 'right' : 'left'
        });
      }
    }
  }

  /** Send to this bot's chat window, if it's open. */
  sendToChat(channel, ...args) {
    if (this.chatWindow && !this.chatWindow.isDestroyed()) {
      this.chatWindow.webContents.send(channel, ...args);
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
    this.orchestration.cancel();
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
    clearTimeout(this.bubbleReleaseTimer);
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
        internal: !!msg.internal,
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

/** Move every visible bot along the taskbar (~30 fps is plenty for walking). */
function startWalkLoop() {
  return setInterval(() => {
    const { walkZone } = getTaskbarGeometry();
    state.characters.forEach(char => {
      if (char.manuallyVisible && char.charWindow && !char.charWindow.isDestroyed()) {
        char.update(walkZone);
      }
    });
  }, 33);
}

module.exports = { Character, startWalkLoop };
