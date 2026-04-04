// renderer/control-centre/core/boot.js

async function boot() {
  const root = document.getElementById('pf-root');

  // 1. Initialize State — get real data from main process
  let initialState = {};
  if (window.ccBridge) {
    try {
      const result = await window.ccBridge.getInitialState();
      if (result) initialState = result;
    } catch (e) {
      console.warn('[CC Boot] Failed to get initial state from bridge:', e);
    }
  }

  // Build store from real IPC data (no mock fallback)
  const storeData = {
    theme: initialState.theme || 'Midnight',
    provider: initialState.provider || 'vision',
    user: initialState.user || { name: 'User', avatar: 'U' },
    agents: initialState.agents || [],
    tasks: [],
    chats: initialState.chats || [],
    stats: initialState.stats || { score: 0, scoreTrend: '--', focusTime: '0h', tasksDone: 0, tasksTotal: 0 },
    activity: initialState.activity || [],
    weekChart: initialState.weekChart || []
  };

  // Create global store
  window.store = new PFStore(storeData);

  // Apply Theme
  const currentTheme = window.store.get('theme');
  if (window.ThemeManager) {
    window.ThemeManager.applyTheme(currentTheme);
  }
  
  // Listen for external theme/provider changes
  if (window.ccBridge) {
    window.ccBridge.onThemeChange((theme) => {
      window.store.set('theme', theme);
      if (window.ThemeManager) window.ThemeManager.applyTheme(theme);
    });
    window.ccBridge.onProviderChange((provider) => {
      window.store.set('provider', provider);
    });
    window.ccBridge.onNavigate((page) => {
      if (window.router) window.router.navigate(page);
    });
  }

  // 2. Build App Shell
  const user = window.store.get('user');
  const userAvatar = PFAvatar({ initials: (user.avatar || user.name?.charAt(0) || 'U'), size: 'sm', shape: 'circle' });
  const userProfile = pfCreateElement('div', 'pf-sidebar-item', { style: 'margin-top: auto; border-top: 1px solid var(--pf-color-border); padding-top: 12px;' });
  userProfile.appendChild(userAvatar);
  userProfile.appendChild(pfCreateElement('span', '', { textContent: user.name || 'User', style: 'font-weight: 600;' }));
  
  const sidebar = PFSidebar({
    appName: 'Astrophage',
    items: window.SIDEBAR_ITEMS,
    activeId: 'dashboard',
    onNavigate: (id) => window.router.navigate(`/${id}`)
  });

  sidebar.querySelector('.pf-sidebar-nav').appendChild(userProfile);

  const topbar = PFTopBar({
    title: 'Control Centre',
    actions: [] 
  });

  const appShell = PFPageShell({ sidebar, topbar });
  root.appendChild(appShell);

  // 3. Initialize Router
  window.router = new PFRouter(appShell);
  
  window.router.register('/dashboard', { render: window.DashboardPage, title: 'Dashboard' });
  window.router.register('/chat', { render: window.ChatPage, title: 'Chat' });
  window.router.register('/tasks', { render: window.TasksPage, title: 'Tasks' });
  window.router.register('/agents', { render: window.AgentsPage, title: 'Agents' });
  window.router.register('/activity', { render: window.ActivityPage, title: 'Activity' });
  window.router.register('/connectors', { render: window.ConnectorsPage, title: 'Connectors' });
  window.router.register('/settings', { render: window.SettingsPage, title: 'Settings' });

  // Start routing
  window.router.handleHashChange();

  // Initialize Toast System
  if (window.PFToast) PFToast.init();

  // Initialize Palette & Global Shortcuts
  if (window.commandPalette) {
    window.commandPalette.init();
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        window.commandPalette.open();
      }
    });
  }

  console.log('[CC Boot] Control Centre loaded successfully');
}

// Start Boot
document.addEventListener('DOMContentLoaded', boot);
