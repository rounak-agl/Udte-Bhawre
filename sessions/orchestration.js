/**
 * Orchestration protocol — how an agent hands work to sub-agents, provider-agnostic.
 *
 * Only Gemini Vision has in-app function calling, so delegation is a small text
 * protocol every provider can follow: the orchestrator ends its reply with a fenced
 * block, and the app parses it after the turn (app/orchestrator.js runs the work).
 *
 *   ```delegate
 *   {"tasks":[{"id":"a","title":"…","instructions":"…","provider":"claude","dependsOn":[]}]}
 *   ```
 *   ```remember
 *   {"notes":["fact worth keeping"]}
 *   ```
 *
 * Everything parsed here is model output: treat it as untrusted (sizes capped, provider
 * keys validated by the caller, rendered as text).
 */

const LIMITS = {
  maxTasks: 6,
  maxTitle: 120,
  maxInstructions: 8000,
  maxNotes: 10,
  maxNote: 500,
  resultsBudget: 6000,   // chars of sub-agent results sent back to the orchestrator
  perResult: 2500
};

// ```delegate … ``` / ```remember … ``` (also tolerates a missing closing fence at the end)
const blockRegex = (name) => new RegExp('```' + name + '\\b[ \\t]*(?:\\r?\\n)?([\\s\\S]*?)(?:\\r?\\n```|```|$)', 'g');

function lastBlock(text, name) {
  if (typeof text !== 'string') return null;
  let match, last = null;
  const re = blockRegex(name);
  while ((match = re.exec(text)) !== null) {
    last = match[1];
    if (match[0].length === 0) re.lastIndex++;
  }
  return last;
}

function allBlocks(text, name) {
  if (typeof text !== 'string') return [];
  const out = [];
  const re = blockRegex(name);
  let match;
  while ((match = re.exec(text)) !== null) {
    out.push(match[1]);
    if (match[0].length === 0) re.lastIndex++;
  }
  return out;
}

function parseJson(raw) {
  try {
    return JSON.parse(raw.trim().replace(/,\s*([}\]])/g, '$1'));
  } catch (_) {
    return undefined;
  }
}

// Starts every internal "sub-agent results" message. That text is sub-agent output
// (untrusted), so security planning leaves it out (sessions/vision-session.js).
const RESULTS_MARKER = '[Sub-agent results — not written by the user]';

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * The delegation request in an orchestrator reply, if any.
 * @param {string} text  the reply
 * @param {object} opts  { isKnownProvider(key), defaultProvider }
 * @returns {null | { tasks } | { error }}  null when the reply doesn't delegate
 */
function parseDelegation(text, { isKnownProvider = () => true, defaultProvider = '' } = {}) {
  const raw = lastBlock(text, 'delegate');
  if (raw === null) return null;
  const data = parseJson(raw);
  const list = Array.isArray(data) ? data : data?.tasks;
  if (!Array.isArray(list) || !list.length) return { error: 'The delegation plan wasn\'t valid JSON with a "tasks" list.' };

  const tasks = [];
  const ids = new Set();
  for (const [i, t] of list.slice(0, LIMITS.maxTasks).entries()) {
    if (!t || typeof t !== 'object') continue;
    const instructions = typeof t.instructions === 'string' ? t.instructions.trim() : (typeof t.task === 'string' ? t.task.trim() : '');
    if (!instructions) continue;
    let id = typeof t.id === 'string' || typeof t.id === 'number' ? String(t.id).trim().slice(0, 40) : '';
    if (!id || ids.has(id)) id = `t${i + 1}`;
    ids.add(id);
    const title = clip((typeof t.title === 'string' && t.title.trim()) || instructions.split('\n')[0], LIMITS.maxTitle);
    const provider = typeof t.provider === 'string' && isKnownProvider(t.provider.trim()) ? t.provider.trim() : defaultProvider;
    tasks.push({
      id,
      title,
      instructions: clip(instructions, LIMITS.maxInstructions),
      provider,
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.map(String) : []
    });
  }
  if (!tasks.length) return { error: 'The delegation plan had no usable tasks.' };

  // Dependencies: only on tasks in this plan, and no cycles
  for (const t of tasks) t.dependsOn = [...new Set(t.dependsOn.filter(d => ids.has(d) && d !== t.id && tasks.some(x => x.id === d)))];
  const byId = new Map(tasks.map(t => [t.id, t]));
  const state = new Map(); // id → 'visiting' | 'done'
  const hasCycle = (id) => {
    if (state.get(id) === 'done') return false;
    if (state.get(id) === 'visiting') return true;
    state.set(id, 'visiting');
    const cyclic = byId.get(id).dependsOn.some(hasCycle);
    state.set(id, 'done');
    return cyclic;
  };
  if (tasks.some(t => hasCycle(t.id))) return { error: 'The delegation plan has circular dependencies.' };

  return { tasks, truncated: list.length > LIMITS.maxTasks };
}

// Notices providers send as ordinary reply text when they can't actually answer — e.g.
// the Claude CLI prints "You've hit your session limit · resets 8pm" as its reply.
// Matched only on short output, so a real answer that *discusses* rate limits isn't flagged.
const PROVIDER_NOTICES = [
  { kind: 'limit', label: 'usage limit reached', re: /\b(you'?ve|you have) (hit|reached|exceeded) your\b[^.\n]*\blimit|\b(usage|session|daily|weekly|monthly|message|token) limit (reached|exceeded|hit)\b|\blimit (reached|exceeded)\b.*\bresets?\b/i },
  { kind: 'limit', label: 'rate limited', re: /\brate[- ]limit(ed)?\b.*\b(exceeded|reached|try again|retry)\b|\btoo many requests\b|\b429\b/i },
  { kind: 'limit', label: 'quota or credits used up', re: /\b(exceeded|exhausted) (your )?(current )?quota\b|\bquota (exceeded|exhausted)\b|\bcredit balance is too low\b|\binsufficient (credits?|quota|balance|funds)\b|\bout of credits\b/i },
  { kind: 'auth', label: 'not signed in or bad API key', re: /\b(invalid|incorrect|missing) (x-)?api[- ]?key\b|\bauthentication (failed|error|required)\b|\bnot (logged|signed) in\b|\bplease (log ?in|sign ?in|run [`'"]?\S+ login)\b|\bunauthori[sz]ed\b/i },
  { kind: 'unavailable', label: 'service unavailable', re: /\b(service|model) (is )?(temporarily )?(unavailable|overloaded)\b|\boverloaded_error\b|\b503\b/i }
];
const NOTICE_MAX_CHARS = 300;

/**
 * If a reply is really a provider notice (usage limit, quota, auth, outage) rather
 * than an answer, return { kind, label, message }; otherwise null.
 */
function detectProviderNotice(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > NOTICE_MAX_CHARS) return null;
  const hit = PROVIDER_NOTICES.find(n => n.re.test(trimmed));
  return hit ? { kind: hit.kind, label: hit.label, message: trimmed.replace(/\s+/g, ' ') } : null;
}

/** Facts an agent asked to keep in team memory. */
function parseMemoryNotes(text) {
  const notes = [];
  for (const raw of allBlocks(text, 'remember')) {
    const data = parseJson(raw);
    const list = Array.isArray(data) ? data : (Array.isArray(data?.notes) ? data.notes : (typeof data?.note === 'string' ? [data.note] : null));
    // Not JSON: one note per non-empty line
    const items = list || raw.split('\n').map(l => l.replace(/^\s*[-*•]\s*/, ''));
    for (const n of items) {
      if (typeof n !== 'string' || !n.trim()) continue;
      notes.push(clip(n.trim(), LIMITS.maxNote));
      if (notes.length >= LIMITS.maxNotes) return notes;
    }
  }
  return notes;
}

/** The reply as the user should see it: protocol blocks become a short marker. */
function stripProtocolBlocks(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(blockRegex('delegate'), '\n*📋 Handing this to sub-agents…*\n')
    .replace(blockRegex('remember'), '\n*🧠 Saved to team memory*\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function providerLine(p) {
  const hints = {
    vision: 'Google Gemini; can use desktop tools (files, clipboard, browser, shell) when enabled',
    claude: 'Anthropic Claude CLI; strong at code, writing and analysis, works in the user\'s home folder',
    codex: 'OpenAI Codex CLI; code generation and editing',
    copilot: 'GitHub Copilot CLI; shell command suggestions'
  };
  const hint = hints[p.key] || (p.kind === 'ollama' ? `local model ${p.model || ''} — private, free, smaller` : '');
  return `- ${p.key}: ${p.name}${hint ? ` (${hint})` : ''}`;
}

/** Added to an orchestrator agent's system prompt. */
function buildOrchestratorInstructions({ providers = [], memory = '', selfProvider = '' } = {}) {
  return `ORCHESTRATION (you can delegate work to sub-agents):
For a request with several independent or specialised parts, you may split it into sub-tasks that sub-agents do for you. Do NOT delegate simple questions, chit-chat or anything you can answer directly — just answer.

To delegate, briefly tell the user what you're doing, then end your reply with ONE block exactly like this (JSON, no comments):
\`\`\`delegate
{"tasks":[
  {"id":"research","title":"Short title","instructions":"Complete, self-contained instructions — the sub-agent sees nothing else from this chat.","provider":"${selfProvider || 'vision'}"},
  {"id":"summary","title":"…","instructions":"…","provider":"…","dependsOn":["research"]}
]}
\`\`\`
- At most ${LIMITS.maxTasks} tasks. Independent tasks run in parallel; use "dependsOn" when a task needs another's result (it will receive it).
- "provider" picks who does the task (default: yours). Available providers:
${providers.map(providerLine).join('\n')}
- After the sub-agents finish you'll get their results in a message; then give the user the final answer. Don't delegate again unless something essential is missing.

TEAM MEMORY (shared with your sub-agents, kept between conversations):
${memory || '(empty)'}
To save a durable fact (user preferences, decisions, key findings), add:
\`\`\`remember
{"notes":["…"]}
\`\`\``;
}

/** The whole system prompt of one sub-agent. */
function buildSubAgentInstructions({ task, memory = '', depResults = [], orchestratorName = 'the assistant' }) {
  const deps = depResults.length
    ? `\n\nRESULTS FROM EARLIER SUB-TASKS YOU DEPEND ON:\n${depResults.map(d => `## ${d.title} (${d.status})\n${clip(d.result || '(no output)', LIMITS.perResult)}`).join('\n\n')}`
    : '';
  return `You are a sub-agent working for ${orchestratorName}, an orchestrating assistant. Do ONLY the task below and reply with the result — complete and concise, ready to be combined with other sub-agents' work. You cannot delegate further and nobody will answer follow-up questions: if something is unclear, make a sensible assumption and say so.

TASK: ${task.title}

TEAM MEMORY (shared by the team, kept between conversations):
${memory || '(empty)'}

If you learn a durable fact the team should keep, add at the end:
\`\`\`remember
{"notes":["…"]}
\`\`\`${deps}`;
}

/** The internal follow-up that hands sub-agent results back to the orchestrator. */
function buildResultsMessage(results, newNotes = [], { finalRound = false } = {}) {
  const per = Math.max(400, Math.min(LIMITS.perResult, Math.floor(LIMITS.resultsBudget / Math.max(1, results.length))));
  const parts = results.map(r =>
    `## ${r.title} — ${r.status === 'done' ? 'done' : `FAILED${r.error ? `: ${r.error}` : ''}`} (${r.providerName || r.provider})\n${clip((r.result || '').trim() || '(no output)', per)}`);
  return `${RESULTS_MARKER}
${parts.join('\n\n')}
${newNotes.length ? `\nNew team memory notes:\n${newNotes.map(n => `- ${n}`).join('\n')}\n` : ''}
Now give the user the final answer to their original request, using these results.${finalRound ? ' Do not delegate again.' : ' Only delegate again if something essential is missing.'}`;
}

module.exports = {
  LIMITS,
  RESULTS_MARKER,
  detectProviderNotice,
  parseDelegation,
  parseMemoryNotes,
  stripProtocolBlocks,
  buildOrchestratorInstructions,
  buildSubAgentInstructions,
  buildResultsMessage
};
