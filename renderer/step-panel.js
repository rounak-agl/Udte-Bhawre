const stepBadge = document.getElementById('step-badge');
const stepTitle = document.getElementById('step-title');
const stepInstruction = document.getElementById('step-instruction');
const btnNext = document.getElementById('btn-next');
const btnDone = document.getElementById('btn-done');
const btnDismiss = document.getElementById('btn-dismiss');

window.assistant.onUpdateStepPanelData((data) => {
  stepBadge.textContent = data.badge;
  stepTitle.textContent = data.title;
  stepInstruction.textContent = data.instruction;
  
  if (data.isLast) {
    btnNext.classList.add('hidden');
    btnDone.classList.remove('hidden');
  } else {
    btnNext.classList.remove('hidden');
    btnDone.classList.add('hidden');
  }
});

btnNext.addEventListener('click', () => window.assistant.sendStepPanelAction('next'));
btnDone.addEventListener('click', () => window.assistant.sendStepPanelAction('done'));
btnDismiss.addEventListener('click', () => window.assistant.sendStepPanelAction('dismiss'));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.assistant.sendStepPanelAction('dismiss');
});
