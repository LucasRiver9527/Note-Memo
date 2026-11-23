const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const DesktopSnap = require('./desktop-snap.js');
const { desktopWindowAppearance } = require('./desktop-window-appearance.js');
const { resolveWindowBounds, MIN_WIDTH, MIN_HEIGHT } = require('./window-bounds.js');

const DETACHED_FLUSH_TIMEOUT_MS = 5000;

function createWindowManager({ mainPage, notePage, taskbarDetails, readData, writeData, queueDataWrite, waitForDataWrites, clearRecoveryAfterReplace }) {
  let mainWindow = null;
  let isQuitting = false;
  const detachedWindows = new Map();
  const detachedFlushes = new WeakMap();
  const approvedDetachedCloses = new WeakSet();
  let nextFlushId = 0;
  let desktopSnap = null;
  let desktopSnapAppearance = {};
  // 被导入替换作废的旧 WebContents；同 ID 的新窗口不会解除旧来源的禁写。
  const supersededDetached = new WeakSet();

  // ---- 窗口状态持久化：把 bounds / maximized 记到数据文件的 settings.windowState ----
  // （放在 settings 里是因为 renderer 的 data:save 只写 {settings,groups,notes,trash}，顶层键会被覆盖）
  let winStateTimer = null;
  function persistWindowState(immediate = false) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    clearTimeout(winStateTimer);
    const write = () => queueDataWrite(async () => {
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
        const previous = data.settings?.windowState;
        if (previous?.maximized === state.maximized &&
            Object.keys(state.normalBounds).every(key => previous.normalBounds?.[key] === state.normalBounds[key])) return;
        data.settings ||= {};
        data.settings.windowState = state;
        await writeData(data);
      } catch (e) { /* ignore */ }
    });
    if (immediate === true) return write();
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

  function createWindow(data = readData()) {
    const state = data?.settings?.windowState;
    const saved = typeof state?.normalBounds?.width === 'number' ? state : null;
    mainWindow = new BrowserWindow({
      ...resolveWindowBounds(screen, saved?.normalBounds),
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
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
    if (taskbarDetails) mainWindow.setAppDetails(taskbarDetails);
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
      if (intent !== 'quit') {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
      }
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
      await prepareToQuit();
      app.quit();
    } else if (decision === 'hide') {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    }
    // 'cancel' → 什么都不做
  }

  function createDetachedWindow(note, settings = {}, { pendingPin = false } = {}) {
    const { id: noteId, gadget } = note;
    if (detachedWindows.has(noteId)) return detachedWindows.get(noteId);
    const win = new BrowserWindow({
      width: 300,
      height: gadget?.kind === 'calendar' ? 380 : 240,
      minWidth: 220,
      minHeight: 150,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: true,
      alwaysOnTop: true,
      show: !pendingPin,
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
    win.notePinPending = pendingPin;
    detachedWindows.set(noteId, win);
    win.on('closed', () => {
      detachedFlushes.get(win)?.finish(false);
      if (detachedWindows.get(noteId) !== win) return;
      detachedWindows.delete(noteId);
      if (!isQuitting && mainWindow && !mainWindow.isDestroyed() && !win.notePinPending && !win.notePinFailed && !win.suppressUnpin) {
        mainWindow.webContents.send('note:unpinned', noteId);
      }
    });
    try {
      if (taskbarDetails) win.setAppDetails(taskbarDetails);
      hardenWindowNavigation(win);
      win.setAlwaysOnTop(true, 'screen-saver');
      win.noteAcrylicActive = desktopWindowAppearance.setMaterial(win, settings?.desktopMica);
      if (!desktopSnap) desktopSnap = DesktopSnap.createDesktopSnap({ BrowserWindow, screen });
      desktopSnap.setEnabled(desktopSnapAppearance.enabled ?? (settings?.desktopSnap !== false));
      desktopSnap.setAppearance({ ...desktopSnapAppearance, radius: (desktopSnapAppearance.radius ?? settings?.noteRadius) === 0 ? 0 : 8 });
      desktopSnap.attach(win);
      win.noteCornerRadius = desktopSnapAppearance.radius ?? settings?.noteRadius;
      win.updateNoteShape = () => desktopWindowAppearance.updateCorners(win, win.noteCornerRadius);
      let shapeUpdateQueued = false;
      win.on('resize', () => {
        if (shapeUpdateQueued) return;
        shapeUpdateQueued = true;
        setImmediate(() => { shapeUpdateQueued = false; win.updateNoteShape(); });
      });
      win.updateNoteShape();
      const keepTopmost = () => win.setAlwaysOnTop(true, 'screen-saver');
      win.on('focus', keepTopmost);
      win.on('show', keepTopmost);
      win.on('blur', keepTopmost);
      win.on('always-on-top-changed', (_event, alwaysOnTop) => {
        if (!alwaysOnTop) setImmediate(() => {
          if (!win.isDestroyed() && !win.isAlwaysOnTop()) keepTopmost();
        });
      });
      win.webContents.on('render-process-gone', () => detachedFlushes.get(win)?.finish(false));
      let deadline, ready;
      if (pendingPin) {
        ready = new Promise((resolve) => { win.finishNoteInit = resolve; });
      }
      const loaded = win.loadFile(notePage, { query: { id: noteId } });
      win.noteLoadPromise = pendingPin ? Promise.race([
        Promise.all([loaded, ready]).then(([, ok]) => { if (!ok) throw new Error('Desktop note initialization failed'); }),
        new Promise((resolve, reject) => {
          deadline = setTimeout(() => reject(new Error('Desktop note initialization timed out')), 10000);
          win.once('closed', () => reject(new Error('Desktop note window closed during initialization')));
        })
      ]).finally(() => { clearTimeout(deadline); delete win.finishNoteInit; }) : loaded;
    } catch (err) {
      win.notePinFailed = true;
      win.destroy();
      throw err;
    }
    let nativeClosePending = false;
    win.on('close', event => {
      if (isQuitting || win.suppressUnpin || approvedDetachedCloses.has(win)) return;
      event.preventDefault();
      if (nativeClosePending) return;
      nativeClosePending = true;
      flushDetachedNote(win).then(ok => {
        nativeClosePending = false;
        if (ok) closeDetachedNote(win);
      });
    });
    return win;
  }

  function closeDetachedNote(win) {
    if (!win || win.isDestroyed()) return;
    approvedDetachedCloses.add(win);
    try { win.close(); }
    finally { approvedDetachedCloses.delete(win); }
  }

  function flushDetachedNote(win) {
    if (!win || win.isDestroyed()) return Promise.resolve(true);
    const pending = detachedFlushes.get(win);
    if (pending) return pending.promise;

    const id = ++nextFlushId;
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const timeout = setTimeout(() => finish(false), DETACHED_FLUSH_TIMEOUT_MS);
    function finish(saved) {
      if (detachedFlushes.get(win)?.id !== id) return;
      clearTimeout(timeout);
      detachedFlushes.delete(win);
      resolve(saved);
    }
    detachedFlushes.set(win, { id, promise, finish });
    Promise.resolve(win.noteLoadPromise).then(() => {
      if (detachedFlushes.get(win)?.id === id) win.webContents.send('note:flush-request', id);
    }).catch(() => finish(false));
    return promise;
  }

  function completeDetachedFlush(win, id, saved) {
    const pending = detachedFlushes.get(win);
    if (pending && id === pending.id) pending.finish(saved === true);
  }

  async function flushDetachedNotes() {
    let savedAll = true;
    for (const win of detachedWindows.values()) {
      if (!(await flushDetachedNote(win))) savedAll = false;
    }
    return savedAll;
  }

  // 显式整份替换（导入备份）成功落盘后，正在打开的独立便签仍持有被替换前的旧内容：
  // 关闭这些陈旧窗口并按存档重开仍被钉住的便签，避免旧窗口随后 note:update 覆盖导入结果。
  // 导入是整份替换，故协调所有仍在的独立窗（含被导入移除的 ID）；只在整份数据成功写入后调用，
  // 写入失败时不动窗口、不清草稿。
  async function reconcileDetachedAfterReplace(data) {
    const previous = Array.from(detachedWindows.values());
    // Retire every old window and its drafts before yielding to new edits.
    for (const win of previous) {
      if (win.isDestroyed()) continue;
      supersededDetached.add(win.webContents);
      win.suppressUnpin = true;
    }
    clearRecoveryAfterReplace();
    detachedWindows.clear();
    for (const win of previous) {
      if (!win.isDestroyed()) win.destroy();
    }
    const pinned = (data.notes || []).filter(note => note?.desktopPin);
    await Promise.all(pinned.map(async note => {
      let win;
      try {
        win = createDetachedWindow(note, data.settings);
        await win.noteLoadPromise;
      } catch (err) {
        if (win?.isDestroyed()) return;
        if (win) {
          win.notePinFailed = true;
          win.destroy();
        }
        console.error('[note] 导入后重开独立便签失败：', err);
      }
    }));
  }

  function setDesktopSnapAppearance(fx) {
    desktopSnapAppearance = { dark: fx?.snapDark, radius: fx?.noteRadius, enabled: typeof fx?.desktopSnap === 'boolean' ? fx.desktopSnap : desktopSnapAppearance.enabled };
    if (desktopSnap) {
      if (typeof fx?.desktopSnap === 'boolean') desktopSnap.setEnabled(fx.desktopSnap);
      desktopSnap.setAppearance({ dark: fx?.snapDark, radius: fx?.noteRadius === 0 ? 0 : 8 });
    }
  }

  let quitPreparation;
  function prepareToQuit() {
    if (!quitPreparation) {
      quitPreparation = Promise.resolve(persistWindowState(true))
        .then(waitForDataWrites)
        .then(() => { isQuitting = true; });
    }
    return quitPreparation;
  }
  const isReadyToQuit = () => isQuitting;

  function dispose() {
    if (desktopSnap) desktopSnap.dispose();
  }

  return {
    get mainWindow() { return mainWindow; },
    detachedWindows, supersededDetached, createWindow, createDetachedWindow,
    requestCloseMainWindow, handleCloseDecision, closeDetachedNote, flushDetachedNote, flushDetachedNotes, completeDetachedFlush,
    reconcileDetachedAfterReplace, setDesktopSnapAppearance, prepareToQuit, isReadyToQuit, dispose
  };
}

module.exports = { createWindowManager };
