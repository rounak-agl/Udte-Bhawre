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

  async function loadAgents() {
    if (window.ccBridge) {
      try {
        const agents = await window.ccBridge.getAgents();
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
      const isLaunched = false; // We could check characters in initial state, but for now just show launch

      const cardHeader = pfCreateElement('div', 'pf-agent-card-header');
      cardHeader.appendChild(PFAvatar({ initials: agent.name?.charAt(0) || '?', shape: 'square', size: 'lg' }));
      
      const info = pfCreateElement('div', 'pf-agent-info');
      info.appendChild(pfCreateElement('div', 'pf-agent-name', { textContent: agent.name }));
      info.appendChild(pfCreateElement('div', 'pf-agent-role', { textContent: agent.provider || 'vision' }));
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
      details.appendChild(makeRow('Provider', PFUtils.capitalize(agent.provider || 'vision')));
      details.appendChild(makeRow('Theme', agent.theme || 'Midnight'));
      card.appendChild(details);

      const actions = pfCreateElement('div', 'pf-agent-actions');
      
      const deleteBtn = window.PFButton({ label: 'Remove', variant: 'ghost', size: 'sm' });
      deleteBtn.onclick = async () => {
        if (confirm(`Are you sure you want to remove ${agent.name}?`)) {
           if (window.ccBridge) {
             const success = await window.ccBridge.deleteAgent(agent._id);
             if (success) {
               window.PFToast.show('Success', `${agent.name} removed.`);
               loadAgents();
             }
           }
        }
      };
      actions.appendChild(deleteBtn);

      const launchBtn = window.PFButton({ label: 'Launch', variant: 'primary', size: 'sm' });
      launchBtn.onclick = () => {
        if (window.ccBridge) window.ccBridge.launchAgent(agent);
        window.PFToast.show('Success', `Launching ${agent.name}...`);
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
    
    const providerInput = window.PFInput({ label: 'Provider', value: 'vision' });
    box.appendChild(providerInput);

    const themeInput = window.PFInput({ label: 'Theme (Peach, Midnight, Cloud, Moss)', value: 'Midnight' });
    box.appendChild(themeInput);

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
        name: nameInput.querySelector('input').value || 'New Agent',
        provider: providerInput.querySelector('input').value || 'vision',
        theme: themeInput.querySelector('input').value || 'Midnight',
        contextFile: contextInput.querySelector('input').value || '',
      };
      if (window.ccBridge) {
        const success = await window.ccBridge.saveAgent(config);
        if (success) {
          window.PFToast.show('Success', 'Agent created successfully');
          modal.remove();
          loadAgents();
        } else {
          window.PFToast.show('Error', 'Failed to save agent');
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
