let agents = [];
let historySessions = [];

document.addEventListener('DOMContentLoaded', () => {
  // Navigation Tabs
  const navBtns = document.querySelectorAll('.nav-btn');
  const views = document.querySelectorAll('.view');

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Toggle active states
      navBtns.forEach(b => b.classList.remove('active'));
      views.forEach(v => v.classList.remove('active'));

      btn.classList.add('active');
      const targetView = btn.getAttribute('data-tab');
      document.getElementById(`view-${targetView}`).classList.add('active');

      if (targetView === 'history') {
        loadHistory();
      }
    });
  });

  // Modal logic
  const modal = document.getElementById('agent-modal');
  const btnCreate = document.getElementById('btn-create-agent');
  const btnCancel = document.getElementById('btn-cancel-modal');
  const btnSave = document.getElementById('btn-save-agent');
  const btnBrowse = document.getElementById('btn-browse-context');

  btnCreate.addEventListener('click', () => {
    document.getElementById('agent-name').value = '';
    document.getElementById('agent-context').value = '';
    modal.classList.add('active');
  });

  btnCancel.addEventListener('click', () => {
    modal.classList.remove('active');
  });

  btnBrowse.addEventListener('click', async () => {
    const filePath = await window.electron.chooseContextFile();
    if (filePath) {
      document.getElementById('agent-context').value = filePath;
    }
  });

  btnSave.addEventListener('click', async () => {
    const config = {
      name: document.getElementById('agent-name').value || 'New Agent',
      theme: document.getElementById('agent-theme').value,
      provider: document.getElementById('agent-provider').value,
      contextFile: document.getElementById('agent-context').value,
    };
    await window.electron.saveAgent(config);
    modal.classList.remove('active');
    loadAgents();
  });

  // Initial Load
  loadAgents();
});

async function loadAgents() {
  agents = await window.electron.getAgents();
  const container = document.getElementById('agents-container');
  container.innerHTML = '';

  agents.forEach(agent => {
    const card = document.createElement('div');
    card.className = 'agent-card';
    
    // Quick derive color from theme
    const themeColors = {
      'Peach': '#f28ca6',
      'Midnight': '#ff6600',
      'Cloud': '#0078d6',
      'Moss': '#8c9480'
    };
    const accent = themeColors[agent.theme] || '#00d4aa';
    
    card.innerHTML = `
      <div class="agent-header">
        <div class="agent-icon" style="color: ${accent}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
            <path d="M12 2a2 2 0 0 1 2 2c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2zm0 6c-2.2 0-4 1.8-4 4v7h2v-7h4v7h2v-7c0-2.2-1.8-4-4-4z"></path>
          </svg>
        </div>
        <span class="badge" style="background: ${accent}22; color: ${accent}">${agent.provider}</span>
      </div>
      <div class="agent-info">
        <h3>${agent.name}</h3>
        <p>Theme: ${agent.theme}</p>
        <p title="${agent.contextFile || 'No context'}">${agent.contextFile ? 'Context: ' + agent.contextFile.split('\\\\').pop().split('/').pop() : 'No custom context'}</p>
      </div>
      <div class="agent-actions">
        <button class="btn secondary launch-btn" data-id="${agent._id || agent.name}">Launch</button>
      </div>
    `;

    card.querySelector('.launch-btn').addEventListener('click', () => {
      window.electron.launchAgent(agent);
    });

    container.appendChild(card);
  });
}

async function loadHistory() {
  const sessions = await window.electron.getHistory();
  const sidebar = document.getElementById('history-sessions-list');
  sidebar.innerHTML = '';

  if (sessions.length === 0) {
    sidebar.innerHTML = '<div style="padding: 16px; color: #9da3af; text-align: center;">No history found</div>';
    return;
  }

  sessions.forEach(session => {
    const item = document.createElement('div');
    item.className = 'session-item';
    const dateStr = new Date(session.updatedAt || session.createdAt).toLocaleDateString();
    
    item.innerHTML = `
      <h4>${session.title || 'Conversation'}</h4>
      <div class="meta">
        <span>${session.agentId?.name || 'Agent'}</span>
        <span>${dateStr}</span>
      </div>
    `;

    item.addEventListener('click', () => {
      document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      renderChat(session.messages);
    });

    sidebar.appendChild(item);
  });
}

function renderChat(messages) {
  const chatView = document.getElementById('history-chat-view');
  if (!messages || messages.length === 0) {
    chatView.innerHTML = '<div class="empty-state">No messages in this session</div>';
    return;
  }

  let html = '<div class="chat-messages">';
  messages.forEach(msg => {
    const roleClass = msg.role === 'user' ? 'user' : 'assistant';
    // basic markdown rendering or just text
    const text = msg.text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html += `<div class="message ${roleClass}">${text}</div>`;
  });
  html += '</div>';
  
  chatView.innerHTML = html;
}
