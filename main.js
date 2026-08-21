const { app, BrowserWindow, ipcMain, dialog, Notification, Tray, Menu, nativeImage, globalShortcut, screen, protocol, net, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const isDev = !app.isPackaged;

let mainWindow = null;
let tray = null;
let isQuitting = false;
let reminderTimer = null;
const recentlyFired = new Set();
const detachedWindows = new Map();

const dataPath = () => path.join(app.getPath('userData'), 'notes-data.json');

function readData() {
  try {
    const raw = fs.readFileSync(dataPath(), 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function writeData(data) {
  fs.writeFileSync(dataPath(), JSON.stringify(data, null, 2), 'utf-8');
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
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

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
  const win = new BrowserWindow({
    width: 300,
    height: 240,
    minWidth: 220,
    minHeight: 150,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    hasShadow: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'note.html'), { query: { id: noteId } });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.on('focus', () => win.setAlwaysOnTop(true, 'screen-saver'));
  win.on('show', () => win.setAlwaysOnTop(true, 'screen-saver'));
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

  if (upcoming.length === 0) return;

  const next = upcoming[0];
  const delay = Math.max(1000, next.at - now);

  reminderTimer = setTimeout(() => {
    fireReminder(next);
  }, delay);
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
      silent: false
    });
    n.on('click', () => showWindow());
    n.show();
  }

  if (mainWindow) {
    showWindow();
    mainWindow.flashFrame(true);
    setTimeout(() => mainWindow.flashFrame(false), 4000);
    mainWindow.webContents.send('reminder:fired', note.id);
  }

  scheduleReminders(readDataNotes());
}

function readDataNotes() {
  const data = readData();
  return data ? data.notes || [] : [];
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
        { name: '文本文件', extensions: ['txt'] }
      ]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      if (result.filePath.endsWith('.txt')) {
        const lines = data.notes.map((n) => {
          const body = n.type === 'todo'
            ? (n.items || []).map((i) => `${i.done ? '[x]' : '[ ]'} ${i.text}`).join('\n')
            : n.content;
          return `◆ ${n.title}\n${body}\n---`;
        }).join('\n\n');
        fs.writeFileSync(result.filePath, lines, 'utf-8');
      } else {
        fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
      }
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('data:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入便签',
      properties: ['openFile'],
      filters: [{ name: 'JSON 备份', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    try {
      const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
      const data = JSON.parse(raw);
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
      let target = dir;
      if (!target) target = path.join(app.getPath('userData'), 'backups');
      if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
      const stamp = new Date();
      const pad = (x) => String(x).padStart(2, '0');
      const name = `便签备份-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.json`;
      const file = path.join(target, name);
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
      return { ok: true, path: file };
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

  ipcMain.handle('clipboard:read-text', () => clipboard.readText());
  ipcMain.handle('clipboard:read-image', () => clipboardImageToDataUrl());
  ipcMain.handle('clipboard:write-text', (e, text) => {
    clipboard.writeText(String(text || ''));
    return true;
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
    if (mainWindow) mainWindow.setOpacity(opacity);
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

    setupIpc();
    createWindow();
    createTray();

    const initial = readData();
    if (initial && Array.isArray(initial.notes)) {
      scheduleReminders(initial.notes);
      initial.notes.forEach((n) => {
        if (n.desktopPin) createDetachedWindow(n.id);
      });
    }

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
  });
}
