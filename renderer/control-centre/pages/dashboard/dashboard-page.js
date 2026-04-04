// renderer/control-centre/pages/dashboard/dashboard-page.js

function DashboardPage() {
  const container = pfCreateElement('div', 'pf-page-dashboard');
  
  const user = window.store.get('user') || { name: 'User' };
  const agents = window.store.get('agents') || [];

  // Header
  const header = pfCreateElement('div', 'pf-dashboard-header');
  header.appendChild(pfCreateElement('h1', 'pf-dashboard-greeting', { textContent: PFUtils.getGreeting(user.name) }));
  header.appendChild(pfCreateElement('div', 'pf-dashboard-date', { textContent: PFUtils.formatDate(new Date()) }));
  container.appendChild(header);

  // Quick Stats Grid
  const grid = pfCreateElement('div', 'pf-dashboard-grid');
  container.appendChild(grid);

  const metricCards = {
    agents: createMetricCard('Active Agents', '0/0', 'Loading...'),
    tasks: createMetricCard('Tasks', '0', 'Active tasks')
  };
  
  Object.values(metricCards).forEach(c => grid.appendChild(c));

  function createMetricCard(title, value, subtitle) {
    const vEl = pfCreateElement('div');
    vEl.appendChild(pfCreateElement('div', 'pf-metric-value', { textContent: value }));
    if (subtitle) {
      vEl.appendChild(pfCreateElement('div', 'pf-metric-subtitle', { textContent: subtitle }));
    }
    return PFCard({ title, body: vEl });
  }

  async function loadMetrics() {
    if (!window.ccBridge) return;
    
    // 1. Agents
    const allAgents = await window.ccBridge.getAgents() || [];
    const activeCount = 0; 
    metricCards.agents.querySelector('.pf-metric-value').textContent = `${activeCount}/${allAgents.length}`;
    metricCards.agents.querySelector('.pf-metric-subtitle').textContent = activeCount > 0 ? 'Running' : 'None active';

    // 2. Tasks
    const tasks = await window.ccBridge.getTasks() || [];
    const todoTasks = tasks.filter(t => t.status !== 'done').length;
    metricCards.tasks.querySelector('.pf-metric-value').textContent = todoTasks.toString();
  }


  // Activity Score Chart (Weekly)
  const chartSection = pfCreateElement('div', 'pf-dashboard-chart-section');
  chartSection.appendChild(pfCreateElement('h3', '', { textContent: 'Activity Score', style: 'margin-bottom:16px;' }));
  
  const chartCard = PFCard({
    body: (function() {
      const chart = pfCreateElement('div', 'pf-chart-container');
      const bars = pfCreateElement('div', 'pf-chart-bars');
      
      // Load real chat density for the week
      if (window.ccBridge) {
        window.ccBridge.getHistory().then(history => {
          const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const counts = [0,0,0,0,0,0,0];
          const now = new Date();
          
          history.forEach(h => {
             const d = new Date(h.updatedAt);
             const diff = (now - d) / (1000 * 60 * 60 * 24);
             if (diff < 7) counts[d.getDay()]++;
          });

          const max = Math.max(...counts, 5);
          counts.forEach((count, i) => {
            const barWrap = pfCreateElement('div', 'pf-chart-bar-wrap');
            const bar = pfCreateElement('div', 'pf-chart-bar');
            bar.style.height = `${(count / max) * 100}%`;
            if (i === now.getDay()) bar.classList.add('current');
            
            barWrap.appendChild(bar);
            barWrap.appendChild(pfCreateElement('div', 'pf-chart-label', { textContent: days[i] }));
            bars.appendChild(barWrap);
          });
        });
      }
      
      chart.appendChild(bars);
      return chart;
    })()
  });
  chartSection.appendChild(chartCard);
  container.appendChild(chartSection);

  // Suggested Actions
  const suggestions = pfCreateElement('div', 'pf-dashboard-suggestions');
  suggestions.appendChild(pfCreateElement('h3', '', { textContent: 'Suggestions', style: 'margin-bottom:16px;' }));
  
  const suggestGrid = pfCreateElement('div', 'pf-suggestion-grid');
  
  const items = [
    { title: 'Review Tasks', desc: 'You have unfinished items in your Kanban.', icon: '📋', action: () => window.router.navigate('tasks') },
    { title: 'New Agent', desc: 'Create a specialized persona for your next project.', icon: '✨', action: () => window.router.navigate('agents') }
  ];

  items.forEach(item => {
    const card = pfCreateElement('div', 'pf-suggestion-card');
    card.onclick = item.action;
    card.innerHTML = `
      <div class="pf-suggestion-icon">${item.icon}</div>
      <div class="pf-suggestion-info">
        <div class="pf-suggestion-title">${item.title}</div>
        <div class="pf-suggestion-desc">${item.desc}</div>
      </div>
    `;
    suggestGrid.appendChild(card);
  });
  
  suggestions.appendChild(suggestGrid);
  container.appendChild(suggestions);

  loadMetrics();
  return container;
}

window.DashboardPage = DashboardPage;
