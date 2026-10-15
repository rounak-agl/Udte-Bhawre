// Gemini Vision session: prompt honesty, tools toggle, startup ordering, restored memory.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { REPO, useTempHome, stubElectron, sleep } = require('./helpers');

useTempHome();
stubElectron({ shell: {}, clipboard: {}, Notification: class {}, dialog: {} });
const VisionSession = require(path.join(REPO, 'sessions/vision-session.js'));

/** Fake Gemini client that records each request and streams `reply`. */
function fakeAi(reply = 'ok') {
  const calls = [];
  return {
    calls,
    models: {
      generateContentStream: async (req) => {
        calls.push(JSON.parse(JSON.stringify(req))); // snapshot: the session keeps mutating its history
        return (async function* () { yield { text: reply }; })();
      }
    }
  };
}

test('tools off: no MCP/guard startup, no tools sent, honest prompt, persona included', async () => {
  const v = new VisionSession(null, { toolsEnabled: false });
  v.systemPrompt = 'Speak like a pirate.';
  let initCalled = false;
  v.mcpClient.initialize = async () => { initCalled = true; };
  v.on('error', () => {});
  v.start('fake-key');
  const ai = fakeAi('ahoy');
  v.ai = ai;
  await v.send('hello');
  const { config } = ai.calls[0];
  assert.strictEqual(initCalled, false);
  assert.strictEqual(config.tools, undefined);
  assert.match(config.systemInstruction, /CANNOT see the user's screen/);
  assert.ok(!/BOUNDING BOX/.test(config.systemInstruction));
  assert.ok(config.systemInstruction.includes('Speak like a pirate.'));
  assert.strictEqual(v.history.at(-1).text, 'ahoy');
});

test('send waits for MCP/guard startup before generating', async () => {
  const v = new VisionSession(null, { toolsEnabled: true });
  let initDone = false;
  v.mcpClient.initialize = async () => { await sleep(200); initDone = true; };
  v.mcpClient.getAllFunctionDeclarations = () => [];
  v.on('error', () => {});
  v.start('fake-key');
  let initDoneAtGenerate;
  v.ai = { models: { generateContentStream: async () => { initDoneAtGenerate = initDone; return (async function* () { yield { text: 'ok' }; })(); } } };
  await v.send('right away');
  assert.strictEqual(initDoneAtGenerate, true);
});

test('restored conversation becomes model context (alternating, user first)', async () => {
  const v = new VisionSession(null, { toolsEnabled: false });
  v.mcpClient.initialize = async () => {};
  v.on('error', () => {});
  v.restoreContext([
    { role: 'assistant', text: 'orphan reply' },
    { role: 'user', text: 'My name is Shaan.' },
    { role: 'user', text: 'I like tea.' },
    { role: 'toolUse', text: 'x' },
    { role: 'assistant', text: 'Noted.' }
  ]);
  v.start('fake-key');
  const ai = fakeAi();
  v.ai = ai;
  await v.send('What do I like?');
  const contents = ai.calls[0].contents;
  assert.deepStrictEqual(contents.map(c => c.role), ['user', 'model', 'user']);
  assert.strictEqual(contents[0].parts[0].text, 'My name is Shaan.\n\nI like tea.');
});
