// renderer/control-centre/core/extras.js

// 1. Command Palette
const PFPalette = {
  commands: [
    { id: 'nav-dashboard', label: 'Go to Dashboard', icon: window.PFIcons.dashboard, action: () => window.router.navigate('/dashboard') },
    { id: 'nav-chat', label: 'Go to Chat', icon: window.PFIcons.chat, action: () => window.router.navigate('/chat') },
    { id: 'nav-tasks', label: 'Go to Tasks', icon: window.PFIcons.tasks, action: () => window.router.navigate('/tasks') },
    { id: 'theme-toggle', label: 'Toggle Theme', icon: window.PFIcons.settings, action: () => {
        const t = window.store.get('theme') === 'Midnight' ? 'Peach' : 'Midnight';
        window.ThemeManager.applyTheme(t);
        window.store.set('theme', t);
        if (window.ccBridge) window.ccBridge.setTheme(t);
      } 
    },
    { id: 'focus-start', label: 'Start Focus Session', icon: window.PFIcons.activity, action: () => window.PFToast.show('Focus', 'Focus session started (mock)') },
  ],
  overlay: null,
  input: null,
  list: null,
  selectedIndex: 0,
  filtered: [],

  init() {
    this.overlay = window.pfCreateElement('div', 'pf-palette-overlay');
    const modal = window.pfCreateElement('div', 'pf-palette-modal');
    
    this.input = window.pfCreateElement('input', 'pf-palette-input', { placeholder: 'Type a command or search...' });
    this.list = window.pfCreateElement('div', 'pf-palette-results');
    
    modal.appendChild(this.input);
    modal.appendChild(this.list);
    this.overlay.appendChild(modal);
    document.body.appendChild(this.overlay);

    // Filter Logic
    this.input.addEventListener('input', () => this.renderList());
    
    // Keyboard Nav
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.filtered.length - 1);
        this.highlightRow();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.highlightRow();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.filtered[this.selectedIndex]) {
          this.execute(this.filtered[this.selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        this.hide();
      }
    });

    // Close on click outside
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });

    // Global Keybind Ctrl/Cmd + K
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.toggle();
      }
    });

    // Keyboard Hint Text (Bottom left)
    const hint = window.pfCreateElement('div', 'pf-global-hint', { textContent: 'Press Ctrl+K for commands' });
    document.body.appendChild(hint);
  },

  renderList() {
    const term = this.input.value.toLowerCase();
    this.filtered = this.commands.filter(c => c.label.toLowerCase().includes(term));
    this.selectedIndex = 0;
    this.list.innerHTML = '';
    
    this.filtered.forEach((cmd, i) => {
      const item = window.pfCreateElement('div', 'pf-palette-item');
      item.dataset.index = i;
      item.appendChild(window.pfCreateElement('div', 'pf-palette-item-icon', { innerHTML: cmd.icon }));
      item.appendChild(window.pfCreateElement('div', '', { textContent: cmd.label }));
      item.onclick = () => this.execute(cmd);
      
      this.list.appendChild(item);
    });
    this.highlightRow();
  },

  highlightRow() {
    const items = this.list.querySelectorAll('.pf-palette-item');
    items.forEach(it => it.classList.remove('selected'));
    if (items[this.selectedIndex]) {
      items[this.selectedIndex].classList.add('selected');
      items[this.selectedIndex].scrollIntoView({ block: 'nearest' });
    }
  },

  execute(cmd) {
    this.hide();
    if (cmd && cmd.action) cmd.action();
  },

  toggle() {
    if (this.overlay.classList.contains('active')) this.hide();
    else this.show();
  },

  show() {
    this.input.value = '';
    this.renderList();
    this.overlay.classList.add('active');
    setTimeout(() => this.input.focus(), 10); // Slight delay to ensure display:block transitions capture focus
  },

  hide() {
    this.overlay.classList.remove('active');
    this.input.blur();
  }
};

window.addEventListener('DOMContentLoaded', () => {
  PFPalette.init();
});
