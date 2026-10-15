// External MCP servers are shared across agents (one process per config) and stopped
// only when the last agent using them shuts down.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { REPO, useTempHome, stubElectron, quiet, sleep } = require('./helpers');

useTempHome();
stubElectron({ shell: {}, clipboard: {}, Notification: class {}, dialog: {} });
delete process.env.ARMORIQ_API_KEY;
const McpClientManager = require(path.join(REPO, 'sessions/mcp-client.js'));

// Fake server starter: counts starts and closes instead of spawning processes
let starts, closes, failNext, startDelay;
beforeEach(() => {
  starts = []; closes = []; failNext = false; startDelay = 0;
  McpClientManager._serverPool.clear();
  McpClientManager.openExternalServer = async (name, config) => {
    starts.push(name);
    if (startDelay) await sleep(startDelay);
    if (failNext) { failNext = false; throw new Error('spawn failed'); }
    return {
      tools: [{ name: `${name}_tool`, inputSchema: { type: 'object' } }],
      client: { close: async () => closes.push(name) },
      transport: { close: async () => {} }
    };
  };
});

const github = { github: { command: 'npx', args: ['-y', 'gh'], env: { TOKEN: 'x' } } };
const init = async (configs) => { const m = new McpClientManager(); await quiet(() => m.initialize(configs)); return m; };

test('two agents with the same server share one process', async () => {
  const a = await init(github);
  const b = await init(github);
  assert.deepStrictEqual(starts, ['github'], 'started once');
  assert.ok(a.getAllFunctionDeclarations().some(d => d.name === 'github_tool'));
  assert.ok(b.getAllFunctionDeclarations().some(d => d.name === 'github_tool'));

  await quiet(() => a.shutdown());
  assert.deepStrictEqual(closes, [], 'still used by the other agent');
  await quiet(() => b.shutdown());
  assert.deepStrictEqual(closes, ['github'], 'stopped when the last agent shut down');
});

test('a changed config (e.g. new token) starts a separate server', async () => {
  const a = await init(github);
  const b = await init({ github: { ...github.github, env: { TOKEN: 'new' } } });
  assert.deepStrictEqual(starts, ['github', 'github']);
  await quiet(() => a.shutdown());
  assert.deepStrictEqual(closes, ['github']);
  await quiet(() => b.shutdown());
});

test('shutting down while a server is still starting releases it', async () => {
  startDelay = 100;
  const m = new McpClientManager();
  const initializing = quiet(() => m.initialize(github));
  await sleep(20);
  await quiet(() => m.shutdown());
  await initializing;
  assert.deepStrictEqual(closes, ['github'], 'no orphaned server process');
  assert.strictEqual(McpClientManager._serverPool.size, 0);
});

test('a server that failed to start is retried by the next agent', async () => {
  failNext = true;
  const a = await init(github);
  assert.strictEqual(a.getAllFunctionDeclarations().some(d => d.name === 'github_tool'), false);
  const b = await init(github);
  assert.ok(b.getAllFunctionDeclarations().some(d => d.name === 'github_tool'));
  assert.deepStrictEqual(starts, ['github', 'github']);
  await quiet(() => b.shutdown());
});
