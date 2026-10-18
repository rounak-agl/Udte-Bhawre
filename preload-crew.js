const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crewBridge', {
  post: (msg) => ipcRenderer.send('crew:bus', msg),
  on: (fn) => {
    const handler = (_e, msg) => fn(msg);
    ipcRenderer.on('crew:bus', handler);
    return () => ipcRenderer.removeListener('crew:bus', handler);
  },
  onDeskCrew: (fn) => {
    const handler = (_e, id) => fn(id);
    ipcRenderer.on('crew:desk-crew', handler);
    return () => ipcRenderer.removeListener('crew:desk-crew', handler);
  },
  setInteractive: (on) => ipcRenderer.send('crew:interactive', !!on),
  openDesk: (crewId, anchor) => ipcRenderer.send('crew:open-desk', crewId, anchor),
  deskMode: (mode) => ipcRenderer.send('crew:desk-mode', mode),
  closeDesk: () => ipcRenderer.send('crew:desk-close'),
  pinDesk: (on) => ipcRenderer.send('crew:desk-pin', !!on),
  openHome: () => ipcRenderer.send('crew:open-home'),
  chatSend: (id, text, images) => ipcRenderer.send('crew:chat-send', id, text, images),
  decide: (planId, ok) => ipcRenderer.send('crew:decide', planId, !!ok),
  stop: (id) => ipcRenderer.send('crew:stop', id),
  overview: () => ipcRenderer.invoke('crew:overview'),
  setProvider: (id, key) => ipcRenderer.invoke('crew:set-provider', id, key),
  localDetect: () => ipcRenderer.invoke('crew:local-detect'),
  localAdd: (model) => ipcRenderer.invoke('crew:local-add', model),
  setKey: (key) => ipcRenderer.invoke('crew:set-key', key),
  openConnectors: () => ipcRenderer.send('crew:open-connectors'),
  // Settings and connectors. Shared with the Control Centre's handlers; the main process
  // only answers these from Home base (see requireControlCentre).
  settings: {
    providerKeys: () => ipcRenderer.invoke('get-provider-api-keys'),
    setProviderKey: (provider, key) => ipcRenderer.send('set-provider-api-key', provider, key),
    elevenLabsKey: () => ipcRenderer.invoke('get-eleven-labs-api-key'),
    setElevenLabsKey: (key) => ipcRenderer.send('set-eleven-labs-api-key', key),
    mongodbUri: () => ipcRenderer.invoke('get-mongodb-uri'),
    setMongodbUri: (uri) => ipcRenderer.invoke('set-mongodb-uri', uri),
    armorIQKey: () => ipcRenderer.invoke('get-armoriq-key'),
    setArmorIQKey: (key) => ipcRenderer.invoke('set-armoriq-key', key),
    testArmorIQ: () => ipcRenderer.invoke('test-armoriq'),
    security: () => ipcRenderer.invoke('get-security-overview'),
    secretStorage: () => ipcRenderer.invoke('get-secret-storage-status'),
    appInfo: () => ipcRenderer.invoke('get-app-info')
  },
  connectors: {
    installed: () => ipcRenderer.invoke('get-mcp-servers'),
    catalog: () => ipcRenderer.invoke('marketplace-catalog'),
    search: (query, cursor) => ipcRenderer.invoke('marketplace-search', query, cursor),
    install: (request) => ipcRenderer.invoke('marketplace-install', request),
    test: (target) => ipcRenderer.invoke('mcp-test-server', target),
    save: (request) => ipcRenderer.invoke('mcp-save-server', request),
    uninstall: (id) => ipcRenderer.invoke('mcp-uninstall', id)
  },
  onBackend: (fn) => {
    const handler = (_e, evt) => fn(evt);
    ipcRenderer.on('crew:backend', handler);
    return () => ipcRenderer.removeListener('crew:backend', handler);
  }
});
