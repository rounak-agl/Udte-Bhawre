const Store = require('./store');
const { seal, reveal, isSealed } = require('../utils/secret-store');

/**
 * Persistent app settings (~/.desktop-assistant-settings.json).
 *
 * Which LLM providers exist lives in sessions/providers.js; this module only stores
 * values. Secrets are held encrypted (utils/secret-store.js) and decrypted on read.
 */

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

class SettingsStore {
  constructor() {
    this._provider = 'vision';
    this._theme = 'Peach';
    this._apiKey = '';            // Gemini key (Gemini Vision); kept under its original name
    this._providerApiKeys = {};   // { claude, codex, copilot }
    this._elevenLabsApiKey = '';
    this._mcpServers = {};
    this._customModels = [];      // user-added local models: [{ id, name, type: 'ollama', model, baseUrl }]
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
      this._mcpServers = store.mcpServers || {};
      this._customModels = Array.isArray(store.customModels) ? store.customModels : [];
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
      mcpServers: this._mcpServers,
      customModels: this._customModels
    });
  }

  get provider() { return this._provider; }
  set provider(v) { this._provider = v; this._save(); }

  get theme() { return this._theme; }
  set theme(v) { this._theme = v; this._save(); }

  get customModels() { return this._customModels.map(m => ({ ...m })); }
  set customModels(v) { this._customModels = v.map(m => ({ ...m })); this._save(); }

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

  // MCP server env values are typically API tokens (GitHub PAT, Figma, Notion…)
  get mcpServers() { return mapMcpEnv(this._mcpServers, reveal); }
  set mcpServers(v) { this._mcpServers = mapMcpEnv(v, seal); this._save(); }
}

const settings = new SettingsStore();

/** The default provider key for agents that don't set their own. Validate with providers.js. */
function getCurrentProvider() {
  return settings.provider;
}

function setCurrentProvider(providerKey) {
  settings.provider = providerKey;
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

/** User-added local models (see providers.js for how they become providers). */
function getCustomModels() {
  return settings.customModels;
}

function setCustomModels(models) {
  settings.customModels = models;
}

/**
 * Per-provider API keys. Each CLI gets its key through the environment variable it
 * already reads. Gemini's key is the original "global" key, used by Gemini Vision.
 * An empty key sets nothing, so the CLI falls back to its own login
 * (e.g. `claude` / `gh` subscription auth).
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

function getMcpServers() {
  return settings.mcpServers;
}

function setMcpServers(configs) {
  settings.mcpServers = configs;
}

module.exports = {
  getCurrentProvider,
  setCurrentProvider,
  getCurrentTheme,
  setCurrentTheme,
  getApiKey,
  setApiKey,
  getCustomModels,
  setCustomModels,
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
  getMcpServers,
  setMcpServers
};
