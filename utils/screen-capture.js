const { desktopCapturer } = require('electron');

/**
 * On-demand screen capture service.
 * Captures screenshots when requested, stores in memory only.
 * All screenshots are deleted when session closes — zero disk footprint.
 */
class ScreenCapture {
  constructor(options = {}) {
    this.maxBufferSize = options.maxBuffer || 3;    // keep last 3
    this.screenshots = [];      // { timestamp, thumbnail (NativeImage), width, height }
    this.isRunning = false;
  }

  /** Initialize the capture service (detect Linux tools etc.) */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    if (process.platform === 'linux' && !this.linuxCaptureCmd) {
      const { execSync } = require('child_process');
      const desktop = (process.env.XDG_CURRENT_DESKTOP || '').toLowerCase();
      const tools = [];
      
      if (desktop.includes('gnome')) {
        tools.push({ cmd: 'gdbus', format: 'gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Screenshot.Screenshot "false" "false" "%s"' });
        tools.push({ cmd: 'gnome-screenshot', format: 'gnome-screenshot -f "%s"' });
      } else if (desktop.includes('kde')) {
        tools.push({ cmd: 'spectacle', format: 'spectacle -m -b -n -o "%s"' });
      }
      
      tools.push(
        { cmd: 'gnome-screenshot', format: 'gnome-screenshot -f "%s"' },
        { cmd: 'spectacle', format: 'spectacle -m -b -n -o "%s"' },
        { cmd: 'grim', format: 'grim "%s"' },
        { cmd: 'scrot', format: 'scrot -z "%s"' }
      );
      
      for (const tool of tools) {
        try {
          execSync(`command -v ${tool.cmd}`, { stdio: 'ignore' });
          this.linuxCaptureCmd = tool.format;
          console.log(`[ScreenCapture] Detected Linux screenshot tool: ${tool.cmd}`);
          break;
        } catch (e) {
          // not found, try next
        }
      }
      
      if (!this.linuxCaptureCmd) {
        console.log('[ScreenCapture] No native Linux screenshot tool found. Will fallback to desktopCapturer.');
      }
    }

    console.log('[ScreenCapture] Initialized (on-demand mode)');
  }

  /** Stop capture and clear ALL screenshots from memory */
  stop() {
    // Clear all screenshots from memory
    this.screenshots = [];
    this.isRunning = false;
    console.log('[ScreenCapture] Stopped, all screenshots cleared');
  }

  /** Capture a fresh screenshot right now and return it */
  async captureNow() {
    const result = await this._capture();
    if (result) {
      return {
        base64: result.thumbnail.toPNG().toString('base64'),
        timestamp: result.timestamp,
        width: result.width,
        height: result.height
      };
    }
    return null;
  }

  /** Internal: capture the primary screen */
  async _capture() {
    try {
      let thumbnail = null;

      if (process.platform === 'linux' && this.linuxCaptureCmd) {
        const { exec } = require('child_process');
        const path = require('path');
        const os = require('os');
        const fs = require('fs');
        const { nativeImage } = require('electron');
        const util = require('util');
        const execAsync = util.promisify(exec);

        // Unique per capture: two captures in the same millisecond must not share a file
        const tmpPath = path.join(os.tmpdir(), `screenshot-${process.pid}-${require('crypto').randomUUID()}.png`);
        try {
          const cmd = this.linuxCaptureCmd.replace('%s', tmpPath);
          await execAsync(cmd);
          
          // Wait briefly to ensure file I/O is fully flushed to disk by the system
          await new Promise(resolve => setTimeout(resolve, 300));
          
          if (fs.existsSync(tmpPath)) {
            thumbnail = nativeImage.createFromPath(tmpPath);
            fs.unlinkSync(tmpPath);
          }
        } catch (e) {
          console.error('[ScreenCapture] CLI Capture Error:', e.message);
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        }
      }

      if (!thumbnail || thumbnail.isEmpty()) {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1920, height: 1080 }
        });

        if (sources.length === 0) return null;
        thumbnail = sources[0].thumbnail;
      }

      if (!thumbnail || thumbnail.isEmpty()) return null;

      const size = thumbnail.getSize();

      const screenshot = {
        timestamp: Date.now(),
        thumbnail: thumbnail,
        width: size.width,
        height: size.height
      };

      // Circular buffer: push new, trim oldest
      this.screenshots.push(screenshot);
      while (this.screenshots.length > this.maxBufferSize) {
        this.screenshots.shift();
      }

      return screenshot;
    } catch (err) {
      console.error('[ScreenCapture] Capture error:', err.message);
      return null;
    }
  }

}

module.exports = ScreenCapture;
