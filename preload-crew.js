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
  openHome: () => ipcRenderer.send('crew:open-home')
});
