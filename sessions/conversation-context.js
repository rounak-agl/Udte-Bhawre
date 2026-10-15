/**
 * Helpers for carrying an agent's conversation into a new session object — after a
 * provider/settings change, or when the app restarts and the last saved conversation
 * is restored from the database — so the agent keeps its memory.
 */

const CHAT_ROLES = new Set(['user', 'assistant']);

function chatTurns(history) {
  return (history || []).filter(m => m && CHAT_ROLES.has(m.role) && typeof m.text === 'string' && m.text.trim());
}

/**
 * The most recent user/assistant turns as plain text, for providers that take the
 * whole prompt as a CLI argument. Newest turns win when trimming. maxChars stays well
 * under the ~8 KB command-line limit cmd.exe imposes on Windows `.cmd` launchers.
 */
function buildTranscript(history, { maxMessages = 20, maxChars = 6000 } = {}) {
  const turns = chatTurns(history).slice(-maxMessages);
  const lines = [];
  let total = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const line = `${turns[i].role === 'user' ? 'User' : 'Assistant'}: ${turns[i].text.trim()}`;
    if (total + line.length > maxChars) break;
    lines.unshift(line);
    total += line.length + 1;
  }
  return lines.join('\n');
}

/**
 * The same turns in Gemini API `contents` form: roles alternate (consecutive messages
 * from one side are merged) and the first entry is from the user.
 */
function toGeminiContents(history, { maxMessages = 40 } = {}) {
  const contents = [];
  for (const m of chatTurns(history).slice(-maxMessages)) {
    const role = m.role === 'user' ? 'user' : 'model';
    const last = contents[contents.length - 1];
    if (last && last.role === role && m.internal) {
      last.parts.push({ text: m.text }); // its own part, so it can be told apart (app-sent)
    } else if (last && last.role === role && !last.parts.some((p, i) => i > 0)) {
      last.parts[0].text += `\n\n${m.text}`;
    } else if (last && last.role === role) {
      last.parts.push({ text: m.text });
    } else {
      contents.push({ role, parts: [{ text: m.text }] });
    }
  }
  while (contents.length && contents[0].role !== 'user') contents.shift();
  return contents;
}

/**
 * The same turns as OpenAI-style chat messages ({ role: 'user'|'assistant', content }),
 * used by Ollama's /api/chat.
 */
function toChatMessages(history, { maxMessages = 40 } = {}) {
  return chatTurns(history).slice(-maxMessages).map(m => ({ role: m.role, content: m.text }));
}

/**
 * The text kept in history (and saved to the database) for a user message with images:
 * the images themselves aren't stored, so later turns and other providers see a note.
 */
function userTurnText(message, imageCount = 0) {
  if (!imageCount) return message;
  const note = `[📎 ${imageCount} image${imageCount === 1 ? '' : 's'} attached]`;
  return message ? `${message}\n${note}` : note;
}

/**
 * A user-side history entry. `internal` marks messages the app sent on the user's behalf
 * (e.g. sub-agent results): they're model context, but the chat doesn't show them.
 */
function userEntry(message, imageCount = 0, { internal = false } = {}) {
  const entry = { role: 'user', text: userTurnText(message, imageCount) };
  if (internal) entry.internal = true;
  return entry;
}

/** What to ask when the user sent only images. */
function promptWithImages(message, imageCount = 0) {
  if (message || !imageCount) return message;
  return imageCount === 1 ? 'Take a look at this image.' : 'Take a look at these images.';
}

module.exports = { buildTranscript, toGeminiContents, toChatMessages, userTurnText, userEntry, promptWithImages };
