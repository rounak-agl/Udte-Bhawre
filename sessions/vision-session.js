const { GoogleGenAI } = require('@google/genai');
const EventEmitter = require('events');
const McpClientManager = require('./mcp-client');

/**
 * Gemini Vision API Session with MCP Tool Support.
 * Uses @google/genai SDK for multimodal (text + screenshot) queries
 * with function calling for tool execution.
 */

const SYSTEM_PROMPT = `You are a helpful desktop assistant that can see the user's screen.
When the user asks a question, analyze the screenshot provided and give a clear, concise answer.

FORMATTING RULES:
- Use markdown formatting in your responses
- Be concise and direct

TOOL USAGE:
- You have access to various tools (functions). Use them when the user's request requires an action.
- For example: opening URLs, composing emails, creating calendar events, reading clipboard, etc.
- When you use a tool, the result will be sent back to you. Use it to form your final response.
- For simple questions that don't need tools, just answer directly.

BOUNDING BOX MODE:
When the user asks "how to" do something on their screen (e.g., "how to create a pull request", 
"how to open settings"), you MUST:
1. Analyze the screenshot to identify the exact UI elements they need to interact with
2. Provide step-by-step instructions
3. For EACH step, include a JSON block with the bounding box of the UI element to interact with

Format each step EXACTLY like this:
Step 1: Click the "Terminal" menu item in the top menu bar
\`\`\`bbox
{"step":1,"instruction":"Click the Terminal menu item","element":[20, 250, 45, 310],"action":"click"}
\`\`\`

BOUNDING BOX COORDINATE RULES (CRITICAL):
- You MUST use the native array format: [ymin, xmin, ymax, xmax]
- Each coordinate MUST be an integer from 0 to 1000 representing the fraction of the screen resolution (e.g. 500 is the exact center of the screen).
- 0,0 is the top-left corner. 1000,1000 is the bottom-right corner.
- Do NOT use width/height or objects. You must use the [ymin, xmin, ymax, xmax] integer array format.
- action = "click", "type", "scroll", "right-click", or "hover"

If the screen doesn't show the relevant UI for the user's question, just answer with text normally.
If you can see the relevant UI, ALWAYS include bounding boxes for interactive elements.`;

class VisionSession extends EventEmitter {
  constructor(screenCapture) {
    super();
    this.screenCapture = screenCapture; // reference to ScreenCapture service
    this.ai = null;
    this.isRunning = false;
    this.isBusy = false;
    this.history = [];
    this.currentResponseText = '';
    this.mcpClient = new McpClientManager();
    this._conversationHistory = []; // Gemini conversation context
  }

  /** Initialize with API key */
  async start(apiKey) {
    if (!apiKey) {
      this.emit('error', 'Gemini API key not set. Go to tray menu → Set API Key.');
      return;
    }

    try {
      this.ai = new GoogleGenAI({ apiKey });

      // Initialize MCP client with built-in tools
      await this.mcpClient.initialize();

      this.isRunning = true;
      this.emit('sessionReady');
      console.log('[VisionSession] Initialized with gemini-2.0-flash + MCP tools');
      console.log(`[VisionSession] Available tools: ${this.mcpClient.getAllFunctionDeclarations().map(t => t.name).join(', ')}`);
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

  /** Send a message with the latest screenshot */
  async send(message) {
    if (!this.ai) {
      this.emit('error', 'Vision session not started. Set your Gemini API key first.');
      return;
    }

    if (this.isBusy) {
      this.emit('error', 'Still processing the previous request. Please wait.');
      return;
    }

    this.history.push({ role: 'user', text: message });
    this.isBusy = true;
    this.currentResponseText = '';

    try {
      // Build the multimodal prompt parts
      const parts = [];

      // Add screenshot if available — disabled to save API limits
      const screenshot = null; // this.screenCapture ? await this.screenCapture.captureNow() : null;
      if (screenshot) {
        parts.push({
          inlineData: {
            mimeType: 'image/png',
            data: screenshot.base64
          }
        });
        parts.push({ text: `[Screenshot: ${screenshot.width}x${screenshot.height}]\n\n${message}` });
      } else {
        parts.push({ text: message });
      }

      // Add user message to conversation history
      this._conversationHistory.push({ role: 'user', parts });

      // Get tool declarations
      const functionDeclarations = this.mcpClient.getAllFunctionDeclarations();
      const tools = functionDeclarations.length > 0
        ? [{ functionDeclarations }]
        : undefined;

      // Run the function calling loop
      await this._generateWithToolLoop(tools);

      // Save completed response
      if (this.currentResponseText.trim()) {
        this.history.push({ role: 'assistant', text: this.currentResponseText.trim() });

        // Parse all bounding boxes from the complete response
        const steps = this._parseAllBoundingBoxes(this.currentResponseText);
        if (steps.length > 0) {
          this.emit('stepGuide', steps);
        }
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
    for (let i = 0; i < maxIterations; i++) {
      // Stream response from Gemini
      const responseStream = await this.ai.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: this._conversationHistory,
        config: {
          tools,
          systemInstruction: SYSTEM_PROMPT
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
          this._checkForBoundingBoxes(text);
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

      // Execute function calls and send results back
      const functionResponseParts = [];

      for (const call of functionCalls) {
        const toolName = call.name;
        const toolArgs = call.args || {};

        // Emit tool use event to UI
        const argsSummary = Object.entries(toolArgs)
          .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.substring(0, 50) : v}`)
          .join(', ');
        this.emit('toolUse', toolName, toolArgs);
        this.history.push({ role: 'toolUse', text: `${toolName}(${argsSummary})` });

        // Execute the tool
        let result;
        try {
          result = await this.mcpClient.executeToolCall(toolName, toolArgs);
        } catch (err) {
          result = { success: false, error: err.message };
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

  /** Send without screenshot (text-only mode) */
  async sendTextOnly(message) {
    if (!this.ai) {
      this.emit('error', 'Vision session not started.');
      return;
    }

    this.history.push({ role: 'user', text: message });
    this.isBusy = true;
    this.currentResponseText = '';

    try {
      this._conversationHistory.push({ role: 'user', parts: [{ text: message }] });

      const functionDeclarations = this.mcpClient.getAllFunctionDeclarations();
      const tools = functionDeclarations.length > 0
        ? [{ functionDeclarations }]
        : undefined;

      await this._generateWithToolLoop(tools);

      if (this.currentResponseText.trim()) {
        this.history.push({ role: 'assistant', text: this.currentResponseText.trim() });
      }

      this.isBusy = false;
      this.currentResponseText = '';
      this.emit('turnComplete');

    } catch (err) {
      this.isBusy = false;
      this.emit('error', `Gemini error: ${err.message}`);
      this.emit('turnComplete');
    }
  }

  terminate() {
    this.isRunning = false;
    this.isBusy = false;
    this.ai = null;
    this._conversationHistory = [];
    // Shutdown MCP client
    this.mcpClient.shutdown().catch(() => {});
  }

  /** Check streaming text for bounding box markers (real-time) */
  _checkForBoundingBoxes(text) {
    // Real-time detection — will be parsed in full after stream completes
  }

  /** Parse all bounding box steps from the complete response */
  _parseAllBoundingBoxes(text) {
    const steps = [];
    const bboxRegex = /```bbox\s*\n?([\s\S]*?)\n?```/g;
    let match;

    while ((match = bboxRegex.exec(text)) !== null) {
      try {
        const stepData = JSON.parse(match[1].trim());
        let x, y, w, h;
        
        if (Array.isArray(stepData.element) && stepData.element.length === 4) {
          // Native Gemini spatial format: [ymin, xmin, ymax, xmax] (0-1000 scale)
          const [ymin, xmin, ymax, xmax] = stepData.element;
          y = ymin / 1000;
          x = xmin / 1000;
          h = (ymax - ymin) / 1000;
          w = (xmax - xmin) / 1000;
        } else if (stepData.element && typeof stepData.element.x === 'number') {
          // Fallback legacy object format
          x = stepData.element.x;
          y = stepData.element.y;
          w = stepData.element.width || 0.05;
          h = stepData.element.height || 0.03;
        } else {
          continue;
        }

        steps.push({
          step: stepData.step || steps.length + 1,
          instruction: stepData.instruction || '',
          element: {
            x: Math.max(0, Math.min(1, x)),
            y: Math.max(0, Math.min(1, y)),
            width: Math.max(0.01, Math.min(1, w)),
            height: Math.max(0.01, Math.min(1, h))
          },
          action: stepData.action || 'click'
        });
      } catch (e) {
        // Invalid JSON in bbox block, skip
      }
    }

    return steps;
  }
}

module.exports = VisionSession;
