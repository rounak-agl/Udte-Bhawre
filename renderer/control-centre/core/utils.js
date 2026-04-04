// renderer/control-centre/core/utils.js

const PFUtils = {
  el(tag, className = '', attrs = {}) {
    return window.pfCreateElement(tag, className, attrs);
  },
  
  appendAll(parent, ...children) {
    children.forEach(c => parent.appendChild(c));
  },

  getGreeting(name) {
    const hour = new Date().getHours();
    let greeting = 'Good evening';
    if (hour < 12) greeting = 'Good morning';
    else if (hour < 17) greeting = 'Good afternoon';
    return `${greeting}, ${name || 'Explorer'}`;
  },

  formatDate(date) {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric'
    });
  },

  formatRelativeTime(dateInput) {
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    const daysDifference = Math.round((new Date(dateInput) - new Date()) / (1000 * 60 * 60 * 24));
    if (daysDifference === 0) return 'Today';
    return rtf.format(daysDifference, 'day');
  },

  truncate(str, num) {
    if (str.length <= num) return str;
    return str.slice(0, num) + '...';
  },

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  },

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  generateId(prefix = 'id') {
    return `${prefix}_${Math.random().toString(36).substr(2, 9)}`;
  }
};

window.PFUtils = PFUtils;
