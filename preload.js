const { contextBridge, ipcRenderer, webUtils } = require('electron');

// 由主进程通过 additionalArguments 注入，保证同步可读、单一来源
const APP_VERSION = ((process.argv || []).find((a) => a.startsWith('--app-version=')) || '').slice('--app-version='.length) || '';

// Only the isolated preload reads OS-backed File paths from a trusted drop.
let droppedPaths = null;
window.addEventListener('drop', (event) => {
  if (!event.isTrusted || !event.dataTransfer?.files.length) return;
  const paths = Array.from(event.dataTransfer.files, (file) => webUtils.getPathForFile(file)).filter(Boolean);
  droppedPaths = paths;
  setTimeout(() => { if (droppedPaths === paths) droppedPaths = null; }, 0);
}, true);

contextBridge.exposeInMainWorld('api', {
  appVersion: APP_VERSION,
  loadData: () => ipcRenderer.invoke('data:load'),
  openQuickCapture: () => ipcRenderer.send('quick:show'),
  captureDraft: (data) => ipcRenderer.sendSync('data:draft', data),
  resolveRecovery: (decision) => ipcRenderer.invoke('data:recovery:resolve', decision),
  // 只读：返回 { status, corruptPath }，渲染层据此决定是否锁定保存
  dataHealth: () => ipcRenderer.invoke('data:health'),
  // 纵深防御：只拦明显非法的入参，不在此处判定「数据是否损坏」
  // （损坏锁由主进程 _dataStatus 与渲染层 dataLoadFailed 负责，避免误伤 migrateData 瞬态）
  saveData: (data, opts) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return Promise.reject(new Error('invalid data shape'));
    }
    if ('notes' in data && !Array.isArray(data.notes)) {
      return Promise.reject(new Error('invalid data shape: notes'));
    }
    return ipcRenderer.invoke('data:save', data, opts);
  },
  exportData: (data) => ipcRenderer.invoke('data:export', data),
  importData: () => ipcRenderer.invoke('data:import'),
  exportFullBackup: () => ipcRenderer.invoke('backup:export-full'),
  getLastFullBackup: () => ipcRenderer.invoke('backup:last-full-export'),
  openFullBackup: () => ipcRenderer.invoke('backup:open-full'),
  discardFullBackup: (token) => ipcRenderer.invoke('backup:discard-full', token),
  pickImage: () => ipcRenderer.invoke('dialog:pick-image'),
  saveNoteImage: (dataUrl) => ipcRenderer.invoke('note:save-image', dataUrl),
  pickNoteImage: () => ipcRenderer.invoke('dialog:pick-note-image'),
  addImageFile: (filePath) => ipcRenderer.invoke('note:add-image-file', filePath),
  pickFont: () => ipcRenderer.invoke('dialog:pick-font'),
  pickSound: () => ipcRenderer.invoke('dialog:pick-sound'),
  chooseDirectory: () => ipcRenderer.invoke('dialog:choose-directory'),
  backupExport: (data, dir) => ipcRenderer.invoke('backup:export', data, dir),
  exportNoteMarkdown: (md, filename) => ipcRenderer.invoke('note:export-markdown', md, filename),
  openPath: (dir) => ipcRenderer.invoke('backup:open-dir', dir),
  cleanupOrphanMedia: () => ipcRenderer.invoke('media:cleanup-orphans'),

  readClipboardFiles: () => ipcRenderer.invoke('clipboard:read-files'),
  statPath: (p) => ipcRenderer.invoke('path:stat', p),
  getDroppedFilePaths: () => {
    const paths = droppedPaths;
    droppedPaths = null;
    return paths?.length ? ipcRenderer.invoke('file:authorize-drop', paths) : Promise.resolve([]);
  },
  openFilePath: (noteId, fileId) => ipcRenderer.invoke('file:open', { id: noteId, fileId }),
  deleteNoteFromDesktop: (id) => ipcRenderer.invoke('note:delete', id),
  setFontSize: (size) => ipcRenderer.invoke('settings:set-font-size', size),
  onFontSize: (cb) => ipcRenderer.on('settings:font-size', (e, v) => cb(v)),

  minimize: () => ipcRenderer.send('window:minimize'),
  hide: () => ipcRenderer.send('window:hide'),
  close: () => ipcRenderer.send('window:close'),
  maximize: () => ipcRenderer.send('window:maximize'),
  onMaximized: (cb) => ipcRenderer.on('window:maximized', (e, flag) => cb(flag)),
  onCloseRequest: (cb) => ipcRenderer.on('window:close-request', (e, intent) => cb(intent)),
  onWindowSaveFailed: (cb) => ipcRenderer.on('window:save-failed', () => cb()),
  replyCloseDecision: (decision) => ipcRenderer.send('window:close-decision', decision),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  readClipboard: () => ipcRenderer.invoke('clipboard:read-text'),
  readClipboardImage: () => ipcRenderer.invoke('clipboard:read-image'),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  copyImage: (src) => ipcRenderer.invoke('clipboard:write-image', src),
  setAlwaysOnTop: (flag) => ipcRenderer.send('window:always-on-top', flag),
  setOpacity: (opacity) => ipcRenderer.send('window:set-opacity', opacity),
  setWindowControls: (opts) => ipcRenderer.send('window:set-controls', opts),
  setSelfOpacity: (opacity) => ipcRenderer.send('window:set-self-opacity', opacity),
  setNoteOpacity: (opacity) => ipcRenderer.send('window:set-note-opacity', opacity),
  onNoteOpacity: (cb) => ipcRenderer.on('window:note-opacity', (e, v) => cb(v)),
  saveNoteOpacity: (opacity) => ipcRenderer.send('note:save-note-opacity', opacity),
  onNoteOpacitySetting: (cb) => ipcRenderer.on('window:note-opacity-setting', (e, v) => cb(v)),
  setEffects: (fx) => ipcRenderer.send('window:set-effects', fx),
  onEffects: (cb) => ipcRenderer.on('window:effects', (e, v) => cb(v)),

  onCreateNote: (cb) => ipcRenderer.on('note:create', () => cb()),
  onAlwaysOnTop: (cb) => ipcRenderer.on('window:always-on-top', (e, flag) => cb(flag)),
  onReminderFired: (cb) => ipcRenderer.on('reminder:fired', (e, id) => cb(id)),
  onReminderOpen: (cb) => ipcRenderer.on('reminder:open', (e, id) => cb(id)),
  onReminderSound: (cb) => ipcRenderer.on('reminder:sound', (e, info) => cb(info)),
  onNoteDeleted: (cb) => ipcRenderer.on('note:deleted', (e, id) => cb(id)),

  pinToDesktop: (id) => ipcRenderer.invoke('note:pin', id),
  unpinFromDesktop: (id) => ipcRenderer.invoke('note:unpin', id),
  showDesktopNote: (id) => ipcRenderer.invoke('note:show', id),
  closeAllDetached: () => ipcRenderer.invoke('note:close-all'),
  noteGet: (id) => ipcRenderer.invoke('note:get', id),
  reportNoteReady: (id, ok) => ipcRenderer.send('note:ready', id, ok),
  onNoteFlush: (callback) => {
    ipcRenderer.on('note:flush-request', async (_event, id) => {
      let saved = false;
      try { saved = await callback() === true; }
      catch (error) { console.error('[note] Could not flush:', error); }
      ipcRenderer.send('note:flush-result', id, saved);
    });
  },
  captureNoteDraft: (note) => ipcRenderer.sendSync('note:draft', note),
  noteUpdate: (note, opts) => ipcRenderer.invoke('note:update', note, opts),
  showNativeMenu: (opts) => ipcRenderer.invoke('note:show-menu', opts),
  onNoteChanged: (cb) => ipcRenderer.on('note:changed', (e, note) => cb(note)),
  onNoteUnpinned: (cb) => ipcRenderer.on('note:unpinned', (e, id) => cb(id)),

  onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (e, info) => cb(info)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update:downloaded', (e, info) => cb(info)),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  quitAndInstall: () => ipcRenderer.invoke('update:install'),

  getAutoLaunch: () => ipcRenderer.invoke('startup:get'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('startup:set', enabled),

  getShortcuts: () => ipcRenderer.invoke('shortcuts:get'),
  setShortcuts: (overrides) => ipcRenderer.invoke('shortcuts:set', overrides)
});
