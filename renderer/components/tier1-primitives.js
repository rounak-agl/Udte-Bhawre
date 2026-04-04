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

function PFInput({ label, placeholder, type = 'text', value = '', disabled, onInput, id }) {
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
