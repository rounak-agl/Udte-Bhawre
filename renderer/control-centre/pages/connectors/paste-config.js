// renderer/control-centre/pages/connectors/paste-config.js
// Parse an MCP server config pasted from a README, Claude Desktop, Cursor or VS Code.
// Accepts:
//   { "mcpServers": { "name": { ... } } }      Claude Desktop / Cursor
//   { "servers": { ... } } / { "mcp": { "servers": { ... } } }   VS Code
//   { "name": { "command": ... } }            a bare server map
//   "name": { "command": ... }                 the inner part copied without outer braces
//   { "command": ..., "args": [...] }          one local server
//   { "url": ..., "headers": {...} }           one hosted server
// Returns { ok: true, servers: [{ id, config }] } or { ok: false, error }.
// Pure function: also loaded by the tests (module.exports).

(function () {
  function tryParse(text) {
    try { return JSON.parse(text); } catch (_) { /* try a lenient variant */ }
    // README snippets often have trailing commas or // comments
    const lenient = text
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(lenient); } catch (_) { /* try wrapping */ }
    try { return JSON.parse(`{${lenient}}`); } catch (_) { return undefined; }
  }

  const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const looksLikeServer = (v) => isObject(v) && (typeof v.command === 'string' || typeof (v.url || v.serverUrl || v.httpUrl) === 'string');

  function stringMap(obj) {
    const out = {};
    if (!isObject(obj)) return out;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
    }
    return out;
  }

  function normalize(cfg) {
    const url = cfg.url || cfg.serverUrl || cfg.httpUrl;
    if (typeof url === 'string' && typeof cfg.command !== 'string') {
      return { type: 'http', url: url.trim(), headers: stringMap(cfg.headers) };
    }
    const args = Array.isArray(cfg.args) ? cfg.args.filter(a => ['string', 'number', 'boolean'].includes(typeof a)).map(String) : [];
    return { command: cfg.command.trim(), args, env: stringMap(cfg.env) };
  }

  function cleanId(name) {
    return String(name || 'server').replace(/[^\w.-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'server';
  }

  function parsePastedMcpConfig(text) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'Paste a JSON config first.' };
    const data = tryParse(text.trim());
    if (!isObject(data)) return { ok: false, error: 'That isn\'t valid JSON.' };

    let map = null;
    if (looksLikeServer(data)) return { ok: true, servers: [{ id: '', config: normalize(data) }] };
    if (isObject(data.mcpServers)) map = data.mcpServers;
    else if (isObject(data.servers)) map = data.servers;
    else if (isObject(data.mcp) && isObject(data.mcp.servers)) map = data.mcp.servers;
    else map = data;

    const servers = Object.entries(map)
      .filter(([, cfg]) => looksLikeServer(cfg))
      .map(([name, cfg]) => ({ id: cleanId(name), config: normalize(cfg) }));
    if (!servers.length) return { ok: false, error: 'No MCP server found. Expected a "command" or a "url".' };
    return { ok: true, servers };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { parsePastedMcpConfig };
  else window.parsePastedMcpConfig = parsePastedMcpConfig;
})();
