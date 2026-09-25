/* system/shortcuts-panel.js
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.systemShortcutsPanel + 顶层全局。
   —— 本模块的函数通过顶层全局访问其他模块（与 board-layout.js / sort-panel.js 等同构）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.systemShortcutsPanel = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

/* ============ 快捷键设置 ============ */
// 渲染「快捷键」设置面板：列出所有快捷键（全局 + 编辑器），点击可重新按键，底部有恢复默认。
function renderShortcutPanel() {
  const list = $('#shortcutList');
  if (!list) return;
  list.innerHTML = '';
  const overrides = (state.settings.shortcuts && typeof state.settings.shortcuts === 'object') ? state.settings.shortcuts : {};
  Shortcuts.SHORTCUT_DEFS.forEach((def) => {
    const accel = Shortcuts.getShortcut({ shortcuts: overrides }, def.id);
    const el = document.createElement('div');
    el.className = 'shortcut-item';
    el.innerHTML = `
      <div class="sc-label">
        <div>${t(def.labelKey)}</div>
        <div class="sc-scope">${def.scope === 'global' ? t('shortcut_scope_global') : (def.scope === 'app' ? t('shortcut_scope_app') : t('shortcut_scope_editor'))}</div>
      </div>
      <button class="sc-key" data-id="${def.id}">${Shortcuts.toDisplay(accel)}</button>`;
    const btn = $('.sc-key', el);
    btn.onclick = () => beginRecordShortcut(btn, def.id);
    list.appendChild(el);
  });
}

// 进入按键录制：监听下一次带修饰键的按键组合，写入 settings.shortcuts 并保存 + 重新注册全局快捷键。
// （shortcutRecordingId 见 core/app-state.js）
let shortcutRecorderHandler = null;

function beginRecordShortcut(btn, id) {
  if (shortcutRecordingId) return; // 已有一条在录
  shortcutRecordingId = id;
  btn.classList.add('recording');
  btn.textContent = t('shortcut_press_keys');
  shortcutRecorderHandler = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.key === 'Escape') { stopRecordShortcut(); return; }
    const accel = Shortcuts.acceleratorFromEvent(ev);
    if (!accel) { btn.textContent = t('shortcut_invalid'); return; }
    finishRecordShortcut(id, accel);
  };
  document.addEventListener('keydown', shortcutRecorderHandler, true);
}

function stopRecordShortcut() {
  if (shortcutRecorderHandler) {
    document.removeEventListener('keydown', shortcutRecorderHandler, true);
    shortcutRecorderHandler = null;
  }
  const btn = $(`.sc-key[data-id="${shortcutRecordingId}"]`);
  if (btn) btn.classList.remove('recording');
  shortcutRecordingId = null;
}

function finishRecordShortcut(id, accel) {
  // 去重复：同一加速键已绑定到其它 id 时，清掉旧绑定
  const overrides = (state.settings.shortcuts && typeof state.settings.shortcuts === 'object') ? state.settings.shortcuts : {};
  const next = { ...overrides };
  for (const def of Shortcuts.SHORTCUT_DEFS) {
    if (def.id !== id) {
      const cur = Shortcuts.getShortcut({ shortcuts: next }, def.id);
      if (cur === accel) delete next[def.id];
    }
  }
  next[id] = accel;
  saveShortcuts(next);
}

function saveShortcuts(overrides) {
  state.settings.shortcuts = overrides;
  stopRecordShortcut();
  // 落盘 + 主进程重新注册全局快捷键
  window.api.setShortcuts(overrides).then((r) => {
    if (r && r.ok) {
      state.settings.shortcuts = r.overrides || overrides;
      if (r.failures && r.failures.length) {
        const names = r.failures.map((id) => {
          const def = Shortcuts.SHORTCUT_DEFS.find((d) => d.id === id);
          return def ? t(def.labelKey) : id;
        }).join(', ');
        toast(t('shortcut_failed').replace('{n}', names));
      }
    } else if (r && r.error) {
      toast(t('shortcut_failed').replace('{n}', r.error));
    } else if (!r) {
      toast(t('shortcut_failed').replace('{n}', t('shortcut_unknown_error')));
    }
    save();
    renderShortcutPanel();
  });
}

  return { renderShortcutPanel, beginRecordShortcut, stopRecordShortcut, finishRecordShortcut, saveShortcuts };
}));
