const { spawn } = require('child_process');
const { findBinary, getProcessEnv } = require('../utils/shell-env');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

/**
 * Google Gemini CLI Session.
 * Spawns node.exe directly with the Gemini CLI entry script on Windows.
 * Uses --prompt with --output-format stream-json.
 */
class GeminiSession extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.isRunning = false;
    this.isBusy = false;
    this.history = [];
    this.lineBuffer = '';
    this.currentResponseText = '';
    this.lastSentMessage = '';
    this.echoFiltered = false;
  }

  start() {
    const binaryPath = findBinary('gemini');
    if (!binaryPath) {
      const msg = 'Gemini CLI not found.\n\nInstall:\n  npm install -g @google/gemini-cli\n  Then run: gemini';
      this.emit('error', msg);
      this.history.push({ role: 'error', text: msg });
      return;
    }
    this.binaryPath = binaryPath;
    this._resolveEntryScript();
    this.isRunning = true;
    this.emit('sessionReady');
  }

  /** On Windows, find the actual JS entry script from the .cmd wrapper */
  _resolveEntryScript() {
    if (process.platform !== 'win32') return;

    let binPath = this.binaryPath;
    if (!binPath.endsWith('.cmd') && !binPath.endsWith('.exe')) {
      if (fs.existsSync(binPath + '.cmd')) binPath = binPath + '.cmd';
    }
    this.binaryPath = binPath;

    if (!binPath.endsWith('.cmd') || !fs.existsSync(binPath)) return;

    try {
      const cmdContent = fs.readFileSync(binPath, 'utf8');
      const match = cmdContent.match(/"([^"]+\.js)"/);
      if (match) {
        const cmdDir = path.dirname(binPath) + '\\';
        const resolved = match[1].replace(/%~?dp0%?/gi, cmdDir);
        if (fs.existsSync(resolved)) {
          this._entryScript = resolved;
        }
      }
    } catch (e) { /* use fallback */ }
  }

  send(message) {
    if (!this.binaryPath) {
      this.start();
      if (!this.binaryPath) return;
    }

    this.history.push({ role: 'user', text: message });
    this.isBusy = true;
    this.currentResponseText = '';
    this.lineBuffer = '';
    this.lastSentMessage = message;
    this.echoFiltered = false;

    // Kill any existing process
    if (this.process) {
      try { this.process.kill(); } catch (e) { /* */ }
      this.process = null;
    }

    try {
      const env = getProcessEnv();
      const home = os.homedir();

      // Prepend context so Gemini acts as a chat assistant, not a code agent
      const chatPrompt = `You are a helpful desktop assistant. Answer the user's question directly and concisely. Do NOT try to run commands or use tools - just provide a clear text answer.\n\nUser: ${message}`;

      // Args: non-interactive, stream-json output
      const args = [
        '--output-format', 'stream-json',
        '--prompt', chatPrompt
      ];

      if (process.platform === 'win32' && this._entryScript) {
        const nodePath = process.execPath;
        if (fs.existsSync(nodePath)) {
          this.process = spawn(nodePath, [this._entryScript, ...args], {
            cwd: home,
            env: env,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true
          });
        }
      }

      // Fallback or non-Windows
      if (!this.process) {
        this.process = spawn(this.binaryPath, args, {
          cwd: home,
          env: env,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: process.platform === 'win32'
        });
      }

      this.process.stdout.on('data', (data) => {
        this._processOutput(data.toString('utf8'));
      });

      this.process.stderr.on('data', (data) => {
        const errText = data.toString('utf8').trim();
        if (!errText) return;

        // Filter noise
        if (errText.includes('YOLO mode') || errText.includes('Loaded cached')) return;
        if (errText.includes('Gemini CLI') || errText.includes('Tips for')) return;
        if (/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\s]+$/.test(errText)) return;

        // Friendly rate-limit message
        if (errText.includes('429') || errText.includes('RESOURCE_EXHAUSTED') || errText.includes('capacity')) {
          this.emit('error', '⏳ Gemini servers are busy. Please wait a moment and try again.');
          return;
        }

        // Concise real errors
        const firstLine = errText.split('\n')[0].substring(0, 200);
        if (firstLine.includes('Error') || firstLine.includes('error') || firstLine.includes('not found')) {
          this.emit('error', firstLine);
        }
      });

      this.process.on('exit', (code) => {
        if (this.lineBuffer.trim()) {
          this._parseLine(this.lineBuffer.trim());
          this.lineBuffer = '';
        }

        if (this.currentResponseText.trim()) {
          this.history.push({ role: 'assistant', text: this.currentResponseText.trim() });
        }

        this.isBusy = false;

        if (code === 0 || this.currentResponseText.trim()) {
          this.emit('turnComplete');
        } else {
          this.emit('error', `Gemini exited with code ${code}. Try again or run 'gemini' in terminal to check auth.`);
          this.emit('turnComplete');
        }
        this.currentResponseText = '';
      });

      this.process.on('error', (err) => {
        this.isBusy = false;
        this.emit('error', `Failed to launch Gemini: ${err.message}`);
      });

    } catch (err) {
      this.isBusy = false;
      this.emit('error', `Failed to spawn Gemini: ${err.message}`);
    }
  }

  terminate() {
    if (this.process) {
      try { this.process.kill(); } catch (e) { /* */ }
      this.process = null;
    }
    this.isRunning = false;
    this.isBusy = false;
  }

  _processOutput(text) {
    this.lineBuffer += text;
    let newlineIdx;
    while ((newlineIdx = this.lineBuffer.indexOf('\n')) !== -1) {
      const line = this.lineBuffer.substring(0, newlineIdx);
      this.lineBuffer = this.lineBuffer.substring(newlineIdx + 1);
      if (line.trim()) {
        this._parseLine(line.trim());
      }
    }
  }

  _parseLine(line) {
    // Filter echoed prompt (Gemini may echo the full --prompt text or just the user message)
    if (!this.echoFiltered) {
      const trimmedLine = line.trim();
      const trimmedMsg = this.lastSentMessage.trim();
      // Check if the line is the raw message, contains it, or is part of our prompt prefix
      if (trimmedLine === trimmedMsg ||
          trimmedLine.startsWith(trimmedMsg) ||
          trimmedLine.includes('User: ' + trimmedMsg) ||
          trimmedLine.startsWith('You are a helpful desktop assistant')) {
        this.echoFiltered = true;
        return;
      }
      this.echoFiltered = true;
    }

    // Try JSON parse
    let json;
    try {
      json = JSON.parse(line);
    } catch (e) {
      // Raw text output
      if (line.trim()) {
        this.currentResponseText += line + '\n';
        this.emit('text', line + '\n');
      }
      return;
    }

    const type = json.type || '';

    switch (type) {
      case 'init':
        // Session started
        break;

      case 'message': {
        // Skip user role messages (echo)
        if (json.role === 'user') break;

        const content = json.content || '';
        if (content && typeof content === 'string') {
          this.currentResponseText += content;
          this.emit('text', content);
        }
        break;
      }

      case 'result':
        // Final stats — turn is done
        break;

      case 'toolCall':
      case 'tool_use': {
        const toolName = json.name || json.toolName || json.tool || 'tool';
        const input = json.input || json.args || json.arguments || {};
        const summary = typeof input === 'string' ? input : (input.command || input.path || input.query || JSON.stringify(input));
        const displaySummary = String(summary).substring(0, 100);
        this.history.push({ role: 'toolUse', text: `${toolName}: ${displaySummary}` });
        this.emit('toolUse', toolName, input);
        break;
      }

      case 'toolResult':
      case 'tool_result': {
        const output = json.output || json.result || json.content || '';
        const isError = json.isError || json.is_error || json.error || false;
        const summary = typeof output === 'string' ? output.substring(0, 120) : JSON.stringify(output).substring(0, 120);
        this.history.push({ role: 'toolResult', text: isError ? `Error: ${summary}` : summary });
        this.emit('toolResult', summary, !!isError);
        break;
      }

      default: {
        // Try to extract content from any shape
        if (json.content && typeof json.content === 'string') {
          // Skip if it's the user's echo
          if (json.role === 'user') break;
          this.currentResponseText += json.content;
          this.emit('text', json.content);
        } else if (json.text && typeof json.text === 'string') {
          this.currentResponseText += json.text;
          this.emit('text', json.text);
        }
        break;
      }
    }
  }
}

module.exports = GeminiSession;
