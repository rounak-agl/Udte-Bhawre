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
    if (last && last.role === role) {
      last.parts[0].text += `\n\n${m.text}`;
    } else {
      contents.push({ role, parts: [{ text: m.text }] });
    }
  }
  while (contents.length && contents[0].role !== 'user') contents.shift();
  return contents;
}

module.exports = { buildTranscript, toGeminiContents };
