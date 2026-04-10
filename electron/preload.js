const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize:   () => ipcRenderer.send('minimize'),
  maximize:   () => ipcRenderer.send('maximize'),
  close:      () => ipcRenderer.send('close'),

  // Navigation
  nav: (page) => ipcRenderer.send('nav', page),

  // Existing invoke methods
  appVer:     () => ipcRenderer.invoke('appVer'),
  camReq:     (opts) => ipcRenderer.invoke('camReq', opts),
  saveReport: (opts) => ipcRenderer.invoke('saveReport', opts),

  // Generic invoke bridge — covers all db:* IPC channels (SQLite)
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});
