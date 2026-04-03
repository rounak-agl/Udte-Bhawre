const EventEmitter = require('events');
const { getToolDeclarations, executeTool, isBuiltinTool } = require('../mcp-servers/builtin-tools');

/**
 * MCP Client Manager — routes tool calls between Gemini and tool providers.
 *
 * Currently supports:
 *   1. Built-in tools (in-process, zero config)
 *   2. External MCP servers via stdio (future — pluggable via config)
 */
class McpClientManager extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.externalClients = new Map(); // serverName → { client, transport, tools }
    this._approvalFn = null;
  }

  /**
   * Initialize the manager — connects to any configured external MCP servers.
   * @param {object} mcpServerConfigs - Config map: { serverName: { command, args, env } }
   */
  async initialize(mcpServerConfigs = {}) {
    // Connect to external MCP servers (if any configured)
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
   * Routes to the correct handler (built-in or external MCP server).
   * @param {string} toolName
   * @param {object} args
   * @returns {Promise<object>} Tool result
   */
  async executeToolCall(toolName, args) {
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

    const result = {
      type: typeMap[schema.type] || 'OBJECT'
    };

    if (schema.properties) {
      result.properties = {};
      for (const [key, prop] of Object.entries(schema.properties)) {
        result.properties[key] = {
          type: typeMap[prop.type] || 'STRING',
          description: prop.description || ''
        };
        if (prop.enum) result.properties[key].enum = prop.enum;
      }
    }

    if (schema.required) {
      result.required = schema.required;
    }

    if (schema.items) {
      result.items = { type: typeMap[schema.items.type] || 'STRING' };
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
   * Gracefully disconnect all external MCP servers.
   */
  async shutdown() {
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
