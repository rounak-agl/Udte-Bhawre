const spawn = require('cross-spawn'); // no shell: user text must never reach sh/cmd.exe
const EventEmitter = require('events');
const os = require('os');
const { findBinary, getProcessEnv } = require('../utils/shell-env');
const { getProviderEnv } = require('./agent-session');
const { buildTranscript } = require('./conversation-context');

/**
 * Base class for providers that run a command-line tool (Claude, Codex, Copilot).
 *
 * It owns everything those providers share: finding the binary, spawning it without a
 * shell and with that provider's API key in the environment, filtering stderr, and the
 * process lifecycle. That lifecycle has three parts every provider needs, written once:
 *  - events from a process that has since been replaced are ignored, so a killed
 *    process can't leak output into, or complete, the next turn;
 *  - 'error' is always handled (an unhandled spawn error would crash the main process);
 *  - a turn ends on 'close', not 'exit', so all stdout has been read first.
 *
 * Default mode is one process per message (`buildArgs(message)` → spawn → its stdout is
 * the reply). A provider that keeps one long-running process (Claude) overrides
 * start()/send() and uses spawnProcess() for the shared plumbing.
 *
 * Events (the contract every session — CLI, API or local model — follows):
 *   'sessionReady'                 ready to accept messages
 *   'text' (chunk)                 streamed reply text
 *   'toolUse' (name, input)        the model used a tool
 *   'toolResult' (summary, isErr)  a tool finished
 *   'turnComplete'                 the reply is finished (history updated)
 *   'error' (message)              something went wrong (user-facing text)
 */
class CliSession extends EventEmitter {
  /**
   * @param {object} spec
   * @param {string} spec.provider     key used for API-key env injection ('claude', 'codex', …)
   * @param {string} spec.binary       executable name to look for
   * @param {string} spec.label        user-facing name ("Codex")
   * @param {string} spec.installHint  shown when the binary can't be found
   * @param {string[]} [spec.stderrNoise] stderr substrings that are progress chatter, not errors
   */
  constructor({ provider, binary, label, installHint, stderrNoise = [] }) {
    super();
    this.provider = provider;
    this.binary = binary;
    this.label = label;
    this.installHint = installHint;
    this.stderrNoise = stderrNoise;

    this.process = null;
    this.isRunning = false;
    this.isBusy = false;
    this.history = [];
    this.systemPrompt = ''; // agent persona, set by the owning Character before start()
    this.outputBuffer = '';
  }

  // ── Lifecycle ──────────────────────────────────────────────

  /** Check the CLI is installed. Per-message providers spawn nothing until send(). */
  start() {
    if (!this.resolveBinary()) return;
    this.isRunning = true;
    this.emit('sessionReady');
  }

  /** Per-message mode: a fresh process for each message. */
  send(message) {
    this.history.push({ role: 'user', text: message });
    this.isBusy = true;
    this.outputBuffer = '';
    this.killProcess();
    if (!this.resolveBinary()) {
      this.isBusy = false;
      return;
    }
    this.spawnProcess(this.buildArgs(message));
  }

  /** Arguments for one message (per-message providers implement this). */
  buildArgs(message) { // eslint-disable-line no-unused-vars
    throw new Error(`${this.constructor.name} must implement buildArgs()`);
  }

  terminate() {
    this.killProcess();
    this.isRunning = false;
    this.isBusy = false;
  }

  // ── Hooks a provider may override ─────────────────────────

  /** A chunk of stdout from the current process. Default: plain-text reply. */
  handleStdout(text) {
    this.outputBuffer += text;
    this.emit('text', text);
  }

  /** The current process ended and its output is fully read. Default: finish the turn. */
  handleClose() {
    if (this.outputBuffer.trim()) {
      this.history.push({ role: 'assistant', text: this.outputBuffer.trim() });
    }
    this.outputBuffer = '';
    this.isBusy = false;
    this.emit('turnComplete');
  }

  // ── Shared plumbing ───────────────────────────────────────

  /** Locate the CLI once; emit an install hint if it's missing. */
  resolveBinary() {
    if (!this.binaryPath) this.binaryPath = findBinary(this.binary);
    if (!this.binaryPath) {
      const msg = `${this.label} CLI not found.\n\n${this.installHint}`;
      this.emit('error', msg);
      this.history.push({ role: 'error', text: msg });
      return null;
    }
    return this.binaryPath;
  }

  /**
   * Spawn the CLI with these args and wire it up. Returns the child process, or null
   * if it couldn't be started (an error has been emitted).
   */
  spawnProcess(args) {
    let proc;
    try {
      proc = spawn(this.binaryPath, args, {
        cwd: os.homedir(),
        env: { ...getProcessEnv(), ...getProviderEnv(this.provider) }, // + this provider's API key, if set
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (err) {
      this.isBusy = false;
      this.emit('error', `Failed to run ${this.label}: ${err.message}`);
      return null;
    }
    this.process = proc;
    this.isRunning = true;
    const isCurrent = () => this.process === proc;

    proc.stdout.on('data', (data) => {
      if (isCurrent()) this.handleStdout(data.toString('utf8'));
    });
    proc.stderr.on('data', (data) => {
      if (isCurrent()) this.handleStderr(data.toString('utf8'));
    });
    proc.on('error', (err) => {
      if (!isCurrent()) return;
      this.isBusy = false;
      this.emit('error', `Failed to run ${this.label}: ${err.message}`);
    });
    proc.on('close', (code) => {
      if (!isCurrent()) return;
      this.process = null;
      this.handleClose(code);
    });
    return proc;
  }

  /** Detach first (so the dying process's late events are ignored), then kill it. */
  killProcess() {
    const proc = this.process;
    this.process = null;
    if (proc) {
      try { proc.kill(); } catch (_) { /* already gone */ }
    }
  }

  /** Surface real errors from stderr; drop spinners and progress chatter. */
  handleStderr(raw) {
    const text = raw.trim();
    if (!text) return;
    if (/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\s]+$/.test(text)) return; // spinner frames
    if (this.stderrNoise.some(noise => text.includes(noise))) return;

    if (/\b429\b|rate.?limit|overloaded|RESOURCE_EXHAUSTED/i.test(text)) {
      this.emit('error', `⏳ ${this.label} is busy or rate-limited. Please wait a moment and try again.`);
      return;
    }
    const firstLine = text.split('\n')[0].substring(0, 200);
    if (/error|not found|fail/i.test(firstLine)) {
      this.emit('error', firstLine);
    }
  }

  /**
   * The message plus the agent's persona and recent conversation, for CLIs that take
   * the whole prompt as an argument and have no memory between processes.
   */
  promptWithContext(message) {
    const earlier = buildTranscript(this.history.slice(0, -1)); // excludes the message itself
    const context = [
      this.systemPrompt,
      earlier && `Conversation so far:\n${earlier}`
    ].filter(Boolean);
    return context.length ? `${context.join('\n\n---\n\n')}\n\n---\n\nUser: ${message}` : message;
  }
}

module.exports = CliSession;
