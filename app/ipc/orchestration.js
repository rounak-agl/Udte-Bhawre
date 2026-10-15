const { ipcMain } = require('electron');
const { requireControlCentre } = require('../security');
const { findCharacter } = require('../agents');
const { isDBConnected, Agent } = require('../../utils/db');
const teamMemory = require('../../sessions/team-memory');

const validId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 64;

/** IPC for orchestrator agents (Control Centre → Agents): the toggle and team memory. */
function registerOrchestrationIpc() {
  ipcMain.handle('set-agent-orchestrator', async (event, agentId, enabled) => {
    if (!requireControlCentre(event, 'set-agent-orchestrator')) return false;
    if (!validId(agentId) || typeof enabled !== 'boolean') return false;
    const char = findCharacter(agentId);
    if (char) char.setOrchestrator(enabled);
    if (isDBConnected()) {
      try {
        await Agent.findByIdAndUpdate(agentId, { orchestrator: enabled });
      } catch (err) {
        console.error('[DB] Failed to save orchestrator setting:', err.message);
        return false;
      }
    }
    return true;
  });

  ipcMain.handle('get-team-memory', async (event, agentId) => {
    if (!requireControlCentre(event, 'get-team-memory')) return [];
    if (!validId(agentId)) return [];
    try {
      const notes = await teamMemory.listNotes(agentId);
      return notes.map(n => ({
        _id: String(n._id), text: n.text, author: n.author, provider: n.provider,
        createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : n.createdAt
      }));
    } catch (err) {
      console.error('[TeamMemory] List failed:', err.message);
      return [];
    }
  });

  ipcMain.handle('delete-team-memory', async (event, agentId, noteId) => {
    if (!requireControlCentre(event, 'delete-team-memory')) return false;
    if (!validId(agentId) || !validId(noteId)) return false;
    const ok = await teamMemory.deleteNote(agentId, noteId).catch(() => false);
    if (ok) findCharacter(agentId)?.refreshTeamMemory();
    return ok;
  });

  ipcMain.handle('clear-team-memory', async (event, agentId) => {
    if (!requireControlCentre(event, 'clear-team-memory')) return false;
    if (!validId(agentId)) return false;
    const ok = await teamMemory.clearMemory(agentId).catch(() => false);
    if (ok) findCharacter(agentId)?.refreshTeamMemory();
    return ok;
  });
}

module.exports = { registerOrchestrationIpc };
