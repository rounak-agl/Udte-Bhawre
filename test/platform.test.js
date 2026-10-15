// Multi-monitor geometry, startup bootstrap and ArmorIQ config loading.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { REPO, useTempHome, stubElectron, quiet } = require('./helpers');

const home = useTempHome();
const display = { bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, workArea: { x: 1920, y: 0, width: 2560, height: 1392 } };
stubElectron({ screen: { getPrimaryDisplay: () => display } });

test('taskbar geometry uses absolute coords when the primary display is offset', () => {
  const { getTaskbarGeometry } = require(path.join(REPO, 'utils/taskbar.js'));
  const t = getTaskbarGeometry();
  assert.strictEqual(t.position, 'bottom');
  assert.strictEqual(t.taskbarHeight, 48);
  assert.strictEqual(t.taskbarX, 1920);
  assert.strictEqual(t.walkZone.x, 1920 + Math.round(2560 * 0.15));
});

test('bootstrap never throws or rewrites a foreign OpenClaw config', async () => {
  fs.mkdirSync(path.join(home, '.openclaw'));
  const foreign = JSON.stringify({ plugins: { entries: { other: {} } }, policyStorePath: '/somewhere/else' });
  fs.writeFileSync(path.join(home, '.openclaw', 'openclaw.json'), foreign);
  const { runBootstrap } = require(path.join(REPO, 'sessions/bootstrap.js'));
  await quiet(() => runBootstrap());
  assert.strictEqual(fs.readFileSync(path.join(home, '.openclaw', 'openclaw.json'), 'utf8'), foreign);
});

test('ArmorIQ config: env key works without openclaw.json; endpoint defaults survive', async () => {
  fs.rmSync(path.join(home, '.openclaw'), { recursive: true, force: true });
  process.env.ARMORIQ_API_KEY = 'env-key';
  const { loadArmorIQConfig, ArmorIQGuard } = require(path.join(REPO, 'sessions/armoriq-guard.js'));
  const cfg = await quiet(() => loadArmorIQConfig());
  delete process.env.ARMORIQ_API_KEY;
  assert.strictEqual(cfg.apiKey, 'env-key');
  assert.ok(!('iapEndpoint' in cfg) && !('backendEndpoint' in cfg));
  const guard = new ArmorIQGuard(cfg);
  assert.strictEqual(guard.config.iapEndpoint, 'https://customer-iap.armoriq.ai');
  assert.strictEqual(cfg.policyPath, path.join(REPO, 'armoriq.policy.json'));
});

test('connectDB: reconnects or clears connection on URI update without throw', async () => {
  const { connectDB, isDBConnected } = require(path.join(REPO, 'utils/db.js'));
  assert.strictEqual(await quiet(() => connectDB('')), false);
  assert.strictEqual(isDBConnected(), false);
});

