const messagesEl = document.getElementById('messages');
const messagesHeader = document.getElementById('messages-header');
const inputField = document.getElementById('input-field');
const btnSend = document.getElementById('btn-send');
const btnCopy = document.getElementById('btn-copy');
const btnClose = document.getElementById('btn-close');
const btnMinimize = document.getElementById('btn-minimize');
const btnSettings = document.getElementById('btn-settings');
const btnStatus = document.getElementById('btn-status');
const container = document.getElementById('chat-container');
const providerCard = document.getElementById('provider-card');
const providerCardTitle = document.getElementById('provider-card-title');
const providerCardSub = document.getElementById('provider-card-sub');
const providerCardAction = document.getElementById('provider-card-action');
const providerCardEmoji = document.getElementById('provider-card-emoji');
const providerNameEl = document.getElementById('provider-name');
const providerDot = document.getElementById('provider-dot');
const sessionStatusEl = document.getElementById('session-status');

let currentTheme = 'Peach';
let currentProvider = 'claude';
let isStreaming = false;
let streamingMessageEl = null;
let lastAssistantText = '';
let hasMessages = false;
let settingsOpen = false;

// ─── Provider config ───
const themeClasses = {
  'Peach': 'theme-peach',
  'Midnight': 'theme-midnight',
  'Cloud': 'theme-cloud',
  'Moss': 'theme-moss'
};

const providerNames = {
  vision: 'Gemini Vision',
  claude: 'Claude',
  codex: 'Codex',
  copilot: 'Copilot',
  gemini: 'Gemini'
};

const providerEmojis = {
  vision: '👁',
  claude: '✦',
  codex: '⚡',
  copilot: '🤖',
  gemini: '◆'
};

// ─── Textarea auto-grow ───
function autoGrow() {
  inputField.style.height = 'auto';
  inputField.style.height = Math.min(inputField.scrollHeight, 96) + 'px';
}

inputField.addEventListener('input', autoGrow);

// ─── Create a provider-tinted avatar ───
function createAvatar(provider) {
  const avatar = document.createElement('div');
  avatar.className = `msg-avatar provider-${provider || 'claude'}`;
  avatar.textContent = providerEmojis[provider] || '✦';
  return avatar;
}

// ─── Apply theme ───
function applyTheme(themeName) {
  currentTheme = themeName;
  container.className = themeClasses[themeName] || 'theme-peach';
  updateProviderUI();
  document.querySelectorAll('.settings-item[data-theme]').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === themeName);
  });
}

// ─── Update provider display ───
function updateProviderUI() {
  const name = providerNames[currentProvider] || 'Assistant';
  providerNameEl.textContent = name;
  inputField.placeholder = `Ask ${name} anything...`;
  providerCardEmoji.textContent = providerEmojis[currentProvider] || '✦';
  providerCardTitle.textContent = `${name} Assistant`;
  providerCardSub.textContent = `Powered by ${name} — ask anything`;
  document.querySelectorAll('.settings-item[data-provider]').forEach(el => {
    el.classList.toggle('active', el.dataset.provider === currentProvider);
  });
}

// ─── Settings dropdown ───
function createSettingsDropdown() {
  const dropdown = document.createElement('div');
  dropdown.id = 'settings-dropdown';

  const providers = ['claude', 'gemini', 'vision', 'codex', 'copilot'];
  const themes = ['Peach', 'Midnight', 'Cloud', 'Moss'];

  dropdown.innerHTML = `
    <div class="settings-section-title">Provider</div>
    ${providers.map(p => `
      <button class="settings-item ${p === currentProvider ? 'active' : ''}" data-provider="${p}">
        <span class="item-dot"></span>${providerNames[p]}
      </button>
    `).join('')}
    <div class="settings-divider"></div>
    <div class="settings-section-title">Theme</div>
    ${themes.map(t => `
      <button class="settings-item ${t === currentTheme ? 'active' : ''}" data-theme="${t}">
        <span class="item-dot"></span>${t}
      </button>
    `).join('')}
  `;

  container.appendChild(dropdown);

  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.settings-item');
    if (!item) return;

    if (item.dataset.provider) {
      window.assistant.sendMessage(`/provider ${item.dataset.provider}`);
    }
    if (item.dataset.theme) {
      if (window.assistant.setTheme) {
        window.assistant.setTheme(item.dataset.theme);
      }
    }
    toggleSettings(false);
  });

  return dropdown;
}

function toggleSettings(forceState) {
  const dropdown = document.getElementById('settings-dropdown') || createSettingsDropdown();
  settingsOpen = forceState !== undefined ? forceState : !settingsOpen;
  dropdown.classList.toggle('open', settingsOpen);
}

// ─── Track when messages appear ───
function onMessageAdded() {
  if (!hasMessages) {
    hasMessages = true;
    providerCard.classList.add('hidden');
    messagesHeader.classList.add('visible');
  }
}

// ─── Safe escape for inline text ───
function safeEscape(text) {
  if (typeof text !== 'string') return String(text ?? '');
  if (window.PFMarkdown && window.PFMarkdown.escapeHtml) {
    return window.PFMarkdown.escapeHtml(text);
  }
  const el = document.createElement('span');
  el.textContent = text;
  return el.innerHTML;
}

// ─── Parse error text into {title, reason} ───
function parseError(text) {
  if (!text || typeof text !== 'string') {
    return { title: 'Error', reason: text ? String(text) : 'An unknown error occurred' };
  }

  // Pattern: "Error: reason" or "SomeError: details"
  const colonIdx = text.indexOf(':');
  if (colonIdx > 0 && colonIdx < 40) {
    return {
      title: text.substring(0, colonIdx).trim(),
      reason: text.substring(colonIdx + 1).trim()
    };
  }

  // Short errors show as title only
  if (text.length < 60) {
    return { title: text, reason: '' };
  }

  return { title: 'Error', reason: text };
}

// ─── Get initial state ───
(async () => {
  try {
    const state = await window.assistant.getInitialState();
    if (state) {
      currentProvider = state.provider || 'claude';
      currentTheme = state.theme || 'Peach';
      applyTheme(currentTheme);
      updateProviderUI();
    }
  } catch (e) {
    // defaults are fine
  }
})();

// ─── Message rendering ───
function addMessage(role, text) {
  if (text === undefined || text === null) text = '';
  if (typeof text !== 'string') text = String(text);

  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role}-message`;

  if (role === 'assistant') {
    msgDiv.appendChild(createAvatar(currentProvider));
  }

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';

  if (role === 'assistant') {
    contentDiv.innerHTML = window.PFMarkdown ? window.PFMarkdown.render(text) : safeEscape(text);
  } else if (role === 'error') {
    const parsed = parseError(text);
    contentDiv.innerHTML = `<div class="error-title">${safeEscape(parsed.title)}</div>`
      + (parsed.reason ? `<div class="error-reason">${safeEscape(parsed.reason)}</div>` : '');
  } else {
    contentDiv.textContent = text;
  }

  msgDiv.appendChild(contentDiv);
  messagesEl.appendChild(msgDiv);
  onMessageAdded();
  scrollToBottom();
  return msgDiv;
}

function addToolMessage(text, isError = false) {
  if (!text && !isError) return; // skip empty non-error tool messages
  const safeText = (typeof text === 'string') ? text : String(text ?? '');

  const msgDiv = document.createElement('div');
  msgDiv.className = 'message tool-message';
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.innerHTML = `<span class="tool-icon">⚙</span> ${safeEscape(safeText)}`;
  if (isError) contentDiv.style.color = 'var(--error)';
  msgDiv.appendChild(contentDiv);
  messagesEl.appendChild(msgDiv);
  onMessageAdded();
  scrollToBottom();
}

function addSecurityEvent(eventPayload) {
  if (!eventPayload) return;

  const type = eventPayload.type;
  const data = eventPayload.data || {};

  const msgDiv = document.createElement('div');
  msgDiv.className = 'message security-message';
  msgDiv.style.borderRadius = '6px';
  msgDiv.style.padding = '8px 12px';
  msgDiv.style.marginTop = '6px';
  msgDiv.style.marginBottom = '6px';
  msgDiv.style.fontSize = '12px';
  msgDiv.style.fontWeight = '500';
  msgDiv.style.display = 'flex';
  msgDiv.style.alignItems = 'flex-start';
  msgDiv.style.gap = '8px';

  let icon = '⚙️';
  let bgColor = '#555';
  let textColor = '#fff';
  let messageContent = '';

  switch (type) {
    case 'intent-sealed':
      icon = '🛡️';
      bgColor = '#27AE60';
      messageContent = `<div><strong>Intent Plan Sealed</strong>`
        + `<br><span style="opacity:0.8;font-size:11px;">Token: ${safeEscape(data.tokenHash || 'N/A')}</span>`
        + `<br><span style="opacity:0.8;font-size:11px;">Authorized: [${(Array.isArray(data.authorizedTools) ? data.authorizedTools : []).join(', ')}]</span></div>`;
      break;
    case 'tool-allowed':
      icon = '✅';
      bgColor = '#2980B9';
      messageContent = `Tool executed: ${safeEscape(data.tool || 'unknown')}`;
      break;
    case 'enforcement-block': {
      const reason = data.reason || '';
      if (reason.includes('drift')) {
        icon = '⚠️';
        bgColor = '#E67E22';
        messageContent = `<div><strong>Blocked — Intent Drift</strong><br><span style="opacity:0.8;font-size:11px;">${safeEscape(data.tool || 'unknown tool')} is not in the signed intent plan</span></div>`;
      } else {
        icon = '❌';
        bgColor = '#C0392B';
        messageContent = `<div><strong>Blocked — Policy Deny</strong><br><span style="opacity:0.8;font-size:11px;">${safeEscape(data.tool || 'unknown tool')} matched deny list</span>`
          + (reason ? `<br><span style="opacity:0.7;font-size:10px;">Reason: ${safeEscape(reason)}</span>` : '')
          + `</div>`;
      }
      break;
    }
    case 'intent-failed':
      icon = '❌';
      bgColor = '#C0392B';
      messageContent = `<div><strong>Intent Planning Failed</strong><br><span style="opacity:0.8;font-size:11px;">${safeEscape(data.reason || 'Unknown reason')}</span></div>`;
      break;
    default:
      icon = 'ℹ️';
      bgColor = '#555';
      messageContent = `Security event: ${safeEscape(type || 'unknown')}`;
      break;
  }

  msgDiv.style.backgroundColor = bgColor;
  msgDiv.style.color = textColor;
  msgDiv.innerHTML = `<span style="font-size:16px;line-height:1;">${icon}</span><div style="flex:1;">${messageContent}</div>`;

  messagesEl.appendChild(msgDiv);
  onMessageAdded();
  scrollToBottom();
}

function showTypingIndicator() {
  const existing = document.getElementById('typing-indicator');
  if (existing) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = 'message typing-indicator';
  msgDiv.id = 'typing-indicator';

  msgDiv.appendChild(createAvatar(currentProvider));

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  msgDiv.appendChild(contentDiv);
  messagesEl.appendChild(msgDiv);
  sessionStatusEl.textContent = 'Thinking...';
  scrollToBottom();
}

function hideTypingIndicator() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

function startStreamingMessage() {
  hideTypingIndicator();
  sessionStatusEl.textContent = 'Responding...';

  const msgDiv = document.createElement('div');
  msgDiv.className = 'message assistant-message';

  msgDiv.appendChild(createAvatar(currentProvider));

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.textContent = '';
  msgDiv.appendChild(contentDiv);
  messagesEl.appendChild(msgDiv);
  streamingMessageEl = contentDiv;
  isStreaming = true;
  lastAssistantText = '';
  onMessageAdded();
  scrollToBottom();
}

function appendStreamingText(text) {
  if (!streamingMessageEl) {
    startStreamingMessage();
  }
  lastAssistantText += text;
  streamingMessageEl.innerHTML = window.PFMarkdown ? window.PFMarkdown.render(lastAssistantText) : safeEscape(lastAssistantText);
  scrollToBottom();
}

function finishStreamingMessage() {
  isStreaming = false;
  streamingMessageEl = null;
  hideTypingIndicator();
  sessionStatusEl.textContent = 'Ready';
}

function scrollToBottom() {
  const mainContent = document.getElementById('main-content');
  if (mainContent) mainContent.scrollTop = mainContent.scrollHeight;
}

// ─── Clear messages helper ───
function clearMessages() {
  const children = Array.from(messagesEl.children);
  children.forEach(c => { if (c.id !== 'messages-header') c.remove(); });
  hasMessages = false;
  providerCard.classList.remove('hidden');
  messagesHeader.classList.remove('visible');
}

// ─── Slash commands ───
function handleSlashCommand(cmd) {
  const parts = cmd.trim().toLowerCase().split(/\s+/);
  switch (parts[0]) {
    case '/clear':
      clearMessages();
      addMessage('system', '💬 Chat cleared.');
      window.assistant.slashCommand('clear');
      return true;

    case '/copy':
      if (lastAssistantText) {
        navigator.clipboard.writeText(lastAssistantText).then(() => {
          addMessage('system', '📋 Copied last response to clipboard.');
        }).catch(() => {
          addMessage('error', 'Clipboard: Failed to copy — browser denied clipboard access.');
        });
      } else {
        addMessage('system', '⚠️ No response to copy.');
      }
      return true;

    case '/help':
      addMessage('system', '📖 Commands:\n  /clear — Clear chat history\n  /copy — Copy last AI response\n  /help — Show this help');
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
  inputField.style.height = 'auto'; // reset textarea height

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
  // Shift+Enter inserts newline naturally in textarea
});

btnCopy.addEventListener('click', () => {
  if (lastAssistantText) {
    navigator.clipboard.writeText(lastAssistantText).then(() => {
      btnCopy.style.color = 'var(--success)';
      setTimeout(() => { btnCopy.style.color = ''; }, 1000);
    }).catch(() => {
      // silently fail — user can try /copy
    });
  }
});

btnClose.addEventListener('click', () => {
  window.close();
});

btnMinimize.addEventListener('click', () => {
  if (window.assistant.minimizeChat) {
    window.assistant.minimizeChat();
  } else {
    window.close();
  }
});

btnSettings.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleSettings();
});

document.addEventListener('click', (e) => {
  if (settingsOpen && !e.target.closest('#settings-dropdown') && !e.target.closest('#btn-settings')) {
    toggleSettings(false);
  }
});

btnStatus.addEventListener('click', () => {
  const status = sessionStatusEl;
  const original = status.textContent;
  status.textContent = `${providerNames[currentProvider] || 'AI'} • ${currentTheme}`;
  setTimeout(() => { status.textContent = original; }, 2000);
});

providerCardAction.addEventListener('click', () => {
  handleSlashCommand('/help');
});

// ─── IPC listeners ───
window.assistant.onChatText((text) => {
  if (typeof text !== 'string') return;
  appendStreamingText(text);
});

window.assistant.onChatError((text) => {
  hideTypingIndicator();
  finishStreamingMessage();
  addMessage('error', text);
  providerDot.classList.add('error');
  sessionStatusEl.textContent = 'Error';
  setTimeout(() => {
    providerDot.classList.remove('error');
    sessionStatusEl.textContent = 'Ready';
  }, 4000);
});

window.assistant.onChatToolUse((name, input) => {
  const safeName = (typeof name === 'string') ? name : 'tool';
  let inputStr = '';
  try {
    inputStr = typeof input === 'object' ? JSON.stringify(input).substring(0, 100) : String(input || '');
  } catch (_) {
    inputStr = '[unserializable input]';
  }
  addToolMessage(`${safeName}: ${inputStr}`);
});

window.assistant.onChatToolResult((summary, isError) => {
  const safeSummary = (typeof summary === 'string') ? summary : String(summary || 'No details');
  addToolMessage(isError ? `❌ ${safeSummary}` : `✅ ${safeSummary}`, isError);
});

window.assistant.onChatTurnComplete(() => {
  finishStreamingMessage();
});

window.assistant.onChatSessionReady(() => {
  sessionStatusEl.textContent = 'Ready';
  providerDot.classList.remove('error');
});

window.assistant.onChatHistory((history) => {
  if (!Array.isArray(history)) return;
  for (const msg of history) {
    if (!msg || !msg.role) continue;
    switch (msg.role) {
      case 'user':
        addMessage('user', msg.text);
        break;
      case 'assistant':
        addMessage('assistant', msg.text);
        if (msg.text) lastAssistantText = msg.text;
        break;
      case 'error':
        addMessage('error', msg.text);
        break;
      case 'toolUse':
        addToolMessage(msg.text);
        break;
      case 'toolResult':
        addToolMessage(msg.text, typeof msg.text === 'string' && msg.text.startsWith('ERROR'));
        break;
    }
  }
});

window.assistant.onThemeChange((theme) => {
  if (theme && themeClasses[theme]) applyTheme(theme);
});

window.assistant.onProviderChange((provider) => {
  if (!provider) return;
  currentProvider = provider;
  updateProviderUI();
  clearMessages();
  addMessage('system', `🔄 Switched to ${providerNames[provider] || provider}. Session restarted.`);
});

window.assistant.onApiKeyChange(() => {
  clearMessages();
  addMessage('system', '🔑 API Key updated. Session restarted.');
});

// Focus input on load
window.addEventListener('DOMContentLoaded', () => {
  inputField.focus();
  if (window.assistant.sendRendererReady) {
    window.assistant.sendRendererReady();
  }
});

// Security events
if (window.assistant.onSecurityAuditEvent) {
  window.assistant.onSecurityAuditEvent(eventPayload => {
    addSecurityEvent(eventPayload);
  });
}

// ─── ElevenLabs Speech to Text ───
const btnMic = document.getElementById('btn-mic');
let mediaRecorder = null;
let audioChunks = [];
let isRecordingAudio = false;
let spaceDownTimer = null;
let spaceIsDown = false;

async function startRecording() {
  if (isRecordingAudio) return;

  let apiKey;
  try {
    apiKey = await window.assistant.getElevenLabsApiKey();
  } catch (err) {
    addMessage('error', 'ElevenLabs: Could not retrieve API key. Check tray settings.');
    return;
  }

  if (!apiKey) {
    addMessage('error', 'ElevenLabs: No API key configured. Set it in the tray menu first.');
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    const reason = err.name === 'NotAllowedError'
      ? 'Microphone access denied. Grant permission in system settings.'
      : err.name === 'NotFoundError'
        ? 'No microphone found. Connect a mic and try again.'
        : `Microphone error: ${err.message}`;
    addMessage('error', reason);
    return;
  }

  try {
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  } catch (err) {
    stream.getTracks().forEach(t => t.stop());
    addMessage('error', `Recording: Browser does not support audio/webm — ${err.message}`);
    return;
  }

  audioChunks = [];

  mediaRecorder.addEventListener('dataavailable', event => {
    if (event.data && event.data.size > 0) {
      audioChunks.push(event.data);
    }
  });

  mediaRecorder.addEventListener('stop', async () => {
    stream.getTracks().forEach(t => t.stop());
    btnMic.classList.remove('recording');

    if (audioChunks.length === 0) {
      addMessage('system', '⚠️ No audio captured. Try holding the mic button longer.');
      sessionStatusEl.textContent = 'Ready';
      return;
    }

    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const apiFile = new File([audioBlob], 'audio.webm', { type: 'audio/webm' });

    showTypingIndicator();
    sessionStatusEl.textContent = 'Transcribing...';

    try {
      const formData = new FormData();
      formData.append('file', apiFile);
      formData.append('model_id', 'scribe_v1');

      const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        body: formData
      });

      if (!response.ok) {
        let errDetail;
        try { errDetail = await response.text(); } catch (_) { errDetail = ''; }
        const statusMsg = response.status === 401 ? 'Invalid API key'
          : response.status === 429 ? 'Rate limit exceeded — try again shortly'
          : response.status >= 500 ? 'ElevenLabs server error — try again later'
          : `HTTP ${response.status}`;
        throw new Error(`ElevenLabs STT: ${statusMsg}${errDetail ? ` — ${errDetail.substring(0, 100)}` : ''}`);
      }

      const data = await response.json();
      const transcription = data && data.text;
      hideTypingIndicator();

      if (transcription && transcription.trim()) {
        inputField.value = transcription;
        autoGrow();
        sendMessage();
      } else {
        addMessage('system', '⚠️ No speech detected. Try speaking closer to the mic.');
      }
    } catch (err) {
      hideTypingIndicator();
      addMessage('error', err.message || 'Speech-to-text failed unexpectedly.');
    }
    sessionStatusEl.textContent = 'Ready';
  });

  mediaRecorder.addEventListener('error', (e) => {
    stream.getTracks().forEach(t => t.stop());
    btnMic.classList.remove('recording');
    isRecordingAudio = false;
    addMessage('error', `Recording error: ${e.error ? e.error.message : 'Unknown recording failure'}`);
    sessionStatusEl.textContent = 'Ready';
  });

  mediaRecorder.start();
  isRecordingAudio = true;
  btnMic.classList.add('recording');
  sessionStatusEl.textContent = 'Listening...';
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch (_) { /* already stopped */ }
  }
  isRecordingAudio = false;
  btnMic.classList.remove('recording');
  // status text is set in the 'stop' event handler
}

btnMic.addEventListener('mousedown', () => { startRecording(); });
btnMic.addEventListener('mouseup', () => { stopRecording(); });
btnMic.addEventListener('mouseleave', () => { if (isRecordingAudio) stopRecording(); });

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    if (spaceIsDown) return;
    spaceIsDown = true;
    if (document.activeElement === inputField) {
      e.preventDefault();
    }
    spaceDownTimer = setTimeout(() => {
      startRecording();
    }, 250);
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    spaceIsDown = false;
    if (spaceDownTimer) {
      clearTimeout(spaceDownTimer);
      spaceDownTimer = null;
      if (!isRecordingAudio) {
        if (document.activeElement === inputField) {
          const start = inputField.selectionStart;
          const end = inputField.selectionEnd;
          const val = inputField.value;
          inputField.value = val.substring(0, start) + ' ' + val.substring(end);
          inputField.selectionStart = inputField.selectionEnd = start + 1;
          autoGrow();
        }
      }
    }
    if (isRecordingAudio) {
      stopRecording();
    }
  }
});
