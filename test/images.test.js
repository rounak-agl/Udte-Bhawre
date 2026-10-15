// Images in chat (📎 / paste / drop / 📷): validation, the chat IPC, and how each
// provider receives them. Nothing captures the screen on its own any more.
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { REPO, useTempHome, quiet, sleep } = require('./helpers');
const { createHarness } = require('./main-harness');

useTempHome();
const h = createHarness();
const IMG = { mimeType: 'image/jpeg', data: Buffer.from('fake-jpeg-bytes').toString('base64') };

test('load main.js', async () => { await h.load(); });

test('no automatic screen capture or step-guide overlay is left', () => {
  for (const f of ['utils/screen-capture.js', 'app/overlay.js', 'renderer/overlay.html', 'renderer/step-panel.html']) {
    assert.ok(!fs.existsSync(path.join(REPO, f)), `${f} removed`);
  }
  assert.ok(!('screenCapture' in require(path.join(REPO, 'app/state.js'))));
  const vision = fs.readFileSync(path.join(REPO, 'sessions/vision-session.js'), 'utf8');
  assert.ok(!/captureNow|bbox|BOUNDING/.test(vision));
});

test('cleanImages accepts up to 4 real images and rejects anything else', () => {
  const { cleanImages } = require(path.join(REPO, 'app/ipc/chat.js'));
  assert.deepStrictEqual(cleanImages(undefined), []);
  assert.deepStrictEqual(cleanImages([{ ...IMG, extra: 1 }]), [IMG], 'unknown fields dropped');
  assert.strictEqual(cleanImages([IMG, IMG, IMG, IMG, IMG]), null, 'too many');
  assert.strictEqual(cleanImages([{ mimeType: 'text/html', data: IMG.data }]), null);
  assert.strictEqual(cleanImages([{ mimeType: 'image/png', data: 'not base64!' }]), null);
  assert.strictEqual(cleanImages([{ mimeType: 'image/png', data: 'A'.repeat(12 * 1024 * 1024) }]), null, 'too big');
  assert.strictEqual(cleanImages('x'), null);
});

test('history keeps a note instead of the image', () => {
  const { userTurnText, promptWithImages } = require(path.join(REPO, 'sessions/conversation-context.js'));
  assert.strictEqual(userTurnText('hi', 0), 'hi');
  assert.strictEqual(userTurnText('what is this?', 1), 'what is this?\n[📎 1 image attached]');
  assert.strictEqual(userTurnText('', 2), '[📎 2 images attached]');
  assert.strictEqual(promptWithImages('', 1), 'Take a look at this image.');
  assert.strictEqual(promptWithImages('explain', 1), 'explain');
});

test('Gemini Vision: images go in as inlineData; only the latest 3 image turns stay in context', async () => {
  const VisionSession = require(path.join(REPO, 'sessions/vision-session.js'));
  const v = new VisionSession({ toolsEnabled: false });
  v.mcpClient.initialize = async () => {};
  v.on('error', () => {});
  v.start('fake-key');
  const calls = [];
  v.ai = { models: { generateContentStream: async (req) => { calls.push(JSON.parse(JSON.stringify(req))); return (async function* () { yield { text: 'ok' }; })(); } } };

  await v.send('what is on my screen?', [IMG]);
  const first = calls[0].contents.at(-1);
  assert.deepStrictEqual(first.parts, [{ inlineData: IMG }, { text: 'what is on my screen?' }]);
  assert.match(calls[0].config.systemInstruction, /attach a screenshot/);
  assert.strictEqual(v.history[0].text, 'what is on my screen?\n[📎 1 image attached]');

  for (let i = 0; i < 3; i++) await v.send(`more ${i}`, [IMG]);
  const userTurns = calls.at(-1).contents.filter(c => c.role === 'user');
  assert.strictEqual(userTurns.filter(c => c.parts.some(p => p.inlineData)).length, 3);
  assert.match(userTurns[0].parts[0].text, /shared earlier/);
});

test('Claude: image content blocks before the text, in the stream-json message', () => {
  const ClaudeSession = require(path.join(REPO, 'sessions/claude-session.js'));
  const c = new ClaudeSession();
  const lines = [];
  c.process = { stdin: { write: (l) => lines.push(JSON.parse(l)) } };
  c.send('', [IMG]);
  assert.deepStrictEqual(lines[0].message.content, [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: IMG.data } },
    { type: 'text', text: 'Take a look at this image.' }
  ]);
  c.send('plain');
  assert.strictEqual(lines[1].message.content, 'plain', 'text-only messages unchanged');
});

test('Codex: images passed as --image files, deleted when the reply ends', () => {
  const CodexSession = require(path.join(REPO, 'sessions/codex-session.js'));
  const c = new CodexSession();
  const args = c.buildArgs('describe', [IMG, { mimeType: 'image/png', data: IMG.data }]);
  const files = args.filter((a, i) => args[i - 1] === '--image');
  assert.strictEqual(files.length, 2);
  assert.ok(files[0].endsWith('.jpg') && files[1].endsWith('.png'));
  assert.ok(files.every(f => fs.existsSync(f)));
  assert.match(args.at(-1), /describe$/);
  c.on('turnComplete', () => {});
  c.handleClose(0);
  return sleep(50).then(() => assert.ok(files.every(f => !fs.existsSync(f)), 'temp images removed'));
});

test('Ollama: images ride on the current user message only', async () => {
  const bodies = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      bodies.push(JSON.parse(body));
      res.end(JSON.stringify({ message: { content: 'a cat' }, done: true }) + '\n');
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  after(() => { server.closeAllConnections(); server.close(); });
  const OllamaSession = require(path.join(REPO, 'sessions/ollama-session.js'));
  const o = new OllamaSession({ name: 'llava', model: 'llava', baseUrl: `http://127.0.0.1:${server.address().port}` });
  o.on('error', (e) => assert.fail(e));
  await o.send('what animal?', [IMG]);
  await o.send('thanks');
  const last = bodies[0].messages.at(-1);
  assert.deepStrictEqual(last, { role: 'user', content: 'what animal?', images: [IMG.data] });
  assert.ok(bodies[1].messages.every(m => !m.images), 'not resent on later turns');
  assert.strictEqual(bodies[1].messages.at(-3).content, 'what animal?\n[📎 1 image attached]');
});

test('chat IPC: images reach the session; providers without image support get a clear error', async () => {
  const charV = await h.launch({ _id: 'V', name: 'Vee', provider: 'vision', theme: 'Moss' });
  const chatV = await h.openChat(charV);
  const char = require(path.join(REPO, 'app/state.js')).characters.find(c => c.agentId === 'V');
  const sent = [];
  char.session.send = (text, images) => sent.push([text, images]);
  await quiet(async () => { h.ipcOn['chat-send']({ sender: chatV.webContents }, '', [IMG]); await sleep(10); });
  assert.deepStrictEqual(sent, [['', [IMG]]]);

  await quiet(async () => { h.ipcOn['chat-send']({ sender: chatV.webContents }, 'x', [{ mimeType: 'image/svg+xml', data: 'AAAA' }]); await sleep(10); });
  assert.strictEqual(sent.length, 1, 'malformed images not sent');
  assert.match(h.sentTo(chatV, 'chat-error').at(-1).args[0], /Couldn't send those images/);

  const charC = await h.launch({ _id: 'C', name: 'Cee', provider: 'copilot', theme: 'Moss' });
  const chatC = await h.openChat(charC);
  await quiet(async () => { h.ipcOn['chat-send']({ sender: chatC.webContents }, 'look', [IMG]); await sleep(10); });
  assert.match(h.sentTo(chatC, 'chat-error').at(-1).args[0], /Copilot can't read images/);

  char.stopThinking(); // the stubbed send never finishes the turn

  const providers = await h.ipcHandle['get-providers']({});
  assert.deepStrictEqual(providers.filter(p => p.supportsImages).map(p => p.key), ['vision', 'claude', 'codex']);
});
