// safeStorage encryption of secrets at rest (with a fake, reversible safeStorage).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { REPO, useTempHome, stubElectron, quiet } = require('./helpers');

// Settings written by an older version: every secret in plain text
const home = useTempHome({
  apiKey: 'GEMINI-PLAINTEXT-KEY',
  providerApiKeys: { claude: 'ANTHROPIC-PLAINTEXT-KEY' },
  elevenLabsApiKey: 'ELEVEN-PLAINTEXT-KEY',
  mongodbUri: 'mongodb://user:DBPASSWORD@localhost:27017/x',
  mcpServers: { github: { command: 'npx', args: ['-y', 'gh'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_PLAINTEXT' } } },
  theme: 'Moss'
});
const settingsFile = path.join(home, '.desktop-assistant-settings.json');
const raw = () => fs.readFileSync(settingsFile, 'utf8');
const PLAIN = ['GEMINI-PLAINTEXT-KEY', 'ANTHROPIC-PLAINTEXT-KEY', 'ELEVEN-PLAINTEXT-KEY', 'DBPASSWORD', 'ghp_PLAINTEXT'];
const mode = () => fs.statSync(settingsFile).mode & 0o777;
const POSIX_MODES = process.platform === 'win32' ? 'POSIX file modes' : false;

let ready = false;
let keyringAvailable = true;
stubElectron({
  app: { isReady: () => ready },
  safeStorage: {
    isEncryptionAvailable: () => ready && keyringAvailable,
    encryptString: (s) => Buffer.from('X' + Buffer.from(s).toString('hex')),
    decryptString: (b) => {
      const t = b.toString();
      if (t[0] !== 'X') throw new Error('bad');
      return Buffer.from(t.slice(1), 'hex').toString();
    },
    getSelectedStorageBackend: () => 'kwallet6'
  }
});

const s = require(path.join(REPO, 'sessions/agent-session.js'));
const secrets = require(path.join(REPO, 'utils/secret-store.js'));

test('before app ready, legacy plain-text keys are still readable', () => {
  assert.strictEqual(s.getApiKey(), 'GEMINI-PLAINTEXT-KEY');
  assert.ok(s.getMongodbUri().includes('DBPASSWORD'));
});

test('after ready, migration encrypts every secret in the file', () => {
  ready = true;
  assert.strictEqual(s.migrateSecrets(), 5);
  assert.strictEqual(s.migrateSecrets(), 0, 'idempotent');
  for (const p of PLAIN) assert.ok(!raw().includes(p), `${p} left in plain text`);
  assert.strictEqual((raw().match(/"enc:v1:/g) || []).length, 5);
  assert.strictEqual(JSON.parse(raw()).theme, 'Moss');
});

test('settings file is owner-only', { skip: POSIX_MODES }, () => {
  assert.strictEqual(mode(), 0o600);
});

test('secrets decrypt transparently for the app', () => {
  assert.strictEqual(s.getApiKey(), 'GEMINI-PLAINTEXT-KEY');
  assert.strictEqual(s.getProviderApiKey('claude'), 'ANTHROPIC-PLAINTEXT-KEY');
  assert.strictEqual(s.getMcpServers().github.env.GITHUB_PERSONAL_ACCESS_TOKEN, 'ghp_PLAINTEXT');
  assert.strictEqual(s.getProviderEnv('claude').ANTHROPIC_API_KEY, 'ANTHROPIC-PLAINTEXT-KEY');
  s.setProviderApiKey('codex', 'sk-NEW-OPENAI');
  s.setMcpServers({ notion: { command: 'npx', args: [], env: { NOTION_API_KEY: 'ntn_NEWSECRET' } } });
  assert.ok(!raw().includes('sk-NEW-OPENAI') && !raw().includes('ntn_NEWSECRET'));
  assert.strictEqual(s.getProviderApiKey('codex'), 'sk-NEW-OPENAI');
  assert.deepStrictEqual(secrets.status(), { encrypted: true, backend: 'kwallet6', platform: process.platform });
});

test('hosted MCP server headers (tokens) are encrypted too', () => {
  s.setMcpServers({ gh: { type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ghp_HEADERSECRET' }, env: {} } });
  assert.ok(!raw().includes('ghp_HEADERSECRET'), 'header value stored encrypted');
  assert.ok(raw().includes('https://api.githubcopilot.com/mcp/'), 'URL is not a secret');
  assert.strictEqual(s.getMcpServers().gh.headers.Authorization, 'Bearer ghp_HEADERSECRET');
});

test('no keychain: encrypted values read as empty; new values fall back to plain text', async () => {
  keyringAvailable = false;
  assert.strictEqual(s.getApiKey(), '');
  assert.strictEqual(s.getProviderEnv('claude').ANTHROPIC_API_KEY, undefined);
  await quiet(() => s.setProviderApiKey('copilot', 'ghp_FALLBACK'));
  assert.ok(raw().includes('ghp_FALLBACK'));
  assert.strictEqual(secrets.status().encrypted, false);
  keyringAvailable = true;
  assert.strictEqual(await quiet(() => s.migrateSecrets()), 1);
  assert.ok(!raw().includes('ghp_FALLBACK'));
});

test('corrupt ciphertext reads as empty instead of crashing', async () => {
  assert.strictEqual(await quiet(() => secrets.reveal('enc:v1:' + Buffer.from('garbage').toString('base64'))), '');
});
