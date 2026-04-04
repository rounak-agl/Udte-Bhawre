const mongoose = require('mongoose');

let isConnected = false;

// Connect to MongoDB
async function connectDB(uri) {
  if (!uri) {
    console.log('[DB] No MongoDB URI provided — dashboard/history features disabled.');
    return false;
  }
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000, // Fail fast if unreachable
    });
    isConnected = true;
    console.log('[DB] Connected to MongoDB successfully.');
    return true;
  } catch (error) {
    isConnected = false;
    console.error('[DB] Failed to connect to MongoDB:', error.message);
    return false;
  }
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

// Models
const Agent = mongoose.model('Agent', agentSchema);
const ChatSession = mongoose.model('ChatSession', chatSessionSchema);

module.exports = {
  connectDB,
  isDBConnected,
  Agent,
  ChatSession
};
