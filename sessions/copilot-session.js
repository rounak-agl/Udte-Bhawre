const { spawn } = require('child_process');
const { findBinary, getProcessEnv } = require('../utils/shell-env');
const os = require('os');
const EventEmitter = require('events');

/**
 * GitHub Copilot CLI Session.
 */
class CopilotSession extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.isRunning = false;
    this.isBusy = false;
    this.history = [];
    this.outputBuffer = '';
  }

  start() {
    const binaryPath = findBinary('copilot');
    if (!binaryPath) {
      const msg = 'Copilot CLI not found.\n\nInstall GitHub Copilot CLI:\n  npm install -g @github/copilot-cli';
      this.emit('error', msg);
      this.history.push({ role: 'error', text: msg });
      return;
    }
    this.isRunning = true;
    this.emit('sessionReady');
  }

  _launch(binaryPath, args) {
    try {
      this.process = spawn(binaryPath, args, {
        cwd: os.homedir(),
        env: getProcessEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        windowsHide: true
      });

      this.process.stdout.on('data', (data) => {
        const text = data.toString('utf8');
        this.outputBuffer += text;
        this.emit('text', text);
      });

      this.process.stderr.on('data', (data) => {
        const errText = data.toString('utf8').trim();
        if (!errText) return;
        if (/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\s]+$/.test(errText)) return;
        if (errText.includes('429') || errText.includes('rate')) {
          this.emit('error', '⏳ Rate limited. Please wait a moment and try again.');
          return;
        }
        const firstLine = errText.split('\n')[0].substring(0, 200);
        if (firstLine.includes('Error') || firstLine.includes('error') || firstLine.includes('not found')) {
          this.emit('error', firstLine);
        }
      });

      this.process.on('exit', () => {
        if (this.outputBuffer.trim()) {
          this.history.push({ role: 'assistant', text: this.outputBuffer.trim() });
        }
        this.outputBuffer = '';
        this.isBusy = false;
        this.emit('turnComplete');
      });
    } catch (err) {
      this.emit('error', `Failed to launch Copilot CLI: ${err.message}`);
      this.isBusy = false;
    }
  }

  send(message) {
    this.history.push({ role: 'user', text: message });
    this.isBusy = true;
    this.outputBuffer = '';

    if (this.process) {
      try { this.process.kill(); } catch (e) { /* */ }
    }

    const binaryPath = findBinary('copilot');
    if (!binaryPath) {
      this.emit('error', 'Copilot CLI not found.');
      this.isBusy = false;
      return;
    }
    this._launch(binaryPath, ['suggest', message]);
  }

  terminate() {
    if (this.process) {
      try { this.process.kill(); } catch (e) { /* */ }
    }
    this.isRunning = false;
  }
}

module.exports = CopilotSession;
