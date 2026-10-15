const Store = require('./store');
const { seal, reveal, isSealed } = require('../utils/secret-store');

/** Copy of an MCP server map with every env value passed through fn (seal/reveal). */
function mapMcpEnv(servers, fn) {
  const out = {};
  for (const [id, cfg] of Object.entries(servers || {})) {
    const env = {};
    for (const [k, v] of Object.entries(cfg?.env || {})) env[k] = fn(v);
    out[id] = { ...cfg, env };
  }
  return out;
}

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
    this._apiKey = '';            // Gemini key (Gemini Vision + Gemini CLI); kept under its original name
    this._providerApiKeys = {};   // { claude, codex, copilot }
    this._elevenLabsApiKey = '';
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
      this._providerApiKeys = (store.providerApiKeys && typeof store.providerApiKeys === 'object') ? store.providerApiKeys : {};
      this._elevenLabsApiKey = store.elevenLabsApiKey || '';
      this._mongodbUri = store.mongodbUri || '';
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
      providerApiKeys: this._providerApiKeys,
      elevenLabsApiKey: this._elevenLabsApiKey,
      mongodbUri: this._mongodbUri,
      toolsEnabled: this._toolsEnabled,
      mcpServers: this._mcpServers
    });
  }

  get provider() { return this._provider; }
  set provider(v) { this._provider = v; this._save(); }

  get theme() { return this._theme; }
  set theme(v) { this._theme = v; this._save(); }

  // ── Secrets: held encrypted (see utils/secret-store.js), decrypted only when read ──
  get apiKey() { return reveal(this._apiKey); }
  set apiKey(v) { this._apiKey = seal(v); this._save(); }

  getProviderApiKey(provider) { return reveal(this._providerApiKeys[provider]); }
  setProviderApiKey(provider, v) { this._providerApiKeys = { ...this._providerApiKeys, [provider]: seal(v) }; this._save(); }

  get elevenLabsApiKey() { return reveal(this._elevenLabsApiKey); }
  set elevenLabsApiKey(v) { this._elevenLabsApiKey = seal(v); this._save(); }

  // The URI can embed a username and password, so it is treated as a secret too
  get mongodbUri() { return reveal(this._mongodbUri); }
  set mongodbUri(v) { this._mongodbUri = seal(v); this._save(); }

  /**
   * Encrypt any secrets still stored as plain text (written by older versions, or
   * while no credential store was available). Call once after app 'ready'.
   * Returns how many values were encrypted.
   */
  migrateSecrets() {
    let count = 0;
    const upgrade = (v) => {
      if (typeof v !== 'string' || v === '' || isSealed(v)) return v;
      const sealed = seal(v);
      if (isSealed(sealed)) count++;
      return sealed;
    };
    this._apiKey = upgrade(this._apiKey);
    this._elevenLabsApiKey = upgrade(this._elevenLabsApiKey);
    this._mongodbUri = upgrade(this._mongodbUri);
    this._providerApiKeys = Object.fromEntries(Object.entries(this._providerApiKeys).map(([p, v]) => [p, upgrade(v)]));
    this._mcpServers = mapMcpEnv(this._mcpServers, upgrade);
    if (count > 0) this._save();
    return count;
  }

  get toolsEnabled() { return this._toolsEnabled; }
  set toolsEnabled(v) { this._toolsEnabled = v; this._save(); }

  // MCP server env values are typically API tokens (GitHub PAT, Figma, Notion…)
  get mcpServers() { return mapMcpEnv(this._mcpServers, reveal); }
  set mcpServers(v) { this._mcpServers = mapMcpEnv(v, seal); this._save(); }
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

/**
 * Per-provider API keys. Each is handed to that provider's CLI through the environment
 * variable the CLI already reads. Gemini's key is the original "global" key and is
 * shared by Gemini Vision (API) and the Gemini CLI. An empty key sets nothing, so the
 * CLI falls back to its own login (e.g. `claude` / `gh` subscription auth).
 */
const API_KEY_PROVIDERS = {
  gemini: { label: 'Gemini', env: ['GEMINI_API_KEY'] },
  claude: { label: 'Claude (Anthropic)', env: ['ANTHROPIC_API_KEY'] },
  codex: { label: 'Codex (OpenAI)', env: ['OPENAI_API_KEY'] },
  copilot: { label: 'Copilot (GitHub)', env: ['GH_TOKEN', 'GITHUB_TOKEN'] }
};

// Which stored key a session provider uses ('vision' is the Gemini API)
function apiKeyProviderFor(sessionProvider) {
  return sessionProvider === 'vision' ? 'gemini' : sessionProvider;
}

function getProviderApiKey(provider) {
  return provider === 'gemini' ? settings.apiKey : settings.getProviderApiKey(provider);
}

function setProviderApiKey(provider, key) {
  if (!API_KEY_PROVIDERS[provider]) throw new Error(`Unknown API key provider: ${provider}`);
  if (provider === 'gemini') settings.apiKey = key;
  else settings.setProviderApiKey(provider, key);
}

function getAllProviderApiKeys() {
  return Object.fromEntries(Object.keys(API_KEY_PROVIDERS).map(p => [p, getProviderApiKey(p)]));
}

/** Environment variables to add when spawning a provider's CLI (empty if no key set). */
function getProviderEnv(sessionProvider) {
  const provider = apiKeyProviderFor(sessionProvider);
  const key = getProviderApiKey(provider);
  if (!key || !API_KEY_PROVIDERS[provider]) return {};
  return Object.fromEntries(API_KEY_PROVIDERS[provider].env.map(name => [name, key]));
}

function migrateSecrets() {
  return settings.migrateSecrets();
}

function getElevenLabsApiKey() {
  return settings.elevenLabsApiKey;
}

function setElevenLabsApiKey(key) {
  settings.elevenLabsApiKey = key;
}

function getMongodbUri() {
  return settings.mongodbUri;
}

function setMongodbUri(uri) {
  settings.mongodbUri = uri;
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
  API_KEY_PROVIDERS,
  apiKeyProviderFor,
  getProviderApiKey,
  setProviderApiKey,
  getAllProviderApiKeys,
  getProviderEnv,
  migrateSecrets,
  getElevenLabsApiKey,
  setElevenLabsApiKey,
  getMongodbUri,
  setMongodbUri,
  getToolsEnabled,
  setToolsEnabled,
  getMcpServers,
  setMcpServers,
  getTitleString
};
