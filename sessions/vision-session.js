const { GoogleGenerativeAI } = require('@google/generative-ai');
const EventEmitter = require('events');

/**
 * Gemini Vision API Session.
 * Uses @google/generative-ai SDK for multimodal (text + screenshot) queries.
 * Supports bounding box detection for UI element location.
 */

const SYSTEM_PROMPT = `You are a helpful desktop assistant that can see the user's screen.
When the user asks a question, analyze the screenshot provided and give a clear, concise answer.

FORMATTING RULES:
- Use markdown formatting in your responses
- Be concise and direct

BOUNDING BOX MODE:
When the user asks "how to" do something on their screen (e.g., "how to create a pull request", 
"how to open settings"), you MUST:
1. Analyze the screenshot to identify the UI elements they need to interact with
2. Provide step-by-step instructions
3. For EACH step, include a JSON block with the bounding box of the UI element to interact with

Format each step EXACTLY like this:
Step 1: Click the "Code" button in the top right
\`\`\`bbox
{"step":1,"instruction":"Click the Code button","element":{"x":0.85,"y":0.12,"width":0.08,"height":0.03},"action":"click"}
\`\`\`

Step 2: Select "Open with GitHub Desktop"  
\`\`\`bbox
{"step":2,"instruction":"Select Open with GitHub Desktop","element":{"x":0.75,"y":0.25,"width":0.15,"height":0.03},"action":"click"}
\`\`\`

BOUNDING BOX COORDINATE RULES:
- All coordinates are NORMALIZED (0.0 to 1.0) relative to screen dimensions
- x = left edge of element (0.0 = left of screen, 1.0 = right)
- y = top edge of element (0.0 = top of screen, 1.0 = bottom)
- width = element width as fraction of screen width
- height = element height as fraction of screen height
- action = "click", "type", "scroll", "right-click", or "hover"

If the screen doesn't show the relevant UI for the user's question, just answer with text normally.
If you can see the relevant UI, ALWAYS include bounding boxes for interactive elements.`;

class VisionSession extends EventEmitter {
  constructor(screenCapture) {
    super();
    this.screenCapture = screenCapture; // reference to ScreenCapture service
    this.genAI = null;
    this.model = null;
    this.chatHistory = [];
    this.isRunning = false;
    this.isBusy = false;
    this.history = [];
    this.currentResponseText = '';
  }

  /** Initialize with API key */
  start(apiKey) {
    if (!apiKey) {
      this.emit('error', 'Gemini API key not set. Go to tray menu → Set API Key.');
      return;
    }

    try {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        systemInstruction: SYSTEM_PROMPT
      });
      this.isRunning = true;
      this.emit('sessionReady');
      console.log('[VisionSession] Initialized with gemini-2.5-flash');
    } catch (err) {
      this.emit('error', `Failed to initialize Gemini API: ${err.message}`);
    }
  }

  /** Send a message with the latest screenshot */
  async send(message) {
    if (!this.model) {
      this.emit('error', 'Vision session not started. Set your Gemini API key first.');
      return;
    }

    this.history.push({ role: 'user', text: message });
    this.isBusy = true;
    this.currentResponseText = '';

    try {
      // Build the multimodal prompt parts
      const parts = [];

      // Add screenshot if available
      const screenshot = this.screenCapture ? this.screenCapture.getLatest() : null;
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

      // Stream the response
      const result = await this.model.generateContentStream(parts);

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          this.currentResponseText += text;
          
          // Check for bounding box data in the stream
          this._checkForBoundingBoxes(text);

          // Emit text for display
          this.emit('text', text);
        }
      }

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

      if (err.message && err.message.includes('429')) {
        this.emit('error', '⏳ Rate limited. Please wait a moment and try again.');
      } else if (err.message && err.message.includes('API_KEY')) {
        this.emit('error', '🔑 Invalid API key. Check your Gemini API key in settings.');
      } else {
        this.emit('error', `Gemini API error: ${err.message}`);
      }
      this.emit('turnComplete');
    }
  }

  /** Send without screenshot (text-only mode) */
  async sendTextOnly(message) {
    if (!this.model) {
      this.emit('error', 'Vision session not started.');
      return;
    }

    this.history.push({ role: 'user', text: message });
    this.isBusy = true;
    this.currentResponseText = '';

    try {
      const result = await this.model.generateContentStream(message);

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          this.currentResponseText += text;
          this.emit('text', text);
        }
      }

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
    this.genAI = null;
    this.model = null;
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
        if (stepData.element && typeof stepData.element.x === 'number') {
          steps.push({
            step: stepData.step || steps.length + 1,
            instruction: stepData.instruction || '',
            element: {
              x: Math.max(0, Math.min(1, stepData.element.x)),
              y: Math.max(0, Math.min(1, stepData.element.y)),
              width: Math.max(0.01, Math.min(1, stepData.element.width || 0.05)),
              height: Math.max(0.01, Math.min(1, stepData.element.height || 0.03))
            },
            action: stepData.action || 'click'
          });
        }
      } catch (e) {
        // Invalid JSON in bbox block, skip
      }
    }

    return steps;
  }
}

module.exports = VisionSession;
