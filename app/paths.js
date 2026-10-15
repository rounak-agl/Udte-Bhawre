const path = require('path');

/** Where the app's files live (independent of which module asks). */
const ROOT = path.join(__dirname, '..');
const PRELOAD = path.join(ROOT, 'preload.js');
const PRELOAD_CC = path.join(ROOT, 'preload-cc.js');

module.exports = {
  ROOT,
  POLICY_FILE: path.join(ROOT, 'armoriq.policy.json'),
  rendererFile: (...parts) => path.join(ROOT, 'renderer', ...parts),
  assetFile: (name) => path.join(ROOT, 'assets', name),

  /** The webPreferences every app window uses: isolated, no Node in the page. */
  webPreferences: (preload = PRELOAD) => ({ preload, contextIsolation: true, nodeIntegration: false }),
  PRELOAD_CC
};
