// renderer/control-centre/core/router.js

class PFRouter {
  constructor(shell) {
    this.shell = shell;
    this.routes = [];
    this.activeRoute = null;
    this.currentPage = null;

    window.addEventListener('hashchange', () => this.handleHashChange());
  }

  register(path, config) {
    // path can be '/dashboard' or '/chat/:id'
    const paramRegex = /:([a-zA-Z0-9_]+)/g;
    const regexPath = path.replace(paramRegex, '(?<$1>[^/]+)');
    this.routes.push({
      path,
      regex: new RegExp(`^${regexPath}$`),
      render: config.render,
      title: config.title
    });
  }

  navigate(path) {
    window.location.hash = path;
  }

  handleHashChange() {
    let hash = window.location.hash.slice(1) || '/dashboard';
    if (!hash.startsWith('/')) hash = '/' + hash;

    for (const route of this.routes) {
      const match = hash.match(route.regex);
      if (match) {
        this.activeRoute = route;
        const params = match.groups || {};
        this.renderPage(route, params);
        
        // Update sidebar active state
        const pageId = route.path.split('/')[1];
        document.querySelectorAll('.pf-sidebar-item').forEach(el => {
          el.classList.remove('active');
          if (el.dataset.navId === pageId) {
            el.classList.add('active');
          }
        });
        
        document.title = `${route.title} - Astrophage Control Centre`;
        return;
      }
    }
    console.warn('No route match for:', hash);
  }

  renderPage(route, params) {
    if (this.currentPage && typeof this.currentPage._cleanup === 'function') {
      this.currentPage._cleanup();
    }
    this.currentPage = route.render(params);
    if (this.shell && this.shell.setContent) {
      this.shell.setContent(this.currentPage);
    }
  }
}

window.PFRouter = PFRouter;
