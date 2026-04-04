// renderer/control-centre/pages/settings/settings-page.js

function SettingsPage() {
  const container = window.pfCreateElement('div', 'pf-page-settings');
  
  // Left Nav
  const nav = window.pfCreateElement('div', 'pf-settings-nav');
  nav.appendChild(window.pfCreateElement('h3', 'pf-settings-nav-title', { textContent: 'Settings' }));
  const menu = window.pfCreateElement('div', 'pf-settings-menu');
  const sectionsMenu = [
    { id: 'general', label: 'General' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'security', label: 'Security & Access' },
    { id: 'about', label: 'About' }
  ];
  
  sectionsMenu.forEach((m, idx) => {
    const min = window.pfCreateElement('div', `pf-settings-menu-item ${idx === 0 ? 'active' : ''}`, { textContent: m.label });
    min.dataset.target = m.id;
    min.onclick = () => switchTab(m.id);
    menu.appendChild(min);
  });
  nav.appendChild(menu);
  container.appendChild(nav);

  // Content Area
  const content = window.pfCreateElement('div', 'pf-settings-content');

  // Helper to switch tabs
  const switchTab = (id) => {
    menu.querySelectorAll('.pf-settings-menu-item').forEach(el => el.classList.remove('active'));
    const targetMenuItem = menu.querySelector(`[data-target="${id}"]`);
    if (targetMenuItem) targetMenuItem.classList.add('active');
    content.querySelectorAll('.pf-settings-section').forEach(el => el.classList.remove('active'));
    const targetSection = content.querySelector(`#settings-${id}`);
    if (targetSection) targetSection.classList.add('active');
  };

  // --- GENERAL SECTION ---
  const generalSection = window.pfCreateElement('div', 'pf-settings-section active', { id: 'settings-general' });
  generalSection.appendChild(window.pfCreateElement('h2', 'pf-settings-section-title', { textContent: 'General' }));
  
  // 1. Model Provider
  const currentProvider = window.store.get('provider') || 'vision';
  const providerGroup = window.pfCreateElement('div', 'pf-form-group');
  providerGroup.appendChild(window.pfCreateElement('label', 'pf-input-label', { textContent: 'Default LLM Provider' }));
  
  const providerRow = window.pfCreateElement('div', 'pf-form-row', { style: 'gap: 8px;' });
  // Updated list to match sessions/agent-session.js
  const providers = ['vision', 'claude', 'gemini', 'codex', 'copilot'];
  providers.forEach(prov => {
    const pBtn = window.PFButton({ 
      label: window.PFUtils.capitalize(prov), 
      variant: currentProvider === prov ? 'primary' : 'secondary',
      size: 'sm'
    });
    pBtn.onclick = () => {
      window.store.set('provider', prov);
      if (window.ccBridge) window.ccBridge.setProvider(prov);
      window.PFToast.show('Provider Updated', `Switched default provider to ${prov}`);
      Array.from(providerRow.children).forEach(b => {
        const bLabel = b.querySelector('.pf-btn-label')?.textContent.toLowerCase();
        b.className = `pf-btn pf-btn--${bLabel === prov ? 'primary' : 'secondary'} pf-btn--sm`;
      });
    };
    providerRow.appendChild(pBtn);
  });
  providerGroup.appendChild(providerRow);
  generalSection.appendChild(providerGroup);

  // 2. Global API Key (Gemini/Claude)
  const apiGroup = window.pfCreateElement('div', 'pf-form-group');
  const inputWrap = window.PFInput({ label: 'Global AI API Key', type: 'password', id: 'global-api-key' });
  const apiKeyInputDom = inputWrap.querySelector('input');
  
  if (window.ccBridge) {
    window.ccBridge.getApiKey().then(key => { if (key) apiKeyInputDom.value = key; });
  }

  const saveKeyBtn = window.PFButton({ label: 'Save', variant: 'secondary' });
  saveKeyBtn.onclick = () => {
    if (window.ccBridge) window.ccBridge.setApiKey(apiKeyInputDom.value);
    window.PFToast.show('Saved', 'API Key updated.');
  };
  
  const formRow = window.pfCreateElement('div', 'pf-form-row');
  formRow.appendChild(inputWrap);
  formRow.appendChild(saveKeyBtn);
  inputWrap.style.flex = '1';
  
  apiGroup.appendChild(formRow);
  apiGroup.appendChild(window.pfCreateElement('div', 'pf-form-desc', { textContent: 'Used for Claude and Gemini Vision.' }));
  generalSection.appendChild(apiGroup);

  // 3. ElevenLabs API Key
  const elGroup = window.pfCreateElement('div', 'pf-form-group');
  const elInputWrap = window.PFInput({ label: 'ElevenLabs API Key', type: 'password', id: 'el-api-key' });
  const elKeyInputDom = elInputWrap.querySelector('input');

  if (window.ccBridge) {
    window.ccBridge.getElevenLabsApiKey().then(key => { if (key) elKeyInputDom.value = key; });
  }

  const saveElBtn = window.PFButton({ label: 'Save', variant: 'secondary' });
  saveElBtn.onclick = () => {
    if (window.ccBridge) window.ccBridge.setElevenLabsApiKey(elKeyInputDom.value);
    window.PFToast.show('Saved', 'ElevenLabs key updated.');
  };

  const elRow = window.pfCreateElement('div', 'pf-form-row');
  elRow.appendChild(elInputWrap);
  elRow.appendChild(saveElBtn);
  elInputWrap.style.flex = '1';

  elGroup.appendChild(elRow);
  elGroup.appendChild(window.pfCreateElement('div', 'pf-form-desc', { textContent: 'Required for voice feedback.' }));
  generalSection.appendChild(elGroup);

  // 4. MongoDB URI
  const dbGroup = window.pfCreateElement('div', 'pf-form-group');
  const dbInputWrap = window.PFInput({ label: 'MongoDB Connection URI', placeholder: 'mongodb+srv://...', id: 'db-uri' });
  const dbInputDom = dbInputWrap.querySelector('input');

  // We need to add get/set-mongodb-uri to ccBridge if not present, 
  // but for now let's check store or just mock it.
  // Actually, we should expose it.
  
  if (window.ccBridge) {
    window.ccBridge.getMongodbUri().then(uri => { if (uri) dbInputDom.value = uri; });
  }

  const saveDbBtn = window.PFButton({ label: 'Save', variant: 'secondary' });
  saveDbBtn.onclick = () => {
    if (window.ccBridge) window.ccBridge.setMongodbUri(dbInputDom.value);
    window.PFToast.show('Saved', 'Database URI updated. Restart app to reconnect.');
  };

  const dbRow = window.pfCreateElement('div', 'pf-form-row');
  dbRow.appendChild(dbInputWrap);
  dbRow.appendChild(saveDbBtn);
  dbInputWrap.style.flex = '1';

  dbGroup.appendChild(dbRow);
  generalSection.appendChild(dbGroup);

  content.appendChild(generalSection);

  // --- APPEARANCE SECTION ---
  const appearanceSection = window.pfCreateElement('div', 'pf-settings-section', { id: 'settings-appearance' });
  appearanceSection.appendChild(window.pfCreateElement('h2', 'pf-settings-section-title', { textContent: 'Appearance' }));
  
  const themes = [
    { id: 'Midnight', name: 'Midnight Dark', class: 'pf-theme-preview-midnight' },
    { id: 'Moss', name: 'Moss Green', class: 'pf-theme-preview-moss' },
    { id: 'Peach', name: 'Peach Light', class: 'pf-theme-preview-peach' },
    { id: 'Cloud', name: 'Cloud Blue', class: 'pf-theme-preview-cloud' }
  ];

  const themeGrid = window.pfCreateElement('div', 'pf-theme-cards');
  let currentTheme = window.store.get('theme') || 'Midnight';

  const renderThemes = () => {
    themeGrid.innerHTML = '';
    themes.forEach(t => {
      const card = window.pfCreateElement('div', `pf-theme-card ${currentTheme === t.id ? 'active' : ''}`);
      const preview = window.pfCreateElement('div', `pf-theme-preview ${t.class}`, { textContent: 'Aa' });
      card.appendChild(preview);
      card.appendChild(window.pfCreateElement('div', '', { textContent: t.name, style: 'font-weight: 500; text-align: center;' }));
      
      card.onclick = () => {
        currentTheme = t.id;
        window.store.set('theme', currentTheme);
        if (window.ThemeManager) window.ThemeManager.applyTheme(currentTheme);
        if (window.ccBridge) window.ccBridge.setTheme(currentTheme);
        renderThemes();
      };
      themeGrid.appendChild(card);
    });
  };
  renderThemes();
  appearanceSection.appendChild(themeGrid);
  content.appendChild(appearanceSection);

  // --- STUBS ---
  const secSection = window.pfCreateElement('div', 'pf-settings-section', { id: 'settings-security' });
  secSection.innerHTML = '<h2 class="pf-settings-section-title">Security & Access</h2><p>Manage ArmorIQ policies and intent locks.</p>';
  content.appendChild(secSection);

  const abtSection = window.pfCreateElement('div', 'pf-settings-section', { id: 'settings-about' });
  abtSection.innerHTML = '<h2 class="pf-settings-section-title">About Astrophage</h2><p>Version 2.0.0-alpha</p>';
  content.appendChild(abtSection);

  container.appendChild(content);
  return container;
}

window.SettingsPage = SettingsPage;
