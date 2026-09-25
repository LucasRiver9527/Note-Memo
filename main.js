const { app, BrowserWindow, ipcMain, dialog, Notification, Tray, Menu, nativeImage, globalShortcut, screen, protocol, net, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const logic = require('./renderer/logic.js');
const Shortcuts = require('./renderer/shortcuts.js');
const DataIO = require('./data-io.js');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;

// dev 下启动即校验 IPC 契约：renderer 用到的 channel 在 main 是否都有实现，缺一直接抛错，避免静默失效。
// ipc-contract.js 是开发专用模块，不随安装包分发（build files 不含它），故只在 dev / 显式开启时 require，避免打包后找不到模块。
if (isDev || process.env.MYNOTES_CHECK_IPC === '1') {
  const { checkIpcContract } = require('./ipc-contract.js');
  const contract = checkIpcContract(__dirname);
  if (!contract.ok) {
    const detail = [
      contract.missingHandlers.length ? '缺 handler: ' + contract.missingHandlers.join(', ') : '',
      contract.missingSenders.length ? '缺 sender: ' + contract.missingSenders.join(', ') : ''
    ].filter(Boolean).join('; ');
    console.error('[ipc-contract] 校验失败：', detail);
    throw new Error('IPC contract check failed: ' + detail);
  }
}

// e2e 测试用独立 userData 隔离数据（未设置则用默认目录）
if (process.env.MYNOTES_USER_DATA) {
  try { app.setPath('userData', process.env.MYNOTES_USER_DATA); } catch (e) { /* ignore */ }
}

let mainWindow = null;
let tray = null;
let isQuitting = false;
let reminderTimer = null;
const recentlyFired = new Set();
const detachedWindows = new Map();

const dataPath = () => path.join(app.getPath('userData'), 'notes-data.json');

function clipboardImageToDataUrl() {
  const img = clipboard.readImage();
  if (!img.isEmpty()) return img.toDataURL();

  let filePath = null;
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
  if (!filePath) {
    try {
      const buf = clipboard.readBuffer('FileNameW');
      if (buf && buf.length) {
        const str = buf.toString('utf16le');
        filePath = str.split('\0').find((p) => p && p.length > 1);
      }
    } catch (e) { /* ignore */ }
  }
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

// 数据健康状态：'ok' | 'first-run' | 'recovered' | 'corrupt'（null 表示尚未读取过）
// 一旦判定为 corrupt 就锁定写入，直到成功落盘一次才解除（data:save 可带 force 主动解锁）。
// 缓存状态同时避免了 readData 被 17 处反复调用时重复生成留证文件、重复打日志。
let _dataStatus = null;
let _corruptPath = null;

function dataHealth() {
  return { status: _dataStatus || 'unknown', corruptPath: _corruptPath };
}

function isDataLocked() {
  return _dataStatus === 'corrupt';
}

function readData() {
  // 已判定损坏：直接返回 null，不再读盘，避免每次调用都新增一份留证
  if (_dataStatus === 'corrupt') return null;
  const r = DataIO.safeRead(dataPath());
  _dataStatus = r.status;
  _corruptPath = r.corruptPath || null;
  if (r.status === 'recovered') {
    console.warn('[data] 数据文件曾损坏，已从 .bak 自动恢复；损坏件留证于：', r.corruptPath);
  }
  return r.data;
}

// 返回 true 表示已落盘。data 损坏锁定时拒绝写入（force 可越过锁，供「导入备份」自救）。
function writeData(data, opts) {
  const force = !!(opts && opts.force);
  if (_dataStatus === 'corrupt' && !force) {
    console.error('[data] 已锁定写入：数据文件损坏且无可用 .bak，拒绝覆盖以保护用户数据');
    return false;
  }
  const ok = DataIO.atomicWrite(dataPath(), data);
  if (ok) {
    // 成功落盘说明磁盘上已是合法 JSON，解除锁定
    _dataStatus = 'ok';
    _corruptPath = null;
  }
  return ok;
}

// ---- 窗口状态持久化：把 bounds / maximized 记到数据文件的 settings.windowState ----
// （放在 settings 里是因为 renderer 的 data:save 只写 {settings,groups,notes,trash}，顶层键会被覆盖）
function readWindowState() {
  const data = readData();
  const ws = data && data.settings && data.settings.windowState;
  if (ws && ws.normalBounds && typeof ws.normalBounds.width === 'number') return ws;
  return null;
}

let winStateTimer = null;
function persistWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  clearTimeout(winStateTimer);
  winStateTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      const normal = mainWindow.getNormalBounds();
      const state = {
        normalBounds: { x: normal.x, y: normal.y, width: normal.width, height: normal.height },
        maximized: mainWindow.isMaximized()
      };
      // 数据不可用时直接放弃：绝不能用 {} 兜底，否则会把整个数据文件覆盖成只剩 windowState
      const data = readData();
      if (!data) return;
      data.settings = data.settings || {};
      data.settings.windowState = state;
      writeData(data);
    } catch (e) { /* ignore */ }
  }, 300);
}


function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const saved = readWindowState();
  const nb = (saved && saved.normalBounds) || null;
  // 用保存的普通尺寸；若之前最大化，仍先按普通尺寸创建再 restore，避免越界
  const winW = (nb && nb.width) || 1080;
  const winH = (nb && nb.height) || 720;
  let startX = (nb && typeof nb.x === 'number') ? nb.x : Math.round((width - winW) / 2);
  let startY = (nb && typeof nb.y === 'number') ? nb.y : Math.round((height - winH) / 2);
  // 防越界：窗口至少一部分落在工作区内
  if (startX + winW < 0 || startX > width) startX = Math.round((width - winW) / 2);
  if (startY + winH < 0 || startY > height) startY = Math.round((height - winH) / 2);

  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    minWidth: 640,
    minHeight: 420,
    x: startX,
    y: startY,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#c8c8c8',
      height: 50
    },
    backgroundColor: '#00000000',
    resizable: true,
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      additionalArguments: ['--app-version=' + app.getVersion()]
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('maximize', () => { mainWindow.webContents.send('window:maximized', true); persistWindowState(); });
  mainWindow.on('unmaximize', () => { mainWindow.webContents.send('window:maximized', false); persistWindowState(); });
  mainWindow.on('resize', persistWindowState);
  mainWindow.on('move', persistWindowState);
  mainWindow.on('hide', persistWindowState);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // 恢复最大化状态（还原到最大化前尺寸 max；若最大化失败则保持普通）
    if (saved && saved.maximized) {
      try { mainWindow.maximize(); } catch (e) { /* ignore */ }
    }
  });

  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    // 弹窗询问：退出应用 还是 隐藏到任务栏（托盘常驻）
    e.preventDefault();
    requestCloseMainWindow();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 关闭主窗口时的选择：请 renderer 弹主题化选择框（彻底退出 / 隐藏到任务栏 / 取消）
// 结果经 ipc 'window:close-decision' 回传（'hide' | 'quit' | 'cancel'），避免使用系统原生对话框（与主题不符）。
function requestCloseMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send('window:close-request');
  } catch (e) { /* ignore */ }
}

// 处理 renderer 回传的关闭决定
function handleCloseDecision(decision) {
  if (decision === 'quit') {
    isQuitting = true;
    app.quit();
  } else if (decision === 'hide') {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  }
  // 'cancel' → 什么都不做
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
      nodeIntegration: false,
      additionalArguments: ['--app-version=' + app.getVersion()]
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'note.html'), { query: { id: noteId } });
  win.setAlwaysOnTop(true, 'screen-saver');
  // 桌面便签玻璃拟态：Windows 11 亚克力材质，提供背后桌面的磨砂模糊
  if (process.platform === 'win32' && typeof win.setBackgroundMaterial === 'function') {
    const data = readData();
    const desktopMica = data && data.settings && data.settings.desktopMica;
    try { win.setBackgroundMaterial(desktopMica ? 'acrylic' : 'none'); } catch (e) { /* ignore */ }
  }
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
  // 之前是最小化：先 restore，恢复最大化/原尺寸状态，再显示
  if (mainWindow.isMinimized()) mainWindow.restore();
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
    // 播报闹铃声音：把声音设置传给渲染进程播放（preload 监听 reminder:sound）
    const data = readData();
    const s = (data && data.settings) || {};
    mainWindow.webContents.send('reminder:sound', {
      enabled: !!s.reminderSound,
      path: s.reminderSoundPath || null,
      volume: s.reminderVolume != null ? s.reminderVolume : 70
    });
  }

  scheduleReminders(readDataNotes());
}

function readDataNotes() {
  const data = readData();
  return data ? data.notes || [] : [];
}

// ---- IPC ----
function setupIpc() {
  // 返回 { data, status, corruptPath }：
  //   data  —— 数据对象；首次运行或损坏不可读时为 null
  //   status—— 'ok' | 'first-run' | 'recovered' | 'corrupt'
  // 渲染层据此区分「首次运行」与「损坏」，损坏时进入只读并引导导入备份。
  ipcMain.handle('data:load', () => {
    const data = readData();
    const health = dataHealth();
    return { data: data || null, status: health.status, corruptPath: health.corruptPath };
  });

  // 只读通道：单独查询数据健康状态（供渲染层随时重查，无需重新读盘）。
  ipcMain.handle('data:health', () => {
    return dataHealth();
  });

  // opts.force 仅供「导入备份」等自救路径越过损坏锁使用。
  // 校验失败 / 写入被锁时「抛错」而非返回 false：渲染层 save()/saveNow() 只挂了
  // .catch(reportSaveError)，不检查 resolved 值，返回 false 会导致静默失败、用户以为已保存。
  ipcMain.handle('data:save', (e, data, opts) => {
    if (!DataIO.isValidDataShape(data)) {
      throw new Error('invalid data shape: 拒绝写入非法数据结构，以保护现有存档');
    }
    const ok = writeData(data, opts);
    if (!ok) {
      throw new Error(isDataLocked() ? '数据文件损坏且无可用备份，已锁定写入' : '数据写入失败');
    }
    if (Array.isArray(data.notes)) {
      // 重新武装的提醒（fired=false 且启用的便签）允许再次调度——解除最近触发标记（「稍后再响」依赖此机制）。
      data.notes.forEach((n) => {
        if (n && n.reminder && n.reminder.enabled && !n.reminder.fired) recentlyFired.delete(n.id);
      });
      scheduleReminders(data.notes);
    }
    // 设置变更（含快捷键）后同步全局快捷键；失败仅记录，不阻塞保存
    if (data.settings && typeof data.settings === 'object') {
      const reg = registerGlobalShortcuts(data.settings);
      if (reg.failures.length) console.warn('[shortcuts] 注册失败:', reg.failures.join(','));
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

  ipcMain.handle('note:export-markdown', async (e, md, suggestName) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出为 Markdown',
      defaultPath: suggestName || `便签-${new Date().toISOString().slice(0, 10)}.md`,
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: '文本文件', extensions: ['txt'] }
      ]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(result.filePath, md, 'utf-8');
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

  ipcMain.handle('dialog:choose-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择备份目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle('dialog:pick-sound', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择声音文件',
      properties: ['openFile'],
      filters: [{ name: '音频', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    try {
      const src = result.filePaths[0];
      const ext = (path.extname(src) || '.mp3').toLowerCase();
      const sndDir = path.join(app.getPath('userData'), 'sounds');
      if (!fs.existsSync(sndDir)) fs.mkdirSync(sndDir, { recursive: true });
      const name = 'snd-' + Date.now() + ext;
      fs.copyFileSync(src, path.join(sndDir, name));
      return { ok: true, url: 'note-sound://local/' + encodeURIComponent(name), name: path.basename(src, ext) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
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
    // 数据不可用时返回 false，让渲染层知道未落盘，避免「显示已保存但磁盘是空的」
    const data = readData();
    if (!data) return false;
    data.notes = (data.notes || []).map((n) => (n.id === note.id ? note : n));
    const ok = writeData(data);
    // 重新武装的提醒允许再次调度（稍后再响）
    if (note && note.reminder && note.reminder.enabled && !note.reminder.fired) recentlyFired.delete(note.id);
    scheduleReminders(data.notes);
    if (mainWindow) mainWindow.webContents.send('note:changed', note);
    return ok;
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
  ipcMain.handle('note:delete', (e, id) => {
    const data = readData();
    if (!data) return false;
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
    const v = Math.min(22, Math.max(11, Number(size) || 14));
    // 数据不可用时只同步到窗口，不落盘：字号是次要偏好，不值得为它冒覆盖存档的风险
    const data = readData();
    if (data) {
      data.settings = data.settings || {};
      data.settings.fontSize = v;
      writeData(data);
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:font-size', v);
    detachedWindows.forEach((w) => { if (w && !w.isDestroyed()) w.webContents.send('settings:font-size', v); });
    return v;
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
      // 透明度：预设子菜单（原生菜单不支持拖拽滑块，用预设档位调节），作用于当前便签（单张）
      template.push({ type: 'separator' });
      const curOpacity = (opts.noteOpacity != null) ? Math.round(opts.noteOpacity) : 100;
      const opacities = [100, 85, 70, 55, 40, 25];
      template.push({
        label: '透明度',
        submenu: opacities.map((v) => ({
          label: v + '%',
          type: 'radio',
          checked: Math.round(curOpacity) === v,
          click: () => resolve({ action: 'note-opacity', value: v })
        }))
      });
      const menu = Menu.buildFromTemplate(template);
      menu.popup({ window: win, x: Math.round(opts.x || 0), y: Math.round(opts.y || 0), callback: () => resolve({ action: 'cancel' }) });
    });
  });
  ipcMain.handle('open-external', (e, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
      return true;
    }
    return false;
  });

  ipcMain.handle('media:cleanup-orphans', async () => {
    try {
      // 数据不可用时必须拒绝清理：空骨架会让引用集为空，导致 images/backgrounds/fonts/sounds
      // 下所有媒体文件被 unlinkSync 永久删除（不进回收站）。即便日后从 .bak 恢复出便签数据，
      // 图片也已丢失，全部便签集体破图。
      const data = readData();
      if (!data || isDataLocked()) {
        return { ok: false, error: '数据文件不可用，已跳过清理以保护媒体文件' };
      }
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

  // ---- 开机自启动 ----
  ipcMain.handle('startup:get', () => {
    try {
      const s = app.getLoginItemSettings();
      return { ok: true, enabled: !!s.openAtLogin };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });
  ipcMain.handle('startup:set', (e, enabled) => {
    try {
      app.setLoginItemSettings({ openAtLogin: !!enabled, path: process.execPath });
      return { ok: true, enabled: !!app.getLoginItemSettings().openAtLogin };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  // ---- 全局快捷键 ----
  ipcMain.handle('shortcuts:get', () => {
    try {
      return { ok: true, ...getShortcutsPayload() };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });
  ipcMain.handle('shortcuts:set', (e, overrides) => {
    try {
      // 覆盖项对象（{ id: accel }）；设空值即恢复默认（从 settings 里移除该 id）
      const clean = {};
      Object.entries(overrides && typeof overrides === 'object' ? overrides : {}).forEach(([id, accel]) => {
        if (accel && Shortcuts.isValidAccelerator(accel)) clean[id] = accel;
      });
      // 数据不可用时只在本次运行内生效、不落盘，避免用 {} 覆盖整个数据文件
      const data = readData();
      let persisted = false;
      if (data) {
        data.settings = data.settings || {};
        data.settings.shortcuts = clean;
        persisted = writeData(data);
      }
      // effectiveShortcuts 只读 settings.shortcuts，故这里包一层，形状与原实现一致；
      // 数据不可用时也能让新键位在本次运行内立即生效
      const reg = registerGlobalShortcuts({ shortcuts: clean });
      return { ok: true, overrides: clean, failures: reg.failures, persisted };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  // ---- 自动更新 ----
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
  ipcMain.on('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:hide', () => mainWindow && mainWindow.hide());
  ipcMain.on('window:close', () => requestCloseMainWindow());
  ipcMain.on('window:close-decision', (e, decision) => handleCloseDecision(decision));
  ipcMain.on('window:always-on-top', (e, flag) => {
    if (mainWindow) mainWindow.setAlwaysOnTop(!!flag);
  });
  ipcMain.on('window:set-opacity', (e, opacity) => {
    if (mainWindow) mainWindow.setOpacity(opacity);
  });
  // 自定义背景图/明暗变化时同步原生窗口控制按钮(─ □ ✕)的符号颜色，避免亮背景上看不清
  ipcMain.on('window:set-controls', (e, opts) => {
    const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
    if (!win || !win.setTitleBarOverlay) return;
    const symbolColor = (opts && opts.symbolColor) || '#c8c8c8';
    try {
      win.setTitleBarOverlay({ color: '#00000000', symbolColor, height: 50 });
    } catch (err) { /* 非标题栏覆盖窗口忽略 */ }
  });
  ipcMain.on('window:set-self-opacity', (e, opacity) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && !win.isDestroyed()) win.setOpacity(opacity);
  });
  ipcMain.on('window:set-note-opacity', (e, opacity) => {
    detachedWindows.forEach((w) => {
      if (w && !w.isDestroyed()) w.webContents.send('window:note-opacity', opacity);
    });
  });
  // 钉窗右键菜单「便签透明度」滑杆：持久化全局 noteOpacity 并同步主窗口（复用到所有便签卡片）
  ipcMain.on('note:save-note-opacity', (e, opacity) => {
    // 数据不可用时只同步到窗口、不落盘，避免用 {} 覆盖整个数据文件
    const data = readData();
    if (data) {
      data.settings = data.settings || {};
      data.settings.noteOpacity = opacity;
      writeData(data);
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('window:note-opacity-setting', opacity);
  });
  ipcMain.on('window:set-effects', (e, fx) => {
    const srcWin = BrowserWindow.fromWebContents(e.sender);
    if (srcWin === mainWindow) {
      detachedWindows.forEach((w) => {
        if (w && !w.isDestroyed()) {
          w.webContents.send('window:effects', fx);
          if (typeof w.setBackgroundMaterial === 'function') {
            try {
              w.setBackgroundMaterial(fx && fx.desktopMica ? 'acrylic' : 'none');
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

// ---- 全局快捷键 ----
// 从 settings（短期由 renderer 持久化到数据文件）注册「唤起/隐藏窗口」「新建便签」两个全局快捷键。
// 返回 { failures: [id...] }，方便 renderer 把注册失败（被其它应用占用）提示给用户。
function registerGlobalShortcuts(settings) {
  const failures = [];
  const accels = Shortcuts.effectiveShortcuts(settings);
  const spec = [
    { id: 'toggleWindow', accel: accels.toggleWindow, cb: () => toggleWindow() },
    { id: 'createNote', accel: accels.createNote, cb: () => { showWindow(); if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('note:create'); } }
  ];
  // 先清掉所有旧的全局快捷键（含用户改绑过的旧加速键），避免残留旧绑定导致新注册失败
  try { globalShortcut.unregisterAll(); } catch (e) { /* ignore */ }
  // 注册单个加速键：失败重试一次（Electron 偶发因窗口/焦点时序失败，重试可消解）
  const tryRegister = (accel, cb) => {
    try {
      if (globalShortcut.register(accel, cb)) return true;
    } catch (e) { /* ignore */ }
    return false;
  };
  spec.forEach(({ id, accel, cb }) => {
    if (!accel) return;
    if (!Shortcuts.isValidAccelerator(accel)) { failures.push(id); return; }
    let ok = tryRegister(accel, cb);
    if (!ok) ok = tryRegister(accel, cb);
    if (!ok) failures.push(id);
  });
  return { failures };
}

// 读取快捷键设置（settings.shortcuts，只含用户覆盖，默认由 shortcuts.js 兜底）+ 默认表，供设置面板渲染
function getShortcutsPayload() {
  const data = readData() || {};
  const settings = data.settings || {};
  return {
    overrides: settings.shortcuts || {},
    defaults: Shortcuts.buildDefaultShortcuts(),
    globalFailures: [] // 由每次注册时返回
  };
}

function setupAutoUpdate() {
  if (!app.isPackaged) return;
  if (process.env.MYNOTES_DISABLE_AUTOUPDATE === '1') return;
  try {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    // 固定走稳定通道：若版本号带 -preview 等预发布段，electron-updater 会自动 allowPrerelease=true
    // 并把预发布段（如 preview）当作更新通道，导致永远收不到稳定版更新（v1.2.5 发布时踩到）。
    // 显式锁定稳定通道：预发布构建也能升级到稳定版，不再被卡在 preview 通道。
    autoUpdater.allowPrerelease = false;
    autoUpdater.channel = 'latest';
    autoUpdater.on('error', (e) => { console.error('[update] error:', e && e.message); });
    autoUpdater.on('update-available', (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:available', info);
    });
    autoUpdater.on('update-downloaded', (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:downloaded', info);
    });
    if (process.env.MYNOTES_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.MYNOTES_UPDATE_URL });
    autoUpdater.checkForUpdates().catch((e) => console.error('[update] check failed:', e && e.message));
  } catch (e) {
    console.error('[update] init failed:', e);
  }
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
        if (!fs.existsSync(file)) return new Response('Not Found', { status: 404 });
        return net.fetch(pathToFileURL(file).toString()).catch(() => new Response('Not Found', { status: 404 }));
      } catch (e) {
        return new Response('Not Found', { status: 404 });
      }
    });

    protocol.handle('note-img', (request) => {
      try {
        const url = new URL(request.url);
        const name = path.basename(url.pathname);
        const file = path.join(app.getPath('userData'), 'images', name);
        if (!fs.existsSync(file)) return new Response('Not Found', { status: 404 });
        return net.fetch(pathToFileURL(file).toString()).catch(() => new Response('Not Found', { status: 404 }));
      } catch (e) {
        return new Response('Not Found', { status: 404 });
      }
    });

    protocol.handle('note-font', (request) => {
      try {
        const url = new URL(request.url);
        const name = path.basename(url.pathname);
        const file = path.join(app.getPath('userData'), 'fonts', name);
        if (!fs.existsSync(file)) return new Response('Not Found', { status: 404 });
        return net.fetch(pathToFileURL(file).toString()).catch(() => new Response('Not Found', { status: 404 }));
      } catch (e) {
        return new Response('Not Found', { status: 404 });
      }
    });

    protocol.handle('note-sound', (request) => {
      try {
        const url = new URL(request.url);
        const name = path.basename(url.pathname);
        const file = path.join(app.getPath('userData'), 'sounds', name);
        if (!fs.existsSync(file)) return new Response('Not Found', { status: 404 });
        return net.fetch(pathToFileURL(file).toString()).catch(() => new Response('Not Found', { status: 404 }));
      } catch (e) {
        return new Response('Not Found', { status: 404 });
      }
    });

    setupIpc();
    createWindow();
    createTray();
    setupAutoUpdate();

    const initial = readData();
    if (initial && Array.isArray(initial.notes)) {
      scheduleReminders(initial.notes);
      initial.notes.forEach((n) => {
        if (n.desktopPin) createDetachedWindow(n.id);
      });
    }

    // 从持久化设置注册全局快捷键（缺省用 shortcuts.js 默认，避免与系统默认冲突）
    const reg = registerGlobalShortcuts(initial ? (initial.settings || {}) : {});
    if (reg.failures.length) console.warn('[shortcuts] 启动注册失败:', reg.failures.join(','));

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
