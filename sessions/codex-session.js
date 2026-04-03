const { spawn } = require('child_process');
const { findBinary, getProcessEnv } = require('../utils/shell-env');
const os = require('os');
const EventEmitter = require('events');

/**
 * OpenAI Codex CLI Session.
 * Spawns the codex CLI and pipes messages through stdin/stdout.
 */
class CodexSession extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.isRunning = false;
    this.isBusy = false;
    this.history = [];
    this.outputBuffer = '';
  }

  start() {
    const binaryPath = findBinary('codex');
    if (!binaryPath) {
      const msg = 'Codex CLI not found.\n\nInstall OpenAI Codex CLI:\n  npm install -g @openai/codex';
      this.emit('error', msg);
      this.history.push({ role: 'error', text: msg });
      return;
    }
    this._launch(binaryPath);
  }

  _launch(binaryPath) {
    try {
      this.process = spawn(binaryPath, ['--quiet'], {
        cwd: os.homedir(),
        env: getProcessEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        windowsHide: true
      });
      this.isRunning = true;

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
          this.outputBuffer = '';
        }
        this.isRunning = false;
        this.isBusy = false;
        this.emit('turnComplete');
        this.emit('processExit');
      });

      this.emit('sessionReady');
    } catch (err) {
      this.emit('error', `Failed to launch Codex CLI: ${err.message}`);
    }
  }

  send(message) {
    this.history.push({ role: 'user', text: message });
    this.isBusy = true;
    this.outputBuffer = '';
    // Codex CLI: kill old process, spawn fresh with the question
    if (this.process) {
      try { this.process.kill(); } catch (e) { /* */ }
    }
    const binaryPath = findBinary('codex');
    if (!binaryPath) {
      this.emit('error', 'Codex CLI not found.');
      this.isBusy = false;
      return;
    }
    try {
      this.process = spawn(binaryPath, ['--quiet', message], {
        cwd: os.homedir(),
        env: getProcessEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        windowsHide: true
      });
      this.isRunning = true;

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
      this.emit('error', `Failed to run Codex: ${err.message}`);
      this.isBusy = false;
    }
  }

  terminate() {
    if (this.process) {
      try { this.process.kill(); } catch (e) { /* */ }
    }
    this.isRunning = false;
  }
}

module.exports = CodexSession;
