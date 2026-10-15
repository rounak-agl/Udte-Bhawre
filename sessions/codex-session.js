const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const CliSession = require('./cli-session');
const { promptWithImages } = require('./conversation-context');

/**
 * OpenAI Codex CLI — one `codex --quiet "<prompt>"` process per message.
 * Codex keeps no memory between processes and has no system-prompt flag, so the
 * agent's persona and recent conversation are sent along with each message.
 */
class CodexSession extends CliSession {
  constructor() {
    super({
      provider: 'codex',
      binary: 'codex',
      label: 'Codex',
      installHint: 'Install OpenAI Codex CLI:\n  npm install -g @openai/codex'
    });
  }

  buildArgs(message, images = []) {
    // Codex reads images from files (--image); they're deleted when the reply is done
    this.removeImageFiles();
    this.imageFiles = images.map(img => {
      const ext = img.mimeType === 'image/png' ? 'png' : 'jpg';
      const file = path.join(os.tmpdir(), `da-codex-${crypto.randomUUID()}.${ext}`);
      fs.writeFileSync(file, Buffer.from(img.data, 'base64'), { mode: 0o600 });
      return file;
    });
    const imageArgs = this.imageFiles.flatMap(f => ['--image', f]);
    return ['--quiet', ...imageArgs, this.promptWithContext(promptWithImages(message, images.length))];
  }

  removeImageFiles() {
    for (const f of this.imageFiles || []) fs.rm(f, { force: true }, () => {});
    this.imageFiles = [];
  }

  handleClose(code) {
    this.removeImageFiles();
    super.handleClose(code);
  }

  terminate() {
    this.removeImageFiles();
    super.terminate();
  }
}

module.exports = CodexSession;
