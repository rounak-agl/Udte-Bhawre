// Edge cases in the crew UI store (ui/src/sim/store.ts): duplicate sends, the queue,
// stale backend events, double approvals, corrupt saved history and a stalled turn.
// The store is TypeScript, so it is bundled with the ui's own rolldown before import.
const { test, before, beforeEach, mock } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { tempDir } = require('./helpers');

const UI = path.resolve(__dirname, '..', 'ui');
const ROLLDOWN = path.join(UI, 'node_modules', 'rolldown', 'dist', 'index.mjs');
const skip = fs.existsSync(ROLLDOWN) ? false : 'needs ui dependencies (npm --prefix ui ci)';

const sent = [];
const stopped = [];
const decided = [];
const mem = new Map();
let sim;
let loadHistory;

before(async () => {
  if (skip) return;
  globalThis.window = globalThis;
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k)
  };
  globalThis.crewBridge = {
    chatSend: (id, text) => sent.push({ id, text }),
    stop: (id) => stopped.push(id),
    decide: (planId, ok) => decided.push({ planId, ok })
  };
  const dir = tempDir('store');
  const src = (f) => path.join(UI, 'src', 'sim', f).replace(/\\/g, '/');
  const entry = path.join(dir, 'entry.ts');
  fs.writeFileSync(entry, `export { sim } from "${src('store.ts')}";\nexport { loadHistory } from "${src('history.ts')}";\n`);
  const { rolldown } = await import(pathToFileURL(ROLLDOWN).href);
  const bundle = await rolldown({ input: entry, platform: 'node', logLevel: 'silent' });
  const out = path.join(dir, 'store.mjs');
  await bundle.write({ file: out, format: 'esm' });
  ({ sim, loadHistory } = await import(pathToFileURL(out).href));
});

beforeEach(() => {
  if (skip) return;
  sent.length = 0;
  stopped.length = 0;
  decided.length = 0;
  mem.clear();
  sim.reset();
  sim.setLive(true);
});

const crew = (id) => sim.snapshot().crew[id];
const finish = (id) => sim.backend({ id, channel: 'chat-turn-complete', args: [] });

test('the same message sent twice in a row goes out once', { skip }, () => {
  sim.send('bo', 'Sort my downloads');
  sim.send('bo', 'Sort my downloads');
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(crew('bo').msgs.filter((m) => m.kind === 'user').length, 1);
});

test('whitespace-only sends are ignored', { skip }, () => {
  sim.send('bo', '   \n ');
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(crew('bo').msgs.length, 0);
});

test('a message sent while busy is queued, then sent when the turn ends', { skip }, () => {
  sim.send('bo', 'first');
  sim.send('bo', 'second');
  assert.deepStrictEqual(crew('bo').queued, ['second']);
  finish('bo');
  assert.deepStrictEqual(sent.map((s) => s.text), ['first', 'second']);
  assert.deepStrictEqual(crew('bo').queued, []);
  assert.strictEqual(crew('bo').busy, true);
});

test('stop drops the queue and ignores late stream events', { skip }, () => {
  sim.send('bo', 'first');
  sim.send('bo', 'second');
  sim.stop('bo');
  sim.backend({ id: 'bo', channel: 'chat-text', args: ['late words'] });
  finish('bo');
  assert.deepStrictEqual(stopped, ['bo']);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(crew('bo').msgs.some((m) => m.kind === 'text'), false);
  assert.strictEqual(crew('bo').jobs, 0);
});

test('a plan can only be decided once', { skip }, () => {
  sim.send('bo', 'Email the team');
  sim.backend({ id: 'bo', channel: 'crew-approval', args: [{ planId: 'ap1', message: 'Send 3 emails' }] });
  sim.decide('bo', 'ap1', true);
  sim.decide('bo', 'ap1', true);
  sim.decide('bo', 'missing', true);
  assert.deepStrictEqual(decided, [{ planId: 'ap1', ok: true }]);
});

test('an approval that times out in the backend is shown as skipped', { skip }, () => {
  sim.send('bo', 'Email the team');
  sim.backend({ id: 'bo', channel: 'crew-approval', args: [{ planId: 'ap2', message: 'Send 3 emails' }] });
  sim.backend({ id: 'bo', channel: 'crew-approval-expired', args: [{ planId: 'ap2' }] });
  const plan = crew('bo').msgs.find((m) => m.id === 'ap2');
  assert.strictEqual(plan.status, 'denied');
  assert.strictEqual(crew('bo').waiting, false);
  sim.decide('bo', 'ap2', true);
  assert.strictEqual(decided.length, 0);
});

test('a busy backend keeps the crew busy instead of ending the turn', { skip }, () => {
  sim.send('bo', 'again');
  sim.backend({ id: 'bo', channel: 'chat-busy', args: ['Still working'] });
  assert.strictEqual(crew('bo').busy, true);
  assert.strictEqual(crew('bo').msgs.at(-1).kind, 'error');
});

test('retry resends the last ask, not a placeholder', { skip }, () => {
  sim.send('pim', 'Find flights to Goa');
  sim.backend({ id: 'pim', channel: 'chat-error', args: ['Network down'] });
  finish('pim');
  sim.retry('pim');
  assert.deepStrictEqual(sent.map((s) => s.text), ['Find flights to Goa', 'Find flights to Goa']);
});

test('a turn with no reply for 3 minutes is stopped with an error', { skip }, () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    sim.send('zip', 'Research this');
    sim.backend({ id: 'zip', channel: 'chat-text', args: ['Looking'] });
    mock.timers.tick(179_000);
    assert.strictEqual(crew('zip').busy, true);
    mock.timers.tick(2_000);
    assert.strictEqual(crew('zip').busy, false);
    assert.strictEqual(crew('zip').state, 'oops');
    assert.deepStrictEqual(stopped, ['zip']);
    assert.strictEqual(crew('zip').msgs.at(-1).title, 'No reply for 3 minutes');
  } finally {
    mock.timers.reset();
  }
});

test('restore keeps good threads and drops corrupt entries', { skip }, () => {
  sim.restore({
    bo: { msgs: [{ kind: 'user', id: 'a', text: 'hi' }, { kind: 'nope', id: 'b' }, null, { kind: 'text', id: 'a', text: 'dup' }, { kind: 'text', id: 'c' }], updated: 'soon' },
    pim: { msgs: 'not a list' },
    nobody: { msgs: [] }
  });
  assert.deepStrictEqual(crew('bo').msgs.map((m) => m.id), ['a']);
  assert.strictEqual(crew('bo').updated, 0);
  assert.deepStrictEqual(crew('pim').msgs, []);
  sim.restore(null);
  sim.restore('garbage');
  assert.strictEqual(crew('bo').msgs.length, 1);
});

test('unreadable saved history is set aside, not thrown', { skip }, () => {
  mem.set('crew.history.v1', '{"bo": [broken');
  assert.doesNotThrow(() => loadHistory());
  assert.strictEqual(mem.has('crew.history.v1'), false);
  assert.strictEqual(mem.get('crew.history.broken'), '{"bo": [broken');
});

test('unknown crew ids are ignored', { skip }, () => {
  assert.doesNotThrow(() => {
    sim.send('ghost', 'hello');
    sim.stop('ghost');
    sim.retry('ghost');
    sim.decide('ghost', 'ap1', true);
    sim.backend({ id: 'ghost', channel: 'chat-text', args: ['x'] });
  });
  assert.strictEqual(sent.length, 0);
});
