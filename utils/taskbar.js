const { screen } = require('electron');

/**
 * Detect taskbar/dock position and geometry using Electron's screen API.
 * Works cross-platform: Windows (taskbar), Linux (panels), macOS (dock).
 */
function getTaskbarGeometry() {
  const primaryDisplay = screen.getPrimaryDisplay();
  // bounds/workArea are absolute desktop coordinates; on multi-monitor setups the
  // primary display need not start at (0,0), so every result below includes the offset.
  const { x: screenX, y: screenY, width: screenW, height: screenH } = primaryDisplay.bounds;
  const workArea = primaryDisplay.workArea;

  // Determine taskbar position by comparing bounds vs workArea
  let position = 'bottom';
  let taskbarHeight = 0;
  let taskbarWidth = screenW;
  let taskbarX = screenX;
  let taskbarY = screenY + screenH;

  const bottomGap = (screenY + screenH) - (workArea.y + workArea.height);
  const topGap = workArea.y - screenY;
  const leftGap = workArea.x - screenX;
  const rightGap = (screenX + screenW) - (workArea.x + workArea.width);

  if (bottomGap > topGap && bottomGap > leftGap && bottomGap > rightGap) {
    position = 'bottom';
    taskbarHeight = bottomGap;
    taskbarWidth = screenW;
    taskbarX = screenX;
    taskbarY = screenY + screenH - bottomGap;
  } else if (topGap > bottomGap && topGap > leftGap && topGap > rightGap) {
    position = 'top';
    taskbarHeight = topGap;
    taskbarWidth = screenW;
    taskbarX = screenX;
    taskbarY = screenY;
  } else if (leftGap > 0) {
    position = 'left';
    taskbarHeight = screenH;
    taskbarWidth = leftGap;
    taskbarX = screenX;
    taskbarY = screenY;
  } else if (rightGap > 0) {
    position = 'right';
    taskbarHeight = screenH;
    taskbarWidth = rightGap;
    taskbarX = screenX + screenW - rightGap;
    taskbarY = screenY;
  }

  // Always make the character walk at the bottom of the work area,
  // regardless of where the primary taskbar is detected.
  // This ensures they stay on the bottom dock or bottom of the screen.
  let walkZone = {
    x: workArea.x + Math.round(workArea.width * 0.15),
    y: workArea.y + workArea.height,
    width: Math.round(workArea.width * 0.7),
    height: 80
  };

  return {
    position,
    taskbarHeight,
    taskbarWidth,
    taskbarX,
    taskbarY,
    screenW,
    screenH,
    workArea,
    walkZone
  };
}

module.exports = { getTaskbarGeometry };
