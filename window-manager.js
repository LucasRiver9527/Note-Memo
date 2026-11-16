const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const DesktopSnap = require('./desktop-snap.js');

function createWindowManager({ mainPage, notePage, readData, writeData, clearRecoveryAfterReplace }) {
  let mainWindow = null;
  let isQuitting = false;
  const detachedWindows = new Map();
  let desktopSnap = null;
  let desktopSnapAppearance = {};
  // 被导入替换作废的旧 WebContents；同 ID 的新窗口不会解除旧来源的禁写。
  const supersededDetached = new WeakSet();

  // ---- 窗口状态持久化：把 bounds / maximized 记到数据文件的 settings.windowState ----
  // （放在 settings 里是因为 renderer 的 data:save 只写 {settings,groups,notes,trash}，顶层键会被覆盖）
  function readWindowState() {
    const data = readData();
    const ws = data && data.settings && data.settings.windowState;
    if (ws && ws.normalBounds && typeof ws.normalBounds.width === 'number') return ws;
    return null;
  }

  let winStateTimer = null;
  function persistWindowState(immediate = false) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    clearTimeout(winStateTimer);
    const write = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try {
        if (mainWindow.isMinimized()) return;
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
    };
    if (immediate === true) write();
    else winStateTimer = setTimeout(write, 300);
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
      // 最大化本身会显示隐藏窗口，先 show() 可能让普通尺寸的显示请求覆盖恢复状态。
      if (saved?.maximized) {
        try {
          mainWindow.maximize();
          if (mainWindow.isVisible()) {
            mainWindow.focus();
            return;
          }
        } catch (e) { /* fall back to showing the normal window */ }
      }
      mainWindow.show();
    };
    mainWindow.once('ready-to-show', showInitialWindow);
    // Windows 上透明窗口可能迟迟不触发 ready-to-show；页面加载完后兜底显示。
    // 共用一次性门闩，避免较晚的 ready-to-show 在用户隐藏窗口后再次 show()。
    mainWindow.webContents.once('did-finish-load', () => setTimeout(showInitialWindow, 150));

    mainWindow.loadFile(mainPage);

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
  function requestCloseMainWindow(intent) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      mainWindow.webContents.send('window:close-request', intent);
    } catch (e) { /* ignore */ }
  }

  // 处理 renderer 回传的关闭决定
  async function handleCloseDecision(decision) {
    if (decision === 'quit') {
      if (!(await flushDetachedNotes())) {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('window:save-failed');
        return;
      }
      prepareToQuit();
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
    win.noteLoadPromise = win.loadFile(notePage, { query: { id: noteId } });
    win.setAlwaysOnTop(true, 'screen-saver');
    // 桌面便签玻璃拟态：Windows 11 亚克力材质，提供背后桌面的磨砂模糊
    if (process.platform === 'win32' && typeof win.setBackgroundMaterial === 'function') {
      const data = readData();
      const desktopMica = data && data.settings && data.settings.desktopMica;
      try { win.setBackgroundMaterial(desktopMica ? 'acrylic' : 'none'); } catch (e) { /* ignore */ }
    }
    if (!desktopSnap) desktopSnap = DesktopSnap.createDesktopSnap({ BrowserWindow, screen });
    const snapSettings = (readData() || {}).settings || {};
    desktopSnap.setEnabled(desktopSnapAppearance.enabled ?? (snapSettings.desktopSnap !== false));
    desktopSnap.setAppearance({ ...desktopSnapAppearance, radius: (desktopSnapAppearance.radius ?? snapSettings.noteRadius) === 0 ? 0 : 8 });
    desktopSnap.attach(win);
    win.noteCornerRadius = desktopSnapAppearance.radius ?? snapSettings.noteRadius;
    win.updateNoteShape = () => {
      if (process.platform !== 'win32' || win.isDestroyed()) return;
      try { require('./desktop-snap-native.js')().applyRoundedCorners(win, win.noteCornerRadius); }
      catch (error) { console.warn('[note-shape] Could not update rounded window:', error); }
    };
    let shapeUpdateQueued = false;
    win.on('resize', () => {
      if (shapeUpdateQueued) return;
      shapeUpdateQueued = true;
      setImmediate(() => { shapeUpdateQueued = false; win.updateNoteShape(); });
    });
    win.updateNoteShape();
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
    clearRecoveryAfterReplace();
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

  function setDesktopSnapAppearance(fx) {
    desktopSnapAppearance = { dark: fx?.snapDark, radius: fx?.noteRadius, enabled: typeof fx?.desktopSnap === 'boolean' ? fx.desktopSnap : desktopSnapAppearance.enabled };
    if (desktopSnap) {
      if (typeof fx?.desktopSnap === 'boolean') desktopSnap.setEnabled(fx.desktopSnap);
      desktopSnap.setAppearance({ dark: fx?.snapDark, radius: fx?.noteRadius === 0 ? 0 : 8 });
    }
  }

  function prepareToQuit() {
    if (isQuitting) return;
    persistWindowState(true);
    isQuitting = true;
  }

  function dispose() {
    if (desktopSnap) desktopSnap.dispose();
  }

  return {
    get mainWindow() { return mainWindow; },
    detachedWindows, supersededDetached, createWindow, createDetachedWindow,
    requestCloseMainWindow, handleCloseDecision, flushDetachedNote, flushDetachedNotes,
    reconcileDetachedAfterReplace, setDesktopSnapAppearance, prepareToQuit, dispose
  };
}

module.exports = { createWindowManager };
