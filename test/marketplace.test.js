// Connectors → Marketplace: curated catalog, MCP Registry mapping/search, the install
// IPC (config built in the main process, test-started before saving), custom servers,
// config validation and pasted-config parsing.
const { test, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const os = require('os');
const path = require('path');
const { REPO, useTempHome, quiet } = require('./helpers');
const { createHarness } = require('./main-harness');

useTempHome();
const h = createHarness();
let cc;
const CC = () => ({ sender: cc.webContents });
const OTHER = { sender: {} };

const { CATALOG, CATEGORIES, buildConfig, getCatalogEntry } = require(path.join(REPO, 'mcp-servers/catalog.js'));
const { mapRegistryServer, searchRegistry, clearRegistryCache } = require(path.join(REPO, 'sessions/mcp-registry.js'));
const { parsePastedMcpConfig } = require(path.join(REPO, 'renderer/control-centre/pages/connectors/paste-config.js'));

// ── Fake MCP Registry ──
const registry = { servers: [], status: 200, requests: [] };
const server = http.createServer((req, res) => {
  registry.requests.push(req.url);
  const url = new URL(req.url, 'http://x');
  res.statusCode = registry.status;
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/v0.1/servers') {
    const q = (url.searchParams.get('search') || '').toLowerCase();
    const servers = registry.servers.filter(e => e.server.name.toLowerCase().includes(q));
    const page = url.searchParams.get('cursor') ? servers.slice(1) : servers.slice(0, 1);
    return res.end(JSON.stringify({ servers: page, metadata: { nextCursor: url.searchParams.get('cursor') ? null : 'page2' } }));
  }
  res.statusCode = 404;
  res.end('{}');
});
after(() => server.close());

// ── Fake server starts (no processes / network) ──
let starts = [];
let startError = null;
function fakeStarts(McpClientManager) {
  McpClientManager.openExternalServer = async (name, config) => {
    starts.push({ name, config });
    if (startError) throw startError;
    return { tools: [{ name: 'tool_a' }, { name: 'tool_b' }], client: { close: async () => {} }, transport: { close: async () => {} } };
  };
}

const installed = () => require(path.join(REPO, 'sessions/agent-session.js')).getMcpServers();
const invoke = (channel, event, ...args) => quiet(() => h.ipcHandle[channel](event, ...args));

test('load main.js', async () => {
  await h.load();
  cc = await h.openControlCentre();
  fakeStarts(require(path.join(REPO, 'sessions/mcp-client.js')));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  process.env.MCP_REGISTRY_URL = `http://127.0.0.1:${server.address().port}`;
});

// ── Catalog ──

test('catalog entries are well formed and build valid configs', () => {
  const { sanitizeMcpServer } = require(path.join(REPO, 'app/security.js'));
  const ids = new Set();
  for (const e of CATALOG) {
    assert.ok(/^[\w.-]{1,64}$/.test(e.id) && !ids.has(e.id), `id ${e.id}`);
    ids.add(e.id);
    assert.ok(e.name && e.publisher && e.description && e.icon, `${e.id} display fields`);
    assert.ok(CATEGORIES.includes(e.category), `${e.id} category`);
    assert.ok(/^https:\/\//.test(e.homepage), `${e.id} homepage`);
    const keys = new Set(e.fields.map(f => f.key));
    const templates = e.install.type === 'http'
      ? Object.values(e.install.headers)
      : [...e.install.args.flat(), ...Object.values(e.install.env || {})];
    for (const t of templates) {
      for (const [, key] of t.matchAll(/\{([A-Za-z0-9_]+)\}/g)) assert.ok(keys.has(key), `${e.id}: {${key}} has a field`);
    }
    if (e.install.type === 'http') {
      assert.ok(e.install.url.startsWith('https://'), `${e.id} uses https`);
    } else {
      assert.ok(['npx', 'uvx'].includes(e.install.command), `${e.id} command`);
      // Secrets go in env (encrypted at rest), never in args (plain text, visible in ps)
      const secretKeys = e.fields.filter(f => f.secret).map(f => `{${f.key}}`);
      assert.ok(!e.install.args.flat().some(a => secretKeys.some(k => a.includes(k))), `${e.id}: no secrets in args`);
    }
    const values = Object.fromEntries(e.fields.map(f => [f.key, 'v']));
    assert.ok(sanitizeMcpServer(buildConfig(e, values)), `${e.id} builds a valid config`);
  }
  // Ids of the old built-in presets are kept, so their installs show as installed
  for (const id of ['github', 'figma', 'notion', 'photoshop']) assert.ok(getCatalogEntry(id), id);
});

test('buildConfig fills placeholders, drops empty optional values, checks required ones', () => {
  assert.deepStrictEqual(buildConfig(getCatalogEntry('github'), { token: ' abc ' }), {
    type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer abc' }
  });
  assert.deepStrictEqual(buildConfig(getCatalogEntry('huggingface'), {}).headers, {}, 'no dangling "Bearer "');
  assert.deepStrictEqual(buildConfig(getCatalogEntry('git'), {}).args, ['mcp-server-git'], 'optional --repository group dropped');
  assert.deepStrictEqual(buildConfig(getCatalogEntry('git'), { repo: '~/code/x' }).args, ['mcp-server-git', '--repository', `${os.homedir()}/code/x`], '~ expanded');
  assert.deepStrictEqual(buildConfig(getCatalogEntry('filesystem'), {}).args.slice(-1), [os.homedir()], 'default folder');
  assert.strictEqual(buildConfig(getCatalogEntry('gitlab'), { token: 't' }).env.GITLAB_API_URL, 'https://gitlab.com/api/v4');
  assert.deepStrictEqual(buildConfig(getCatalogEntry('figma'), { token: 'a b' }).args, ['-y', 'figma-developer-mcp', '--stdio']);
  assert.throws(() => buildConfig(getCatalogEntry('github'), {}), /required/);
  assert.throws(() => buildConfig(getCatalogEntry('github'), { token: 'a\r\nX-Evil: 1' }), /valid/);
});

// ── Registry ──

const npmEntry = {
  server: {
    name: 'io.github.acme/files', title: 'Acme Files', version: '1.2.0', description: 'Files',
    repository: { url: 'https://github.com/acme/files' },
    packages: [
      { registryType: 'oci', identifier: 'ghcr.io/acme/files' },
      {
        registryType: 'npm', identifier: '@acme/files', version: '1.2.0', transport: { type: 'stdio' },
        packageArguments: [
          { type: 'positional', valueHint: 'dir', isRequired: true, format: 'filepath' },
          { type: 'named', name: 'mode', value: 'fast' },
          { type: 'named', name: '--read-only', format: 'boolean' },
          { type: 'named', name: '--port', default: '8089' }
        ],
        environmentVariables: [{ name: 'ACME_TOKEN', isRequired: true, isSecret: true, description: 'Token' }]
      }
    ]
  },
  _meta: {}
};

test('registry npm / pypi / hosted entries map to installable configs', () => {
  const npm = mapRegistryServer(npmEntry);
  assert.strictEqual(npm.installable, true);
  assert.strictEqual(npm.verified, false);
  assert.strictEqual(npm.name, 'Acme Files');
  assert.deepStrictEqual(npm.install.args, ['-y', '@acme/files@1.2.0', '{a0}', ['--mode', 'fast'], ['--port', '{a3}']]);
  assert.deepStrictEqual(npm.fields.map(f => [f.label, f.required, f.secret]), [['dir', true, false], ['--port', false, false], ['ACME_TOKEN', true, true]]);
  const cfg = buildConfig(npm, { a0: '/data', e0: 'tok' });
  assert.deepStrictEqual(cfg, { command: 'npx', args: ['-y', '@acme/files@1.2.0', '/data', '--mode', 'fast', '--port', '8089'], env: { ACME_TOKEN: 'tok' } });

  const py = mapRegistryServer({ server: { name: 'io.github.a/py', version: '0.3.0', packages: [{ registryType: 'pypi', identifier: 'py-mcp', version: '0.3.0' }] } });
  assert.deepStrictEqual(py.install, { type: 'stdio', runtime: 'python', command: 'uvx', args: ['py-mcp==0.3.0'], env: {} });

  const remote = mapRegistryServer({ server: { name: 'com.example/api', version: '1', remotes: [{ type: 'streamable-http', url: 'https://api.example.com/mcp', headers: [{ name: 'Authorization', value: 'Bearer {api_key}', isRequired: true, isSecret: true }] }] } });
  assert.deepStrictEqual(buildConfig(remote, { h0: 'k' }), { type: 'http', url: 'https://api.example.com/mcp', headers: { Authorization: 'Bearer k' } });

  assert.strictEqual(mapRegistryServer({ server: { name: 'com.notion/mcp', version: '1', remotes: [] } }).name, 'notion', 'generic names use the publisher');

  const oci = mapRegistryServer({ server: { name: 'x/only-docker', version: '1', packages: [{ registryType: 'oci', identifier: 'img' }] } });
  assert.strictEqual(oci.installable, false);
  assert.match(oci.reason, /oci/);
  const templatedUrl = mapRegistryServer({ server: { name: 'x/t', version: '1', remotes: [{ type: 'sse', url: 'https://{tenant}.x.com/sse' }] } });
  assert.strictEqual(templatedUrl.installable, false);
});

test('registry search: results, paging, deleted entries skipped, failures returned as data', async () => {
  registry.servers = [npmEntry, { server: { name: 'io.github.acme/gone', version: '1' }, _meta: { 'io.modelcontextprotocol.registry/official': { status: 'deleted' } } }];
  clearRegistryCache();
  const first = await searchRegistry('acme');
  assert.strictEqual(first.ok, true);
  assert.deepStrictEqual(first.servers.map(s => s.registryName), ['io.github.acme/files']);
  assert.strictEqual(first.nextCursor, 'page2');
  assert.ok(registry.requests.at(-1).includes('version=latest'));
  const second = await searchRegistry('acme', 'page2');
  assert.deepStrictEqual(second.servers, [], 'deleted entry is not shown');
  assert.strictEqual(second.nextCursor, null);

  registry.status = 500;
  clearRegistryCache();
  const failed = await searchRegistry('acme');
  assert.strictEqual(failed.ok, false);
  assert.match(failed.error, /HTTP 500/);
  registry.status = 200;

  const saved = process.env.MCP_REGISTRY_URL;
  process.env.MCP_REGISTRY_URL = 'http://127.0.0.1:1';
  const unreachable = await searchRegistry('x');
  process.env.MCP_REGISTRY_URL = saved;
  assert.deepStrictEqual(unreachable, { ok: false, error: 'The MCP Registry isn\'t reachable. Check your connection.' });
});

// ── Install IPC ──

test('install IPC is Control-Centre only', async () => {
  for (const ch of ['marketplace-catalog', 'marketplace-search', 'marketplace-install', 'mcp-test-server', 'mcp-save-server', 'mcp-uninstall']) {
    const res = await invoke(ch, OTHER, { catalogId: 'deepwiki' });
    assert.ok(!res || res.ok === false, ch);
  }
  assert.deepStrictEqual(starts, []);
  assert.deepStrictEqual(installed(), {});
});

test('catalog install: config built in the main process, test-started, then saved', async () => {
  starts = [];
  const res = await invoke('marketplace-install', CC(), {
    catalogId: 'github',
    values: { token: 'ghp_123' },
    // A renderer can't choose what runs: these are ignored
    command: 'rm', args: ['-rf', '/'], install: { type: 'stdio', command: 'rm' }, config: { command: 'rm' }
  });
  assert.deepStrictEqual(res, { ok: true, id: 'github', tools: ['tool_a', 'tool_b'] });
  assert.strictEqual(starts.length, 1);
  assert.deepStrictEqual(starts[0].config, {
    type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ghp_123' },
    source: 'catalog', catalogId: 'github', displayName: 'GitHub'
  });
  assert.deepStrictEqual(installed().github.headers, { Authorization: 'Bearer ghp_123' });

  const catalog = await invoke('marketplace-catalog', CC());
  assert.strictEqual(catalog.entries.find(e => e.id === 'filesystem').fields[0].default, os.homedir(), '{home} resolved for the UI');
  assert.ok(catalog.entries.every(e => e.verified));
});

test('a server that fails to start is not saved, unless the user chooses "Save anyway"', async () => {
  startError = Object.assign(new Error('Streamable HTTP error: Unauthorized'), { code: 401 });
  const res = await invoke('marketplace-install', CC(), { catalogId: 'apify', values: { token: 'bad' } });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.canForce, true);
  assert.match(res.error, /rejected the credentials/);
  assert.ok(!installed().apify);

  const forced = await invoke('marketplace-install', CC(), { catalogId: 'apify', values: { token: 'bad' }, force: true });
  assert.strictEqual(forced.ok, true);
  assert.ok(installed().apify);
  startError = null;

  assert.deepStrictEqual(await invoke('marketplace-install', CC(), { catalogId: 'apify', values: {} }), { ok: false, error: 'API token is required' });
  assert.deepStrictEqual(await invoke('marketplace-install', CC(), { catalogId: 'nope' }), { ok: false, error: 'Unknown server' });
});

test('registry install uses the entry the main process fetched, under a free id', async () => {
  registry.servers = [{ server: { name: 'io.github.acme/github', version: '2.0.0', remotes: [{ type: 'streamable-http', url: 'https://mcp.acme.dev/mcp' }] } }];
  clearRegistryCache();
  starts = [];
  // Not searched yet: fetched by name + version (fake registry 404s) → clear error
  assert.match((await invoke('marketplace-install', CC(), { registryName: 'io.github.acme/github', version: '2.0.0' })).error, /Couldn't load/);
  await invoke('marketplace-search', CC(), 'acme');
  const res = await invoke('marketplace-install', CC(), { registryName: 'io.github.acme/github', version: '2.0.0', values: {} });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.id, 'github-2', '"github" is taken by the catalog server');
  assert.deepStrictEqual(installed()['github-2'], {
    type: 'http', url: 'https://mcp.acme.dev/mcp', headers: {}, env: {},
    source: 'registry', registryName: 'io.github.acme/github', registryVersion: '2.0.0', displayName: 'github'
  });
  // Reinstalling the same registry server reuses its id
  assert.strictEqual((await invoke('marketplace-install', CC(), { registryName: 'io.github.acme/github', version: '2.0.0', values: {} })).id, 'github-2');
});

test('custom servers: save, rename, test, uninstall', async () => {
  const save = (req) => invoke('mcp-save-server', CC(), req);
  assert.deepStrictEqual(await save({ id: 'mine', config: { command: 'node', args: ['server.js', 'My Folder'], env: { K: 'v' } } }), { ok: true, id: 'mine' });
  assert.deepStrictEqual(installed().mine.args, ['server.js', 'My Folder'], 'an argument with a space stays one argument');
  assert.strictEqual(installed().mine.source, 'custom');
  assert.match((await save({ id: 'web', config: { type: 'http', url: 'http://example.com/mcp' } })).error, /https/);
  assert.strictEqual((await save({ id: 'local', config: { type: 'http', url: 'http://localhost:3000/mcp' } })).ok, true);
  assert.match((await save({ id: 'bad id!', config: { command: 'x' } })).error, /Name/);
  assert.match((await save({ id: 'local', config: { command: 'x' } })).error, /already exists/);

  assert.strictEqual((await save({ id: 'mine2', previousId: 'mine', config: installed().mine })).ok, true);
  assert.ok(!installed().mine && installed().mine2, 'renamed');

  starts = [];
  assert.deepStrictEqual(await invoke('mcp-test-server', CC(), 'mine2'), { ok: true, tools: ['tool_a', 'tool_b'] });
  assert.deepStrictEqual(await invoke('mcp-test-server', CC(), { type: 'http', url: 'file:///etc/passwd' }), { ok: false, error: 'Invalid server settings (hosted servers must use https).' });
  assert.strictEqual(starts.length, 1);

  assert.strictEqual(await invoke('mcp-uninstall', CC(), 'mine2'), true);
  assert.strictEqual(await invoke('mcp-uninstall', CC(), 'mine2'), false);
  assert.ok(!installed().mine2);
});

// ── Validation & errors ──

test('sanitizeMcpServers: hosted servers need https (or localhost), clean headers', () => {
  const { sanitizeMcpServers } = require(path.join(REPO, 'app/security.js'));
  const ok = (cfg) => sanitizeMcpServers({ s: cfg }) !== null;
  assert.ok(ok({ type: 'http', url: 'https://x.dev/mcp', headers: { Authorization: 'Bearer t' } }));
  assert.ok(ok({ type: 'http', url: 'http://127.0.0.1:8080/mcp' }));
  assert.ok(!ok({ type: 'http', url: 'http://evil.com/mcp' }), 'plain http to a remote host');
  assert.ok(!ok({ type: 'http', url: 'file:///etc/passwd' }));
  assert.ok(!ok({ type: 'http', url: 'https://x.dev', headers: { 'Bad Header': 'v' } }));
  assert.ok(!ok({ type: 'http', url: 'https://x.dev', headers: { A: 'v\r\nInjected: 1' } }));
  assert.ok(!ok({ type: 'ws', url: 'wss://x.dev' }));
  // Local servers: unchanged rules; metadata kept only when well formed
  assert.deepStrictEqual(sanitizeMcpServers({ s: { command: ' npx ', args: ['a'], env: { K: 'v' }, source: 'custom', evil: 1, displayName: 'S' } }),
    { s: { command: 'npx', args: ['a'], env: { K: 'v' }, source: 'custom', displayName: 'S' } });
  assert.strictEqual(sanitizeMcpServers({ s: { command: 'npx', source: 'hacker' } }).s.source, undefined);
});

test('start-up errors become actionable messages', () => {
  const { friendlyError } = require(path.join(REPO, 'app/ipc/marketplace.js'));
  const enoent = Object.assign(new Error('spawn uvx ENOENT'), { code: 'ENOENT' });
  assert.match(friendlyError(enoent, { command: 'uvx' }), /Install uv/);
  assert.match(friendlyError(Object.assign(new Error('x'), { code: -32001 }), { command: 'npx' }), /2 minutes/);
  const crashed = Object.assign(new Error('Connection closed'), { serverOutput: 'starting\nError: FIGMA_API_KEY is required' });
  assert.match(friendlyError(crashed, { command: 'npx' }), /FIGMA_API_KEY is required/);
});

test('pasted configs: Claude Desktop, VS Code, bare snippets and README JSON', () => {
  const claude = parsePastedMcpConfig('{"mcpServers":{"gh":{"command":"npx","args":["-y","x"],"env":{"T":"1"}},"web":{"url":"https://a.dev/mcp","headers":{"Authorization":"Bearer t"}}}}');
  assert.deepStrictEqual(claude.servers, [
    { id: 'gh', config: { command: 'npx', args: ['-y', 'x'], env: { T: '1' } } },
    { id: 'web', config: { type: 'http', url: 'https://a.dev/mcp', headers: { Authorization: 'Bearer t' } } }
  ]);
  assert.deepStrictEqual(parsePastedMcpConfig('{"servers":{"v":{"type":"http","url":"https://v.dev"}}}').servers[0].config, { type: 'http', url: 'https://v.dev', headers: {} });
  // Copied without the outer braces, with a trailing comma
  assert.deepStrictEqual(parsePastedMcpConfig('"fs": { "command": "npx", "args": ["-y", "pkg", "/My Docs",] }').servers,
    [{ id: 'fs', config: { command: 'npx', args: ['-y', 'pkg', '/My Docs'], env: {} } }]);
  assert.deepStrictEqual(parsePastedMcpConfig('{"command":"uvx","args":["mcp-server-fetch", 8080]}').servers[0].config.args, ['mcp-server-fetch', '8080']);
  assert.strictEqual(parsePastedMcpConfig('not json').ok, false);
  assert.strictEqual(parsePastedMcpConfig('{"theme":"dark"}').ok, false);
});
