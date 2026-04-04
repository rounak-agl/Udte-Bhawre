const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, clipboard, dialog } = require('electron');

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
  app.commandLine.appendSwitch('disable-gpu');
  app.disableHardwareAcceleration();
}

const path = require('path');
const { runBootstrap } = require('./sessions/bootstrap');

// Run bootstrap before any agent classes or windows are initialized
runBootstrap();

const { getTaskbarGeometry, getCharacterY } = require('./utils/taskbar');
const { isSoundsEnabled, toggleSounds } = require('./utils/sounds');
const { getCurrentProvider, setCurrentProvider, getProviderInfo, getAllProviders, getCurrentTheme, setCurrentTheme, getApiKey, setApiKey, getElevenLabsApiKey, setElevenLabsApiKey, getMongodbUri, setMongodbUri, getToolsEnabled, setToolsEnabled, getMcpServers, setMcpServers } = require('./sessions/agent-session');
const { connectDB, isDBConnected, Agent, ChatSession, Task } = require('./utils/db');
const ClaudeSession = require('./sessions/claude-session');
const CodexSession = require('./sessions/codex-session');
const CopilotSession = require('./sessions/copilot-session');
const GeminiSession = require('./sessions/gemini-session');
const VisionSession = require('./sessions/vision-session');
const ScreenCapture = require('./utils/screen-capture');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  State
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let tray = null;
let characters = [];
let onboardingDone = false;
let overlayWindow = null;
let dashboardWindow = null;
const screenCapture = new ScreenCapture({ maxBuffer: 3 });

let pendingEvents = [];
let rendererReady = false;

function emitSecurityEventToUI(type, data, charWindowOrMain) {
  const event = { type, data, ts: Date.now() };
  if (rendererReady && charWindowOrMain && !charWindowOrMain.isDestroyed()) {
    charWindowOrMain.webContents.send('security-audit-event', event);
  } else {
    pendingEvents.push(event);
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
    this.sessionId = null;
    this.systemPromptFile = null;


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

    // Prevent closing (unless intentionally destroying)
    this.charWindow.on('close', (e) => {
      if (!this._destroying) {
        e.preventDefault();
        this.charWindow.hide();
      }
    });
  }

  createChatWindow() {
    if (this.chatWindow && !this.chatWindow.isDestroyed()) {
      this.chatWindow.show();
      this.chatWindow.focus();
      return;
    }

    const taskbar = getTaskbarGeometry();
    const charBounds = this.charWindow.getBounds();

    // Position the chat window above the character
    let chatX = charBounds.x - 150;
    let chatY = charBounds.y - 420;

    // Keep within screen
    chatX = Math.max(10, Math.min(chatX, taskbar.screenW - 370));
    chatY = Math.max(10, chatY);

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
      this.chatWindow.webContents.send('theme-change', this.theme || getCurrentTheme());
      this.chatWindow.webContents.send('provider-change', this.provider || getCurrentProvider());

      // Replay history if session exists
      if (this.session && this.session.history.length > 0) {
        this.chatWindow.webContents.send('chat-history', this.session.history);
      }
    });

    this.chatWindow.on('closed', () => {
      this.chatWindow = null;
    });

    // Start or reuse session
    if (!this.session) {
      this.createSession();
    }
  }

  createSession() {
    const providerKey = this.provider || getCurrentProvider();
    if (this.session) {
      this.session.terminate();
      this.session.removeAllListeners();
    }

    switch (providerKey) {
      case 'vision': this.session = new VisionSession(screenCapture); break;
      case 'claude': this.session = new ClaudeSession(); break;
      case 'codex': this.session = new CodexSession(); break;
      case 'copilot': this.session = new CopilotSession(); break;
      case 'gemini': this.session = new GeminiSession(); break;
      default: this.session = new VisionSession(screenCapture); break;
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
      this.hideBubble();
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
    this.session.on('security:intent-sealed', (data) => emitSecurityEventToUI('intent-sealed', data, this.chatWindow));
    this.session.on('security:intent-failed', (data) => emitSecurityEventToUI('intent-failed', data, this.chatWindow));
    this.session.on('security:tool-allowed', (data) => emitSecurityEventToUI('tool-allowed', data, this.chatWindow));
    this.session.on('security:enforcement-block', (data) => emitSecurityEventToUI('enforcement-block', data, this.chatWindow));

    this.session.on('sessionReady', () => {
      if (this.chatWindow && !this.chatWindow.isDestroyed()) {
        this.chatWindow.webContents.send('chat-session-ready');
      }
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
        showOverlay();
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.webContents.send('show-step-guide', steps);
        }
      }
    });

    // Start session (vision needs API key)
    if (providerKey === 'vision') {
      const apiKey = getApiKey();
      // Set the tool approval function before starting
      this.session.setApprovalFunction(async (message) => {
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
      });
      this.session.start(apiKey);
    } else {
      this.session.start();
    }

   // Push system prompt if one is loaded
    if (this.systemPromptFile) {
      try {
        const fs = require('fs');
        const contextData = fs.readFileSync(this.systemPromptFile, 'utf-8');
        if (contextData) {
          // Send a hidden system injected prompt or just feed it as part of history.
          // Since there is no explicit setSystemPrompt on generic sessions yet,
          // we can simulate setting context inside the session history conceptually
          // Though typically you'd need the provider to support it natively.
          console.log('[System Prompt Loaded from]', this.systemPromptFile);
        }
      } catch (err) {
        console.error('Failed to load system prompt:', err);
      }
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

    const display = screen.getPrimaryDisplay();
    const { width: sw, height: sh } = display.workAreaSize;
    const bounds = this.charWindow.getBounds();

    // Save current position for return
    this.savedTaskbarPos = { x: bounds.x, y: bounds.y };

    // Target position (offset to be beside the element, not on top)
    const targetX = Math.round(normX * sw + (normX > 0.5 ? -80 : 40));
    const targetY = Math.round(normY * sh - 40);

    this.flyStartPos = { x: bounds.x, y: bounds.y };
    this.flyTargetPos = { x: targetX, y: targetY };
    this.flyStartTime = Date.now();
    this.flyDuration = 500;
    this.isFlying = true;
    this.isWalking = false;
    this.isPaused = true;
  }

  returnToTaskbar() {
    if (!this.savedTaskbarPos) {
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

  async saveSessionHistory() {
    try {
      if (!this.agentId) return;
      if (!isDBConnected()) {
        console.log('[DB] Not connected — skipping history save.');
        return;
      }
      const { ChatSession } = require('./utils/db');
      
      // Build messages array with safe text fallback
      const messages = this.session.history.map(msg => ({
        role: msg.role || 'system',
        text: msg.text || `[${msg.role}]`,
        isTool: msg.isTool || msg.role === 'toolUse' || msg.role === 'toolResult' || false,
        timestamp: msg.timestamp || new Date()
      }));

      if (!this.sessionId) {
        // Create new session
        const newSession = new ChatSession({
          agentId: this.agentId,
          title: this.session.history.filter(m => m.role === 'user').pop()?.text?.substring(0, 30) || 'New Conversation',
          messages
        });
        const saved = await newSession.save();
        this.sessionId = saved._id;
      } else {
        // Update existing
        await ChatSession.findByIdAndUpdate(this.sessionId, {
          messages,
          updatedAt: new Date()
        });
      }
      if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('history-updated');
      }
    } catch(e) {
      console.error('[DB] Failed to save history:', e.message);
    }
  }
}

const { initControlCentre, openControlCentre } = require('./main-cc');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  App Lifecycle
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.whenReady().then(async () => {
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
  initControlCentre({ characters });

  setupTray();
  startUpdateLoop();
  createOverlayWindow();
});

app.on('window-all-closed', () => {
  // Don't quit when windows close — we're a tray app
});

app.on('before-quit', () => {
  // Stop screen capture and clear ALL screenshots
  screenCapture.stop();
  characters.forEach(c => c.destroy());
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  System Tray
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function setupTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Desktop Assistant');

  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  const allProviders = getAllProviders();
  const currentProviderKey = getCurrentProvider();
  const currentThemeName = getCurrentTheme();
  const themes = ['Peach', 'Midnight', 'Cloud', 'Moss'];

  const template = [
    ...characters.map((char, index) => ({
      label: char.name || `Agent ${index + 1}`,
      type: 'checkbox',
      checked: char.manuallyVisible ?? true,
      click: () => {
        char.setManuallyVisible(!char.manuallyVisible);
        rebuildTrayMenu();
      }
    })),
    { type: 'separator' },
    {
      label: 'Sounds',
      type: 'checkbox',
      checked: isSoundsEnabled(),
      click: () => { toggleSounds(); rebuildTrayMenu(); }
    },
    {
      label: 'Enable Tools',
      type: 'checkbox',
      checked: getToolsEnabled(),
      click: () => {
        setToolsEnabled(!getToolsEnabled());
        // Recreate sessions with tools toggled
        characters.forEach(c => {
          if (c.session) {
            c.session.terminate();
            c.session.removeAllListeners();
            c.session = null;
          }
          c.createSession();
        });
        rebuildTrayMenu();
      }
    },
    {
      label: 'Provider',
      submenu: allProviders.map(p => ({
        label: p.name,
        type: 'radio',
        checked: p.key === currentProviderKey,
        click: () => {
          setCurrentProvider(p.key);
          // Terminate existing sessions and recreate with new provider
          characters.forEach(c => {
            if (c.session) {
              c.session.terminate();
              c.session.removeAllListeners();
              c.session = null;
            }
            if (c.chatWindow && !c.chatWindow.isDestroyed()) {
              c.chatWindow.webContents.send('provider-change', p.key);
              // Clear any stale typing indicators
              c.chatWindow.webContents.send('chat-turn-complete');
            }
            // Immediately recreate session with new provider
            c.createSession();
          });
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
        const settingsWin = new BrowserWindow({
          width: 560,
          height: 700,
          title: 'MCP Integrations',
          autoHideMenuBar: true,
          backgroundColor: '#0d0d12',
          webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
          }
        });
        settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
      }
    },
    {
      label: 'Set ElevenLabs API Key...',
      click: () => {
        promptForElevenLabsApiKey();
      }
    },
    {
      label: 'Set ElevenLabs Key...',
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
      label: 'Set API Key...',
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

  const menu = Menu.buildFromTemplate(template);
  tray.setContextMenu(menu);
}

function promptForApiKey() {
  // Simple input dialog using a tiny BrowserWindow
  const inputWin = new BrowserWindow({
    width: 450,
    height: 180,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    title: 'Set Gemini API Key',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  const currentKey = getApiKey();
  const maskedKey = currentKey ? currentKey.substring(0, 8) + '...' : '';

  const htmlContent = `
    <html><body style="font-family:Segoe UI,sans-serif;padding:20px;background:#1a1a2e;color:#fff">
    <h3 style="margin:0 0 10px">Gemini API Key</h3>
    <p style="font-size:12px;color:#aaa;margin:0 0 10px">Get one free at <a href="https://aistudio.google.com/apikey" style="color:#00d4aa">aistudio.google.com</a></p>
    <input id="key" type="text" placeholder="${maskedKey || 'Paste your API key here'}" 
      style="width:100%;padding:8px 12px;border:1px solid #333;border-radius:8px;background:#111;color:#fff;font-size:14px;outline:none" autofocus>
    <div style="margin-top:12px;text-align:right">
      <button onclick="window.close()" style="padding:6px 16px;border:1px solid #444;border-radius:6px;background:transparent;color:#aaa;cursor:pointer;margin-right:8px">Cancel</button>
      <button onclick="save()" style="padding:6px 16px;border:none;border-radius:6px;background:#00d4aa;color:#000;font-weight:600;cursor:pointer">Save</button>
    </div>
    <script>
      function save() {
        const key = document.getElementById('key').value.trim();
        if (key) {
          document.title = 'APIKEY:' + key;
          // Don't close immediately — let the title change event fire first.
          // The main process will close this window after processing the key.
        } else {
          window.close();
        }
      }
      document.getElementById('key').addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    </script>
    </body></html>
  `;
  inputWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));

  inputWin.on('page-title-updated', (e, title) => {
    if (title.startsWith('APIKEY:')) {
      const key = title.substring(7);
      setApiKey(key);
      console.log('[API Key] Updated. Recreating all sessions with new key.');

      // Terminate old sessions and immediately recreate with the new key
      characters.forEach(c => {
        if (c.session) {
          c.session.terminate();
          c.session.removeAllListeners();
          c.session = null;
        }
        if (c.chatWindow && !c.chatWindow.isDestroyed()) {
          c.chatWindow.webContents.send('api-key-changed');
        }
        // Immediately recreate the session so the new key is active
        c.createSession();
      });

      // Close the input dialog from the main process (safe — title event already fired)
      if (!inputWin.isDestroyed()) {
        inputWin.destroy();
      }
    }
  });
}

function promptForElevenLabsApiKey() {
  const inputWin = new BrowserWindow({
    width: 450,
    height: 180,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    title: 'Set ElevenLabs API Key',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  const currentKey = getElevenLabsApiKey();
  const maskedKey = currentKey ? currentKey.substring(0, 8) + '...' : '';

  const htmlContent = `
    <html><body style="font-family:Segoe UI,sans-serif;padding:20px;background:#1a1a2e;color:#fff">
    <h3 style="margin:0 0 10px">ElevenLabs API Key</h3>
    <p style="font-size:12px;color:#aaa;margin:0 0 10px">Get one at <a href="https://elevenlabs.io" style="color:#00d4aa">elevenlabs.io</a></p>
    <input id="key" type="text" placeholder="\${maskedKey || 'Paste your ElevenLabs API key here'}" 
      style="width:100%;padding:8px 12px;border:1px solid #333;border-radius:8px;background:#111;color:#fff;font-size:14px;outline:none" autofocus>
    <div style="margin-top:12px;text-align:right">
      <button onclick="window.close()" style="padding:6px 16px;border:1px solid #444;border-radius:6px;background:transparent;color:#aaa;cursor:pointer;margin-right:8px">Cancel</button>
      <button onclick="save()" style="padding:6px 16px;border:none;border-radius:6px;background:#00d4aa;color:#000;font-weight:600;cursor:pointer">Save</button>
    </div>
    <script>
      function save() {
        const key = document.getElementById('key').value.trim();
        if (key) {
          document.title = 'ELEVENLABS_APIKEY:' + key;
        } else {
          window.close();
        }
      }
      document.getElementById('key').addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    </script>
    </body></html>
  `;
  inputWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));

  inputWin.on('page-title-updated', (e, title) => {
    if (title.startsWith('ELEVENLABS_APIKEY:')) {
      const key = title.substring(18);
      setElevenLabsApiKey(key);
      console.log('[ElevenLabs API Key] Updated.');
      if (!inputWin.isDestroyed()) {
        inputWin.destroy();
      }
    }
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
    clickedChar.createChatWindow();
  }
});

ipcMain.on('renderer-ready', (event) => {
  rendererReady = true;
  const webContents = event.sender;
  pendingEvents.forEach(e => webContents.send('security-audit-event', e));
  pendingEvents = [];
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

ipcMain.on('slash-command', (event, cmd) => {
  const char = characters.find(c =>
    c.chatWindow && !c.chatWindow.isDestroyed() && c.chatWindow.webContents === event.sender
  );
  if (char && cmd === 'clear') {
    if (char.session) {
      char.session.history = [];
    }
  }
});

ipcMain.on('copy-last-response', (event) => {
  const char = characters.find(c =>
    c.chatWindow && !c.chatWindow.isDestroyed() && c.chatWindow.webContents === event.sender
  );
  if (char && char.session) {
    const lastAssistant = [...char.session.history].reverse().find(m => m.role === 'assistant');
    if (lastAssistant) {
      clipboard.writeText(lastAssistant.text);
    }
  }
});

ipcMain.handle('get-initial-state', () => {
  return {
    provider: getCurrentProvider(),
    theme: getCurrentTheme(),
    user: { name: 'User', avatar: 'U' },
    agents: characters.map(c => ({
      id: c.agentId || c.name,
      name: c.name,
      color: c.color,
      provider: c.provider || getCurrentProvider(),
      status: c.session ? 'active' : 'idle',
      personality: '',
      role: ''
    }))
  };
});

ipcMain.on('request-position', (event) => {
  // Initial position will be set by update loop
});

// ── MCP Servers IPC ──
ipcMain.handle('get-mcp-servers', () => {
  return getMcpServers();
});

ipcMain.on('set-mcp-servers', (event, servers) => {
  // 1. Save to the JSON file
  setMcpServers(servers);
  console.log('[MCP] Updated server configs in settings file.');

  // 2. Reboot the AI sessions so it connects to the new servers immediately
  characters.forEach(c => {
    if (c.session) {
      c.session.terminate();
      c.session.removeAllListeners();
      c.session = null;
    }
    // Recreate session with new tools
    c.createSession();
  });
});

// ── Vision / Overlay IPC ──
ipcMain.on('set-api-key', (event, key) => {
  setApiKey(key);
  // Recreate sessions so they use the new key
  characters.forEach(c => {
    if (c.session) {
      c.session.terminate();
      c.session.removeAllListeners();
      c.session = null;
    }
    if (c.chatWindow && !c.chatWindow.isDestroyed()) {
      c.chatWindow.webContents.send('api-key-changed');
    }
    c.createSession();
  });
});

ipcMain.handle('get-api-key', () => {
  return getApiKey();
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
  setCurrentProvider(providerKey);
  characters.forEach(c => {
    if (c.session) {
      c.session.terminate();
      c.session.removeAllListeners();
      c.session = null;
    }
    if (c.chatWindow && !c.chatWindow.isDestroyed()) {
      c.chatWindow.webContents.send('provider-change', providerKey);
      c.chatWindow.webContents.send('chat-turn-complete');
    }
    c.createSession();
  });
  rebuildTrayMenu();
});

ipcMain.on('set-eleven-labs-api-key', (event, key) => {
  setElevenLabsApiKey(key);
});

ipcMain.handle('get-eleven-labs-api-key', () => {
  return getElevenLabsApiKey();
});

ipcMain.on('set-mongodb-uri', (event, uri) => {
  setMongodbUri(uri);
});

ipcMain.handle('get-mongodb-uri', () => {
  return getMongodbUri();
});

ipcMain.on('fly-to-element', (event, element) => {
  // Fly the first character to the element position
  const char = characters[0];
  if (char) {
    char.flyTo(element.x + element.width / 2, element.y + element.height / 2);
  }
});

ipcMain.on('return-character', () => {
  characters.forEach(c => c.returnToTaskbar());
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Dashboard
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function createDashboardWindow() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show();
    return;
  }
  
  dashboardWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    title: 'Nexus Dashboard',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  
  dashboardWindow.loadFile(path.join(__dirname, 'renderer', 'dashboard.html'));
  
  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
  });
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

ipcMain.handle('save-agent', async (event, config) => {
  if (!isDBConnected()) return false;
  try {
    const newAgent = new Agent(config);
    await newAgent.save();
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
  char.provider = agentObj.provider;
  char.theme = agentObj.theme;
  
  rebuildTrayMenu();
}

ipcMain.on('launch-agent', async (event, agentObj) => {
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

ipcMain.handle('choose-context-file', async () => {
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

// ── Agent Management IPC ──
ipcMain.handle('delete-agent', async (event, id) => {
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

    // 2. Delete from Database
    await Agent.findByIdAndDelete(id);
    return true;
  } catch (err) {
    console.error('[DB] delete-agent error:', err.message);
    return false;
  }
});



function promptForApiKeyInput(titleText, linkText, prefix, onSave) {
  const inputWin = new BrowserWindow({
    width: 450,
    height: 180,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    title: `Set ${titleText}`,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  const htmlContent = `
    <html><body style="font-family:Segoe UI,sans-serif;padding:20px;background:#1a1a2e;color:#fff">
    <h3 style="margin:0 0 10px">${titleText}</h3>
    <p style="font-size:12px;color:#aaa;margin:0 0 10px">Get one at <a href="https://${linkText}" style="color:#00d4aa">${linkText}</a></p>
    <input id="key" type="text" placeholder="Paste your ${titleText} here" 
      style="width:100%;padding:8px 12px;border:1px solid #333;border-radius:8px;background:#111;color:#fff;font-size:14px;outline:none" autofocus>
    <div style="margin-top:12px;text-align:right">
      <button onclick="window.close()" style="padding:6px 16px;border:1px solid #444;border-radius:6px;background:transparent;color:#aaa;cursor:pointer;margin-right:8px">Cancel</button>
      <button onclick="save()" style="padding:6px 16px;border:none;border-radius:6px;background:#00d4aa;color:#000;font-weight:600;cursor:pointer">Save</button>
    </div>
    <script>
      function save() {
        const key = document.getElementById('key').value.trim();
        if (key) {
          document.title = '${prefix}' + key;
        } else {
          window.close();
        }
      }
      document.getElementById('key').addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    </script>
    </body></html>
  `;
  inputWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));

  inputWin.on('page-title-updated', (e, title) => {
    if (title.startsWith(prefix)) {
      const key = title.substring(prefix.length);
      onSave(key);
      console.log(`[${titleText}] Updated.`);
      if (!inputWin.isDestroyed()) {
        inputWin.destroy();
      }
    }
  });
}


module.exports = { 
  launchAgentInstance, 
  openControlCentre,
  createSessionForAgent: (agentObj) => {
    // Shared utility for background/CC chat (though currently read-only)
    const providerKey = agentObj.provider || getCurrentProvider();
    switch (providerKey) {
      case 'vision': return new VisionSession(screenCapture);
      case 'claude': return new ClaudeSession();
      case 'codex': return new CodexSession();
      case 'copilot': return new CopilotSession();
      case 'gemini': return new GeminiSession();
      default: return new VisionSession(screenCapture);
    }
  }
};
