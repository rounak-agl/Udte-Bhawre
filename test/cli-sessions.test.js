// CliSession base class and the Claude / Codex / Copilot providers built on it.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { REPO, POSIX_ONLY, useTempHome, stubElectron, fakeCli, sleep, waitFor, recordEvents } = require('./helpers');

useTempHome();
stubElectron({});

// codex: idles when started with no prompt, otherwise replies after a delay with
// "reply:<prompt>" — slow enough to send a second message while the first runs
fakeCli('codex', 'sleep 0.3\necho "reply:$2"');
// copilot: echoes its arguments
fakeCli('copilot', 'echo "args:$1|$2"');
// claude: long-running stream-json; replies to each stdin line, exits on "die"
fakeCli('claude', `echo '{"type":"system","subtype":"init"}'
while IFS= read -r line; do
  case "$line" in
    *die*) exit 3 ;;
  esac
  echo '{"type":"assistant","message":{"content":[{"type":"text","text":"hi "},{"type":"tool_use","name":"Read","input":{"file_path":"/x"}}]}}'
  echo '{"type":"result","result":"hi there"}'
done`);

const CliSession = require(path.join(REPO, 'sessions/cli-session.js'));
const CodexSession = require(path.join(REPO, 'sessions/codex-session.js'));
const CopilotSession = require(path.join(REPO, 'sessions/copilot-session.js'));
const ClaudeSession = require(path.join(REPO, 'sessions/claude-session.js'));

test('rapid sends: a killed process never leaks into the next turn', { skip: POSIX_ONLY }, async () => {
  const s = new CodexSession();
  const ev = recordEvents(s);
  s.start();
  s.send('one');
  await sleep(50);
  s.send('two');
  await waitFor(() => ev.turnComplete >= 1);
  await sleep(400);
  assert.strictEqual(ev.turnComplete, 1, 'exactly one turnComplete');
  assert.ok(!ev.text.some(t => t.trim() === 'reply:one'), 'killed turn produced no text');
  const replies = s.history.filter(h => h.role === 'assistant');
  assert.strictEqual(replies.length, 1);
  assert.ok(replies[0].text.endsWith('User: two'));
  assert.ok(replies[0].text.includes('User: one'), 'earlier message carried as context');
});

test('per-message CLIs get persona + recent conversation in the prompt', { skip: POSIX_ONLY }, async () => {
  const s = new CodexSession();
  s.systemPrompt = 'You are Pirate Pete.';
  s.history = [{ role: 'user', text: 'My name is Shaan.' }, { role: 'assistant', text: 'Ahoy Shaan!' }];
  const ev = recordEvents(s);
  s.send('What is my name?');
  await waitFor(() => ev.turnComplete === 1);
  const prompt = ev.text.join('');
  assert.ok(prompt.startsWith('reply:You are Pirate Pete.'));
  assert.ok(prompt.includes('User: My name is Shaan.') && prompt.includes('Assistant: Ahoy Shaan!'));
  assert.ok(prompt.trim().endsWith('User: What is my name?'));
});

test('copilot only sends the request (no persona/transcript)', { skip: POSIX_ONLY }, async () => {
  const s = new CopilotSession();
  s.systemPrompt = 'ignored';
  const ev = recordEvents(s);
  s.send('list files');
  await waitFor(() => ev.turnComplete === 1);
  assert.strictEqual(ev.text.join('').trim(), 'args:suggest|list files');
});

test('missing CLI: install hint, no crash', async () => {
  const s = new CliSession({ provider: 'codex', binary: 'definitely-not-installed-xyz', label: 'Nope', installHint: 'Install Nope' });
  const ev = recordEvents(s);
  s.start();
  s.buildArgs = () => [];
  s.send('hi');
  assert.ok(ev.error.length >= 1 && ev.error[0].includes('Nope CLI not found') && ev.error[0].includes('Install Nope'));
  assert.strictEqual(s.isBusy, false);
});

test("a binary that can't be spawned is reported, not thrown", async () => {
  const s = new CodexSession();
  const ev = recordEvents(s);
  s.binaryPath = path.join(REPO, 'does', 'not', 'exist');
  s.send('hi');
  await waitFor(() => ev.error.length > 0);
  assert.match(ev.error[0], /Failed to run Codex/);
});

test('stderr: spinners and noise dropped, errors and rate limits surfaced', () => {
  const s = new CliSession({ provider: 'claude', binary: 'x', label: 'Claude', installHint: '', stderrNoise: ['Thinking'] });
  const ev = recordEvents(s);
  s.handleStderr('⠋⠙⠹ ');
  s.handleStderr('Thinking hard…');
  s.handleStderr('info: generating summary'); // contains "rate" but isn't a rate limit
  assert.deepStrictEqual(ev.error, []);
  s.handleStderr('HTTP 429 Too Many Requests');
  s.handleStderr('Error: auth expired\nstack…');
  assert.match(ev.error[0], /busy or rate-limited/);
  assert.strictEqual(ev.error[1], 'Error: auth expired');
});

test('claude: long-running stream-json session', { skip: POSIX_ONLY }, async () => {
  const s = new ClaudeSession();
  const ev = recordEvents(s);
  s.send('hello'); // starts the process and queues the message
  await waitFor(() => ev.turnComplete === 1);
  assert.strictEqual(ev.sessionReady, 1);
  assert.deepStrictEqual(ev.toolUse.map(([n]) => n), ['Read']);
  assert.deepStrictEqual(s.history.map(h => h.role), ['user', 'toolUse', 'assistant']);
  assert.strictEqual(s.history.at(-1).text, 'hi there');

  s.send('again'); // same process
  await waitFor(() => ev.turnComplete === 2);

  s.send('die'); // process exits mid-turn → user is told, UI released
  await waitFor(() => ev.turnComplete === 3);
  assert.match(ev.error.at(-1), /stopped before finishing/);
  assert.strictEqual(s.isBusy, false);
  s.terminate();
});

test('claude: persona and earlier conversation passed at launch', () => {
  const s = new ClaudeSession();
  s.systemPrompt = 'Be brief.';
  s.history = [{ role: 'user', text: 'I like tea.' }, { role: 'assistant', text: 'Noted.' }];
  const args = s.buildLaunchArgs();
  const extra = args[args.indexOf('--append-system-prompt') + 1];
  assert.ok(extra.includes('Be brief.') && extra.includes('User: I like tea.'));
  assert.ok(!args.includes('--dangerously-skip-permissions'));
});
