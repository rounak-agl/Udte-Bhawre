// renderer/control-centre/pages/connectors/custom-server-modal.js
// Add / edit a custom MCP server: paste a JSON config, or fill the form. Arguments are
// one per row (so values with spaces work) and env vars / headers are key–value rows.

window.PFConnectors = window.PFConnectors || {};

(function () {
  const el = (...a) => window.pfCreateElement(...a);
  const META_KEYS = ['source', 'catalogId', 'registryName', 'registryVersion', 'displayName'];

  /** Opens the shared modal frame; returns { overlay, body, footer, close }. */
  function openModal(title, { wide = false } = {}) {
    const overlay = el('div', 'pf-modal-overlay');
    const box = el('div', `pf-modal-container${wide ? ' pf-modal-container--wide' : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    const header = el('div', 'pf-modal-header');
    header.appendChild(el('h2', 'pf-modal-title', { textContent: title }));
    const closeBtn = window.PFButton({ icon: '✕', variant: 'ghost', size: 'sm' });
    closeBtn.setAttribute('aria-label', 'Close');
    header.appendChild(closeBtn);
    const body = el('div', 'pf-modal-body');
    const footer = el('div', 'pf-modal-footer');
    box.append(header, body, footer);
    overlay.appendChild(box);

    const onKey = (e) => { if (e.key === 'Escape') close(); };
    function close() {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    }
    closeBtn.onclick = close;
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    return { overlay, body, footer, close };
  }

  /** Editable list of single values (arguments). */
  function listEditor({ values, placeholder, addLabel }) {
    const wrap = el('div', 'pf-kv-list');
    const rows = el('div', 'pf-kv-rows');
    function addRow(value = '') {
      const row = el('div', 'pf-kv-row');
      const input = el('input', 'pf-input', { type: 'text', placeholder, spellcheck: 'false', 'aria-label': placeholder });
      input.value = value;
      const remove = window.PFButton({ icon: '✕', variant: 'ghost', size: 'sm' });
      remove.setAttribute('aria-label', 'Remove');
      remove.onclick = () => row.remove();
      row.append(input, remove);
      rows.appendChild(row);
      return input;
    }
    (values || []).forEach(v => addRow(v));
    const add = window.PFButton({ label: addLabel, variant: 'ghost', size: 'sm' });
    add.onclick = () => addRow().focus();
    wrap.append(rows, add);
    return {
      element: wrap,
      // Keep empty strings out, but keep a value's spaces exactly as typed
      get: () => [...rows.querySelectorAll('input')].map(i => i.value).filter(v => v !== ''),
      set: (vals) => { rows.textContent = ''; (vals || []).forEach(v => addRow(v)); }
    };
  }

  /** Editable key → value rows (env vars, headers); values are masked with a reveal button. */
  function keyValueEditor({ entries, keyPlaceholder, valuePlaceholder, addLabel }) {
    const wrap = el('div', 'pf-kv-list');
    const rows = el('div', 'pf-kv-rows');
    function addRow(key = '', value = '') {
      const row = el('div', 'pf-kv-row pf-kv-row--pair');
      const keyInput = el('input', 'pf-input pf-kv-key', { type: 'text', placeholder: keyPlaceholder, spellcheck: 'false', 'aria-label': keyPlaceholder });
      keyInput.value = key;
      const valueWrap = window.PFInput({ type: 'password', revealable: true, placeholder: valuePlaceholder, value });
      valueWrap.classList.add('pf-kv-value');
      const remove = window.PFButton({ icon: '✕', variant: 'ghost', size: 'sm' });
      remove.setAttribute('aria-label', 'Remove');
      remove.onclick = () => row.remove();
      row.append(keyInput, valueWrap, remove);
      rows.appendChild(row);
      return keyInput;
    }
    Object.entries(entries || {}).forEach(([k, v]) => addRow(k, v));
    const add = window.PFButton({ label: addLabel, variant: 'ghost', size: 'sm' });
    add.onclick = () => addRow().focus();
    wrap.append(rows, add);
    return {
      element: wrap,
      get: () => {
        const out = {};
        rows.querySelectorAll('.pf-kv-row').forEach(row => {
          const k = row.querySelector('.pf-kv-key').value.trim();
          const v = row.querySelector('.pf-kv-value input').value;
          if (k) out[k] = v;
        });
        return out;
      },
      set: (obj) => { rows.textContent = ''; Object.entries(obj || {}).forEach(([k, v]) => addRow(k, v)); }
    };
  }

  function field(label, control, hint) {
    const group = el('div', 'pf-form-field');
    group.appendChild(el('div', 'pf-input-label', { textContent: label }));
    group.appendChild(control);
    if (hint) group.appendChild(el('div', 'pf-env-desc', { textContent: hint }));
    return group;
  }

  /** Shows a test result (tools found or the error) in `target`. */
  function renderTestResult(target, result) {
    target.textContent = '';
    target.hidden = false;
    target.className = `pf-test-result ${result.ok ? 'is-ok' : 'is-error'}`;
    if (result.ok) {
      const n = result.tools.length;
      target.appendChild(el('div', 'pf-test-title', { textContent: `✅ Connected — ${n} tool${n === 1 ? '' : 's'}` }));
      if (n) {
        const chips = el('div', 'pf-chip-list');
        result.tools.slice(0, 24).forEach(t => chips.appendChild(el('span', 'pf-chip', { textContent: t })));
        if (n > 24) chips.appendChild(el('span', 'pf-chip', { textContent: `+${n - 24} more` }));
        target.appendChild(chips);
      }
    } else {
      target.appendChild(el('div', 'pf-test-title', { textContent: '⚠️ Couldn\'t start this server' }));
      target.appendChild(el('pre', 'pf-test-error', { textContent: result.error || 'Unknown error' }));
    }
  }

  /**
   * @param {object} opts
   * @param {string} [opts.id]      editing an existing server
   * @param {object} [opts.config]  its current config
   * @param {function} [opts.onSaved]
   */
  function openCustomServerModal({ id = '', config = null, onSaved } = {}) {
    const editing = !!id;
    const start = config || { command: 'npx', args: [], env: {} };
    const meta = {};
    META_KEYS.forEach(k => { if (start[k] !== undefined) meta[k] = start[k]; });
    const { body, footer, close } = openModal(editing ? `Edit ${start.displayName || id}` : 'Add a custom MCP server', { wide: true });

    // ── Paste a config ──
    const paste = el('details', 'pf-paste-config');
    if (!editing) paste.open = true;
    paste.appendChild(el('summary', '', { textContent: 'Paste a config (Claude Desktop, Cursor, VS Code or README JSON)' }));
    const pasteArea = el('textarea', 'pf-env-textarea', {
      placeholder: '{\n  "mcpServers": {\n    "my-server": { "command": "npx", "args": ["-y", "some-mcp-server"] }\n  }\n}',
      spellcheck: 'false',
      'aria-label': 'Pasted config'
    });
    const pasteMsg = el('div', 'pf-env-desc');
    const pickRow = el('div', 'pf-paste-pick');
    const fillBtn = window.PFButton({ label: 'Fill in the form', variant: 'secondary', size: 'sm' });
    paste.append(pasteArea, pickRow, pasteMsg, fillBtn);
    body.appendChild(paste);

    // ── Form ──
    const nameInput = window.PFInput({ label: 'Name', placeholder: 'e.g. my-server', value: id });
    body.appendChild(nameInput);

    const typeRow = el('div', 'pf-segmented', { role: 'radiogroup', 'aria-label': 'Server type' });
    const localBtn = el('button', 'pf-segment', { type: 'button', role: 'radio', textContent: 'Local command' });
    const hostedBtn = el('button', 'pf-segment', { type: 'button', role: 'radio', textContent: 'Hosted URL' });
    typeRow.append(localBtn, hostedBtn);
    body.appendChild(field('Type', typeRow));

    const localSection = el('div', 'pf-form-section');
    const commandInput = window.PFInput({ label: 'Command', placeholder: 'npx, uvx, node, python, docker…', value: start.command || '' });
    const argsEditor = listEditor({ values: start.args, placeholder: 'argument', addLabel: '+ Add argument' });
    const envEditor = keyValueEditor({ entries: start.env, keyPlaceholder: 'NAME', valuePlaceholder: 'value', addLabel: '+ Add variable' });
    localSection.append(
      commandInput,
      field('Arguments', argsEditor.element, 'One per row — a value with spaces stays one argument.'),
      field('Environment variables', envEditor.element, 'Stored encrypted. Typically API keys and tokens.')
    );

    const hostedSection = el('div', 'pf-form-section');
    const urlInput = window.PFInput({ label: 'Server URL', placeholder: 'https://example.com/mcp', value: start.url || '' });
    const headerEditor = keyValueEditor({ entries: start.headers, keyPlaceholder: 'Header', valuePlaceholder: 'Bearer …', addLabel: '+ Add header' });
    hostedSection.append(
      urlInput,
      field('Headers', headerEditor.element, 'Stored encrypted. Servers that only support OAuth sign-in can\'t be added yet.')
    );
    body.append(localSection, hostedSection);

    const result = el('div', 'pf-test-result', { role: 'status' });
    result.hidden = true;
    body.appendChild(result);

    let type = start.type === 'http' ? 'http' : 'stdio';
    function setType(t) {
      type = t;
      localBtn.setAttribute('aria-checked', String(t === 'stdio'));
      hostedBtn.setAttribute('aria-checked', String(t === 'http'));
      localBtn.classList.toggle('active', t === 'stdio');
      hostedBtn.classList.toggle('active', t === 'http');
      localSection.hidden = t !== 'stdio';
      hostedSection.hidden = t !== 'http';
    }
    localBtn.onclick = () => setType('stdio');
    hostedBtn.onclick = () => setType('http');
    setType(type);

    const nameEl = nameInput.querySelector('input');
    const commandEl = commandInput.querySelector('input');
    const urlEl = urlInput.querySelector('input');

    function fillFrom(server) {
      if (server.id && !editing) nameEl.value = server.id;
      const cfg = server.config;
      if (cfg.type === 'http') {
        setType('http');
        urlEl.value = cfg.url;
        headerEditor.set(cfg.headers);
      } else {
        setType('stdio');
        commandEl.value = cfg.command;
        argsEditor.set(cfg.args);
        envEditor.set(cfg.env);
      }
      result.hidden = true;
    }

    fillBtn.onclick = () => {
      const parsed = window.parsePastedMcpConfig(pasteArea.value);
      pickRow.textContent = '';
      if (!parsed.ok) {
        pasteMsg.textContent = parsed.error;
        pasteMsg.classList.add('is-error');
        return;
      }
      pasteMsg.classList.remove('is-error');
      fillFrom(parsed.servers[0]);
      if (parsed.servers.length > 1) {
        // Several servers in one snippet: let the user pick which one to add
        const select = el('select', 'pf-input pf-select', { 'aria-label': 'Server from the pasted config' });
        parsed.servers.forEach((s, i) => select.appendChild(el('option', '', { value: String(i), textContent: s.id })));
        select.onchange = () => fillFrom(parsed.servers[Number(select.value)]);
        pickRow.appendChild(field(`${parsed.servers.length} servers found — add one at a time`, select));
      }
      // Placeholders like YOUR_TOKEN or ${input:…} still need real values
      const values = [...Object.values(envEditor.get()), ...Object.values(headerEditor.get())];
      const needsValues = values.some(v => /\$\{|<[^>]+>|YOUR[_-]|REPLACE|xxx/i.test(v));
      pasteMsg.textContent = needsValues
        ? 'Filled in. Replace the placeholder values (keys/tokens) below, then Test.'
        : 'Filled in. Check the values below, then Test.';
    };

    function collect() {
      const cfg = type === 'http'
        ? { type: 'http', url: urlEl.value.trim(), headers: headerEditor.get() }
        : { command: commandEl.value.trim(), args: argsEditor.get(), env: envEditor.get() };
      return { ...meta, ...cfg };
    }

    function validate(cfg) {
      if (type === 'http') {
        if (!/^https:\/\//i.test(cfg.url) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(cfg.url)) {
          return 'Enter the server\'s https:// URL (plain http only works for localhost).';
        }
      } else if (!cfg.command) {
        return 'Enter the command that starts the server.';
      }
      return null;
    }

    const testBtn = window.PFButton({ label: 'Test connection', variant: 'secondary' });
    const cancelBtn = window.PFButton({ label: 'Cancel', variant: 'ghost' });
    const saveBtn = window.PFButton({ label: editing ? 'Save changes' : 'Add server', variant: 'primary' });
    footer.append(testBtn, cancelBtn, saveBtn);
    cancelBtn.onclick = close;

    async function busy(btn, label, fn) {
      const lbl = btn.querySelector('.pf-btn-label');
      const prev = lbl.textContent;
      btn.disabled = true;
      lbl.textContent = label;
      try { return await fn(); } finally { btn.disabled = false; lbl.textContent = prev; }
    }

    testBtn.onclick = () => busy(testBtn, 'Starting…', async () => {
      const cfg = collect();
      const problem = validate(cfg);
      if (problem) return renderTestResult(result, { ok: false, error: problem });
      renderTestResult(result, await window.ccBridge.testMcpServer(cfg));
    });

    saveBtn.onclick = () => busy(saveBtn, 'Saving…', async () => {
      const newId = nameEl.value.trim();
      const cfg = collect();
      const problem = !newId ? 'Give the server a name.' : validate(cfg);
      if (problem) return renderTestResult(result, { ok: false, error: problem });
      const res = await window.ccBridge.saveMcpServer({ id: newId, config: cfg, previousId: editing ? id : undefined });
      if (!res.ok) return renderTestResult(result, { ok: false, error: res.error });
      window.PFToast.show(editing ? 'Server updated' : 'Server added', `${newId} is available to agents on Gemini Vision with desktop tools on.`);
      close();
      if (onSaved) onSaved(newId);
    });

    (editing ? nameEl : pasteArea).focus();
  }

  window.PFConnectors.openModal = openModal;
  window.PFConnectors.renderTestResult = renderTestResult;
  window.PFConnectors.openCustomServerModal = openCustomServerModal;
})();
