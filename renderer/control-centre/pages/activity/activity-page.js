// renderer/control-centre/pages/activity/activity-page.js

function ActivityPage() {
  const container = pfCreateElement('div', 'pf-page-activity');
  
  // Header
  const header = pfCreateElement('div', 'pf-activity-header');
  header.appendChild(pfCreateElement('h1', 'pf-activity-title', { textContent: 'Activity' }));
  container.appendChild(header);

  const listContainer = pfCreateElement('div', '', { textContent: 'Loading activity...' });
  container.appendChild(listContainer);

  // Load real history from DB to build the timeline
  if (window.ccBridge) {
    window.ccBridge.getHistory().then(history => {
      listContainer.innerHTML = '';
      
      if (!history || history.length === 0) {
        listContainer.appendChild(pfCreateElement('div', '', { 
          textContent: 'No recent activity. Start chatting with your agents to build history.',
          style: 'padding: 32px; color: var(--pf-color-text-muted);'
        }));
        return;
      }

      const timeline = pfCreateElement('div', 'pf-timeline');
      
      // Sort by updatedAt descending
      history.sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));

      history.forEach(chat => {
        const item = pfCreateElement('div', 'pf-timeline-item');
        item.onclick = () => window.router.navigate('chat');
        
        const iconWrapper = pfCreateElement('div', 'pf-timeline-icon', { innerHTML: window.PFIcons.chat });
        
        const content = pfCreateElement('div', 'pf-timeline-content');
        content.appendChild(pfCreateElement('div', 'pf-timeline-time', { 
          textContent: chat.updatedAt ? PFUtils.formatRelativeTime(chat.updatedAt) : 'Recently'
        }));
        
        const textArea = pfCreateElement('div', 'pf-timeline-text');
        textArea.appendChild(pfCreateElement('span', '', { textContent: 'Conversation: ', style: 'color: var(--pf-color-text-muted);' }));
        textArea.appendChild(pfCreateElement('strong', '', { textContent: chat.title || 'Untitled' }));
        textArea.appendChild(pfCreateElement('span', '', { textContent: ` with ${chat.agentId?.name || 'Agent'}` }));
        content.appendChild(textArea);
        
        item.appendChild(iconWrapper);
        item.appendChild(content);
        timeline.appendChild(item);
      });

      listContainer.appendChild(timeline);
    }).catch(err => {
      console.error('[Activity] Error loading history:', err);
      listContainer.textContent = 'Could not load activity.';
    });
  } else {
    listContainer.textContent = 'Activity tracking not available.';
  }

  return container;
}

window.ActivityPage = ActivityPage;
