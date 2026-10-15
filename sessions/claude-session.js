const CliSession = require('./cli-session');
const { buildTranscript, userEntry, promptWithImages } = require('./conversation-context');

/**
 * Claude CLI — one long-running `claude -p` process with stream-json I/O.
 * Messages are written to stdin as JSON lines; output is NDJSON with text, tool_use,
 * tool_result and result events. Within one process Claude keeps its own memory, so
 * earlier conversation is only passed in once, at launch.
 */
class ClaudeSession extends CliSession {
  constructor() {
    super({
      provider: 'claude',
      binary: 'claude',
      label: 'Claude',
      installHint: 'Install Claude CLI:\n  curl -fsSL https://claude.ai/install.sh | sh\n  Or download from https://claude.ai/download',
      stderrNoise: ['Thinking', 'Loading']
    });
    this.lineBuffer = '';
    this.currentResponseText = '';
    this.pendingMessages = [];
  }

  // ── Long-running mode ─────────────────────────────────────

  start() {
    if (!this.resolveBinary()) return;
    this.lineBuffer = '';
    const proc = this.spawnProcess(this.buildLaunchArgs());
    if (!proc) return;

    // Messages sent while the process was starting
    const pending = this.pendingMessages;
    this.pendingMessages = [];
    for (const { message, images, opts } of pending) this.writeMessage(message, images, opts);
  }

  send(message, images = [], opts = {}) {
    if (!this.process) {
      this.pendingMessages.push({ message, images, opts });
      this.start();
      return;
    }
    this.writeMessage(message, images, opts);
  }

  terminate() {
    this.pendingMessages = [];
    super.terminate();
  }

  buildLaunchArgs() {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      // No --dangerously-skip-permissions: in non-interactive mode, tools that need
      // permission (Bash, Edit, Write) are denied instead of running unattended.
      '--verbose'
    ];
    // Agent persona/context file and any earlier conversation (restored from the
    // database or carried over from a previous session), added on top of Claude's
    // default system prompt.
    const earlier = buildTranscript(this.history);
    const extraPrompt = [
      this.systemPrompt,
      earlier && `Earlier conversation with this user (continue from here):\n${earlier}`
    ].filter(Boolean).join('\n\n');
    if (extraPrompt) args.push('--append-system-prompt', extraPrompt);
    return args;
  }

  writeMessage(message, images = [], opts = {}) {
    this.isBusy = true;
    this.currentResponseText = '';
    this.history.push(userEntry(message, images.length, opts));
    // Images go in as Anthropic image content blocks, before the text
    const content = images.length
      ? [
        ...images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } })),
        { type: 'text', text: promptWithImages(message, images.length) }
      ]
      : message;
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
    try {
      this.process.stdin.write(line);
    } catch (e) {
      this.isBusy = false;
      this.emit('error', `Failed to send message: ${e.message}`);
    }
  }

  // ── Output ─────────────────────────────────────────────────

  handleStdout(text) {
    this.lineBuffer += text;
    let newlineIdx;
    while ((newlineIdx = this.lineBuffer.indexOf('\n')) !== -1) {
      const line = this.lineBuffer.substring(0, newlineIdx);
      this.lineBuffer = this.lineBuffer.substring(newlineIdx + 1);
      if (line.trim()) this.parseLine(line);
    }
  }

  handleClose() {
    this.isRunning = false;
    // The process died mid-reply: say so and release the UI instead of hanging
    if (this.isBusy) {
      this.isBusy = false;
      this.emit('error', 'Claude stopped before finishing its reply. Send your message again to restart it.');
      this.emit('turnComplete');
    }
    this.emit('processExit');
  }

  parseLine(line) {
    let json;
    try {
      json = JSON.parse(line);
    } catch (e) {
      return;
    }

    switch (json.type || '') {
      case 'system':
        if (json.subtype === 'init') this.emit('sessionReady');
        break;

      case 'assistant': {
        const content = json.message?.content;
        if (!Array.isArray(content)) break;
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            this.currentResponseText += block.text;
            this.emit('text', block.text);
          } else if (block.type === 'tool_use') {
            const toolName = block.name || 'Tool';
            const input = block.input || {};
            this.history.push({ role: 'toolUse', text: `${toolName}: ${this.formatToolSummary(toolName, input)}` });
            this.emit('toolUse', toolName, input);
          }
        }
        break;
      }

      case 'user': {
        const content = json.message?.content;
        if (!Array.isArray(content)) break;
        for (const block of content) {
          if (block.type !== 'tool_result') continue;
          const isError = block.is_error || false;
          let summary = '';
          const result = json.tool_use_result;
          if (result && typeof result === 'object' && result.file?.filePath) {
            summary = `${result.file.filePath} (${result.file.totalLines || 0} lines)`;
          } else if (typeof result === 'string') {
            summary = result.substring(0, 80);
          }
          if (!summary && typeof block.content === 'string') {
            summary = block.content.substring(0, 80);
          }
          this.history.push({ role: 'toolResult', text: isError ? `ERROR: ${summary}` : summary });
          this.emit('toolResult', summary, isError);
        }
        break;
      }

      case 'result': {
        this.isBusy = false;
        const finalText = (typeof json.result === 'string' && json.result) || this.currentResponseText;
        if (finalText) this.history.push({ role: 'assistant', text: finalText });
        this.currentResponseText = '';
        this.emit('turnComplete');
        break;
      }
    }
  }

  formatToolSummary(toolName, input) {
    switch (toolName) {
      case 'Bash': return input.command || '';
      case 'Read':
      case 'Edit':
      case 'Write': return input.file_path || '';
      case 'Glob':
      case 'Grep': return input.pattern || '';
      default:
        if (input.description) return input.description;
        return Object.keys(input).sort().slice(0, 3).join(', ');
    }
  }
}

module.exports = ClaudeSession;
