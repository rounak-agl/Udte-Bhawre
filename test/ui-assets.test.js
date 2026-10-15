// Static checks on the renderer: classes the JS renders are styled, CSS loads correctly,
// and provider/model names (user input) are never interpolated into HTML.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { REPO } = require('./helpers');

function filesUnder(dir, ext) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return filesUnder(p, ext);
    return p.endsWith(ext) ? [p] : [];
  });
}
const renderer = path.join(REPO, 'renderer');
const css = filesUnder(renderer, '.css').map(f => fs.readFileSync(f, 'utf8')).join('\n');

test('classes rendered by the JS have styles', () => {
  const classes = [
    'pf-modal-box', 'pf-task-card', 'pf-task-title', 'pf-task-desc', 'pf-task-footer', 'pf-task-actions',
    'pf-avatar--xs', 'pf-badge--secondary', 'pf-inline-code', 'pf-code-block', 'pf-heading-sm',
    'pf-list-item', 'pf-link', 'pf-topbar-search', 'pf-input-reveal', 'pf-chat-item-delete',
    'pf-model-row', 'pf-info-card', 'pf-chip', 'provider-ollama'
  ];
  const missing = classes.filter(c => !css.includes(`.${c}`));
  assert.deepStrictEqual(missing, []);
});

test('CSS variables used are defined; @import comes first', () => {
  assert.ok(!css.includes('var(--pf-color-primary)'), '--pf-color-primary is not a token');
  const chatCss = fs.readFileSync(path.join(renderer, 'chat.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  assert.ok(chatCss.startsWith('@import'), '@import after other rules is ignored');
});

test('chat ⚙ menu builds provider buttons without innerHTML', () => {
  const chatJs = fs.readFileSync(path.join(renderer, 'chat.js'), 'utf8');
  const render = chatJs.slice(chatJs.indexOf('function renderProviderList'), chatJs.indexOf('function toggleSettings'));
  assert.ok(render.includes('createTextNode') && !render.includes('innerHTML'));
  assert.ok(!/\$\{p\.name\}/.test(chatJs.slice(chatJs.indexOf('dropdown.innerHTML'), chatJs.indexOf('container.appendChild(dropdown)'))));
});

test('desktop tools toggle sits next to the message box (not in the ⚙ menu)', () => {
  const html = fs.readFileSync(path.join(renderer, 'chat.html'), 'utf8');
  const inputArea = html.slice(html.indexOf('id="input-area"'), html.indexOf('id="btn-send"'));
  assert.ok(/<button id="btn-tools"[^>]*aria-pressed=/.test(inputArea), 'toggle button in the input area');
  const chatJs = fs.readFileSync(path.join(renderer, 'chat.js'), 'utf8');
  assert.ok(!chatJs.includes('settings-tools-section') && !chatJs.includes('data-tools-toggle'), 'no second toggle in the ⚙ menu');
  assert.ok(css.includes('#btn-tools.active') && css.includes('#btn-tools:disabled'));
});

test('ArmorIQ shield badge: in the chat status bar, text-only rendering', () => {
  const html = fs.readFileSync(path.join(renderer, 'chat.html'), 'utf8');
  assert.ok(/<span id="guard-badge"[^>]*role="status"[^>]*hidden/.test(html));
  const chatJs = fs.readFileSync(path.join(renderer, 'chat.js'), 'utf8');
  const render = chatJs.slice(chatJs.indexOf('function renderGuardBadge'), chatJs.indexOf('window.assistant.onGuardStatus'));
  assert.ok(render.includes('textContent') && !render.includes('innerHTML'), 'reason text comes from the network');
  for (const state of ['active', 'unreachable', 'error', 'off']) assert.ok(css.includes(`#guard-badge.guard-${state}`), state);
});

test('removed Gemini CLI provider is gone from the UI and sessions', () => {
  assert.ok(!fs.existsSync(path.join(REPO, 'sessions/gemini-session.js')));
  const agentsJs = fs.readFileSync(path.join(renderer, 'control-centre/pages/agents/agents-page.js'), 'utf8');
  assert.ok(!/['"`]Gemini CLI['"`]/.test(agentsJs), 'no "Gemini CLI" option label');
});

test('Connectors: classes are styled, scripts load in order, registry data never hits innerHTML', () => {
  const dir = path.join(renderer, 'control-centre/pages/connectors');
  const files = ['paste-config.js', 'custom-server-modal.js', 'install-drawer.js', 'marketplace-view.js', 'installed-view.js', 'connectors-page.js'];
  const js = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  // Registry entries are untrusted: text only (PFButton's icon arg is a constant)
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(js), 'no HTML injection points');
  const used = [...new Set([...js.matchAll(/['"`]((?:pf-(?:market|install|test|kv|connectors|installed|segment|paste|form|link-button|required)[\w-]*))/g)].map(m => m[1]))];
  const missing = used.filter(c => !css.includes(`.${c}`));
  assert.deepStrictEqual(missing, []);
  const html = fs.readFileSync(path.join(renderer, 'control-centre/control-centre.html'), 'utf8');
  const order = files.map(f => html.indexOf(`pages/connectors/${f}`));
  assert.ok(order.every(i => i > 0), 'all connector scripts loaded');
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order, 'helpers load before the page');
  assert.ok(html.indexOf('pages/connectors/connectors-page.js') < html.indexOf('core/boot.js'));
});

test('chat attachments: 📎 menu in the input area, styled, images rendered without innerHTML', () => {
  const html = fs.readFileSync(path.join(renderer, 'chat.html'), 'utf8');
  const inputArea = html.slice(html.indexOf('id="input-area"'), html.indexOf('id="btn-send"'));
  for (const id of ['btn-attach', 'attach-menu', 'attach-screenshot', 'attach-file', 'attach-input']) assert.ok(inputArea.includes(`id="${id}"`), id);
  assert.ok(html.indexOf('id="attachments"') < html.indexOf('id="input-area"'), 'preview strip above the input');
  for (const sel of ['#btn-attach', '#attach-menu', '#attachments', '.attachment-remove', '.message-images', '.drop-target']) assert.ok(css.includes(sel), sel);
  const chatJs = fs.readFileSync(path.join(renderer, 'chat.js'), 'utf8');
  const attach = chatJs.slice(chatJs.indexOf('// ─── Attachments'), chatJs.indexOf('// ─── Send message'));
  assert.ok(!attach.includes('innerHTML'));
  const add = chatJs.slice(chatJs.indexOf('function addMessage'), chatJs.indexOf('function addToolMessage'));
  assert.ok(add.includes("strip.className = 'message-images'") && add.includes('createTextNode(text)'), 'user text stays text');
});

test('orchestration UI: protocol blocks hidden, cards built from text, styles present', () => {
  // The shared markdown renderer hides ```delegate / ```remember blocks (chat + Control Centre)
  global.window = global.window || {};
  require(path.join(renderer, 'control-centre/core/markdown.js'));
  const md = global.window.PFMarkdown;
  assert.strictEqual(md.render('ok\n```delegate\n{"tasks":[]}\n```'), 'ok<br><br><em>📋 Handing this to sub-agents…</em>');
  assert.strictEqual(md.render('typing ```deleg'), 'typing');
  assert.match(md.render('```js\nx\n```'), /pf-code-block/, 'normal code blocks unaffected');

  const chatJs = fs.readFileSync(path.join(renderer, 'chat.js'), 'utf8');
  const cards = chatJs.slice(chatJs.indexOf('// ─── Sub-agents'), chatJs.indexOf('// ─── Send message'));
  assert.ok(!cards.includes('innerHTML'), 'task titles/results are model output');
  for (const sel of ['.subagents-card', '.subagent-row', '.subagent-pill', '.pill-failed', '.subagent-preview']) assert.ok(css.includes(sel), sel);
  const tasksJs = fs.readFileSync(path.join(renderer, 'control-centre/pages/tasks/tasks-page.js'), 'utf8');
  assert.ok(/pf-task-result-text', \{ textContent: task\.result/.test(tasksJs));
  for (const sel of ['.pf-task-filter', '.pf-task-result', '.pf-toggle', '.pf-memory-note']) assert.ok(css.includes(sel), sel);
});
