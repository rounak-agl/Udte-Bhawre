const CliSession = require('./cli-session');

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

  buildArgs(message) {
    return ['--quiet', this.promptWithContext(message)];
  }
}

module.exports = CodexSession;
