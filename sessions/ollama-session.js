const EventEmitter = require('events');
const { toChatMessages, userEntry, promptWithImages } = require('./conversation-context');

const BASE_PROMPT = 'You are a helpful desktop assistant. Answer the user directly and concisely. Use markdown formatting.';

/** Put this turn's images (base64) on the last user message; vision models read them. */
function withImages(messages, message, images) {
  if (!images.length || !messages.length) return messages;
  const last = messages[messages.length - 1];
  return [...messages.slice(0, -1), { ...last, content: promptWithImages(message, images.length), images: images.map(i => i.data) }];
}

/**
 * A user-added local model served by Ollama (https://ollama.com), talking to its
 * HTTP API: POST {baseUrl}/api/chat with stream=true returns one JSON object per line
 * ({ message: { content }, done }). No desktop tools; images work with vision models
 * (llava, gemma3, llama3.2-vision…).
 *
 * Every request sends the persona and the recent conversation, so the model keeps
 * its memory across messages, chat reopenings and app restarts.
 * Follows the same event contract as CliSession / VisionSession.
 */
class OllamaSession extends EventEmitter {
  /** @param {{ name: string, model: string, baseUrl: string }} config */
  constructor({ name, model, baseUrl }) {
    super();
    this.label = name || model;
    this.model = model;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.history = [];
    this.systemPrompt = ''; // agent persona, set by the owning Character before start()
    this.isRunning = false;
    this.isBusy = false;
    this._abort = null;
  }

  start() {
    this.isRunning = true;
    this.emit('sessionReady');
  }

  async send(message, images = [], opts = {}) {
    if (this.isBusy) {
      this.emit('error', 'Still processing the previous request. Please wait.');
      return;
    }
    this.history.push(userEntry(message, images.length, opts));
    this.isBusy = true;
    const abort = new AbortController();
    this._abort = abort;
    let reply = '';

    try {
      const system = [BASE_PROMPT, this.systemPrompt && `Agent instructions:\n${this.systemPrompt}`].filter(Boolean).join('\n\n');
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: true,
          messages: [{ role: 'system', content: system }, ...withImages(toChatMessages(this.history), message, images)]
        }),
        signal: abort.signal
      });

      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        if (res.status === 404 || /not found/i.test(detail)) {
          throw new Error(`Model "${this.model}" isn't available in Ollama. Pull it first:  ollama pull ${this.model}`);
        }
        throw new Error(`Ollama returned HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
      }

      // NDJSON stream: one JSON object per line
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const data = JSON.parse(line);
          if (data.error) throw new Error(`Ollama: ${data.error}`);
          const text = data.message?.content;
          if (text) {
            reply += text;
            this.emit('text', text);
          }
        }
      }
    } catch (err) {
      if (abort.signal.aborted) return; // terminated (settings change / agent removed)
      const unreachable = err.cause?.code === 'ECONNREFUSED' || /fetch failed|ECONNREFUSED/i.test(err.message);
      this.emit('error', unreachable
        ? `Can't reach Ollama at ${this.baseUrl}. Is it running? Start it with:  ollama serve`
        : err.message);
    } finally {
      if (this._abort === abort) this._abort = null;
      if (!abort.signal.aborted) {
        if (reply.trim()) this.history.push({ role: 'assistant', text: reply.trim() });
        this.isBusy = false;
        this.emit('turnComplete');
      }
    }
  }

  terminate() {
    if (this._abort) this._abort.abort();
    this._abort = null;
    this.isRunning = false;
    this.isBusy = false;
  }
}

/** Only http(s); default port/host for a bare "localhost:11434" style entry. */
function normalizeBaseUrl(url) {
  let value = String(url || 'http://localhost:11434').trim().replace(/\/+$/, '');
  // Any other scheme (file:, ftp:, javascript:…) is rejected, not "fixed" into http://
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) {
    throw new Error('Ollama URL must start with http:// or https://');
  }
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  const parsed = new URL(value); // throws on garbage
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Ollama URL must be http(s)');
  return value;
}

/** Models pulled into an Ollama server (GET /api/tags) — used by Settings → Custom LLMs. */
async function listOllamaModels(baseUrl, { timeoutMs = 4000 } = {}) {
  const url = normalizeBaseUrl(baseUrl);
  const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}`);
  const data = await res.json();
  return (data.models || []).map(m => ({ name: m.name, size: m.size, modifiedAt: m.modified_at }));
}

module.exports = OllamaSession;
module.exports.normalizeBaseUrl = normalizeBaseUrl;
module.exports.listOllamaModels = listOllamaModels;
