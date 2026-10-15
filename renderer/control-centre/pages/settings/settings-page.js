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

  /**
   * A secret setting: hidden input with a show/hide button, a Save button and a hint.
   * `load()` resolves to the stored value; `save(value)` persists it.
   */
  const secretField = ({ id, label, placeholder, desc, load, save, savedTitle, savedMessage }) => {
    const group = window.pfCreateElement('div', 'pf-form-group');
    const wrap = window.PFInput({ label, placeholder, type: 'password', id, revealable: true });
    const input = wrap.querySelector('input');
    if (window.ccBridge) load().then(v => { if (v) input.value = v; }).catch(() => {});

    const saveBtn = window.PFButton({ label: 'Save', variant: 'secondary' });
    saveBtn.onclick = () => {
      if (window.ccBridge) save(input.value.trim());
      window.PFToast.show(savedTitle || 'Saved', savedMessage);
    };

    const row = window.pfCreateElement('div', 'pf-form-row');
    wrap.style.flex = '1';
    row.appendChild(wrap);
    row.appendChild(saveBtn);
    group.appendChild(row);
    if (desc) group.appendChild(window.pfCreateElement('div', 'pf-form-desc', { textContent: desc }));
    return group;
  };

  // 2. Provider API keys — one per provider, each passed only to that provider
  generalSection.appendChild(window.pfCreateElement('h3', 'pf-settings-subsection-title', { textContent: 'API Keys' }));

  // Encryption-at-rest status for keys, tokens and the DB URI
  const secretStatusEl = window.pfCreateElement('div', 'pf-form-desc pf-secret-status', { textContent: 'Checking key storage…' });
  generalSection.appendChild(secretStatusEl);
  if (window.ccBridge) {
    window.ccBridge.getSecretStorageStatus().then(s => {
      if (!s) return;
      const store = { gnome_libsecret: 'GNOME Keyring', kwallet: 'KWallet', kwallet5: 'KWallet', kwallet6: 'KWallet' }[s.backend]
        || { darwin: 'macOS Keychain', win32: 'Windows Data Protection' }[s.platform] || 'your system keychain';
      secretStatusEl.classList.toggle('is-warning', !s.encrypted);
      secretStatusEl.textContent = s.encrypted
        ? `🔒 Keys, tokens and the database URI are encrypted on disk with ${store}.`
        : '⚠️ No system keychain is available, so keys are stored unencrypted (owner-only file permissions). Install/unlock GNOME Keyring or KWallet and restart to encrypt them.';
    }).catch(() => { secretStatusEl.textContent = ''; });
  }
  const providerKeys = window.ccBridge ? window.ccBridge.getProviderApiKeys() : Promise.resolve({});
  const providerKeyFields = [
    { provider: 'gemini', label: 'Gemini API Key', placeholder: 'AIza…',
      desc: 'Used by Gemini Vision and the Gemini CLI. Get one free at aistudio.google.com/apikey.' },
    { provider: 'claude', label: 'Claude API Key (Anthropic)', placeholder: 'sk-ant-…',
      desc: 'Optional. Sent to the Claude CLI as ANTHROPIC_API_KEY — leave empty to use your `claude` login.' },
    { provider: 'codex', label: 'Codex API Key (OpenAI)', placeholder: 'sk-…',
      desc: 'Optional. Sent to the Codex CLI as OPENAI_API_KEY — leave empty to use your `codex` login.' },
    { provider: 'copilot', label: 'Copilot Token (GitHub)', placeholder: 'github_pat_… / ghp_…',
      desc: 'Optional. Sent to the Copilot CLI as GH_TOKEN — leave empty to use your GitHub CLI login.' }
  ];
  providerKeyFields.forEach(f => {
    generalSection.appendChild(secretField({
      id: `api-key-${f.provider}`,
      label: f.label,
      placeholder: f.placeholder,
      desc: f.desc,
      load: () => providerKeys.then(keys => keys[f.provider] || ''),
      save: (value) => window.ccBridge.setProviderApiKey(f.provider, value),
      savedMessage: `${f.label} updated. Open chats using it were restarted (conversation kept).`
    }));
  });

  // 3. ElevenLabs API Key
  generalSection.appendChild(window.pfCreateElement('h3', 'pf-settings-subsection-title', { textContent: 'Voice & Data' }));
  generalSection.appendChild(secretField({
    id: 'el-api-key',
    label: 'ElevenLabs API Key',
    desc: 'Used for speech-to-text (hold Space or the mic button in a chat).',
    load: () => window.ccBridge.getElevenLabsApiKey(),
    save: (value) => window.ccBridge.setElevenLabsApiKey(value),
    savedMessage: 'ElevenLabs key updated.'
  }));

  // 4. MongoDB URI (may embed a username and password, so it is hidden too)
  generalSection.appendChild(secretField({
    id: 'db-uri',
    label: 'MongoDB Connection URI',
    placeholder: 'mongodb+srv://...',
    desc: 'Stores agents, tasks and chat history. Restart the app after changing it.',
    load: () => window.ccBridge.getMongodbUri(),
    save: (value) => window.ccBridge.setMongodbUri(value),
    savedMessage: 'Database URI updated. Restart app to reconnect.'
  }));

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
