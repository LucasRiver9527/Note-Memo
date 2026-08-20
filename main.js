const { app, BrowserWindow, ipcMain, dialog, Notification, Tray, Menu, nativeImage, globalShortcut, screen, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
#
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
  const title = note.title ? note.title : '便签提醒';
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
  ipcMain.handle('open-external', (e, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
      return true;
    }
    return false;
  });

  // Window controls
  ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.on('window:hide', () => mainWindow && mainWindow.hide());
  ipcMain.on('window:close', () => mainWindow && mainWindow.hide());
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
