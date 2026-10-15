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
const btnTools = document.getElementById('btn-tools');
const btnAttach = document.getElementById('btn-attach');
const attachMenu = document.getElementById('attach-menu');
const attachInput = document.getElementById('attach-input');
const attachmentsEl = document.getElementById('attachments');
const guardBadge = document.getElementById('guard-badge');

let currentTheme = 'Peach';
let currentProvider = 'claude';
let isStreaming = false;
let streamingMessageEl = null;
let lastAssistantText = '';
let hasMessages = false;
let settingsOpen = false;
let toolsEnabled = true; // this agent's desktop tools setting (Gemini Vision only)

// ─── Provider config ───
const themeClasses = {
  'Peach': 'theme-peach',
  'Midnight': 'theme-midnight',
  'Cloud': 'theme-cloud',
  'Moss': 'theme-moss'
};

// Provider list comes from main (built-ins + the user's local models) via 'chat-init';
// this is only the fallback until it arrives.
let providers = [
  { key: 'vision', name: 'Gemini Vision', emoji: '👁', kind: 'builtin', supportsTools: true, supportsImages: true },
  { key: 'claude', name: 'Claude', emoji: '✦', kind: 'builtin', supportsImages: true },
  { key: 'codex', name: 'Codex', emoji: '⚡', kind: 'builtin', supportsImages: true },
  { key: 'copilot', name: 'Copilot', emoji: '🤖', kind: 'builtin' }
];

function providerInfo(key) {
  return providers.find(p => p.key === key) || { key, name: 'Assistant', emoji: '✦', kind: 'builtin' };
}

// CSS class for the avatar tint: built-ins by key, every local model shares one tint
function providerClass(key) {
  const info = providerInfo(key);
  return info.kind === 'ollama' ? 'provider-ollama' : `provider-${info.key}`;
}

// ─── Textarea auto-grow ───
function autoGrow() {
  inputField.style.height = 'auto';
  inputField.style.height = Math.min(inputField.scrollHeight, 96) + 'px';
}

inputField.addEventListener('input', autoGrow);

// ─── Create a provider-tinted avatar ───
function createAvatar(provider) {
  const avatar = document.createElement('div');
  avatar.className = `msg-avatar ${providerClass(provider)}`;
  avatar.textContent = providerInfo(provider).emoji;
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
  const { name, emoji } = providerInfo(currentProvider);
  providerNameEl.textContent = name;
  inputField.placeholder = `Ask ${name} anything...`;
  providerCardEmoji.textContent = emoji;
  providerCardTitle.textContent = `${name} Assistant`;
  providerCardSub.textContent = `Powered by ${name} — ask anything`;
  document.querySelectorAll('.settings-item[data-provider]').forEach(el => {
    el.classList.toggle('active', el.dataset.provider === currentProvider);
  });
  updateToolsUI();
  updateAttachUI();
}

// ─── Tools toggle (per agent) ───
// Desktop tools (files, clipboard, URLs, shell…) only exist for Gemini Vision; the CLI
// providers bring their own, so the toggle is only shown for Vision.
function updateToolsUI() {
  const supported = !!providerInfo(currentProvider).supportsTools;
  const on = supported && toolsEnabled;
  btnTools.disabled = !supported;
  btnTools.classList.toggle('active', on);
  btnTools.setAttribute('aria-pressed', String(on));
  const label = !supported
    ? `Desktop tools are only available with Gemini Vision (${providerInfo(currentProvider).name} uses its own)`
    : `Desktop tools: ${toolsEnabled ? 'on' : 'off'} — click to turn ${toolsEnabled ? 'off' : 'on'}`;
  btnTools.title = label;
  btnTools.setAttribute('aria-label', label);
}

btnTools.addEventListener('click', () => {
  // Main replies with 'tools-change' once the agent's session has been updated
  if (!btnTools.disabled) window.assistant.setChatTools(!toolsEnabled);
});

// ─── Settings dropdown ───
function createSettingsDropdown() {
  const dropdown = document.createElement('div');
  dropdown.id = 'settings-dropdown';

  const themes = ['Peach', 'Midnight', 'Cloud', 'Moss'];

  // Static skeleton only; provider buttons are added by renderProviderList() with DOM
  // APIs, since custom model names are user input
  dropdown.innerHTML = `
    <div class="settings-section-title">Provider</div>
    <div id="settings-provider-list"></div>
    <div class="settings-divider"></div>
    <div class="settings-section-title">Theme</div>
    ${themes.map(t => `
      <button class="settings-item ${t === currentTheme ? 'active' : ''}" data-theme="${t}">
        <span class="item-dot"></span>${t}
      </button>
    `).join('')}
  `;

  container.appendChild(dropdown);
  renderProviderList();
  updateToolsUI();

  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.settings-item');
    if (!item) return;


    if (item.dataset.provider && item.dataset.provider !== currentProvider) {
      // Switches this agent's provider; main replies with 'provider-change'
      window.assistant.setChatProvider(item.dataset.provider);
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

/** (Re)build the provider buttons in the ⚙ menu from the current provider list. */
function renderProviderList() {
  const list = document.getElementById('settings-provider-list');
  if (!list) return;
  list.replaceChildren(...providers.map(p => {
    const btn = document.createElement('button');
    btn.className = `settings-item ${p.key === currentProvider ? 'active' : ''}`;
    btn.dataset.provider = p.key;
    const dot = document.createElement('span');
    dot.className = 'item-dot';
    btn.append(dot, document.createTextNode(p.kind === 'ollama' ? `${p.name} (local)` : p.name));
    return btn;
  }));
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

// ─── Initial state for this agent's chat (sent by main when the window loads) ───
window.assistant.onChatInit((state) => {
  if (!state) return;
  if (Array.isArray(state.providers) && state.providers.length) providers = state.providers;
  currentProvider = state.provider || currentProvider;
  renderProviderList();
  toolsEnabled = state.toolsEnabled !== false;
  renderGuardBadge(state.guard);
  applyTheme(themeClasses[state.theme] ? state.theme : currentTheme);
});

// ─── Message rendering ───
function addMessage(role, text, images = []) {
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
    if (images.length) {
      const strip = document.createElement('div');
      strip.className = 'message-images';
      images.forEach(img => {
        const el = document.createElement('img');
        el.src = img.url;
        el.alt = 'Attached image';
        strip.appendChild(el);
      });
      contentDiv.appendChild(strip);
    }
    if (text) contentDiv.appendChild(document.createTextNode(text));
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
    case 'fallback-approved':
      icon = '✋';
      bgColor = '#2980B9';
      messageContent = `<div><strong>Allowed by you</strong><br><span style="opacity:0.85;font-size:11px;">${safeEscape(data.tool || 'Tool')} ran with your approval — ArmorIQ couldn't verify it.</span></div>`;
      break;
    case 'tool-allowed':
      icon = '✅';
      bgColor = '#2980B9';
      messageContent = `Tool executed: ${safeEscape(data.tool || 'unknown')}`;
      break;
    case 'enforcement-block': {
      const reason = data.reason || '';
      const tool = safeEscape(data.tool || 'This tool');
      // Older events have no `kind`; infer it from the reason text
      const kind = data.kind || (/drift|not in .*plan/i.test(reason) ? 'drift'
        : /intent plan|unreachable|verif/i.test(reason) ? 'unverified' : 'policy');
      const detail = reason ? `<br><span style="opacity:0.7;font-size:10px;">${safeEscape(reason)}</span>` : '';
      if (kind === 'declined') {
        icon = '✋';
        bgColor = '#7F8C8D';
        messageContent = `<div><strong>Not run — you declined</strong>`
          + `<br><span style="opacity:0.85;font-size:11px;">ArmorIQ was unreachable, so ${tool} asked for your OK and you said no.</span></div>`;
      } else if (kind === 'unverified') {
        icon = '🔌';
        bgColor = '#7F8C8D';
        messageContent = `<div><strong>Blocked — couldn't verify with ArmorIQ</strong>`
          + `<br><span style="opacity:0.85;font-size:11px;">${tool} wasn't run: tools need ArmorIQ's approval, and it couldn't be reached for this message.</span>${detail}</div>`;
      } else if (kind === 'drift') {
        icon = '⚠️';
        bgColor = '#E67E22';
        messageContent = `<div><strong>Blocked — not in the approved plan</strong>`
          + `<br><span style="opacity:0.85;font-size:11px;">${tool} wasn't part of the plan ArmorIQ approved for this message.</span></div>`;
      } else {
        icon = '❌';
        bgColor = '#C0392B';
        messageContent = `<div><strong>Blocked by policy</strong>`
          + `<br><span style="opacity:0.85;font-size:11px;">${tool} isn't allowed by the security policy.</span>${detail}</div>`;
      }
      break;
    }
    case 'intent-failed': {
      const reason = data.reason || 'Unknown reason';
      // Connection problems are the common case: say so plainly, keep the raw error small
      // The guard classifies the failure (`unreachable`); older events fall back to the text
      const network = typeof data.unreachable === 'boolean'
        ? data.unreachable
        : /socket|TLS|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timed? ?out|network|fetch failed/i.test(reason);
      icon = network ? '🔌' : '❌';
      bgColor = network ? '#7F8C8D' : '#C0392B';
      messageContent = network
        ? `<div><strong>Couldn't reach ArmorIQ</strong>`
          + `<br><span style="opacity:0.85;font-size:11px;">Any tool this message needs will ask for your OK (Allow / Deny) instead. Local safety rules still apply.</span>`
          + `<br><span style="opacity:0.7;font-size:10px;">${safeEscape(reason)}</span></div>`
        : `<div><strong>ArmorIQ couldn't approve this message</strong>`
          + `<br><span style="opacity:0.85;font-size:11px;">Tools are blocked for this message.</span>`
          + `<br><span style="opacity:0.7;font-size:10px;">${safeEscape(reason)}</span></div>`;
      break;
    }
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
      addMessage('system', '📖 Commands:\n  /copy — Copy last AI response\n  /help — Show this help\n\nTo start over, delete the conversation in Control Centre → Chat.');
      return true;

    default:
      return false;
  }
}

// ─── Attachments: screenshots and images for the next message ───
// Nothing is captured or sent on its own: the user adds images (📎 menu, paste, drop),
// sees them above the message box, and they go only with the message they send.
const MAX_ATTACHMENTS = 4;
const MAX_IMAGE_SIDE = 2048;
let attachments = []; // { mimeType, data (base64), url (data: URL for display) }

function supportsImages() {
  return !!providerInfo(currentProvider).supportsImages;
}

function updateAttachUI() {
  const ok = supportsImages();
  btnAttach.disabled = !ok;
  const label = ok
    ? 'Attach a screenshot or image (or paste / drop one)'
    : `${providerInfo(currentProvider).name} can't read images — switch provider in ⚙`;
  btnAttach.title = label;
  btnAttach.setAttribute('aria-label', label);
  if (!ok) closeAttachMenu();
}

function flashStatus(text) {
  sessionStatusEl.textContent = text;
  setTimeout(() => { if (sessionStatusEl.textContent === text) sessionStatusEl.textContent = 'Ready'; }, 3000);
}

function renderAttachments() {
  attachmentsEl.textContent = '';
  attachmentsEl.hidden = attachments.length === 0;
  attachments.forEach((a, i) => {
    const item = document.createElement('div');
    item.className = 'attachment';
    const img = document.createElement('img');
    img.src = a.url;
    img.alt = `Attachment ${i + 1}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'attachment-remove';
    remove.textContent = '✕';
    remove.title = 'Remove';
    remove.setAttribute('aria-label', `Remove attachment ${i + 1}`);
    remove.addEventListener('click', () => { attachments.splice(i, 1); renderAttachments(); });
    item.append(img, remove);
    attachmentsEl.appendChild(item);
  });
}

function addAttachment(mimeType, data) {
  if (attachments.length >= MAX_ATTACHMENTS) {
    flashStatus(`Up to ${MAX_ATTACHMENTS} images per message`);
    return;
  }
  attachments.push({ mimeType, data, url: `data:${mimeType};base64,${data}` });
  renderAttachments();
}

/** Any image the browser can decode → JPEG, at most 2048 px on its longest side. */
async function imageFileToAttachment(blob) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // transparent areas would turn black in a JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

async function addImageFiles(files) {
  const images = [...files].filter(f => f && f.type && f.type.startsWith('image/'));
  if (!images.length) return;
  if (!supportsImages()) {
    flashStatus(`${providerInfo(currentProvider).name} can't read images`);
    return;
  }
  for (const file of images) {
    try {
      addAttachment('image/jpeg', await imageFileToAttachment(file));
    } catch (_) {
      flashStatus(`Couldn't read ${file.name || 'that image'}`);
    }
  }
}

function closeAttachMenu() {
  attachMenu.hidden = true;
  btnAttach.setAttribute('aria-expanded', 'false');
}

btnAttach.addEventListener('click', () => {
  if (btnAttach.disabled) return;
  const open = attachMenu.hidden;
  attachMenu.hidden = !open;
  btnAttach.setAttribute('aria-expanded', String(open));
  if (open) attachMenu.querySelector('button').focus();
});
document.addEventListener('mousedown', (e) => {
  if (!attachMenu.hidden && !e.target.closest('#attach-wrap')) closeAttachMenu();
});
attachMenu.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeAttachMenu(); btnAttach.focus(); }
});

document.getElementById('attach-file').addEventListener('click', () => {
  closeAttachMenu();
  attachInput.click();
});
attachInput.addEventListener('change', async () => {
  await addImageFiles(attachInput.files);
  attachInput.value = '';
  inputField.focus();
});

document.getElementById('attach-screenshot').addEventListener('click', async () => {
  closeAttachMenu();
  if (attachments.length >= MAX_ATTACHMENTS) return flashStatus(`Up to ${MAX_ATTACHMENTS} images per message`);
  sessionStatusEl.textContent = 'Taking screenshot…';
  // The chat window hides itself while the screen is captured, then comes back
  const res = await window.assistant.captureScreen();
  if (res && res.ok) {
    addAttachment(res.image.mimeType, res.image.data);
    sessionStatusEl.textContent = 'Ready';
  } else {
    flashStatus(res?.error || 'Screenshot failed');
  }
  inputField.focus();
});

// Paste an image (e.g. a screenshot copied with the system's own tool)
inputField.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  addImageFiles(files);
});

// Drag and drop images onto the chat
container.addEventListener('dragover', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  e.preventDefault();
  container.classList.add('drop-target');
});
container.addEventListener('dragleave', (e) => {
  if (!container.contains(e.relatedTarget)) container.classList.remove('drop-target');
});
container.addEventListener('drop', (e) => {
  container.classList.remove('drop-target');
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  addImageFiles(e.dataTransfer.files);
});

// ─── Send message ───
function sendMessage() {
  const text = inputField.value.trim();
  if (!text && !attachments.length) return;

  if (text.startsWith('/') && !attachments.length) {
    inputField.value = '';
    inputField.style.height = 'auto';
    if (handleSlashCommand(text)) return;
  }
  if (attachments.length && !supportsImages()) {
    flashStatus(`${providerInfo(currentProvider).name} can't read images — remove them or switch provider`);
    return;
  }

  const images = attachments;
  attachments = [];
  renderAttachments();
  inputField.value = '';
  inputField.style.height = 'auto'; // reset textarea height

  addMessage('user', text, images);
  showTypingIndicator();
  window.assistant.sendMessage(text, images.map(({ mimeType, data }) => ({ mimeType, data })));
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
  status.textContent = `${providerInfo(currentProvider).name} • ${currentTheme}`;
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

// Provider / key / tools changes keep the conversation (main carries it over),
// so the transcript stays on screen.
window.assistant.onProviderChange((provider) => {
  if (!provider || provider === currentProvider) return;
  currentProvider = provider;
  updateProviderUI();
  addMessage('system', `🔄 Switched to ${providerInfo(provider).name} — conversation continues.`);
});

window.assistant.onApiKeyChange(() => {
  addMessage('system', '🔑 API key updated.');
});

window.assistant.onToolsChange((enabled) => {
  toolsEnabled = !!enabled;
  updateToolsUI();
  addMessage('system', toolsEnabled ? '🧰 Desktop tools enabled for this agent.' : '🧰 Desktop tools disabled for this agent.');
});

// A local model was added/removed in Settings → refresh the ⚙ menu
window.assistant.onProvidersChanged((list) => {
  if (!Array.isArray(list) || !list.length) return;
  providers = list;
  renderProviderList();
  updateProviderUI();
});

// ─── ArmorIQ shield badge ───
// Shows whether this agent's desktop tools are protected right now. Hidden when the
// provider has no desktop tools (or they're off) — there's nothing to guard.
const GUARD_BADGES = {
  active:      { text: '🛡 Protected',         tip: 'ArmorIQ verifies every desktop-tool action this agent takes.' },
  unreachable: { text: '🛡 Asking you',        tip: "ArmorIQ can't be reached right now, so each action asks for your OK (Allow / Deny). Local safety rules still apply." },
  error:       { text: '🛡 Guard error',       tip: "ArmorIQ couldn't approve this agent's actions, so tools are blocked. Check the key in Control Centre → Settings → Security." },
  off:         { text: '🛡 Guard off',         tip: 'No ArmorIQ key is set. Add one in Control Centre → Settings → Security. Risky actions still ask for your OK.' }
};

function renderGuardBadge(status) {
  const badge = status && GUARD_BADGES[status.state];
  if (!badge) {
    guardBadge.hidden = true;
    return;
  }
  guardBadge.hidden = false;
  guardBadge.className = `guard-${status.state}`;
  guardBadge.textContent = badge.text;
  guardBadge.title = status.reason ? `${badge.tip}\n\n${status.reason}` : badge.tip;
  guardBadge.setAttribute('aria-label', `ArmorIQ: ${badge.text.replace('🛡 ', '')}. ${badge.tip}`);
}

window.assistant.onGuardStatus(renderGuardBadge);

// The saved conversation was deleted from the Control Centre: the agent starts fresh
window.assistant.onChatCleared(() => {
  clearMessages();
  lastAssistantText = '';
  addMessage('system', '🗑️ This conversation was deleted. Starting a new one.');
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
// The user is still holding Space / the mic button. Recording setup is async (key
// lookup, mic permission), so a release during setup must cancel it — otherwise the
// mic would start after the key was already released and never stop.
let recordingRequested = false;
let spaceDownTimer = null;
let spaceIsDown = false;

async function startRecording() {
  if (isRecordingAudio || recordingRequested) return;
  recordingRequested = true;

  let apiKey;
  try {
    apiKey = await window.assistant.getElevenLabsApiKey();
  } catch (err) {
    recordingRequested = false;
    addMessage('error', 'ElevenLabs: Could not retrieve API key. Check Control Centre → Settings.');
    return;
  }

  if (!apiKey) {
    recordingRequested = false;
    addMessage('error', 'ElevenLabs: No API key configured. Add it in Control Centre → Settings.');
    return;
  }
  if (!recordingRequested) return; // released while we were fetching the key

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    recordingRequested = false;
    const reason = err.name === 'NotAllowedError'
      ? 'Microphone access denied. Grant permission in system settings.'
      : err.name === 'NotFoundError'
        ? 'No microphone found. Connect a mic and try again.'
        : `Microphone error: ${err.message}`;
    addMessage('error', reason);
    return;
  }
  if (!recordingRequested) { // released while the mic was opening
    stream.getTracks().forEach(t => t.stop());
    return;
  }

  try {
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  } catch (err) {
    recordingRequested = false;
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
    recordingRequested = false;
    addMessage('error', `Recording error: ${e.error ? e.error.message : 'Unknown recording failure'}`);
    sessionStatusEl.textContent = 'Ready';
  });

  mediaRecorder.start();
  isRecordingAudio = true;
  btnMic.classList.add('recording');
  sessionStatusEl.textContent = 'Listening...';
}

function stopRecording() {
  recordingRequested = false; // also cancels a start that is still setting up
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch (_) { /* already stopped */ }
  }
  isRecordingAudio = false;
  btnMic.classList.remove('recording');
  // status text is set in the 'stop' event handler
}

btnMic.addEventListener('mousedown', () => { startRecording(); });
btnMic.addEventListener('mouseup', () => { stopRecording(); });
btnMic.addEventListener('mouseleave', () => { if (isRecordingAudio || recordingRequested) stopRecording(); });

/**
 * Hold-Space push-to-talk only applies when you're not typing: the message box is
 * empty (or something other than a text field/button has focus). Once there's text,
 * Space is just a space — no delay, no reordering of fast keystrokes, no accidental
 * recording from key repeat.
 */
function isPushToTalkSpace(e) {
  if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
  const el = document.activeElement;
  if (el === inputField) return inputField.value.length === 0;
  return !(el && ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

window.addEventListener('keydown', (e) => {
  if (spaceIsDown && e.code === 'Space') { e.preventDefault(); return; } // key repeat while held
  if (!isPushToTalkSpace(e)) return;
  e.preventDefault();
  spaceIsDown = true;
  spaceDownTimer = setTimeout(() => {
    spaceDownTimer = null;
    startRecording();
  }, 250);
});

window.addEventListener('keyup', (e) => {
  if (e.code !== 'Space' || !spaceIsDown) return;
  spaceIsDown = false;
  if (spaceDownTimer) {
    // A short tap: nothing to record (and nothing to type — the box was empty)
    clearTimeout(spaceDownTimer);
    spaceDownTimer = null;
  }
  if (isRecordingAudio || recordingRequested) stopRecording();
});
