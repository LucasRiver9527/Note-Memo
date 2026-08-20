const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  exportData: (data) => ipcRenderer.invoke('data:export', data),
  importData: () => ipcRenderer.invoke('data:import'),
  pickImage: () => ipcRenderer.invoke('dialog:pick-image'),

  minimize: () => ipcRenderer.send('window:minimize'),
  hide: () => ipcRenderer.send('window:hide'),
  close: () => ipcRenderer.send('window:close'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  setAlwaysOnTop: (flag) => ipcRenderer.send('window:always-on-top', flag),
  setOpacity: (opacity) => ipcRenderer.send('window:set-opacity', opacity),

  onCreateNote: (cb) => ipcRenderer.on('note:create', () => cb()),
  onAlwaysOnTop: (cb) => ipcRenderer.on('window:always-on-top', (e, flag) => cb(flag)),
  onReminderFired: (cb) => ipcRenderer.on('reminder:fired', (e, id) => cb(id)),

  pinToDesktop: (id) => ipcRenderer.invoke('note:pin', id),
  unpinFromDesktop: (id) => ipcRenderer.invoke('note:unpin', id),
  closeAllDetached: () => ipcRenderer.invoke('note:close-all'),
  noteGet: (id) => ipcRenderer.invoke('note:get', id),
  noteUpdate: (note) => ipcRenderer.invoke('note:update', note),
  onNoteChanged: (cb) => ipcRenderer.on('note:changed', (e, note) => cb(note)),
  onNoteUnpinned: (cb) => ipcRenderer.on('note:unpinned', (e, id) => cb(id))
});
