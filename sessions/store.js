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
    fs.writeFileSync(STORE_FILE, JSON.stringify(merged, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

module.exports = { load, save };
