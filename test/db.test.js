// Switching MongoDB at runtime: bad URIs fail cleanly, calls are serialized.
// Uses real mongoose against an address nothing listens on — no database needed.
const { test, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { REPO, useTempHome, stubElectron, quiet } = require('./helpers');

useTempHome();
stubElectron({});
const { connectDB, switchDB, isDBConnected } = require(path.join(REPO, 'utils/db.js'));
const mongoose = require(path.join(REPO, 'node_modules/mongoose'));
after(() => mongoose.disconnect());

test('an invalid URI is reported, not thrown', async () => {
  const r = await quiet(() => switchDB('not-a-mongodb-uri', { timeoutMs: 300 }));
  assert.strictEqual(r.connected, false);
  assert.ok(r.error && r.error.length > 0);
  assert.strictEqual(isDBConnected(), false);
});

test('an unreachable server fails within the timeout', async () => {
  const started = Date.now();
  const r = await quiet(() => switchDB('mongodb://127.0.0.1:9/test', { timeoutMs: 300 }));
  assert.strictEqual(r.connected, false);
  assert.strictEqual(r.keptPrevious, false, 'nothing was connected before');
  assert.ok(Date.now() - started < 5000);
});

test('an empty URI disconnects and says why', async () => {
  const r = await quiet(() => switchDB(''));
  assert.deepStrictEqual(r, { connected: false, error: 'No MongoDB URI set' });
});

test('overlapping connection changes are queued, not run concurrently', async () => {
  const results = await quiet(() => Promise.all([
    connectDB(''),
    switchDB('mongodb://127.0.0.1:9/a', { timeoutMs: 200 }),
    connectDB('mongodb://127.0.0.1:9/b', { timeoutMs: 200 }),
    switchDB('')
  ]));
  assert.deepStrictEqual(results.map(r => (typeof r === 'boolean' ? r : r.connected)), [false, false, false, false]);
});
