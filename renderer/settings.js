// renderer/settings.js

// ═══════════════════════════════════════════
//  Default MCP Integration Presets
// ═══════════════════════════════════════════
const DEFAULT_INTEGRATIONS = [
  {
    id: 'photoshop',
    name: 'Photoshop',
    category: 'Design',
    icon: '🎨',
    iconClass: 'photoshop',
    accentColor: '#31a8ff',
    description: 'Adobe Photoshop integration',
    command: 'npx',
    args: ['-y', '@alisaitteke/photoshop-mcp'],
    envKeys: []
  },
  {
    id: 'figma',
    name: 'Figma',
    category: 'Design',
    icon: '◆',
    iconClass: 'figma',
    accentColor: '#a259ff',
    description: 'Figma design platform',
    command: 'npx',
    args: ['-y', 'figma-developer-mcp', '--stdio'],
    envKeys: [
      { key: 'FIGMA_API_KEY', label: 'Figma API Key', placeholder: 'Enter your Figma access token…' }
    ]
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'Development',
    icon: '',
    iconClass: 'github',
    accentColor: '#8b949e',
    description: 'GitHub repositories & issues',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envKeys: [
      { key: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'GitHub PAT', placeholder: 'ghp_xxxxxxxxxxxx' }
    ]
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'Productivity',
    icon: '📝',
    iconClass: 'notion',
    accentColor: '#ffffff',
    description: 'Notion workspace & pages',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    envKeys: [
      { key: 'NOTION_API_KEY', label: 'Notion API Key', placeholder: 'ntn_xxxxxxxxxxxx' }
    ]
  }
];

// ═══════════════════════════════════════════
//  State
// ═══════════════════════════════════════════
let currentServers = {};
// In-memory store for API keys typed but not yet connected.
// Keyed as "presetId:envKey" → value. Survives re-renders.
const draftKeys = {};

// ═══════════════════════════════════════════
//  Load & Render
// ═══════════════════════════════════════════
async function loadAll() {
  currentServers = await window.assistant.getMcpServers() || {};
  renderDefaultIntegrations();
  renderCustomServers();
  updateConnectionStats();
}

function updateConnectionStats() {
  const count = Object.keys(currentServers).length;
  const el = document.getElementById('connected-count');
  if (el) el.textContent = count;

  const stats = document.getElementById('connection-stats');
  if (stats) {
    if (count > 0) {
      stats.style.borderColor = 'rgba(34,197,94,0.2)';
      stats.style.background = 'rgba(34,197,94,0.08)';
      stats.style.color = '#22c55e';
    } else {
      stats.style.borderColor = 'rgba(255,255,255,0.06)';
      stats.style.background = 'rgba(255,255,255,0.04)';
      stats.style.color = '#55556a';
    }
  }
}

// ═══════════════════════════════════════════
//  Default Integrations
// ═══════════════════════════════════════════
function renderDefaultIntegrations() {
  // Before rebuilding, capture any values currently typed in the DOM
  // so we don't lose them on re-render.
  DEFAULT_INTEGRATIONS.forEach(preset => {
    preset.envKeys.forEach(ek => {
      const input = document.getElementById(`key-${preset.id}-${ek.key}`);
      if (input && input.value) {
        draftKeys[`${preset.id}:${ek.key}`] = input.value;
      }
    });
  });

  const container = document.getElementById('default-integrations');
  container.innerHTML = '';

  DEFAULT_INTEGRATIONS.forEach(preset => {
    const isConnected = !!currentServers[preset.id];
    const serverConfig = currentServers[preset.id] || {};
    const card = document.createElement('div');
    card.className = `integration-card ${isConnected ? 'connected' : ''}`;
    card.style.setProperty('--card-accent', preset.accentColor);

    // Build env key inputs (value set programmatically below)
    let envInputsHTML = '';
    preset.envKeys.forEach(ek => {
      const savedVal = serverConfig.env?.[ek.key] || draftKeys[`${preset.id}:${ek.key}`] || '';
      envInputsHTML += `
        <div class="api-key-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          ${ek.label}
        </div>
        <div class="api-key-row">
          <input type="password" class="api-key-input ${savedVal ? 'saved' : ''}"
                 id="key-${preset.id}-${ek.key}"
                 data-preset-id="${preset.id}"
                 data-env-key="${ek.key}"
                 placeholder="${ek.placeholder}"
                 onfocus="this.type='text'"
                 onblur="this.type='password'">
        </div>
      `;
    });

    // GitHub icon SVG (since emoji doesn't work well)
    const iconContent = preset.id === 'github'
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="#e8e8ed"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.38.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.02 0c2.3-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.82.58C20.57 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z"/></svg>'
      : preset.icon;

    card.innerHTML = `
      <div class="card-top">
        <div class="card-brand">
          <div class="card-icon ${preset.iconClass}">${iconContent}</div>
          <div>
            <div class="card-name">${preset.name}</div>
            <div class="card-category">${preset.category}</div>
          </div>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" ${isConnected ? 'checked' : ''}
                 id="toggle-${preset.id}"
                 onchange="toggleIntegration('${preset.id}', this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="card-config">
        ${envInputsHTML}
      </div>
    `;

    container.appendChild(card);

    // Set input values programmatically (more reliable for password fields)
    // and attach live-save listeners so typed keys survive re-renders.
    preset.envKeys.forEach(ek => {
      const savedVal = serverConfig.env?.[ek.key] || draftKeys[`${preset.id}:${ek.key}`] || '';
      const input = document.getElementById(`key-${preset.id}-${ek.key}`);
      if (input) {
        input.value = savedVal;
        input.addEventListener('input', () => {
          draftKeys[`${preset.id}:${ek.key}`] = input.value;
        });
      }
    });
  });
}

// Toggle integration on/off
window.toggleIntegration = async function(presetId, enabled) {
  const preset = DEFAULT_INTEGRATIONS.find(p => p.id === presetId);
  if (!preset) return;

  if (enabled) {
    // Gather env vars from inputs AND draftKeys (fallback)
    const env = {};
    let missingKey = false;
    preset.envKeys.forEach(ek => {
      const input = document.getElementById(`key-${presetId}-${ek.key}`);
      const val = input?.value?.trim() || draftKeys[`${presetId}:${ek.key}`]?.trim() || '';
      if (!val) {
        missingKey = true;
        input?.focus();
        input?.classList.add('shake');
        setTimeout(() => input?.classList.remove('shake'), 500);
      }
      env[ek.key] = val;
    });

    if (missingKey) {
      // Uncheck the toggle
      const toggle = document.getElementById(`toggle-${presetId}`);
      if (toggle) toggle.checked = false;
      showToast(`Please enter your ${preset.name} API key first`, 'error');
      return;
    }

    // Add server config
    currentServers[presetId] = {
      command: preset.command,
      args: [...preset.args],
      env
    };
    // Sync draftKeys with the saved config
    preset.envKeys.forEach(ek => {
      draftKeys[`${presetId}:${ek.key}`] = env[ek.key];
    });
    showToast(`${preset.name} connected ✓`, 'success');
  } else {
    // Remove server but keep the keys in draftKeys so they're not lost
    const serverConfig = currentServers[presetId];
    if (serverConfig?.env) {
      preset.envKeys.forEach(ek => {
        if (serverConfig.env[ek.key]) {
          draftKeys[`${presetId}:${ek.key}`] = serverConfig.env[ek.key];
        }
      });
    }
    delete currentServers[presetId];
    showToast(`${preset.name} disconnected`, 'error');
  }

  await window.assistant.setMcpServers(currentServers);
  renderDefaultIntegrations();
  updateConnectionStats();
};

// ═══════════════════════════════════════════
//  Custom Servers
// ═══════════════════════════════════════════
function renderCustomServers() {
  const container = document.getElementById('custom-server-list');
  container.innerHTML = '';

  // Filter out preset IDs from the custom server list
  const presetIds = DEFAULT_INTEGRATIONS.map(p => p.id);
  const customNames = Object.keys(currentServers).filter(n => !presetIds.includes(n));

  if (customNames.length === 0) {
    container.innerHTML = '<div class="empty-state">No custom servers added yet</div>';
    return;
  }

  customNames.forEach(name => {
    const config = currentServers[name];
    const argsString = (config.args || []).join(' ');

    const card = document.createElement('div');
    card.className = 'custom-server-card';
    card.innerHTML = `
      <div class="server-info">
        <h4>${name}</h4>
        <code>${config.command} ${argsString}</code>
      </div>
      <button class="btn-remove" onclick="removeServer('${name}')">Remove</button>
    `;
    container.appendChild(card);
  });
}

// Remove a custom server
window.removeServer = async (name) => {
  if (confirm(`Remove "${name}" server?`)) {
    delete currentServers[name];
    await window.assistant.setMcpServers(currentServers);
    renderCustomServers();
    updateConnectionStats();
    showToast(`${name} removed`, 'error');
  }
};

// ═══════════════════════════════════════════
//  Add Custom Server Form
// ═══════════════════════════════════════════
window.toggleAddForm = function() {
  const fields = document.getElementById('add-form-fields');
  const btn = document.getElementById('add-toggle-btn');
  if (fields.style.display === 'none') {
    fields.style.display = 'block';
    btn.style.display = 'none';
  } else {
    fields.style.display = 'none';
    btn.style.display = 'flex';
  }
};

document.getElementById('add-server-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = document.getElementById('input-name').value.trim();
  const command = document.getElementById('input-command').value.trim();
  const argsInput = document.getElementById('input-args').value;
  const envInput = document.getElementById('input-env').value.trim();

  if (!name || !command) return;

  const args = argsInput.split(',').map(a => a.trim()).filter(a => a.length > 0);

  let env = {};
  if (envInput) {
    try {
      env = JSON.parse(envInput);
    } catch {
      showToast('Invalid JSON for environment variables', 'error');
      return;
    }
  }

  currentServers[name] = { command, args, env };
  await window.assistant.setMcpServers(currentServers);

  // Reset form
  document.getElementById('input-name').value = '';
  document.getElementById('input-command').value = 'npx';
  document.getElementById('input-args').value = '';
  document.getElementById('input-env').value = '';
  toggleAddForm();

  renderCustomServers();
  updateConnectionStats();
  showToast(`${name} added ✓`, 'success');
});

// ═══════════════════════════════════════════
//  Toast Notification
// ═══════════════════════════════════════════
let toastTimer = null;
function showToast(message, type = 'success') {
  // Remove existing toast
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  if (toastTimer) clearTimeout(toastTimer);

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'success'
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

  toast.innerHTML = `${icon} ${message}`;
  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });
  });

  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 2500);
}

// ═══════════════════════════════════════════
//  Init
// ═══════════════════════════════════════════
loadAll();