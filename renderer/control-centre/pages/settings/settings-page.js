// renderer/control-centre/pages/settings/settings-page.js

function SettingsPage() {
  const container = window.pfCreateElement('div', 'pf-page-settings');
  
  // Left Nav
  const nav = window.pfCreateElement('div', 'pf-settings-nav');
  nav.appendChild(window.pfCreateElement('h3', 'pf-settings-nav-title', { textContent: 'Settings' }));
  const menu = window.pfCreateElement('div', 'pf-settings-menu');
  const sectionsMenu = [
    { id: 'general', label: 'General' },
    { id: 'models', label: 'Custom LLMs' },
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
  
  // 1. Default provider — built-ins plus the user's local models (from the registry)
  const providerGroup = window.pfCreateElement('div', 'pf-form-group');
  providerGroup.appendChild(window.pfCreateElement('label', 'pf-input-label', { textContent: 'Default provider for new agents', for: 'default-provider' }));
  const providerSelect = window.pfCreateElement('select', 'pf-input pf-select', { id: 'default-provider' });
  providerGroup.appendChild(providerSelect);
  providerGroup.appendChild(window.pfCreateElement('div', 'pf-form-desc', {
    textContent: 'Pre-selected when you create an agent. Every agent keeps its own provider — change it on the Agents page, in its chat\'s ⚙ menu, or from the tray.'
  }));
  generalSection.appendChild(providerGroup);

  const providerLabel = (p) => p.kind === 'ollama' ? `${p.name} — local (${p.model})` : p.name;

  // Rebuilt after custom models are added/removed
  const refreshProviderSelect = async () => {
    if (!window.ccBridge) return;
    const [list, state] = await Promise.all([window.ccBridge.getProviders(), window.ccBridge.getInitialState()]);
    const selected = state?.provider || window.store.get('provider');
    providerSelect.replaceChildren(...list.map(p => {
      const opt = window.pfCreateElement('option', '', { value: p.key, textContent: providerLabel(p) });
      if (p.key === selected) opt.selected = true;
      return opt;
    }));
  };
  providerSelect.onchange = () => {
    const key = providerSelect.value;
    window.store.set('provider', key);
    if (window.ccBridge) window.ccBridge.setProvider(key);
    window.PFToast.show('Default updated', `New agents will start with ${providerSelect.selectedOptions[0]?.textContent || key}.`);
  };
  refreshProviderSelect().catch(() => {});

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
      desc: 'Used by Gemini Vision. Get one free at aistudio.google.com/apikey.' },
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

  // Small builders shared by the sections below (text only — values may be user input)
  const el = (tag, cls, text) => window.pfCreateElement(tag, cls, text === undefined ? {} : { textContent: text });
  const infoRow = (label, value) => {
    const row = el('div', 'pf-info-row');
    row.append(el('div', 'pf-info-label', label), el('div', 'pf-info-value', value));
    return row;
  };
  const chips = (items, empty) => {
    const wrap = el('div', 'pf-chip-list');
    if (!items.length) wrap.appendChild(el('span', 'pf-form-desc', empty));
    items.forEach(i => wrap.appendChild(el('code', 'pf-chip', i)));
    return wrap;
  };

  // --- CUSTOM LLMs (Ollama) ---
  const modelsSection = window.pfCreateElement('div', 'pf-settings-section', { id: 'settings-models' });
  modelsSection.appendChild(el('h2', 'pf-settings-section-title', 'Custom LLMs'));
  modelsSection.appendChild(el('p', 'pf-form-desc',
    'Run your own models locally with Ollama. Pull a model first (e.g. `ollama pull llama3.2`), then add it here — ' +
    'it appears as a provider for agents and in every chat\'s ⚙ menu. Local models chat only; they don\'t get desktop tools.'));

  const modelList = el('div', 'pf-model-list');
  modelsSection.appendChild(modelList);

  const renderModelList = async () => {
    const list = window.ccBridge ? (await window.ccBridge.getProviders()).filter(p => p.kind === 'ollama') : [];
    modelList.replaceChildren();
    if (!list.length) {
      modelList.appendChild(el('div', 'pf-model-empty', 'No local models yet.'));
      return;
    }
    list.forEach(m => {
      const row = el('div', 'pf-model-row');
      const info = el('div', 'pf-model-info');
      info.append(el('div', 'pf-model-name', `🦙 ${m.name}`), el('div', 'pf-model-meta', `${m.model} · ${m.baseUrl}`));
      const removeBtn = window.PFButton({ label: 'Remove', variant: 'ghost', size: 'sm' });
      removeBtn.onclick = async () => {
        if (!confirm(`Remove ${m.name}? Agents using it will ask you to pick another provider.`)) return;
        if (await window.ccBridge.removeCustomModel(m.key.slice('ollama:'.length))) {
          window.PFToast.show('Removed', `${m.name} removed.`);
          renderModelList();
          refreshProviderSelect();
        }
      };
      row.append(info, removeBtn);
      modelList.appendChild(row);
    });
  };

  // Add form: server URL → suggestions from the models pulled there (free text still allowed)
  modelsSection.appendChild(el('h3', 'pf-settings-subsection-title', 'Add a model'));
  const urlWrap = window.PFInput({ label: 'Ollama server', value: 'http://localhost:11434', id: 'ollama-url' });
  const urlInput = urlWrap.querySelector('input');
  const findBtn = window.PFButton({ label: 'Find models', variant: 'secondary' });
  const urlRow = el('div', 'pf-form-row');
  urlWrap.style.flex = '1';
  urlRow.append(urlWrap, findBtn);
  modelsSection.appendChild(urlRow);

  const modelWrap = window.PFInput({ label: 'Model', placeholder: 'e.g. llama3.2 or qwen2.5-coder:7b', id: 'ollama-model' });
  const modelInput = modelWrap.querySelector('input');
  const datalist = window.pfCreateElement('datalist', '', { id: 'ollama-model-options' });
  modelInput.setAttribute('list', 'ollama-model-options');
  modelInput.setAttribute('autocomplete', 'off');
  modelWrap.appendChild(datalist);
  modelsSection.appendChild(modelWrap);
  const findStatus = el('div', 'pf-form-desc', '');
  modelsSection.appendChild(findStatus);

  const nameWrap = window.PFInput({ label: 'Display name (optional)', placeholder: 'e.g. Llama (local)', id: 'ollama-name' });
  modelsSection.appendChild(nameWrap);

  const findModels = async () => {
    if (!window.ccBridge) return;
    findStatus.classList.remove('is-warning');
    findStatus.textContent = 'Looking for models…';
    const res = await window.ccBridge.listOllamaModels(urlInput.value.trim());
    if (!res.ok) {
      findStatus.classList.add('is-warning');
      findStatus.textContent = `⚠️ ${res.error} You can still type a model name.`;
      datalist.replaceChildren();
      return;
    }
    datalist.replaceChildren(...res.models.map(m => window.pfCreateElement('option', '', { value: m.name })));
    findStatus.textContent = res.models.length
      ? `Found ${res.models.length} pulled model${res.models.length === 1 ? '' : 's'}: ${res.models.map(m => m.name).join(', ')}`
      : 'Ollama is running but has no models yet — pull one with `ollama pull <model>`.';
    if (!modelInput.value && res.models[0]) modelInput.value = res.models[0].name;
  };
  findBtn.onclick = findModels;

  const addBtn = window.PFButton({ label: 'Add model', variant: 'primary' });
  addBtn.onclick = async () => {
    if (!window.ccBridge) return;
    const res = await window.ccBridge.addCustomModel({
      baseUrl: urlInput.value.trim(),
      model: modelInput.value.trim(),
      name: nameWrap.querySelector('input').value.trim()
    });
    if (!res.ok) {
      window.PFToast.show('Error', res.error);
      return;
    }
    window.PFToast.show('Added', `${res.model.name} is now available as a provider.`);
    modelInput.value = '';
    nameWrap.querySelector('input').value = '';
    renderModelList();
    refreshProviderSelect();
  };
  const addRow = el('div', 'pf-form-actions');
  addRow.appendChild(addBtn);
  modelsSection.appendChild(addRow);

  renderModelList().catch(() => {});
  findModels().catch(() => {});
  content.appendChild(modelsSection);

  // --- SECURITY & ACCESS: the ArmorIQ guard (configurable) + what protects you ---
  const secSection = window.pfCreateElement('div', 'pf-settings-section', { id: 'settings-security' });
  secSection.appendChild(el('h2', 'pf-settings-section-title', 'Security & Access'));
  secSection.appendChild(el('p', 'pf-form-desc', 'How your agents are kept safe when they act on your computer.'));
  const secBody = el('div', 'pf-info-list');
  secSection.appendChild(secBody);

  const card = (title, ...children) => {
    const c = el('div', 'pf-info-card');
    c.appendChild(el('h3', 'pf-info-card-title', title));
    c.append(...children);
    return c;
  };

  // Connection test result, shown under the key field
  const testStatus = el('div', 'pf-form-desc pf-armoriq-test', '');
  const runArmorIQTest = async () => {
    testStatus.className = 'pf-form-desc pf-armoriq-test';
    testStatus.textContent = 'Testing…';
    const r = await window.ccBridge.testArmorIQ();
    if (!r) return;
    const icon = { ok: '✅', off: '○', invalid: '❌', unreachable: '🔌', error: '⚠️' }[r.state] || '';
    testStatus.classList.add(`is-${r.state}`);
    testStatus.textContent = `${icon} ${r.message}`;
  };

  const renderSecurity = () => window.ccBridge.getSecurityOverview().then(s => {
    if (!s) return;
    secBody.replaceChildren();

    // ArmorIQ guard: status, key, connection test
    const guardStatus = el('div', `pf-status ${s.guard.active ? 'is-ok' : 'is-off'}`, s.guard.active ? '● Active' : '○ Off — add a key to turn it on');
    const keyField = secretField({
      id: 'armoriq-key',
      label: 'ArmorIQ API key',
      placeholder: 'ak_live_…',
      desc: s.guard.envOverride
        ? 'Note: the ARMORIQ_API_KEY environment variable is set and takes priority over this field.'
        : 'Get a key from your ArmorIQ dashboard. Stored encrypted; open chats pick it up right away.',
      load: () => window.ccBridge.getArmorIQKey(),
      save: async (value) => {
        await window.ccBridge.setArmorIQKey(value);
        await renderSecurity();
        if (value) runArmorIQTest();
      },
      savedMessage: 'ArmorIQ key updated.'
    });
    const testBtn = window.PFButton({ label: 'Test connection', variant: 'secondary', size: 'sm' });
    testBtn.onclick = runArmorIQTest;
    const testRow = el('div', 'pf-form-row');
    testRow.append(testBtn);

    secBody.append(
      card('ArmorIQ guard', guardStatus,
        el('p', 'pf-form-desc', 'Before an agent uses a desktop tool, ArmorIQ seals the actions it is allowed to take for that message; anything else is blocked. ' +
          "If ArmorIQ can't be reached, each action asks for your OK (Allow / Deny) instead. Every chat shows the guard's state with a 🛡 badge."),
        keyField, testRow, testStatus,
        s.guard.active ? el('p', 'pf-form-desc', `Key in use: from ${s.guard.keySource}.`) : el('span', '')),
      card('Policy (armoriq.policy.json)',
        el('div', 'pf-info-label', 'Always blocked'), chips(s.policy.deny, 'None'),
        el('div', 'pf-info-label', 'Allowed tools'), chips(s.policy.allow, 'All tools (no allow-list set)'),
        el('p', 'pf-form-desc', `Edit ${s.policy.path} to change these; restart to apply.`)),
      card('Ask before running', chips(s.approvalTools, 'Nothing'),
        el('p', 'pf-form-desc', 'These desktop tools show an Allow / Deny prompt every time.')),
      card('File access', el('p', 'pf-info-value', s.fileAccess)),
      card('Stored secrets', el('p', 'pf-info-value', s.secrets.encrypted
        ? `Encrypted with your system keychain${s.secrets.backend ? ` (${s.secrets.backend})` : ''}.`
        : 'Not encrypted — no system keychain available (file is owner-only).'))
    );
  }).catch(() => secBody.replaceChildren(el('p', 'pf-form-desc', 'Could not load the security overview.')));

  if (window.ccBridge) renderSecurity();
  content.appendChild(secSection);

  // --- ABOUT ---
  const abtSection = window.pfCreateElement('div', 'pf-settings-section', { id: 'settings-about' });
  abtSection.appendChild(el('h2', 'pf-settings-section-title', 'About'));
  const aboutBody = el('div', 'pf-info-card');
  abtSection.appendChild(aboutBody);
  if (window.ccBridge) {
    window.ccBridge.getAppInfo().then(info => {
      aboutBody.append(
        infoRow('App', `${info.name} ${info.version}`),
        infoRow('Electron', `${info.electron} (Chromium ${info.chrome}, Node ${info.node})`),
        infoRow('Platform', info.platform),
        infoRow('Database', info.database),
        infoRow('Settings file', info.settingsFile),
        infoRow('Policy file', info.policyFile)
      );
    }).catch(() => {});
  }
  content.appendChild(abtSection);

  container.appendChild(content);
  return container;
}

window.SettingsPage = SettingsPage;
