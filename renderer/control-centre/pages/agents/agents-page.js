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
  // Providers (built-ins + local models) and the default for new agents
  let providerList = [];
  let defaultProvider = 'vision';
  const resolveKey = (key) => (key === 'gemini' ? 'vision' : (key || defaultProvider)); // Gemini CLI was removed
  const providerName = (key) => providerList.find(p => p.key === resolveKey(key))?.name || key || 'Gemini Vision';
  const providerOptionLabel = (p) => (p.kind === 'ollama' ? `${p.name} — local (${p.model})` : p.name);

  async function loadAgents() {
    if (window.ccBridge) {
      try {
        const [agents, state, providers] = await Promise.all([
          window.ccBridge.getAgents(),
          window.ccBridge.getInitialState(),
          window.ccBridge.getProviders()
        ]);
        runningIds = new Set((state?.agents || []).map(a => String(a.id)));
        providerList = providers || [];
        defaultProvider = state?.provider || 'vision';
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
      const role = pfCreateElement('div', 'pf-agent-role', { textContent: providerName(agent.provider) });
      info.appendChild(role);
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
      // Each agent has its own provider — change it here (applies live if it's running)
      const providerRow = pfCreateElement('label', 'pf-agent-detail-row');
      providerRow.appendChild(pfCreateElement('span', 'pf-agent-detail-label', { textContent: 'Provider' }));
      const providerSelect = pfCreateElement('select', 'pf-input pf-select pf-agent-provider-select', { 'aria-label': `Provider for ${agent.name}` });
      const current = resolveKey(agent.provider);
      const known = providerList.some(p => p.key === current);
      [...(known ? [] : [{ key: current, name: `${current} (unavailable)` }]), ...providerList].forEach(p => {
        const opt = pfCreateElement('option', '', { value: p.key, textContent: p.model ? providerOptionLabel(p) : p.name });
        if (p.key === current) opt.selected = true;
        providerSelect.appendChild(opt);
      });
      providerSelect.onchange = async () => {
        const key = providerSelect.value;
        const ok = window.ccBridge && await window.ccBridge.setAgentProvider(String(agent._id), key);
        if (ok) {
          agent.provider = key;
          role.textContent = providerName(key);
          window.PFToast.show('Provider updated', `${agent.name} now uses ${providerName(key)}${isLaunched ? ' — conversation kept' : ''}.`);
        } else {
          providerSelect.value = current;
          window.PFToast.show('Error', `Could not change ${agent.name}'s provider.`);
        }
      };
      providerRow.appendChild(providerSelect);
      details.appendChild(providerRow);
      details.appendChild(makeRow('Theme', agent.theme || 'Midnight'));

      // Orchestrator: may split requests into sub-tasks for sub-agents (applies live)
      const orchRow = pfCreateElement('label', 'pf-agent-detail-row pf-agent-orchestrator');
      orchRow.appendChild(pfCreateElement('span', 'pf-agent-detail-label', {
        textContent: 'Orchestrator',
        title: 'Can hand parts of a request to sub-agents (any provider), which share a team memory'
      }));
      const orchToggle = pfCreateElement('input', 'pf-toggle', { type: 'checkbox', role: 'switch', 'aria-label': `${agent.name} can use sub-agents` });
      orchToggle.checked = agent.orchestrator !== false;
      orchToggle.onchange = async () => {
        const on = orchToggle.checked;
        const ok = window.ccBridge && await window.ccBridge.setAgentOrchestrator(String(agent._id), on);
        if (ok) {
          agent.orchestrator = on;
          window.PFToast.show('Updated', on ? `${agent.name} can now use sub-agents.` : `${agent.name} will answer everything itself.`);
        } else {
          orchToggle.checked = !on;
          window.PFToast.show('Error', `Could not update ${agent.name}.`);
        }
      };
      orchRow.appendChild(orchToggle);
      details.appendChild(orchRow);
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

      const memoryBtn = window.PFButton({ label: 'Team memory', variant: 'ghost', size: 'sm' });
      memoryBtn.onclick = () => showTeamMemory(agent);
      actions.appendChild(memoryBtn);

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
      Promise.all([window.ccBridge.getProviders(), window.ccBridge.getInitialState()]).then(([list, state]) => {
        provider.select.replaceChildren(...list.map(p => {
          const opt = pfCreateElement('option', '', { value: p.key, textContent: providerOptionLabel(p) });
          if (p.key === state?.provider) opt.selected = true; // pre-select the default
          return opt;
        }));
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

    const orchLabel = pfCreateElement('label', 'pf-checkbox-row');
    const orchBox = pfCreateElement('input', '', { type: 'checkbox' });
    orchBox.checked = true;
    orchLabel.appendChild(orchBox);
    orchLabel.appendChild(pfCreateElement('span', '', { textContent: 'Orchestrator — can hand parts of a request to sub-agents' }));
    box.appendChild(orchLabel);

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
        orchestrator: orchBox.checked
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

  /** Notes this agent and its sub-agents keep between conversations (text only). */
  async function showTeamMemory(agent) {
    const modal = pfCreateElement('div', 'pf-modal-overlay');
    const box = pfCreateElement('div', 'pf-modal-box pf-memory-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', `${agent.name}'s team memory`);
    box.appendChild(pfCreateElement('h2', '', { textContent: `${agent.name} · Team memory` }));
    box.appendChild(pfCreateElement('p', 'pf-memory-hint', {
      textContent: 'Facts the agent and its sub-agents chose to keep. They\'re added to its prompts so it remembers them in later conversations.'
    }));
    const list = pfCreateElement('div', 'pf-memory-list');
    box.appendChild(list);

    const footer = pfCreateElement('div', 'pf-modal-footer');
    const clearBtn = window.PFButton({ label: 'Clear all', variant: 'ghost' });
    const closeBtn = window.PFButton({ label: 'Close', variant: 'primary' });
    footer.append(clearBtn, closeBtn);
    box.appendChild(footer);
    modal.appendChild(box);
    document.body.appendChild(modal);
    const close = () => { modal.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    closeBtn.onclick = close;
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) close(); });

    async function render() {
      const notes = (await window.ccBridge.getTeamMemory(String(agent._id))) || [];
      list.replaceChildren();
      clearBtn.disabled = !notes.length;
      if (!notes.length) {
        list.appendChild(pfCreateElement('div', 'pf-memory-empty', { textContent: 'Nothing saved yet.' }));
        return;
      }
      notes.slice().reverse().forEach(n => {
        const row = pfCreateElement('div', 'pf-memory-note');
        const body = pfCreateElement('div', 'pf-memory-body');
        body.appendChild(pfCreateElement('div', 'pf-memory-text', { textContent: n.text }));
        const when = n.createdAt ? new Date(n.createdAt).toLocaleString() : '';
        body.appendChild(pfCreateElement('div', 'pf-memory-meta', {
          textContent: [n.author === 'orchestrator' ? agent.name : n.author, n.provider && providerName(n.provider), when].filter(Boolean).join(' · ')
        }));
        const del = window.PFButton({ label: 'Delete', variant: 'ghost', size: 'sm' });
        del.onclick = async () => {
          if (await window.ccBridge.deleteTeamMemory(String(agent._id), n._id)) render();
        };
        row.append(body, del);
        list.appendChild(row);
      });
    }
    clearBtn.onclick = async () => {
      if (!confirm(`Forget everything in ${agent.name}'s team memory?`)) return;
      if (await window.ccBridge.clearTeamMemory(String(agent._id))) render();
    };
    render();
  }

  loadAgents();
  return container;
}

window.AgentsPage = AgentsPage;
