const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const isWindows = process.platform === 'win32';

/**
 * Find a CLI binary cross-platform.
 * @param {string} name - Binary name (e.g., 'claude', 'codex')
 * @param {string[]} fallbackPaths - Additional paths to check
 * @returns {string|null} - Full path to binary, or null if not found
 */
function findBinary(name, fallbackPaths = []) {
  // Try 'where' on Windows, 'which' on Unix
  try {
    const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    const whereCmd = path.join(systemRoot, 'System32', 'where.exe');
    const cmd = isWindows ? `"${whereCmd}" ${name}` : `command -v ${name}`;
    const result = execSync(cmd, {
      encoding: 'utf8',
      timeout: 5000,
      env: getProcessEnv(),
      windowsHide: true
    }).trim();
    // 'where' on Windows may return multiple lines
    const firstLine = result.split('\n')[0].trim();
    if (firstLine && fs.existsSync(firstLine)) {
      return firstLine;
    }
  } catch (e) {
    // Not found via which/where
  }

  // Check fallback paths
  const home = os.homedir();
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');

  const defaultFallbacks = isWindows ? [
    path.join(home, '.local', 'bin', `${name}.exe`),
    path.join(home, '.local', 'bin', `${name}.cmd`),
    path.join(appData, 'npm', `${name}.cmd`),
    path.join(appData, 'npm', `${name}`),
    path.join(home, '.claude', 'local', 'bin', `${name}.exe`),
    path.join(programFiles, 'nodejs', `${name}.cmd`),
  ] : [
    path.join(home, '.local', 'bin', name),
    path.join(home, '.claude', 'local', 'bin', name),
    `/usr/local/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    path.join(home, '.npm-global', 'bin', name),
    `/usr/bin/${name}`,
  ];

  const allPaths = [...fallbackPaths, ...defaultFallbacks];
  for (const p of allPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Get a proper process environment with PATH including common binary locations.
 */
function getProcessEnv() {
  const env = { ...process.env };
  const home = os.homedir();

  if (isWindows) {
    const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');

    const extraPaths = [
      path.join(appData, 'npm'),
      path.join(home, '.local', 'bin'),
      path.join(home, '.claude', 'local', 'bin'),
      path.join(programFiles, 'nodejs'),
      path.join(systemRoot, 'System32'),
    ];
    // On Windows, PATH can be Path or PATH
    const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
    env[pathKey] = extraPaths.join(path.delimiter) + path.delimiter + (env[pathKey] || '');
  } else {
    const extraPaths = [
      path.join(home, '.local', 'bin'),
      path.join(home, '.claude', 'local', 'bin'),
      '/usr/local/bin',
      '/opt/homebrew/bin',
      path.join(home, '.npm-global', 'bin'),
    ];
    env.PATH = extraPaths.join(path.delimiter) + path.delimiter + (env.PATH || '');
  }

  return env;
}

module.exports = { findBinary, getProcessEnv };
