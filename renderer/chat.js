const messagesEl = document.getElementById('messages');
const inputField = document.getElementById('input-field');
const btnSend = document.getElementById('btn-send');
const btnCopy = document.getElementById('btn-copy');
const btnClose = document.getElementById('btn-close');
const titleText = document.getElementById('title-text');
const container = document.getElementById('chat-container');

let currentTheme = 'Peach';
let currentProvider = 'claude';
let isStreaming = false;
let streamingMessageEl = null;
let lastAssistantText = '';

// ─── Theme mapping ─── 
const themeClasses = {
  'Peach': 'theme-peach',
  'Midnight': 'theme-midnight',
  'Cloud': 'theme-cloud',
  'Moss': 'theme-moss'
};

const titleFormats = {
  'Peach': 'lowercaseTilde',
  'Midnight': 'uppercase',
  'Cloud': 'lowercaseTilde',
  'Moss': 'capitalized'
};

const providerNames = {
  vision: 'Gemini Vision',
  claude: 'Claude',
  codex: 'Codex',
  copilot: 'Copilot',
  gemini: 'Gemini'
};

// ─── Markdown → HTML renderer ───
function renderMarkdown(text) {
  // 1. Extract code blocks BEFORE escaping (so backticks survive)
  const codeBlocks = [];
  // Strip bbox blocks entirely
  text = text.replace(/```bbox\s*\n?[\s\S]*?```/g, '');
  // Extract fenced code blocks
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const placeholder = `%%CODEBLOCK_${codeBlocks.length}%%`;
    codeBlocks.push(`<pre class="md-code-block"><code>${escapeHtml(code.trim())}</code></pre>`);
    return placeholder;
  });
  // Extract inline code
  const inlineCodes = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    const placeholder = `%%INLINECODE_${inlineCodes.length}%%`;
    inlineCodes.push(`<code class="md-inline-code">${escapeHtml(code)}</code>`);
    return placeholder;
  });

  // 2. Now escape the remaining HTML
  let html = escapeHtml(text);

  // 3. Bold (non-greedy)
  html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>');

  // 4. Italic (non-greedy)
  html = html.replace(/\*([\s\S]*?)\*/g, '<em>$1</em>');

  // 5. Headings (### h3, ## h2, # h1)
  html = html.replace(/^### (.+)$/gm, '<h4 class="md-heading">$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3 class="md-heading">$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h3 class="md-heading">$1</h3>');

  // 6. Unordered list items
  html = html.replace(/^[\-\*] (.+)$/gm, '<li class="md-list-item">$1</li>');

  // 7. Ordered list items
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="md-list-item md-ordered">$1</li>');

  // 8. Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="md-link" target="_blank">$1</a>');

  // 9. Line breaks
  html = html.replace(/\n/g, '<br>');

  // 10. Restore code blocks and inline code
  codeBlocks.forEach((block, i) => {
    html = html.replace(`%%CODEBLOCK_${i}%%`, block);
  });
  inlineCodes.forEach((code, i) => {
    html = html.replace(`%%INLINECODE_${i}%%`, code);
  });

  return html;
}

function formatTitle(providerKey, format) {
  const name = providerNames[providerKey] || 'Claude';
  switch (format) {
    case 'uppercase': return name.toUpperCase();
    case 'lowercaseTilde': return `${name.toLowerCase()} ~`;
    case 'capitalized': return name;
    default: return name;
  }
}

function applyTheme(themeName) {
  currentTheme = themeName;
  container.className = themeClasses[themeName] || 'theme-peach';
  updateTitle();
}

function updateTitle() {
  const format = titleFormats[currentTheme] || 'capitalized';
  titleText.textContent = formatTitle(currentProvider, format);
  inputField.placeholder = `Ask ${providerNames[currentProvider] || 'AI'}...`;
}

// ─── Get initial state ───
(async () => {
  try {
    const state = await window.assistant.getInitialState();
    if (state) {
      currentProvider = state.provider || 'vision';
      currentTheme = state.theme || 'Peach';
      applyTheme(currentTheme);
    }
  } catch (e) {
    // defaults
  }
})();

// ─── Message rendering ───
function addMessage(role, text) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role}-message`;
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  // User messages stay plain text, assistant messages get markdown rendering
  if (role === 'assistant') {
    contentDiv.innerHTML = renderMarkdown(text);
  } else {
    contentDiv.textContent = text;
  }
  msgDiv.appendChild(contentDiv);
  messagesEl.appendChild(msgDiv);
  scrollToBottom();
  return msgDiv;
}

function addToolMessage(text, isError = false) {
  const msgDiv = document.createElement('div');
  msgDiv.className = 'message tool-message';
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.innerHTML = `<span class="tool-icon">⚙</span> ${escapeHtml(text)}`;
  if (isError) contentDiv.style.color = 'var(--error-color)';
  msgDiv.appendChild(contentDiv);
  messagesEl.appendChild(msgDiv);
  scrollToBottom();
}

function showTypingIndicator() {
  const existing = document.getElementById('typing-indicator');
  if (existing) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = 'message typing-indicator';
  msgDiv.id = 'typing-indicator';
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  msgDiv.appendChild(contentDiv);
  messagesEl.appendChild(msgDiv);
  scrollToBottom();
}

function hideTypingIndicator() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

function startStreamingMessage() {
  hideTypingIndicator();
  const msgDiv = document.createElement('div');
  msgDiv.className = 'message assistant-message';
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.textContent = '';
  msgDiv.appendChild(contentDiv);
  messagesEl.appendChild(msgDiv);
  streamingMessageEl = contentDiv;
  isStreaming = true;
  lastAssistantText = '';
  scrollToBottom();
}

function appendStreamingText(text) {
  if (!streamingMessageEl) {
    startStreamingMessage();
  }
  lastAssistantText += text;
  // Re-render markdown on each chunk for live formatting
  streamingMessageEl.innerHTML = renderMarkdown(lastAssistantText);
  scrollToBottom();
}

function finishStreamingMessage() {
  isStreaming = false;
  streamingMessageEl = null;
  hideTypingIndicator();
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ─── Slash commands ───
function handleSlashCommand(cmd) {
  const parts = cmd.trim().toLowerCase().split(/\s+/);
  switch (parts[0]) {
    case '/clear':
      messagesEl.innerHTML = '';
      addMessage('system', '💬 Chat cleared.');
      window.assistant.slashCommand('clear');
      return true;

    case '/copy':
      if (lastAssistantText) {
        navigator.clipboard.writeText(lastAssistantText).then(() => {
          addMessage('system', '📋 Copied last response to clipboard.');
        });
      } else {
        addMessage('system', '⚠️ No response to copy.');
      }
      return true;

    case '/help':
      addMessage('system', `📖 Commands:\n  /clear — Clear chat history\n  /copy — Copy last AI response\n  /help — Show this help`);
      return true;

    default:
      return false;
  }
}

// ─── Send message ───
function sendMessage() {
  const text = inputField.value.trim();
  if (!text) return;
  inputField.value = '';

  // Check slash commands
  if (text.startsWith('/')) {
    if (handleSlashCommand(text)) return;
  }

  addMessage('user', text);
  showTypingIndicator();
  window.assistant.sendMessage(text);
}

// ─── Event listeners ───
btnSend.addEventListener('click', sendMessage);

inputField.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

btnCopy.addEventListener('click', () => {
  if (lastAssistantText) {
    navigator.clipboard.writeText(lastAssistantText).then(() => {
      btnCopy.style.color = 'var(--success-color)';
      setTimeout(() => { btnCopy.style.color = ''; }, 1000);
    });
  }
});

btnClose.addEventListener('click', () => {
  window.close();
});

// ─── IPC listeners ───
window.assistant.onChatText((text) => {
  appendStreamingText(text);
});

window.assistant.onChatError((text) => {
  hideTypingIndicator();
  finishStreamingMessage();
  addMessage('error', text);
});

window.assistant.onChatToolUse((name, input) => {
  addToolMessage(`${name}: ${typeof input === 'object' ? JSON.stringify(input).substring(0, 100) : input}`);
});

window.assistant.onChatToolResult((summary, isError) => {
  addToolMessage(isError ? `❌ ${summary}` : `✅ ${summary}`, isError);
});

window.assistant.onChatTurnComplete(() => {
  finishStreamingMessage();
});

window.assistant.onChatSessionReady(() => {
  // Session ready
});

window.assistant.onChatHistory((history) => {
  // Replay history
  for (const msg of history) {
    switch (msg.role) {
      case 'user':
        addMessage('user', msg.text);
        break;
      case 'assistant':
        addMessage('assistant', msg.text);
        lastAssistantText = msg.text;
        break;
      case 'error':
        addMessage('error', msg.text);
        break;
      case 'toolUse':
        addToolMessage(msg.text);
        break;
      case 'toolResult':
        addToolMessage(msg.text, msg.text.startsWith('ERROR'));
        break;
    }
  }
});

window.assistant.onThemeChange((theme) => {
  applyTheme(theme);
});

window.assistant.onProviderChange((provider) => {
  currentProvider = provider;
  updateTitle();
  messagesEl.innerHTML = '';
  addMessage('system', '🔄 Provider changed. Session restarted.');
});

window.assistant.onApiKeyChange(() => {
  messagesEl.innerHTML = '';
  addMessage('system', '🔑 API Key updated. Session restarted.');
});

// Focus input on load
window.addEventListener('DOMContentLoaded', () => {
  inputField.focus();
});
