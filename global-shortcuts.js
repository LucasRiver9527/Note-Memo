const { globalShortcut } = require('electron');
const Shortcuts = require('./renderer/shortcuts.js');

function createGlobalShortcuts({ readData, writeData, queueDataWrite, toggleWindow, createNote }) {
  // 从 settings（短期由 renderer 持久化到数据文件）注册「唤起/隐藏窗口」「新建便签」两个全局快捷键。
  // 返回 { failures: [id...] }，方便 renderer 把注册失败（被其它应用占用）提示给用户。
  function registerGlobalShortcuts(settings) {
    const failures = [];
    const accels = Shortcuts.effectiveShortcuts(settings);
    const spec = [
      { id: 'toggleWindow', accel: accels.toggleWindow, cb: toggleWindow },
      { id: 'createNote', accel: accels.createNote, cb: createNote }
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

  function registerIpc(guardedHandle) {
    guardedHandle('shortcuts:get', () => {
      try {
        return { ok: true, ...getShortcutsPayload() };
      } catch (e) {
        return { ok: false, error: (e && e.message) || String(e) };
      }
    });
    guardedHandle('shortcuts:set', (e, overrides) => queueDataWrite(async () => {
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
          persisted = await writeData(data);
        }
        // effectiveShortcuts 只读 settings.shortcuts，故这里包一层，形状与原实现一致；
        // 数据不可用时也能让新键位在本次运行内立即生效
        const reg = registerGlobalShortcuts({ shortcuts: clean });
        return { ok: true, overrides: clean, failures: reg.failures, persisted };
      } catch (err) {
        return { ok: false, error: (err && err.message) || String(err) };
      }
    }));
  }

  return { registerGlobalShortcuts, registerIpc };
}

module.exports = { createGlobalShortcuts };
