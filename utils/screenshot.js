/**
 * One screenshot of the primary screen, taken only when the user presses 📷 in a chat.
 * Nothing is captured in the background and nothing is kept: the image goes back to
 * the chat as an attachment, and the user decides whether to send it.
 *
 * Linux (especially Wayland) needs the desktop's own screenshot tool; elsewhere — or if
 * none is installed — Electron's desktopCapturer is used.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { desktopCapturer, nativeImage, screen } = require('electron');
const { findBinary } = require('./shell-env');

const execFileAsync = promisify(execFile);
const MAX_WIDTH = 1920; // plenty to read text; keeps the upload small

// Full-screen, no GUI, no notification; `{file}` is the output path
const LINUX_TOOLS = [
  { bin: 'spectacle', args: ['-f', '-b', '-n', '-o', '{file}'] },
  { bin: 'gnome-screenshot', args: ['-f', '{file}'] },
  { bin: 'grim', args: ['{file}'] },
  { bin: 'scrot', args: ['-o', '{file}'] }
];

let linuxTool; // undefined = not looked up yet, null = none found
function findLinuxTool() {
  if (linuxTool !== undefined) return linuxTool;
  const desktop = (process.env.XDG_CURRENT_DESKTOP || '').toLowerCase();
  // Prefer the desktop's own tool (spectacle on KDE, gnome-screenshot on GNOME)
  const ordered = [...LINUX_TOOLS].sort((a, b) =>
    Number(desktop.includes('gnome') && b.bin === 'gnome-screenshot') - Number(desktop.includes('gnome') && a.bin === 'gnome-screenshot'));
  linuxTool = null;
  for (const tool of ordered) {
    const bin = findBinary(tool.bin);
    if (bin) { linuxTool = { ...tool, path: bin }; break; }
  }
  return linuxTool;
}

async function captureWithLinuxTool(tool) {
  const file = path.join(os.tmpdir(), `da-screenshot-${crypto.randomUUID()}.png`);
  try {
    await execFileAsync(tool.path, tool.args.map(a => (a === '{file}' ? file : a)), { timeout: 15000 });
    // Some tools return before the file is fully written
    for (let i = 0; i < 10 && !fs.existsSync(file); i++) await new Promise(r => setTimeout(r, 100));
    const image = fs.existsSync(file) ? nativeImage.createFromPath(file) : null;
    return image && !image.isEmpty() ? image : null;
  } finally {
    fs.rm(file, { force: true }, () => {});
  }
}

async function captureWithElectron() {
  const display = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor)
    }
  });
  const source = sources.find(s => s.display_id === String(display.id)) || sources[0];
  return source && !source.thumbnail.isEmpty() ? source.thumbnail : null;
}

/** → { mimeType: 'image/jpeg', data: base64, width, height }, or throws. */
async function captureScreen() {
  let image = null;
  if (process.platform === 'linux') {
    const tool = findLinuxTool();
    if (tool) {
      try {
        image = await captureWithLinuxTool(tool);
      } catch (err) {
        console.warn(`[Screenshot] ${tool.bin} failed:`, err.message);
      }
    }
  }
  if (!image) image = await captureWithElectron();
  if (!image) throw new Error('Couldn\'t capture the screen');

  const { width } = image.getSize();
  if (width > MAX_WIDTH) image = image.resize({ width: MAX_WIDTH, quality: 'good' });
  const size = image.getSize();
  return { mimeType: 'image/jpeg', data: image.toJPEG(85).toString('base64'), width: size.width, height: size.height };
}

module.exports = { captureScreen };
