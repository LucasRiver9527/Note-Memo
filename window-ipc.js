const { desktopWindowAppearance } = require('./desktop-window-appearance.js');
const { BrowserWindow } = require('electron');

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

function registerWindowIpc({ guardedHandle, guardedOn, windows, readData, writeData, queueDataWrite, toggleWindow }) {
  const { detachedWindows, requestCloseMainWindow, handleCloseDecision } = windows;

  guardedHandle('settings:set-font-size', (e, size) => queueDataWrite(async () => {
    const v = clampFinite(size, 11, 22);
    // 非法入参：拒绝且不落盘、不广播，而不是用 14 覆盖用户设置。
    if (v === null) throw new Error('invalid font size');
    // 数据不可用时只同步到窗口，不落盘：字号是次要偏好，不值得为它冒覆盖存档的风险
    const data = readData();
    if (data) {
      data.settings = data.settings || {};
      data.settings.fontSize = v;
      await writeData(data);
    }
    if (windows.mainWindow && !windows.mainWindow.isDestroyed()) windows.mainWindow.webContents.send('settings:font-size', v);
    detachedWindows.forEach((w) => { if (w && !w.isDestroyed()) w.webContents.send('settings:font-size', v); });
    return v;
  }));

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
    queueDataWrite(async () => {
      // 数据不可用时只同步到窗口、不落盘，避免用 {} 覆盖整个数据文件
      const data = readData();
      if (data) {
        data.settings = data.settings || {};
        data.settings.noteOpacity = v;
        await writeData(data);
      }
      if (windows.mainWindow && !windows.mainWindow.isDestroyed()) windows.mainWindow.webContents.send('window:note-opacity-setting', v);
    }).catch(error => console.error('[window] 保存透明度失败：', error));
  });
  guardedOn('window:set-effects', (e, fx) => {
    const srcWin = BrowserWindow.fromWebContents(e.sender);
    if (srcWin === windows.mainWindow) {
      windows.setDesktopSnapAppearance(fx);
      detachedWindows.forEach((w) => {
        if (w && !w.isDestroyed()) {
          if (Number.isFinite(fx?.noteRadius)) w.noteCornerRadius = Math.max(0, Math.min(28, fx.noteRadius));
          w.noteAcrylicActive = desktopWindowAppearance.setMaterial(w, fx?.desktopMica);
          w.updateNoteShape?.();
          w.webContents.send('window:effects', { ...fx, desktopMica: w.noteAcrylicActive });
        }
      });
    }
  });
  guardedHandle('window:toggle', () => {
    toggleWindow();
    return windows.mainWindow && windows.mainWindow.isVisible();
  });
}

module.exports = { registerWindowIpc };
