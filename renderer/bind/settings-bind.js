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

  // 设置面板之上是否还有更高层模态/按键录制：有则设置键让位，不抢 Tab、也不被 Escape 关闭。
  // 动态弹窗（confirm/prompt/主题编辑器）由 dialogs.js / settings-panel.js 打上 data-modal-overlay 标记。
  function modalAboveSettings() {
    if (typeof shortcutRecordingId !== 'undefined' && shortcutRecordingId) return true;
    const overlays = ['#changelogOverlay', '#reminderOverlay', '#alarmOverlay', '#closeOverlay'];
    if (overlays.some((sel) => { const el = $(sel); return el && !el.classList.contains('hidden'); })) return true;
    return !!document.querySelector('body > [data-modal-overlay]');
  }


  let settingsOpener = null;
  let inertElements = [];

  function openSettingsPage(opener, page = 'settings') {
    const panel = $('#settingsPanel');
    if (!panel.classList.contains('hidden')) return;
    settingsOpener = opener;
    const workspace = $('#workspaceContent');
    inertElements = [$('#filterbar'), ...Array.from(workspace.children).filter((el) => el !== panel)]
      .filter((el) => !el.inert);
    inertElements.forEach((el) => { el.inert = true; });
    workspace.classList.add('settings-open');
    panel.classList.remove('hidden');
    const isSettings = page === 'settings';
    panel.classList.toggle('workspace-utility-page', !isSettings);
    const heading = $('#settingsTitle');
    const title = $('span', heading);
    $('use', heading).setAttribute('href', page === 'trash' ? '#ui-trash' : page === 'sort' ? '#ui-sort' : '#ui-settings');
    title.dataset.i18n = page === 'trash' ? 'tab_trash' :
      page === 'sort' ? 'workspace_edit_order' : 'settings_title';
    title.textContent = t(title.dataset.i18n);
    $('#btnSettings').setAttribute('aria-expanded', String(isSettings));
    switchTab(isSettings ? 'appearance' : page);
    panel.focus({ preventScroll: true });
    syncZoomToolbar();
    syncCanvasLinks();
    syncCanvasInk();
  }

  function closeSettingsPage() {
    $('#settingsPanel').classList.add('hidden');
    $('#workspaceContent').classList.remove('settings-open');
    inertElements.forEach((el) => { el.inert = false; });
    inertElements = [];
    const gear = $('#btnSettings');
    gear.setAttribute('aria-expanded', 'false');
    if (settingsOpener instanceof HTMLElement && settingsOpener.isConnected && settingsOpener.getClientRects().length) {
      settingsOpener.focus({ preventScroll: true });
    }
    if (document.activeElement !== settingsOpener) gear.focus({ preventScroll: true });
    settingsOpener = null;
    syncCanvasGadgets();
    syncZoomToolbar();
    syncCanvasLinks();
    syncCanvasInk();
  }

  function onSettingsKeydown(event) {
    if (event.key !== 'Escape' || event.defaultPrevented || modalAboveSettings() ||
        $('#settingsPanel').classList.contains('hidden')) return;
    event.preventDefault();
    closeSettingsPage();
  }

function bindSettings() {
  $('#btnPin').onclick = () => {
    state.settings.alwaysOnTop = !state.settings.alwaysOnTop;
    applyTheme();
    save();
  };

  $('#btnSettings').onclick = () => {
    if (modalAboveSettings()) return;
    const panel = $('#settingsPanel');
    const gear = $('#btnSettings');
    if (panel.classList.contains('hidden')) {
      openSettingsPage(gear);
    } else if (panel.classList.contains('workspace-utility-page')) {
      closeSettingsPage();
      openSettingsPage(gear);
    } else {
      closeSettingsPage();
    }
  };
  $('#btnWorkspaceTrash').onclick = () => {
    if (!modalAboveSettings()) openSettingsPage($('#btnWorkspaceTrash'), 'trash');
  };

  $('#btnWorkspaceSort').onclick = () => {
    if (modalAboveSettings()) return;
    const sortMode = $('#sortMode');
    if (state.settings.sortMode !== 'custom') {
      sortMode.value = 'custom';
      sortMode.dispatchEvent(new Event('change'));
    }
    openSettingsPage($('#btnToolbarMore'), 'sort');
  };
  $('#btnCloseSettings').onclick = closeSettingsPage;
  document.addEventListener('keydown', onSettingsKeydown);

  // 关闭确认弹窗按钮
  $('#btnCloseHide').onclick = () => closeDecision('hide');
  $('#btnCloseQuit').onclick = () => closeDecision('quit');
  $('#btnCloseCancel').onclick = () => closeDecision('cancel');
  const closeOverlay = $('#closeOverlay');
  closeOverlay.onclick = (e) => { if (e.target === closeOverlay) closeDecision('cancel'); };
  closeOverlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeDecision('cancel');
    } else if (e.key === 'Tab') {
      const buttons = closeOverlay.querySelectorAll('button');
      const edge = e.shiftKey ? buttons[0] : buttons[buttons.length - 1];
      if (e.target !== edge) return;
      e.preventDefault();
      (e.shiftKey ? buttons[buttons.length - 1] : buttons[0]).focus();
    }
  });

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
