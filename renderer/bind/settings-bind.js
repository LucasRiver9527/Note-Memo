/* bind/settings-bind.js
   承接 bindUI 的「设置面板入口 / 关闭确认 / 更新检查 / 数据备份导入导出 / 排序与快捷键 / 回收站 / 分组新建」切片。
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.bindSettings。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.bindSettings = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // UX-14：设置抽屉（#settingsPanel）键盘/焦点。打开时把主界面 #app 设为 inert 并聚焦面板，
  // Tab/Shift+Tab 在面板内循环，Escape/关闭按钮/点击遮罩关闭并把焦点还给打开它的控件。
  // 只 inert #app，不波及 body 的其他弹窗兄弟节点（更新说明/确认框/闹铃等）。
  let settingsOpener = null;      // 打开设置前的焦点元素，关闭后归还
  let settingsAppInert = false;   // 打开前 #app 的 inert 状态，关闭时恢复

  // 设置面板之上是否还有更高层模态/按键录制：有则设置键让位，不抢 Tab、也不被 Escape 关闭。
  // 动态弹窗（confirm/prompt/主题编辑器）由 dialogs.js / settings-panel.js 打上 data-modal-overlay 标记。
  function modalAboveSettings() {
    if (typeof shortcutRecordingId !== 'undefined' && shortcutRecordingId) return true;
    const overlays = ['#changelogOverlay', '#reminderOverlay', '#alarmOverlay', '#closeOverlay'];
    if (overlays.some((sel) => { const el = $(sel); return el && !el.classList.contains('hidden'); })) return true;
    return !!document.querySelector('body > [data-modal-overlay]');
  }

  // 面板内「可见且可用」的可聚焦控件（隐藏标签页/禁用项/负 tabindex 不计入）
  function settingsFocusables() {
    const panel = $('#settingsPanel');
    if (!panel) return [];
    return $$('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])', panel)
      .filter((el) => !el.disabled && el.tabIndex !== -1 && el.offsetParent !== null);
  }

  // UX-31：快速纯平移的关闭动画状态。
  // gen 代次标记：每次打开/关闭自增，旧一轮的 rAF / transitionend / timeout 回调带着旧 gen 抵达时一律作废，
  // 既不误关重开的面板，也不残留监听器/遮罩。
  let settingsTransitionGen = 0;
  let settingsCloseTimer = 0;   // 关闭兜底计时器句柄
  let settingsEndHandler = null; // 当前挂载的 transitionend 处理器，便于可靠移除

  // 统一清理当前关闭轮次的监听器与超时；与 gen 解耦，任何一轮结束/被取代都要真正清干净。
  function clearSettingsCloseHandlers(panel) {
    if (settingsCloseTimer) { clearTimeout(settingsCloseTimer); settingsCloseTimer = 0; }
    if (settingsEndHandler) {
      if (panel) panel.removeEventListener('transitionend', settingsEndHandler);
      settingsEndHandler = null;
    }
  }

  function openSettingsDrawer() {
    const overlay = $('#settingsOverlay');
    if (!overlay) return;
    const panel = $('#settingsPanel');
    const wasVisible = !overlay.classList.contains('hidden'); // 依据 overlay 可见性，而非动画状态
    // 已打开且并非关闭动画中：无需重置标签页/动画，避免打断正在进行的入场。
    if (wasVisible && !(panel && panel.classList.contains('sp-closing'))) return;

    const app = document.getElementById('app');
    // 仅真正从关闭态（原先 hidden）打开时才记录原始焦点与 inert —— 且必须在修改 hidden/inert 之前完成。
    if (!wasVisible) {
      settingsOpener = document.activeElement;
      settingsAppInert = !!(app && app.inert);
    }
    overlay.classList.remove('hidden');  // 关闭途中重开：overlay 本就可见，no-op
    settingsTransitionGen++;             // 取消旧关闭回调/计时器，作废旧 gen
    clearSettingsCloseHandlers(panel);
    if (app) app.inert = true;
    switchTab('appearance');
    const gen = settingsTransitionGen;
    if (panel) {
      const wasClosing = panel.classList.contains('sp-closing');
      panel.classList.remove('sp-closing');
      if (wasClosing) {
        // 关闭途中重开：直接从当前 transform 返回 0，避免先跳到 sp-enter 起点造成跳动。
        // 同时清掉上一轮可能遗留的 sp-enter（例如刚入场就关），否则面板会永远停在屏幕外。
        panel.classList.remove('sp-enter');
        overlay.scrollLeft = 0;
      } else {
        // 首次从关闭态打开：置于 sp-enter 起点，下一帧移除 → 触发 transform 过渡。
        panel.classList.add('sp-enter');
        overlay.scrollLeft = 0;
        requestAnimationFrame(() => {
          if (gen !== settingsTransitionGen) return; // 陈旧 rAF：新一轮已开始，不再干预
          panel.classList.remove('sp-enter');
          overlay.scrollLeft = 0; // 防止焦点/布局导致遮罩横向滚动，最终贴右无缝隙
        });
      }
      panel.focus({ preventScroll: true }); // 关键：preventScroll 避免把遮罩横向滚动、抵消滑动
    }
    if (typeof syncZoomToolbar === 'function') syncZoomToolbar();
  }

  function closeSettingsDrawer() {
    const overlay = $('#settingsOverlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    const panel = $('#settingsPanel');
    if (panel && panel.classList.contains('sp-closing')) return; // 已在关闭动画中：重复 close 不叠监听器、不清 opener
    const gen = ++settingsTransitionGen;  // 新一轮关闭：旧回调/计时器随 gen 作废
    clearSettingsCloseHandlers(panel);

    // 真正关闭完成：同 gen 内统一清理监听器/计时器，移除动画类，隐藏遮罩，再恢复最初 inert 与原始 opener 焦点。
    const finalize = () => {
      if (gen !== settingsTransitionGen) return; // 陈旧回调：期间已重开或被新关闭取代
      clearSettingsCloseHandlers(panel);
      if (panel) panel.classList.remove('sp-closing', 'sp-enter');
      overlay.classList.add('hidden');
      const app = document.getElementById('app');
      if (app) app.inert = settingsAppInert;
      const opener = settingsOpener;
      settingsOpener = null;
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
      if (typeof syncZoomToolbar === 'function') syncZoomToolbar();
    };

    if (panel) {
      panel.classList.add('sp-closing');
      settingsEndHandler = (e) => {
        if (e.target !== panel || e.propertyName !== 'transform') return;
        finalize();
      };
      panel.addEventListener('transitionend', settingsEndHandler);
      // 兜底：未触发 transitionend 时也能完成（reduced/no-transition 已在下方同步完成，不会走到计时器）。
      settingsCloseTimer = setTimeout(finalize, 200);
      // 无可用过渡（prefers-reduced-motion / 无过渡时长）时同步完成，不等待计时器。
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce || !settingsHasTransition(panel)) finalize();
    } else {
      finalize();
    }
  }

  // 面板是否存在 transform 过渡时长（无过渡时不应等待 transitionend/兜底计时器）。
  function settingsHasTransition(panel) {
    if (!panel || typeof getComputedStyle !== 'function') return false;
    const d = getComputedStyle(panel).transitionDuration || '';
    return d.split(',').some((v) => parseFloat(v) > 0);
  }

  // 全局捕获：焦点可能因更高层弹窗关闭而落到 body，故监听 document 而非仅面板。
  // 快捷键录制在捕获阶段 stopPropagation，不会到达这里（录制自己的 Escape 由录制器处理）。
  function onSettingsKeydown(e) {
    const overlay = $('#settingsOverlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    if (e.defaultPrevented || modalAboveSettings()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSettingsDrawer();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = settingsFocusables();
    if (!focusables.length) return;
    const idx = focusables.indexOf(document.activeElement);
    const next = e.shiftKey
      ? (idx <= 0 ? focusables.length - 1 : idx - 1)
      : (idx === -1 || idx === focusables.length - 1 ? 0 : idx + 1);
    e.preventDefault();
    focusables[next].focus();
  }

function bindSettings() {
  $('#btnPin').onclick = () => {
    state.settings.alwaysOnTop = !state.settings.alwaysOnTop;
    applyTheme();
    save();
  };

  $('#btnSettings').onclick = openSettingsDrawer;
  $('#btnCloseSettings').onclick = closeSettingsDrawer;
  $('#settingsOverlay').onclick = (e) => { if (e.target.id === 'settingsOverlay') closeSettingsDrawer(); };
  document.addEventListener('keydown', onSettingsKeydown);

  // 关闭确认弹窗按钮
  $('#btnCloseHide').onclick = () => closeDecision('hide');
  $('#btnCloseQuit').onclick = () => closeDecision('quit');
  $('#btnCloseCancel').onclick = () => closeDecision('cancel');
  $('#closeOverlay').onclick = (e) => { if (e.target.id === 'closeOverlay') closeDecision('cancel'); };

  $('#btnChangelog').onclick = openChangelog;
  $('#btnChangelogClose').onclick = closeChangelog;
  const repoBtn = $('#btnOpenRepo');
  if (repoBtn) repoBtn.onclick = () => window.api.openExternal('https://github.com/LucasRiver9527/Note-Memo');
  $('#changelogOverlay').onclick = (e) => { if (e.target.id === 'changelogOverlay') closeChangelog(); };

  $('#btnCheckUpdate').onclick = async () => {
    toast(t('checking_update'));
    const r = await window.api.checkUpdate();
    if (r && r.ok) {
      if (!r.isUpdateAvailable) toast(t('up_to_date'));
    } else {
      toast(t('check_update_fail') + (r && r.error ? (' ' + r.error) : ''));
    }
  };

  $$('.sp-nav-item').forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });

  $$('#modeSeg .seg').forEach((b) => {
    b.onclick = () => {
      state.settings.appearanceMode = b.dataset.mode;
      applyTheme();
      syncModeSeg();
      save();
    };
  });

  $('#btnAddFont').onclick = addCustomFont;
  $('#btnResetFontColor').onclick = () => {
    state.settings.noteTextColor = null;
    syncSettingsInputs();
    applyTheme();
    renderAll();
    save();
    toast(t('font_color_follow'));
  };
  $('#languageSelect').addEventListener('change', (e) => {
    state.settings.language = e.target.value;
    save();
    applyLanguage();
    applyTheme();
    toast(state.settings.language === 'en' ? 'Language switched' : '已切换语言');
  });

  // 开机自启动（默认关闭）
  const autoStart = $('#autoStartToggle');
  if (autoStart) {
    autoStart.addEventListener('change', async (e) => {
      const r = await window.api.setAutoLaunch(e.target.checked);
      if (!r || !r.ok) {
        e.target.checked = !e.target.checked; // 失败回滚
        toast((r && r.error) || 'Failed to set auto start');
        return;
      }
      e.target.checked = !!r.enabled;
    });
  }

  $('#sortMode').addEventListener('change', (e) => {
    state.settings.sortMode = e.target.value;
    save();
    renderSortPanel();
    renderAll();
  });
  const resetShortcutsBtn = $('#btnResetShortcuts');
  if (resetShortcutsBtn) resetShortcutsBtn.onclick = () => {
    if (shortcutRecordingId) stopRecordShortcut();
    saveShortcuts({});
    toast(t('shortcut_reset_done'));
  };
  const sortGroupSel = $('#sortGroup');
  if (sortGroupSel) sortGroupSel.addEventListener('change', (e) => {
    sortPanelGroupId = e.target.value;
    renderSortPanel();
  });
  $('#trashDays').addEventListener('change', (e) => {
    state.settings.recycleBinDays = Number(e.target.value);
    save();
    renderTrashPanel();
  });
  $('#btnEmptyTrash').onclick = async () => {
    const ok = await confirmModal(t('confirm_empty_trash_title'), t('confirm_empty_trash_msg'));
    if (ok) emptyTrash();
  };

  $('#btnChooseDir').onclick = chooseBackupDir;
  $('#btnOpenDir').onclick = openBackupDir;
  $('#btnBackupNow').onclick = backupNow;

  $('#backupDir').addEventListener('change', (e) => {
    state.settings.backupDir = e.target.value.trim() || null;
    save();
  });

  $('#btnExport').onclick = async () => {
    const r = await window.api.exportData({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash });
    if (r.ok) toast(t('toast_exported') + r.path);
    else if (!r.canceled) toast(t('toast_export_fail') + r.error);
  };
  $('#btnCleanupMedia').onclick = async () => {
    const ok = await confirmModal(t('confirm_cleanup_title'), t('confirm_cleanup_msg'));
    if (!ok) return;
    const r = await window.api.cleanupOrphanMedia();
    if (r.ok) toast(t('toast_cleanup_ok').replace('{n}', r.freedCount).replace('{m}', (r.freedBytes / 1024 / 1024).toFixed(1)));
    else toast(t('toast_cleanup_fail') + (r.error || ''));
  };
  $('#btnImport').onclick = async () => {
    const r = await window.api.importData();
    if (r.ok) {
      const ok = await confirmModal(t('confirm_import_title'), t('confirm_import_msg'));
      if (ok) {
        const migrated = migrateData(r.data, uid);
        const previous = { settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash };
        state.settings = migrated.settings;
        state.groups = migrated.groups;
        state.notes = migrated.notes;
        state.trash = migrated.trash;
        ensureOrder();
        // 只补全 positionAll，不在此刻落盘/留下恢复草稿；等下面的显式 replace 提交成功再落盘。
        initAllLayout({ persist: false });
        // 确认后立即提交整份替换；force 仅供坏档导入自救，成功后才解除只读并显示成功。
        if (!(await saveNow({ replace: true, force: true }))) {
          Object.assign(state, previous);
          return;
        }
        exitDataReadonly();
        applyTheme();
        applyCustomFonts();
        syncSettingsInputs();
        renderThemePanel();
        renderGroupChips();
        renderAll();
        applyLanguage();
        switchTab('appearance');
        toast(t('toast_imported'));
      }
    } else if (!r.canceled) toast(t('toast_import_fail') + r.error);
  };

  $('#btnArrange').onclick = () => { if (arrangeNotes()) toast(t('toast_arranged_menu')); };
  // 显式恢复保存布局（无顶部按钮；设置组织区 + 画布右键菜单）。事件内再次校验，避免误用。
  const restoreBtn = $('#btnRestoreLayout');
  if (restoreBtn) {
    restoreBtn.onclick = () => {
      if (typeof restoreSavedLayout !== 'function' || typeof canRestoreSavedLayout !== 'function') return;
      if (canRestoreSavedLayout()) restoreSavedLayout();
    };
  }
  $('#btnClearAll').onclick = async () => {
    const ok = await confirmModal(t('confirm_clear_all_title'), t('confirm_clear_all_msg'));
    if (ok) {
      pushUndo();
      state.notes.forEach((n) => { if (n.desktopPin) window.api.unpinFromDesktop(n.id); n.desktopPin = false; });
      state.trash.push(...state.notes.map((n) => ({ note: n, deletedAt: Date.now() })));
      state.notes = [];
      save();
      renderAll();
      renderTrashPanel();
      toast(t('toast_moved_trash'));
    }
  };

  $('#btnAddGroup').onclick = () => {
    promptModal(t('new_group'), t('group_name'), '').then((name) => {
      if (name && name.trim()) {
        createGroup(name.trim());
        toast(t('toast_group_created'));
      }
    });
  };
}

  return { bindSettings };
}));
