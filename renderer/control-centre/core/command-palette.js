// renderer/control-centre/core/command-palette.js

(function() {
  function CommandPalette() {
    this.overlay = null;
    this.box = null;
    this.input = null;
    this.results = null;
    this.isOpen = false;
    this.selectedIndex = 0;
    this.filteredItems = [];

    this.init = () => {
      this.overlay = pfCreateElement('div', 'pf-palette-overlay');
      this.box = pfCreateElement('div', 'pf-palette-box');
      
      const searchWrap = pfCreateElement('div', 'pf-palette-search-wrap');
      const searchIcon = pfCreateElement('div', 'pf-palette-search-icon', { innerHTML: window.PFIcons.search });
      this.input = pfCreateElement('input', 'pf-palette-input', { 
        placeholder: 'Search agents, chats, or pages...',
        type: 'text'
      });
      
      searchWrap.appendChild(searchIcon);
      searchWrap.appendChild(this.input);
      this.box.appendChild(searchWrap);
      
      this.results = pfCreateElement('div', 'pf-palette-results');
      this.box.appendChild(this.results);
      
      this.overlay.appendChild(this.box);
      document.body.appendChild(this.overlay);

      // Events
      this.overlay.onclick = (e) => { if (e.target === this.overlay) this.close(); };
      this.input.oninput = () => this.handleSearch();
      this.input.onkeydown = (e) => this.handleKeydown(e);
    };

    this.open = async () => {
      if (this.isOpen) return;
      this.isOpen = true;
      this.overlay.classList.add('active');
      this.input.value = '';
      this.input.focus();
      this.handleSearch();
    };

    this.close = () => {
      this.isOpen = false;
      this.overlay.classList.remove('active');
    };

    this.handleSearch = async () => {
      const query = this.input.value.toLowerCase().trim();
      const items = await this.getItems();
      
      if (!query) {
        this.filteredItems = items.slice(0, 10); // Show recent/default
      } else {
        this.filteredItems = items.filter(item => 
          item.title.toLowerCase().includes(query) || 
          item.subtitle?.toLowerCase().includes(query)
        );
      }
      
      this.selectedIndex = 0;
      this.renderResults();
    };

    this.getItems = async () => {
      const items = [];
      
      // 1. Static Pages
      const pages = [
        { title: 'Dashboard', subtitle: 'Overview & Statistics', type: 'page', id: 'dashboard', icon: window.PFIcons.dashboard },
        { title: 'Messages', subtitle: 'Recent Conversations', type: 'page', id: 'chat', icon: window.PFIcons.chat },
        { title: 'Agents', subtitle: 'Manage AI Personas', type: 'page', id: 'agents', icon: window.PFIcons.agents },
        { title: 'Tasks', subtitle: 'Kanban & Project Management', type: 'page', id: 'tasks', icon: window.PFIcons.tasks },
        { title: 'Connectors', subtitle: 'MCP & Integrations', type: 'page', id: 'connectors', icon: window.PFIcons.connectors },
        { title: 'Settings', subtitle: 'Preferences & Keys', type: 'page', id: 'settings', icon: window.PFIcons.settings },
      ];
      items.push(...pages);

      // 2. Real Agents from Store
      const agents = window.store.get('agents') || [];
      agents.forEach(a => {
        items.push({ 
          title: a.name, 
          subtitle: `Agent • ${a.provider}`, 
          type: 'agent', 
          id: a._id || a.id, 
          icon: '👤' 
        });
      });

      // 3. Recent Chat Sessions from DB
      if (window.ccBridge) {
        try {
          const sessions = await window.ccBridge.getHistory();
          sessions.slice(0, 5).forEach(s => {
            items.push({ 
              title: s.title || 'Untitled Chat', 
              subtitle: `Chat with ${s.agentId?.name || 'Agent'}`, 
              type: 'chat', 
              id: s._id, 
              icon: window.PFIcons.chat 
            });
          });
        } catch (e) {}
      }

      return items;
    };

    this.renderResults = () => {
      this.results.innerHTML = '';
      
      if (this.filteredItems.length === 0) {
        this.results.appendChild(pfCreateElement('div', 'pf-palette-no-results', { textContent: 'No results found' }));
        return;
      }

      this.filteredItems.forEach((item, idx) => {
        const row = pfCreateElement('div', `pf-palette-row ${idx === this.selectedIndex ? 'active' : ''}`);
        
        const icon = pfCreateElement('div', 'pf-palette-row-icon', { innerHTML: item.icon });
        const info = pfCreateElement('div', 'pf-palette-row-info');
        info.appendChild(pfCreateElement('div', 'pf-palette-row-title', { textContent: item.title }));
        info.appendChild(pfCreateElement('div', 'pf-palette-row-subtitle', { textContent: item.subtitle }));
        
        row.appendChild(icon);
        row.appendChild(info);
        
        row.onmouseenter = () => {
          this.selectedIndex = idx;
          this.renderResults();
        };
        row.onclick = () => this.executeItem(item);
        
        this.results.appendChild(row);
      });
    };

    this.handleKeydown = (e) => {
      if (e.key === 'Escape') this.close();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectedIndex = (this.selectedIndex + 1) % this.filteredItems.length;
        this.renderResults();
        this.scrollToActive();
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectedIndex = (this.selectedIndex - 1 + this.filteredItems.length) % this.filteredItems.length;
        this.renderResults();
        this.scrollToActive();
      }
      if (e.key === 'Enter') {
        const item = this.filteredItems[this.selectedIndex];
        if (item) this.executeItem(item);
      }
    };

    this.scrollToActive = () => {
      const active = this.results.querySelector('.pf-palette-row.active');
      if (active) active.scrollIntoView({ block: 'nearest' });
    };

    this.executeItem = (item) => {
      this.close();
      if (item.type === 'page') {
        window.router.navigate(item.id);
      } else if (item.type === 'agent') {
        window.router.navigate('agents');
        // Future: open specific agent edit
      } else if (item.type === 'chat') {
        window.router.navigate('chat');
        // Force chat select
        setTimeout(() => {
          // Notify ChatPage to select this ID
          if (window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('pf-chat-select', { detail: { id: item.id } }));
          }
        }, 50);
      }
    };
  }

  window.commandPalette = new CommandPalette();
})();
