const CliSession = require('./cli-session');

/**
 * GitHub Copilot CLI — one `copilot suggest "<request>"` process per message.
 * `suggest` takes a single request, so the agent's persona file and earlier
 * conversation are not sent (they would become part of the command request).
 */
class CopilotSession extends CliSession {
  constructor() {
    super({
      provider: 'copilot',
      binary: 'copilot',
      label: 'Copilot',
      installHint: 'Install GitHub Copilot CLI:\n  npm install -g @github/copilot-cli'
    });
  }

  buildArgs(message) {
    return ['suggest', message];
  }
}

module.exports = CopilotSession;
