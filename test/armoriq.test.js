// ArmorIQ guard configuration: where the key comes from, and the Settings
// "Test connection" check against a fake ArmorIQ backend.
const { test, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { REPO, useTempHome, stubElectron } = require('./helpers');

const home = useTempHome();
stubElectron({});
delete process.env.ARMORIQ_API_KEY;

// Fake backend: GET /mcp/my-servers answers by key
const server = http.createServer((req, res) => {
  const key = req.headers['x-api-key'];
  if (req.url !== '/mcp/my-servers') { res.statusCode = 404; return res.end(); }
  if (key === 'good-key') { res.end('[]'); return; }
  if (key === 'broken-backend') { res.statusCode = 503; return res.end(); }
  res.statusCode = 401;
  res.end('{"error":"invalid api key"}');
});
let backend;
const ready = new Promise(r => server.listen(0, '127.0.0.1', () => { backend = `http://127.0.0.1:${server.address().port}`; r(); }));
after(() => server.close());

const writeOpenclaw = (config) => {
  fs.mkdirSync(path.join(home, '.openclaw'), { recursive: true });
  fs.writeFileSync(path.join(home, '.openclaw', 'openclaw.json'), JSON.stringify({ plugins: { entries: { armorclaw: { config } } } }));
};

const settings = require(path.join(REPO, 'sessions/agent-session.js'));
const { loadArmorIQConfig, testArmorIQConnection } = require(path.join(REPO, 'sessions/armoriq-guard.js'));

test('key priority: env > Settings > legacy openclaw.json', async () => {
  await ready;
  assert.strictEqual(loadArmorIQConfig().apiKey, undefined, 'no key anywhere');

  writeOpenclaw({ apiKey: 'old-openclaw-key', backendEndpoint: backend });
  assert.deepStrictEqual([loadArmorIQConfig().apiKey, loadArmorIQConfig().keySource], ['old-openclaw-key', 'openclaw']);

  settings.setArmorIQApiKey('settings-key');
  assert.deepStrictEqual([loadArmorIQConfig().apiKey, loadArmorIQConfig().keySource], ['settings-key', 'settings']);

  process.env.ARMORIQ_API_KEY = 'env-key';
  assert.deepStrictEqual([loadArmorIQConfig().apiKey, loadArmorIQConfig().keySource], ['env-key', 'env']);
  delete process.env.ARMORIQ_API_KEY;
});

test('Test connection: accepted, rejected, backend down, unreachable, no key', async () => {
  await ready;
  writeOpenclaw({ backendEndpoint: backend });

  settings.setArmorIQApiKey('good-key');
  assert.strictEqual((await testArmorIQConnection()).state, 'ok');

  settings.setArmorIQApiKey('deleted-key');
  const rejected = await testArmorIQConnection();
  assert.strictEqual(rejected.state, 'invalid');
  assert.match(rejected.message, /key was rejected \(HTTP 401\)/);

  settings.setArmorIQApiKey('broken-backend');
  assert.strictEqual((await testArmorIQConnection()).state, 'unreachable');

  writeOpenclaw({ backendEndpoint: 'http://127.0.0.1:9' });
  settings.setArmorIQApiKey('good-key');
  const down = await testArmorIQConnection({ timeoutMs: 2000 });
  assert.strictEqual(down.state, 'unreachable');
  assert.match(down.message, /Couldn't reach/);

  settings.setArmorIQApiKey('');
  writeOpenclaw({});
  assert.strictEqual((await testArmorIQConnection()).state, 'off');
});
