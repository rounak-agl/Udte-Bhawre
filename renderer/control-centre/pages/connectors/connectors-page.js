// renderer/control-centre/pages/connectors/connectors-page.js

function ConnectorsPage() {
  const container = window.pfCreateElement('div', 'pf-page-connectors');
  
  // Header
  const header = window.pfCreateElement('div', 'pf-connectors-header');
  header.appendChild(window.pfCreateElement('h1', 'pf-connectors-title', { textContent: 'Connectors & MCPs' }));
  
  const addBtn = window.PFButton({ label: 'Add Custom Server', icon: window.PFIcons.plus, variant: 'secondary' });
  addBtn.onclick = () => showCustomServerModal();
  header.appendChild(addBtn);
  container.appendChild(header);

  // Sync with renderer/settings.js DEFAULT_INTEGRATIONS
  const defaultConnectors = [
    { 
      id: 'photoshop', 
      name: 'Photoshop', 
      desc: 'Adobe Photoshop integration', 
      icon: '🎨', 
      command: 'npx',
      args: ['-y', '@alisaitteke/photoshop-mcp'],
      envKeys: []
    },
    { 
      id: 'figma', 
      name: 'Figma', 
      desc: 'Figma design platform', 
      icon: '◆', 
      command: 'npx',
      args: ['-y', 'figma-developer-mcp', '--stdio'],
      envKeys: [
        { key: 'FIGMA_API_KEY', label: 'Figma API Key', placeholder: 'Enter figma token...' }
      ]
    },
    { 
      id: 'github', 
      name: 'GitHub', 
      desc: 'GitHub repositories & issues', 
      icon: '🐙', 
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      envKeys: [
        { key: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'GitHub PAT', placeholder: 'ghp_...' }
      ]
    },
    { 
      id: 'notion', 
      name: 'Notion', 
      desc: 'Notion workspace & pages', 
      icon: '📝', 
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      envKeys: [
        { key: 'NOTION_API_KEY', label: 'Notion API Key', placeholder: 'ntn_...' }
      ]
    }
  ];

  const grid = window.pfCreateElement('div', 'pf-connectors-grid');
  
  // Local state for draft keys (similar to settings.js draftKeys)
  const draftKeys = {};

  // Fetch current MCP servers from bridge
  let activeServers = {};
  
  async function loadData() {
    if (window.ccBridge) {
      activeServers = await window.ccBridge.getMcpServers() || {};
      renderGrid();
    }
  }

  function renderGrid() {
    grid.innerHTML = '';
    
    // 1. Get all unique server IDs (Defaults + Active)
    const allServerIds = new Set([
      ...defaultConnectors.map(c => c.id),
      ...Object.keys(activeServers)
    ]);

    allServerIds.forEach(id => {
      const def = defaultConnectors.find(c => c.id === id);
      const isCustom = !def;
      const isConnected = !!activeServers[id];
      const serverConfig = activeServers[id] || {};

      const card = window.pfCreateElement('div', 'pf-connector-card');
      if (isConnected) card.classList.add('connected');

      const cardHd = window.pfCreateElement('div', 'pf-connector-card-header');
      
      // Icon
      const icon = def ? def.icon : '⚙️';
      cardHd.appendChild(window.pfCreateElement('div', 'pf-connector-icon', { textContent: icon }));

      // Info
      const info = window.pfCreateElement('div', 'pf-connector-info');
      const name = def ? def.name : id;
      const desc = def ? def.desc : (serverConfig.command ? `${serverConfig.command} ${serverConfig.args?.join(' ')}` : 'Custom MCP Server');
      
      const nameRow = window.pfCreateElement('div', 'pf-connector-name', { textContent: name });
      if (isCustom) {
        nameRow.appendChild(window.PFBadge({ label: 'CUSTOM', variant: 'secondary' }));
        nameRow.style.display = 'flex';
        nameRow.style.alignItems = 'center';
        nameRow.style.gap = '8px';
      }
      info.appendChild(nameRow);
      info.appendChild(window.pfCreateElement('div', 'pf-connector-desc', { textContent: desc }));
      cardHd.appendChild(info);

      // Status
      const statusDiv = window.pfCreateElement('div', `pf-connector-status ${isConnected ? 'connected' : 'disconnected'}`, {
        textContent: isConnected ? 'CONNECTED' : 'NOT CONNECTED'
      });
      cardHd.appendChild(statusDiv);
      card.appendChild(cardHd);

      // Default Config Area (for API Keys)
      if (def && def.envKeys.length > 0) {
        const configArea = window.pfCreateElement('div', 'pf-connector-config');
        def.envKeys.forEach(ek => {
          const savedVal = serverConfig.env?.[ek.key] || draftKeys[`${id}:${ek.key}`] || '';
          const inputWrap = window.PFInput({
            label: ek.label,
            type: 'password',
            placeholder: ek.placeholder,
            value: savedVal,
            onInput: (val) => {
              draftKeys[`${id}:${ek.key}`] = val;
            }
          });
          configArea.appendChild(inputWrap);
        });
        card.appendChild(configArea);
      }

      // Actions
      const actions = window.pfCreateElement('div', 'pf-connector-actions');
      
      // Edit button for custom servers
      if (isCustom) {
        const editBtn = window.PFButton({ label: 'Edit', variant: 'ghost', size: 'sm' });
        editBtn.onclick = () => showCustomServerModal(id);
        actions.appendChild(editBtn);
      }

      const toggleBtn = window.PFButton({
        label: isConnected ? 'Disconnect' : 'Connect',
        variant: isConnected ? 'ghost' : 'primary',
        size: 'sm'
      });

      toggleBtn.onclick = async () => {
        if (isConnected) {
          delete activeServers[id];
          if (window.ccBridge) await window.ccBridge.setMcpServers(activeServers);
          window.PFToast.show('Disconnected', `${name} MCP server disconnected`);
          renderGrid();
        } else {
          const env = serverConfig.env || {};
          let missing = false;

          // If default connector, check for missing keys in draft
          if (def) {
            def.envKeys.forEach(ek => {
              const val = draftKeys[`${id}:${ek.key}`]?.trim() || serverConfig.env?.[ek.key] || '';
              if (!val) missing = true;
              env[ek.key] = val;
            });
          }

          if (missing) {
            window.PFToast.show('Error', `Please enter your ${name} API key`);
            return;
          }

          activeServers[id] = {
            command: def ? def.command : serverConfig.command,
            args: def ? [...def.args] : [...(serverConfig.args || [])],
            env
          };
          if (window.ccBridge) await window.ccBridge.setMcpServers(activeServers);
          window.PFToast.show('Connected', `${name} MCP server connected`);
          renderGrid();
        }
      };
      
      actions.appendChild(toggleBtn);
      card.appendChild(actions);
      grid.appendChild(card);
    });
  }

  function showCustomServerModal(editingId = null) {
    const config = editingId ? activeServers[editingId] : { command: 'npx', args: [], env: {} };
    
    const overlay = window.pfCreateElement('div', 'pf-modal-overlay');
    const container = window.pfCreateElement('div', 'pf-modal-container');
    
    // Header
    const header = window.pfCreateElement('div', 'pf-modal-header');
    header.appendChild(window.pfCreateElement('h2', 'pf-modal-title', { textContent: editingId ? 'Edit MCP Server' : 'Add Custom MCP Server' }));
    const closeBtn = window.PFButton({ icon: '✕', variant: 'ghost', size: 'sm' });
    closeBtn.onclick = () => overlay.remove();
    header.appendChild(closeBtn);
    container.appendChild(header);

    // Body
    const body = window.pfCreateElement('div', 'pf-modal-body');
    
    const idInput = window.PFInput({ label: 'Server ID (Unique Label)', placeholder: 'e.g. my-server', value: editingId || '', disabled: !!editingId });
    body.appendChild(idInput);

    const cmdInput = window.PFInput({ label: 'Command', placeholder: 'e.g. npx, node, python', value: config.command || 'npx' });
    body.appendChild(cmdInput);

    const argsInput = window.PFInput({ label: 'Arguments (space separated)', placeholder: 'e.g. -y @org/server --port 3000', value: config.args?.join(' ') || '' });
    body.appendChild(argsInput);

    const envGroup = window.pfCreateElement('div', 'pf-form-row--env');
    envGroup.appendChild(window.pfCreateElement('label', 'pf-input-label', { textContent: 'Environment Variables' }));
    const envText = window.pfCreateElement('textarea', 'pf-env-textarea', { 
      placeholder: 'KEY1=VALUE1\nKEY2=VALUE2',
    });
    envText.value = Object.entries(config.env || {}).map(([k,v]) => `${k}=${v}`).join('\n');
    envGroup.appendChild(envText);
    envGroup.appendChild(window.pfCreateElement('div', 'pf-env-desc', { textContent: 'Enter one variable per line in KEY=VALUE format' }));
    body.appendChild(envGroup);
    
    container.appendChild(body);

    // Footer
    const footer = window.pfCreateElement('div', 'pf-modal-footer');
    
    if (editingId) {
      const deleteBtn = window.PFButton({ label: 'Delete', variant: 'ghost' });
      deleteBtn.onclick = async () => {
        if (confirm(`Delete MCP server "${editingId}"?`)) {
          delete activeServers[editingId];
          if (window.ccBridge) await window.ccBridge.setMcpServers(activeServers);
          overlay.remove();
          renderGrid();
        }
      };
      footer.appendChild(deleteBtn);
    }

    const cancelBtn = window.PFButton({ label: 'Cancel', variant: 'secondary' });
    cancelBtn.onclick = () => overlay.remove();
    footer.appendChild(cancelBtn);

    const saveBtn = window.PFButton({ label: editingId ? 'Update' : 'Add Server', variant: 'primary' });
    saveBtn.onclick = async () => {
      const id = idInput.querySelector('input').value.trim();
      const cmd = cmdInput.querySelector('input').value.trim();
      const argsStr = argsInput.querySelector('input').value.trim();
      
      if (!id || !cmd) {
        window.PFToast.show('Error', 'ID and Command are required');
        return;
      }

      // Parse env
      const env = {};
      envText.value.split('\n').forEach(line => {
        const [k, ...v] = line.split('=');
        if (k && v.length > 0) env[k.trim()] = v.join('=').trim();
      });

      activeServers[id] = {
        command: cmd,
        args: argsStr ? argsStr.split(/\s+/) : [],
        env
      };

      if (window.ccBridge) await window.ccBridge.setMcpServers(activeServers);
      window.PFToast.show('Success', `MCP Server ${editingId ? 'updated' : 'added'}`);
      overlay.remove();
      renderGrid();
    };
    footer.appendChild(saveBtn);
    
    container.appendChild(footer);
    overlay.appendChild(container);
    document.body.appendChild(overlay);
  }

  loadData();
  container.appendChild(grid);
  return container;
}

window.ConnectorsPage = ConnectorsPage;
