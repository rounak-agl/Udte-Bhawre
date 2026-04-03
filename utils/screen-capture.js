const { BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');

/**
 * Periodic WebRTC screen capture service using a background renderer.
 */
class ScreenCapture {
  constructor(options = {}) {
    this.captureInterval = options.interval || 3000;
    this.maxBufferSize = options.maxBuffer || 10;
    this.screenshots = [];
    this.isRunning = false;
    this.captureWindow = null;
    this._cleanupId = null;
    
    // Set up singleton IPC listener for incoming frames
    ipcMain.on('screenshot-captured', (event, dataUrl) => {
      this._handleScreenshot(dataUrl);
    });
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    // Create a hidden browser window that uses standard browser webRTC
    this.captureWindow = new BrowserWindow({
      show: false, // The portal prompt will still appear natively
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.captureWindow.loadFile(path.join(__dirname, '..', 'renderer', 'capture.html'));

    this._cleanupId = setInterval(() => {
      this._cleanup();
    }, 30000);

    console.log('[ScreenCapture] Started WebRTC renderer window');
  }

  stop() {
    if (this.captureWindow && !this.captureWindow.isDestroyed()) {
      this.captureWindow.close();
      this.captureWindow = null;
    }
    if (this._cleanupId) {
      clearInterval(this._cleanupId);
      this._cleanupId = null;
    }
    this.screenshots = [];
    this.isRunning = false;
    console.log('[ScreenCapture] Stopped');
  }

  getLatest() {
    if (this.screenshots.length === 0) return null;
    const latest = this.screenshots[this.screenshots.length - 1];
    return {
      base64: latest.base64,
      timestamp: latest.timestamp,
      width: latest.width,
      height: latest.height
    };
  }

  getLatestBuffer() {
    if (this.screenshots.length === 0) return null;
    const latest = this.screenshots[this.screenshots.length - 1];
    return {
      buffer: Buffer.from(latest.base64, 'base64'),
      timestamp: latest.timestamp,
      width: latest.width,
      height: latest.height
    };
  }

  async captureNow() {
    // If we're using interval, just fetch the latest automatically buffered frame
    return this.getLatest();
  }

  getBufferInfo() {
    return {
      count: this.screenshots.length,
      maxSize: this.maxBufferSize,
      isRunning: this.isRunning,
      oldestTs: this.screenshots.length > 0 ? this.screenshots[0].timestamp : null,
      newestTs: this.screenshots.length > 0 ? this.screenshots[this.screenshots.length - 1].timestamp : null
    };
  }

  _handleScreenshot(dataUrl) {
    const timestamp = Date.now();
    const img = nativeImage.createFromDataURL(dataUrl);
    const size = img.getSize();
    
    // DataUrl format: data:image/jpeg;base64,...
    const base64str = dataUrl.split('base64,')[1];
    
    const screenshot = {
      timestamp,
      thumbnail: img,
      width: size.width,
      height: size.height,
      base64: base64str
    };
    
    this.screenshots.push(screenshot);
    while (this.screenshots.length > this.maxBufferSize) {
      this.screenshots.shift();
    }
  }

  _cleanup() {
    const cutoff = Date.now() - 30000;
    const before = this.screenshots.length;
    this.screenshots = this.screenshots.filter(s => s.timestamp > cutoff);
    const removed = before - this.screenshots.length;
    if (removed > 0) {
      console.log(`[ScreenCapture] Cleaned up ${removed} old screenshots`);
    }
  }
}

module.exports = ScreenCapture;
