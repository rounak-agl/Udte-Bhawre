const spawn = require('cross-spawn'); // no shell: user text must never reach sh/cmd.exe
const { findBinary, getProcessEnv } = require('../utils/shell-env');
const { getProviderEnv } = require('./agent-session');
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
    this.systemPrompt = ''; // agent persona, set by the owning Character before start()
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
    let proc;
    try {
      proc = spawn(binaryPath, args, {
        cwd: os.homedir(),
        env: { ...getProcessEnv(), ...getProviderEnv('copilot') }, // + this provider's API key, if set
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (err) {
      this.emit('error', `Failed to launch Copilot CLI: ${err.message}`);
      this.isBusy = false;
      return;
    }
    this.process = proc;
    // A killed process exits asynchronously: ignore its late events so they can't
    // leak into (or prematurely complete) the next turn.
    const isCurrent = () => this.process === proc;

    proc.stdout.on('data', (data) => {
      if (!isCurrent()) return;
      const text = data.toString('utf8');
      this.outputBuffer += text;
      this.emit('text', text);
    });

    proc.stderr.on('data', (data) => {
      if (!isCurrent()) return;
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

    // Without an 'error' listener, a failed spawn would throw in the main process
    proc.on('error', (err) => {
      if (!isCurrent()) return;
      this.isBusy = false;
      this.emit('error', `Failed to launch Copilot CLI: ${err.message}`);
    });

    // 'close' (not 'exit'): fires only after stdout is drained, so the reply is complete
    proc.on('close', () => {
      if (!isCurrent()) return;
      if (this.outputBuffer.trim()) {
        this.history.push({ role: 'assistant', text: this.outputBuffer.trim() });
      }
      this.outputBuffer = '';
      this.isBusy = false;
      this.process = null;
      this.emit('turnComplete');
    });
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
    // `copilot suggest` takes a single request, so the agent's persona file (if any)
    // is not applied here — it would be sent as part of the command request.
    this._launch(binaryPath, ['suggest', message]);
  }

  terminate() {
    const proc = this.process;
    this.process = null; // detach first so the dying process's late events are ignored
    if (proc) {
      try { proc.kill(); } catch (e) { /* */ }
    }
    this.isRunning = false;
    this.isBusy = false;
  }
}

module.exports = CopilotSession;
