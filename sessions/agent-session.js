const Store = require('./store');

/**
 * Supported AI providers.
 */
const PROVIDERS = {
  vision: {
    name: 'Gemini Vision',
    binary: null,  // uses API directly, not CLI
    installInstructions: 'Set your Gemini API key in the tray menu.\n  Get one free at: https://aistudio.google.com/apikey'
  },
  gemini: {
    name: 'Gemini',
    binary: 'gemini',
    installInstructions: 'Install Google Gemini CLI:\n  npm install -g @google/gemini-cli\n  Then authenticate by running: gemini (and sign in with Google)'
  },
  claude: {
    name: 'Claude',
    binary: 'claude',
    installInstructions: 'Install Claude CLI:\n  curl -fsSL https://claude.ai/install.sh | sh\n  Or download from https://claude.ai/download'
  },
  codex: {
    name: 'Codex',
    binary: 'codex',
    installInstructions: 'Install OpenAI Codex CLI:\n  npm install -g @openai/codex'
  },
  copilot: {
    name: 'Copilot',
    binary: 'copilot',
    installInstructions: 'Install GitHub Copilot CLI:\n  npm install -g @github/copilot-cli'
  }
};

/**
 * Title format enum matching lil-agents.
 */
const TITLE_FORMATS = {
  uppercase: 'uppercase',
  lowercaseTilde: 'lowercaseTilde',
  capitalized: 'capitalized'
};

/**
 * Simple file-based store for settings persistence.
 */
class SettingsStore {
  constructor() {
    this._provider = 'vision';
    this._theme = 'Peach';
    this._apiKey = '';
    this._toolsEnabled = true;
    this._mcpServers = {};
    this._load();
  }

  _load() {
    try {
      const store = Store.load();
      this._provider = store.provider || 'vision';
      this._theme = store.theme || 'Peach';
      this._apiKey = store.apiKey || '';
      this._toolsEnabled = store.toolsEnabled !== false; // default true
      this._mcpServers = store.mcpServers || {};
    } catch (e) {
      // defaults
    }
  }

  _save() {
    Store.save({
      provider: this._provider,
      theme: this._theme,
      apiKey: this._apiKey,
      toolsEnabled: this._toolsEnabled,
      mcpServers: this._mcpServers
    });
  }

  get provider() { return this._provider; }
  set provider(v) { this._provider = v; this._save(); }

  get theme() { return this._theme; }
  set theme(v) { this._theme = v; this._save(); }

  get apiKey() { return this._apiKey; }
  set apiKey(v) { this._apiKey = v; this._save(); }

  get toolsEnabled() { return this._toolsEnabled; }
  set toolsEnabled(v) { this._toolsEnabled = v; this._save(); }

  get mcpServers() { return this._mcpServers; }
  set mcpServers(v) { this._mcpServers = v; this._save(); }
}

const settings = new SettingsStore();

function getCurrentProvider() {
  return settings.provider;
}

function setCurrentProvider(providerKey) {
  if (PROVIDERS[providerKey]) {
    settings.provider = providerKey;
  }
}

function getProviderInfo(providerKey) {
  return PROVIDERS[providerKey] || PROVIDERS.vision;
}

function getAllProviders() {
  return Object.keys(PROVIDERS).map(key => ({
    key,
    ...PROVIDERS[key]
  }));
}

function getCurrentTheme() {
  return settings.theme;
}

function setCurrentTheme(themeName) {
  settings.theme = themeName;
}

function getApiKey() {
  return settings.apiKey;
}

function setApiKey(key) {
  settings.apiKey = key;
}

function getToolsEnabled() {
  return settings.toolsEnabled;
}

function setToolsEnabled(enabled) {
  settings.toolsEnabled = enabled;
}

function getMcpServers() {
  return settings.mcpServers;
}

function setMcpServers(configs) {
  settings.mcpServers = configs;
}

function getTitleString(providerKey, format) {
  const info = getProviderInfo(providerKey);
  switch (format) {
    case TITLE_FORMATS.uppercase: return info.name.toUpperCase();
    case TITLE_FORMATS.lowercaseTilde: return `${info.name.toLowerCase()} ~`;
    case TITLE_FORMATS.capitalized: return info.name;
    default: return info.name;
  }
}

module.exports = {
  PROVIDERS,
  TITLE_FORMATS,
  getCurrentProvider,
  setCurrentProvider,
  getProviderInfo,
  getAllProviders,
  getCurrentTheme,
  setCurrentTheme,
  getApiKey,
  setApiKey,
  getToolsEnabled,
  setToolsEnabled,
  getMcpServers,
  setMcpServers,
  getTitleString
};
