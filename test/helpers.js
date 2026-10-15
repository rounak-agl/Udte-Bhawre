// Shared test utilities. Every test file runs in its own process (node --test), so
// stubs installed here only affect that file.
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const IS_WINDOWS = process.platform === 'win32';
// Fake CLIs are small /bin/sh scripts
const POSIX_ONLY = IS_WINDOWS ? 'needs a POSIX shell for fake CLIs' : false;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `da-test-${label}-`));
}

/**
 * Point HOME at a fresh temp dir so settings, keys and file-tool checks never touch the
 * real ~/.desktop-assistant-settings.json. Call before requiring app modules
 * (sessions/store.js resolves the settings path at load time).
 */
function useTempHome(seedSettings) {
  const home = tempDir('home');
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  if (seedSettings) {
    fs.writeFileSync(path.join(home, '.desktop-assistant-settings.json'), JSON.stringify(seedSettings));
  }
  return home;
}

/** Replace require('electron') for this process. Call before requiring app modules. */
function stubElectron(exports) {
  require.cache[require.resolve(path.join(REPO, 'node_modules/electron'))] = { exports };
}

/** Write an executable fake CLI and put its folder first on PATH. */
function fakeCli(name, script) {
  const dir = tempDir(`bin-${name}`);
  fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  process.env.PATH = `${dir}${path.delimiter}${process.env.PATH}`;
  return dir;
}

/** Silence console output from app modules while fn runs. */
async function quiet(fn) {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
}

/** Resolve once `predicate()` is truthy (polling), or reject after `timeoutMs`. */
async function waitFor(predicate, { timeoutMs = 3000, intervalMs = 20 } = {}) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await sleep(intervalMs);
  }
}

/** Collect a session's events into arrays for assertions. */
function recordEvents(session) {
  const events = { text: [], error: [], turnComplete: 0, sessionReady: 0, toolUse: [], toolResult: [] };
  session.on('text', t => events.text.push(t));
  session.on('error', e => events.error.push(e));
  session.on('turnComplete', () => events.turnComplete++);
  session.on('sessionReady', () => events.sessionReady++);
  session.on('toolUse', (n, i) => events.toolUse.push([n, i]));
  session.on('toolResult', (s, e) => events.toolResult.push([s, e]));
  return events;
}

module.exports = { REPO, IS_WINDOWS, POSIX_ONLY, sleep, tempDir, useTempHome, stubElectron, fakeCli, quiet, waitFor, recordEvents };
