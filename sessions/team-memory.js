/**
 * Team memory: short notes an orchestrator agent and its sub-agents share. Saved in
 * MongoDB (TeamMemory) so they last across runs and restarts; without a database they
 * live in memory for this app session only.
 *
 * Notes come from ```remember``` blocks in model output (sessions/orchestration.js) and
 * are fed back into orchestrator and sub-agent prompts — that's how sub-agents that run
 * later see what earlier ones found.
 */
const db = require('../utils/db');

const fallback = new Map(); // agentId → [{ _id, text, author, provider, runId, createdAt }]
let warned = false;
let nextId = 1;

function useDb(agentId) {
  if (!db.TeamMemory || !db.isDBConnected()) return false;
  return /^[a-f0-9]{24}$/i.test(String(agentId)); // a real Agent document id
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn('[TeamMemory] No database connected — team memory is kept only until the app quits');
}

/** All notes for an agent, oldest first: [{ _id, text, author, provider, runId, createdAt }]. */
async function listNotes(agentId) {
  if (!agentId) return [];
  if (useDb(agentId)) {
    const docs = await db.TeamMemory.find({ agentId }).sort({ createdAt: 1 }).limit(500);
    return docs.map(d => {
      const o = d.toObject ? d.toObject() : d;
      return { ...o, _id: String(o._id), agentId: String(o.agentId) };
    });
  }
  warnOnce();
  return [...(fallback.get(String(agentId)) || [])];
}

/** Notes as prompt text: the newest that fit in maxChars, shown oldest → newest. */
function formatMemory(notes, { maxChars = 3000 } = {}) {
  const lines = [];
  let total = 0;
  for (let i = notes.length - 1; i >= 0; i--) {
    const line = `- ${notes[i].text}${notes[i].author && notes[i].author !== 'orchestrator' ? ` (from ${notes[i].author})` : ''}`;
    if (total + line.length > maxChars) break;
    lines.unshift(line);
    total += line.length + 1;
  }
  return lines.join('\n');
}

async function getMemoryText(agentId, opts) {
  try {
    return formatMemory(await listNotes(agentId), opts);
  } catch (err) {
    console.error('[TeamMemory] Read failed:', err.message);
    return '';
  }
}

/** Save notes (skips exact duplicates of existing notes). Returns the notes added. */
async function addNotes(agentId, notes, { author = 'orchestrator', provider = '', runId = '' } = {}) {
  if (!agentId || !notes.length) return [];
  try {
    const existing = new Set((await listNotes(agentId)).map(n => n.text.toLowerCase()));
    const fresh = [...new Set(notes)].filter(n => !existing.has(n.toLowerCase()));
    if (!fresh.length) return [];
    const meta = { author: String(author).slice(0, 120), provider, runId };
    if (useDb(agentId)) {
      await db.TeamMemory.insertMany(fresh.map(text => ({ agentId, text, ...meta })));
    } else {
      const list = fallback.get(String(agentId)) || [];
      fresh.forEach(text => list.push({ _id: `mem${nextId++}`, agentId: String(agentId), text, ...meta, createdAt: new Date() }));
      fallback.set(String(agentId), list);
    }
    return fresh;
  } catch (err) {
    console.error('[TeamMemory] Save failed:', err.message);
    return [];
  }
}

async function deleteNote(agentId, noteId) {
  if (useDb(agentId)) {
    const res = await db.TeamMemory.deleteOne({ _id: noteId, agentId });
    return res.deletedCount > 0;
  }
  const list = fallback.get(String(agentId)) || [];
  const next = list.filter(n => n._id !== noteId);
  fallback.set(String(agentId), next);
  return next.length !== list.length;
}

async function clearMemory(agentId) {
  if (useDb(agentId)) {
    await db.TeamMemory.deleteMany({ agentId });
  } else {
    fallback.delete(String(agentId));
  }
  return true;
}

module.exports = { listNotes, formatMemory, getMemoryText, addNotes, deleteNote, clearMemory };
