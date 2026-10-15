// Per-provider API keys: storage, migration of the old single key, CLI env injection.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { REPO, POSIX_ONLY, useTempHome, stubElectron, fakeCli, waitFor, recordEvents } = require('./helpers');

// An existing install with only the old "global" key
const home = useTempHome({ apiKey: 'gem-old', theme: 'Moss' });
stubElectron({}); // no safeStorage here: keys are stored as given (see secrets.test.js)
for (const v of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY']) delete process.env[v];
fakeCli('codex', 'echo "openai=${OPENAI_API_KEY:-none} anthropic=${ANTHROPIC_API_KEY:-none} gemini=${GEMINI_API_KEY:-none}"');

const s = require(path.join(REPO, 'sessions/agent-session.js'));
const settingsFile = () => JSON.parse(fs.readFileSync(path.join(home, '.desktop-assistant-settings.json'), 'utf8'));

test('the old global key becomes the Gemini key', () => {
  assert.strictEqual(s.getProviderApiKey('gemini'), 'gem-old');
  assert.strictEqual(s.getApiKey(), 'gem-old');
  assert.strictEqual(s.getProviderApiKey('claude'), '');
});

test('keys are stored per provider; other settings untouched', () => {
  s.setProviderApiKey('claude', 'sk-ant-123');
  s.setProviderApiKey('codex', 'sk-openai-456');
  s.setProviderApiKey('copilot', 'ghp_789');
  assert.deepStrictEqual(s.getAllProviderApiKeys(), { gemini: 'gem-old', claude: 'sk-ant-123', codex: 'sk-openai-456', copilot: 'ghp_789' });
  assert.strictEqual(settingsFile().apiKey, 'gem-old', 'Gemini key keeps its original field');
  assert.strictEqual(settingsFile().theme, 'Moss');
  s.setProviderApiKey('gemini', 'gem-new');
  assert.strictEqual(s.getApiKey(), 'gem-new');
  assert.throws(() => s.setProviderApiKey('evil', 'x'), /Unknown API key provider/);
});

test('each CLI env gets only its own key; empty key sets nothing', () => {
  assert.strictEqual(s.getProviderEnv('vision').GEMINI_API_KEY, 'gem-new');
  assert.deepStrictEqual(s.getProviderEnv('claude'), { ANTHROPIC_API_KEY: 'sk-ant-123' });
  assert.deepStrictEqual(s.getProviderEnv('copilot'), { GH_TOKEN: 'ghp_789', GITHUB_TOKEN: 'ghp_789' });
  s.setProviderApiKey('claude', '');
  assert.deepStrictEqual(s.getProviderEnv('claude'), {});
});

test('a spawned CLI receives its key and no other provider\'s', { skip: POSIX_ONLY }, async () => {
  const CodexSession = require(path.join(REPO, 'sessions/codex-session.js'));
  const c = new CodexSession();
  const ev = recordEvents(c);
  c.send('hi');
  await waitFor(() => ev.turnComplete === 1);
  assert.strictEqual(ev.text.join('').trim(), 'openai=sk-openai-456 anthropic=none gemini=none');
});
