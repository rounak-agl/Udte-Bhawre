const container = document.getElementById('overlay-container');

let steps = [];
let currentStepIndex = 0;
let screenW = window.innerWidth;
let screenH = window.innerHeight;

// Receive actual screen dimensions from main process
if (window.assistant.onScreenDimensions) {
  window.assistant.onScreenDimensions((dims) => {
    screenW = dims.width;
    screenH = dims.height;
  });
}

// ─── IPC listeners ───
window.assistant.onShowStepGuide((stepsData) => {
  steps = stepsData;
  currentStepIndex = 0;
  showStep(0);
});

window.assistant.onShowBoundingBox((bbox) => {
  clearBoundingBoxes();
  addBoundingBox(bbox, 1, true);
});

window.assistant.onHideBoundingBox(() => {
  clearBoundingBoxes();
  window.assistant.hideStepPanel();
});

window.assistant.onStepPanelAction((action) => {
  if (action === 'next') showStep(currentStepIndex + 1);
  else if (action === 'done' || action === 'dismiss') dismiss();
});

// ─── Bounding box rendering ───
function addBoundingBox(element, stepNum, isActive = false) {
  const bbox = document.createElement('div');
  bbox.className = `bbox ${isActive ? 'active' : ''}`;

  bbox.style.left = `${element.x * screenW}px`;
  bbox.style.top = `${element.y * screenH}px`;
  bbox.style.width = `${element.width * screenW}px`;
  bbox.style.height = `${element.height * screenH}px`;

  // Step badge
  const badge = document.createElement('div');
  badge.className = 'bbox-badge';
  badge.textContent = stepNum;
  bbox.appendChild(badge);

  container.appendChild(bbox);
  return bbox;
}

function clearBoundingBoxes() {
  container.innerHTML = '';
}

// ─── Step guide ───
function showStep(index) {
  if (index < 0 || index >= steps.length) {
    dismiss();
    return;
  }

  currentStepIndex = index;
  const step = steps[index];

  // Clear previous boxes and show all with current highlighted
  clearBoundingBoxes();

  // Show all bounding boxes, highlight current
  steps.forEach((s, i) => {
    addBoundingBox(s.element, s.step, i === index);
  });

  // ── Position the panel next to the active bounding box ──
  const panelW = 280;
  const panelH = 160; 
  
  const bboxX = step.element.x * screenW;
  const bboxY = step.element.y * screenH;
  const bboxW = step.element.width * screenW;
  const bboxH = step.element.height * screenH;

  // Try placing it to the right of the bbox
  let panelLeft = bboxX + bboxW + 20;
  let panelTop = bboxY;

  // If it goes off screen on right, try left side
  if (panelLeft + panelW > screenW - 20) {
    panelLeft = bboxX - panelW - 20;
  }
  // If it goes off screen on the left, try below or above
  if (panelLeft < 20) {
    panelLeft = Math.max(20, bboxX);
    panelTop = bboxY + bboxH + 20;
    // If it goes off screen on bottom, place above
    if (panelTop + panelH > screenH - 20) {
      panelTop = bboxY - panelH - 20;
    }
  }

  // Final constrain to screen bounds
  panelTop = Math.max(20, Math.min(panelTop, screenH - panelH - 20));
  panelLeft = Math.max(20, Math.min(panelLeft, screenW - panelW - 20));

  window.assistant.updateStepPanel({
    x: panelLeft,
    y: panelTop,
    badge: step.step,
    title: `Step ${step.step} of ${steps.length}`,
    instruction: step.instruction,
    isLast: index >= steps.length - 1
  });

  // Tell main process to fly character to this element
  window.assistant.flyToElement({
    x: step.element.x,
    y: step.element.y,
    width: step.element.width,
    height: step.element.height
  });
}

function dismiss() {
  clearBoundingBoxes();
  window.assistant.hideStepPanel();
  steps = [];
  currentStepIndex = 0;

  // Tell main process to return character to taskbar
  window.assistant.returnCharacter();
  window.assistant.hideOverlay();
}
