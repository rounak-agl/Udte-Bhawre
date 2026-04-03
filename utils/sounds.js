const path = require('path');

/**
 * Sound effect management.
 * Uses Web Audio API in renderer process via IPC.
 */

let soundsEnabled = true;

function isSoundsEnabled() {
  return soundsEnabled;
}

function toggleSounds() {
  soundsEnabled = !soundsEnabled;
  return soundsEnabled;
}

function setSoundsEnabled(val) {
  soundsEnabled = val;
}

module.exports = { isSoundsEnabled, toggleSounds, setSoundsEnabled };
