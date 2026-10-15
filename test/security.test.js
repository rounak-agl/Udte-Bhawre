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

  // A token shaped like the one ArmorIQ's /iap/sdk/token returns
  const signedToken = (overrides = {}) => ({
    tokenId: 'tok-1', planHash: 'abc123', signature: 'sig', expiresAt: Date.now() / 1000 + 300,
    rawToken: { plan: { steps: [{ action: 'read_file' }, { action: 'compose_email' }] } },
    policyValidation: undefined,
    ...overrides
  });
  const useToken = (token) => {
    guard.currentToken = token;
    guard.currentPlan = token.rawToken.plan;
    guard.allowedActions = new Set(token.rawToken.plan.steps.map(s => s.action));
  };
  // Verification is local: the SDK's invoke() (which would run the tool on ArmorIQ's
  // cloud proxy) must never be called
  guard.client = { invoke: async () => { throw new Error('invoke() must not be called'); } };

  useToken(signedToken());
  assert.strictEqual(await outcome('compose_email', { to: 'a@b.c' }), 'allowed', 'tool in the signed plan is allowed');
  assert.strictEqual(await outcome('open_url', { url: 'https://x' }), 'INTENT_DRIFT', 'tool outside the plan is blocked');

  useToken(signedToken({ expiresAt: Date.now() / 1000 - 1 }));
  assert.strictEqual(await outcome('read_file', { filePath: '~/x' }), 'INTENT_DRIFT', 'expired approval');

  useToken(signedToken({ signature: '' }));
  assert.strictEqual(await outcome('read_file', { filePath: '~/x' }), 'VERIFY_UNAVAILABLE', 'unsigned token');

  // Our local allow-set says yes, but ArmorIQ's signed plan doesn't contain the tool
  const tampered = signedToken();
  useToken(tampered);
  guard.allowedActions.add('run_shell_command');
  assert.strictEqual(await outcome('run_shell_command', { command: 'ls' }), 'INTENT_DRIFT', 'checked against the SIGNED plan');

  useToken(signedToken({ policyValidation: { denied_tools: ['compose_email'] } }));
  assert.strictEqual(await outcome('compose_email'), 'POLICY_DENY', "ArmorIQ's server-side policy is honoured");
  useToken(signedToken({ policyValidation: { allowed_tools: ['read_file'] } }));
  assert.strictEqual(await outcome('compose_email'), 'POLICY_DENY');
  assert.strictEqual(await outcome('read_file', { filePath: '~/x' }), 'allowed');

  guard.clearPlan();
  assert.ok(!guard.currentToken && !guard.currentPlan && guard.allowedActions.size === 0 && !guard.planUnreachable);
});

test('ArmorIQ unreachable vs refused: only unreachable may fall back to asking', async () => {
  const { isConnectivityError } = require(path.join(REPO, 'sessions/armoriq-guard.js'));
  assert.ok(isConnectivityError(new Error('Failed to get intent token: Client network socket disconnected before secure TLS connection was established')));
  assert.ok(isConnectivityError(Object.assign(new Error('x'), { code: 'ENOTFOUND' })));
  assert.ok(isConnectivityError({ message: 'Service Unavailable', response: { status: 503 } }));
  assert.ok(!isConnectivityError({ message: 'Unauthorized', response: { status: 401 } }));
  assert.ok(!isConnectivityError(new Error('Plan rejected by policy')));

  const guard = new ArmorIQGuard({ apiKey: 'x' });
  guard.policy = { allow: [], deny: [] };
  guard.enabled = true;
  const outcome = async (tool, args = {}) => {
    try { await quiet(() => guard.onToolExecution(tool, args)); return 'allowed'; } catch (e) { return e.code; }
  };
  const planFails = async (err) => {
    guard.clearPlan();
    guard.client = { capturePlan: () => ({}), getIntentToken: async () => { throw err; } };
    await quiet(() => guard.onLlmInput({ prompt: 'p', tools: [{ name: 'compose_email' }] }));
  };

  await planFails(new Error('Failed to get intent token: Client network socket disconnected before secure TLS connection was established'));
  assert.strictEqual(await outcome('compose_email', { to: 'a@b.c' }), 'GUARD_UNREACHABLE');
  assert.strictEqual(await outcome('run_shell_command', { command: 'sudo rm -rf /' }), 'POLICY_DENY', 'local policy still applies');

  await planFails(Object.assign(new Error('Unauthorized'), { response: { status: 401 } }));
  assert.strictEqual(await outcome('compose_email', { to: 'a@b.c' }), 'NO_INTENT', 'a refusal still blocks');
});

test('fallback: unverifiable tools ask once; yes runs it, no blocks it', async () => {
  const McpClientManager = require(path.join(REPO, 'sessions/mcp-client.js'));
  const mc = new McpClientManager();
  const events = [];
  mc.on('security:enforcement-block', b => events.push(['block', b.kind]));
  mc.on('security:fallback-approved', b => events.push(['approved', b.tool]));
  mc.guard = {
    enabled: true,
    _log() {},
    hooks: { onToolExecution: async () => { throw Object.assign(new Error('ArmorIQ is unreachable'), { code: 'GUARD_UNREACHABLE' }); } }
  };

  // Approved: runs, and a tool that normally asks (shell) does NOT ask a second time
  const prompts = [];
  mc.setApprovalFunction(async (msg) => { prompts.push(msg); return true; });
  const ran = await quiet(() => mc.executeToolCall('run_shell_command', { command: 'echo fallback-ok' }));
  assert.strictEqual(prompts.length, 1, 'one prompt, not two');
  assert.match(prompts[0], /ArmorIQ couldn't be reached/);
  assert.match(prompts[0], /echo fallback-ok/, 'the prompt shows what will run');
  assert.strictEqual(ran.success, true);
  assert.match(ran.stdout, /fallback-ok/);

  // Declined: not run, reported as declined
  mc.setApprovalFunction(async () => false);
  const declined = await quiet(() => mc.executeToolCall('run_shell_command', { command: 'echo should-not-run' }));
  assert.ok(declined.securityBlock && !declined.stdout);

  // No way to ask: stays blocked (fail-closed)
  mc.setApprovalFunction(null);
  const noPrompt = await quiet(() => mc.executeToolCall('get_current_time', {}));
  assert.ok(noPrompt.securityBlock);

  assert.deepStrictEqual(events, [['approved', 'run_shell_command'], ['block', 'declined'], ['block', 'declined']]);
});

test('blocks are reported with their real cause (policy / drift / unverified)', async () => {
  const McpClientManager = require(path.join(REPO, 'sessions/mcp-client.js'));
  const blocks = [];
  const mc = new McpClientManager();
  mc.on('security:enforcement-block', b => blocks.push(b));
  const failWith = (code, message, rule) => {
    mc.guard = { enabled: true, hooks: { onToolExecution: async () => { throw Object.assign(new Error(message), { code, rule }); } } };
  };
  failWith('NO_INTENT', 'No sealed intent plan for this turn (fail-closed)');
  const r1 = await quiet(() => mc.executeToolCall('compose_email', {}));
  failWith('POLICY_DENY', 'x', 'Security Block: Prohibited pattern "sudo" detected in arguments.');
  const r2 = await quiet(() => mc.executeToolCall('run_shell_command', { command: 'sudo ls' }));
  failWith('INTENT_DRIFT', 'Intent drift: "open_url" not in approved plan');
  await quiet(() => mc.executeToolCall('open_url', {}));

  assert.deepStrictEqual(blocks.map(b => b.kind), ['unverified', 'policy', 'drift']);
  assert.ok(r1.securityBlock && r2.securityBlock);
  assert.ok(!/deny list/i.test(blocks[0].reason), 'an unreachable ArmorIQ is not reported as a deny-list match');
  assert.match(blocks[1].reason, /Prohibited pattern "sudo"/, 'policy blocks say which rule matched');
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

test('a step outside the plan asks you; allowing it gets a newly signed plan, declining blocks it', async () => {
  const McpClientManager = require(path.join(REPO, 'sessions/mcp-client.js'));
  const mc = new McpClientManager();
  const events = [];
  mc.on('security:enforcement-block', b => events.push(['block', b.kind]));
  mc.on('security:plan-extended', b => events.push(['extended', b.tool]));
  const plan = new Set(['get_me']);
  const extendCalls = [];
  mc.guard = {
    enabled: true,
    _log() {},
    extendPlan: async (tool) => { extendCalls.push(tool.name); plan.add(tool.name); return true; },
    hooks: {
      onToolExecution: async (name) => {
        if (!plan.has(name)) throw Object.assign(new Error(`Intent drift: "${name}" not in approved plan`), { code: 'INTENT_DRIFT' });
        return { allowed: true };
      }
    }
  };
  const prompts = [];
  mc.setApprovalFunction(async (msg) => { prompts.push(msg); return true; });
  const ran = await quiet(() => mc.executeToolCall('get_current_time', {}));
  assert.ok(ran.success !== false && !ran.securityBlock, 'runs after approval');
  assert.deepStrictEqual(extendCalls, ['get_current_time']);
  assert.match(prompts[0], /wasn't in the plan ArmorIQ approved/);
  assert.match(prompts[0], /may be trying to steer it/);
  assert.doesNotMatch(prompts[0], /couldn't be reached/);

  // Declined → blocked as drift, plan untouched
  mc.setApprovalFunction(async () => false);
  const declined = await quiet(() => mc.executeToolCall('get_system_info', {}));
  assert.ok(declined.securityBlock);
  assert.ok(!plan.has('get_system_info'));

  // An expired approval isn't a missing step: no prompt, blocked
  prompts.length = 0;
  mc.setApprovalFunction(async (m) => { prompts.push(m); return true; });
  mc.guard.hooks.onToolExecution = async () => { throw Object.assign(new Error('The approval for this message expired — send it again'), { code: 'INTENT_DRIFT' }); };
  assert.ok((await quiet(() => mc.executeToolCall('get_current_time', {}))).securityBlock);
  assert.strictEqual(prompts.length, 0);

  assert.deepStrictEqual(events, [['extended', 'get_current_time'], ['block', 'drift'], ['block', 'drift']]);
});

test('an unplanned step the request calls for is added without asking — but risky tools still ask', async () => {
  const McpClientManager = require(path.join(REPO, 'sessions/mcp-client.js'));
  const mc = new McpClientManager();
  const events = [];
  mc.on('security:plan-extended', b => events.push([b.tool, b.by]));
  const plan = new Set(['get_me']);
  mc.guard = {
    enabled: true, _log() {},
    extendPlan: async (tool) => { plan.add(tool.name); return true; },
    hooks: { onToolExecution: async (name) => {
      if (!plan.has(name)) throw Object.assign(new Error(`Intent drift: "${name}"`), { code: 'INTENT_DRIFT' });
      return { allowed: true };
    } }
  };
  const reviewed = [];
  mc.setStepReviewer(async (tool) => { reviewed.push(tool.name); return tool.name !== 'open_url'; });
  const prompts = [];
  mc.setApprovalFunction(async (msg) => { prompts.push(msg); return false; });

  // Part of the request: added with no prompt
  const r1 = await quiet(() => mc.executeToolCall('get_current_time', {}));
  assert.ok(!r1.securityBlock && r1.success !== false);
  assert.strictEqual(prompts.length, 0);

  // Part of the request, but a tool that always asks (shell): the user is still asked
  const r2 = await quiet(() => mc.executeToolCall('run_shell_command', { command: 'echo hi' }));
  assert.strictEqual(prompts.length, 1, "the shell tool's own approval prompt still appears");
  assert.doesNotMatch(prompts[0], /wasn't in the plan/);
  assert.ok(r2.success === false || r2.securityBlock || !r2.stdout, 'declined at the tool prompt');

  // Not part of the request: falls back to asking the user (who says no)
  const r3 = await quiet(() => mc.executeToolCall('open_url', { url: 'https://evil.example' }));
  assert.ok(r3.securityBlock);
  assert.match(prompts.at(-1), /wasn't in the plan ArmorIQ approved/);

  assert.deepStrictEqual(reviewed, ['get_current_time', 'run_shell_command', 'open_url']);
  assert.deepStrictEqual(events, [['get_current_time', 'auto'], ['run_shell_command', 'auto']]);
});

test('guard.extendPlan asks ArmorIQ to sign the old plan plus the new step', async () => {
  const guard = new ArmorIQGuard({ apiKey: 'x' });
  guard.policy = { allow: [], deny: [] };
  guard.enabled = true;
  const captured = [];
  guard.client = {
    capturePlan: (llm, prompt, plan) => { captured.push(plan); return { plan }; },
    getIntentToken: async (pc) => ({ tokenId: 't', planHash: 'h', signature: 's', expiresAt: Date.now() / 1000 + 300, rawToken: { plan: pc.plan } })
  };
  await quiet(() => guard.onLlmInput({ prompt: 'make a branch', tools: [{ name: 'get_me', description: 'who' }] }));
  assert.strictEqual(await quiet(() => guard.extendPlan({ name: 'create_branch', description: 'branch' })), true);
  assert.deepStrictEqual(captured.at(-1).steps.map(s => s.action), ['get_me', 'create_branch']);
  assert.strictEqual(captured.at(-1).goal, 'make a branch', 'same goal: the user\'s request');
  const ok = await quiet(() => guard.onToolExecution('create_branch', {}));
  assert.deepStrictEqual(ok, { allowed: true }, 'verified against the newly signed token');
});
