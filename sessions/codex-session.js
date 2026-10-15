const spawn = require('cross-spawn'); // no shell: user text must never reach sh/cmd.exe
const { findBinary, getProcessEnv } = require('../utils/shell-env');
const { getProviderEnv } = require('./agent-session');
const { buildTranscript } = require('./conversation-context');
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
    this.systemPrompt = ''; // agent persona, set by the owning Character before start()
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
    if (this._spawn(binaryPath, ['--quiet'])) {
      this.emit('sessionReady');
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
    // Each message is a fresh codex process, so it has no memory of its own: send the
    // persona file (no system-prompt flag exists) and recent conversation with it.
    const earlier = buildTranscript(this.history.slice(0, -1));
    const context = [
      this.systemPrompt,
      earlier && `Conversation so far:\n${earlier}`
    ].filter(Boolean);
    const prompt = context.length ? `${context.join('\n\n---\n\n')}\n\n---\n\nUser: ${message}` : message;
    this._spawn(binaryPath, ['--quiet', prompt]);
  }

  /**
   * Spawn a codex process. Every handler checks it still belongs to the current
   * process: a killed process exits asynchronously, and its late output/exit must not
   * leak into (or prematurely complete) the next turn.
   */
  _spawn(binaryPath, args) {
    let proc;
    try {
      proc = spawn(binaryPath, args, {
        cwd: os.homedir(),
        env: { ...getProcessEnv(), ...getProviderEnv('codex') }, // + this provider's API key, if set
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (err) {
      this.emit('error', `Failed to run Codex: ${err.message}`);
      this.isBusy = false;
      return false;
    }
    this.process = proc;
    this.isRunning = true;
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
      this.emit('error', `Failed to run Codex: ${err.message}`);
    });

    // 'close' (not 'exit'): fires only after stdout is drained, so the reply is complete
    proc.on('close', () => {
      if (!isCurrent()) return;
      if (this.outputBuffer.trim()) {
        this.history.push({ role: 'assistant', text: this.outputBuffer.trim() });
      }
      this.outputBuffer = '';
      this.isRunning = false;
      this.isBusy = false;
      this.process = null;
      this.emit('turnComplete');
      this.emit('processExit');
    });
    return true;
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

module.exports = CodexSession;
