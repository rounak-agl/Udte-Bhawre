// Loads the real main.js under plain Node with stubbed Electron windows/IPC and an
// in-memory fake of utils/db.js, so main-process behaviour can be driven end to end.
const path = require('path');
const { EventEmitter } = require('events');
const { REPO, stubElectron, quiet, waitFor } = require('./helpers');

function createHarness() {
  const ipcOn = {};
  const ipcHandle = {};
  const sent = []; // { wc, channel, args }
  const windows = [];

  class FakeWebContents extends EventEmitter {
    send(channel, ...args) { sent.push({ wc: this, channel, args }); }
    isLoading() { return !!this._loading; }
  }
  class FakeBrowserWindow extends EventEmitter {
    constructor() {
      super();
      this.webContents = new FakeWebContents();
      this._destroyed = false;
      this._bounds = { x: 100, y: 900, width: 64, height: 80 };
      windows.push(this);
    }
    loadFile() {
      this.webContents._loading = true;
      setImmediate(() => {
        this.webContents._loading = false;
        if (!this._destroyed) this.webContents.emit('did-finish-load');
      });
    }
    isDestroyed() { return this._destroyed; }
    destroy() { if (this._destroyed) return; this._destroyed = true; this.emit('closed'); }
    close() { this.destroy(); }
    getBounds() { return this._bounds; }
    setBounds(b) { this._bounds = b; }
    show() {} hide() {} focus() {} restore() {} setIgnoreMouseEvents() {}
    isVisible() { return false; }
    isMinimized() { return false; }
    static getAllWindows() { return windows.filter(w => !w._destroyed); }
  }

  const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  stubElectron({
    app: {
      commandLine: { appendSwitch() {} }, disableHardwareAcceleration() {},
      whenReady: () => new Promise(() => {}), // never "ready": no tray/update loop in tests
      on() {}, quit() {}, isReady: () => false, getVersion: () => '0.0.0-test'
    },
    BrowserWindow: FakeBrowserWindow,
    ipcMain: { on: (c, f) => { ipcOn[c] = f; }, handle: (c, f) => { ipcHandle[c] = f; } },
    screen: { getPrimaryDisplay: () => display },
    Tray: class { setToolTip() {} setContextMenu() {} },
    Menu: { buildFromTemplate: (t) => t },
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
    dialog: {}, shell: {}, clipboard: {}, desktopCapturer: {}, Notification: class {}
  });

  // ── In-memory fake of utils/db.js ──
  const db = { chats: new Map(), agentsSaved: [], agentsDeleted: [], agentUpdates: [], taskUpdates: [], writes: 0, agentsInDb: [] };
  let nextId = 1;
  let clock = Date.now();
  class ChatSession {
    constructor(data) { Object.assign(this, data); }
    async save() {
      this._id = `cs${nextId++}`;
      this.updatedAt = new Date(++clock);
      db.chats.set(this._id, { ...this });
      db.writes++;
      return this;
    }
    static findOne(q) {
      return {
        sort: async () => {
          const d = [...db.chats.values()].filter(x => x.agentId === q.agentId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
          return d ? { ...d, toObject: () => ({ ...d }) } : null;
        }
      };
    }
    static async findByIdAndUpdate(id, upd) {
      if (!db.chats.has(id)) return null;
      const d = { ...db.chats.get(id), ...upd, updatedAt: new Date(++clock) };
      db.chats.set(id, d);
      db.writes++;
      return d;
    }
    static async findByIdAndDelete(id) { const d = db.chats.get(id); db.chats.delete(id); return d; }
    static async deleteMany(q) { for (const [k, d] of db.chats) if (d.agentId === q.agentId) db.chats.delete(k); }
  }
  class Agent {
    constructor(data) { this.data = data; }
    async save() { db.agentsSaved.push(this.data); return this; }
    static async findByIdAndUpdate(id, upd) { db.agentUpdates.push([id, upd]); }
    static async findByIdAndDelete(id) { db.agentsDeleted.push(id); }
    static find() { return { sort: async () => db.agentsInDb.map(a => ({ ...a })) }; }
  }
  require.cache[path.join(REPO, 'utils/db.js')] = {
    exports: {
      connectDB: async () => true,
      // 'mongodb://good' connects; anything else fails while the previous DB stays up
      switchDB: async (uri) => (uri === 'mongodb://good'
        ? { connected: true }
        : { connected: false, error: 'connection refused', keptPrevious: true }),
      isDBConnected: () => true,
      ChatSession,
      Agent,
      Task: { updateMany: async (q, u) => { db.taskUpdates.push([q, u]); } }
    }
  };

  const sentTo = (win, channel) => sent.filter(s => s.wc === win.webContents && s.channel === channel);

  return {
    ipcOn, ipcHandle, sent, windows, db, sentTo,
    lastWindow: () => windows[windows.length - 1],
    async load() {
      this.main = await quiet(() => require(path.join(REPO, 'main.js')));
      return this.main;
    },
    async openControlCentre() {
      await quiet(() => this.main.openControlCentre('dashboard'));
      return this.lastWindow();
    },
    /** Launch an agent; returns its character window. */
    async launch(agent) {
      await quiet(() => this.main.launchAgentInstance(agent));
      return this.lastWindow();
    },
    /** Click a character; resolves with its chat window once that has loaded (got chat-init). */
    async openChat(charWin) {
      const existing = new Set(windows);
      await quiet(async () => {
        ipcOn['character-clicked']({ sender: charWin.webContents });
        await waitFor(() => windows.some(w => !existing.has(w) && sentTo(w, 'chat-init').length > 0));
      });
      return windows.find(w => !existing.has(w) && sentTo(w, 'chat-init').length > 0);
    },
    /** Send a chat message; resolves once the turn finished AND it was saved to the DB. */
    async chat(chatWin, text) {
      const turnsBefore = sentTo(chatWin, 'chat-turn-complete').length;
      const writesBefore = db.writes;
      await quiet(async () => {
        ipcOn['chat-send']({ sender: chatWin.webContents }, text);
        await waitFor(() => sentTo(chatWin, 'chat-turn-complete').length > turnsBefore);
        await waitFor(() => db.writes > writesBefore);
      });
    }
  };
}

module.exports = { createHarness };
