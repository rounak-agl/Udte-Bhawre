/**
 * Live search of the official MCP Registry (registry.modelcontextprotocol.io) for
 * Control Centre → Connectors → Marketplace. Runs in the main process: the Control
 * Centre's CSP doesn't allow it to reach the network, and installs must be built from
 * data the main process fetched itself, never from what a renderer sends.
 *
 * Registry entries are mapped to the catalog shape (mcp-servers/catalog.js) so the
 * same buildConfig() turns them into a server config. They're marked verified: false.
 */

const REGISTRY_URL = () => (process.env.MCP_REGISTRY_URL || 'https://registry.modelcontextprotocol.io').replace(/\/+$/, '');
const TIMEOUT_MS = 15000; // the registry can take several seconds to search
const CACHE_MS = 10 * 60 * 1000;
const PAGE_SIZE = 30;

const cache = new Map();   // url → { at, value }
const seen = new Map();    // `${name}@${version}` → raw registry server (for install)

async function fetchJson(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const err = new Error(`Registry answered HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const value = await res.json();
  cache.set(url, { at: Date.now(), value });
  return value;
}

function unreachableMessage(err) {
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'The MCP Registry took too long to answer.';
  if (err.status) return `The MCP Registry answered with an error (HTTP ${err.status}).`;
  return 'The MCP Registry isn\'t reachable. Check your connection.';
}

const PLACEHOLDER = /\{[A-Za-z0-9_]+\}/;
const fieldKey = (prefix, i) => `${prefix}${i}`;

/** Fields + env for a package's environment variables. */
function mapEnvironment(pkg, fields) {
  const env = {};
  (pkg.environmentVariables || []).forEach((v, i) => {
    if (!v || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.name || '')) return;
    const key = fieldKey('e', i);
    fields.push({
      key,
      label: v.name,
      description: v.description || '',
      secret: !!v.isSecret,
      required: !!v.isRequired,
      default: typeof v.default === 'string' ? v.default : (typeof v.value === 'string' && !PLACEHOLDER.test(v.value) ? v.value : ''),
      path: v.format === 'filepath'
    });
    env[v.name] = `{${key}}`;
  });
  return env;
}

/** Args for a package's arguments: fixed values stay literal, others become fields. */
function mapArguments(pkg, fields) {
  const args = [];
  (pkg.packageArguments || []).forEach((a, i) => {
    if (!a || typeof a !== 'object') return;
    // Named args are flags as typed on the command line; some entries leave off the dashes
    const flag = typeof a.name === 'string' && a.name ? (a.name.startsWith('-') ? a.name : `--${a.name}`) : '';
    if (a.type === 'named' && a.format === 'boolean' && a.value === undefined) {
      if (a.isRequired && flag) args.push(flag); // optional on/off switches are left off
      return;
    }
    const fixed = typeof a.value === 'string' && !PLACEHOLDER.test(a.value) ? a.value : null;
    let valueTemplate = fixed;
    if (fixed === null) {
      const key = fieldKey('a', i);
      fields.push({
        key,
        label: flag || a.valueHint || `Argument ${i + 1}`,
        description: a.description || '',
        secret: !!a.isSecret,
        required: !!a.isRequired,
        default: typeof a.default === 'string' ? a.default : '',
        path: a.format === 'filepath'
      });
      valueTemplate = `{${key}}`;
    }
    if (a.type === 'named' && flag) {
      args.push([flag, valueTemplate]);
    } else if (a.type !== 'named') {
      args.push(valueTemplate);
    }
  });
  return args;
}

function mapPackage(pkg) {
  const transport = pkg.transport?.type || 'stdio';
  if (transport !== 'stdio' || typeof pkg.identifier !== 'string' || !pkg.identifier) return null;
  const fields = [];
  let install;
  if (pkg.registryType === 'npm') {
    const spec = pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier;
    install = { type: 'stdio', runtime: 'node', command: 'npx', args: ['-y', spec] };
  } else if (pkg.registryType === 'pypi') {
    const spec = pkg.version ? `${pkg.identifier}==${pkg.version}` : pkg.identifier;
    install = { type: 'stdio', runtime: 'python', command: 'uvx', args: [spec] };
  } else {
    return null; // oci/docker, nuget, mcpb… aren't one-click installable here
  }
  install.args.push(...mapArguments(pkg, fields));
  install.env = mapEnvironment(pkg, fields);
  return { install, fields };
}

function mapRemote(remote) {
  if (!remote || !['streamable-http', 'sse'].includes(remote.type)) return null;
  if (typeof remote.url !== 'string' || PLACEHOLDER.test(remote.url)) return null;
  const fields = [];
  const headers = {};
  (remote.headers || []).forEach((h, i) => {
    if (!h || typeof h.name !== 'string' || !h.name) return;
    const key = fieldKey('h', i);
    let template = `{${key}}`;
    if (typeof h.value === 'string' && !PLACEHOLDER.test(h.value)) {
      headers[h.name] = h.value; // fixed header
      return;
    }
    if (typeof h.value === 'string' && /^Bearer \{[^}]+\}$/i.test(h.value)) template = `Bearer {${key}}`;
    fields.push({
      key,
      label: template.startsWith('Bearer') ? `${h.name} token` : h.name,
      description: h.description || '',
      secret: h.isSecret !== false,
      required: !!h.isRequired,
      default: ''
    });
    headers[h.name] = template;
  });
  return { install: { type: 'http', url: remote.url, headers }, fields };
}

/**
 * Turn a registry entry ({ server, _meta } or a bare server) into a marketplace entry.
 * Entries without a usable install get installable: false and a reason.
 */
function mapRegistryServer(entry) {
  const server = entry?.server || entry;
  if (!server || typeof server.name !== 'string') return null;
  const shortName = server.name.split('/').pop();
  const namespace = server.name.includes('/') ? server.name.slice(0, server.name.lastIndexOf('/')) : '';
  // "com.notion/mcp" says nothing as "mcp" — name it after the publisher instead
  const displayName = /^(mcp|server|mcp-server)$/i.test(shortName) && namespace ? namespace.split('.').pop() : shortName;
  const base = {
    id: `registry:${server.name}`,
    registryName: server.name,
    version: typeof server.version === 'string' ? server.version : '',
    name: (typeof server.title === 'string' && server.title) || displayName,
    publisher: namespace,
    description: typeof server.description === 'string' ? server.description : '',
    homepage: server.websiteUrl || server.repository?.url || '',
    icon: '🧩',
    category: 'Registry',
    verified: false
  };
  // Prefer a local package (npm, then PyPI), then a hosted endpoint
  const packages = Array.isArray(server.packages) ? server.packages : [];
  const ordered = [...packages.filter(p => p?.registryType === 'npm'), ...packages.filter(p => p?.registryType === 'pypi')];
  let mapped = null;
  for (const p of ordered) if ((mapped = mapPackage(p))) break;
  if (!mapped) for (const r of server.remotes || []) if ((mapped = mapRemote(r))) break;
  if (!mapped) {
    const types = [...new Set(packages.map(p => p?.registryType).filter(Boolean))];
    return {
      ...base, installable: false, install: null, fields: [],
      reason: types.length ? `Only available as ${types.join(', ')} — not supported for one-click install` : 'No installable package or URL listed'
    };
  }
  return { ...base, installable: true, ...mapped };
}

function remember(entry) {
  const server = entry?.server;
  if (server?.name && server?.version) seen.set(`${server.name}@${server.version}`, entry);
}

/**
 * Search the registry. Never throws: returns { ok: true, servers, nextCursor } or
 * { ok: false, error } so the Marketplace can fall back to the curated catalog.
 */
async function searchRegistry(query = '', cursor = '') {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), version: 'latest' });
  if (typeof query === 'string' && query.trim()) params.set('search', query.trim().slice(0, 100));
  if (typeof cursor === 'string' && cursor) params.set('cursor', cursor.slice(0, 500));
  try {
    const data = await fetchJson(`${REGISTRY_URL()}/v0.1/servers?${params}`);
    const byName = new Map();
    for (const entry of data?.servers || []) {
      const status = entry?._meta?.['io.modelcontextprotocol.registry/official']?.status;
      if (status === 'deleted') continue;
      remember(entry);
      const mapped = mapRegistryServer(entry);
      if (mapped && !byName.has(mapped.registryName)) byName.set(mapped.registryName, mapped);
    }
    return { ok: true, servers: [...byName.values()], nextCursor: data?.metadata?.nextCursor || null };
  } catch (err) {
    return { ok: false, error: unreachableMessage(err) };
  }
}

/** One registry server, as the main process fetched it (search results are reused). */
async function getRegistryServer(name, version) {
  if (typeof name !== 'string' || !name || typeof version !== 'string' || !version) return null;
  const known = seen.get(`${name}@${version}`);
  if (known) return mapRegistryServer(known);
  try {
    const entry = await fetchJson(`${REGISTRY_URL()}/v0.1/servers/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`);
    remember(entry);
    return mapRegistryServer(entry);
  } catch (_) {
    return null;
  }
}

function clearRegistryCache() {
  cache.clear();
  seen.clear();
}

module.exports = { searchRegistry, getRegistryServer, mapRegistryServer, clearRegistryCache };
