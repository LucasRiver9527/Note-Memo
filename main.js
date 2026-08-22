const { app, BrowserWindow, ipcMain, dialog, Notification, Tray, Menu, nativeImage, globalShortcut, screen, protocol, net, shell, clipboard, powerSaveBlocker, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const logic = require('./renderer/logic.js');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;

let mainWindow = null;
let tray = null;
let isQuitting = false;
let reminderTimer = null;
let powerSaveId = null;
const recentlyFired = new Set();
const detachedWindows = new Map();

const dataPath = () => path.join(app.getPath('userData'), 'notes-data.json');
const backupDataPath = () => dataPath() + '.bak';
const DEFAULT_DATA_VERSION = 1;

// 数据迁移：按 version 逐级升级到当前版本
function migrateData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const data = raw;
  let v = typeof data.version === 'number' ? data.version : 1;

  // 未来新版本加在此处，例如：
  // if (v < 2) { /* ...迁移逻辑... */ v = 2; }

  data.version = DEFAULT_DATA_VERSION;
  return data;
}

// 原子写：先写临时文件，再原子替换，避免断电/崩溃写下半截文件
function atomicWrite(filePath, text) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, text, 'utf-8');
  fs.renameSync(tmp, filePath);
}

function readData() {
  // 1) 主文件
  try {
    const raw = fs.readFileSync(dataPath(), 'utf-8');
    return migrateData(JSON.parse(raw));
  } catch (e) { /* 损坏或不存在，尝试备份 */ }

  // 2) 主文件损坏，回退到上一版备份
  try {
    const raw = fs.readFileSync(backupDataPath(), 'utf-8');
    return migrateData(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

function writeData(data) {
  try {
    if (typeof data === 'object' && data) {
      data.version = DEFAULT_DATA_VERSION;
    }
    // 写前留一份上一版备份（只保留最近一份）
    try {
      if (fs.existsSync(dataPath())) {
        fs.copyFileSync(dataPath(), backupDataPath());
      }
    } catch (e) { /* 备份失败不阻塞写入 */ }
    atomicWrite(dataPath(), JSON.stringify(data, null, 2));
  } catch (e) { /* 写失败仅记录，不抛出影响渲染进程 */ }
}

// 媒体类型对应的 userData 子目录名
const MEDIA_DIRS = { img: 'images', bg: 'backgrounds', font: 'fonts', sound: 'sounds', images: 'images', backgrounds: 'backgrounds', fonts: 'fonts', sounds: 'sounds' };

// 从 URL 还原媒体文件名
function mediaFileName(url) {
  if (typeof url !== 'string') return null;
  const m = /^note-(img|bg|font|sound):\/\/local\/(.+)$/.exec(url);
  if (!m) return null;
  return { kind: MEDIA_DIRS[m[1]], name: decodeURIComponent(m[2]) };
}

// 收集数据里实际引用的媒体文件，按目录分类
function collectMedia(data) {
  const byDir = {};
  const add = (url) => {
    const r = mediaFileName(url);
    if (!r) return;
    (byDir[r.kind] = byDir[r.kind] || new Set()).add(r.name);
  };
  (data.notes || []).forEach((n) => (n.images || []).forEach((im) => add(im.src)));
  const s = data.settings || {};
  add(s.backgroundImage);
  (s.customFonts || []).forEach((f) => add(f.url));
  add(s.reminderSoundPath);
  return byDir;
}

// 把引用的媒体文件复制进备份文件夹
function copyMediaToBundle(data, bundleDir) {
  const byDir = collectMedia(data);
  for (const dirName of Object.keys(byDir)) {
    if (!byDir[dirName].size) continue;
    const srcDir = path.join(app.getPath('userData'), dirName);
    const destDir = path.join(bundleDir, dirName);
    if (!fs.existsSync(srcDir)) continue;
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    byDir[dirName].forEach((name) => {
      const src = path.join(srcDir, name);
      if (fs.existsSync(src)) {
        try { fs.copyFileSync(src, path.join(destDir, name)); } catch (e) { /* ignore */ }
      }
    });
  }
}

// 把备份文件夹里的媒体复制回 userData
function restoreMediaFromBundle(bundleDir) {
  const dirs = ['images', 'backgrounds', 'fonts', 'sounds'];
  for (const dirName of dirs) {
    const srcDir = path.join(bundleDir, dirName);
    if (!fs.existsSync(srcDir)) continue;
    const destDir = path.join(app.getPath('userData'), dirName);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    fs.readdirSync(srcDir).forEach((name) => {
      const src = path.join(srcDir, name);
      if (fs.statSync(src).isFile()) {
        try { fs.copyFileSync(src, path.join(destDir, name)); } catch (e) { /* ignore */ }
      }
    });
  }
}

function clipboardImageToDataUrl() {
  const img = clipboard.readImage();
  if (!img.isEmpty()) return img.toDataURL();

  let filePath = null;

  // 1) 资源管理器复制文件 -> CF_HDROP
  try {
    const buf = clipboard.readBuffer('CF_HDROP');
    if (buf && buf.length > 16) {
      const pFiles = buf.readUInt32LE(0);
      const fWide = buf.readUInt32LE(16) !== 0;
      const list = buf.slice(pFiles);
      const str = fWide ? list.toString('utf16le') : list.toString('latin1');
      filePath = str.split('\0').find((p) => p && p.length > 1);
    }
  } catch (e) { /* ignore */ }

  // 2) FileNameW
  if (!filePath) {
    try {
      const buf = clipboard.readBuffer('FileNameW');
      if (buf && buf.length) {
        const str = buf.toString('utf16le');
        filePath = str.split('\0').find((p) => p && p.length > 1);
      }
    } catch (e) { /* ignore */ }
  }

  // 3) 复制单个图片文件时，CF_UNICODETEXT 就是文件路径
  if (!filePath) {
    try {
      const t = (clipboard.readText() || '').trim().replace(/^"(.*)"$/, '$1');
      if (t && /^file:\/\/\//i.test(t)) {
        try { filePath = decodeURIComponent(t.replace(/^file:\/\/\//i, '')); } catch (e) { filePath = t.replace(/^file:\/\/\//i, ''); }
      } else if (t && /^[a-zA-Z]:[\\/]/.test(t) && fs.existsSync(t)) {
        filePath = t;
      }
    } catch (e) { /* ignore */ }
  }

  if (!filePath) return null;
  const lowerPath = filePath.toLowerCase();
  const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
  if (!imageExts.some((e) => lowerPath.endsWith(e))) return null;
  try {
    const mime = lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg') ? 'image/jpeg'
      : lowerPath.endsWith('.gif') ? 'image/gif'
      : lowerPath.endsWith('.webp') ? 'image/webp'
      : lowerPath.endsWith('.bmp') ? 'image/bmp'
      : 'image/png';
    const data = fs.readFileSync(filePath);
    return 'data:' + mime + ';base64,' + data.toString('base64');
  } catch (e) {
    return null;
  }
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 640,
    minHeight: 420,
    x: Math.round((width - 1080) / 2),
    y: Math.round((height - 720) / 2),
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1e1f26',
    hasShadow: true,
    resizable: true,
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximized', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximized', false);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createDetachedWindow(noteId) {
  if (detachedWindows.has(noteId)) return;
  const meta = readData();
  const metaSettings = (meta && meta.settings) ? meta.settings : {};
  const metaNote = meta && Array.isArray(meta.notes) ? meta.notes.find((n) => n.id === noteId) : null;
  const noteW = Math.max(220, Math.round(metaNote && metaNote.w ? metaNote.w : 300));
  const noteH = Math.max(150, Math.round(metaNote && metaNote.h ? metaNote.h : 240));

  const win = new BrowserWindow({
    width: noteW,
    height: noteH,
    minWidth: 220,
    minHeight: 150,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    hasShadow: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'note.html'), { query: { id: noteId } });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.setAlwaysOnTop(true, 'screen-saver');
  if (metaSettings.desktopMica && process.platform === 'win32' && typeof win.setBackgroundMaterial === 'function') {
    try { win.setBackgroundMaterial('acrylic'); } catch (e) { /* ignore */ }
  }
  const metaOpacity = metaNote && metaNote.opacity != null
    ? metaNote.opacity
    : (metaSettings.winOpacity != null ? metaSettings.winOpacity : 100);
  win.setOpacity(metaOpacity / 100);
  win.on('focus', () => win.setAlwaysOnTop(true, 'screen-saver'));
  win.on('show', () => {
    win.setAlwaysOnTop(true, 'screen-saver');
  });
  win.on('blur', () => win.setAlwaysOnTop(true, 'screen-saver'));
  const topmostTimer = setInterval(() => {
    if (win.isDestroyed()) { clearInterval(topmostTimer); return; }
    win.setAlwaysOnTop(true, 'screen-saver');
  }, 2000);
  detachedWindows.set(noteId, win);
  win.on('closed', () => {
    if (detachedWindows.get(noteId) === win) detachedWindows.delete(noteId);
    if (mainWindow) mainWindow.webContents.send('note:unpinned', noteId);
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('便签');
  const menu = Menu.buildFromTemplate([
    {
      label: '显示 / 隐藏便签',
      click: () => toggleWindow()
    },
    {
      label: '新建便签',
      click: () => {
        showWindow();
        mainWindow.webContents.send('note:create');
      }
    },
    { type: 'separator' },
    {
      label: '置顶',
      type: 'checkbox',
      checked: false,
      click: (item) => {
        mainWindow.setAlwaysOnTop(item.checked);
        mainWindow.webContents.send('window:always-on-top', item.checked);
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => toggleWindow());
}

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

// ---- Reminders ----
function startPowerSaver() {
  if (powerSaveId != null) return;
  try {
    powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
  } catch (e) { /* ignore */ }
}

function stopPowerSaver() {
  if (powerSaveId != null) {
    try {
      if (powerSaveBlocker.isStarted(powerSaveId)) powerSaveBlocker.stop(powerSaveId);
    } catch (e) { /* ignore */ }
    powerSaveId = null;
  }
}

function scheduleReminders(notes) {
  if (reminderTimer) {
    clearTimeout(reminderTimer);
    reminderTimer = null;
  }

  const now = Date.now();
  const upcoming = (notes || [])
    .filter((n) => n.reminder && n.reminder.enabled && n.reminder.time && !n.reminder.fired && !recentlyFired.has(n.id))
    .map((n) => ({ ...n, at: new Date(n.reminder.time).getTime() }))
    .filter((n) => n.at > now)
    .sort((a, b) => a.at - b.at);

  if (upcoming.length === 0) {
    stopPowerSaver();
    return;
  }

  const next = upcoming[0];
  const delay = Math.max(1000, next.at - now);

  // 距离最近的提醒不足 15 分钟时，阻止系统休眠以保证闹铃准时响起
  if (next.at - now <= 15 * 60 * 1000) startPowerSaver();
  else stopPowerSaver();

  reminderTimer = setTimeout(() => {
    fireReminder(next);
  }, delay);
}

function readDataNotes() {
  const data = readData();
  return data ? data.notes || [] : [];
}

function readDataSettings() {
  const data = readData();
  return (data && data.settings) ? data.settings : {};
}

function fireReminder(note) {
  recentlyFired.add(note.id);
  const title = note.title ? note.title : '待办提醒';
  const body = note.type === 'todo'
    ? (note.items || []).filter((i) => !i.done).map((i) => i.text).join('\n')
    : (note.content || '').slice(0, 200);

  if (Notification.isSupported()) {
    const n = new Notification({
      title: `⏰ ${title}`,
      body: body || '到时间了！',
      icon: path.join(__dirname, 'assets', 'icon.png'),
      silent: true
    });
    n.on('click', () => showWindow());
    n.show();
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    showWindow();
    mainWindow.flashFrame(true);
    setTimeout(() => mainWindow.flashFrame(false), 4000);
    mainWindow.webContents.send('reminder:fired', note.id);

    const settings = readDataSettings();
    if (settings.reminderSound) {
      mainWindow.webContents.send('reminder:sound', {
        url: settings.reminderSoundPath || null,
        volume: (settings.reminderVolume != null ? settings.reminderVolume : 70) / 100
      });
    }
  }

  scheduleReminders(readDataNotes());
}

function checkOverdueReminders() {
  const notes = readDataNotes();
  const now = Date.now();
  notes.forEach((n) => {
    if (n.reminder && n.reminder.enabled && n.reminder.time && !n.reminder.fired && !recentlyFired.has(n.id)) {
      if (new Date(n.reminder.time).getTime() <= now) {
        fireReminder(n);
      }
    }
  });
  scheduleReminders(readDataNotes());
}

// ---- 自动更新 ----
function setupAutoUpdate() {
  // 开发模式不检查；也可通过环境变量强制关闭
  if (!app.isPackaged) return;
  if (process.env.MYNOTES_DISABLE_AUTOUPDATE === '1') return;
  try {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', (e) => { console.error('[update] error:', e && e.message); });
    autoUpdater.on('update-available', (info) => {
      console.log('[update] available:', info && info.version);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:available', info);
    });
    autoUpdater.on('update-downloaded', (info) => {
      console.log('[update] downloaded:', info && info.version);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:downloaded', info);
    });
    // 允许用环境变量覆盖发布地址（否则读打包时的 app-update.yml）
    if (process.env.MYNOTES_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.MYNOTES_UPDATE_URL });
    autoUpdater.checkForUpdates().catch((e) => console.error('[update] check failed:', e && e.message));
  } catch (e) {
    console.error('[update] init failed:', e);
  }
}

// ---- IPC ----
function setupIpc() {
  ipcMain.handle('data:load', () => {
    return readData();
  });

  ipcMain.handle('data:save', (e, data) => {
    writeData(data);
    if (data && Array.isArray(data.notes)) {
      scheduleReminders(data.notes);
    }
    return true;
  });

  ipcMain.handle('data:export', async (e, data) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出便签',
      defaultPath: `便签备份-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [
        { name: 'JSON 备份', extensions: ['json'] },
        { name: 'Markdown', extensions: ['md'] },
        { name: '文本文件', extensions: ['txt'] }
      ]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      const filePath = result.filePath;
      if (filePath.endsWith('.md')) {
        // 图片以 data URI 内嵌，导出为自包含 Markdown（跨工具可用）
        const imageResolver = (src) => {
          const m = /^note-img:\/\/local\/(.+)$/.exec(String(src || ''));
          if (!m) return src;
          const name = decodeURIComponent(m[1]);
          const file = path.join(app.getPath('userData'), 'images', name);
          if (!fs.existsSync(file)) return src;
          const ext = path.extname(name).toLowerCase();
          const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
            : ext === '.gif' ? 'image/gif'
            : ext === '.webp' ? 'image/webp'
            : ext === '.bmp' ? 'image/bmp'
            : 'image/png';
          return 'data:' + mime + ';base64,' + fs.readFileSync(file).toString('base64');
        };
        const md = (data.notes || []).map((n) => logic.noteToMarkdown(n, { image: imageResolver })).join('\n\n---\n\n');
        fs.writeFileSync(filePath, md, 'utf-8');
      } else if (filePath.endsWith('.txt')) {
        const lines = data.notes.map((n) => {
          const body = n.type === 'todo'
            ? (n.items || []).map((i) => `${i.done ? '[x]' : '[ ]'} ${i.text}`).join('\n')
            : n.content;
          return `◆ ${n.title}\n${body}\n---`;
        }).join('\n\n');
        fs.writeFileSync(filePath, lines, 'utf-8');
      } else {
        if (typeof data === 'object' && data) data.version = DEFAULT_DATA_VERSION;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      }
      return { ok: true, path: filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('data:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入便签',
      properties: ['openFile'],
      filters: [{ name: '备份文件或清单', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    try {
      const filePath = result.filePaths[0];
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = migrateData(JSON.parse(raw));
      // 若所选 data.json 归属于一个"自包含备份文件夹"，把旁边携带的媒体一并恢复
      const bundleDir = path.dirname(filePath);
      restoreMediaFromBundle(bundleDir);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('dialog:choose-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择备份文件夹',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle('backup:export', async (e, data, dir) => {
    try {
      let parent = dir;
      if (!parent) parent = path.join(app.getPath('userData'), 'backups');
      if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
      const stamp = new Date();
      const pad = (x) => String(x).padStart(2, '0');
      const folder = path.join(parent, `便签备份-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`);
      if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
      if (typeof data === 'object' && data) data.version = DEFAULT_DATA_VERSION;
      fs.writeFileSync(path.join(folder, 'data.json'), JSON.stringify(data, null, 2), 'utf-8');
      copyMediaToBundle(data, folder);
      return { ok: true, path: folder };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('media:cleanup-orphans', async () => {
    try {
      const data = readData() || { settings: {}, groups: [], notes: [], trash: [] };
      const refs = logic.referencedMedia(data);
      let freedCount = 0, freedBytes = 0;
      for (const dirName of ['images', 'backgrounds', 'fonts', 'sounds']) {
        const dirPath = path.join(app.getPath('userData'), dirName);
        if (!fs.existsSync(dirPath)) continue;
        const keep = refs[dirName] || new Set();
        for (const name of fs.readdirSync(dirPath)) {
          if (keep.has(name)) continue;
          const fp = path.join(dirPath, name);
          try {
            const st = fs.statSync(fp);
            if (st.isFile()) { freedBytes += st.size; fs.unlinkSync(fp); freedCount++; }
          } catch (e) { /* ignore */ }
        }
      }
      return { ok: true, freedCount, freedBytes };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('backup:open-dir', async (e, dir) => {
    try {
      let target = dir;
      if (!target) target = path.join(app.getPath('userData'), 'backups');
      if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
      const err = await shell.openPath(target);
      return { ok: !err, error: err || '' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('dialog:pick-image', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择背景图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    try {
      const src = result.filePaths[0];
      const ext = (path.extname(src) || '.png').toLowerCase();
      const bgDir = path.join(app.getPath('userData'), 'backgrounds');
      if (!fs.existsSync(bgDir)) fs.mkdirSync(bgDir, { recursive: true });
      const name = 'bg-' + Date.now() + ext;
      const dest = path.join(bgDir, name);
      fs.copyFileSync(src, dest);
      return { ok: true, url: 'note-bg://local/' + encodeURIComponent(name) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('note:save-image', async (e, dataUrl) => {
    try {
      const m = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,(.+)$/.exec(String(dataUrl || ''));
      if (!m) return { ok: false, error: 'unsupported image' };
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
      const imgDir = path.join(app.getPath('userData'), 'images');
      if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
      const name = 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      fs.writeFileSync(path.join(imgDir, name), Buffer.from(m[2], 'base64'));
      return { ok: true, url: 'note-img://local/' + encodeURIComponent(name) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('dialog:pick-note-image', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    try {
      const src = result.filePaths[0];
      const ext = (path.extname(src) || '.png').toLowerCase();
      const imgDir = path.join(app.getPath('userData'), 'images');
      if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
      const name = 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
      fs.copyFileSync(src, path.join(imgDir, name));
      return { ok: true, url: 'note-img://local/' + encodeURIComponent(name) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('dialog:pick-font', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择字体文件',
      properties: ['openFile'],
      filters: [{ name: '字体文件', extensions: ['ttf', 'otf', 'woff', 'woff2'] }]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    try {
      const src = result.filePaths[0];
      const ext = (path.extname(src) || '.ttf').toLowerCase();
      const fontDir = path.join(app.getPath('userData'), 'fonts');
      if (!fs.existsSync(fontDir)) fs.mkdirSync(fontDir, { recursive: true });
      const id = 'cf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const family = 'CustomFont-' + id;
      const name = family + ext;
      fs.copyFileSync(src, path.join(fontDir, name));
      const baseName = path.basename(src, ext);
      return { ok: true, id, name: baseName, family, url: 'note-font://local/' + encodeURIComponent(name) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 桌面便签（独立窗口）
  ipcMain.handle('note:pin', (e, id) => {
    const data = readData();
    if (data && Array.isArray(data.notes)) {
      const note = data.notes.find((n) => n.id === id);
      if (note) {
        note.desktopPin = true;
        writeData(data);
      }
    }
    createDetachedWindow(id);
    return true;
  });
  ipcMain.handle('note:get', (e, id) => {
    const data = readData();
    if (data) {
      const note = (data.notes || []).find((n) => n.id === id) || null;
      return { note, settings: data.settings || null };
    }
    return { note: null, settings: null };
  });
  ipcMain.handle('note:update', (e, note) => {
    const data = readData() || { settings: {}, groups: [], notes: [] };
    data.notes = (data.notes || []).map((n) => (n.id === note.id ? note : n));
    writeData(data);
    scheduleReminders(data.notes);
    if (mainWindow) mainWindow.webContents.send('note:changed', note);
    return true;
  });
  ipcMain.handle('note:unpin', (e, id) => {
    const win = detachedWindows.get(id);
    if (win) win.close();
    else if (mainWindow) mainWindow.webContents.send('note:unpinned', id);
    return true;
  });
  ipcMain.handle('note:close-all', () => {
    detachedWindows.forEach((w) => w.close());
    detachedWindows.clear();
    return true;
  });
  ipcMain.handle('open-external', async (e, url) => {
    try {
      if (typeof url !== 'string' || !url.trim()) return false;
      let u = url.trim();
      if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(u)) u = 'http://' + u;
      await shell.openExternal(u);
      return true;
    } catch (err) {
      return false;
    }
  });

  ipcMain.handle('note:show-menu', (e, opts) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const colorIcon = (hex) => {
      try {
        const h = String(hex || '').replace('#', '');
        if (h.length < 6) return null;
        const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
        const size = 16;
        const buf = Buffer.alloc(size * size * 4);
        for (let i = 0; i < size * size; i++) { buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = 255; }
        return nativeImage.createFromBuffer(buf, { width: size, height: size }).resize({ width: 14, height: 14 });
      } catch (err) { return null; }
    };
    return new Promise((resolve) => {
      const template = [];
      template.push({ label: '复制', click: () => resolve({ action: 'copy' }) });
      template.push({ label: '粘贴', click: () => resolve({ action: 'paste' }) });
      template.push({ type: 'separator' });
      const textColors = (opts.textColors || []).map((c) => {
        const icon = colorIcon(c);
        return { label: c, icon: icon || undefined, click: () => resolve({ action: 'text-color', color: c }) };
      });
      template.push({ label: '文字颜色', submenu: textColors });
      const noteColors = (opts.noteColors || []).map((c) => {
        const icon = colorIcon(c);
        return { label: c, icon: icon || undefined, click: () => resolve({ action: 'note-color', color: c }) };
      });
      template.push({ label: '便签底色', submenu: noteColors });
      const menu = Menu.buildFromTemplate(template);
      menu.popup({ window: win, x: Math.round(opts.x || 0), y: Math.round(opts.y || 0), callback: () => resolve({ action: 'cancel' }) });
    });
  });

  ipcMain.handle('clipboard:read-text', () => clipboard.readText());
  ipcMain.handle('clipboard:read-image', () => clipboardImageToDataUrl());
  ipcMain.handle('clipboard:write-text', (e, text) => {
    clipboard.writeText(String(text || ''));
    return true;
  });
  ipcMain.handle('clipboard:write-image', (e, src) => {
    try {
      const u = String(src || '');
      if (u.indexOf('note-img://local/') === 0) {
        const name = path.basename(decodeURIComponent(u.slice('note-img://local/'.length)));
        const file = path.join(app.getPath('userData'), 'images', name);
        if (fs.existsSync(file)) {
          clipboard.writeImage(nativeImage.createFromPath(file));
          return true;
        }
      }
      return false;
    } catch (err) {
      return false;
    }
  });

  // 文件/文件夹路径识别
  ipcMain.handle('clipboard:read-files', () => {
    const out = [];
    const readBuf = (format, encoding) => {
      try {
        const buf = clipboard.readBuffer(format);
        if (buf && buf.length) {
          const str = buf.toString(encoding);
          str.split('\0').forEach((p) => { if (p && p.length > 1 && !out.includes(p)) out.push(p); });
        }
      } catch (e) { /* ignore */ }
    };
    try {
      const buf = clipboard.readBuffer('CF_HDROP');
      if (buf && buf.length > 16) {
        const pFiles = buf.readUInt32LE(0);
        const fWide = buf.readUInt32LE(16) !== 0;
        const list = buf.slice(pFiles);
        const str = fWide ? list.toString('utf16le') : list.toString('latin1');
        str.split('\0').forEach((p) => { if (p && p.length > 1 && !out.includes(p)) out.push(p); });
      }
    } catch (e) { /* ignore */ }
    if (!out.length) readBuf('FileNameW', 'utf16le');
    return out;
  });

  ipcMain.handle('path:stat', (e, p) => {
    try {
      const st = fs.statSync(String(p || ''));
      return { exists: true, isDirectory: st.isDirectory(), isFile: st.isFile() };
    } catch (e) {
      return { exists: false };
    }
  });

  ipcMain.handle('file:open', async (e, p, isDir) => {
    try {
      const target = String(p || '');
      if (!target) return { ok: false, error: 'empty path' };
      const err = await shell.openPath(target);
      return { ok: !err, error: err || '' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('note:add-image-file', async (e, filePath) => {
    try {
      const src = String(filePath || '');
      const ext = (path.extname(src) || '.png').toLowerCase();
      const imgDir = path.join(app.getPath('userData'), 'images');
      if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
      const name = 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
      fs.copyFileSync(src, path.join(imgDir, name));
      return { ok: true, url: 'note-img://local/' + encodeURIComponent(name) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('note:delete', (e, id) => {
    const data = readData() || { settings: {}, groups: [], notes: [], trash: [] };
    const idx = (data.notes || []).findIndex((n) => n.id === id);
    if (idx >= 0) {
      const note = data.notes.splice(idx, 1)[0];
      note.desktopPin = false;
      data.trash = data.trash || [];
      data.trash.push({ note, deletedAt: Date.now() });
      writeData(data);
      scheduleReminders(data.notes);
    }
    const win = detachedWindows.get(id);
    if (win) win.close();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('note:deleted', id);
    return true;
  });

  ipcMain.handle('settings:set-font-size', (e, size) => {
    const data = readData() || { settings: {}, notes: [], groups: [], trash: [] };
    data.settings = data.settings || {};
    data.settings.fontSize = Math.min(22, Math.max(11, Number(size) || 14));
    writeData(data);
    const v = data.settings.fontSize;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:font-size', v);
    detachedWindows.forEach((w) => { if (w && !w.isDestroyed()) w.webContents.send('settings:font-size', v); });
    return v;
  });

  ipcMain.handle('dialog:pick-sound', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择闹铃声音',
      properties: ['openFile'],
      filters: [{ name: '音频文件', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'] }]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    try {
      const src = result.filePaths[0];
      const ext = (path.extname(src) || '.mp3').toLowerCase();
      const sndDir = path.join(app.getPath('userData'), 'sounds');
      if (!fs.existsSync(sndDir)) fs.mkdirSync(sndDir, { recursive: true });
      const name = 'snd-' + Date.now() + ext;
      fs.copyFileSync(src, path.join(sndDir, name));
      return { ok: true, name: path.basename(src), url: 'note-sound://local/' + encodeURIComponent(name) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 自动更新触发
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) return { ok: false, error: 'dev' };
    try {
      const result = await autoUpdater.checkForUpdates();
      return { ok: true, isUpdateAvailable: !!(result && result.isUpdateAvailable) };
    } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
  });
  ipcMain.handle('update:download', async () => {
    try { autoUpdater.downloadUpdate(); return { ok: true }; }
    catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
  });
  ipcMain.handle('update:install', async () => {
    try {
      // 先置退出标志并真正销毁所有窗口/托盘，
      // 避免进程仍驻留占用 exe，导致 NSIS 安装器报「便签无法关闭」
      isQuitting = true;
      for (const win of detachedWindows.values()) {
        if (!win.isDestroyed()) win.destroy();
      }
      detachedWindows.clear();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
      if (tray) tray.destroy();
      autoUpdater.quitAndInstall();
      return { ok: true };
    } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
  });

  // Window controls
  ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.on('window:hide', () => mainWindow && mainWindow.hide());
  ipcMain.on('window:close', () => mainWindow && mainWindow.hide());
  ipcMain.on('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:always-on-top', (e, flag) => {
    if (mainWindow) mainWindow.setAlwaysOnTop(!!flag);
  });
  ipcMain.on('window:set-opacity', (e, opacity) => {
    const srcWin = BrowserWindow.fromWebContents(e.sender);
    if (srcWin) srcWin.setOpacity(opacity);
    detachedWindows.forEach((w) => {
      if (w && !w.isDestroyed()) w.setOpacity(opacity);
    });
  });
  ipcMain.on('window:set-self-opacity', (e, opacity) => {
    const srcWin = BrowserWindow.fromWebContents(e.sender);
    if (srcWin) srcWin.setOpacity(opacity);
  });
  ipcMain.on('window:set-note-opacity', (e, opacity) => {
    detachedWindows.forEach((w) => {
      if (w && !w.isDestroyed()) w.webContents.send('window:note-opacity', opacity);
    });
  });
  ipcMain.on('window:set-effects', (e, fx) => {
    const srcWin = BrowserWindow.fromWebContents(e.sender);
    if (srcWin === mainWindow) {
      detachedWindows.forEach((w) => {
        if (w && !w.isDestroyed()) {
          w.webContents.send('window:effects', fx);
          if (typeof w.setBackgroundMaterial === 'function') {
            try {
              if (fx && fx.desktopMica) {
                w.setBackgroundMaterial('acrylic');
              } else {
                w.setBackgroundMaterial('none');
              }
            } catch (err) { /* ignore */ }
          }
        }
      });
    }
  });
  ipcMain.handle('window:toggle', () => {
    toggleWindow();
    return mainWindow && mainWindow.isVisible();
  });
}

// ---- App lifecycle ----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showWindow();
  });

  app.whenReady().then(() => {
    const dataDir = path.dirname(dataPath());
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    protocol.handle('note-bg', (request) => {
      try {
        const url = new URL(request.url);
        const name = path.basename(url.pathname);
        const file = path.join(app.getPath('userData'), 'backgrounds', name);
        return net.fetch(pathToFileURL(file).toString());
      } catch (e) {
        return new Response('Not Found', { status: 404 });
      }
    });

    protocol.handle('note-img', (request) => {
      try {
        const url = new URL(request.url);
        const name = path.basename(url.pathname);
        const file = path.join(app.getPath('userData'), 'images', name);
        return net.fetch(pathToFileURL(file).toString());
      } catch (e) {
        return new Response('Not Found', { status: 404 });
      }
    });

    protocol.handle('note-font', (request) => {
      try {
        const url = new URL(request.url);
        const name = path.basename(url.pathname);
        const file = path.join(app.getPath('userData'), 'fonts', name);
        return net.fetch(pathToFileURL(file).toString());
      } catch (e) {
        return new Response('Not Found', { status: 404 });
      }
    });

    protocol.handle('note-sound', (request) => {
      try {
        const url = new URL(request.url);
        const name = path.basename(url.pathname);
        const file = path.join(app.getPath('userData'), 'sounds', name);
        return net.fetch(pathToFileURL(file).toString());
      } catch (e) {
        return new Response('Not Found', { status: 404 });
      }
    });

    setupIpc();
    setupAutoUpdate();
    createWindow();
    createTray();

    const initial = readData();
    if (initial && Array.isArray(initial.notes)) {
      scheduleReminders(initial.notes);
      initial.notes.forEach((n) => {
        if (n.desktopPin) createDetachedWindow(n.id);
      });
    }
    checkOverdueReminders();

    powerMonitor.on('resume', () => {
      checkOverdueReminders();
    });
    powerMonitor.on('unlock-screen', () => {
      checkOverdueReminders();
    });

    globalShortcut.register('CommandOrControl+Shift+N', () => {
      showWindow();
      mainWindow.webContents.send('note:create');
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  app.on('window-all-closed', () => {
    // 常驻托盘，不退出
  });

  app.on('before-quit', () => {
    isQuitting = true;
    globalShortcut.unregisterAll();
    stopPowerSaver();
  });
}
