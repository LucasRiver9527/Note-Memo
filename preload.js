const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  exportData: (data) => ipcRenderer.invoke('data:export', data),
  importData: () => ipcRenderer.invoke('data:import'),
  pickImage: () => ipcRenderer.invoke('dialog:pick-image'),
  saveNoteImage: (dataUrl) => ipcRenderer.invoke('note:save-image', dataUrl),
  pickNoteImage: () => ipcRenderer.invoke('dialog:pick-note-image'),
  pickFont: () => ipcRenderer.invoke('dialog:pick-font'),
  chooseDirectory: () => ipcRenderer.invoke('dialog:choose-directory'),
  backupExport: (data, dir) => ipcRenderer.invoke('backup:export', data, dir),
  openPath: (dir) => ipcRenderer.invoke('backup:open-dir', dir),

  minimize: () => ipcRenderer.send('window:minimize'),
  hide: () => ipcRenderer.send('window:hide'),
  close: () => ipcRenderer.send('window:close'),
  maximize: () => ipcRenderer.send('window:maximize'),
  onMaximized: (cb) => ipcRenderer.on('window:maximized', (e, flag) => cb(flag)),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  readClipboard: () => ipcRenderer.invoke('clipboard:read-text'),
  readClipboardImage: () => ipcRenderer.invoke('clipboard:read-image'),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write-text', text),
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
