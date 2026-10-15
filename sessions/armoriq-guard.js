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
 *   'intent-sealed'    (info)             — a new intent plan was approved
 *   'intent-failed'    ({ reason })       — intent planning failed
 *   'intent-verified'  (toolName)         — a tool call was approved
 *   'intent-blocked'   (toolName, reason) — a tool call was blocked by intent drift
 *   'policy-denied'    (toolName, reason) — a tool call was blocked by local policy
 *   'guard-error'      (error)            — an error occurred in the guard
 */

// ── SDK module references (lazy-loaded in initialize()) ──────────
let ArmorIQClient = null;

const DEFAULT_CONFIG = {
  apiKey: '',
  userId: 'antigravity-user-42',
  agentId: 'antigravity-agent-001',
  contextId: 'default',
  iapEndpoint: 'https://customer-iap.armoriq.ai',
  proxyEndpoint: 'https://customer-proxy.armoriq.ai',
  backendEndpoint: 'https://api.armoriq.ai',
  validitySeconds: 300,
  policyPath: path.join(__dirname, '..', 'armoriq.policy.json'),
};

/**
 * True when ArmorIQ couldn't be *reached* (connection, TLS, DNS, timeout, 5xx), as
 * opposed to ArmorIQ answering and refusing. Only reachability failures may fall back
 * to asking the user; an explicit refusal always blocks.
 */
function isConnectivityError(err) {
  if (!err) return false;
  const status = err.response?.status ?? err.status ?? err.statusCode;
  if (typeof status === 'number' && status >= 500) return true;
  const codes = ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNABORTED', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'];
  if (codes.includes(err.code) || codes.includes(err.cause?.code)) return true;
  return /socket|TLS|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timed? ?out|network|fetch failed|unreachable/i.test(err.message || '');
}

class ArmorIQGuard extends EventEmitter {
  /**
   * @param {object} config — merged with DEFAULT_CONFIG
   */
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Remap deprecated/broken customer-api.armoriq.ai to the active api.armoriq.ai endpoint
    if (this.config.backendEndpoint === 'https://customer-api.armoriq.ai' || this.config.backendEndpoint === 'https://customer-proxy.armoriq.ai') {
      this.config.backendEndpoint = 'https://api.armoriq.ai';
    }
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
        ArmorIQClient = clientModule.ArmorIQClient;
        console.log('[ArmorIQ] SDK loaded from dist path');
      } else {
        // Fallback: standard require (may work if circular dep is resolved)
        const sdk = require('@armoriq/sdk');
        ArmorIQClient = sdk.ArmorIQClient;
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
      // `tools` must be the tools the model actually proposed for this turn (not
      // every available tool), otherwise the intent-drift check can never block.
      const intendedTools = tools;

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
      const unreachable = isConnectivityError(err);
      console.error(`[ArmorIQ] ❌ Intent planning failed${unreachable ? ' (unreachable)' : ''}:`, err.message);
      this._log('plan_failed', 'error', null, { error: err.message, unreachable });
      this.emit('intent-failed', { reason: err.message, unreachable });
      // On planning failure, clear any stale state — fail-closed
      this.currentToken = null;
      this.currentPlan = null;
      this.allowedActions.clear();
      // Remember why, so tool calls this turn can fall back to asking the user
      // only when ArmorIQ was unreachable (never when it refused the plan)
      this.planUnreachable = unreachable;
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


    // ── Stage 2: Intent Token Validation (fail-closed) ─────
    if (!this.currentToken || !this.currentPlan) {
      if (this.planUnreachable) {
        // ArmorIQ couldn't be reached to seal a plan: the caller may ask the user instead
        const reason = 'ArmorIQ is unreachable, so this action could not be verified';
        this._log('tool_call', 'pending', toolName, { reason, stage: 'intent' });
        throw Object.assign(new Error(reason), { code: 'GUARD_UNREACHABLE' });
      }
      // The guard is enabled but no plan was sealed for this turn (planning failed or
      // was refused). Block rather than run unverified.
      const reason = 'No sealed intent plan for this turn (fail-closed)';
      this._log('tool_call', 'block', toolName, { reason, stage: 'intent' });
      this.emit('intent-blocked', toolName, reason);
      console.log(`[ArmorIQ] ❌ NO INTENT PLAN: ${toolName} — blocked`);
      throw Object.assign(new Error(reason), { code: 'NO_INTENT' });
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

    // ── Stage 3: verify against the token ArmorIQ signed ──
    // A local check: no network call, nothing executed. (The SDK's client.invoke() is
    // NOT a verifier — it runs the tool through ArmorIQ's cloud proxy on an MCP server
    // registered there, which this app's in-process tools are not, so it always failed.)
    const verdict = this._verifyAgainstToken(this.currentToken, normalizedName);
    if (!verdict.ok) {
      this._log('tool_call', 'block', toolName, { reason: verdict.reason, stage: 'verification' });
      this.emit(verdict.code === 'POLICY_DENY' ? 'policy-denied' : 'intent-blocked', toolName, verdict.reason);
      console.log(`[ArmorIQ] ❌ VERIFICATION BLOCKED: ${toolName} — ${verdict.reason}`);
      throw Object.assign(new Error(verdict.reason), { code: verdict.code, rule: verdict.reason });
    }

    this._log('tool_call', 'allow', toolName, {
      stage: 'verified',
      tokenId: this.currentToken.tokenId,
      args: this._sanitizeArgs(args),
    });
    this.emit('intent-verified', toolName);
    console.log(`[ArmorIQ] ⚡ SECURE EXECUTION: ${toolName} validated against signed intent.`);
    return { allowed: true };
  }

  /**
   * Check one tool call against the intent token ArmorIQ issued for this turn:
   *  - not expired;
   *  - actually signed (ArmorIQ signature + plan hash present);
   *  - the tool is a step in the plan ArmorIQ signed (not just our local copy);
   *  - not excluded by ArmorIQ's server-side policy evaluation, if it returned one.
   * @returns {{ ok: true } | { ok: false, code: string, reason: string }}
   */
  _verifyAgainstToken(token, normalizedName) {
    if (!token) return { ok: false, code: 'NO_INTENT', reason: 'No intent token for this turn' };
    if (typeof token.expiresAt === 'number' && Date.now() / 1000 > token.expiresAt) {
      return { ok: false, code: 'INTENT_DRIFT', reason: 'The approval for this message expired — send it again' };
    }
    if (!token.signature || !token.planHash) {
      return { ok: false, code: 'VERIFY_UNAVAILABLE', reason: 'ArmorIQ returned an unsigned or incomplete intent token' };
    }
    const signedSteps = token.rawToken?.plan?.steps || [];
    const signedActions = signedSteps.map(step => String(step?.action || '').toLowerCase());
    if (!signedActions.includes(normalizedName)) {
      return { ok: false, code: 'INTENT_DRIFT', reason: `"${normalizedName}" is not in the plan ArmorIQ signed` };
    }
    const pv = token.policyValidation || {};
    const lower = (list) => (Array.isArray(list) ? list.map(t => String(t).toLowerCase()) : null);
    const denied = lower(pv.denied_tools);
    const allowed = lower(pv.allowed_tools);
    if (denied && denied.includes(normalizedName)) {
      return { ok: false, code: 'POLICY_DENY', reason: `ArmorIQ policy denies "${normalizedName}"` };
    }
    if (allowed && allowed.length > 0 && !allowed.includes(normalizedName)) {
      return { ok: false, code: 'POLICY_DENY', reason: `ArmorIQ policy does not allow "${normalizedName}"` };
    }
    return { ok: true };
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
      'rm -r', 'rm -f', 'sudo', 'chmod', 'chown',
      '/etc/shadow', '/etc/passwd', '/root', '.bash_history',
      ' > /dev/null', 'powershell', 'cmd /c', '.env',
      'mkfs', 'dd if=', 'shutdown', 'reboot',
      ':(){', 'fork bomb', '| sh', '| bash',
      'curl | ', 'wget | ', '> /dev/sda',
      'kill -9', 'killall', 'pkill'
    ];
    // Flatten nested objects/arrays (and keys) so payloads can't hide one level down,
    // and collapse whitespace so "rm  -rf" / "rm\t-rf" still match "rm -r".
    const argValues = this._collectArgStrings(args).join(' ').replace(/\s+/g, ' ').toLowerCase();

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
   * Recursively collect every string/number/boolean value (and object key) in the args.
   * Throws POLICY_DENY on absurdly deep nesting rather than skipping it.
   */
  _collectArgStrings(value, out = [], depth = 0) {
    if (depth > 32) {
      throw Object.assign(new Error('Security Block: tool arguments are nested too deeply to inspect.'), { code: 'POLICY_DENY' });
    }
    if (value === null || value === undefined) return out;
    if (typeof value === 'string') {
      out.push(value);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out.push(String(value));
    } else if (Array.isArray(value)) {
      for (const item of value) this._collectArgStrings(item, out, depth + 1);
    } else if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        out.push(key);
        this._collectArgStrings(item, out, depth + 1);
      }
    }
    return out;
  }

  /**
   * Add one tool to this turn's plan and have ArmorIQ sign the extended plan. Only
   * called after the user approved the extra step (see McpClientManager). Returns true
   * when the new signed plan is in place; on failure the plan is cleared (fail-closed).
   */
  async extendPlan(tool) {
    if (!this.enabled || !this.currentPlan) return false;
    const tools = [
      ...this.currentPlan.steps.map(s => ({ name: s.tool || s.action, description: s.description })),
      { name: tool.name, description: tool.description || tool.name }
    ];
    const plan = await this.onLlmInput({ prompt: this.currentPlan.goal, tools });
    return !!plan && this.allowedActions.has(String(tool.name).toLowerCase());
  }

  /**
   * Forget the current plan/token. Call at the start of every user turn so a
   * previous turn's plan can never authorize this turn's tool calls.
   */
  clearPlan() {
    this.currentToken = null;
    this.currentPlan = null;
    this.allowedActions.clear();
    this.planUnreachable = false;
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
 * Where the ArmorIQ key comes from, highest priority first:
 *   1. ARMORIQ_API_KEY environment variable (development / CI)
 *   2. Control Centre → Settings → Security (stored encrypted)
 *   3. ~/.openclaw/openclaw.json armorclaw plugin config (legacy, plain text)
 */
function resolveArmorIQKey(pluginConfig) {
  if (process.env.ARMORIQ_API_KEY) return { apiKey: process.env.ARMORIQ_API_KEY, keySource: 'env' };
  const { getArmorIQApiKey } = require('./agent-session');
  const fromSettings = getArmorIQApiKey();
  if (fromSettings) return { apiKey: fromSettings, keySource: 'settings' };
  if (pluginConfig.apiKey) return { apiKey: pluginConfig.apiKey, keySource: 'openclaw' };
  return { apiKey: '', keySource: null };
}

/**
 * Load ArmorIQ config: the key (see resolveArmorIQKey) plus identity/endpoint
 * settings from ~/.openclaw/openclaw.json's armorclaw plugin section, if present. Only keys that are actually set are returned,
 * so DEFAULT_CONFIG's endpoints aren't overwritten with `undefined` when spread.
 * The policy is always this app's own armoriq.policy.json — never a policyStorePath
 * from a real OpenClaw install, which belongs to that tool.
 */
function loadArmorIQConfig() {
  let pluginConfig = {};
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      pluginConfig = parsed.plugins?.entries?.armorclaw?.config || {};
    } else {
      console.warn('[ArmorIQ] No openclaw.json found — using defaults');
    }
  } catch (err) {
    console.error('[ArmorIQ] Failed to load openclaw config:', err.message);
  }

  const { apiKey, keySource } = resolveArmorIQKey(pluginConfig);
  const config = {
    apiKey,
    keySource,
    userId: pluginConfig.userId || 'default-user',
    agentId: pluginConfig.agentId || 'openclaw-agent-001',
    contextId: pluginConfig.contextId || 'default',
    iapEndpoint: pluginConfig.iapEndpoint,
    proxyEndpoint: pluginConfig.proxyEndpoint,
    backendEndpoint: pluginConfig.backendEndpoint,
    policyPath: path.join(__dirname, '..', 'armoriq.policy.json'),
  };
  return Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

/**
 * Check ArmorIQ from the Settings page: can we reach it, and does it accept the key?
 * Uses an authenticated read-only endpoint, so no intent plan is created.
 * @returns {Promise<{ state: 'ok'|'off'|'invalid'|'unreachable'|'error', message: string }>}
 */
async function testArmorIQConnection({ timeoutMs = 8000 } = {}) {
  const config = new ArmorIQGuard(loadArmorIQConfig()).config; // merged with endpoint defaults
  if (!config.apiKey) return { state: 'off', message: 'No ArmorIQ key set.' };
  const base = String(config.backendEndpoint).replace(/\/+$/, '');
  const host = (() => { try { return new URL(base).host; } catch (_) { return base; } })();
  try {
    const res = await fetch(`${base}/mcp/my-servers`, {
      headers: { 'X-API-Key': config.apiKey },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (res.ok) return { state: 'ok', message: `Connected to ${host} — key accepted.` };
    if (res.status === 401 || res.status === 403) {
      return { state: 'invalid', message: `Connected to ${host}, but the key was rejected (HTTP ${res.status}). Check it in your ArmorIQ dashboard.` };
    }
    if (res.status >= 500) return { state: 'unreachable', message: `${host} is having problems (HTTP ${res.status}). Try again later.` };
    return { state: 'error', message: `${host} answered with HTTP ${res.status}.` };
  } catch (err) {
    const detail = err.name === 'TimeoutError' ? 'timed out' : (err.cause?.message || err.message);
    return { state: 'unreachable', message: `Couldn't reach ${host}: ${detail}. Check your network, VPN or firewall.` };
  }
}

module.exports = { ArmorIQGuard, loadArmorIQConfig, isConnectivityError, testArmorIQConnection };
