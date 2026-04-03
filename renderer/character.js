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
  if (data.walking && !isWalking) {
    charEl.querySelector('.sprite-container').classList.add('walking');
    isWalking = true;
  } else if (!data.walking && isWalking) {
    charEl.querySelector('.sprite-container').classList.remove('walking');
    isWalking = false;
  }

  // Direction
  if (data.direction === 'left') {
    charEl.className = 'facing-left';
  } else {
    charEl.className = 'facing-right';
  }

  if (isWalking) {
    charEl.querySelector('.sprite-container').classList.add('walking');
  }
});

// Click handler
charEl.addEventListener('click', () => {
  window.assistant.characterClicked();
});

// Request initial position
window.assistant.requestPosition();
