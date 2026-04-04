const EventEmitter = require('events');
const { getToolDeclarations, executeTool, isBuiltinTool } = require('../mcp-servers/builtin-tools');
const { ArmorIQGuard, loadArmorIQConfig } = require('./armoriq-guard');

/**
 * MCP Client Manager — routes tool calls between Gemini and tool providers.
 *
 * Now includes ArmorIQ security guard:
 *   - Every tool call is validated against the signed intent token + local policy
 *   - Blocked calls return { success: false, securityBlock: true } for circuit-breaking
 *
 * Supports:
 *   1. Built-in tools (in-process, zero config)
 *   2. External MCP servers via stdio (future — pluggable via config)
 */
class McpClientManager extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.externalClients = new Map(); // serverName → { client, transport, tools }
    this._approvalFn = null;
    this.guard = null; // ArmorIQ security guard
  }

  /**
   * Initialize the manager — connects to any configured external MCP servers
   * and initializes the ArmorIQ security guard.
   * @param {object} mcpServerConfigs - Config map: { serverName: { command, args, env } }
   */
  async initialize(mcpServerConfigs = {}) {
    // ── Initialize ArmorIQ Guard ──────────────────────────
    try {
      const armorConfig = loadArmorIQConfig();
      this.guard = new ArmorIQGuard(armorConfig);
      const guardOk = await this.guard.initialize();

      if (guardOk) {
        // Forward guard events for UI consumption
        this.guard.on('intent-created', (plan) => this.emit('security:intent-created', plan));
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
    
    // ── ArmorIQ Security Gate ────────────────────────────
    if (!this.guard || !this.guard.enabled) {
      console.log('[GATE] Guard offline or missing — Fail closed');
      // Fail closed
      return { success: false, securityBlock: true, error: 'Security gate offline — all tools blocked.' };
    }

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
      // Precise error code handling
      if (error.code === 'POLICY_DENY') {
        this.emit('security:enforcement-block', { tool: toolName, reason: 'Policy deny list match', rule: error.rule });
        return { success: false, securityBlock: true, error: 'Blocked by policy: ' + toolName, toolName };
      }
      if (error.code === 'INTENT_DRIFT') {
        this.emit('security:enforcement-block', { tool: toolName, reason: 'Tool not in signed intent plan' });
        return { success: false, securityBlock: true, error: 'Blocked — intent drift detected', toolName };
      }
      throw error; // Real errors must surface
    }

    // ── Normal tool execution (passed security) ──────────

    // Check built-in tools first
    if (isBuiltinTool(toolName)) {
      this.emit('toolExecuting', toolName, args);
      const result = await executeTool(toolName, args, this._approvalFn);
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
    try {
      // Dynamic import for ESM MCP SDK
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
      const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: { ...process.env, ...(config.env || {}) }
      });

      const client = new Client(
        { name: `desktop-assistant-${name}`, version: '1.0.0' },
        { capabilities: { tools: {} } }
      );

      await client.connect(transport);

      // Discover available tools
      const toolList = await client.listTools();
      const tools = toolList.tools || [];

      this.externalClients.set(name, { client, transport, tools });
    } catch (err) {
      throw new Error(`Failed to connect MCP server "${name}": ${err.message}`);
    }
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

    for (const [name, serverInfo] of this.externalClients) {
      try {
        if (serverInfo.client) await serverInfo.client.close();
        if (serverInfo.transport) await serverInfo.transport.close();
        console.log(`[MCP] Disconnected from ${name}`);
      } catch (err) {
        console.error(`[MCP] Error disconnecting ${name}:`, err.message);
      }
    }
    this.externalClients.clear();
    this.initialized = false;
  }
}

module.exports = McpClientManager;
