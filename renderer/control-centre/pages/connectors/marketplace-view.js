// renderer/control-centre/pages/connectors/marketplace-view.js
// Marketplace tab: the curated catalog (filtered as you type) plus live results from the
// public MCP Registry. Registry data is untrusted: everything is rendered as text.

window.PFConnectors = window.PFConnectors || {};

(function () {
  const el = (...a) => window.pfCreateElement(...a);
  const SEARCH_DELAY_MS = 400;

  function typeBadges(entry) {
    const row = el('div', 'pf-market-badges');
    const install = entry.install;
    if (install?.type === 'http') row.appendChild(window.PFBadge({ label: 'Hosted' }));
    else if (install) row.appendChild(window.PFBadge({ label: install.runtime === 'python' ? 'Local · Python' : 'Local · Node' }));
    if (!entry.verified) row.appendChild(window.PFBadge({ label: 'Unverified', variant: 'warning' }));
    if (entry.fields?.some(f => f.required && f.secret)) row.appendChild(window.PFBadge({ label: 'Needs a key', variant: 'secondary' }));
    return row;
  }

  function card(entry, { installed, onOpen }) {
    const c = el('div', 'pf-connector-card pf-market-card');
    if (installed) c.classList.add('connected');
    const hd = el('div', 'pf-connector-card-header');
    hd.appendChild(el('div', 'pf-connector-icon', { textContent: entry.icon || '🧩' }));
    const info = el('div', 'pf-connector-info');
    info.appendChild(el('div', 'pf-connector-name', { textContent: entry.name }));
    if (entry.publisher) info.appendChild(el('div', 'pf-connector-desc', { textContent: entry.publisher }));
    hd.appendChild(info);
    c.appendChild(hd);
    c.appendChild(el('div', 'pf-market-desc', { textContent: entry.description || '' }));
    c.appendChild(typeBadges(entry));

    const actions = el('div', 'pf-connector-actions');
    if (entry.installable === false) {
      actions.appendChild(el('span', 'pf-market-note', { textContent: entry.reason || 'Not installable' }));
      if (entry.homepage && /^https?:\/\//i.test(entry.homepage)) {
        actions.appendChild(el('a', 'pf-link', { href: entry.homepage, target: '_blank', rel: 'noopener', textContent: 'View ↗' }));
      }
    } else if (installed) {
      actions.appendChild(el('span', 'pf-connector-status connected', { textContent: 'INSTALLED ✓' }));
    } else {
      const btn = window.PFButton({ label: 'Install', variant: 'primary', size: 'sm' });
      btn.onclick = (e) => { e.stopPropagation(); onOpen(entry); };
      actions.appendChild(btn);
    }
    c.appendChild(actions);
    if (entry.installable !== false && !installed) {
      c.tabIndex = 0;
      c.setAttribute('role', 'button');
      c.setAttribute('aria-label', `Install ${entry.name}`);
      c.onclick = () => onOpen(entry);
      c.onkeydown = (e) => { if (e.key === 'Enter') onOpen(entry); };
    }
    return c;
  }

  function matches(entry, q) {
    if (!q) return true;
    const hay = `${entry.name} ${entry.publisher || ''} ${entry.description || ''} ${entry.category || ''}`.toLowerCase();
    return q.toLowerCase().split(/\s+/).every(w => hay.includes(w));
  }

  /**
   * @param {object} ctx  { catalog, isInstalled(entry), onInstalled() }
   */
  function createMarketplaceView(ctx) {
    const root = el('div', 'pf-market');

    // ── Search + categories ──
    const toolbar = el('div', 'pf-market-toolbar');
    const search = el('input', 'pf-input pf-market-search', {
      type: 'search',
      placeholder: 'Search servers — e.g. github, postgres, browser, search…',
      'aria-label': 'Search MCP servers',
      spellcheck: 'false'
    });
    toolbar.appendChild(search);
    const chips = el('div', 'pf-market-chips', { role: 'tablist', 'aria-label': 'Categories' });
    let category = 'All';
    ['All', ...(ctx.catalog.categories || [])].forEach(cat => {
      const chip = el('button', 'pf-market-chip', { type: 'button', role: 'tab', textContent: cat });
      chip.onclick = () => {
        category = cat;
        chips.querySelectorAll('.pf-market-chip').forEach(c => {
          c.classList.toggle('active', c === chip);
          c.setAttribute('aria-selected', String(c === chip));
        });
        renderFeatured();
        registrySection.hidden = category !== 'All';
      };
      if (cat === 'All') { chip.classList.add('active'); chip.setAttribute('aria-selected', 'true'); }
      chips.appendChild(chip);
    });
    toolbar.appendChild(chips);
    root.appendChild(toolbar);

    // ── Featured (curated, verified) ──
    const featuredTitle = el('h2', 'pf-market-section-title', { textContent: '★ Featured' });
    const featuredGrid = el('div', 'pf-connectors-grid');
    const featuredEmpty = el('div', 'pf-market-empty', { textContent: 'No featured servers match. Results from the public registry are below.' });
    root.append(featuredTitle, featuredGrid, featuredEmpty);

    function open(entry) {
      window.PFConnectors.openInstallDialog(entry, ctx.catalog, { onInstalled: ctx.onInstalled });
    }

    function renderFeatured() {
      featuredGrid.textContent = '';
      const q = search.value.trim();
      const list = ctx.catalog.entries.filter(e => (category === 'All' || e.category === category) && matches(e, q));
      list.forEach(e => featuredGrid.appendChild(card(e, { installed: ctx.isInstalled(e), onOpen: open })));
      featuredEmpty.hidden = list.length > 0;
    }

    // ── Public MCP Registry (live, unverified) ──
    const registrySection = el('section', 'pf-market-registry');
    const regHead = el('div', 'pf-market-section-head');
    regHead.appendChild(el('h2', 'pf-market-section-title', { textContent: 'From the MCP Registry' }));
    regHead.appendChild(el('span', 'pf-market-note', { textContent: 'Community servers — not reviewed. You\'ll see exactly what runs before installing.' }));
    registrySection.appendChild(regHead);
    const regStatus = el('div', 'pf-market-empty', { role: 'status' });
    const regGrid = el('div', 'pf-connectors-grid');
    const moreBtn = window.PFButton({ label: 'Load more', variant: 'secondary', size: 'sm' });
    moreBtn.hidden = true;
    registrySection.append(regStatus, regGrid, moreBtn);
    root.appendChild(registrySection);

    let searchSeq = 0;
    let cursor = null;
    let lastResults = [];

    function setIdle() {
      lastResults = [];
      regGrid.textContent = '';
      moreBtn.hidden = true;
      regStatus.textContent = 'Type above to search hundreds more servers in the public registry, or ';
      const browse = el('button', 'pf-link-button', { type: 'button', textContent: 'browse the newest' });
      browse.onclick = () => runSearch('', false);
      regStatus.appendChild(browse);
      regStatus.appendChild(document.createTextNode('.'));
    }

    function renderRegistry() {
      regGrid.textContent = '';
      lastResults.forEach(e => regGrid.appendChild(card(e, { installed: ctx.isInstalled(e), onOpen: open })));
    }

    async function runSearch(query, append) {
      const seq = ++searchSeq;
      regStatus.textContent = append ? '' : 'Searching the registry…';
      moreBtn.hidden = true;
      if (!append) { regGrid.textContent = ''; lastResults = []; cursor = null; }
      const res = await window.ccBridge.searchMarketplace(query, append ? cursor : '');
      if (seq !== searchSeq) return; // a newer search started
      if (!res || !res.ok) {
        regStatus.textContent = `Registry unavailable — showing featured servers only. ${res?.error || ''}`;
        return;
      }
      lastResults = append ? [...lastResults, ...res.servers] : res.servers;
      cursor = res.nextCursor;
      regStatus.textContent = lastResults.length ? '' : `No registry servers match “${query}”.`;
      renderRegistry();
      moreBtn.hidden = !cursor;
    }
    moreBtn.onclick = () => runSearch(search.value.trim(), true);

    let timer = null;
    search.addEventListener('input', () => {
      renderFeatured();
      clearTimeout(timer);
      const q = search.value.trim();
      if (!q) { searchSeq++; setIdle(); return; }
      timer = setTimeout(() => runSearch(q, false), SEARCH_DELAY_MS);
    });

    renderFeatured();
    setIdle();

    return {
      element: root,
      refresh() { renderFeatured(); renderRegistry(); },
      focus() { search.focus(); }
    };
  }

  window.PFConnectors.createMarketplaceView = createMarketplaceView;
})();
