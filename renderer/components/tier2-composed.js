// renderer/components/tier2-composed.js

function PFCard({ title, subtitle, body, footer = [], compact = false, imageSrc }) {
  const card = pfCreateElement('div', `pf-card ${compact ? 'pf-card--compact' : ''}`);
  
  if (imageSrc) {
    card.appendChild(pfCreateElement('img', 'pf-card-img', { src: imageSrc }));
  }

  const bodyEl = pfCreateElement('div', 'pf-card-body');
  if (title) bodyEl.appendChild(pfCreateElement('h3', 'pf-card-title', { textContent: title }));
  if (subtitle) bodyEl.appendChild(pfCreateElement('div', 'pf-card-subtitle', { textContent: subtitle }));
  
  if (body) {
    if (typeof body === 'string') {
      bodyEl.appendChild(pfCreateElement('div', 'pf-card-content', { textContent: body }));
    } else {
      const contentEl = pfCreateElement('div', 'pf-card-content');
      contentEl.appendChild(body);
      bodyEl.appendChild(contentEl);
    }
  }
  card.appendChild(bodyEl);

  if (footer && footer.length > 0) {
    const footerEl = pfCreateElement('div', 'pf-card-footer');
    footer.forEach(f => footerEl.appendChild(f));
    card.appendChild(footerEl);
  }

  return card;
}

const PFToast = {
  container: null,
  init() {
    if (!this.container) {
      this.container = pfCreateElement('div', '', { id: 'pf-toast-container' });
      document.body.appendChild(this.container);
    }
  },
  show(title, message, type = 'default', duration = 3000) {
    this.init();
    const toast = pfCreateElement('div', `pf-toast pf-toast--${type}`);
    toast.appendChild(pfCreateElement('div', 'pf-toast-title', { textContent: title }));
    if (message) toast.appendChild(pfCreateElement('div', 'pf-toast-message', { textContent: message }));
    
    this.container.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'fadeOut 300ms forwards';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },
  success(t, m) { this.show(t, m, 'success'); },
  error(t, m) { this.show(t, m, 'error'); }
};

window.PFCard = PFCard;
window.PFToast = PFToast;
