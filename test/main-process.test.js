// End-to-end main-process behaviour (real main.js, stubbed windows + in-memory DB):
// agent memory, per-agent tools, deleting chats/agents, security-event routing,
// agent validation and custom-model management.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { REPO, POSIX_ONLY, useTempHome, fakeCli, quiet, sleep } = require('./helpers');
const { createHarness } = require('./main-harness');

useTempHome();
// Fake codex records the full prompt it was given (so we can see what the model "remembers")
const promptLog = path.join(fakeCli('codex', ''), 'last-prompt.txt');
fs.writeFileSync(path.join(path.dirname(promptLog), 'codex'), `#!/bin/sh\nprintf "%s" "$2" > "${promptLog}"\necho ok\n`, { mode: 0o755 });
const lastPrompt = () => fs.readFileSync(promptLog, 'utf8');

const h = createHarness();
let cc;
const CC = () => ({ sender: cc.webContents });

test('load main.js', async () => {
  await h.load();
  cc = await h.openControlCentre();
});

test('memory: restored after restart, kept across close/reopen and settings changes', { skip: POSIX_ONLY }, async () => {
  // A conversation saved by a previous run of the app
  h.db.chats.set('cs-old', {
    _id: 'cs-old', agentId: 'agentA', title: 'old', updatedAt: new Date(),
    messages: [{ role: 'user', text: 'My name is Shaan.' }, { role: 'assistant', text: 'Nice to meet you, Shaan!' }]
  });
  const charA = await h.launch({ _id: 'agentA', name: 'Buddy', provider: 'codex', theme: 'Midnight' });

  const chat1 = await h.openChat(charA);
  assert.deepStrictEqual(h.sentTo(chat1, 'chat-history')[0].args[0].map(m => m.text), ['My name is Shaan.', 'Nice to meet you, Shaan!']);
  assert.strictEqual(h.sentTo(chat1, 'provider-change').length, 0, 'opening a chat is not a "switch"');
  const init = h.sentTo(chat1, 'chat-init')[0].args[0];
  assert.strictEqual(init.provider, 'codex');
  assert.ok(init.providers.some(p => p.key === 'vision'), 'chat gets the provider list');

  await h.chat(chat1, 'What is my name?');
  assert.ok(lastPrompt().includes('User: My name is Shaan.'));
  assert.strictEqual(h.db.chats.size, 1);
  assert.strictEqual(h.db.chats.get('cs-old').messages.length, 4, 'saved into the same conversation');

  chat1.destroy();
  const chat2 = await h.openChat(charA);
  assert.strictEqual(h.sentTo(chat2, 'chat-history')[0].args[0].length, 4);

  await quiet(async () => { h.ipcOn['chat-set-tools']({ sender: chat2.webContents }, false); await sleep(20); });
  assert.strictEqual(h.sentTo(chat2, 'tools-change').at(-1).args[0], false);
  assert.ok(h.db.agentUpdates.some(([id, u]) => id === 'agentA' && u.toolsEnabled === false));
  await h.chat(chat2, 'Still there?');
  assert.ok(lastPrompt().includes('My name is Shaan.'), 'conversation carried over the restart');
  assert.strictEqual(h.db.chats.get('cs-old').messages.length, 6);

  // Deleting the conversation from the Control Centre makes the agent forget it
  assert.strictEqual(await quiet(() => h.ipcHandle['delete-chat-session']({ sender: chat2.webContents }, 'cs-old')), false, 'refused from a chat window');
  assert.strictEqual(await quiet(() => h.ipcHandle['delete-chat-session'](CC(), 'cs-old')), true);
  assert.strictEqual(h.sentTo(chat2, 'chat-cleared').length, 1);
  await h.chat(chat2, 'Hello after delete');
  assert.ok(!lastPrompt().includes('Shaan'));
  assert.strictEqual(h.db.chats.size, 1);
  assert.ok([...h.db.chats.values()][0].messages.some(m => m.text === 'Hello after delete'), 'new conversation saved');
});

test('agents: only valid, known fields are saved', async () => {
  const save = (cfg) => quiet(() => h.ipcHandle['save-agent'](CC(), cfg));
  assert.strictEqual(await save({ name: ' Buddy ', provider: 'claude', theme: 'Moss', contextFile: '' }), true);
  assert.deepStrictEqual(h.db.agentsSaved.at(-1), { name: 'Buddy', provider: 'claude', theme: 'Moss', contextFile: '', toolsEnabled: true });
  assert.strictEqual(await save({ name: 'x', provider: 'claude', theme: 'midnight' }), false);
  assert.strictEqual(await save({ name: 'x', provider: 'openai', theme: 'Moss' }), false);
  assert.strictEqual(await save({ name: 'y', provider: 'gemini', theme: 'Cloud' }), true, 'old Gemini CLI key is accepted…');
  assert.strictEqual(h.db.agentsSaved.at(-1).provider, 'vision', '…and saved as Gemini Vision');
  assert.ok(await save({ name: 'z', provider: 'vision', theme: 'Cloud', _id: 'evil' }) && !('_id' in h.db.agentsSaved.at(-1)));
});

test("security banners only reach their own agent's chat", async () => {
  const sessions = [];
  const CodexSession = require(path.join(REPO, 'sessions/codex-session.js'));
  const origStart = CodexSession.prototype.start;
  CodexSession.prototype.start = function () { sessions.push(this); return origStart.call(this); };

  const charX = await h.launch({ _id: 'X', name: 'Ex', provider: 'codex', theme: 'Moss' });
  const charY = await h.launch({ _id: 'Y', name: 'Why', provider: 'codex', theme: 'Moss' });
  const chatX = await h.openChat(charX);
  const sessionX = sessions.at(-1);
  sessionX.emit('security:tool-allowed', { tool: 'read_file' });
  assert.strictEqual(h.sentTo(chatX, 'security-audit-event').length, 0, 'queued until X is ready');

  const chatY = await h.openChat(charY);
  await quiet(() => h.ipcOn['renderer-ready']({ sender: chatY.webContents }));
  assert.strictEqual(h.sentTo(chatY, 'security-audit-event').length, 0, "X's banner never reaches Y");

  await quiet(() => h.ipcOn['renderer-ready']({ sender: chatX.webContents }));
  assert.strictEqual(h.sentTo(chatX, 'security-audit-event')[0].args[0].data.tool, 'read_file');
  sessionX.emit('security:enforcement-block', { tool: 'open_url' });
  assert.strictEqual(h.sentTo(chatX, 'security-audit-event').length, 2);
  assert.strictEqual(h.sentTo(chatY, 'security-audit-event').length, 0);
  CodexSession.prototype.start = origStart;
});

test('deleting an agent removes its chats, unassigns its tasks, closes its windows', async () => {
  const charD = await h.launch({ _id: 'D', name: 'Dee', provider: 'codex', theme: 'Moss' });
  const chatD = await h.openChat(charD);
  h.db.chats.set('cD', { _id: 'cD', agentId: 'D', messages: [], updatedAt: new Date() });
  h.db.chats.set('cKeep', { _id: 'cKeep', agentId: 'other', messages: [], updatedAt: new Date() });
  assert.strictEqual(await quiet(() => h.ipcHandle['delete-agent']({ sender: chatD.webContents }, 'D')), false);
  assert.strictEqual(await quiet(() => h.ipcHandle['delete-agent'](CC(), 'D')), true);
  assert.ok(h.db.agentsDeleted.includes('D'));
  assert.ok(!h.db.chats.has('cD') && h.db.chats.has('cKeep'));
  assert.deepStrictEqual(h.db.taskUpdates.at(-1), [{ agentId: 'D' }, { $unset: { agentId: 1 } }]);
  assert.ok(charD.isDestroyed() && chatD.isDestroyed());
});

test('custom models: Control Centre only; open chats see the new provider list', async () => {
  const charM = await h.launch({ _id: 'M', name: 'Em', provider: 'codex', theme: 'Moss' });
  const chatM = await h.openChat(charM);
  const add = (sender, input) => quiet(() => h.ipcHandle['add-custom-model']({ sender }, input));

  assert.strictEqual((await add(chatM.webContents, { model: 'llama3.2' })).ok, false, 'refused from a chat window');
  const res = await add(cc.webContents, { name: 'Llama', model: 'llama3.2', baseUrl: 'http://localhost:11434' });
  assert.ok(res.ok);
  const key = `ollama:${res.model.id}`;
  const update = h.sentTo(chatM, 'providers-changed').at(-1).args[0];
  assert.ok(update.some(p => p.key === key && p.name === 'Llama'));
  assert.ok((await h.ipcHandle['get-providers']({})).some(p => p.key === key));

  // An agent can use it…
  assert.strictEqual(await quiet(() => h.ipcHandle['save-agent'](CC(), { name: 'Local', provider: key, theme: 'Moss' })), true);
  // …and switching an open chat to it works
  await quiet(async () => { h.ipcOn['chat-set-provider']({ sender: chatM.webContents }, key); await sleep(20); });
  assert.strictEqual(h.sentTo(chatM, 'provider-change').at(-1).args[0], key);

  // Removing it: the agent is told in its chat instead of silently changing model
  assert.strictEqual(await quiet(() => h.ipcHandle['remove-custom-model'](CC(), res.model.id)), true);
  assert.ok(!h.sentTo(chatM, 'providers-changed').at(-1).args[0].some(p => p.key === key));
  await quiet(async () => { h.ipcOn['chat-send']({ sender: chatM.webContents }, 'hi'); await sleep(50); });
  assert.match(h.sentTo(chatM, 'chat-error').at(-1).args[0], /no longer available/);
});

test('each bot has its own provider (Agents page, chat ⚙ menu, tray)', async () => {
  const charP = await h.launch({ _id: 'P', name: 'Pea', provider: 'codex', theme: 'Moss' });
  const charQ = await h.launch({ _id: 'Q', name: 'Queue', provider: 'claude', theme: 'Moss' });
  const chatP = await h.openChat(charP);
  const chatQ = await h.openChat(charQ);
  assert.strictEqual(h.sentTo(chatP, 'chat-init')[0].args[0].provider, 'codex');
  assert.strictEqual(h.sentTo(chatQ, 'chat-init')[0].args[0].provider, 'claude');

  // Agents page → only that bot changes, live, and it's saved on the agent
  const set = (sender, id, key) => quiet(() => h.ipcHandle['set-agent-provider']({ sender }, id, key));
  assert.strictEqual(await set(chatP.webContents, 'P', 'copilot'), false, 'refused from a chat window');
  assert.strictEqual(await set(cc.webContents, 'P', 'nope'), false, 'unknown provider refused');
  assert.strictEqual(await set(cc.webContents, 'P', 'copilot'), true);
  assert.strictEqual(h.sentTo(chatP, 'provider-change').at(-1).args[0], 'copilot');
  assert.strictEqual(h.sentTo(chatQ, 'provider-change').length, 0, 'other bot untouched');
  assert.ok(h.db.agentUpdates.some(([id, u]) => id === 'P' && u.provider === 'copilot'));

  // Changing the default for new agents doesn't touch bots that have their own
  await quiet(async () => { h.ipcOn['set-provider']({ sender: cc.webContents }, 'vision'); await sleep(20); });
  assert.strictEqual(h.sentTo(chatP, 'provider-change').length, 1);
  assert.strictEqual(h.sentTo(chatQ, 'provider-change').length, 0);

  // Tray: one submenu per bot, with that bot's own provider checked
  const template = h.main.trayMenuTemplate();
  const itemFor = (name) => template.find(i => i.label && i.label.startsWith(name));
  const checked = (item) => item.submenu.find(i => i.type === 'radio' && i.checked)?.label;
  assert.strictEqual(checked(itemFor('Pea')), 'Copilot');
  assert.strictEqual(checked(itemFor('Queue')), 'Claude');
  assert.ok(template.some(i => i.label === 'Default provider for new agents'));

  // Picking a provider in a bot's tray submenu switches just that bot
  await quiet(async () => { itemFor('Queue').submenu.find(i => i.label === 'Codex').click(); await sleep(20); });
  assert.strictEqual(h.sentTo(chatQ, 'provider-change').at(-1).args[0], 'codex');
  assert.strictEqual(h.sentTo(chatP, 'provider-change').length, 1);
});

test("ArmorIQ is visible: chat shield badge follows the guard's state", async () => {
  const sessions = [];
  const CodexSession = require(path.join(REPO, 'sessions/codex-session.js'));
  const origStart = CodexSession.prototype.start;
  CodexSession.prototype.start = function () { sessions.push(this); return origStart.call(this); };

  const charG = await h.launch({ _id: 'G', name: 'Gee', provider: 'codex', theme: 'Moss' });
  const chatG = await h.openChat(charG);
  const session = sessions.at(-1);
  const badge = () => h.sentTo(chatG, 'guard-status').at(-1)?.args[0];

  assert.strictEqual(badge() ?? null, null, 'no desktop tools to guard → no badge');
  session.emit('security:intent-failed', { reason: 'socket disconnected', unreachable: true });
  assert.deepStrictEqual(badge(), { state: 'unreachable', reason: 'socket disconnected' });
  session.emit('security:intent-sealed', { authorizedTools: ['compose_email'] });
  assert.strictEqual(badge().state, 'active');
  session.emit('security:intent-failed', { reason: 'Unauthorized', unreachable: false });
  assert.strictEqual(badge().state, 'error');

  // A reopened chat shows the current state straight away
  chatG.destroy();
  const chatG2 = await h.openChat(charG);
  assert.strictEqual(h.sentTo(chatG2, 'chat-init')[0].args[0].guard.state, 'error');
  CodexSession.prototype.start = origStart;
});

test('ArmorIQ key: set from Settings only, applied to guarded chats', async () => {
  assert.strictEqual(await quiet(() => h.ipcHandle['set-armoriq-key']({ sender: {} }, 'k')), false, 'refused outside the Control Centre');
  assert.strictEqual(await quiet(() => h.ipcHandle['get-armoriq-key']({ sender: {} })), '');
  assert.strictEqual(await quiet(() => h.ipcHandle['set-armoriq-key'](CC(), '  ak_new_key  ')), true);
  assert.strictEqual(await quiet(() => h.ipcHandle['get-armoriq-key'](CC())), 'ak_new_key', 'trimmed and stored');
  const sec = await quiet(() => h.ipcHandle['get-security-overview'](CC()));
  assert.strictEqual(sec.guard.active, true);
  assert.match(sec.guard.keySource, /this page/);
  assert.strictEqual(await quiet(() => h.ipcHandle['test-armoriq']({ sender: {} })), null);
});

test('settings overview endpoints are Control Centre only', async () => {
  const sec = await quiet(() => h.ipcHandle['get-security-overview'](CC()));
  assert.ok(Array.isArray(sec.approvalTools) && sec.approvalTools.includes('run_shell_command') && sec.approvalTools.includes('open_url'));
  assert.ok(Array.isArray(sec.policy.deny));
  assert.strictEqual(await quiet(() => h.ipcHandle['get-security-overview']({ sender: {} })), null);
  const info = await h.ipcHandle['get-app-info']();
  assert.strictEqual(info.version, '0.0.0-test');
});
