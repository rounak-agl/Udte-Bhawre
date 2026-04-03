const { spawn } = require('child_process');
const { findBinary, getProcessEnv } = require('../utils/shell-env');
const os = require('os');
const EventEmitter = require('events');

/**
 * Claude CLI Session — spawns `claude` with stream-json I/O.
 * Parses NDJSON output for text, tool_use, tool_result, and result events.
 */
class ClaudeSession extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.isRunning = false;
    this.isBusy = false;
    this.history = [];
    this.lineBuffer = '';
    this.currentResponseText = '';
    this.pendingMessages = [];
  }

  start() {
    const binaryPath = findBinary('claude');
    if (!binaryPath) {
      const msg = 'Claude CLI not found.\n\nInstall Claude CLI:\n  curl -fsSL https://claude.ai/install.sh | sh\n  Or download from https://claude.ai/download';
      this.emit('error', msg);
      this.history.push({ role: 'error', text: msg });
      return;
    }
    this._launchProcess(binaryPath);
  }

  _launchProcess(binaryPath) {
    try {
      this.process = spawn(binaryPath, [
        '-p',
        '--output-format', 'stream-json',
        '--input-format', 'stream-json',
        '--verbose',
        '--dangerously-skip-permissions'
      ], {
        cwd: os.homedir(),
        env: getProcessEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        windowsHide: true
      });

      this.isRunning = true;

      this.process.stdout.on('data', (data) => {
        this._processOutput(data.toString('utf8'));
      });

      this.process.stderr.on('data', (data) => {
        const errText = data.toString('utf8').trim();
        if (!errText) return;

        // Filter common non-error stderr noise from Claude CLI
        if (errText.includes('Thinking') || errText.includes('Loading')) return;
        if (/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\s]+$/.test(errText)) return; // spinner

        // Friendly rate-limit message
        if (errText.includes('429') || errText.includes('rate') || errText.includes('overloaded')) {
          this.emit('error', '⏳ Claude is busy. Please wait a moment and try again.');
          return;
        }

        // Only emit actual error messages
        const firstLine = errText.split('\n')[0].substring(0, 200);
        if (firstLine.includes('Error') || firstLine.includes('error') || firstLine.includes('not found') || firstLine.includes('fail')) {
          this.emit('error', firstLine);
        }
      });

      this.process.on('exit', () => {
        this.isRunning = false;
        this.isBusy = false;
        this.emit('processExit');
      });

      this.process.on('error', (err) => {
        const msg = `Failed to launch Claude CLI.\n\n${err.message}`;
        this.emit('error', msg);
        this.history.push({ role: 'error', text: msg });
      });

      // Send any pending messages
      const pending = this.pendingMessages;
      this.pendingMessages = [];
      for (const msg of pending) {
        this._writeMessage(msg);
      }
    } catch (err) {
      const msg = `Failed to launch Claude CLI.\n\n${err.message}`;
      this.emit('error', msg);
      this.history.push({ role: 'error', text: msg });
    }
  }

  send(message) {
    if (!this.isRunning || !this.process) {
      this.pendingMessages.push(message);
      if (!this.isRunning) this.start();
      return;
    }
    this._writeMessage(message);
  }

  _writeMessage(message) {
    this.isBusy = true;
    this.currentResponseText = '';
    this.history.push({ role: 'user', text: message });

    const payload = {
      type: 'user',
      message: {
        role: 'user',
        content: message
      }
    };
    const line = JSON.stringify(payload) + '\n';
    try {
      this.process.stdin.write(line);
    } catch (e) {
      this.emit('error', `Failed to send message: ${e.message}`);
    }
  }

  terminate() {
    if (this.process) {
      try {
        this.process.kill();
      } catch (e) { /* ignore */ }
    }
    this.isRunning = false;
    this.pendingMessages = [];
  }

  _processOutput(text) {
    this.lineBuffer += text;
    let newlineIdx;
    while ((newlineIdx = this.lineBuffer.indexOf('\n')) !== -1) {
      const line = this.lineBuffer.substring(0, newlineIdx);
      this.lineBuffer = this.lineBuffer.substring(newlineIdx + 1);
      if (line.trim()) {
        this._parseLine(line);
      }
    }
  }

  _parseLine(line) {
    let json;
    try {
      json = JSON.parse(line);
    } catch (e) {
      return;
    }

    const type = json.type || '';

    switch (type) {
      case 'system': {
        const subtype = json.subtype || '';
        if (subtype === 'init') {
          this.emit('sessionReady');
        }
        break;
      }
      case 'assistant': {
        const message = json.message;
        if (message && Array.isArray(message.content)) {
          for (const block of message.content) {
            if (block.type === 'text' && block.text) {
              this.currentResponseText += block.text;
              this.emit('text', block.text);
            } else if (block.type === 'tool_use') {
              const toolName = block.name || 'Tool';
              const input = block.input || {};
              const summary = this._formatToolSummary(toolName, input);
              this.history.push({ role: 'toolUse', text: `${toolName}: ${summary}` });
              this.emit('toolUse', toolName, input);
            }
          }
        }
        break;
      }
      case 'user': {
        const message = json.message;
        if (message && Array.isArray(message.content)) {
          for (const block of message.content) {
            if (block.type === 'tool_result') {
              const isError = block.is_error || false;
              let summary = '';
              if (json.tool_use_result) {
                if (typeof json.tool_use_result === 'object') {
                  const ri = json.tool_use_result;
                  if (ri.file && ri.file.filePath) {
                    const lines = ri.file.totalLines || 0;
                    summary = `${ri.file.filePath} (${lines} lines)`;
                  }
                } else if (typeof json.tool_use_result === 'string') {
                  summary = json.tool_use_result.substring(0, 80);
                }
              }
              if (!summary && typeof block.content === 'string') {
                summary = block.content.substring(0, 80);
              }
              this.history.push({ role: 'toolResult', text: isError ? `ERROR: ${summary}` : summary });
              this.emit('toolResult', summary, isError);
            }
          }
        }
        break;
      }
      case 'result': {
        this.isBusy = false;
        let finalText = '';
        if (json.result && typeof json.result === 'string') {
          finalText = json.result;
        } else if (this.currentResponseText) {
          finalText = this.currentResponseText;
        }
        if (finalText) {
          this.history.push({ role: 'assistant', text: finalText });
        }
        this.currentResponseText = '';
        this.emit('turnComplete');
        break;
      }
    }
  }

  _formatToolSummary(toolName, input) {
    switch (toolName) {
      case 'Bash': return input.command || '';
      case 'Read': return input.file_path || '';
      case 'Edit':
      case 'Write': return input.file_path || '';
      case 'Glob': return input.pattern || '';
      case 'Grep': return input.pattern || '';
      default:
        if (input.description) return input.description;
        return Object.keys(input).sort().slice(0, 3).join(', ');
    }
  }
}

module.exports = ClaudeSession;
