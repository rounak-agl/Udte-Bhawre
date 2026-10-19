const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { Character } = require('./character');
const { approveToolCall } = require('./security');
const { listProviders, isKnownProvider, getProviderInfo, addCustomModel } = require('../sessions/providers');
const { getApiKey, getCustomModels, setApiKey, getMcpServers } = require('../sessions/agent-session');
const { getCatalogEntry } = require('../mcp-servers/catalog');
const { listOllamaModels } = require('../sessions/ollama-session');

const CREW = {
  bo: 'Bo',
  pim: 'Pim',
  tuck: 'Tuck',
  zip: 'Zip',
  penny: 'Penny'
};

const PROMPTS = path.join(__dirname, 'crew-prompts');
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const CURATED = [
  ['filesystem', ['tuck']],
  ['notion', ['zip']],
  ['slack', ['bo', 'zip']],
  ['todoist', ['bo']],
  ['hubspot', ['zip']],
  ['airtable', ['penny']],
  ['stripe', ['penny']],
  ['exa', ['zip', 'penny']],
  ['fetch', ['zip']]
];

const chars = new Map();
const approvals = new Map();
let sink = null;

function configPath() {
  return path.join(app.getPath('userData'), 'crew.json');
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[Crew] Could not read crew.json:', err.message);
    return {};
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

function defaultProvider() {
  if (getApiKey()) return 'vision';
  const local = getCustomModels();
  if (local.length) return `ollama:${local[0].id}`;
  return 'vision';
}

function providerOf(id) {
  const key = readConfig().providers?.[id];
  return key && isKnownProvider(key) ? key : defaultProvider();
}

function emit(id, channel, args) {
  if (sink) sink({ id, channel, args });
}

function askApproval(id, message) {
  if (!sink) return approveToolCall(message);
  const planId = `ap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  emit(id, 'crew-approval', [{ planId, message: String(message || '') }]);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      approvals.delete(planId);
      emit(id, 'crew-approval-expired', [{ planId }]);
      resolve(false);
    }, APPROVAL_TIMEOUT_MS);
    approvals.set(planId, (ok) => {
      clearTimeout(timer);
      approvals.delete(planId);
      resolve(!!ok);
    });
  });
}

function getChar(id) {
  if (chars.has(id)) return chars.get(id);
  if (!CREW[id]) throw new Error(`Unknown crew member: ${id}`);
  const char = new Character({ name: CREW[id] });
  char.provider = providerOf(id);
  char.toolsEnabled = true;
  char.systemPromptFile = path.join(PROMPTS, `${id}.md`);
  char.chatReady = true;
  char.chatWindow = {
    isDestroyed: () => false,
    isVisible: () => true,
    show() {},
    hide() {},
    focus() {},
    webContents: { send: (channel, ...args) => emit(id, channel, args) }
  };
  char.showBubble = () => {};
  char.hideBubble = () => {};
  char.showCompletionBubble = () => {};
  char.startThinking = () => emit(id, 'crew-thinking', []);
  char.stopThinking = () => {};
  const create = char.createSession.bind(char);
  char.createSession = (opts) => {
    create(opts);
    if (typeof char.session.setApprovalFunction === 'function') {
      char.session.setApprovalFunction((message) => askApproval(id, message));
    }
  };
  chars.set(id, char);
  return char;
}

function cleanImages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 4)
    .filter((i) => i && IMAGE_TYPES.has(i.mimeType) && typeof i.data === 'string' && i.data.length < 11e6 && BASE64.test(i.data))
    .map((i) => ({ mimeType: i.mimeType, data: i.data }));
}

function isCrew(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(CREW, id);
}

function send(id, text, rawImages) {
  if (!isCrew(id)) return;
  const fail = (msg) => {
    emit(id, 'chat-error', [msg]);
    emit(id, 'chat-turn-complete', []);
  };
  let char;
  try {
    char = getChar(id);
  } catch (err) {
    return fail(err.message || String(err));
  }
  const images = cleanImages(rawImages);
  if (char.orchestration.isRunning()) return emit(id, 'chat-busy', ['Still working on the last job. Send that again when it finishes.']);
  if (images.length && !getProviderInfo(char.provider)?.supportsImages) return fail('This brain cannot read images. Pick another one in the model menu.');
  try {
    if (!char.session) char.createSession();
    char.orchestration.onUserMessage();
    char.startThinking();
    char.session.send(String(text || ''), images);
  } catch (err) {
    fail(err.message || String(err));
  }
}

function decide(planId, ok) {
  if (typeof planId !== 'string') return;
  const done = approvals.get(planId);
  if (done) done(ok);
}

function stop(id) {
  const char = chars.get(id);
  if (!char) return;
  char.orchestration.cancel();
  if (char.session) {
    char.createSession();
    emit(id, 'chat-turn-complete', []);
  }
}

function setProvider(id, key) {
  if (!isCrew(id) || !isKnownProvider(key)) return false;
  const cfg = readConfig();
  cfg.providers = { ...(cfg.providers || {}), [id]: key };
  writeConfig(cfg);
  const char = chars.get(id);
  if (char) {
    char.provider = key;
    if (char.session) char.createSession();
  }
  return true;
}

function describe(key) {
  const info = getProviderInfo(key);
  return info ? { key: info.key, name: info.name, kind: info.kind === 'ollama' ? 'local' : 'cloud', supportsImages: info.supportsImages } : null;
}

function connectors() {
  const installed = getMcpServers() || {};
  return CURATED.map(([id, who]) => {
    const entry = getCatalogEntry(id);
    return entry ? { id, name: entry.name, description: entry.description, category: entry.category, who, on: !!installed[id] } : null;
  }).filter(Boolean);
}

function overview() {
  const assigned = {};
  for (const id of Object.keys(CREW)) assigned[id] = describe(providerOf(id));
  return {
    providers: listProviders().map((p) => ({ key: p.key, name: p.name, kind: p.kind === 'ollama' ? 'local' : 'cloud', supportsImages: p.supportsImages, model: p.model })),
    assigned,
    hasGeminiKey: !!getApiKey(),
    connectors: connectors()
  };
}

const OLLAMA = 'http://localhost:11434';

async function detectLocal() {
  const added = getCustomModels().map((m) => ({ id: m.id, model: m.model, name: m.name }));
  try {
    const models = await listOllamaModels(OLLAMA, { timeoutMs: 2500 });
    return { running: true, models: models.map((m) => ({ name: m.name, size: m.size })), added };
  } catch (err) {
    return { running: false, error: err.cause?.code === 'ECONNREFUSED' ? 'Ollama is not running' : err.message, models: [], added };
  }
}

function addLocal(model) {
  try {
    const entry = addCustomModel({ model, baseUrl: OLLAMA });
    return { ok: true, key: `ollama:${entry.id}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function setGeminiKey(key) {
  const k = String(key || '').trim();
  if (!/^[\w.-]{20,200}$/.test(k)) return { ok: false, error: 'That does not look like a Gemini key.' };
  setApiKey(k);
  for (const char of chars.values()) if (char.session) char.createSession();
  return { ok: true };
}

/** New sessions for crew members that have one (and match `which`), e.g. after a key change. */
function restartAll(which = () => true) {
  for (const char of chars.values()) {
    if (char.session && which(char)) char.createSession();
  }
}

function setSink(fn) {
  sink = fn;
}

function shutdown() {
  for (const char of chars.values()) {
    if (char.session) char.session.terminate();
  }
}

module.exports = { isCrew, send, decide, stop, setProvider, overview, setSink, shutdown, detectLocal, addLocal, setGeminiKey, restartAll };
