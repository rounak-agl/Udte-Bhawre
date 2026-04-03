const container = document.getElementById('overlay-container');
const stepPanel = document.getElementById('step-panel');
const stepBadge = document.getElementById('step-badge');
const stepTitle = document.getElementById('step-title');
const stepInstruction = document.getElementById('step-instruction');
const btnNext = document.getElementById('btn-next');
const btnDone = document.getElementById('btn-done');
const btnDismiss = document.getElementById('btn-dismiss');

let steps = [];
let currentStepIndex = 0;

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
  hideStepPanel();
});

// ─── Bounding box rendering ───
function addBoundingBox(element, stepNum, isActive = false) {
  const bbox = document.createElement('div');
  bbox.className = `bbox ${isActive ? 'active' : ''}`;

  // Convert normalized coords to pixels
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;

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

  // Update step panel text
  stepBadge.textContent = step.step;
  stepTitle.textContent = `Step ${step.step} of ${steps.length}`;
  stepInstruction.textContent = step.instruction;

  // Show/hide next/done buttons
  if (index >= steps.length - 1) {
    btnNext.classList.add('hidden');
    btnDone.classList.remove('hidden');
  } else {
    btnNext.classList.remove('hidden');
    btnDone.classList.add('hidden');
  }

  // ── Position the panel next to the active bounding box ──
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;
  const panelW = 280;
  // Estimate height or use actual if visible (approx 140px)
  const panelH = stepPanel.offsetHeight || 140; 
  
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
  // If it still goes off screen (bbox is very wide), try above or below
  if (panelLeft < 20 && panelLeft + panelW > screenW - 20) {
    panelLeft = bboxX;
    panelTop = bboxY + bboxH + 20;
    // If it goes off screen on bottom, place above
    if (panelTop + panelH > screenH - 20) {
      panelTop = bboxY - panelH - 20;
    }
  }

  // Final constrain to screen bounds
  panelTop = Math.max(20, Math.min(panelTop, screenH - panelH - 20));
  panelLeft = Math.max(20, Math.min(panelLeft, screenW - panelW - 20));

  stepPanel.style.left = `${panelLeft}px`;
  stepPanel.style.top = `${panelTop}px`;

  stepPanel.classList.remove('hidden');

  // Tell main process to fly character to this element
  window.assistant.flyToElement({
    x: step.element.x,
    y: step.element.y,
    width: step.element.width,
    height: step.element.height
  });
}

function hideStepPanel() {
  stepPanel.classList.add('hidden');
}

function dismiss() {
  clearBoundingBoxes();
  hideStepPanel();
  steps = [];
  currentStepIndex = 0;

  // Tell main process to return character to taskbar
  window.assistant.returnCharacter();
  window.assistant.hideOverlay();
}

// ─── Button handlers ───
btnNext.addEventListener('click', () => {
  showStep(currentStepIndex + 1);
});

btnDone.addEventListener('click', () => {
  dismiss();
});

btnDismiss.addEventListener('click', () => {
  dismiss();
});

// ESC key to dismiss
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') dismiss();
});

// ─── Interactivity toggle ───
// To allow clicks on the panel through the transparent window
stepPanel.addEventListener('mouseenter', () => {
  if (window.assistant && window.assistant.overlaySetInteractive) {
    window.assistant.overlaySetInteractive(true);
  }
});

stepPanel.addEventListener('mouseleave', () => {
  if (window.assistant && window.assistant.overlaySetInteractive) {
    window.assistant.overlaySetInteractive(false);
  }
});
