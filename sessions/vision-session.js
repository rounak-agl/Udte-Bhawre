const { GoogleGenAI } = require('@google/genai');
const EventEmitter = require('events');
const McpClientManager = require('./mcp-client');
const { getMcpServers } = require('./agent-session');
const { toGeminiContents, userTurnText, promptWithImages } = require('./conversation-context');

/**
 * Gemini Vision API Session with MCP Tool Support.
 * Uses @google/genai SDK for multimodal (text + images the user attaches) queries
 * with function calling for tool execution.
 */

// The model only sees images the user chose to attach (a 📷 screenshot or a picture);
// nothing is captured automatically, so the prompt must not claim it can see the screen.
const INTRO = `You are a helpful desktop assistant. You can't see the user's screen on your own.
The user may attach a screenshot or other images to a message — when they do, use them to answer.
If a question depends on what is on screen and no image is attached, ask the user to attach a screenshot (📷 button) or describe it, instead of guessing.`;

const FORMATTING_RULES = `FORMATTING RULES:
- Use markdown formatting in your responses
- Be concise and direct`;

const TOOL_RULES = `TOOL USAGE:
- You have access to various tools (functions). Use them when the user's request requires an action.
- For example: opening URLs, composing emails, creating calendar events, reading clipboard, etc.
- When you use a tool, the result will be sent back to you. Use it to form your final response.
- For simple questions that don't need tools, just answer directly.`;

// Images stay in the model's context for this many of the latest user turns that had
// any; older ones become a text note (every request resends the whole context).
const IMAGE_TURNS_KEPT = 3;

/** Assemble the system instruction from what this session can actually do. */
function buildSystemPrompt({ tools, persona }) {
  const sections = [INTRO, FORMATTING_RULES];
  if (tools) sections.push(TOOL_RULES);
  if (persona) sections.push(`AGENT INSTRUCTIONS (from this agent's context file):\n${persona}`);
  return sections.join('\n\n');
}

/** Replace the image parts of all but the latest IMAGE_TURNS_KEPT image turns with a note. */
function trimOldImages(contents) {
  let kept = 0;
  for (let i = contents.length - 1; i >= 0; i--) {
    const c = contents[i];
    if (c.role !== 'user' || !c.parts.some(p => p.inlineData)) continue;
    if (++kept <= IMAGE_TURNS_KEPT) continue;
    const n = c.parts.filter(p => p.inlineData).length;
    c.parts = [{ text: `[${n} image${n === 1 ? '' : 's'} shared earlier — no longer visible]` }, ...c.parts.filter(p => !p.inlineData)];
  }
}

class VisionSession extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {boolean} [options.toolsEnabled=true] - expose built-in/MCP tools to the model
   */
  constructor(options = {}) {
    super();
    this.toolsEnabled = options.toolsEnabled !== false;
    this.systemPrompt = ''; // agent persona, set by the owning Character before start()
    this.ai = null;
    this.isRunning = false;
    this.isBusy = false;
    this.history = [];
    this.currentResponseText = '';
    this.mcpClient = new McpClientManager();
    this._conversationHistory = []; // Gemini conversation context
    this._startPromise = null;
  }

  /**
   * Whether ArmorIQ guards this session's desktop tools (for the chat's shield badge).
   * Not covered when tools are off — there is nothing to guard.
   */
  guardStatus() {
    if (!this.toolsEnabled) return { covered: false };
    return { covered: true, enabled: !!(this.mcpClient.guard && this.mcpClient.guard.enabled) };
  }

  /**
   * Seed the model's context with an earlier conversation (carried over from a previous
   * session, or restored from the database) so the agent remembers it.
   */
  restoreContext(history) {
    this._conversationHistory = toGeminiContents(history);
  }

  /**
   * Initialize with API key. send() awaits this, so a message typed while MCP servers
   * and the ArmorIQ guard are still starting can't run tools before the guard is ready.
   */
  start(apiKey) {
    this._startPromise = this._start(apiKey);
    return this._startPromise;
  }

  async _start(apiKey) {
    if (!apiKey) {
      this.emit('error', 'Gemini API key not set. Go to tray menu → Set API Key.');
      return;
    }

    try {
      this.ai = new GoogleGenAI({ apiKey });

      // Tools off → don't start the guard or launch any external MCP server processes
      if (this.toolsEnabled) {
        const mcpConfigs = getMcpServers() || {};
        await this.mcpClient.initialize(mcpConfigs);
      }

      // Forward security events from MCP client to session level
      this.mcpClient.on('security:intent-sealed', (data) => this.emit('security:intent-sealed', data));
      this.mcpClient.on('security:intent-failed', (data) => this.emit('security:intent-failed', data));
      this.mcpClient.on('security:tool-allowed', (data) => this.emit('security:tool-allowed', data));
      this.mcpClient.on('security:enforcement-block', (data) => this.emit('security:enforcement-block', data));
      this.mcpClient.on('security:fallback-approved', (data) => this.emit('security:fallback-approved', data));

      this.isRunning = true;
      this.emit('sessionReady');
      console.log(`[VisionSession] Initialized with gemini-2.5-flash (tools ${this.toolsEnabled ? 'on' : 'off'})`);
      if (this.toolsEnabled) {
        console.log(`[VisionSession] Available tools: ${this.mcpClient.getAllFunctionDeclarations().map(t => t.name).join(', ')}`);
      }
    } catch (err) {
      this.emit('error', `Failed to initialize Gemini API: ${err.message}`);
    }
  }

  /**
   * Set the approval function for dangerous tool calls.
   * @param {function} fn - Async function(message) => boolean
   */
  setApprovalFunction(fn) {
    this.mcpClient.setApprovalFunction(fn);
  }

  /**
   * Send a message, with any images the user attached.
   * @param {string} message
   * @param {Array<{mimeType: string, data: string}>} [images] base64 images
   */
  async send(message, images = []) {
    if (this.isBusy) {
      this.emit('error', 'Still processing the previous request. Please wait.');
      return;
    }

    // Wait for start() to finish (MCP servers + guard) before any tool can run
    if (this._startPromise) await this._startPromise;

    if (!this.ai) {
      this.emit('error', 'Vision session not started. Set your Gemini API key first.');
      return;
    }

    if (this.isBusy) {
      this.emit('error', 'Still processing the previous request. Please wait.');
      return;
    }

    this.history.push({ role: 'user', text: userTurnText(message, images.length) });
    this.isBusy = true;
    this.currentResponseText = '';

    try {
      // Images first, then the text (Gemini's recommended order)
      const parts = [
        ...images.map(img => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
        { text: promptWithImages(message, images.length) }
      ];
      this._conversationHistory.push({ role: 'user', parts });
      trimOldImages(this._conversationHistory);

      // Get tool declarations (none when tools are disabled for this agent / globally)
      const functionDeclarations = this.toolsEnabled ? this.mcpClient.getAllFunctionDeclarations() : [];
      const tools = functionDeclarations.length > 0
        ? [{ functionDeclarations }]
        : undefined;

      // ── ArmorIQ: fresh turn — the intent plan is sealed inside the tool loop from
      // the tools the model actually proposes, never carried over from a previous turn ──
      this.mcpClient.resetIntentPlan();
      this._turnPrompt = message;

      // Run the function calling loop
      await this._generateWithToolLoop(tools);

      // Save completed response
      if (this.currentResponseText.trim()) {
        this.history.push({ role: 'assistant', text: this.currentResponseText.trim() });
      }

      this.isBusy = false;
      this.currentResponseText = '';
      this.emit('turnComplete');

    } catch (err) {
      this.isBusy = false;
      this.currentResponseText = '';

      console.error('[VisionSession] API Error:', err, err.message, err.status, JSON.stringify(err));

      if (err.message && err.message.includes('429')) {
        this.emit('error', `⏳ Rate limited. Detail: ${err.message}`);
      } else if (err.message && err.message.includes('API_KEY')) {
        this.emit('error', '🔑 Invalid API key. Check your Gemini API key in settings.');
      } else {
        this.emit('error', `Gemini API error: ${err.message}`);
      }
      this.emit('turnComplete');
    }
  }

  /**
   * Core function calling loop:
   * 1. Send to Gemini (with tools)
   * 2. If response contains functionCall → execute tool → send result → repeat
   * 3. If response contains text → stream to UI → done
   */
  async _generateWithToolLoop(tools, maxIterations = 5) {
    let intentSealed = false;
    for (let i = 0; i < maxIterations; i++) {
      // Stream response from Gemini
      const responseStream = await this.ai.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: this._conversationHistory,
        config: {
          tools,
          systemInstruction: buildSystemPrompt({
            tools: !!tools,
            persona: this.systemPrompt
          })
        }
      });

      let functionCalls = [];
      let modelParts = [];
      let textAccumulated = '';

      // Consume the stream
      for await (const chunk of responseStream) {
        // Stream text to UI as it arrives
        const text = chunk.text;
        if (text) {
          textAccumulated += text;
          this.currentResponseText += text;
          this.emit('text', text);
        }

        // Collect function calls
        if (chunk.functionCalls && chunk.functionCalls.length > 0) {
          functionCalls.push(...chunk.functionCalls);
        }

        // Collect model response parts for history
        if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
          modelParts.push(...chunk.candidates[0].content.parts);
        }
      }

      // Add model response to conversation history
      if (modelParts.length > 0) {
        this._conversationHistory.push({ role: 'model', parts: modelParts });
      } else if (textAccumulated) {
        this._conversationHistory.push({ role: 'model', parts: [{ text: textAccumulated }] });
      }

      // If no function calls, we're done — text has been streamed
      if (functionCalls.length === 0) {
        return;
      }

      // ── ArmorIQ: seal the intent plan from the first batch of tool calls the model
      // proposes this turn. Later iterations may only use tools from that plan, so a
      // tool result that injects "now call open_url…" is blocked as intent drift.
      if (!intentSealed) {
        intentSealed = true;
        const declarations = tools?.[0]?.functionDeclarations || [];
        const proposed = [...new Set(functionCalls.map(c => c.name))].map(name => ({
          name,
          description: declarations.find(d => d.name === name)?.description || name
        }));
        await this.mcpClient.createIntentPlan(this._turnPrompt || '', proposed);
      }

      // Execute function calls and send results back
      const functionResponseParts = [];
      let securityTerminated = false; // Circuit-breaker flag

      for (const call of functionCalls) {
        const toolName = call.name;
        const toolArgs = call.args || {};

        // Emit tool use event to UI
        const argsSummary = Object.entries(toolArgs)
          .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.substring(0, 50) : v}`)
          .join(', ');
        this.emit('toolUse', toolName, toolArgs);
        this.history.push({ role: 'toolUse', text: `${toolName}(${argsSummary})` });

        // Execute the tool (ArmorIQ validates inside executeToolCall)
        let result;
        try {
          result = await this.mcpClient.executeToolCall(toolName, toolArgs);
        } catch (err) {
          result = { success: false, error: err.message };
        }

        // ── CIRCUIT BREAKER: Security block → terminate turn immediately ──
        if (result.securityBlock) {
          // The chat already shows one security banner for this block (with the real
          // reason), so no extra reply text / tool-result line here — just record it.
          this.history.push({ role: 'toolResult', text: `SECURITY BLOCK: ${result.error}` });
          console.log(`[VisionSession] 🛡️ CIRCUIT BREAKER: Terminated turn due to security block on ${toolName}`);
          securityTerminated = true;
          break; // Exit the inner for-loop immediately
        }

        // Emit tool result to UI
        const resultSummary = result.success !== false
          ? (result.message || JSON.stringify(result).substring(0, 120))
          : `Error: ${result.error}`;
        this.emit('toolResult', resultSummary, result.success === false);
        this.history.push({ role: 'toolResult', text: resultSummary });

        // Build function response part
        functionResponseParts.push({
          functionResponse: {
            name: toolName,
            response: result
          }
        });
      }

      // ── CIRCUIT BREAKER: If security terminated, exit the outer loop too ──
      if (securityTerminated) {
        return; // Exit _generateWithToolLoop() entirely — do NOT feed error back to LLM
      }

      // Add function responses to conversation for next iteration
      this._conversationHistory.push({
        role: 'user',
        parts: functionResponseParts
      });

      // Loop continues — Gemini will process the tool results
    }

    // If we hit max iterations, emit a warning
    this.emit('text', '\n\n⚠️ Tool loop limit reached.');
  }

  terminate() {
    this.isRunning = false;
    this.isBusy = false;
    this.ai = null;
    this._conversationHistory = [];
    // Shutdown MCP client
    this.mcpClient.shutdown().catch(() => { });
  }
}

module.exports = VisionSession;
