const { screen } = require('electron');

/**
 * Detect taskbar/dock position and geometry using Electron's screen API.
 * Works cross-platform: Windows (taskbar), Linux (panels), macOS (dock).
 */
function getTaskbarGeometry() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.bounds;
  const workArea = primaryDisplay.workArea;

  // Determine taskbar position by comparing bounds vs workArea
  let position = 'bottom';
  let taskbarHeight = 0;
  let taskbarWidth = screenW;
  let taskbarX = 0;
  let taskbarY = screenH;

  const bottomGap = screenH - (workArea.y + workArea.height);
  const topGap = workArea.y;
  const leftGap = workArea.x;
  const rightGap = screenW - (workArea.x + workArea.width);

  if (bottomGap > topGap && bottomGap > leftGap && bottomGap > rightGap) {
    position = 'bottom';
    taskbarHeight = bottomGap;
    taskbarWidth = screenW;
    taskbarX = 0;
    taskbarY = screenH - bottomGap;
  } else if (topGap > bottomGap && topGap > leftGap && topGap > rightGap) {
    position = 'top';
    taskbarHeight = topGap;
    taskbarWidth = screenW;
    taskbarX = 0;
    taskbarY = 0;
  } else if (leftGap > 0) {
    position = 'left';
    taskbarHeight = screenH;
    taskbarWidth = leftGap;
    taskbarX = 0;
    taskbarY = 0;
  } else if (rightGap > 0) {
    position = 'right';
    taskbarHeight = screenH;
    taskbarWidth = rightGap;
    taskbarX = screenW - rightGap;
    taskbarY = 0;
  }

  // Always make the character walk at the bottom of the work area,
  // regardless of where the primary taskbar is detected.
  // This ensures they stay on the bottom dock or bottom of the screen.
  let walkZone = {
    x: Math.round(screenW * 0.15),
    y: workArea.y + workArea.height,
    width: Math.round(screenW * 0.7),
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

/**
 * Get the Y position for a character above the taskbar (bottom position).
 */
function getCharacterY(taskbarGeometry, characterHeight = 64) {
  return taskbarGeometry.workArea.y + taskbarGeometry.workArea.height - characterHeight;
}

module.exports = { getTaskbarGeometry, getCharacterY };
