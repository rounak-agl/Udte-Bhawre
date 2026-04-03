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
  let taskbarWidth = 0;
  let taskbarX = 0;
  let taskbarY = 0;

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

  // Calculate the "walk zone" — where characters walk
  // Characters walk above the taskbar (for bottom) or next to it
  let walkZone = {};
  switch (position) {
    case 'bottom':
      walkZone = {
        x: Math.round(screenW * 0.15),
        y: taskbarY,
        width: Math.round(screenW * 0.7),
        height: 80
      };
      break;
    case 'top':
      walkZone = {
        x: Math.round(screenW * 0.15),
        y: topGap,
        width: Math.round(screenW * 0.7),
        height: 80
      };
      break;
    case 'left':
      walkZone = {
        x: leftGap,
        y: Math.round(screenH * 0.3),
        width: 80,
        height: Math.round(screenH * 0.4)
      };
      break;
    case 'right':
      walkZone = {
        x: taskbarX - 80,
        y: Math.round(screenH * 0.3),
        width: 80,
        height: Math.round(screenH * 0.4)
      };
      break;
  }

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
  switch (taskbarGeometry.position) {
    case 'bottom':
      return taskbarGeometry.taskbarY - characterHeight;
    case 'top':
      return taskbarGeometry.workArea.y;
    default:
      return taskbarGeometry.screenH - characterHeight - taskbarGeometry.taskbarHeight;
  }
}

module.exports = { getTaskbarGeometry, getCharacterY };
