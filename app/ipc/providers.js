const { ipcMain } = require('electron');
const state = require('../state');
const appEvents = require('../events');
const { requireControlCentre } = require('../security');
const { providerFor } = require('../provider-choice');
const { listProviders, addCustomModel, removeCustomModel } = require('../../sessions/providers');
const { listOllamaModels } = require('../../sessions/ollama-session');

/** Tell every open chat (⚙ menu) and the tray that the provider list changed. */
function broadcastProvidersChanged() {
  const providers = listProviders();
  state.characters.forEach(c => c.sendToChat('providers-changed', providers));
  appEvents.emit('settings-changed');
}

/** IPC for the provider list and user-added local (Ollama) models. */
function registerProviderIpc() {
  ipcMain.handle('get-providers', () => listProviders());

  // Models pulled into an Ollama server, for the "Add model" picker
  ipcMain.handle('list-ollama-models', async (event, baseUrl) => {
    if (!requireControlCentre(event, 'list-ollama-models')) return { ok: false, error: 'Not allowed' };
    try {
      return { ok: true, models: await listOllamaModels(baseUrl) };
    } catch (err) {
      const unreachable = err.cause?.code === 'ECONNREFUSED' || err.name === 'TimeoutError' || /fetch failed/i.test(err.message);
      return { ok: false, error: unreachable ? 'Ollama isn\'t reachable at that address. Is it running? (ollama serve)' : err.message };
    }
  });

  ipcMain.handle('add-custom-model', (event, input) => {
    if (!requireControlCentre(event, 'add-custom-model')) return { ok: false, error: 'Not allowed' };
    try {
      const model = addCustomModel(input);
      broadcastProvidersChanged();
      return { ok: true, model };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('remove-custom-model', (event, id) => {
    if (!requireControlCentre(event, 'remove-custom-model')) return false;
    if (typeof id !== 'string' || !removeCustomModel(id)) return false;
    // Agents using it now get a clear "model removed" message in their chat
    state.characters.forEach(c => {
      if (c.session && providerFor(c) === `ollama:${id}`) c.createSession();
    });
    broadcastProvidersChanged();
    return true;
  });
}

module.exports = { registerProviderIpc };
