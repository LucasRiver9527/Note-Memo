const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quickCaptureApi', {
  config: () => ipcRenderer.invoke('quick:config'),
  save: (input) => ipcRenderer.invoke('quick:save', input),
  hide: () => ipcRenderer.send('quick:hide')
});
