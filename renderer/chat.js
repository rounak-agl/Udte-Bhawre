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
// Migrated to PFMarkdown (renderer/control-centre/core/markdown.js)

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
    contentDiv.innerHTML = window.PFMarkdown ? window.PFMarkdown.render(text) : text;
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
  contentDiv.innerHTML = `<span class="tool-icon">⚙</span> ${window.PFMarkdown ? window.PFMarkdown.escapeHtml(text) : text}`;
  if (isError) contentDiv.style.color = 'var(--error-color)';
  msgDiv.appendChild(contentDiv);
  messagesEl.appendChild(msgDiv);
  scrollToBottom();
}

function addSecurityEvent(eventPayload) {
  // Extract data
  const type = eventPayload.type;
  const data = eventPayload.data;
  
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

  let icon = '';
  let bgColor = '';
  let textColor = '#fff';
  let messageContent = '';

  switch (type) {
    case 'intent-sealed':
      icon = '🛡️';
      bgColor = '#27AE60'; // Green
      messageContent = `<div><strong>Intent Plan Sealed</strong><br><span style="opacity:0.8;font-size:11px;">Token: ${data.tokenHash}</span><br><span style="opacity:0.8;font-size:11px;">Authorized: [${data.authorizedTools.join(', ')}]</span></div>`;
      break;
    case 'tool-allowed':
      icon = '✅';
      bgColor = '#2980B9'; // Blue
      messageContent = `Tool executed: ${data.tool}`;
      break;
    case 'enforcement-block':
      if (data.reason.includes('drift')) {
        icon = '⚠️';
        bgColor = '#E67E22'; // Orange (INTENT_DRIFT)
        messageContent = `Blocked: ${data.tool} not in signed intent plan`;
      } else {
        icon = '❌';
        bgColor = '#C0392B'; // Red (POLICY_DENY)
        messageContent = `Blocked: ${data.tool} matched deny list`;
      }
      break;
    case 'intent-failed':
      icon = '❌';
      bgColor = '#C0392B'; // Red
      messageContent = `Intent planning failed: ${data.reason}`;
      break;
  }

  msgDiv.style.backgroundColor = bgColor;
  msgDiv.style.color = textColor;
  msgDiv.innerHTML = `<span style="font-size:16px;line-height:1;">${icon}</span><div style="flex:1;">${messageContent}</div>`;
  
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
  streamingMessageEl.innerHTML = window.PFMarkdown ? window.PFMarkdown.render(lastAssistantText) : lastAssistantText;
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

// (Removed escapeHtml, now in PFMarkdown)

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

// Focus input on load and notify Main that Renderer is ready for buffered events
window.addEventListener('DOMContentLoaded', () => {
  inputField.focus();
  if (window.assistant.sendRendererReady) {
    window.assistant.sendRendererReady();
  }
});

// Listen for security events
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
  const apiKey = await window.assistant.getElevenLabsApiKey();
  if (!apiKey) {
    addMessage('error', 'Please set your ElevenLabs API key in the tray menu first.');
    return;
  }
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    audioChunks = [];
    
    mediaRecorder.addEventListener('dataavailable', event => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener('stop', async () => {
      stream.getTracks().forEach(t => t.stop());
      btnMic.classList.remove('recording');

      if (audioChunks.length === 0) return;
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const apiFile = new File([audioBlob], 'audio.webm', { type: 'audio/webm' });

      showTypingIndicator();
      try {
        const formData = new FormData();
        formData.append('file', apiFile);
        formData.append('model_id', 'scribe_v1');
        
        const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey
          },
          body: formData
        });
        
        if (!response.ok) {
          const errText = await response.text();
          throw new Error('ElevenLabs STT error: ' + errText);
        }
        
        const data = await response.json();
        const transcription = data.text;
        hideTypingIndicator();
        
        if (transcription && transcription.trim()) {
          inputField.value = transcription;
          sendMessage();
        }
      } catch (err) {
        hideTypingIndicator();
        addMessage('error', err.message);
      }
    });

    mediaRecorder.start();
    isRecordingAudio = true;
    btnMic.classList.add('recording');
  } catch (err) {
    addMessage('error', 'Microphone error: ' + err.message);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecordingAudio = false;
  btnMic.classList.remove('recording');
}

btnMic.addEventListener('mousedown', () => {
  startRecording();
});
btnMic.addEventListener('mouseup', () => {
  stopRecording();
});
btnMic.addEventListener('mouseleave', () => {
  if (isRecordingAudio) stopRecording();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    if (spaceIsDown) return; 
    spaceIsDown = true;
    
    // Prevent typing a space immediately so we can check if it's a hold
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
      
      // If we didn't hold it long enough to record, insert the normal space
      if (!isRecordingAudio) {
        if (document.activeElement === inputField) {
          const start = inputField.selectionStart;
          const end = inputField.selectionEnd;
          const val = inputField.value;
          inputField.value = val.substring(0, start) + ' ' + val.substring(end);
          inputField.selectionStart = inputField.selectionEnd = start + 1;
        }
      }
    }
    
    if (isRecordingAudio) {
      stopRecording();
    }
  }
});
