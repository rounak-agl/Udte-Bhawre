// renderer/control-centre/pages/connectors/install-drawer.js
// One-click install of a Marketplace server: asks only for the fields it needs, then the
// main process builds the config, test-starts the server and saves it if it works.

window.PFConnectors = window.PFConnectors || {};

(function () {
  const el = (...a) => window.pfCreateElement(...a);

  /** Plain-text preview of what will run / be contacted (shown for unverified servers). */
  function describeInstall(install) {
    if (!install) return '';
    if (install.type === 'http') return `Connects to ${install.url}`;
    const args = (install.args || []).flatMap(a => (Array.isArray(a) ? a : [a]));
    // {field} placeholders are filled from the form below
    return `Runs on this computer: ${[install.command, ...args].join(' ').replace(/\{[A-Za-z0-9_]+\}/g, '<value>')}`;
  }

  /** Recover the values the user entered last time from a saved config (for Edit). */
  function prefillValues(entry, config) {
    const values = {};
    if (!config || !entry.install) return values;
    const pairs = entry.install.type === 'http'
      ? Object.entries(entry.install.headers || {}).map(([k, t]) => [t, (config.headers || {})[k]])
      : Object.entries(entry.install.env || {}).map(([k, t]) => [t, (config.env || {})[k]]);
    for (const [template, saved] of pairs) {
      const m = /^(.*)\{([A-Za-z0-9_]+)\}(.*)$/.exec(template || '');
      if (!m || typeof saved !== 'string') continue;
      const [, before, key, after] = m;
      if (saved.startsWith(before) && saved.endsWith(after)) values[key] = saved.slice(before.length, saved.length - after.length);
    }
    return values;
  }

  function runtimeProblem(entry, catalog) {
    const install = entry.install;
    if (!install || install.type === 'http' || !install.runtime) return null;
    if (catalog.runtimes?.[install.runtime] !== false) return null;
    return catalog.runtimeInfo?.[install.runtime] || { label: install.runtime, binary: install.command };
  }

  /**
   * @param {object} entry     catalog or registry entry
   * @param {object} catalog   { runtimes, runtimeInfo } from getMarketplaceCatalog
   * @param {object} [opts]    { installedConfig, onInstalled }
   */
  function openInstallDialog(entry, catalog, { installedConfig = null, onInstalled } = {}) {
    const { body, footer, close } = window.PFConnectors.openModal(
      installedConfig ? `Update ${entry.name}` : `Install ${entry.name}`
    );

    // ── Header: what this is and who publishes it ──
    const head = el('div', 'pf-install-head');
    head.appendChild(el('div', 'pf-connector-icon', { textContent: entry.icon || '🧩' }));
    const info = el('div', 'pf-connector-info');
    info.appendChild(el('div', 'pf-connector-name', { textContent: entry.name }));
    const by = el('div', 'pf-connector-desc');
    by.appendChild(document.createTextNode(entry.publisher ? `by ${entry.publisher} ` : ''));
    by.appendChild(window.PFBadge({ label: entry.verified ? '✓ Verified' : 'Unverified', variant: entry.verified ? 'success' : 'warning' }));
    info.appendChild(by);
    head.appendChild(info);
    body.appendChild(head);
    if (entry.description) body.appendChild(el('p', 'pf-install-desc', { textContent: entry.description }));
    if (entry.homepage && /^https?:\/\//i.test(entry.homepage)) {
      body.appendChild(el('a', 'pf-link', { href: entry.homepage, target: '_blank', rel: 'noopener', textContent: 'Documentation ↗' }));
    }

    // ── Trust check for registry servers ──
    let trusted = !!entry.verified;
    const installBtn = window.PFButton({ label: installedConfig ? 'Update' : 'Install', variant: 'primary' });
    if (!entry.verified) {
      const warn = el('div', 'pf-install-warning');
      warn.appendChild(el('strong', '', { textContent: 'From the public MCP Registry — not reviewed.' }));
      warn.appendChild(el('code', 'pf-install-command', { textContent: describeInstall(entry.install) }));
      const label = el('label', 'pf-install-trust');
      const box = el('input', '', { type: 'checkbox' });
      box.onchange = () => { trusted = box.checked; updateButton(); };
      label.append(box, document.createTextNode(' I trust this publisher'));
      warn.appendChild(label);
      body.appendChild(warn);
    }

    // ── Runtime (Node / uv) ──
    const missing = runtimeProblem(entry, catalog);
    if (missing) {
      const note = el('div', 'pf-install-warning');
      note.appendChild(document.createTextNode(`This server needs ${missing.label} (${missing.binary}), which wasn't found. `));
      if (missing.installUrl) note.appendChild(el('a', 'pf-link', { href: missing.installUrl, target: '_blank', rel: 'noopener', textContent: `Install ${missing.label} ↗` }));
      note.appendChild(document.createTextNode(' Then restart the app.'));
      body.appendChild(note);
    }

    // ── Fields ──
    const previous = prefillValues(entry, installedConfig);
    const inputs = {};
    const fieldsBox = el('div', 'pf-form-section');
    (entry.fields || []).forEach(f => {
      const wrap = window.PFInput({
        label: f.label,
        placeholder: f.placeholder || (f.required ? '' : 'Optional'),
        type: f.secret ? 'password' : 'text',
        revealable: !!f.secret,
        value: previous[f.key] ?? f.default ?? ''
      });
      if (f.required) wrap.querySelector('.pf-input-label')?.appendChild(el('span', 'pf-required', { textContent: ' *', 'aria-hidden': 'true' }));
      inputs[f.key] = wrap.querySelector('input');
      inputs[f.key].addEventListener('input', updateButton);
      if (f.description || f.helpUrl) {
        const hint = el('div', 'pf-env-desc');
        if (f.description) hint.appendChild(document.createTextNode(`${f.description} `));
        if (f.helpUrl && /^https:\/\//i.test(f.helpUrl)) hint.appendChild(el('a', 'pf-link', { href: f.helpUrl, target: '_blank', rel: 'noopener', textContent: f.secret ? 'Get a key ↗' : 'Learn more ↗' }));
        wrap.appendChild(hint);
      }
      fieldsBox.appendChild(wrap);
    });
    if (entry.fields?.length) body.appendChild(fieldsBox);
    if (entry.fields?.some(f => f.secret)) {
      body.appendChild(el('div', 'pf-env-desc', { textContent: 'Keys are encrypted on this computer and only sent to this server.' }));
    }

    const status = el('div', 'pf-test-result', { role: 'status' });
    status.hidden = true;
    body.appendChild(status);

    const cancelBtn = window.PFButton({ label: 'Cancel', variant: 'ghost' });
    cancelBtn.onclick = close;
    const forceBtn = window.PFButton({ label: 'Save anyway', variant: 'secondary' });
    forceBtn.hidden = true;
    footer.append(cancelBtn, forceBtn, installBtn);

    function requiredFilled() {
      return (entry.fields || []).every(f => !f.required || inputs[f.key].value.trim());
    }
    function updateButton() {
      installBtn.disabled = !trusted || !!missing || !requiredFilled() || !entry.installable;
    }
    updateButton();

    function values() {
      return Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
    }

    async function install(force) {
      const lbl = installBtn.querySelector('.pf-btn-label');
      installBtn.disabled = true;
      forceBtn.hidden = true;
      Object.values(inputs).forEach(i => { i.disabled = true; });
      lbl.textContent = 'Installing…';
      status.hidden = false;
      status.className = 'pf-test-result is-busy';
      status.textContent = force
        ? 'Saving…'
        : 'Starting the server to check it works. The first start downloads it and can take a minute.';
      const request = entry.verified
        ? { catalogId: entry.id, values: values(), force }
        : { registryName: entry.registryName, version: entry.version, values: values(), force };
      let res;
      try {
        res = await window.ccBridge.installMcpServer(request);
      } catch (err) {
        res = { ok: false, error: err.message };
      }
      Object.values(inputs).forEach(i => { i.disabled = false; });
      lbl.textContent = installedConfig ? 'Update' : 'Install';
      if (res.ok) {
        if (force) {
          status.className = 'pf-test-result is-ok';
          status.textContent = 'Saved. It wasn\'t started — use Test on the Installed tab once it\'s fixed.';
        } else {
          window.PFConnectors.renderTestResult(status, { ok: true, tools: res.tools || [] });
          status.firstChild.textContent = `✅ Installed — ${res.tools.length} tool${res.tools.length === 1 ? '' : 's'}`;
        }
        status.appendChild(el('div', 'pf-env-desc', { textContent: 'Used by agents on Gemini Vision with desktop tools (🔧) on.' }));
        installBtn.hidden = true;
        cancelBtn.querySelector('.pf-btn-label').textContent = 'Done';
        if (onInstalled) onInstalled(res.id);
      } else {
        window.PFConnectors.renderTestResult(status, { ok: false, error: res.error });
        forceBtn.hidden = !res.canForce;
        updateButton();
      }
    }
    installBtn.onclick = () => install(false);
    forceBtn.onclick = () => install(true);

    // Nothing to fill in or confirm: it really is one click
    if (!installedConfig && entry.verified && !missing && !(entry.fields || []).length) install(false);
    const first = Object.values(inputs)[0];
    if (first) first.focus();
  }

  window.PFConnectors.openInstallDialog = openInstallDialog;
  window.PFConnectors.describeInstall = describeInstall;
})();
