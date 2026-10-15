// Ollama local models and the provider registry, against a fake Ollama HTTP server.
const { test, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const { REPO, useTempHome, stubElectron, waitFor, recordEvents } = require('./helpers');

useTempHome({ provider: 'gemini' }); // a settings file from before the Gemini CLI was removed
stubElectron({});

// ── Fake Ollama: /api/tags lists models, /api/chat streams NDJSON ──
const requests = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    if (req.url === '/api/tags') {
      res.end(JSON.stringify({ models: [{ name: 'llama3.2:latest', size: 1 }, { name: 'qwen2.5-coder:7b', size: 2 }] }));
      return;
    }
    if (req.url === '/api/chat') {
      const json = JSON.parse(body);
      requests.push(json);
      if (json.model === 'missing') {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: `model "missing" not found, try pulling it first` }));
        return;
      }
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.write(JSON.stringify({ message: { role: 'assistant', content: 'Hello ' } }) + '\n');
      setTimeout(() => {
        res.write(JSON.stringify({ message: { role: 'assistant', content: 'there' } }) + '\n');
        res.end(JSON.stringify({ done: true }) + '\n');
      }, json.model === 'slow' ? 500 : 10);
      return;
    }
    res.statusCode = 404;
    res.end();
  });
});
let baseUrl;
const ready = new Promise(r => server.listen(0, '127.0.0.1', () => {
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  r();
}));
after(() => server.close());

const OllamaSession = require(path.join(REPO, 'sessions/ollama-session.js'));
const providers = require(path.join(REPO, 'sessions/providers.js'));

test('streams a reply and keeps conversation + persona in every request', async () => {
  await ready;
  const s = new OllamaSession({ name: 'Llama', model: 'llama3.2', baseUrl });
  s.systemPrompt = 'You are Pirate Pete.';
  s.history = [{ role: 'user', text: 'My name is Shaan.' }, { role: 'assistant', text: 'Ahoy!' }, { role: 'toolUse', text: 'x' }];
  const ev = recordEvents(s);
  s.start();
  await s.send('What is my name?');
  assert.strictEqual(ev.text.join(''), 'Hello there');
  assert.strictEqual(ev.turnComplete, 1);
  assert.strictEqual(s.history.at(-1).text, 'Hello there');
  const req = requests.at(-1);
  assert.strictEqual(req.model, 'llama3.2');
  assert.strictEqual(req.stream, true);
  assert.strictEqual(req.messages[0].role, 'system');
  assert.match(req.messages[0].content, /Pirate Pete/);
  assert.deepStrictEqual(req.messages.slice(1).map(m => `${m.role}:${m.content}`),
    ['user:My name is Shaan.', 'assistant:Ahoy!', 'user:What is my name?'], 'tool messages are not sent');
});

test('model not pulled → tells you to pull it', async () => {
  await ready;
  const s = new OllamaSession({ model: 'missing', baseUrl });
  const ev = recordEvents(s);
  await s.send('hi');
  assert.match(ev.error[0], /ollama pull missing/);
  assert.strictEqual(ev.turnComplete, 1);
  assert.strictEqual(s.isBusy, false);
});

test('Ollama not running → tells you to start it', async () => {
  const s = new OllamaSession({ model: 'llama3.2', baseUrl: 'http://127.0.0.1:9' });
  const ev = recordEvents(s);
  await s.send('hi');
  assert.match(ev.error[0], /Can't reach Ollama.*ollama serve/s);
});

test('terminate() mid-reply stops quietly', async () => {
  await ready;
  const s = new OllamaSession({ model: 'slow', baseUrl });
  const ev = recordEvents(s);
  const pending = s.send('hi');
  await waitFor(() => ev.text.length > 0);
  s.terminate();
  await pending;
  assert.deepStrictEqual(ev.error, []);
  assert.strictEqual(ev.turnComplete, 0);
});

test('registry: lists pulled models, adds/validates/removes custom models', async () => {
  await ready;
  const pulled = await OllamaSession.listOllamaModels(baseUrl);
  assert.deepStrictEqual(pulled.map(m => m.name), ['llama3.2:latest', 'qwen2.5-coder:7b']);

  assert.throws(() => providers.addCustomModel({ model: 'bad name; rm -rf /', baseUrl }), /valid Ollama model name/);
  assert.throws(() => providers.addCustomModel({ model: 'llama3.2', baseUrl: 'file:///etc' }), /http/);
  const added = providers.addCustomModel({ name: 'Llama', model: 'llama3.2:latest', baseUrl });
  assert.throws(() => providers.addCustomModel({ model: 'llama3.2:latest', baseUrl }), /already added/);

  const key = `ollama:${added.id}`;
  const listed = providers.listProviders();
  assert.deepStrictEqual(listed.slice(0, 4).map(p => p.key), ['vision', 'claude', 'codex', 'copilot']);
  assert.ok(listed.some(p => p.key === key && p.kind === 'ollama' && p.name === 'Llama'));
  assert.ok(!listed.some(p => p.key === 'gemini'), 'Gemini CLI provider removed');
  assert.ok(providers.createSession(key) instanceof OllamaSession);

  assert.strictEqual(providers.removeCustomModel(added.id), true);
  const gone = providers.createSession(key);
  assert.ok(gone instanceof providers.UnavailableSession);
  const ev = recordEvents(gone);
  gone.send('hi');
  assert.match(ev.error[0], /no longer available/);
  assert.strictEqual(ev.turnComplete, 1, 'UI is released');
});

test('registry: removed Gemini CLI provider migrates to Gemini Vision', () => {
  assert.strictEqual(providers.resolveProviderKey('gemini'), 'vision');
  assert.ok(providers.isKnownProvider('gemini'));
  assert.strictEqual(providers.getProviderInfo('gemini').key, 'vision');
  assert.ok(!providers.isKnownProvider('openai'));
});
