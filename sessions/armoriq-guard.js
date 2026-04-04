const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * ArmorIQ Guard — Intent-based security enforcement for Desktop Assistant.
 *
 * Wraps the @armoriq/sdk to enforce a three-stage security gate on every tool call:
 *   1. Intent Planning  — capturePlan() + getIntentToken() on each user message
 *   2. Tool Validation   — check tool against the signed intent token + local policy
 *   3. Audit Logging     — full execution trail with allow/block decisions
 *
 * Events emitted:
 *   'intent-created'   (plan)             — a new intent plan was approved
 *   'intent-verified'  (toolName)         — a tool call was approved
 *   'intent-blocked'   (toolName, reason) — a tool call was blocked by intent drift
 *   'policy-denied'    (toolName, reason) — a tool call was blocked by local policy
 *   'guard-error'      (error)            — an error occurred in the guard
 */

// ── SDK module references (lazy-loaded in initialize()) ──────────
let ArmorIQClient = null;
let IntentMismatchException = null;
let TokenExpiredException = null;
let PolicyBlockedException = null;

const DEFAULT_CONFIG = {
  apiKey: '',
  userId: 'antigravity-user-42',
  agentId: 'antigravity-agent-001',
  contextId: 'default',
  iapEndpoint: 'https://customer-iap.armoriq.ai',
  proxyEndpoint: 'https://customer-proxy.armoriq.ai',
  backendEndpoint: 'https://customer-api.armoriq.ai',
  validitySeconds: 300,
  policyPath: path.join(os.homedir(), '.openclaw', 'armoriq.policy.json'),
};

class ArmorIQGuard extends EventEmitter {
  /**
   * @param {object} config — merged with DEFAULT_CONFIG
   */
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.client = null;
    this.currentToken = null;
    this.currentPlan = null;
    this.allowedActions = new Set();
    this.policy = { allow: [], deny: [] };
    this.auditLog = [];
    this.enabled = false;
    this.enabled = false;
    this._sdkLoaded = false;
    
    // Expose hook APIs matching standard SDK
    this.hooks = {
      onLlmInput: this.onLlmInput.bind(this),
      onToolExecution: this.onToolExecution.bind(this)
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────


  /**
   * Lazy-load the @armoriq/sdk.
   * 
   * The SDK's package.json has a self-referencing circular dependency
   * ("@armoriq/sdk": "^0.2.7" in its own deps). Requiring it at module
   * load time creates a deadlock. We load it lazily here, directly from
   * the dist/ files to bypass the circular resolution.
   */
  _loadSDK() {
    if (this._sdkLoaded) return true;
    try {
      // Try direct dist path first (bypasses circular package.json dep)
      const sdkDistPath = path.join(
        __dirname, '..', 'node_modules', '@armoriq', 'sdk', 'dist'
      );
      if (fs.existsSync(path.join(sdkDistPath, 'client.js'))) {
        const clientModule = require(path.join(sdkDistPath, 'client.js'));
        const exceptionsModule = require(path.join(sdkDistPath, 'exceptions.js'));
        ArmorIQClient = clientModule.ArmorIQClient;
        IntentMismatchException = exceptionsModule.IntentMismatchException;
        TokenExpiredException = exceptionsModule.TokenExpiredException;
        PolicyBlockedException = exceptionsModule.PolicyBlockedException;
        console.log('[ArmorIQ] SDK loaded from dist path');
      } else {
        // Fallback: standard require (may work if circular dep is resolved)
        const sdk = require('@armoriq/sdk');
        ArmorIQClient = sdk.ArmorIQClient;
        IntentMismatchException = sdk.IntentMismatchException;
        TokenExpiredException = sdk.TokenExpiredException;
        PolicyBlockedException = sdk.PolicyBlockedException;
        console.log('[ArmorIQ] SDK loaded via standard require');
      }
      this._sdkLoaded = true;
      return true;
    } catch (err) {
      console.error('[ArmorIQ] ❌ Failed to load @armoriq/sdk:', err.message);
      return false;
    }
  }

  /**
   * Initialize the guard — creates the ArmorIQ client and loads local policy.
   * @returns {boolean} true if successfully initialized
   */
  async initialize() {
    try {
      // Require a valid API key
      if (!this.config.apiKey) {
        console.warn('[ArmorIQ] ⚠️  No API key configured — guard disabled');
        this.enabled = false;
        return false;
      }

      // Lazy-load the SDK
      if (!this._loadSDK()) {
        console.error('[ArmorIQ] ❌ SDK not available — guard disabled');
        this.enabled = false;
        return false;
      }

      // Create the ArmorIQ SDK client
      this.client = new ArmorIQClient({
        apiKey: this.config.apiKey,
        userId: this.config.userId,
        agentId: this.config.agentId,
        contextId: this.config.contextId,
        iapEndpoint: this.config.iapEndpoint,
        proxyEndpoint: this.config.proxyEndpoint,
        backendEndpoint: this.config.backendEndpoint,
        timeout: 30000,
        maxRetries: 2,
      });

      // Load local policy file
      this._loadPolicy();

      this.enabled = true;
      console.log('[ArmorIQ] ✅ Guard initialized');
      console.log(`[ArmorIQ]    Agent: ${this.config.agentId}`);
      console.log(`[ArmorIQ]    User:  ${this.config.userId}`);
      console.log(`[ArmorIQ]    Policy allow: [${this.policy.allow.join(', ')}]`);
      console.log(`[ArmorIQ]    Policy deny:  [${this.policy.deny.join(', ')}]`);
      return true;
    } catch (err) {
      console.error('[ArmorIQ] ❌ Initialization failed:', err.message);
      this.emit('guard-error', err);
      this.enabled = false;
      return false;
    }
  }

  /**
   * Shutdown and clean up resources.
   */
  async shutdown() {
    if (this.client) {
      try {
        await this.client.close();
      } catch (_) { /* ignore */ }
      this.client = null;
    }
    this.currentToken = null;
    this.currentPlan = null;
    this.allowedActions.clear();
    this.enabled = false;
    console.log('[ArmorIQ] Guard shut down');
  }

  // ─── Intent Planning ───────────────────────────────────────

  /**
   * Create an intent plan for a user message.
   * Call this BEFORE the tool-call loop for each user turn.
   *
   * @param {string} param.prompt — the user's message
   * @param {Array} param.tools — list of available tools [{name, description}, ...]
   * @returns {object|null} the approved plan, or null if planning failed
   */
  async onLlmInput({ prompt, tools = [] }) {
    if (!this.enabled || !this.client) {
      console.warn('[ArmorIQ] Guard not enabled — skipping intent planning');
      return null;
    }

    try {
      // Demo Heuristic: Extract intended tools by analyzing prompt keywords
      const promptLower = prompt.toLowerCase();
      const intendedTools = tools.filter(tool => {
        const keywords = tool.name.toLowerCase().split('_');
        // If any keyword of the tool natively exists in the prompt, assume intent
        return keywords.some(kw => promptLower.includes(kw));
      });

      // Build a plan object from the intended tools
      const plan = {
        goal: prompt,
        steps: intendedTools.map(tool => ({
          action: tool.name,
          tool: tool.name,
          mcp: 'desktop-assistant',
          description: tool.description || tool.name,
        })),
        metadata: {
          agentId: this.config.agentId,
          timestamp: Date.now(),
        },
      };

      // Capture the plan with ArmorIQ
      console.log(`[ArmorIQ] 📋 Capturing plan for: "${prompt.substring(0, 80)}..."`);
      const planCapture = this.client.capturePlan(
        'gemini-2.5-flash', // LLM model identifier
        prompt,
        plan,
        {
          sessionKey: `session-${Date.now()}`,
          senderId: this.config.userId,
          agentId: this.config.agentId,
        }
      );

      // Get a signed intent token
      console.log('[ArmorIQ] 🔑 Requesting intent token...');
      const token = await this.client.getIntentToken(
        planCapture,
        { allow: this.policy.allow, deny: this.policy.deny },
        this.config.validitySeconds
      );

      // Store the approved plan and extract allowed actions
      this.currentToken = token;
      this.currentPlan = plan;
      this.allowedActions.clear();
      for (const step of plan.steps) {
        this.allowedActions.add(step.action.toLowerCase());
      }

      this._log('plan_created', 'allow', null, {
        goal: prompt.substring(0, 120),
        stepCount: plan.steps.length,
        tokenId: token.tokenId || 'unknown',
      });

      // Issue Phase 2 UI Event
      this.emit('intent-sealed', {
        authorizedTools: Array.from(this.allowedActions),
        tokenHash: (token.token || token.tokenId || 'TOKEN_HASH_').substring(0, 16) + '...',
        timestamp: new Date().toISOString()
      });

      console.log('------------------------------------------------------------');
      console.log(`[ArmorIQ] 🧠 REASONING Context Approved: "${prompt.substring(0, 50)}..."`);
      console.log(`[ArmorIQ] 🛡️  INTENT PLAN SEALED: ${plan.steps.length} tools approved for execution.`);
      console.log('------------------------------------------------------------');
      return plan;

    } catch (err) {
      console.error('[ArmorIQ] ❌ Intent planning failed:', err.message);
      this._log('plan_failed', 'error', null, { error: err.message });
      this.emit('intent-failed', { reason: err.message });
      // On planning failure, clear any stale state — fail-closed
      this.currentToken = null;
      this.currentPlan = null;
      this.allowedActions.clear();
      return null;
    }
  }

  // ─── Tool Validation ───────────────────────────────────────

  /**
   * Validate a tool call against the intent token and local policy.
   * Call this BEFORE executing each tool.
   *
   * @param {string} toolName — the tool being called
   * @param {object} args — the tool arguments
   * @returns {{ allowed: boolean, reason?: string }}
   */
  async onToolExecution(toolName, args = {}) {
    if (!this.enabled) {
      // Guard disabled — allow all (degraded mode)
      return { allowed: true, reason: 'Guard disabled — passthrough' };
    }

    const normalizedName = toolName.toLowerCase().trim();

    // ── Stage 1: Local Policy Check (fail-closed) ──────────
    let policyResult;
    try {
      policyResult = this._checkPolicy(normalizedName, args);
    } catch (policyErr) {
      this._log('tool_call', 'block', toolName, {
        reason: policyErr.message,
        stage: 'policy',
        args: this._sanitizeArgs(args),
      });
      this.emit('policy-denied', toolName, policyErr.message);
      console.log(`[ArmorIQ] ❌ POLICY DENIED: ${toolName} — ${policyErr.message}`);
      
      // Re-throw so gate handles properly
      throw Object.assign(new Error(policyErr.message), { code: 'POLICY_DENY', rule: policyErr.message });
    }

    if (!policyResult.allowed) {
      this._log('tool_call', 'block', toolName, {
        reason: policyResult.reason,
        stage: 'policy',
        args: this._sanitizeArgs(args),
      });
      this.emit('policy-denied', toolName, policyResult.reason);
      console.log(`[ArmorIQ] ❌ POLICY DENIED: ${toolName} — ${policyResult.reason}`);
      throw Object.assign(new Error(policyResult.reason), { code: 'POLICY_DENY', rule: policyResult.reason });
    }


    // ── Stage 2: Intent Token Validation ───────────────────
    if (!this.currentToken || !this.currentPlan) {
      // No intent plan — but policy passed. Allow in degraded mode
      // to avoid blocking the entire app when the IAP backend is unreachable.
      console.warn(`[ArmorIQ] ⚠️  No intent plan — allowing ${toolName} via policy-only mode`);
      this._log('tool_call', 'allow', toolName, {
        reason: 'No intent plan — policy-only mode',
        stage: 'intent',
      });
      this.emit('intent-verified', toolName);
      return { allowed: true, reason: 'Policy-only mode (no intent plan)' };
    }

    // Check if the tool is in the approved plan
    if (!this.allowedActions.has(normalizedName)) {
      const reason = `Intent drift: "${toolName}" not in approved plan`;
      this._log('tool_call', 'block', toolName, {
        reason,
        stage: 'intent',
        allowedActions: [...this.allowedActions],
      });
      this.emit('intent-blocked', toolName, reason);
      console.log(`[ArmorIQ] ❌ INTENT DRIFT BLOCKED: ${toolName} — ${reason}`);
      
      throw Object.assign(new Error(reason), { code: 'INTENT_DRIFT' });
    }

    // ── Stage 3: SDK invoke() for cryptographic verification ──
    try {
      await this.client.invoke(
        'desktop-assistant',  // MCP name
        toolName,             // action
        this.currentToken,    // signed intent token
        args                  // parameters
      );

      this._log('tool_call', 'allow', toolName, {
        stage: 'verified',
        args: this._sanitizeArgs(args),
      });
      this.emit('intent-verified', toolName);
      console.log(`[ArmorIQ] ⚡ SECURE EXECUTION: ${toolName} validated against signed intent.`);
      return { allowed: true };

    } catch (err) {
      let reason = `Verification failed: ${err.message}`;
      let isHardBlock = false;

      if (IntentMismatchException && err instanceof IntentMismatchException) {
        reason = `Intent mismatch: ${toolName} does not match token plan`;
        err.code = 'INTENT_DRIFT';
        isHardBlock = true;
      } else if (TokenExpiredException && err instanceof TokenExpiredException) {
        reason = `Intent token expired for ${toolName}`;
        err.code = 'INTENT_DRIFT';
        isHardBlock = true;
      } else if (PolicyBlockedException && err instanceof PolicyBlockedException) {
        reason = `Policy blocked: ${toolName}`;
        err.code = 'POLICY_DENY';
        isHardBlock = true;
      }

      this._log('tool_call', isHardBlock ? 'block' : 'warn', toolName, {
        reason,
        stage: 'verification',
        errorType: err.constructor.name,
      });

      if (isHardBlock) {
        this.emit(err.code === 'POLICY_DENY' ? 'policy-denied' : 'intent-blocked', toolName, reason);
        console.log(`[ArmorIQ] ❌ VERIFICATION BLOCKED: ${toolName} — ${reason}`);
        
        // RE-THROW to be caught by specific execution gate checks
        throw Object.assign(new Error(reason), { code: err.code, rule: policyResult?.reason || '' });
      }


      // Network/backend error — allow based on local plan + policy checks
      console.log(`[ArmorIQ] ⚠️  Backend unreachable — allowing ${toolName} based on local plan + policy`);
      this.emit('intent-verified', toolName);
      return { allowed: true, reason: 'Allowed by local plan + policy (backend unreachable)' };
    }
  }

  // ─── Local Policy Engine ───────────────────────────────────

  /**
   * Check a tool name and its arguments against the local allow/deny policy.
   * Deny takes priority over allow (fail-closed).
   *
   * @param {string} normalizedName
   * @param {object} args
   * @returns {{ allowed: boolean, reason?: string }}
   */
  _checkPolicy(normalizedName, args = {}) {
    // 1. Tool-Level Deny list (absolute priority over allow)
    // RISK MITIGATION: If a tool appears in both allow and deny, deny always wins.
    if (this.policy.deny.length > 0) {
      const denied = this.policy.deny.some(d => normalizedName === d.toLowerCase());
      if (denied) {
        console.log('[BLOCK] Denying tool:', normalizedName);
        const err = new Error(`Tool "${normalizedName}" is in the deny list`);
        err.code = 'POLICY_DENY';
        throw err;
      }
    }

    // 2. Argument-Level Pattern Blocking (Precision Enforcement)
    // We inspect common fields like 'command', 'path', 'script' for dangerous strings.
    const dangerousStrings = [
      'rm -rf', 'sudo', 'chmod', '/etc/shadow', '/root', '.bash_history', 
      ' > /dev/null', 'powershell', 'cmd /c', '.env'
    ];
    const argValues = Object.values(args).join(' ').toLowerCase();
    
    for (const pattern of dangerousStrings) {
      if (argValues.includes(pattern)) {
        const err = new Error(`Security Block: Prohibited pattern "${pattern}" detected in arguments.`);
        err.code = 'POLICY_DENY';
        throw err;
      }
    }

    // 3. If there's an allow list, enforce it (whitelist mode)
    if (this.policy.allow.length > 0) {
      const allowed = this.policy.allow.some(a => normalizedName === a.toLowerCase());
      if (!allowed) {
        const err = new Error(`Tool "${normalizedName}" is not in the allow list`);
        err.code = 'POLICY_DENY';
        throw err;
      }
    }

    return { allowed: true };
  }


  /**
   * Load policy from the JSON file.
   */
  _loadPolicy() {
    try {
      const policyPath = this.config.policyPath;
      if (fs.existsSync(policyPath)) {
        const raw = fs.readFileSync(policyPath, 'utf8');
        const parsed = JSON.parse(raw);
        this.policy = {
          allow: Array.isArray(parsed.allow) ? parsed.allow : Array.isArray(parsed.policy?.allow) ? parsed.policy.allow : [],
          deny: Array.isArray(parsed.deny) ? parsed.deny : Array.isArray(parsed.policy?.deny) ? parsed.policy.deny : [],
        };
        console.log(`[ArmorIQ] 📄 Policy loaded from ${policyPath}`);
        console.log('[POLICY] Loaded deny list:', this.policy.deny);
        console.log('[POLICY] Loaded allow list:', this.policy.allow);
      } else {
        console.warn(`[ArmorIQ] ⚠️  No policy file at ${policyPath} — using defaults (allow-all)`);
        this.policy = { allow: [], deny: [] };
      }
    } catch (err) {
      console.error('[ArmorIQ] ❌ Failed to load policy file:', err.message);
      this.policy = { allow: [], deny: [] };
    }
  }

  // ─── Audit Log ─────────────────────────────────────────────

  /**
   * Get the full audit log for this session.
   */
  getAuditLog() {
    return [...this.auditLog];
  }

  /**
   * Clear the audit log.
   */
  clearAuditLog() {
    this.auditLog = [];
  }

  /**
   * Record an audit entry.
   */
  _log(event, decision, toolName, details = {}) {
    this.auditLog.push({
      timestamp: new Date().toISOString(),
      event,
      decision,
      toolName,
      agentId: this.config.agentId,
      userId: this.config.userId,
      ...details,
    });
  }

  /**
   * Sanitize tool arguments for logging (truncate large values).
   */
  _sanitizeArgs(args) {
    if (!args || typeof args !== 'object') return {};
    const sanitized = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string' && value.length > 200) {
        sanitized[key] = value.substring(0, 200) + '...';
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}

/**
 * Load ArmorIQ config from ~/.openclaw/openclaw.json
 * Extracts the armorclaw plugin config section.
 */
function loadArmorIQConfig() {
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    if (!fs.existsSync(configPath)) {
      console.warn('[ArmorIQ] No openclaw.json found — using defaults');
      return {};
    }
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    const pluginConfig = parsed.plugins?.entries?.armorclaw?.config || {};
    return {
      apiKey:process.env.ARMORIQ_API_KEY || pluginConfig.apiKey || '',
      userId: pluginConfig.userId || 'default-user',
      agentId: pluginConfig.agentId || 'openclaw-agent-001',
      contextId: pluginConfig.contextId || 'default',
      iapEndpoint: pluginConfig.iapEndpoint,
      proxyEndpoint: pluginConfig.proxyEndpoint,
      backendEndpoint: pluginConfig.backendEndpoint,
      policyPath: pluginConfig.policyStorePath || path.join(os.homedir(), '.openclaw', 'armoriq.policy.json'),
    };
  } catch (err) {
    console.error('[ArmorIQ] Failed to load openclaw config:', err.message);
    return {};
  }
}

module.exports = { ArmorIQGuard, loadArmorIQConfig };
