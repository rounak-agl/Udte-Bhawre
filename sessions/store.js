const path = require('path');
const fs = require('fs');
const os = require('os');

const STORE_FILE = path.join(os.homedir(), '.desktop-assistant-settings.json');

function load() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    }
  } catch (e) {
    // ignore
  }
  return {};
}

function save(data) {
  try {
    const existing = load();
    const merged = { ...existing, ...data };
    // Owner-only: the file holds (encrypted, or if no keychain, plain) secrets
    fs.writeFileSync(STORE_FILE, JSON.stringify(merged, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(STORE_FILE, 0o600); } catch (_) { /* e.g. Windows: ACLs instead */ }
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

module.exports = { load, save };
