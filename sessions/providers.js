const EventEmitter = require('events');
const crypto = require('crypto');
const { getCustomModels, setCustomModels } = require('./agent-session');
const { normalizeBaseUrl } = require('./ollama-session');

/**
 * Provider registry — the one place that knows which LLM providers exist and how to
 * create a session for each. Everything else (tray menu, chat ⚙ menu, Agents page,
 * Settings, agent validation) asks this module instead of keeping its own list.
 *
 * Provider keys: built-ins ('vision', 'claude', 'codex', 'copilot') and user-added
 * local models ('ollama:<id>').
 */

// Session classes are required lazily so listing providers stays cheap.
const BUILTIN_PROVIDERS = [
  {
    key: 'vision', name: 'Gemini Vision', emoji: '👁', supportsTools: true, supportsImages: true,
    create: ({ toolsEnabled }) => new (require('./vision-session'))({ toolsEnabled })
  },
  { key: 'claude', name: 'Claude', emoji: '✦', supportsImages: true, create: () => new (require('./claude-session'))() },
  { key: 'codex', name: 'Codex', emoji: '⚡', supportsImages: true, create: () => new (require('./codex-session'))() },
  // `copilot suggest` takes text only
  { key: 'copilot', name: 'Copilot', emoji: '🤖', create: () => new (require('./copilot-session'))() }
];

const DEFAULT_PROVIDER = 'vision';
const CUSTOM_PREFIX = 'ollama:';

// Providers that were removed, and what agents/settings that still use them become.
// 'gemini' was the Gemini CLI; Gemini Vision uses the same Gemini key.
const LEGACY_PROVIDERS = { gemini: 'vision' };

function resolveProviderKey(key) {
  return LEGACY_PROVIDERS[key] || key;
}

/** Everything the UI needs to show a provider list. */
function listProviders() {
  return [
    ...BUILTIN_PROVIDERS.map(({ key, name, emoji, supportsTools, supportsImages }) => ({
      key, name, emoji, kind: 'builtin', supportsTools: !!supportsTools, supportsImages: !!supportsImages
    })),
    // Images work with vision models (llava, gemma3…); others answer without them
    ...getCustomModels().map(m => ({
      key: CUSTOM_PREFIX + m.id, name: m.name, emoji: '🦙', kind: 'ollama',
      supportsTools: false, supportsImages: true, model: m.model, baseUrl: m.baseUrl
    }))
  ];
}

function getProviderInfo(key) {
  const resolved = resolveProviderKey(key);
  return listProviders().find(p => p.key === resolved) || null;
}

function isKnownProvider(key) {
  return !!getProviderInfo(key);
}

/**
 * Create a session for a provider key. An unknown key (e.g. a custom model that was
 * deleted) gives a session that explains the problem in the chat, rather than
 * silently switching the agent to a different model.
 */
function createSession(key, ctx = {}) {
  const resolved = resolveProviderKey(key || DEFAULT_PROVIDER);
  const builtin = BUILTIN_PROVIDERS.find(p => p.key === resolved);
  if (builtin) return builtin.create(ctx);

  if (resolved.startsWith(CUSTOM_PREFIX)) {
    const model = getCustomModels().find(m => CUSTOM_PREFIX + m.id === resolved);
    if (model) return new (require('./ollama-session'))(model);
  }
  return new UnavailableSession(resolved);
}

/** Stand-in session for an agent whose provider no longer exists. */
class UnavailableSession extends EventEmitter {
  constructor(key) {
    super();
    this.key = key;
    this.history = [];
    this.systemPrompt = '';
    this.isBusy = false;
  }
  explain() {
    return `This agent's model (${this.key}) is no longer available — it may have been removed in Control Centre → Settings → Custom LLMs. Pick another provider from the ⚙ menu.`;
  }
  start() { this.emit('error', this.explain()); }
  send() {
    this.emit('error', this.explain());
    this.emit('turnComplete');
  }
  terminate() {}
}

// ── Custom (Ollama) models ──────────────────────────────────

/**
 * Validate and add a local model. Returns the stored entry.
 * @param {{ name?: string, model: string, baseUrl?: string }} input
 */
function addCustomModel(input) {
  const model = typeof input?.model === 'string' ? input.model.trim() : '';
  // Ollama model names: "llama3.2", "qwen2.5-coder:7b", "hf.co/user/repo:Q4_K_M"
  if (!/^[\w.\-:/]{1,120}$/.test(model)) throw new Error('Enter a valid Ollama model name, e.g. llama3.2 or qwen2.5-coder:7b');
  const baseUrl = normalizeBaseUrl(input.baseUrl || 'http://localhost:11434');
  const name = (typeof input.name === 'string' && input.name.trim()) ? input.name.trim().slice(0, 40) : model;

  const models = getCustomModels();
  if (models.some(m => m.model === model && m.baseUrl === baseUrl)) {
    throw new Error(`${model} is already added`);
  }
  const entry = { id: crypto.randomUUID().slice(0, 8), name, type: 'ollama', model, baseUrl };
  setCustomModels([...models, entry]);
  return entry;
}

function removeCustomModel(id) {
  const models = getCustomModels();
  const next = models.filter(m => m.id !== id);
  if (next.length === models.length) return false;
  setCustomModels(next);
  return true;
}

module.exports = {
  DEFAULT_PROVIDER,
  CUSTOM_PREFIX,
  resolveProviderKey,
  listProviders,
  getProviderInfo,
  isKnownProvider,
  createSession,
  addCustomModel,
  removeCustomModel,
  UnavailableSession
};
