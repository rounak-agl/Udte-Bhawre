/**
 * Encrypts secrets (API keys, tokens, the MongoDB URI) at rest with Electron's
 * safeStorage, which uses the OS credential store: Keychain on macOS, DPAPI on
 * Windows, and libsecret / KWallet on Linux.
 *
 * Values are kept in their stored form and only decrypted when read, because on Linux
 * safeStorage is unusable until the app's 'ready' event, while settings are loaded at
 * startup before that. Encrypted values look like "enc:v1:<base64>".
 *
 * If no OS credential store is available (e.g. a Linux session with no keyring), the
 * value is stored as plain text, as before, and status() reports that so the UI can
 * say so. Electron's "basic_text" fallback, which encrypts with a fixed password, is
 * deliberately not used; it would only look secure.
 */

const PREFIX = 'enc:v1:';

let electron = {};
try {
  const mod = require('electron');
  if (mod && typeof mod === 'object') electron = mod; // plain Node gets a path string
} catch (_) { /* not running under Electron */ }

let warnedUnavailable = false;

function isSealed(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** True once the app is ready and an OS credential store can encrypt. */
function canEncrypt() {
  const { app, safeStorage } = electron;
  try {
    return !!(safeStorage && app && app.isReady() && safeStorage.isEncryptionAvailable());
  } catch (_) {
    return false;
  }
}

/** Encrypt a secret for storage. Falls back to plain text if encryption is unavailable. */
function seal(plain) {
  if (typeof plain !== 'string' || plain === '') return '';
  if (isSealed(plain)) return plain;
  if (!canEncrypt()) {
    if (!warnedUnavailable) {
      warnedUnavailable = true;
      console.warn('[Secrets] ⚠️  OS credential store unavailable — secrets are stored unencrypted');
    }
    return plain;
  }
  return PREFIX + electron.safeStorage.encryptString(plain).toString('base64');
}

/**
 * Decrypt a stored secret. Plain (legacy) values are returned as-is. Returns '' when
 * an encrypted value can't be decrypted yet (before app ready) or at all (keyring
 * locked/changed, or the settings file was copied from another machine).
 */
function reveal(stored) {
  if (typeof stored !== 'string' || stored === '') return '';
  if (!isSealed(stored)) return stored;
  if (!canEncrypt()) return '';
  try {
    return electron.safeStorage.decryptString(Buffer.from(stored.slice(PREFIX.length), 'base64'));
  } catch (err) {
    console.error('[Secrets] Failed to decrypt a stored secret:', err.message);
    return '';
  }
}

/** For the Settings UI: { encrypted, backend } */
function status() {
  const encrypted = canEncrypt();
  let backend = null;
  try {
    if (electron.safeStorage && typeof electron.safeStorage.getSelectedStorageBackend === 'function') {
      backend = electron.safeStorage.getSelectedStorageBackend(); // Linux only
    }
  } catch (_) { /* not available on this platform */ }
  return { encrypted, backend, platform: process.platform };
}

module.exports = { seal, reveal, isSealed, canEncrypt, status };
