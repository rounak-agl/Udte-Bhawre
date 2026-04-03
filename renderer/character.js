const charEl = document.getElementById('character');

let color = '#66b88d';
let colorDark = '#4a9b72';

// Listen for config from main process
window.assistant.onCharacterConfig((config) => {
  if (config.color) {
    color = config.color;
    colorDark = config.colorDark || config.color;
    document.documentElement.style.setProperty('--char-color', color);
    document.documentElement.style.setProperty('--char-color-dark', colorDark);
  }
});

// Walking state
let isWalking = false;

window.assistant.onPositionUpdate((data) => {
  const spriteContainer = charEl.querySelector('.sprite-container');

  if (data.walking && !isWalking) {
    spriteContainer.classList.add('walking');
    isWalking = true;
  } else if (!data.walking && isWalking) {
    spriteContainer.classList.remove('walking');
    isWalking = false;
  }

  // Direction — use classList instead of overwriting className
  charEl.classList.remove('facing-left', 'facing-right');
  charEl.classList.add(data.direction === 'left' ? 'facing-left' : 'facing-right');
});

// Click handler
charEl.addEventListener('click', () => {
  window.assistant.characterClicked();
});

// Request initial position
window.assistant.requestPosition();
