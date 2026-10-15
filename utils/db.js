const mongoose = require('mongoose');

let isConnected = false;
let lastError = '';

// Connection changes run one at a time: two quick saves in Settings must not call
// mongoose.connect() concurrently (it throws on overlapping connection strings).
let queue = Promise.resolve();
function serialized(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// Connect to MongoDB (replacing any existing connection)
function connectDB(uri, { timeoutMs = 10000 } = {}) {
  return serialized(() => connectNow(uri, timeoutMs));
}

async function connectNow(uri, timeoutMs) {
  if (mongoose.connection.readyState !== 0) {
    try { await mongoose.disconnect(); } catch (_) {}
  }
  if (!uri) {
    isConnected = false;
    lastError = 'No MongoDB URI set';
    console.log('[DB] No MongoDB URI provided — dashboard/history features disabled.');
    return false;
  }
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: timeoutMs, // Fail fast if unreachable
    });
    isConnected = true;
    lastError = '';
    console.log('[DB] Connected to MongoDB successfully.');
    return true;
  } catch (error) {
    isConnected = false;
    lastError = error.message;
    console.error('[DB] Failed to connect to MongoDB:', error.message);
    return false;
  }
}

/**
 * Switch databases at runtime (Settings). The new URI is tried on a separate test
 * connection first, so a typo doesn't drop a database that's working.
 * @returns {Promise<{ connected: boolean, error?: string, keptPrevious?: boolean }>}
 */
function switchDB(uri, { timeoutMs = 10000 } = {}) {
  return serialized(async () => {
    if (!uri) {
      await connectNow('', timeoutMs);
      return { connected: false, error: 'No MongoDB URI set' };
    }
    let probe;
    try {
      probe = mongoose.createConnection(uri, { serverSelectionTimeoutMS: timeoutMs });
      await probe.asPromise();
    } catch (err) {
      if (probe) await probe.close().catch(() => {});
      console.error('[DB] New MongoDB URI did not connect:', err.message);
      return { connected: false, error: err.message, keptPrevious: isDBConnected() };
    }
    await probe.close().catch(() => {});
    const ok = await connectNow(uri, timeoutMs);
    return ok ? { connected: true } : { connected: false, error: lastError, keptPrevious: false };
  });
}

function isDBConnected() {
  return isConnected && mongoose.connection.readyState === 1;
}

// Schemas
const agentSchema = new mongoose.Schema({
  name: { type: String, required: true, default: 'Buddy' },
  color: { type: String, default: '#66b88d' },
  theme: { type: String, default: 'Midnight', enum: ['Peach', 'Midnight', 'Cloud', 'Moss'] },
  provider: { type: String, default: 'claude' },
  contextFile: { type: String, default: '' },
  autoLaunch: { type: Boolean, default: false },
  toolsEnabled: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
  role: { type: String, required: true },
  text: { type: String, default: '' },
  isTool: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
});

const chatSessionSchema = new mongoose.Schema({
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true },
  title: { type: String, default: 'New Conversation' },
  messages: [messageSchema],
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

const taskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  status: { type: String, enum: ['todo', 'in-progress', 'done'], default: 'todo' },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent' },
  createdAt: { type: Date, default: Date.now }
});



// Models
const Agent = mongoose.model('Agent', agentSchema);
const ChatSession = mongoose.model('ChatSession', chatSessionSchema);
const Task = mongoose.model('Task', taskSchema);

module.exports = {
  connectDB,
  switchDB,
  isDBConnected,
  Agent,
  ChatSession,
  Task
};
