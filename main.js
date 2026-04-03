const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, clipboard, dialog } = require('electron');

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
  app.commandLine.appendSwitch('disable-gpu');
  app.disableHardwareAcceleration();
}

const path = require('path');
const { getTaskbarGeometry, getCharacterY } = require('./utils/taskbar');
const { isSoundsEnabled, toggleSounds } = require('./utils/sounds');
const { getCurrentProvider, setCurrentProvider, getProviderInfo, getAllProviders, getCurrentTheme, setCurrentTheme, getApiKey, setApiKey, getToolsEnabled, setToolsEnabled } = require('./sessions/agent-session');
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
const screenCapture = new ScreenCapture({ maxBuffer: 3 });

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
      this.chatWindow.webContents.send('theme-change', getCurrentTheme());
      this.chatWindow.webContents.send('provider-change', getCurrentProvider());

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
    const providerKey = getCurrentProvider();
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

    const theme = BUBBLE_THEMES[getCurrentTheme()] || BUBBLE_THEMES['Midnight'];
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
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  App Lifecycle
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.whenReady().then(() => {
  // Create characters
  const char1 = new Character({
    name: 'Buddy',
    color: '#66b88d',
    colorDark: '#4a9b72',
    startPosition: 0.3,
    yOffset: -3,
    initialPause: 500 + Math.random() * 1500,
    isOnboarding: true
  });

  const char2 = new Character({
    name: 'Spark',
    color: '#ff6600',
    colorDark: '#cc5200',
    startPosition: 0.7,
    yOffset: -3,
    initialPause: 8000 + Math.random() * 6000,
    isOnboarding: false
  });

  char1.createCharacterWindow();
  char2.createCharacterWindow();
  characters = [char1, char2];

  // Start screen capture service
  screenCapture.start();

  setupTray();
  startUpdateLoop();
  createOverlayWindow();

  // Onboarding — show welcome bubble after a delay
  setTimeout(() => {
    char1.showBubble('hi! 👋', true);
    setTimeout(() => char1.hideBubble(), 5000);
  }, 2000);
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
    {
      label: characters[0]?.name || 'Buddy',
      type: 'checkbox',
      checked: characters[0]?.manuallyVisible ?? true,
      click: () => {
        if (characters[0]) {
          characters[0].setManuallyVisible(!characters[0].manuallyVisible);
          rebuildTrayMenu();
        }
      }
    },
    {
      label: characters[1]?.name || 'Spark',
      type: 'checkbox',
      checked: characters[1]?.manuallyVisible ?? true,
      click: () => {
        if (characters[1]) {
          characters[1].setManuallyVisible(!characters[1].manuallyVisible);
          rebuildTrayMenu();
        }
      }
    },
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
      label: 'Set API Key...',
      click: () => {
        promptForApiKey();
      }
    },
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
    theme: getCurrentTheme()
  };
});

ipcMain.on('request-position', (event) => {
  // Initial position will be set by update loop
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
