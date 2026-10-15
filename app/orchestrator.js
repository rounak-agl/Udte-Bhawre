const crypto = require('crypto');
const { approveToolCall } = require('./security');
const { getApiKey } = require('../sessions/agent-session');
const providers = require('../sessions/providers'); // via the module, so tests can stub createSession
const {
  parseDelegation, parseMemoryNotes, buildSubAgentInstructions, buildResultsMessage, detectProviderNotice
} = require('../sessions/orchestration');
const teamMemory = require('../sessions/team-memory');
const db = require('../utils/db');

const MAX_CONCURRENT = 3;
const MAX_ROUNDS = 2;                  // delegations per user message
const SUBAGENT_TIMEOUT_MS = 5 * 60 * 1000;
const PREVIEW_CHARS = 400;

const isObjectId = (id) => /^[a-f0-9]{24}$/i.test(String(id || ''));

/**
 * Runs an orchestrator agent's sub-agents. One per Character.
 *
 * After each orchestrator turn, the reply is checked for a ```delegate``` block
 * (sessions/orchestration.js). If there is one, the sub-tasks run as headless sessions —
 * no windows — at most MAX_CONCURRENT at a time and in dependency order. Each sees the
 * team memory as it is when it starts (so later tasks see what earlier ones saved) and
 * the results of the tasks it depends on. Progress goes to the chat as cards and to the
 * Tasks page; when every sub-task has finished, the results go back to the orchestrator
 * as an internal message and its reply is the final answer.
 */
class Orchestrator {
  constructor(char) {
    this.char = char;
    this.run = null;
    this.round = 0; // delegation rounds for the current user message
  }

  isRunning() {
    return !!this.run;
  }

  /** A new message from the user: the round limit starts over. */
  onUserMessage() {
    this.round = 0;
  }

  /** Called on every orchestrator turnComplete. */
  async handleTurn() {
    const session = this.char.session;
    if (!session || this.run) return;
    const reply = latestReply(session.history);
    if (!reply) return;

    // The orchestrator's own notes for team memory
    const notes = parseMemoryNotes(reply);
    if (notes.length) await this.saveNotes(notes, { author: 'orchestrator', provider: this.char.providerKey() });

    if (this.char.orchestrator === false) return;
    const plan = parseDelegation(reply, {
      isKnownProvider: (k) => providers.isKnownProvider(k),
      defaultProvider: this.char.providerKey()
    });
    if (!plan) return;
    if (plan.error) {
      this.char.sendToChat('chat-error', `Couldn't start sub-agents: ${plan.error}`);
      return;
    }
    if (this.round >= MAX_ROUNDS) {
      this.char.sendToChat('chat-error', `Sub-agents were already used ${MAX_ROUNDS} times for this message, so this plan wasn't run. Send a new message to continue.`);
      return;
    }
    await this.runRound(plan.tasks.map(t => ({ ...t, provider: providers.resolveProviderKey(t.provider) })));
  }

  async runRound(planTasks) {
    this.round++;
    const runId = crypto.randomUUID();
    const known = providers.listProviders();
    const info = (key) => known.find(p => p.key === key) || { name: key, emoji: '•' };
    const run = {
      runId,
      round: this.round,
      cancelled: false,
      sessions: new Map(),
      notes: [],
      tasks: planTasks.map(t => ({
        ...t,
        providerName: info(t.provider).name,
        emoji: info(t.provider).emoji,
        status: t.dependsOn.length ? 'waiting' : 'queued',
        result: '',
        error: '',
        startedAt: null,
        finishedAt: null,
        docId: null
      }))
    };
    this.run = run;
    this.char.startThinking();
    await this.createTaskDocs(run);
    this.publish();

    try {
      await this.schedule(run);
    } finally {
      this.run = null;
    }

    // A compact record in the orchestrator's history (shown as a summary card on replay)
    const summary = run.tasks.map(t => `${t.status === 'done' ? '✓' : '✗'} ${t.title} (${t.providerName})`).join('\n');
    this.char.session?.history.push({ role: 'delegation', text: summary, runId });
    this.publish({ run, active: false });

    if (!this.char.session) return;
    const message = buildResultsMessage(run.tasks, run.notes, { finalRound: this.round >= MAX_ROUNDS });
    this.char.startThinking();
    this.char.session.send(message, [], { internal: true });
  }

  /** Start tasks as their dependencies finish, at most MAX_CONCURRENT at once. */
  async schedule(run) {
    const running = new Map(); // id → promise
    const settled = (t) => t.status === 'done' || t.status === 'failed';
    for (;;) {
      if (run.cancelled) {
        run.tasks.filter(t => !settled(t) && !running.has(t.id)).forEach(t => this.finishTask(run, t, 'failed', '', 'Cancelled'));
      }
      const ready = run.cancelled ? [] : run.tasks.filter(t =>
        !settled(t) && !running.has(t.id) && t.dependsOn.every(d => settled(run.tasks.find(x => x.id === d))));
      for (const t of ready) {
        if (running.size >= MAX_CONCURRENT) break;
        running.set(t.id, this.runSubAgent(run, t).finally(() => running.delete(t.id)));
      }
      if (!running.size) break;
      await Promise.race(running.values());
    }
  }

  /** One sub-agent: a fresh headless session that does one task and is shut down. */
  async runSubAgent(run, task) {
    const char = this.char;
    task.status = 'running';
    task.startedAt = Date.now();
    this.updateTaskDoc(task, { status: 'in-progress', startedAt: new Date(task.startedAt) });
    this.publish();

    const memory = await teamMemory.getMemoryText(char.agentId);
    const depResults = task.dependsOn.map(id => run.tasks.find(t => t.id === id)).filter(Boolean)
      .map(t => ({ title: t.title, status: t.status, result: t.result || t.error }));

    let session;
    try {
      session = providers.createSession(task.provider, { toolsEnabled: char.toolsEnabled !== false });
    } catch (err) {
      return this.finishTask(run, task, 'failed', '', err.message);
    }
    session.systemPrompt = buildSubAgentInstructions({ task, memory, depResults, orchestratorName: char.name });
    session.history = [];
    if (typeof session.setApprovalFunction === 'function') {
      session.setApprovalFunction((msg) => approveToolCall(`Sub-agent "${task.title}" (working for ${char.name}):\n\n${msg}`));
    }
    run.sessions.set(task.id, session);

    await new Promise((resolve) => {
      let text = '';
      const errors = [];
      let done = false;
      let lastPublish = 0;
      const finish = (status, error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        run.sessions.delete(task.id);
        session.removeAllListeners();
        session.on('error', () => {}); // late errors from a dying process
        try { session.terminate(); } catch (_) { /* already stopped */ }
        // Resolve only once its notes are saved: tasks that depend on this one start
        // next and must see them in team memory
        this.finishTask(run, task, status, text, error).catch(() => {}).finally(resolve);
      };
      task.cancel = () => finish('failed', 'Cancelled');
      const timer = setTimeout(() => finish('failed', 'Timed out after 5 minutes'), SUBAGENT_TIMEOUT_MS);
      timer.unref?.();

      session.on('text', (t) => {
        text += t;
        task.result = text;
        if (Date.now() - lastPublish > 1000) { lastPublish = Date.now(); this.publish(); }
      });
      session.on('error', (e) => {
        errors.push(String(e));
        // Some failures (missing key, CLI not installed) never reach turnComplete
        setTimeout(() => { if (!done && !session.isBusy) finish('failed', errors.join(' ')); }, 50);
      });
      session.on('turnComplete', () => {
        if (!text.trim()) return finish('failed', errors.join(' ') || 'No output');
        // A usage-limit / quota / sign-in notice printed as the "answer" is a failure
        const notice = detectProviderNotice(text);
        if (notice) {
          text = '';
          return finish('failed', `${task.providerName}: ${notice.label} — "${notice.message}"`);
        }
        finish('done', '');
      });

      try {
        session.start(getApiKey()); // the Gemini key; other providers ignore it
        session.send(task.instructions);
      } catch (err) {
        errors.push(err.message);
        finish('failed', err.message);
      }
    });
  }

  async finishTask(run, task, status, text, error) {
    if (task.status === 'done' || task.status === 'failed') return;
    task.status = status;
    task.result = (text || '').trim();
    task.error = error || '';
    task.finishedAt = Date.now();
    delete task.cancel;
    const notes = parseMemoryNotes(task.result);
    if (notes.length) {
      const added = await this.saveNotes(notes, { author: task.title, provider: task.provider, runId: run.runId });
      run.notes.push(...added);
    }
    this.updateTaskDoc(task, {
      status,
      result: task.result.slice(0, 20000),
      error: task.error,
      finishedAt: new Date(task.finishedAt)
    });
    this.publish();
  }

  /** Stop every running sub-agent; their partial results still go to the orchestrator. */
  cancel() {
    const run = this.run;
    if (!run) return false;
    run.cancelled = true;
    run.tasks.forEach(t => t.cancel && t.cancel());
    return true;
  }

  async saveNotes(notes, meta) {
    const added = await teamMemory.addNotes(this.char.agentId, notes, meta);
    if (added.length) this.char.refreshTeamMemory();
    return added;
  }

  // ── Tasks page ──

  async createTaskDocs(run) {
    if (!db.isDBConnected() || !db.Task?.create || !isObjectId(this.char.agentId)) return;
    await Promise.all(run.tasks.map(async (t) => {
      try {
        const doc = await db.Task.create({
          title: t.title,
          description: t.instructions.slice(0, 4000),
          status: 'todo',
          priority: 'medium',
          agentId: this.char.agentId,
          orchestratorRunId: run.runId,
          provider: t.provider
        });
        t.docId = doc._id;
      } catch (err) {
        console.error('[Orchestrator] Task create failed:', err.message);
      }
    }));
    notifyTasksChanged();
  }

  updateTaskDoc(task, update) {
    if (!task.docId || !db.Task?.findByIdAndUpdate) return;
    db.Task.findByIdAndUpdate(task.docId, update)
      .then(notifyTasksChanged)
      .catch(err => console.error('[Orchestrator] Task update failed:', err.message));
  }

  // ── Chat cards ──

  publish({ run = this.run, active = true } = {}) {
    if (!run) return;
    this.char.sendToChat('subagents-update', {
      runId: run.runId,
      round: run.round,
      active,
      tasks: run.tasks.map(t => ({
        id: t.id,
        title: t.title,
        provider: t.provider,
        providerName: t.providerName,
        emoji: t.emoji,
        status: t.status,
        startedAt: t.startedAt,
        finishedAt: t.finishedAt,
        preview: (t.error ? `⚠️ ${t.error}` : t.result).slice(-PREVIEW_CHARS)
      }))
    });
  }
}

/** The assistant reply that ended the latest turn (none if the turn failed). */
function latestReply(history) {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === 'assistant') return m.text;
    if (m.role === 'user') return null;
  }
  return null;
}

function notifyTasksChanged() {
  const { BrowserWindow } = require('electron');
  BrowserWindow.getAllWindows().forEach(w => { if (!w.isDestroyed()) w.webContents.send('tasks-updated'); });
}

/** Tasks left running when the app closed can't finish any more: mark them failed. */
async function markInterruptedTasks() {
  if (!db.isDBConnected() || !db.Task?.updateMany) return;
  try {
    await db.Task.updateMany(
      { orchestratorRunId: { $exists: true, $ne: null }, status: { $in: ['todo', 'in-progress'] } },
      { status: 'failed', error: 'Interrupted — the app was closed while it ran', finishedAt: new Date() }
    );
  } catch (err) {
    console.error('[Orchestrator] Could not update interrupted tasks:', err.message);
  }
}

module.exports = { Orchestrator, markInterruptedTasks, latestReply, MAX_CONCURRENT, MAX_ROUNDS, SUBAGENT_TIMEOUT_MS };
