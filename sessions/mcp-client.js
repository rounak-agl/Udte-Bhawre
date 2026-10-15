const EventEmitter = require('events');
const { getToolDeclarations, executeTool, isBuiltinTool } = require('../mcp-servers/builtin-tools');
const { ArmorIQGuard, loadArmorIQConfig } = require('./armoriq-guard');

// ── Shared external MCP servers ─────────────────────────────
// One process per distinct server config, shared by every agent's session and
// reference-counted: it's stopped when the last session using it shuts down.
// (Previously every Gemini Vision agent launched its own copy of every server.)
// The ArmorIQ guard is NOT shared — each session seals its own plan per message.
const serverPool = new Map(); // key → { ready: Promise<{ client, transport, tools }>, refs }

function serverKey(name, config) {
  if (config.type === 'http') return JSON.stringify([name, 'http', config.url, config.headers || {}]);
  return JSON.stringify([name, config.command, config.args || [], config.env || {}]);
}

const START_TIMEOUT_MS = 120000; // npx/uvx download the server (and its dependencies) on first run

function newClient(name) {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  return new Client(
    { name: `desktop-assistant-${name}`, version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
}

/** Connect, list tools, and close again if either step fails. */
async function connectAndList(client, transport) {
  try {
    await client.connect(transport, { timeout: START_TIMEOUT_MS });
    const toolList = await client.listTools(undefined, { timeout: START_TIMEOUT_MS });
    return { client, transport, tools: toolList.tools || [] };
  } catch (err) {
    try { await client.close(); } catch (_) { /* already closed */ }
    throw err;
  }
}

/** Local server: a process speaking MCP over stdio. */
async function openStdioServer(name, config) {
  const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
  const { getProcessEnv } = require('../utils/shell-env');
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args || [],
    // getProcessEnv adds the usual bin folders (npx/uvx) that a GUI-launched app may lack
    env: { ...getProcessEnv(), ...(config.env || {}) },
    stderr: 'pipe'
  });
  // Keep the end of the server's stderr: when it fails to start, that's usually the reason
  let stderrTail = '';
  transport.stderr?.on('data', (chunk) => {
    process.stderr.write(chunk);
    stderrTail = (stderrTail + chunk.toString()).slice(-2000);
  });
  try {
    return await connectAndList(newClient(name), transport);
  } catch (err) {
    if (stderrTail.trim()) err.serverOutput = stderrTail.trim();
    throw err;
  }
}

/**
 * Hosted server over HTTP. Tries the current Streamable HTTP transport first, then
 * the older SSE transport — unless the server rejected our credentials.
 */
async function openHttpServer(name, config) {
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
  const url = new URL(config.url);
  const requestInit = { headers: { ...(config.headers || {}) } };
  try {
    return await connectAndList(newClient(name), new StreamableHTTPClientTransport(url, { requestInit }));
  } catch (err) {
    if (err.code === 401 || err.code === 403) throw err;
    try {
      return await connectAndList(newClient(name), new SSEClientTransport(url, { requestInit }));
    } catch (_) {
      throw err; // the Streamable HTTP error is the more useful one
    }
  }
}

/** Start (or connect to) an external MCP server and list its tools. */
async function openExternalServer(name, config) {
  return config.type === 'http' ? openHttpServer(name, config) : openStdioServer(name, config);
}

/** Use (or start) the shared server for this config. */
async function acquireServer(name, config) {
  const key = serverKey(name, config);
  let entry = serverPool.get(key);
  if (!entry) {
    entry = { refs: 0, ready: McpClientManager.openExternalServer(name, config) };
    serverPool.set(key, entry);
    // A server that failed to start isn't cached; the next session tries again
    entry.ready.catch(() => { if (serverPool.get(key) === entry) serverPool.delete(key); });
  }
  entry.refs++;
  try {
    return { key, info: await entry.ready };
  } catch (err) {
    entry.refs--;
    throw err;
  }
}

/** Stop using a shared server; it's closed once no session uses it. */
async function releaseServer(key, name) {
  const entry = serverPool.get(key);
  if (!entry) return;
  entry.refs--;
  if (entry.refs > 0) return;
  serverPool.delete(key);
  try {
    const info = await entry.ready;
    if (info.client) await info.client.close();
    if (info.transport) await info.transport.close();
    console.log(`[MCP] Stopped ${name} (no agents use it any more)`);
  } catch (err) {
    console.error(`[MCP] Error stopping ${name}:`, err.message);
  }
}

/**
 * MCP Client Manager — routes tool calls between Gemini and tool providers.
 *
 * Now includes ArmorIQ security guard:
 *   - Every tool call is validated against the signed intent token + local policy
 *   - Blocked calls return { success: false, securityBlock: true } for circuit-breaking
 *
 * Supports:
 *   1. Built-in tools (in-process, zero config)
 *   2. External MCP servers: local (stdio) or hosted (HTTP), see Connectors
 */
class McpClientManager extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.externalClients = new Map(); // serverName → { client, transport, tools } (shared, see serverPool)
    this._poolKeys = new Map();       // serverName → serverPool key this session holds
    this._closed = false;
    this._approvalFn = null;
    this.guard = null; // ArmorIQ security guard
  }

  /**
   * Initialize the manager — connects to any configured external MCP servers
   * and initializes the ArmorIQ security guard.
   * @param {object} mcpServerConfigs - Config map: { serverName: { command, args, env } }
   */
  async initialize(mcpServerConfigs = {}) {
    this._closed = false;
    // ── Initialize ArmorIQ Guard ──────────────────────────
    try {
      const armorConfig = loadArmorIQConfig();
      this.guard = new ArmorIQGuard(armorConfig);
      const guardOk = await this.guard.initialize();

      if (guardOk) {
        // Forward guard events for UI consumption
        this.guard.on('intent-sealed', (info) => this.emit('security:intent-sealed', info));
        this.guard.on('intent-failed', (info) => this.emit('security:intent-failed', info));
        this.guard.on('intent-verified', (tool) => this.emit('security:intent-verified', tool));
        this.guard.on('intent-blocked', (tool, reason) => this.emit('security:intent-blocked', tool, reason));
        this.guard.on('policy-denied', (tool, reason) => this.emit('security:policy-denied', tool, reason));
        this.guard.on('guard-error', (err) => this.emit('security:error', err));
        console.log('[MCP] 🛡️  ArmorIQ Guard active');
      } else {
        console.warn('[MCP] ⚠️  ArmorIQ Guard inactive — running without security enforcement');
      }
    } catch (err) {
      console.error('[MCP] ArmorIQ Guard init failed:', err.message);
      this.guard = null;
    }

    // ── Connect external MCP servers ─────────────────────
    for (const [name, config] of Object.entries(mcpServerConfigs)) {
      try {
        await this._connectExternalServer(name, config);
        console.log(`[MCP] Connected to external server: ${name}`);
      } catch (err) {
        console.error(`[MCP] Failed to connect to ${name}:`, err.message);
      }
    }

    this.initialized = true;
    console.log('[MCP] Client manager initialized');
    console.log(`[MCP] Built-in tools: ${getToolDeclarations().length}`);
    console.log(`[MCP] External servers: ${this.externalClients.size}`);
  }

  /**
   * Set the approval function for dangerous tool calls.
   * @param {function} fn - Async function(message) => boolean
   */
  setApprovalFunction(fn) {
    this._approvalFn = fn;
  }

  /**
   * Create an intent plan for the current user turn.
   * Must be called BEFORE any tool execution in the turn.
   * @param {string} prompt - The user's message
   * @param {Array} tools - Available tool declarations
   * @returns {object|null} The approved plan
   */
  async createIntentPlan(prompt, tools) {
    if (this.guard && this.guard.enabled) {
      return await this.guard.hooks.onLlmInput({ prompt, tools });
    }
    return null;
  }

  /**
   * Drop any intent plan from a previous turn. Call at the start of each user turn.
   */
  resetIntentPlan() {
    if (this.guard) this.guard.clearPlan();
  }

  /**
   * Get all tool declarations in Gemini functionDeclarations format.
   */
  getAllFunctionDeclarations() {
    const declarations = [];

    // Built-in tools
    declarations.push(...getToolDeclarations());

    // External MCP server tools
    for (const [, serverInfo] of this.externalClients) {
      if (serverInfo.tools) {
        for (const tool of serverInfo.tools) {
          declarations.push(this._mcpToolToGeminiDeclaration(tool));
        }
      }
    }

    return declarations;
  }

  /**
   * Execute a tool call by name with given arguments.
   *
   * ── SECURITY GATE ──
   * If ArmorIQ guard is active, validates the tool call FIRST.
   * On block, returns { success: false, securityBlock: true, error: reason }
   * The calling code MUST check `securityBlock` and break the loop immediately.
   *
   * @param {string} toolName
   * @param {object} args
   * @returns {Promise<object>} Tool result
   */
  async executeToolCall(toolName, args) {
    console.log('[GATE] Tool attempted:', toolName);
    // Set when the user already approved this call in the ArmorIQ-unreachable fallback,
    // so a tool that normally asks (shell, file write, URL) doesn't ask a second time
    let approvedByUser = false;
    
    // ── ArmorIQ Security Gate ────────────────────────────
    if (!this.guard || !this.guard.enabled) {
      // Guard not configured — passthrough mode (tools execute normally)
      // When an API key is added, the guard activates and enforces security
      console.log('[GATE] Guard not active — passthrough mode');
    } else {
      try {
        console.log('[GATE] Sending to tool validation:', toolName);
        const validation = await this.guard.hooks.onToolExecution(toolName, args);
        console.log('[GATE] Validation result:', validation);
        if (!validation.allowed) {
           return {
             success: false,
             securityBlock: true,
             error: `🛡️ ArmorIQ BLOCKED: ${validation.reason}`,
             toolName,
           };
        }
        this.emit('security:tool-allowed', { tool: toolName, timestamp: Date.now() });
      } catch (error) {
        // Each block carries a `kind` so the UI can say what actually happened:
        //   policy     — deny list, allow list, or a dangerous argument pattern
        //   drift      — tool not in the plan ArmorIQ sealed for this message
        //   unverified — no plan / verification failed, so nothing can be verified (fail-closed)
        //   declined   — ArmorIQ was unreachable and the user said no in the fallback prompt
        if (error.code === 'POLICY_DENY') {
          const rule = error.rule || error.message;
          this.emit('security:enforcement-block', { tool: toolName, kind: 'policy', reason: rule });
          return { success: false, securityBlock: true, error: `Blocked by policy: ${rule}`, toolName };
        }
        if (error.code === 'INTENT_DRIFT') {
          this.emit('security:enforcement-block', { tool: toolName, kind: 'drift', reason: error.message });
          return { success: false, securityBlock: true, error: 'Blocked — not in the approved plan for this message', toolName };
        }
        if (error.code === 'GUARD_UNREACHABLE') {
          // ArmorIQ couldn't be reached (not a refusal): ask the user instead of blocking.
          // Local policy already passed (it runs before this). No prompt available → block.
          const approved = this._approvalFn
            ? await this._approvalFn(this._describeForApproval(toolName, args))
            : false;
          this.guard._log('tool_call', approved ? 'allow' : 'block', toolName, {
            stage: 'fallback-approval', reason: approved ? 'Approved by user (ArmorIQ unreachable)' : 'Declined by user (ArmorIQ unreachable)'
          });
          if (!approved) {
            this.emit('security:enforcement-block', { tool: toolName, kind: 'declined', reason: this._approvalFn ? 'You declined it' : 'No approval prompt available' });
            return { success: false, securityBlock: true, error: 'Not run — ArmorIQ was unreachable and the action was not approved', toolName };
          }
          approvedByUser = true;
          this.emit('security:fallback-approved', { tool: toolName, timestamp: Date.now() });
        } else if (error.code === 'NO_INTENT' || error.code === 'VERIFY_UNAVAILABLE') {
          this.emit('security:enforcement-block', { tool: toolName, kind: 'unverified', reason: error.message });
          return { success: false, securityBlock: true, error: `Blocked — ${error.message}`, toolName };
        } else {
          throw error; // Real errors must surface
        }
      }
    }

    // ── Normal tool execution (passed security or passthrough) ──────────

    // Check built-in tools first
    if (isBuiltinTool(toolName)) {
      this.emit('toolExecuting', toolName, args);
      const approval = approvedByUser ? async () => true : this._approvalFn;
      const result = await executeTool(toolName, args, approval);
      this.emit('toolComplete', toolName, result);
      return result;
    }

    // Check external MCP servers
    for (const [serverName, serverInfo] of this.externalClients) {
      const hasTool = serverInfo.tools?.some(t => t.name === toolName);
      if (hasTool) {
        this.emit('toolExecuting', toolName, args);
        try {
          const result = await serverInfo.client.callTool({
            name: toolName,
            arguments: args
          });
          const parsed = this._parseMcpResult(result);
          this.emit('toolComplete', toolName, parsed);
          return parsed;
        } catch (err) {
          const errorResult = { success: false, error: `MCP server "${serverName}" error: ${err.message}` };
          this.emit('toolComplete', toolName, errorResult);
          return errorResult;
        }
      }
    }

    return { success: false, error: `Unknown tool: ${toolName}` };
  }

  /** The Allow/Deny prompt text for a tool call that ArmorIQ couldn't verify. */
  _describeForApproval(toolName, args) {
    let shown;
    try {
      shown = JSON.stringify(args ?? {}, null, 2);
    } catch (_) {
      shown = '(arguments could not be displayed)';
    }
    if (shown.length > 1200) shown = shown.slice(0, 1200) + '\n…';
    return `ArmorIQ couldn't be reached to verify this action, so it needs your OK.\n\nTool: ${toolName}\nArguments:\n${shown}`;
  }

  /**
   * Get the guard's audit log for this session.
   */
  getSecurityAuditLog() {
    return this.guard ? this.guard.getAuditLog() : [];
  }

  /**
   * Connect to an external MCP server via stdio transport.
   */
  async _connectExternalServer(name, config) {
    let acquired;
    try {
      acquired = await acquireServer(name, config);
    } catch (err) {
      throw new Error(`Failed to connect MCP server "${name}": ${err.message}`);
    }
    // Shut down while the server was starting: give our share back straight away
    if (this._closed) {
      await releaseServer(acquired.key, name);
      return;
    }
    this._poolKeys.set(name, acquired.key);
    this.externalClients.set(name, acquired.info);
  }

  /**
   * Convert an MCP tool schema to Gemini functionDeclaration format.
   */
  _mcpToolToGeminiDeclaration(mcpTool) {
    const decl = {
      name: mcpTool.name,
      description: mcpTool.description || ''
    };

    if (mcpTool.inputSchema) {
      // Convert JSON Schema → Gemini parameter schema
      decl.parameters = this._convertJsonSchemaToGemini(mcpTool.inputSchema);
    } else {
      decl.parameters = { type: 'OBJECT', properties: {}, required: [] };
    }

    return decl;
  }

  /**
   * Convert JSON Schema (used by MCP) to Gemini's parameter format.
   */
  _convertJsonSchemaToGemini(schema) {
    const typeMap = {
      string: 'STRING',
      number: 'NUMBER',
      integer: 'INTEGER',
      boolean: 'BOOLEAN',
      array: 'ARRAY',
      object: 'OBJECT'
    };

    // Handle edge case where type might be an array (e.g., ["string", "null"])
    let schemaType = schema.type;
    if (Array.isArray(schemaType)) {
      schemaType = schemaType.find(t => t !== 'null') || 'string';
    }

    const result = {
      type: typeMap[schemaType] || 'OBJECT'
    };

    if (schema.description) {
      result.description = schema.description;
    }

    if (schema.properties) {
      result.properties = {};
      for (const [key, prop] of Object.entries(schema.properties)) {
        // Recursively convert nested properties
        result.properties[key] = this._convertJsonSchemaToGemini(prop);
      }
    }

    if (schema.required) {
      result.required = schema.required;
    }

    if (schema.items) {
      // Recursively convert array items
      result.items = this._convertJsonSchemaToGemini(schema.items);
    }

    if (schema.enum) {
      result.enum = schema.enum;
    }

    return result;
  }

  /**
   * Parse MCP tool result into a simple JS object.
   */
  _parseMcpResult(result) {
    if (result.isError) {
      const errText = result.content?.map(c => c.text).join('') || 'Unknown error';
      return { success: false, error: errText };
    }

    const textParts = (result.content || []).filter(c => c.type === 'text');
    const text = textParts.map(c => c.text).join('');

    try {
      return { success: true, ...JSON.parse(text) };
    } catch {
      return { success: true, result: text };
    }
  }

  /**
   * Gracefully disconnect all external MCP servers and ArmorIQ guard.
   */
  async shutdown() {
    // Shutdown ArmorIQ guard
    if (this.guard) {
      await this.guard.shutdown();
      this.guard = null;
    }

    // Servers are shared with other agents: release our share instead of closing them
    this._closed = true;
    const held = [...this._poolKeys];
    this._poolKeys.clear();
    this.externalClients.clear();
    for (const [name, key] of held) await releaseServer(key, name);
    this.initialized = false;
  }
}

// Overridable for tests (avoids spawning real servers)
McpClientManager.openExternalServer = openExternalServer;
McpClientManager._serverPool = serverPool;

module.exports = McpClientManager;
