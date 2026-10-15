// renderer/control-centre/pages/connectors/connectors-page.js
// Connectors: Marketplace (one-click install of MCP servers) | Installed, plus
// "Add custom". The pieces live next to this file:
//   marketplace-view.js     featured catalog + public MCP Registry search
//   install-drawer.js       the install dialog (fields, trust check, test-start)
//   installed-view.js       installed servers: Test / Edit / Remove
//   custom-server-modal.js  add/edit a custom server (paste JSON or fill the form)
//   paste-config.js         parser for pasted configs

function ConnectorsPage() {
  const el = (...a) => window.pfCreateElement(...a);
  const container = el('div', 'pf-page-connectors');

  // Header
  const header = el('div', 'pf-connectors-header');
  const titles = el('div', '');
  titles.appendChild(el('h1', 'pf-connectors-title', { textContent: 'Connectors' }));
  titles.appendChild(el('div', 'pf-connectors-subtitle', { textContent: 'Give your agents new tools with MCP servers: install from the Marketplace or add your own.' }));
  header.appendChild(titles);
  const addBtn = window.PFButton({ label: 'Add custom', icon: window.PFIcons.plus, variant: 'secondary' });
  header.appendChild(addBtn);
  container.appendChild(header);

  // Tabs
  const tabs = el('div', 'pf-connectors-tabs', { role: 'tablist' });
  const marketTab = el('button', 'pf-connectors-tab', { type: 'button', role: 'tab', textContent: 'Marketplace' });
  const installedTab = el('button', 'pf-connectors-tab', { type: 'button', role: 'tab', textContent: 'Installed' });
  tabs.append(marketTab, installedTab);
  container.appendChild(tabs);

  const panel = el('div', 'pf-connectors-panel', { role: 'tabpanel' });
  panel.appendChild(el('div', 'pf-market-empty', { textContent: 'Loading…' }));
  container.appendChild(panel);

  let servers = {};
  let catalog = null;
  let marketView = null;
  let installedView = null;
  let current = 'market';

  function isInstalled(entry) {
    if (entry.verified) return !!servers[entry.id];
    return Object.values(servers).some(c => c.registryName && c.registryName === entry.registryName);
  }

  function updateCount() {
    const n = Object.keys(servers).length;
    installedTab.textContent = n ? `Installed (${n})` : 'Installed';
  }

  async function reload() {
    servers = (await window.ccBridge.getMcpServers()) || {};
    updateCount();
    if (marketView) marketView.refresh();
    if (installedView) installedView.refresh();
  }

  function show(which) {
    current = which;
    marketTab.classList.toggle('active', which === 'market');
    installedTab.classList.toggle('active', which === 'installed');
    marketTab.setAttribute('aria-selected', String(which === 'market'));
    installedTab.setAttribute('aria-selected', String(which === 'installed'));
    if (!catalog) return;
    panel.textContent = '';
    if (which === 'market') {
      panel.appendChild(marketView.element);
      marketView.refresh();
    } else {
      panel.appendChild(installedView.element);
      installedView.refresh();
    }
  }
  marketTab.onclick = () => show('market');
  installedTab.onclick = () => show('installed');
  addBtn.onclick = () => window.PFConnectors.openCustomServerModal({ onSaved: async () => { await reload(); show('installed'); } });

  async function init() {
    if (!window.ccBridge) return;
    [catalog, servers] = await Promise.all([
      window.ccBridge.getMarketplaceCatalog(),
      window.ccBridge.getMcpServers()
    ]);
    servers = servers || {};
    if (!catalog) {
      panel.textContent = '';
      panel.appendChild(el('div', 'pf-market-empty', { textContent: 'Couldn\'t load the Marketplace.' }));
      return;
    }
    marketView = window.PFConnectors.createMarketplaceView({ catalog, isInstalled, onInstalled: reload });
    installedView = window.PFConnectors.createInstalledView({
      catalog,
      getServers: () => servers,
      onChanged: reload,
      showMarketplace: () => show('market')
    });
    updateCount();
    show(current);
  }

  show('market');
  init();
  return container;
}

window.ConnectorsPage = ConnectorsPage;
