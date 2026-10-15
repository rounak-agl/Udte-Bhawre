// renderer/control-centre/pages/agents/agents-page.js

function AgentsPage() {
  const container = pfCreateElement('div', 'pf-page-agents');
  
  // Header
  const header = pfCreateElement('div', 'pf-agents-header');
  header.appendChild(pfCreateElement('h1', 'pf-agents-title', { textContent: 'Agents' }));
  
  const createBtn = window.PFButton({ label: 'Create Agent', icon: window.PFIcons.plus, variant: 'secondary' });
  createBtn.onclick = () => showCreateModal();
  header.appendChild(createBtn);
  container.appendChild(header);

  // Grid for cards
  const grid = pfCreateElement('div', 'pf-agents-grid');
  container.appendChild(grid);

  // Agents currently on the desktop (launched), by id
  let runningIds = new Set();
  // Provider key → display name (built-ins + local models)
  let providerNames = {};
  const providerName = (key) => providerNames[key === 'gemini' ? 'vision' : (key || 'vision')] || key || 'Gemini Vision';

  async function loadAgents() {
    if (window.ccBridge) {
      try {
        const [agents, state, providers] = await Promise.all([
          window.ccBridge.getAgents(),
          window.ccBridge.getInitialState(),
          window.ccBridge.getProviders()
        ]);
        runningIds = new Set((state?.agents || []).map(a => String(a.id)));
        providerNames = Object.fromEntries((providers || []).map(p => [p.key, p.name]));
        renderAgents(agents || []);
      } catch (e) {
        renderAgents([]);
      }
    }
  }

  function renderAgents(agents) {
    grid.innerHTML = '';
    
    if (agents.length === 0) {
      grid.appendChild(pfCreateElement('div', '', { 
        textContent: 'No agents found. Create one to get started!',
        style: 'padding: 32px; color: var(--pf-color-text-muted); grid-column: 1 / -1; text-align: center;'
      }));
      return;
    }

    agents.forEach(agent => {
      const card = pfCreateElement('div', 'pf-agent-card');
      const isLaunched = runningIds.has(String(agent._id));

      const cardHeader = pfCreateElement('div', 'pf-agent-card-header');
      cardHeader.appendChild(PFAvatar({ initials: agent.name?.charAt(0) || '?', shape: 'square', size: 'lg' }));
      
      const info = pfCreateElement('div', 'pf-agent-info');
      info.appendChild(pfCreateElement('div', 'pf-agent-name', { textContent: agent.name }));
      info.appendChild(pfCreateElement('div', 'pf-agent-role', { textContent: providerName(agent.provider) }));
      cardHeader.appendChild(info);
      
      const status = pfCreateElement('div', `pf-agent-status ${isLaunched ? 'active' : ''}`, 
        { textContent: isLaunched ? 'RUNNING' : 'IDLE' }
      );
      cardHeader.appendChild(status);
      card.appendChild(cardHeader);
      
      const details = pfCreateElement('div', 'pf-agent-details');
      const makeRow = (lbl, val) => {
        const row = pfCreateElement('div', 'pf-agent-detail-row');
        row.appendChild(pfCreateElement('span', 'pf-agent-detail-label', { textContent: lbl }));
        row.appendChild(pfCreateElement('span', 'pf-agent-detail-value', { textContent: val || '--' }));
        return row;
      };
      details.appendChild(makeRow('Provider', providerName(agent.provider)));
      details.appendChild(makeRow('Theme', agent.theme || 'Midnight'));
      card.appendChild(details);

      const actions = pfCreateElement('div', 'pf-agent-actions');
      
      const deleteBtn = window.PFButton({ label: 'Remove', variant: 'ghost', size: 'sm' });
      deleteBtn.onclick = async () => {
        if (confirm(`Remove ${agent.name}? Its saved conversations will be deleted too. Its tasks are kept, unassigned.`)) {
           if (window.ccBridge) {
             const success = await window.ccBridge.deleteAgent(agent._id);
             if (success) {
               window.PFToast.show('Success', `${agent.name} removed.`);
               loadAgents();
             } else {
               window.PFToast.show('Error', `Could not remove ${agent.name}.`);
             }
           }
        }
      };
      actions.appendChild(deleteBtn);

      const launchBtn = window.PFButton({ label: isLaunched ? 'Running' : 'Launch', variant: 'primary', size: 'sm', disabled: isLaunched });
      launchBtn.onclick = () => {
        if (window.ccBridge) window.ccBridge.launchAgent(agent);
        window.PFToast.show('Success', `Launching ${agent.name}...`);
        setTimeout(loadAgents, 300); // refresh the RUNNING badge
      };
      actions.appendChild(launchBtn);
      card.appendChild(actions);
      
      grid.appendChild(card);
    });
  }

  function showCreateModal() {
    // Basic modal for agent creation
    const modal = pfCreateElement('div', 'pf-modal-overlay');
    const box = pfCreateElement('div', 'pf-modal-box');
    
    box.appendChild(pfCreateElement('h2', '', { textContent: 'Create New Agent', style: 'margin-bottom: 24px;' }));
    
    const nameInput = window.PFInput({ label: 'Agent Name', placeholder: 'e.g. Buddy' });
    box.appendChild(nameInput);
    
    // Selects, not free text: the database only accepts these exact values
    const makeSelect = (label, options, selected) => {
      const group = pfCreateElement('div', 'pf-form-group');
      const id = `pf-select-${Math.random().toString(36).slice(2, 9)}`;
      group.appendChild(pfCreateElement('label', 'pf-input-label', { textContent: label, for: id }));
      const select = pfCreateElement('select', 'pf-input pf-select', { id });
      options.forEach(([value, text]) => {
        const opt = pfCreateElement('option', '', { value, textContent: text });
        if (value === selected) opt.selected = true;
        select.appendChild(opt);
      });
      group.appendChild(select);
      return { group, select };
    };

    // Built-ins + the user's local models, from the provider registry
    const provider = makeSelect('Provider', [['vision', 'Gemini Vision']], 'vision');
    box.appendChild(provider.group);
    if (window.ccBridge) {
      window.ccBridge.getProviders().then(list => {
        provider.select.replaceChildren(...list.map(p => pfCreateElement('option', '', {
          value: p.key,
          textContent: p.kind === 'ollama' ? `${p.name} — local (${p.model})` : p.name
        })));
      }).catch(() => {});
    }

    const theme = makeSelect('Theme', [
      ['Midnight', 'Midnight'], ['Peach', 'Peach'], ['Cloud', 'Cloud'], ['Moss', 'Moss']
    ], 'Midnight');
    box.appendChild(theme.group);

    const contextInput = window.PFInput({ label: 'Custom System Prompt (.md)', placeholder: '/path/to/prompt.md' });
    const browseBtn = window.PFButton({ label: 'Browse', variant: 'secondary', size: 'sm' });
    browseBtn.onclick = async () => {
      const path = await window.ccBridge.chooseContextFile();
      if (path) contextInput.querySelector('input').value = path;
    };
    box.appendChild(contextInput);
    box.appendChild(browseBtn);

    const footer = pfCreateElement('div', 'pf-modal-footer', { style: 'margin-top: 24px; display: flex; justify-content: flex-end; gap: 12px;' });
    
    const cancelBtn = window.PFButton({ label: 'Cancel', variant: 'ghost' });
    cancelBtn.onclick = () => modal.remove();
    
    const saveBtn = window.PFButton({ label: 'Save Agent', variant: 'primary' });
    saveBtn.onclick = async () => {
      const config = {
        name: nameInput.querySelector('input').value.trim() || 'New Agent',
        provider: provider.select.value,
        theme: theme.select.value,
        contextFile: contextInput.querySelector('input').value.trim(),
      };
      if (window.ccBridge) {
        const success = await window.ccBridge.saveAgent(config);
        if (success) {
          window.PFToast.show('Success', 'Agent created successfully');
          modal.remove();
          loadAgents();
        } else {
          window.PFToast.show('Error', 'Failed to save agent — is the database connected?');
        }
      }
    };

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    box.appendChild(footer);
    modal.appendChild(box);
    document.body.appendChild(modal);
  }

  loadAgents();
  return container;
}

window.AgentsPage = AgentsPage;
