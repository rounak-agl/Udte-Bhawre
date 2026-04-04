// renderer/control-centre/pages/chat/chat-page.js

function ChatPage() {
  const container = pfCreateElement('div', 'pf-page-chat');
  
  const agents = window.store.get('agents') || [];
  
  let currentChatId = null;
  let chatsList = [];
  
  const sidebar = pfCreateElement('div', 'pf-chat-sidebar');
  const mainArea = pfCreateElement('div', 'pf-chat-main');
  
  // --- Load real chats from DB ---
  async function loadChats() {
    if (window.ccBridge) {
      try {
        // getHistory returns ChatSession objects with agentId populated
        chatsList = await window.ccBridge.getHistory();
      } catch (e) {
        chatsList = [];
      }
    }
    renderSidebar();
  }

  function renderSidebar() {
    sidebar.innerHTML = '';
    
    const header = pfCreateElement('div', 'pf-chat-sidebar-header');
    const titleRow = pfCreateElement('div', 'pf-chat-sidebar-title');
    titleRow.appendChild(pfCreateElement('h2', '', { textContent: 'Messages' }));
    header.appendChild(titleRow);
    sidebar.appendChild(header);
    
    const list = pfCreateElement('div', 'pf-chat-list');

    if (chatsList.length === 0) {
      list.appendChild(pfCreateElement('div', '', { 
        textContent: 'No conversations yet.',
        style: 'padding: 16px; color: var(--pf-color-text-muted); font-size: 13px;'
      }));
    } else {
      chatsList.forEach(chat => {
        const item = pfCreateElement('div', `pf-chat-list-item ${chat._id === currentChatId ? 'active' : ''}`);
        
        const hd = pfCreateElement('div', 'pf-chat-item-header');
        hd.appendChild(pfCreateElement('div', 'pf-chat-item-title', { textContent: chat.title || 'Conversation' }));
        hd.appendChild(pfCreateElement('div', 'pf-chat-item-time', { 
          textContent: chat.updatedAt ? PFUtils.formatRelativeTime(chat.updatedAt) : '' 
        }));
        item.appendChild(hd);
        item.appendChild(pfCreateElement('div', 'pf-chat-item-preview', { 
          textContent: chat.agentId ? `with ${chat.agentId.name || 'Agent'}` : `${chat.messages?.length || 0} messages`
        }));
        
        item.onclick = () => {
          currentChatId = chat._id;
          renderSidebar();
          loadAndRenderMessages();
        };
        list.appendChild(item);
      });
    }
    sidebar.appendChild(list);
  }
  
  async function loadAndRenderMessages() {
    mainArea.innerHTML = '';
    
    if (!currentChatId) {
      renderEmptyState();
      return;
    }
    
    const chatInfo = chatsList.find(c => c._id === currentChatId);
    const agent = chatInfo?.agentId;
    
    // Header
    const header = pfCreateElement('div', 'pf-chat-main-header');
    if (agent) {
      header.appendChild(PFAvatar({ initials: agent.name?.charAt(0) || '?', shape: 'square' }));
      const details = pfCreateElement('div', 'pf-chat-agent-details');
      details.appendChild(pfCreateElement('div', 'pf-chat-agent-name', { textContent: agent.name }));
      details.appendChild(pfCreateElement('div', 'pf-chat-agent-role', { textContent: PFUtils.capitalize(agent.provider || 'vision') }));
      header.appendChild(details);
    } else {
      header.appendChild(pfCreateElement('div', 'pf-chat-agent-name', { textContent: chatInfo?.title || 'Conversation' }));
    }
    mainArea.appendChild(header);
    
    // Messages Area
    const messagesBox = pfCreateElement('div', 'pf-chat-messages');
    mainArea.appendChild(messagesBox);
    
    // Load real messages from DB for this specific session
    let messages = [];
    if (window.ccBridge) {
      try {
        messages = await window.ccBridge.getChatMessages(currentChatId);
      } catch (e) {
        messages = chatInfo?.messages || []; // fallback to local object if populated
      }
    }
    
    if (messages.length === 0) {
      messagesBox.appendChild(pfCreateElement('div', '', { 
        textContent: 'No messages yet.',
        style: 'text-align: center; padding: 32px; color: var(--pf-color-text-muted);'
      }));
    } else {
      messages.forEach(msg => {
        messagesBox.appendChild(renderMsg(msg));
      });
    }
    
    // Read-only Notice Area  
    const noticeArea = pfCreateElement('div', 'pf-chat-input-area', {
      style: 'background: rgba(0,0,0,0.2); border-top: 1px solid var(--pf-color-border); padding: 12px; font-size: 13px; color: var(--pf-color-text-secondary); text-align: center;'
    });
    noticeArea.appendChild(pfCreateElement('div', '', { 
      textContent: 'Chat history is read-only here. To continue this conversation, open the character window on your desktop.' 
    }));
    mainArea.appendChild(noticeArea);
    
    setTimeout(() => { messagesBox.scrollTop = messagesBox.scrollHeight; }, 10);
  }
  
  function renderMsg(msg) {
    const role = msg.role === 'user' ? 'user' : 'assistant';
    const wrapper = pfCreateElement('div', `pf-message pf-message--${role}`);
    const bubble = pfCreateElement('div', 'pf-message-bubble');
    if (role === 'assistant' && window.PFMarkdown) {
      bubble.innerHTML = window.PFMarkdown.render(msg.text || '');
    } else {
      bubble.textContent = msg.text || '';
    }
    wrapper.appendChild(bubble);
    return wrapper;
  }
  
  function renderEmptyState() {
    mainArea.innerHTML = '';
    const empty = pfCreateElement('div', 'pf-chat-empty-state');
    empty.appendChild(pfCreateElement('div', '', { innerHTML: window.PFIcons.chat, style: 'width:48px;height:48px;margin-bottom:16px;opacity:0.5;' }));
    empty.appendChild(pfCreateElement('h3', '', { textContent: 'Select a conversation', style: 'font-family:var(--pf-font-display);' }));
    empty.appendChild(pfCreateElement('p', '', { textContent: 'Choose a conversation from the sidebar to view its history.', style: 'color:var(--pf-color-text-secondary);' }));
    mainArea.appendChild(empty);
  }
  
  // Init
  renderEmptyState();
  loadChats();
  container.appendChild(sidebar);
  container.appendChild(mainArea);
  
  return container;
}

window.ChatPage = ChatPage;
