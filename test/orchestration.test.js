// Orchestrator agents: the delegation protocol, the sub-agent runner (concurrency,
// dependencies, shared team memory, failures, cancel, round limit) and the chat wiring.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const EventEmitter = require('events');
const { REPO, useTempHome, quiet, sleep, waitFor } = require('./helpers');
const { createHarness } = require('./main-harness');

useTempHome();
const h = createHarness();

const o = () => require(path.join(REPO, 'sessions/orchestration.js'));
const providers = () => require(path.join(REPO, 'sessions/providers.js'));
const teamMemory = () => require(path.join(REPO, 'sessions/team-memory.js'));
const fence = (name, obj) => `\n\`\`\`${name}\n${JSON.stringify(obj)}\n\`\`\``;

test('load main.js', async () => { await h.load(); });

// ── Protocol ──

test('parseDelegation: valid plans, provider fallback, limits, dependencies', () => {
  const { parseDelegation } = o();
  const opts = { isKnownProvider: (k) => ['vision', 'claude'].includes(k), defaultProvider: 'vision' };
  assert.strictEqual(parseDelegation('Just an answer.', opts), null, 'no block → no delegation');

  const plan = parseDelegation(`On it.${fence('delegate', { tasks: [
    { id: 'r', title: 'Research', instructions: 'Find X', provider: 'claude' },
    { id: 's', instructions: 'Summarise\nmore', provider: 'gpt-9', dependsOn: ['r', 'missing', 's'] }
  ] })}`, opts);
  assert.deepStrictEqual(plan.tasks.map(t => [t.id, t.title, t.provider, t.dependsOn]), [
    ['r', 'Research', 'claude', []],
    ['s', 'Summarise', 'vision', ['r']]  // unknown provider → own; bad deps dropped
  ]);

  const many = parseDelegation(fence('delegate', { tasks: Array.from({ length: 9 }, (_, i) => ({ instructions: `t${i}` })) }), opts);
  assert.strictEqual(many.tasks.length, 6);
  assert.strictEqual(many.truncated, true);

  assert.match(parseDelegation('```delegate\n{not json\n```', opts).error, /valid JSON/);
  assert.match(parseDelegation(fence('delegate', { tasks: [
    { id: 'a', instructions: 'x', dependsOn: ['b'] }, { id: 'b', instructions: 'y', dependsOn: ['a'] }
  ] }), opts).error, /circular/);
  assert.match(parseDelegation(fence('delegate', { tasks: [{ title: 'no instructions' }] }), opts).error, /no usable tasks/);
  assert.strictEqual(parseDelegation(fence('delegate', { tasks: [{ instructions: 'x'.repeat(20000) }] }), opts).tasks[0].instructions.length, 8000);
});

test('memory notes, visible text and the results message', () => {
  const { parseMemoryNotes, stripProtocolBlocks, buildResultsMessage, buildOrchestratorInstructions } = o();
  assert.deepStrictEqual(parseMemoryNotes(`a${fence('remember', { notes: ['likes tea', ' ', 'x'.repeat(900)] })}\n\`\`\`remember\n- plain line\n\`\`\``),
    ['likes tea', `${'x'.repeat(499)}…`, 'plain line']);
  assert.strictEqual(parseMemoryNotes(fence('remember', { notes: Array(30).fill('n') })).length, 10);
  assert.strictEqual(stripProtocolBlocks(`Splitting this.${fence('delegate', { tasks: [] })}`), 'Splitting this.\n\n*📋 Handing this to sub-agents…*');

  const msg = buildResultsMessage([
    { title: 'A', status: 'done', result: 'r'.repeat(10000), providerName: 'Claude' },
    { title: 'B', status: 'failed', error: 'Timed out', result: '' }
  ], ['new fact'], { finalRound: true });
  assert.match(msg, /^\[Sub-agent results — not written by the user\]/);
  assert.ok(msg.length < 4500, 'results are trimmed to a budget');
  assert.match(msg, /## B — FAILED: Timed out/);
  assert.match(msg, /- new fact/);
  assert.match(msg, /Do not delegate again/);

  const prompt = buildOrchestratorInstructions({ providers: providers().listProviders(), memory: '- user likes tea', selfProvider: 'claude' });
  assert.match(prompt, /```delegate/);
  assert.match(prompt, /- claude: Claude/);
  assert.match(prompt, /user likes tea/);
});

test('provider notices (usage limit, quota, sign-in, outage) are told apart from answers', () => {
  const { detectProviderNotice } = o();
  const notices = {
    "You've hit your session limit · resets 8pm (Asia/Kolkata)": 'limit',
    'Claude AI usage limit reached|1760000000': 'limit',
    'Error: 429 Too Many Requests': 'limit',
    'You exceeded your current quota, please check your plan and billing details.': 'limit',
    'Your credit balance is too low to access the Anthropic API.': 'limit',
    'Invalid API key · Please run /login': 'auth',
    'Not logged in. Please run `codex login`.': 'auth',
    'The model is overloaded. Please try again later.': 'unavailable'
  };
  for (const [text, kind] of Object.entries(notices)) assert.strictEqual(detectProviderNotice(text)?.kind, kind, text);
  // Real answers — including ones about rate limits — are not notices
  for (const text of [
    'Steam curls from the cup\njade leaves unfold in silence',
    'Use an API key from your dashboard.',
    `Rate limiting protects an API from overload. ${'A token bucket gives each client N requests per minute and returns 429 Too Many Requests once they run out. '.repeat(4)}`
  ]) assert.strictEqual(detectProviderNotice(text), null, text.slice(0, 40));
});

// ── Runner (fake sessions) ──

class FakeSession extends EventEmitter {
  constructor(key, behave) {
    super();
    this.key = key;
    this.behave = behave;
    this.history = [];
    this.isBusy = false;
    this.terminated = false;
  }
  start() {}
  send(message, images, opts = {}) {
    this.history.push({ role: 'user', text: message, ...(opts.internal ? { internal: true } : {}) });
    this.lastOpts = opts;
    this.isBusy = true;
    this.behave(this, message);
  }
  reply(text, delay = 5) {
    setTimeout(() => {
      if (this.terminated) return;
      this.emit('text', text);
      this.history.push({ role: 'assistant', text });
      this.isBusy = false;
      this.emit('turnComplete');
    }, delay);
  }
  terminate() { this.terminated = true; this.isBusy = false; }
}

let created, running, maxRunning, behaviours;
beforeEach(() => {
  created = []; running = 0; maxRunning = 0;
  behaviours = {};
  providers().createSession = (key) => {
    const s = new FakeSession(key, (self, msg) => {
      running++; maxRunning = Math.max(maxRunning, running);
      const done = () => { running--; };
      self.once('turnComplete', done);
      self.once('error', done);
      const b = behaviours[key] || ((x) => x.reply(`result for: ${msg.slice(0, 20)}`, 20));
      b(self, msg);
    });
    created.push(s);
    return s;
  };
});

function fakeChar(agentId = 'orch-1') {
  const { Orchestrator } = require(path.join(REPO, 'app/orchestrator.js'));
  const sent = [];
  const char = {
    name: 'Boss', agentId, orchestrator: true, toolsEnabled: false,
    session: new FakeSession('vision', (self) => self.reply('Here is the combined answer.')),
    sent,
    sendToChat: (ch, data) => sent.push([ch, data]),
    startThinking() {}, stopThinking() {},
    providerKey: () => 'vision',
    refreshTeamMemory: async () => {}
  };
  char.orchestration = new Orchestrator(char);
  return char;
}

async function delegate(char, tasks, prefix = 'Let me split this.') {
  char.session.history.push({ role: 'user', text: 'do the thing' }, { role: 'assistant', text: `${prefix}${fence('delegate', { tasks })}` });
  await quiet(() => char.orchestration.handleTurn());
}

test('sub-agents: at most 3 at once, dependencies wait, results go back as an internal message', async () => {
  const char = fakeChar();
  await delegate(char, [
    { id: 'a', instructions: 'task a' }, { id: 'b', instructions: 'task b' }, { id: 'c', instructions: 'task c' },
    { id: 'd', instructions: 'task d' }, { id: 'e', instructions: 'task e', dependsOn: ['a', 'b'] }
  ]);
  assert.strictEqual(created.length, 5);
  assert.strictEqual(maxRunning, 3, 'concurrency capped');
  const order = created.map(s => s.history[0].text);
  assert.ok(order.indexOf('task e') > order.indexOf('task a') && order.indexOf('task e') > order.indexOf('task b'));
  const eSession = created.find(s => s.history[0].text === 'task e');
  assert.match(eSession.systemPrompt, /RESULTS FROM EARLIER SUB-TASKS[\s\S]*result for: task a/);
  assert.match(eSession.systemPrompt, /cannot delegate further/);
  assert.ok(created.every(s => s.terminated), 'every sub-agent session is shut down');

  // Results handed back to the orchestrator as an internal message
  const last = char.session.history.filter(m => m.role === 'user').at(-1);
  assert.strictEqual(last.internal, true);
  assert.match(last.text, /## task a — done/);
  assert.ok(char.session.history.some(m => m.role === 'delegation'));

  // Chat cards: one run, ends inactive with every task done
  const updates = char.sent.filter(([ch]) => ch === 'subagents-update').map(([, d]) => d);
  assert.ok(updates.length > 3);
  assert.strictEqual(new Set(updates.map(u => u.runId)).size, 1);
  assert.strictEqual(updates.at(-1).active, false);
  assert.ok(updates.at(-1).tasks.every(t => t.status === 'done'));
});

test('each sub-task is recorded on the Tasks page with its provider, status and result', async () => {
  const char = fakeChar('a'.repeat(24)); // a real (ObjectId-shaped) agent id
  behaviours.codex = (s) => { s.isBusy = false; s.emit('error', 'boom'); };
  await delegate(char, [{ id: 'ok', title: 'Works', instructions: 'fine' }, { id: 'bad', title: 'Breaks', instructions: 'no', provider: 'codex' }]);
  await sleep(20);
  const docs = [...h.db.tasks.values()];
  assert.strictEqual(docs.length, 2);
  const works = docs.find(d => d.title === 'Works');
  assert.deepStrictEqual([works.status, works.provider, works.agentId], ['done', 'vision', 'a'.repeat(24)]);
  assert.ok(works.orchestratorRunId && works.startedAt && works.finishedAt);
  assert.match(works.result, /result for: fine/);
  const breaks = docs.find(d => d.title === 'Breaks');
  assert.deepStrictEqual([breaks.status, breaks.error], ['failed', 'boom']);

  // Left running when the app quit → marked failed at the next start
  const { markInterruptedTasks } = require(path.join(REPO, 'app/orchestrator.js'));
  await markInterruptedTasks();
  const [query, update] = h.db.taskUpdates.at(-1);
  assert.deepStrictEqual(query.status, { $in: ['todo', 'in-progress'] });
  assert.strictEqual(update.status, 'failed');
});

test('team memory is shared: a dependent sub-agent sees notes saved by the one before it', async () => {
  const char = fakeChar('orch-mem');
  behaviours.claude = (s) => s.reply(`Found it.${fence('remember', { notes: ['The API limit is 100/min'] })}`, 10);
  await delegate(char, [
    { id: 'find', instructions: 'find the limit', provider: 'claude' },
    { id: 'use', instructions: 'use the limit', dependsOn: ['find'] }
  ], `Splitting.${fence('remember', { notes: ['User prefers short answers'] })}`);
  const user = created.find(s => s.history[0].text === 'use the limit');
  assert.match(user.systemPrompt, /TEAM MEMORY[\s\S]*The API limit is 100\/min \(from find the limit\)/);
  assert.match(user.systemPrompt, /User prefers short answers/);
  const notes = await teamMemory().listNotes('orch-mem');
  assert.deepStrictEqual(notes.map(n => [n.text, n.author]), [
    ['User prefers short answers', 'orchestrator'],
    ['The API limit is 100/min', 'find the limit']
  ]);
  assert.match(char.session.history.filter(m => m.internal).at(-1).text, /New team memory notes:\n- The API limit is 100\/min/);
});

test('failures: provider errors and no output mark the task failed; the rest still finishes', async () => {
  const char = fakeChar();
  behaviours.codex = (s) => { s.isBusy = false; s.emit('error', 'codex CLI not found'); };
  behaviours.claude = (s) => s.reply('   ');
  await delegate(char, [
    { id: 'x', instructions: 'x', provider: 'codex' },
    { id: 'y', instructions: 'y', provider: 'claude' },
    { id: 'z', instructions: 'z' }
  ]);
  const final = char.sent.filter(([ch]) => ch === 'subagents-update').at(-1)[1];
  assert.deepStrictEqual(final.tasks.map(t => t.status), ['failed', 'failed', 'done']);
  assert.match(final.tasks[0].preview, /codex CLI not found/);
  assert.match(char.session.history.filter(m => m.internal).at(-1).text, /## x — FAILED: codex CLI not found/);
});

test('a sub-agent whose "answer" is a usage-limit notice is marked failed, with the reason', async () => {
  const char = fakeChar();
  behaviours.claude = (s) => s.reply("You've hit your session limit · resets 8pm (Asia/Kolkata)");
  await delegate(char, [{ id: 'h', title: 'Haiku', instructions: 'write a haiku', provider: 'claude' }, { id: 'f', instructions: 'facts' }]);
  const final = char.sent.filter(([ch]) => ch === 'subagents-update').at(-1)[1];
  assert.deepStrictEqual(final.tasks.map(t => t.status), ['failed', 'done']);
  assert.match(final.tasks[0].preview, /Claude: usage limit reached — "You've hit your session limit/);
  const results = char.session.history.filter(m => m.internal).at(-1).text;
  assert.match(results, /## Haiku — FAILED: Claude: usage limit reached/);
  assert.doesNotMatch(results, /## Haiku — done/, 'the notice is not passed off as a result');
});

test('cancel stops running sub-agents; their partial results still reach the orchestrator', async () => {
  const char = fakeChar();
  behaviours.vision = () => {}; // never answers
  const run = delegate(char, [{ id: 'slow', instructions: 'slow one' }, { id: 'later', instructions: 'later', dependsOn: ['slow'] }]);
  await waitFor(() => char.orchestration.isRunning() && created.length === 1);
  created[0].emit('text', 'half done');
  assert.strictEqual(char.orchestration.cancel(), true);
  await run;
  assert.ok(created[0].terminated);
  assert.strictEqual(created.length, 1, 'the dependent task never started');
  const final = char.sent.filter(([ch]) => ch === 'subagents-update').at(-1)[1];
  assert.deepStrictEqual(final.tasks.map(t => [t.status, t.preview]), [['failed', '⚠️ Cancelled'], ['failed', '⚠️ Cancelled']]);
  assert.match(char.session.history.filter(m => m.internal).at(-1).text, /half done/);
});

test('round limit, orchestrator off, bad plans', async () => {
  const char = fakeChar();
  await delegate(char, [{ instructions: 'one' }]);
  await delegate(char, [{ instructions: 'two' }]);
  await delegate(char, [{ instructions: 'three' }]);
  assert.strictEqual(created.length, 2, 'two rounds per user message');
  assert.match(char.sent.filter(([ch]) => ch === 'chat-error').at(-1)[1], /already used 2 times/);
  char.orchestration.onUserMessage();
  await delegate(char, [{ instructions: 'four' }]);
  assert.strictEqual(created.length, 3, 'a new user message resets the limit');

  char.orchestrator = false;
  await delegate(char, [{ instructions: 'five' }]);
  assert.strictEqual(created.length, 3, 'orchestrator off → plans ignored');

  char.orchestrator = true;
  char.orchestration.onUserMessage();
  char.session.history.push({ role: 'user', text: 'q' }, { role: 'assistant', text: '```delegate\n{oops\n```' });
  await quiet(() => char.orchestration.handleTurn());
  assert.match(char.sent.filter(([ch]) => ch === 'chat-error').at(-1)[1], /Couldn't start sub-agents/);
});

// ── App wiring ──

test('chat: messages wait while sub-agents work; cancel IPC; orchestrator prompt; replay hides internal', async () => {
  const charWin = await h.launch({ _id: 'O1', name: 'Olive', provider: 'codex', theme: 'Moss' });
  const chatWin = await h.openChat(charWin);
  const char = require(path.join(REPO, 'app/state.js')).characters.find(c => c.agentId === 'O1');
  assert.match(char.session.systemPrompt, /ORCHESTRATION/);
  assert.match(char.session.systemPrompt, /"provider":"codex"/);

  behaviours.vision = () => {}; // sub-agent never answers until cancelled
  char.session.history.push({ role: 'user', text: 'big job' }, { role: 'assistant', text: `ok${fence('delegate', { tasks: [{ instructions: 'slow' }] })}` });
  const run = quiet(() => char.orchestration.handleTurn());
  await waitFor(() => char.orchestration.isRunning());
  assert.ok(h.sentTo(chatWin, 'subagents-update').length > 0);

  await quiet(async () => { h.ipcOn['chat-send']({ sender: chatWin.webContents }, 'are you done?'); await sleep(10); });
  assert.match(h.sentTo(chatWin, 'chat-error').at(-1).args[0], /still working/);

  char.session.send = (text, images, opts) => char.session.history.push({ role: 'user', text, ...(opts?.internal ? { internal: true } : {}) });
  h.ipcOn['chat-cancel-subagents']({ sender: chatWin.webContents });
  await run;
  assert.strictEqual(char.orchestration.isRunning(), false);
  assert.strictEqual(char.session.history.at(-1).internal, true);
  char.stopThinking(); // the stubbed send never finishes the orchestrator's turn

  // Saved with the internal flag (so replays can hide it)
  await quiet(() => char.saveSessionHistory());
  const saved = [...h.db.chats.values()].find(c => c.agentId === 'O1');
  assert.ok(saved.messages.some(m => m.internal === true && /Sub-agent results/.test(m.text)));
  assert.ok(saved.messages.some(m => m.role === 'delegation'));

  // Agents page: turning it off removes the instructions
  assert.strictEqual(await quiet(() => h.ipcHandle['set-agent-orchestrator']({ sender: chatWin.webContents }, 'O1', false)), false, 'Control Centre only');
});

test('team memory IPC is Control-Centre only and edits the agent prompt live', async () => {
  const cc = await h.openControlCentre();
  const CC = { sender: cc.webContents };
  const char = require(path.join(REPO, 'app/state.js')).characters.find(c => c.agentId === 'O1');
  await teamMemory().addNotes('O1', ['Deploys happen on Fridays']);
  await char.refreshTeamMemory();
  assert.match(char.session.systemPrompt, /Deploys happen on Fridays/);

  assert.deepStrictEqual(await h.ipcHandle['get-team-memory']({ sender: {} }, 'O1'), []);
  const notes = await h.ipcHandle['get-team-memory'](CC, 'O1');
  assert.deepStrictEqual(notes.map(n => n.text), ['Deploys happen on Fridays']);
  assert.strictEqual(await h.ipcHandle['delete-team-memory'](CC, 'O1', notes[0]._id), true);
  await sleep(10);
  assert.doesNotMatch(char.session.systemPrompt, /Fridays/);

  assert.strictEqual(await quiet(() => h.ipcHandle['set-agent-orchestrator'](CC, 'O1', false)), true);
  assert.doesNotMatch(char.session.systemPrompt, /ORCHESTRATION/);
  assert.strictEqual(await quiet(() => h.ipcHandle['set-agent-orchestrator'](CC, 'O1', true)), true);
  assert.match(char.session.systemPrompt, /ORCHESTRATION/);
});
