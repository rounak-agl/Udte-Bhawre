const path = require('path');
const Store = require('../sessions/store');

/**
 * Sound effect management.
 * Uses Web Audio API in renderer process via IPC.
 */

let soundsEnabled = true;

// Load saved setting
try {
  const stored = Store.load();
  if (typeof stored.soundsEnabled === 'boolean') {
    soundsEnabled = stored.soundsEnabled;
  }
} catch (e) {
  // defaults
}

function isSoundsEnabled() {
  return soundsEnabled;
}

function toggleSounds() {
  soundsEnabled = !soundsEnabled;
  _saveSounds();
  return soundsEnabled;
}

function setSoundsEnabled(val) {
  soundsEnabled = val;
  _saveSounds();
}

function _saveSounds() {
  Store.save({ soundsEnabled });
}

module.exports = { isSoundsEnabled, toggleSounds, setSoundsEnabled };
