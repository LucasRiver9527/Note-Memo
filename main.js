const { app, BrowserWindow, ipcMain, dialog, Notification, Tray, Menu, nativeImage, globalShortcut, screen, protocol, net, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');
const logic = require('./renderer/logic.js');
const Shortcuts = require('./renderer/shortcuts.js');
const DataIO = require('./data-io.js');
const MediaProtocol = require('./media-protocol.js');
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
// 被导入替换作废的旧 WebContents；弱引用不阻止回收，同 ID 新窗口不会解除禁写状态。
const supersededDetached = new WeakSet();

// ---- P0-04 IPC 来源（provenance）校验 ----
// 每个渲染层 → 主进程的 ipcMain.handle/on 都必须先通过来源校验再进入正文：
//   - sender 必须是「当前主窗 webContents」或「当前注册的独立窗 webContents」，销毁/未注册/被导入作废的一律拒绝；
//   - 必须是该 sender 的顶层 frame（拒绝子框架）；
//   - frame URL 必须精确等于应用页面文件路径（index.html / note.html），用 fileURLToPath + path 相等比较，
//     而非前缀/子串匹配，因此 loadURL 到任意本地/远端/devtools 页面都会被拒绝；
//   - 独立窗 URL 的 ?id= 必须等于其注册的便签 id；
//   - 任一 getter 缺失/抛异常/已释放 → 失败关闭（拒绝）。
// 这是信任边界，不是功能白名单；合法的主窗/独立窗调用路径不受影响。
const APP_MAIN_PAGE = path.join(__dirname, 'renderer', 'index.html');
const APP_NOTE_PAGE = path.join(__dirname, 'renderer', 'note.html');

function isExpectedAppUrl(rawUrl, expectedPath) {
  if (typeof rawUrl !== 'string' || rawUrl === '') return false;
  let u;
  try { u = new URL(rawUrl); } catch (e) { return false; }
  if (u.protocol !== 'file:') return false;
  let file;
  try { file = fileURLToPath(u); } catch (e) { return false; }
  return path.normalize(file).toLowerCase() === path.normalize(expectedPath).toLowerCase();
}

function classifyRendererSource(event) {
  let sender = null;
  try { sender = event && event.sender; } catch (e) { return null; }
  if (!sender) return null;
  try { if (typeof sender.isDestroyed !== 'function' || sender.isDestroyed()) return null; } catch (e) { return null; }

  let role = null, expectedPage = null, noteId = null;
  try {
    if (mainWindow && !mainWindow.isDestroyed() && sender === mainWindow.webContents) { role = 'main'; expectedPage = APP_MAIN_PAGE; }
  } catch (e) { /* fall through to detached */ }
  if (!role) {
    try {
      for (const [id, win] of detachedWindows) {
        if (win && !win.isDestroyed() && sender === win.webContents) { role = 'note'; expectedPage = APP_NOTE_PAGE; noteId = id; break; }
      }
    } catch (e) { return null; }
  }
  if (!role) return null;
  try { if (supersededDetached.has(sender)) return null; } catch (e) { return null; }

  let frame = null;
  try { frame = event.senderFrame; } catch (e) { return null; }
  if (!frame) return null;
  let topFrame = null;
  try { topFrame = sender.mainFrame; } catch (e) { return null; }
  if (!topFrame || frame !== topFrame) return null;

  let frameUrl = null;
  try { frameUrl = frame.url; } catch (e) { return null; }
  if (!isExpectedAppUrl(frameUrl, expectedPage)) return null;
  if (role === 'note') {
    let qid = null;
    try { qid = new URL(frameUrl).searchParams.get('id'); } catch (e) { return null; }
    if (qid !== noteId) return null;
  }
  return { role, noteId, sender };
}

function unauthorizedError() {
  return new Error('unauthorized ipc source');
}

const RAW_HANDLE = ipcMain.handle.bind(ipcMain);
const RAW_ON = ipcMain.on.bind(ipcMain);

// invoke 通道：默认拒绝时抛通用错误（不泄露路径/数据）；显式 denyValue 的旧行为（如 note:update 的 false）保持不变。
// opts.noteScoped：来自独立窗时，首个参数对象的 id 必须等于该窗口注册的便签 id。
function guardedHandle(channel, handler, opts) {
  RAW_HANDLE(channel, async (event, ...args) => {
    const src = classifyRendererSource(event);
    if (!src) {
      if (opts && Object.prototype.hasOwnProperty.call(opts, 'denyValue')) return opts.denyValue;
      throw unauthorizedError();
    }
    if (opts && opts.noteScoped) {
      const target = args[0];
      const id = target && typeof target === 'object' ? target.id : null;
      if (src.role === 'note' && id !== src.noteId) {
        if (Object.prototype.hasOwnProperty.call(opts, 'denyValue')) return opts.denyValue;
        throw unauthorizedError();
      }
    }
    return handler(event, ...args);
  });
}

// send / sendSync 通道：拒绝时一律 event.returnValue = false 并返回，绝不让同步调用方阻塞；异步 send 会忽略该值。
function guardedOn(channel, handler, opts) {
  RAW_ON(channel, (event, ...args) => {
    const src = classifyRendererSource(event);
    if (!src) { event.returnValue = false; return; }
    if (opts && opts.noteScoped) {
      const target = args[0];
      const id = target && typeof target === 'object' ? target.id : null;
      if (src.role === 'note' && id !== src.noteId) { event.returnValue = false; return; }
    }
    return handler(event, ...args);
  });
}

const dataPath = () => path.join(app.getPath('userData'), 'notes-data.json');
const recoveryPath = () => path.join(app.getPath('userData'), 'notes-recovery.json');
let recoveryState = null;
let recoveryToken = 0;

function readRecovery() {
  if (recoveryState) return recoveryState;
  try {
    const parsed = JSON.parse(fs.readFileSync(recoveryPath(), 'utf8'));
    if (parsed.version !== 1 || !parsed.notes || typeof parsed.notes !== 'object' || Array.isArray(parsed.notes)) throw new Error('invalid recovery shape');
    recoveryState = parsed;
    recoveryToken = Math.max(0, Number(parsed.main && parsed.main.token) || 0,
      ...Object.values(parsed.notes).map((item) => Number(item && item.token) || 0));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[recovery] 草稿读取失败，原文件已保留：', err);
      return null;
    }
    recoveryState = { version: 1, main: null, notes: {} };
  }
  return recoveryState;
}

function writeRecovery(next) {
  const file = recoveryPath();
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    if (!next.main && !Object.keys(next.notes).length) fs.rmSync(file, { force: true });
    else {
      fs.writeFileSync(tmp, JSON.stringify(next), 'utf8');
      fs.renameSync(tmp, file);
    }
    recoveryState = next;
    return true;
  } catch (err) {
    console.error('[recovery] 草稿写入失败：', err);
    try { fs.rmSync(tmp, { force: true }); } catch (_) {}
    return false;
  }
}

function captureRecovery(kind, value) {
  if (kind === 'main' ? !DataIO.isValidDataShape(value) : !value || typeof value.id !== 'string') return false;
  const current = readRecovery();
  if (!current) return false;
  const token = ++recoveryToken;
  const next = { version: 1, main: current.main, notes: { ...current.notes } };
  if (kind === 'main') next.main = { token, data: value };
  else next.notes[value.id] = { token, note: value };
  return writeRecovery(next) ? token : false;
}

function clearRecovery(kind, id, token, savedData) {
  if (!token) return;
  const current = readRecovery();
  if (!current) return;
  const entry = kind === 'main' ? current.main : current.notes[id];
  if (!entry || entry.token !== token) return;
  // 主窗口草稿仍可能包含旧版独立便签；此时保留独立草稿供恢复时覆盖。
  if (kind === 'note' && current.main) return;
  const next = { version: 1, main: current.main, notes: { ...current.notes } };
  if (kind === 'main') {
    next.main = null;
    for (const [noteId, item] of Object.entries(next.notes)) {
      const savedNote = (savedData.notes || []).find((note) => note.id === noteId);
      if (savedNote && JSON.stringify(savedNote) === JSON.stringify(item.note)) delete next.notes[noteId];
    }
  }
  else delete next.notes[id];
  writeRecovery(next);
}

function recoveryCandidate(base) {
  const current = readRecovery();
  if (!current) return null;
  const source = current.main && DataIO.isValidDataShape(current.main.data) ? current.main.data : base;
  if (!source || !DataIO.isValidDataShape(source)) return null;
  const entries = Object.values(current.notes).filter((item) => item && item.note && typeof item.note.id === 'string');
  if (!current.main && !entries.length) return null;
  const candidate = JSON.parse(JSON.stringify(source));
  candidate.notes = candidate.notes || [];
  for (const item of entries) {
    const index = candidate.notes.findIndex((n) => n.id === item.note.id);
    if (index >= 0) candidate.notes[index] = item.note;
    else candidate.notes.push(item.note);
  }
  return candidate;
}

function openStartupPinned(data) {
  if (!data || !Array.isArray(data.notes)) return;
  scheduleReminders(data.notes);
  data.notes.forEach((note) => { if (note.desktopPin) createDetachedWindow(note.id); });
}

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


// P0-04：禁止渲染进程发起顶层导航/重定向与新窗口。应用页面从不需要用链接替换自身；
// 合法外部链接走 open-external，本地附件走 file:open。程序化 loadFile/loadURL 不触发这些事件，故不受影响。
function hardenWindowNavigation(win) {
  if (!win || win.isDestroyed()) return;
  try { win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); } catch (e) { /* ignore */ }
  const block = (event) => { event.preventDefault(); };
  win.webContents.on('will-navigate', block);
  win.webContents.on('will-redirect', block);
  // 子框架导航（Electron ≥26 支持）；旧版无此事件时注册也不会报错。
  win.webContents.on('will-frame-navigate', block);
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
  hardenWindowNavigation(mainWindow);

  mainWindow.on('maximize', () => { mainWindow.webContents.send('window:maximized', true); persistWindowState(); });
  mainWindow.on('unmaximize', () => { mainWindow.webContents.send('window:maximized', false); persistWindowState(); });
  mainWindow.on('resize', persistWindowState);
  mainWindow.on('move', persistWindowState);
  mainWindow.on('hide', persistWindowState);

  let initialShowPending = true;
  const showInitialWindow = () => {
    if (!initialShowPending || !mainWindow || mainWindow.isDestroyed()) return;
    initialShowPending = false;
    mainWindow.show();
    // 恢复最大化状态（还原到最大化前尺寸 max；若最大化失败则保持普通）
    if (saved && saved.maximized) {
      try { mainWindow.maximize(); } catch (e) { /* ignore */ }
    }
  };
  mainWindow.once('ready-to-show', showInitialWindow);
  // Windows 上透明窗口可能迟迟不触发 ready-to-show；页面加载完后兜底显示。
  // 共用一次性门闩，避免较晚的 ready-to-show 在用户隐藏窗口后再次 show()。
  mainWindow.webContents.once('did-finish-load', () => setTimeout(showInitialWindow, 150));

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

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
async function handleCloseDecision(decision) {
  if (decision === 'quit') {
    if (!(await flushDetachedNotes())) {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('window:save-failed');
      return;
    }
    isQuitting = true;
    app.quit();
  } else if (decision === 'hide') {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  }
  // 'cancel' → 什么都不做
}

function createDetachedWindow(noteId) {
  if (detachedWindows.has(noteId)) return detachedWindows.get(noteId);
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
  hardenWindowNavigation(win);
  win.noteLoadPromise = win.loadFile(path.join(__dirname, 'renderer', 'note.html'), { query: { id: noteId } });
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
    if (mainWindow && !win.notePinFailed && !win.suppressUnpin) mainWindow.webContents.send('note:unpinned', noteId);
  });
  return win;
}

async function flushDetachedNote(win) {
  if (!win || win.isDestroyed()) return true;
  try {
    // 静态脚本，只调用独立便签暴露的本地保存函数，不插入用户内容。
    return await win.webContents.executeJavaScript(
      'typeof window.flushNoteForClose === "function" && window.flushNoteForClose()'
    ) === true;
  } catch (err) {
    console.error('[note] 独立便签保存失败：', err);
    return false;
  }
}

async function flushDetachedNotes() {
  for (const win of detachedWindows.values()) {
    if (!(await flushDetachedNote(win))) return false;
  }
  return true;
}

// 显式整份替换（导入备份）成功落盘后，正在打开的独立便签仍持有被替换前的旧内容：
// 关闭这些陈旧窗口并按存档重开仍被钉住的便签，避免旧窗口随后 note:update 覆盖导入结果。
// 导入是整份替换，故协调所有仍在的独立窗（含被导入移除的 ID）；只在整份数据成功写入后调用，
// 写入失败时不动窗口、不清草稿。
async function reconcileDetachedAfterReplace(data) {
  const previous = Array.from(detachedWindows);
  // 先作废所有旧来源，再等待关窗；同 ID 新窗口不会解除旧来源的禁写状态。
  for (const [, win] of previous) {
    if (win.isDestroyed()) continue;
    supersededDetached.add(win.webContents);
    win.suppressUnpin = true;
  }
  for (const [id, win] of previous) {
    if (win.isDestroyed()) { detachedWindows.delete(id); continue; }
    const closed = new Promise((resolve) => win.once('closed', resolve));
    win.close();
    await closed;
  }
  // 整份替换已经落盘；旧主窗及未开窗便签的草稿也失效，不能在重启时回滚导入。
  writeRecovery({ version: 1, main: null, notes: {} });
  for (const n of data.notes || []) {
    if (!n || !n.desktopPin || detachedWindows.has(n.id)) continue;
    try {
      const w = createDetachedWindow(n.id);
      await w.noteLoadPromise;
    } catch (err) {
      console.error('[note] 导入后重开独立便签失败：', err);
    }
  }
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

// P0-04 phase2c：数值 IPC 入参的有限性/类型校验（绝不对任意值做 Number() 强转）。
// 只接受有限 number 或非空数字字符串；null/undefined/bool/array/object/空串/NaN/Infinity 一律返回 null。
function finiteNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
// 校验并夹取到 [min,max]；非法返回 null（调用方据此在产生任何副作用前拒绝）。
function clampFinite(v, min, max) {
  const n = finiteNumber(v);
  if (n === null) return null;
  return Math.max(min, Math.min(max, n));
}

// ---- IPC ----
function setupIpc() {
  // 返回 { data, status, corruptPath }：
  //   data  —— 数据对象；首次运行或损坏不可读时为 null
  //   status—— 'ok' | 'first-run' | 'recovered' | 'corrupt'
  // 渲染层据此区分「首次运行」与「损坏」，损坏时进入只读并引导导入备份。
  guardedHandle('data:load', () => {
    const data = readData();
    const health = dataHealth();
    return { data: data || null, status: health.status, corruptPath: health.corruptPath,
      recovery: recoveryCandidate(data) };
  });

  guardedOn('data:draft', (event, data) => {
    event.returnValue = isDataLocked() ? false : captureRecovery('main', data);
  });
  guardedOn('note:draft', (event, note) => {
    event.returnValue = isDataLocked() || supersededDetached.has(event.sender) ? false : captureRecovery('note', note);
  }, { noteScoped: true });
  guardedHandle('data:recovery:resolve', (event, decision) => {
    if (decision !== 'restore' && decision !== 'discard') throw new Error('invalid recovery decision');
    const original = readData();
    const candidate = recoveryCandidate(original);
    if (!candidate) return { ok: false };
    if (decision === 'restore' && !writeData(candidate, { force: true })) return { ok: false };
    if (!writeRecovery({ version: 1, main: null, notes: {} })) return { ok: false };
    openStartupPinned(decision === 'restore' ? candidate : original);
    return { ok: true, data: decision === 'restore' ? candidate : null };
  });

  // 只读通道：单独查询数据健康状态（供渲染层随时重查，无需重新读盘）。
  guardedHandle('data:health', () => {
    return dataHealth();
  });

  // opts.force 仅供「导入备份」等自救路径越过损坏锁使用。
  // 校验失败 / 写入被锁时「抛错」而非返回 false：渲染层 save()/saveNow() 只挂了
  // .catch(reportSaveError)，不检查 resolved 值，返回 false 会导致静默失败、用户以为已保存。
  // 独立桌面便签可编辑的字段（note.js noteUpdate 的写入面）。主窗口整份快照里这些字段
  // 可能仍是钉桌前的旧值（主窗防抖保存与独立窗编辑交错时），落盘前以磁盘上独立窗口的
  // 最新版本为准；其余字段（如 reminder.fired、分组、位置、desktopPin）仍采用主窗快照，
  // 避免把主窗侧的非编辑变更一起回退。
  const DETACHED_EDIT_FIELDS = ['title', 'content', 'items', 'images', 'files', 'tables', 'color', 'textColor', 'opacity', 'fontSize', 'fontFamily', 'updatedAt'];
  guardedHandle('data:save', async (e, data, opts) => {
    if (!DataIO.isValidDataShape(data)) {
      throw new Error('invalid data shape: 拒绝写入非法数据结构，以保护现有存档');
    }
    // opts.replace：整份显式替换（导入备份），此时不做独立窗口字段合并——否则导入内容会被
    // 磁盘上同 ID 旧便签的编辑字段悄悄顶掉。普通自动保存仍走下面的合并保护。
    const replace = !!(opts && opts.replace);
    // 独立便签窗口是它自己编辑内容的唯一写入者（note:update）。显式取消钉住
    // （desktopPin:false，例如主窗发起 unpin）时不合并，仍采用主窗版本。
    if (!replace && detachedWindows.size && Array.isArray(data.notes)) {
      const disk = readData();
      if (disk && Array.isArray(disk.notes)) {
        const diskById = new Map(disk.notes.filter(Boolean).map((n) => [n.id, n]));
        data.notes = data.notes.map((n) => {
          if (!n || !detachedWindows.has(n.id) || n.desktopPin === false) return n;
          const diskNote = diskById.get(n.id);
          if (!diskNote) return n;
          const merged = { ...n };
          for (const f of DETACHED_EDIT_FIELDS) {
            if (f in diskNote) merged[f] = diskNote[f];
          }
          return merged;
        });
      }
    }
    const ok = writeData(data, opts);
    if (!ok) {
      throw new Error(isDataLocked() ? '数据文件损坏且无可用备份，已锁定写入' : '数据写入失败');
    }
    clearRecovery('main', null, opts && opts.draftToken, data);
    if (replace) await reconcileDetachedAfterReplace(data);
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

  guardedHandle('data:export', async (e, data) => {
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

  guardedHandle('note:export-markdown', async (e, md, suggestName) => {
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

  guardedHandle('data:import', async () => {
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

  guardedHandle('dialog:pick-image', async () => {
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

  guardedHandle('note:save-image', async (e, dataUrl) => {
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

  guardedHandle('dialog:pick-note-image', async () => {
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

  guardedHandle('dialog:pick-font', async () => {
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

  guardedHandle('dialog:choose-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择备份目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  });

  guardedHandle('dialog:pick-sound', async () => {
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

  guardedHandle('backup:export', async (e, data, dir) => {
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

  guardedHandle('backup:open-dir', async (e, dir) => {
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

  guardedHandle('note:add-image-file', async (e, filePath) => {
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

  guardedHandle('clipboard:read-text', () => clipboard.readText());
  guardedHandle('clipboard:read-image', () => clipboardImageToDataUrl());
  guardedHandle('clipboard:write-text', (e, text) => {
    clipboard.writeText(String(text || ''));
    return true;
  });
  guardedHandle('clipboard:write-image', (e, src) => {
    try {
      if (typeof src !== 'string') return false; // 不做任意 String() 强转
      // 复用媒体协议解析：精确 scheme/host、单次解码、拒绝嵌套/编码分隔符/ADS/越界/目录/缺失/symlink 逃逸。
      const resolved = MediaProtocol.resolveMediaFile(src, 'note-img', app.getPath('userData'));
      if (!resolved) return false;
      const img = nativeImage.createFromPath(resolved.file);
      if (!img || img.isEmpty()) return false; // 非图片/空图：不写入，也不谎报成功
      clipboard.writeImage(img);
      return true;
    } catch (err) {
      return false;
    }
  });
  guardedHandle('clipboard:read-files', () => {
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

  guardedHandle('path:stat', (e, p) => {
    try {
      const st = fs.statSync(String(p || ''));
      return { exists: true, isDirectory: st.isDirectory(), isFile: st.isFile() };
    } catch (e) {
      return { exists: false };
    }
  });

  guardedHandle('file:open', async (e, p, isDir) => {
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
  guardedHandle('note:pin', async (e, id) => {
    const data = readData();
    if (!data || !Array.isArray(data.notes)) return false;
    const note = data.notes.find((n) => n.id === id);
    if (!note) return false;
    const wasPinned = !!note.desktopPin;
    note.desktopPin = true;
    if (!writeData(data)) return false;
    let win;
    try {
      win = createDetachedWindow(id);
      await win.noteLoadPromise;
      return true;
    } catch (err) {
      console.error('[note] 钉到桌面失败：', err);
      if (win && !win.isDestroyed()) {
        win.notePinFailed = true;
        win.destroy();
      }
      note.desktopPin = wasPinned;
      if (!writeData(data)) console.error('[note] 钉桌失败后回滚存档失败');
      return false;
    }
  });
  guardedHandle('note:get', (e, id) => {
    const data = readData();
    if (data) {
      const note = (data.notes || []).find((n) => n.id === id) || null;
      return { note, settings: data.settings || null };
    }
    return { note: null, settings: null };
  });
  guardedHandle('note:update', (e, note, opts) => {
    // 被导入替换作废的旧窗口迟到写入：拒绝，避免覆盖已落盘的导入内容。
    if (supersededDetached.has(e.sender)) return false;
    // 数据不可用时返回 false，让渲染层知道未落盘，避免「显示已保存但磁盘是空的」
    const data = readData();
    if (!data) return false;
    data.notes = (data.notes || []).map((n) => (n.id === note.id ? note : n));
    const ok = writeData(data);
    if (!ok) return false;
    clearRecovery('note', note.id, opts && opts.draftToken);
    // 重新武装的提醒允许再次调度（稍后再响）
    if (note && note.reminder && note.reminder.enabled && !note.reminder.fired) recentlyFired.delete(note.id);
    scheduleReminders(data.notes);
    if (mainWindow) mainWindow.webContents.send('note:changed', note);
    return ok;
  }, { denyValue: false, noteScoped: true });
  // UX-20A：仅「显示/恢复/聚焦」已钉桌便签，绝不写盘（区别于会写 pin 状态的 note:pin）。
  // 仅主窗可调用；独立窗/伪造来源拒绝。复用与重建统一等待加载后再校验，缺失窗口安全重建。
  guardedHandle('note:show', async (e, id) => {
    const src = classifyRendererSource(e);
    if (!src || src.role !== 'main') return false;
    if (typeof id !== 'string' || id === '') return false;
    const data = readData();
    if (!data || !Array.isArray(data.notes)) return false;
    const note = data.notes.find((n) => n && n.id === id);
    if (!note || note.desktopPin !== true) return false;

    // 清理已销毁但残留的注册项，避免复用已死窗口
    const stale = detachedWindows.get(id);
    if (stale && stale.isDestroyed()) detachedWindows.delete(id);

    let win = detachedWindows.get(id) || null;
    const created = !win;
    if (!win) {
      try { win = createDetachedWindow(id); } catch (err) { return false; }
      if (!win) return false;
    }
    // 复用窗可能仍在加载（含并发第二次请求）：统一等待完成后再判定，绝不提前 show/成功。
    try {
      await win.noteLoadPromise;
    } catch (err) {
      console.error('[note] 唤起桌面便签失败：', err);
      if (created && !win.isDestroyed()) { win.notePinFailed = true; win.destroy(); } // 仅销毁本次新建的失败窗
      return false;
    }
    // 统一校验：同一注册窗口、未销毁、未被导入作废、当前存档仍有效钉桌。
    if (win.isDestroyed() || detachedWindows.get(id) !== win || supersededDetached.has(win.webContents)) return false;
    const fresh = readData();
    const freshNote = fresh && Array.isArray(fresh.notes) ? fresh.notes.find((n) => n && n.id === id) : null;
    if (!freshNote || freshNote.desktopPin !== true) {
      if (created && !win.isDestroyed()) { win.notePinFailed = true; win.destroy(); }
      return false; // 复用中的用户窗口即使读取/校验失败也不销毁
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return true;
  });
  guardedHandle('note:unpin', async (e, id) => {
    const win = detachedWindows.get(id);
    if (!(await flushDetachedNote(win))) return false;
    if (win) win.close();
    else if (mainWindow) mainWindow.webContents.send('note:unpinned', id);
    return true;
  });
  guardedHandle('note:close-all', async () => {
    if (!(await flushDetachedNotes())) return false;
    detachedWindows.forEach((w) => w.close());
    detachedWindows.clear();
    return true;
  });
  guardedHandle('note:delete', async (e, id) => {
    const win = detachedWindows.get(id);
    if (!(await flushDetachedNote(win))) return false;
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
    if (win) win.close();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('note:deleted', id);
    return true;
  });
  guardedHandle('settings:set-font-size', (e, size) => {
    const v = clampFinite(size, 11, 22);
    // 非法入参：拒绝且不落盘、不广播，而不是用 14 覆盖用户设置。
    if (v === null) throw new Error('invalid font size');
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
  guardedHandle('note:show-menu', (e, opts) => {
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
  guardedHandle('open-external', async (e, url) => {
    const raw = typeof url === 'string' ? url : '';
    // 拒绝控制字符（不静默剥离，避免把恶意串伪装成合法 URL 再交付系统）。
    if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return false;
    let parsed;
    try { parsed = new URL(raw); } catch (err) { return false; }
    // 只放行真实的 http/https 且必须带主机名；其它 scheme（file:/javascript:/ms-*: 等）一律拒绝。
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (!parsed.hostname) return false;
    try { await shell.openExternal(parsed.href); return true; }
    catch (err) { return false; }
  });

  guardedHandle('media:cleanup-orphans', async () => {
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
  guardedHandle('startup:get', () => {
    try {
      const s = app.getLoginItemSettings();
      return { ok: true, enabled: !!s.openAtLogin };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });
  guardedHandle('startup:set', (e, enabled) => {
    try {
      app.setLoginItemSettings({ openAtLogin: !!enabled, path: process.execPath });
      return { ok: true, enabled: !!app.getLoginItemSettings().openAtLogin };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  // ---- 全局快捷键 ----
  guardedHandle('shortcuts:get', () => {
    try {
      return { ok: true, ...getShortcutsPayload() };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  });
  guardedHandle('shortcuts:set', (e, overrides) => {
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
  guardedHandle('update:check', async () => {
    if (!app.isPackaged) return { ok: false, error: 'dev' };
    try {
      const result = await autoUpdater.checkForUpdates();
      const isUpdateAvailable = !!(result && result.isUpdateAvailable) && acceptUpdateInfo(result.updateInfo);
      return { ok: true, isUpdateAvailable };
    } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
  });
  guardedHandle('update:download', async () => {
    try { await autoUpdater.downloadUpdate(); return { ok: true }; }
    catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
  });
  guardedHandle('update:install', async () => {
    try {
      // 独立便签各自持有尚未写盘的编辑态；任何一个保存失败都不能销毁窗口。
      if (!(await flushDetachedNotes())) return { ok: false, error: '独立便签保存失败，请检查后重试' };
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
  guardedOn('window:minimize', () => mainWindow && mainWindow.minimize());
  guardedOn('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  guardedOn('window:hide', () => mainWindow && mainWindow.hide());
  guardedOn('window:close', () => requestCloseMainWindow());
  guardedOn('window:close-decision', (e, decision) => {
    handleCloseDecision(decision).catch((err) => console.error('[window] 退出失败：', err));
  });
  guardedOn('window:always-on-top', (e, flag) => {
    if (mainWindow) mainWindow.setAlwaysOnTop(!!flag);
  });
  guardedOn('window:set-opacity', (e, opacity) => {
    const v = clampFinite(opacity, 0, 1);
    if (v === null) { e.returnValue = false; return; }
    if (mainWindow) mainWindow.setOpacity(v);
  });
  // 自定义背景图/明暗变化时同步原生窗口控制按钮(─ □ ✕)的符号颜色，避免亮背景上看不清
  guardedOn('window:set-controls', (e, opts) => {
    const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
    if (!win || !win.setTitleBarOverlay) return;
    const symbolColor = (opts && opts.symbolColor) || '#c8c8c8';
    try {
      win.setTitleBarOverlay({ color: '#00000000', symbolColor, height: 50 });
    } catch (err) { /* 非标题栏覆盖窗口忽略 */ }
  });
  guardedOn('window:set-self-opacity', (e, opacity) => {
    const v = clampFinite(opacity, 0, 1);
    if (v === null) { e.returnValue = false; return; }
    let win = null;
    try { win = BrowserWindow.fromWebContents(e.sender); } catch (err) { win = null; }
    if (!win && mainWindow && mainWindow.webContents === e.sender) win = mainWindow;
    if (win && !win.isDestroyed()) win.setOpacity(v);
  });
  guardedOn('window:set-note-opacity', (e, opacity) => {
    const v = clampFinite(opacity, 0, 100);
    if (v === null) { e.returnValue = false; return; }
    detachedWindows.forEach((w) => {
      if (w && !w.isDestroyed()) w.webContents.send('window:note-opacity', v);
    });
  });
  // 钉窗右键菜单「便签透明度」滑杆：持久化全局 noteOpacity 并同步主窗口（复用到所有便签卡片）
  guardedOn('note:save-note-opacity', (e, opacity) => {
    const v = clampFinite(opacity, 0, 100);
    if (v === null) { e.returnValue = false; return; } // 非法：不读档、不落盘、不广播
    // 数据不可用时只同步到窗口、不落盘，避免用 {} 覆盖整个数据文件
    const data = readData();
    if (data) {
      data.settings = data.settings || {};
      data.settings.noteOpacity = v;
      writeData(data);
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('window:note-opacity-setting', v);
  });
  guardedOn('window:set-effects', (e, fx) => {
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
  guardedHandle('window:toggle', () => {
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

// 稳定版不接受预发布更新：防止发布流程误把 `x.y.z-preview` 包发成正式版（releases/latest 返回预发布），
// 把稳定用户也推到预发布版本。返回 true 表示该更新信息可接受。
function acceptUpdateInfo(info) {
  if (!info || !info.version) return false;
  const isPre = (v) => /-/.test(String(v || ''));
  return !(isPre(app.getVersion()) === false && isPre(info.version));
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
      if (!acceptUpdateInfo(info)) return;
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

    // P0-04 phase2b：四个 note-* 媒体协议统一走 media-protocol 解析（host/编码/目录/文件/realpath 校验）。
    for (const scheme of MediaProtocol.SCHEMES) {
      protocol.handle(scheme, MediaProtocol.createMediaProtocolHandler(scheme, {
        userDataDir: app.getPath('userData'),
        net,
        toFileURL: pathToFileURL
      }));
    }

    setupIpc();
    createWindow();
    createTray();
    setupAutoUpdate();

    const initial = readData();
    if (!recoveryCandidate(initial)) openStartupPinned(initial);

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
