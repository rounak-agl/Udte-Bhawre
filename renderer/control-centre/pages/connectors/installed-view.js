// renderer/control-centre/pages/connectors/installed-view.js
// Installed tab: every configured MCP server, with Test (really starts it and lists its
// tools), Edit and Remove.

window.PFConnectors = window.PFConnectors || {};

(function () {
  const el = (...a) => window.pfCreateElement(...a);
  const SOURCE_LABELS = { catalog: 'Featured', registry: 'Registry', custom: 'Custom' };

  function summary(config) {
    if (config.type === 'http') return config.url;
    return [config.command, ...(config.args || [])].join(' ');
  }

  /**
   * @param {object} ctx  { catalog, getServers(), onChanged(), showMarketplace() }
   */
  function createInstalledView(ctx) {
    const root = el('div', 'pf-installed');
    const note = el('div', 'pf-market-note pf-installed-note', {
      textContent: 'Installed servers are used by agents on Gemini Vision with desktop tools (🔧) on. Their tool calls go through the ArmorIQ guard like the built-in tools.'
    });
    const list = el('div', 'pf-connectors-grid');
    root.append(note, list);

    function catalogEntryFor(id, config) {
      return ctx.catalog.entries.find(e => e.id === (config.catalogId || id)) || null;
    }

    function render() {
      list.textContent = '';
      const servers = ctx.getServers();
      const ids = Object.keys(servers);
      if (!ids.length) {
        const empty = el('div', 'pf-market-empty pf-installed-empty');
        empty.appendChild(document.createTextNode('No servers installed yet. '));
        const go = el('button', 'pf-link-button', { type: 'button', textContent: 'Browse the Marketplace' });
        go.onclick = ctx.showMarketplace;
        empty.appendChild(go);
        list.appendChild(empty);
        return;
      }
      ids.sort((a, b) => (servers[a].displayName || a).localeCompare(servers[b].displayName || b));
      ids.forEach(id => list.appendChild(serverCard(id, servers[id])));
    }

    function serverCard(id, config) {
      const entry = catalogEntryFor(id, config);
      // Installed before the Marketplace existed (no metadata), and the catalog now has a
      // maintained version — e.g. GitHub moved to its hosted server
      const legacy = entry && !config.source;
      const source = config.source || (legacy ? 'catalog' : 'custom');

      const c = el('div', 'pf-connector-card connected');
      const hd = el('div', 'pf-connector-card-header');
      hd.appendChild(el('div', 'pf-connector-icon', { textContent: entry?.icon || (source === 'registry' ? '🧩' : '⚙️') }));
      const info = el('div', 'pf-connector-info');
      const nameRow = el('div', 'pf-connector-name pf-installed-name');
      nameRow.appendChild(document.createTextNode(config.displayName || entry?.name || id));
      nameRow.appendChild(window.PFBadge({ label: SOURCE_LABELS[source] || 'Custom', variant: source === 'catalog' ? 'success' : 'secondary' }));
      nameRow.appendChild(window.PFBadge({ label: config.type === 'http' ? 'Hosted' : 'Local' }));
      info.appendChild(nameRow);
      info.appendChild(el('div', 'pf-connector-desc pf-installed-summary', { textContent: summary(config), title: summary(config) }));
      hd.appendChild(info);
      c.appendChild(hd);

      if (legacy) {
        c.appendChild(el('div', 'pf-install-warning', { textContent: 'Installed with an older setup. Click Update to switch to the current version from the Marketplace.' }));
      }

      const result = el('div', 'pf-test-result', { role: 'status' });
      result.hidden = true;
      c.appendChild(result);

      const actions = el('div', 'pf-connector-actions');
      const testBtn = window.PFButton({ label: 'Test', variant: 'ghost', size: 'sm' });
      testBtn.onclick = async () => {
        const lbl = testBtn.querySelector('.pf-btn-label');
        testBtn.disabled = true;
        lbl.textContent = 'Testing…';
        result.hidden = false;
        result.className = 'pf-test-result is-busy';
        result.textContent = 'Starting the server…';
        try {
          window.PFConnectors.renderTestResult(result, await window.ccBridge.testMcpServer(id));
        } finally {
          testBtn.disabled = false;
          lbl.textContent = 'Test';
        }
      };
      const fromCatalog = entry && source === 'catalog';
      const editBtn = window.PFButton({ label: fromCatalog ? (legacy ? 'Update' : 'Edit settings') : 'Edit', variant: legacy ? 'primary' : 'ghost', size: 'sm' });
      // A catalog server with nothing to fill in has nothing to edit
      editBtn.hidden = fromCatalog && !legacy && !entry.fields.length;
      editBtn.onclick = () => {
        if (fromCatalog) {
          window.PFConnectors.openInstallDialog(entry, ctx.catalog, { installedConfig: legacy ? null : config, onInstalled: ctx.onChanged });
        } else {
          window.PFConnectors.openCustomServerModal({ id, config, onSaved: ctx.onChanged });
        }
      };
      const removeBtn = window.PFButton({ label: 'Remove', variant: 'ghost', size: 'sm' });
      removeBtn.onclick = async () => {
        if (!confirm(`Remove "${config.displayName || id}"? Agents stop using its tools right away.`)) return;
        if (await window.ccBridge.uninstallMcpServer(id)) {
          window.PFToast.show('Removed', `${config.displayName || id} was removed`);
          ctx.onChanged();
        }
      };
      actions.append(testBtn, editBtn, removeBtn);
      c.appendChild(actions);
      return c;
    }

    return { element: root, refresh: render };
  }

  window.PFConnectors.createInstalledView = createInstalledView;
})();
