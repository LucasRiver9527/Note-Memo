/* 快捷键纯逻辑模块：单一来源，可被单元测试，也可挂到页面全局。
   - Node: module.exports
   - 浏览器: 挂 root.Shortcuts + 顶层全局，app.js / notes-view.js / note.js 可直接按名字调用
   职责：默认快捷键表 + 加速键解析/匹配/展示/捕获。main.js 也用它注册全局快捷键。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.Shortcuts = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 快捷键定义：id + 作用域（global=主进程全局快捷键 / editor=编辑器内事件）
  // 默认值避开 Windows 系统默认快捷键（不用 Alt+Tab / Win+D / Ctrl+Shift+Esc / Win+C 等）。
  // "Common完整集"：全局(唤起/隐藏窗口、新建便签) + 编辑器(加粗/高亮/左中右对齐/复制选中图片)。
  const DEFAULT_SHORTCUTS = {
    toggleWindow: 'CommandOrControl+Shift+M',   // 唤起/隐藏主窗口
    createNote:   'CommandOrControl+Shift+N',   // 唤起主窗口并新建便签
    undo:         'CommandOrControl+Z',         // 撤销（结构操作；输入框内走浏览器原生撤销）
    redo:         'CommandOrControl+Shift+Z',   // 重做
    bold:         'CommandOrControl+B',         // 加粗
    highlight:    'CommandOrControl+H',         // 高亮
    alignLeft:    'CommandOrControl+L',         // 左对齐
    alignCenter:  'CommandOrControl+E',         // 居中
    alignRight:   'CommandOrControl+R',         // 右对齐
    copyImage:    'CommandOrControl+C'          // 复制选中图片（无选中图片时退回普通复制）
  };

  const SHORTCUT_DEFS = [
    { id: 'toggleWindow', scope: 'global', labelKey: 'shortcut_toggle_window' },
    { id: 'createNote',   scope: 'global', labelKey: 'shortcut_create_note' },
    { id: 'undo',         scope: 'app', labelKey: 'shortcut_undo' },
    { id: 'redo',         scope: 'app', labelKey: 'shortcut_redo' },
    { id: 'bold',         scope: 'editor', labelKey: 'shortcut_bold' },
    { id: 'highlight',    scope: 'editor', labelKey: 'shortcut_highlight' },
    { id: 'alignLeft',    scope: 'editor', labelKey: 'shortcut_align_left' },
    { id: 'alignCenter',  scope: 'editor', labelKey: 'shortcut_align_center' },
    { id: 'alignRight',   scope: 'editor', labelKey: 'shortcut_align_right' },
    { id: 'copyImage',    scope: 'editor', labelKey: 'shortcut_copy_image' }
  ];

  function buildDefaultShortcuts() { return { ...DEFAULT_SHORTCUTS }; }

  function getDefaultShortcut(id) { return DEFAULT_SHORTCUTS[id] || null; }

  // 有效快捷键 = 默认值 + 用户覆盖（settings.shortcuts 只存覆盖项；未设时用默认）
  function effectiveShortcuts(settings) {
    const d = buildDefaultShortcuts();
    const user = (settings && settings.shortcuts) || {};
    return { ...d, ...user };
  }

  function getShortcut(settings, id) {
    const eff = effectiveShortcuts(settings);
    return eff[id] || null;
  }

  // ---- 加速键解析 ----
  const MOD_ALIASES = {
    'ctrl': 'ctrl', 'control': 'ctrl',
    'cmd': 'meta', 'command': 'meta', 'super': 'meta', 'meta': 'meta',
    'cmdorctrl': 'cmdcntrl', 'cmdorctrl': 'cmdcntrl', 'commandorcontrol': 'cmdcntrl', 'cmdorcontrol': 'cmdcntrl',
    'alt': 'alt', 'option': 'alt',
    'shift': 'shift'
  };

  function parseAccel(accel) {
    const mods = { ctrl: false, alt: false, shift: false, meta: false, cmdcntrl: false };
    let key = null;
    String(accel || '').split('+').forEach((part) => {
      const p = part.trim();
      if (!p) return;
      const m = MOD_ALIASES[p.toLowerCase()];
      if (m) mods[m] = true;
      else if (!key) key = p;
    });
    return { mods, key };
  }

  function namedKey(n) {
    n = String(n).toLowerCase();
    const map = {
      'space': ' ', 'enter': 'enter', 'esc': 'escape', 'escape': 'escape',
      'up': 'arrowup', 'down': 'arrowdown', 'left': 'arrowleft', 'right': 'arrowright',
      'tab': 'tab', 'backspace': 'backspace', 'delete': 'delete', 'insert': 'insert',
      'home': 'home', 'end': 'end', 'pageup': 'pageup', 'pagedown': 'pagedown'
    };
    return (n.length === 1) ? n.toLowerCase() : (map[n] || n);
  }

  function keyMatches(accelKey, evKey) {
    if (accelKey === evKey) return true;
    const a = namedKey(accelKey.toLowerCase());
    const e = namedKey(evKey.toLowerCase());
    return a === e;
  }

  // 判断一个事件（含 ctrlKey/metaKey/altKey/shiftKey/key）是否命中某个加速键
  function matchesAccelerator(accel, ev) {
    const { mods, key } = parseAccel(accel);
    if (!key || !ev) return false;
    // cmdorctrl: ctrl 或 meta 任一
    if (mods.cmdcntrl) { if (!(ev.ctrlKey || ev.metaKey)) return false; }
    else if (mods.meta) { if (!ev.metaKey) return false; }
    else if (mods.ctrl) { if (!ev.ctrlKey) return false; }
    else { if (ev.ctrlKey || ev.metaKey) return false; }
    // 未声明的 alt/shift 必须与事件一致（默认快捷键用单修饰键，多按不误触；显式含 shift 时才接受 shift）
    if (mods.alt !== !!ev.altKey) return false;
    if (mods.shift !== !!ev.shiftKey) return false;
    return keyMatches(key, ev.key);
  }

  // 设置驱动：settings + id 决定事件是否命中该快捷键
  function isShortcut(event, id, settings) {
    const accel = getShortcut(settings, id);
    if (!accel) return false;
    return matchesAccelerator(accel, event);
  }

  // 返回命中该事件的编辑器/全局快捷键 id（按 SHORTCUT_DEFS 顺序，先到先得）；无命中返回 null。
  function whichShortcut(event, settings, scope) {
    const list = SHORTCUT_DEFS.filter((d) => !scope || d.scope === scope);
    for (const d of list) {
      if (isShortcut(event, d.id, settings)) return d.id;
    }
    return null;
  }

  // 从 KeyboardEvent 生成 Electron 加速键字符串；无修饰键或未知键返回 null（要求必带修饰键）
  function acceleratorFromEvent(e) {
    if (!e) return null;
    const mods = [];
    if (e.ctrlKey) mods.push('CommandOrControl');
    else if (e.metaKey) mods.push('Command');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (mods.length === 0) return null; // 必须带修饰键，避免与输入冲突
    const key = toAccelKey(e.key);
    if (!key) return null;
    return mods.concat(key).join('+');
  }

  function toAccelKey(key) {
    const s = String(key);
    if (s.length === 1) { return /[a-z0-9]/i.test(s) ? s.toUpperCase() : null; }
    const map = {
      'ArrowUp': 'Up', 'ArrowDown': 'Down', 'ArrowLeft': 'Left', 'ArrowRight': 'Right',
      ' ': 'Space', 'Escape': 'Esc', 'Enter': 'Enter', 'Tab': 'Tab',
      'Backspace': 'Backspace', 'Delete': 'Delete', 'Insert': 'Insert',
      'Home': 'Home', 'End': 'End', 'PageUp': 'PageUp', 'PageDown': 'PageDown'
    };
    return map[s] || (/^F\d{1,2}$/i.test(s) ? s.toUpperCase() : null);
  }

  // 显示为「Ctrl+Shift+M」形式
  function toDisplay(accel) {
    const { mods, key } = parseAccel(accel);
    const parts = [];
    if (mods.cmdcntrl) parts.push('Ctrl');
    else if (mods.ctrl) parts.push('Ctrl');
    if (mods.meta) parts.push('Cmd');
    if (mods.alt) parts.push('Alt');
    if (mods.shift) parts.push('Shift');
    if (key) parts.push(displayKey(key));
    return parts.join('+');
  }

  function displayKey(key) {
    const k = String(key);
    if (k.length === 1) return k.toUpperCase();
    const map = { ' ': 'Space', 'Escape': 'Esc', 'Up': '↑', 'Down': '↓', 'Left': '←', 'Right': '→' };
    return map[k] || k;
  }

  function isValidAccelerator(accel) {
    const { mods, key } = parseAccel(accel);
    if (!key) return false;
    return mods.ctrl || mods.meta || mods.alt || mods.cmdcntrl || mods.shift;
  }

  return {
    DEFAULT_SHORTCUTS,
    SHORTCUT_DEFS,
    buildDefaultShortcuts,
    getDefaultShortcut,
    effectiveShortcuts,
    getShortcut,
    parseAccel,
    matchesAccelerator,
    isShortcut,
    whichShortcut,
    acceleratorFromEvent,
    toAccelKey,
    toDisplay,
    isValidAccelerator
  };
}));
