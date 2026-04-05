// renderer/components/tier3-layout.js

function PFSidebar({ appName = 'Astrophage', items = [], activeId, onNavigate }) {
  const sidebar = pfCreateElement('nav', 'pf-sidebar');
  
  const header = pfCreateElement('div', 'pf-sidebar-header');
  header.innerHTML = `<img src="../../assets/q.svg" width="24" height="24" alt="logo" style="object-fit: contain;" /> <span>${appName}</span>`;
  sidebar.appendChild(header);

  const nav = pfCreateElement('div', 'pf-sidebar-nav');
  
  items.forEach(item => {
    const el = pfCreateElement('a', `pf-sidebar-item ${item.id === activeId ? 'active' : ''}`);
    el.dataset.navId = item.id;
    
    if (item.icon) {
      el.appendChild(pfCreateElement('span', 'pf-sidebar-icon', { innerHTML: item.icon }));
    }
    el.appendChild(pfCreateElement('span', 'pf-sidebar-label', { textContent: item.label }));
    
    el.addEventListener('click', (e) => {
      e.preventDefault();
      nav.querySelectorAll('.pf-sidebar-item').forEach(i => i.classList.remove('active'));
      el.classList.add('active');
      if (onNavigate) onNavigate(item.id);
    });
    
    nav.appendChild(el);
  });
  
  sidebar.appendChild(nav);
  return sidebar;
}

function PFTopBar({ title = '', actions = [] }) {
  const topbar = pfCreateElement('header', 'pf-topbar');
  
  const left = pfCreateElement('div', 'pf-topbar-left');
  left.appendChild(pfCreateElement('div', 'pf-topbar-title', { textContent: title }));
  topbar.appendChild(left);
  
  const right = pfCreateElement('div', 'pf-topbar-right');
  const controls = pfCreateElement('div', 'pf-titlebar-controls');
  
  // Custom window controls are handled natively by Electron's titleBarOverlay  
  right.appendChild(controls);
  topbar.appendChild(right);
  
  return topbar;
}

function PFPageShell({ sidebar, topbar }) {
  const shell = pfCreateElement('div', 'pf-page-shell');
  
  if (sidebar) shell.appendChild(sidebar);
  
  const mainWrap = pfCreateElement('div', 'pf-main-wrapper');
  if (topbar) mainWrap.appendChild(topbar);
  
  const content = pfCreateElement('main', 'pf-content');
  mainWrap.appendChild(content);
  
  shell.appendChild(mainWrap);
  
  shell.setContent = (el) => {
    content.innerHTML = '';
    content.appendChild(el);
  };
  shell.contentNode = content;
  
  return shell;
}

window.PFSidebar = PFSidebar;
window.PFTopBar = PFTopBar;
window.PFPageShell = PFPageShell;
