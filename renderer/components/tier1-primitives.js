// renderer/components/tier1-primitives.js

function pfCreateElement(tag, className = '', attrs = {}) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  Object.entries(attrs).forEach(([key, val]) => {
    if (key === 'innerHTML') el.innerHTML = val;
    else if (key === 'textContent') el.textContent = val;
    else if (val !== undefined && val !== null) el.setAttribute(key, val);
  });
  return el;
}

function PFButton({ label, variant = 'primary', size = 'md', icon, disabled, onClick }) {
  const isIconOnly = icon && !label;
  const btn = pfCreateElement('button', `pf-btn pf-btn--${variant} pf-btn--${size} ${isIconOnly ? 'pf-btn--icon' : ''}`);
  if (disabled) btn.disabled = true;
  
  if (icon) {
    const iconEl = pfCreateElement('span', 'pf-btn-icon', { innerHTML: icon });
    btn.appendChild(iconEl);
  }
  if (label) {
    const labelEl = pfCreateElement('span', 'pf-btn-label', { textContent: label });
    btn.appendChild(labelEl);
  }
  
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

const PF_EYE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const PF_EYE_OFF_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

/**
 * @param {boolean} [revealable] - for type 'password': adds a show/hide button
 */
function PFInput({ label, placeholder, type = 'text', value = '', disabled, onInput, id, revealable = false }) {
  const wrapper = pfCreateElement('div', 'pf-input-wrapper');

  const inputId = id || `pf-input-${Math.random().toString(36).substr(2, 9)}`;

  if (label) {
    const lbl = pfCreateElement('label', 'pf-input-label', { textContent: label, for: inputId });
    wrapper.appendChild(lbl);
  }

  const input = pfCreateElement('input', 'pf-input', { type, placeholder, id: inputId });
  input.value = value;
  if (disabled) input.disabled = true;
  if (onInput) input.addEventListener('input', (e) => onInput(e.target.value));

  if (revealable && type === 'password') {
    // Secrets: never let the browser autofill/remember them, and offer show/hide
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    const field = pfCreateElement('div', 'pf-input-secret');
    const toggle = pfCreateElement('button', 'pf-input-reveal', {
      type: 'button',
      title: 'Show',
      'aria-label': 'Show value',
      'aria-pressed': 'false',
      'aria-controls': inputId,
      innerHTML: PF_EYE_ICON
    });
    toggle.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.innerHTML = show ? PF_EYE_OFF_ICON : PF_EYE_ICON;
      toggle.title = show ? 'Hide' : 'Show';
      toggle.setAttribute('aria-label', show ? 'Hide value' : 'Show value');
      toggle.setAttribute('aria-pressed', String(show));
    });
    field.appendChild(input);
    field.appendChild(toggle);
    wrapper.appendChild(field);
    return wrapper;
  }

  wrapper.appendChild(input);
  return wrapper;
}

function PFBadge({ label, variant = 'default', dot = false }) {
  const badge = pfCreateElement('span', `pf-badge pf-badge--${variant}`);
  if (dot) {
    badge.appendChild(pfCreateElement('span', 'pf-badge-dot'));
  }
  badge.appendChild(pfCreateElement('span', '', { textContent: label }));
  return badge;
}

function PFAvatar({ src, initials, size = 'md', shape = 'circle' }) {
  const avatar = pfCreateElement('div', `pf-avatar pf-avatar--${size} pf-avatar--${shape}`);
  if (src) {
    avatar.appendChild(pfCreateElement('img', '', { src }));
  } else if (initials) {
    avatar.textContent = initials;
  }
  return avatar;
}

window.PFButton = PFButton;
window.PFInput = PFInput;
window.PFBadge = PFBadge;
window.PFAvatar = PFAvatar;
window.pfCreateElement = pfCreateElement; // Export helper for reuse
