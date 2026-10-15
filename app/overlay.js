const { BrowserWindow, ipcMain, screen } = require('electron');
const state = require('./state');
const { rendererFile, webPreferences } = require('./paths');

/**
 * Step-guide overlay (click-through, full-screen bounding boxes) and the floating
 * step panel next to the active box. A Gemini Vision answer with bounding boxes opens
 * the overlay; the bot that answered flies to each highlighted element.
 */
let overlayWindow = null;
let stepPanelWindow = null;
let stepGuideOwner = null; // the Character whose session produced the active step guide

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
    webPreferences: webPreferences()
  });

  overlayWindow.setIgnoreMouseEvents(true); // Fully click-through on all OSes

  overlayWindow.loadFile(rendererFile('overlay.html'));

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

function destroyOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
}

/** Show a step guide for `char`'s answer (fly-to-element moves this bot). */
function showStepGuide(char, steps) {
  if (!steps.length) return;
  stepGuideOwner = char;
  showOverlay();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('show-step-guide', steps);
  }
}

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
    webPreferences: webPreferences()
  });
  stepPanelWindow.loadFile(rendererFile('step-panel.html'));
  stepPanelWindow.on('closed', () => { stepPanelWindow = null; });
}

function registerOverlayIpc() {
  ipcMain.on('fly-to-element', (event, element) => {
    // Only the overlay drives step guides; element is normalized (0–1) screen coordinates
    if (!overlayWindow || overlayWindow.isDestroyed() || event.sender !== overlayWindow.webContents) return;
    const nums = element && [element.x, element.y, element.width, element.height];
    if (!nums || !nums.every(n => typeof n === 'number' && Number.isFinite(n))) return;

    // Fly the agent whose answer produced this guide (it may have been deleted since)
    const { characters } = state;
    const char = characters.includes(stepGuideOwner) ? stepGuideOwner : characters[0];
    if (char) {
      char.flyTo(element.x + element.width / 2, element.y + element.height / 2);
    }
  });

  ipcMain.on('return-character', () => {
    state.characters.forEach(c => c.returnToTaskbar());
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
}

module.exports = { createOverlayWindow, hideOverlay, destroyOverlay, showStepGuide, registerOverlayIpc };
