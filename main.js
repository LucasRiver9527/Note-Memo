const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, globalShortcut, protocol, net, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');
const logic = require('./renderer/logic.js');
const Shortcuts = require('./renderer/shortcuts.js');
const DataIO = require('./data-io.js');
const { createNoteStore } = require('./note-store.js');
const { mergeDetachedEdits } = logic;
const { registerFileIpc } = require('./file-ipc.js');
const MediaProtocol = require('./media-protocol.js');
const { createWindowManager } = require('./window-manager.js');
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

let tray = null;
let reminderTimer = null;
const recentlyFired = new Set();

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
    if (windows.mainWindow && !windows.mainWindow.isDestroyed() && sender === windows.mainWindow.webContents) { role = 'main'; expectedPage = APP_MAIN_PAGE; }
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

const { dataPath, dataHealth, isDataLocked, readData, writeData, captureRecovery, clearRecovery, writeRecovery, recoveryCandidate } =
  createNoteStore(() => app.getPath('userData'));

const windows = createWindowManager({
  mainPage: APP_MAIN_PAGE,
  notePage: APP_NOTE_PAGE,
  readData,
  writeData,
  clearRecoveryAfterReplace: () => writeRecovery({ version: 1, main: null, notes: {} })
});
const {
  detachedWindows, supersededDetached, createWindow, createDetachedWindow,
  requestCloseMainWindow, handleCloseDecision, flushDetachedNote, flushDetachedNotes,
  reconcileDetachedAfterReplace
} = windows;

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
        windows.mainWindow.webContents.send('note:create');
      }
    },
    { type: 'separator' },
    {
      label: '置顶',
      type: 'checkbox',
      checked: false,
      click: (item) => {
        windows.mainWindow.setAlwaysOnTop(item.checked);
        windows.mainWindow.webContents.send('window:always-on-top', item.checked);
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => requestCloseMainWindow('quit')
    }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => toggleWindow());
}

function showWindow() {
  if (!windows.mainWindow) return;
  // 之前是最小化：先 restore，恢复最大化/原尺寸状态，再显示
  if (windows.mainWindow.isMinimized()) windows.mainWindow.restore();
  windows.mainWindow.show();
  windows.mainWindow.focus();
}

function toggleWindow() {
  if (!windows.mainWindow) return;
  if (windows.mainWindow.isVisible() && windows.mainWindow.isFocused()) {
    windows.mainWindow.hide();
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

  if (windows.mainWindow) {
    showWindow();
    windows.mainWindow.flashFrame(true);
    setTimeout(() => windows.mainWindow.flashFrame(false), 4000);
    windows.mainWindow.webContents.send('reminder:fired', note.id);
    // 播报闹铃声音：把声音设置传给渲染进程播放（preload 监听 reminder:sound）
    const data = readData();
    const s = (data && data.settings) || {};
    windows.mainWindow.webContents.send('reminder:sound', {
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

  guardedHandle('data:save', async (e, data, opts) => {
    if (!DataIO.isValidDataShape(data)) {
      throw new Error('invalid data shape: 拒绝写入非法数据结构，以保护现有存档');
    }
    // opts.replace：整份显式替换（导入备份），此时不做独立窗口字段合并——否则导入内容会被
    // 磁盘上同 ID 旧便签的编辑字段悄悄顶掉。普通自动保存仍走下面的合并保护。
    const replace = !!(opts && opts.replace);
    // 独立便签窗口是它自己编辑内容的唯一写入者（note:update）。显式取消钉住
    // （desktopPin:false，例如主窗发起 unpin）时不合并，仍采用主窗版本。
    const disk = replace ? null : readData();
    if (disk?.settings?.windowState) {
      data.settings ||= {};
      data.settings.windowState = disk.settings.windowState;
    }
    if (!replace && detachedWindows.size && Array.isArray(data.notes)) {
      if (disk && Array.isArray(disk.notes)) {
        const diskById = new Map(disk.notes.filter(Boolean).map((n) => [n.id, n]));
        data.notes = data.notes.map((n) => {
          if (!n || !detachedWindows.has(n.id) || n.desktopPin === false) return n;
          const diskNote = diskById.get(n.id);
          if (!diskNote) return n;
          return mergeDetachedEdits(n, diskNote);
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

  registerFileIpc({ guardedHandle, getMainWindow: () => windows.mainWindow, readData });

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
    const index = (data.notes || []).findIndex((item) => item.id === note?.id);
    if (index < 0) return false;
    const savedNote = mergeDetachedEdits(data.notes[index], note);
    data.notes[index] = savedNote;
    const ok = writeData(data);
    if (!ok) return false;
    clearRecovery('note', note.id, opts && opts.draftToken);
    // 重新武装的提醒允许再次调度（稍后再响）
    if (savedNote.reminder?.enabled && !savedNote.reminder.fired) recentlyFired.delete(savedNote.id);
    scheduleReminders(data.notes);
    if (windows.mainWindow) windows.mainWindow.webContents.send('note:changed', savedNote);
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
    else if (windows.mainWindow) windows.mainWindow.webContents.send('note:unpinned', id);
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
    if (windows.mainWindow && !windows.mainWindow.isDestroyed()) windows.mainWindow.webContents.send('note:deleted', id);
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
    if (windows.mainWindow && !windows.mainWindow.isDestroyed()) windows.mainWindow.webContents.send('settings:font-size', v);
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
      windows.prepareToQuit();
      for (const win of detachedWindows.values()) {
        if (!win.isDestroyed()) win.destroy();
      }
      detachedWindows.clear();
      if (windows.mainWindow && !windows.mainWindow.isDestroyed()) windows.mainWindow.destroy();
      if (tray) tray.destroy();
      autoUpdater.quitAndInstall();
      return { ok: true };
    } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
  });

  // Window controls
  guardedOn('window:minimize', () => windows.mainWindow && windows.mainWindow.minimize());
  guardedOn('window:maximize', () => {
    if (!windows.mainWindow) return;
    if (windows.mainWindow.isMaximized()) windows.mainWindow.unmaximize();
    else windows.mainWindow.maximize();
  });
  guardedOn('window:hide', () => windows.mainWindow && windows.mainWindow.hide());
  guardedOn('window:close', () => requestCloseMainWindow());
  guardedOn('window:close-decision', (e, decision) => {
    handleCloseDecision(decision).catch((err) => console.error('[window] 退出失败：', err));
  });
  guardedOn('window:always-on-top', (e, flag) => {
    if (windows.mainWindow) windows.mainWindow.setAlwaysOnTop(!!flag);
  });
  guardedOn('window:set-opacity', (e, opacity) => {
    const v = clampFinite(opacity, 0, 1);
    if (v === null) { e.returnValue = false; return; }
    if (windows.mainWindow) windows.mainWindow.setOpacity(v);
  });
  // 自定义背景图/明暗变化时同步原生窗口控制按钮(─ □ ✕)的符号颜色，避免亮背景上看不清
  guardedOn('window:set-controls', (e, opts) => {
    const win = BrowserWindow.fromWebContents(e.sender) || windows.mainWindow;
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
    if (!win && windows.mainWindow && windows.mainWindow.webContents === e.sender) win = windows.mainWindow;
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
    if (windows.mainWindow && !windows.mainWindow.isDestroyed()) windows.mainWindow.webContents.send('window:note-opacity-setting', v);
  });
  guardedOn('window:set-effects', (e, fx) => {
    const srcWin = BrowserWindow.fromWebContents(e.sender);
    if (srcWin === windows.mainWindow) {
      windows.setDesktopSnapAppearance(fx);
      detachedWindows.forEach((w) => {
        if (w && !w.isDestroyed()) {
          w.webContents.send('window:effects', fx);
          if (Number.isFinite(fx?.noteRadius)) w.noteCornerRadius = Math.max(0, Math.min(28, fx.noteRadius));
          if (typeof w.setBackgroundMaterial === 'function') {
            try {
              w.setBackgroundMaterial(fx && fx.desktopMica ? 'acrylic' : 'none');
              if (w.updateNoteShape) w.updateNoteShape();
            } catch (err) { /* ignore */ }
          }
        }
      });
    }
  });
  guardedHandle('window:toggle', () => {
    toggleWindow();
    return windows.mainWindow && windows.mainWindow.isVisible();
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
    { id: 'createNote', accel: accels.createNote, cb: () => { showWindow(); if (windows.mainWindow && !windows.mainWindow.isDestroyed()) windows.mainWindow.webContents.send('note:create'); } }
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
      if (windows.mainWindow && !windows.mainWindow.isDestroyed()) windows.mainWindow.webContents.send('update:available', info);
    });
    autoUpdater.on('update-downloaded', (info) => {
      if (windows.mainWindow && !windows.mainWindow.isDestroyed()) windows.mainWindow.webContents.send('update:downloaded', info);
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
    windows.prepareToQuit();
    windows.dispose();
    globalShortcut.unregisterAll();
  });
}
