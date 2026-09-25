/* system/ipc-bridge.js
   承接 init() 的「主进程 IPC 订阅 + 全局键盘/鼠标监听」注册。
   只搬注册动作，不改注册顺序；启动编排仍保留在 app.js 的 init()。
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.systemIpcBridge + 顶层全局。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.systemIpcBridge = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

/* ——— 全局输入监听：空格平移 / 撤销重做快捷键 / 拖入拦截 / 选区与表格失焦 ——— */
function bindGlobalInput() {
  // 空格+左键拖 = 平移画布（空格仅在该编辑器未聚焦时生效，避免干扰输入空格）
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
    spaceDown = true;
    document.body.classList.add('pan-mode');
  });
  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return;
    spaceDown = false;
    document.body.classList.remove('pan-mode');
  });
  window.addEventListener('blur', () => {
    spaceDown = false;
    document.body.classList.remove('pan-mode');
  });

  // 结构操作撤销/重做：走「应用级(app)」快捷键体系（可改键）；输入/编辑区内交给浏览器原生撤销/重做
  const isEditableTarget = (t) => t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]');
  window.addEventListener('keydown', (e) => {
    if (isEditableTarget(e.target)) return;
    if (dataReadonly) {
      // 只读：仅放行复制等无副作用操作，撤销/重做会改结构并触发写入，直接拦截
      const sc0 = Shortcuts.whichShortcut(e, state.settings, 'app');
      if (sc0 === 'undo' || sc0 === 'redo') e.preventDefault();
      return;
    }
    const sc = Shortcuts.whichShortcut(e, state.settings, 'app');
    if (sc === 'undo') { e.preventDefault(); undo(); }
    else if (sc === 'redo') { e.preventDefault(); redo(); }
  });

  // 阻止拖入文件/链接时浏览器默认导航（否则会打开空白窗口）
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('drop', (e) => { e.preventDefault(); });

  document.addEventListener('mousedown', (e) => {
    if (savedRange) return;
    const t = e.target;
    if (!(t && t.nodeType === 1 && t.closest('.t-image, .doc-fmt-btn, .t-color'))) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const node = sel.anchorNode;
    if (!node) return;
    const content = node.nodeType === 1
      ? node.closest('.note-content, .doc-content')
      : (node.parentElement && node.parentElement.closest('.note-content, .doc-content'));
    if (!content) return;
    savedRange = sel.getRangeAt(0).cloneRange();
    savedSelText = sel.toString();
    const noteEl = content.closest('[data-id]');
    savedNoteId = noteEl ? noteEl.dataset.id : (docNoteId || null);
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.inline-img')) {
      $$('.inline-img.selected').forEach((x) => x.classList.remove('selected'));
    }
    if (activeTableEl && !activeTableEl.contains(e.target) && !(activeTableToolbar && activeTableToolbar.contains(e.target))) {
      deselectTable();
    }
  });
}

/* ——— 主进程 IPC 订阅（全部注册动作，顺序与原 init 保持一致） ——— */
function registerIpc() {
  window.api.onCreateNote(() => {
    if (state.settings.viewMode === 'todo') {
      const n = createEmptyTodoNote();
      openReminder(n);
    } else {
      createNote();
    }
  });

  window.api.onAlwaysOnTop((flag) => {
    state.settings.alwaysOnTop = flag;
    const pinBtn = $('#btnPin');
    if (pinBtn) pinBtn.classList.toggle('active', !!flag);
  });

  window.api.onMaximized((flag) => {
    document.body.classList.toggle('maximized', !!flag);
  });

  // 关闭确认：主进程询问 → 弹主题化选择框 → 回传决定
  window.api.onCloseRequest(async () => {
    const choice = await showCloseDecisionModal();
    if (choice) window.api.replyCloseDecision(choice);
    else window.api.replyCloseDecision('cancel');
  });

  window.api.onUpdateAvailable(async (info) => {
    const ver = (info && info.version) || '';
    const ok = await confirmModal(t('update_available_title'), t('update_available_msg').replace('{v}', ver));
    if (ok) {
      // 下载失败不再静默：主进程 downloadUpdate 的异常会回传（此前未 await 导致点了没反应）
      const r = await window.api.downloadUpdate();
      if (r && r.ok === false) toast(t('update_download_fail') + (r.error ? (' ' + r.error) : ''));
    }
  });
  window.api.onUpdateDownloaded(async (info) => {
    const ver = (info && info.version) || '';
    const ok = await confirmModal(t('update_ready_title'), t('update_ready_msg').replace('{v}', ver));
    if (ok) window.api.quitAndInstall();
  });

  window.api.onReminderFired((id) => {
    const n = state.notes.find((x) => x.id === id);
    if (n && n.reminder) {
      n.reminder.fired = true;
      save();
      renderAll();
      showAlarmModal(n);
      const el = document.querySelector('[data-id="' + id + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  window.api.onNoteChanged((note) => {
    state.notes = state.notes.map((n) => (n.id === note.id ? note : n));
  });

  window.api.onNoteUnpinned((id) => {
    const n = state.notes.find((x) => x.id === id);
    if (n) {
      n.desktopPin = false;
      save();
      renderAll();
    }
  });

  window.api.onNoteDeleted((id) => {
    const idx = state.notes.findIndex((x) => x.id === id);
    if (idx >= 0) {
      const n = state.notes[idx];
      state.notes.splice(idx, 1);
      state.trash.push({ note: n, deletedAt: Date.now() });
      if (docNoteId === id) docNoteId = null;
      save();
      renderAll();
      renderTrashPanel();
      toast(t('toast_removed'));
    }
  });

  window.api.onReminderSound((info) => {
    playReminderSound(info);
  });

  window.api.onFontSize((v) => {
    if (v && v !== state.settings.fontSize) {
      state.settings.fontSize = v;
      const fs = $('#fontSize');
      if (fs) fs.value = v;
      applyTheme();
    }
  });

  // 钉窗右键菜单调整「便签不透明度」：同步全局设置并实时应用到所有便签卡片
  window.api.onNoteOpacitySetting((v) => {
    if (typeof v === 'number' && v <= 100 && state.settings.noteOpacity !== v) {
      state.settings.noteOpacity = v;
      applyTheme();
      save();
    }
  });

  window.addEventListener('beforeunload', () => {
    window.api.saveData({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash });
  });
}

  return { bindGlobalInput, registerIpc };
}));
