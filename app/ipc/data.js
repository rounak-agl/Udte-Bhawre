const { ipcMain } = require('electron');
const state = require('../state');
const { requireControlCentre } = require('../security');
const { isDBConnected, ChatSession, Task } = require('../../utils/db');

/** Stringify Mongo ids so they survive IPC (including a populated agentId). */
function plain(doc) {
  const obj = doc.toObject();
  obj._id = obj._id.toString();
  if (obj.agentId && obj.agentId._id) obj.agentId._id = obj.agentId._id.toString();
  return obj;
}

/** IPC for saved conversations and tasks (Control Centre). */
function registerDataIpc() {
  // ── Conversations ──
  ipcMain.handle('get-history', async () => {
    if (!isDBConnected()) return [];
    try {
      const sessions = await ChatSession.find().populate('agentId').sort({ updatedAt: -1 }).limit(50);
      return sessions.map(plain);
    } catch (err) {
      console.error('[DB] get-history error:', err.message);
      return [];
    }
  });

  ipcMain.handle('get-chat-messages', async (event, sessionId) => {
    if (!isDBConnected()) return [];
    try {
      const session = await ChatSession.findById(sessionId);
      return session ? session.toObject().messages : [];
    } catch (err) {
      console.error('[DB] get-chat-messages error:', err.message);
      return [];
    }
  });

  // Delete a saved conversation (Control Centre → Chat). If an agent is currently using
  // it, that agent forgets it and starts a new conversation.
  ipcMain.handle('delete-chat-session', async (event, sessionId) => {
    if (!requireControlCentre(event, 'delete-chat-session')) return false;
    if (!isDBConnected() || typeof sessionId !== 'string') return false;
    try {
      await ChatSession.findByIdAndDelete(sessionId);
      state.characters
        .filter(c => c.sessionId && c.sessionId.toString() === sessionId)
        .forEach(c => {
          c.restoredHistory = null;
          if (c.session) {
            c.createSession({ fresh: true });
          } else {
            c.sessionId = null;
            c._conversationEpoch = (c._conversationEpoch || 0) + 1;
          }
          c.sendToChat('chat-cleared');
        });
      return true;
    } catch (err) {
      console.error('[DB] delete-chat-session error:', err.message);
      return false;
    }
  });

  // ── Tasks ──
  ipcMain.handle('get-tasks', async () => {
    if (!isDBConnected()) return [];
    try {
      const tasks = await Task.find().populate('agentId').sort({ createdAt: -1 });
      return tasks.map(plain);
    } catch (err) {
      console.error('[DB] get-tasks error:', err.message);
      return [];
    }
  });

  ipcMain.handle('save-task', async (event, taskData) => {
    if (!isDBConnected()) return false;
    try {
      if (taskData._id) {
        await Task.findByIdAndUpdate(taskData._id, taskData);
      } else {
        await Task.create(taskData);
      }
      return true;
    } catch (err) {
      console.error('[DB] save-task error:', err.message);
      return false;
    }
  });

  ipcMain.handle('delete-task', async (event, id) => {
    if (!isDBConnected()) return false;
    try {
      await Task.findByIdAndDelete(id);
      return true;
    } catch (err) {
      console.error('[DB] delete-task error:', err.message);
      return false;
    }
  });
}

module.exports = { registerDataIpc };
