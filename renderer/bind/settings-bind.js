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

function bindSettings() {
  $('#btnPin').onclick = () => {
    state.settings.alwaysOnTop = !state.settings.alwaysOnTop;
    applyTheme();
    save();
  };

  $('#btnSettings').onclick = () => {
    switchTab('appearance');
    $('#settingsOverlay').classList.remove('hidden');
    if (typeof syncZoomToolbar === 'function') syncZoomToolbar();
  };
  $('#btnCloseSettings').onclick = () => { $('#settingsOverlay').classList.add('hidden'); if (typeof syncZoomToolbar === 'function') syncZoomToolbar(); };
  $('#settingsOverlay').onclick = (e) => { if (e.target.id === 'settingsOverlay') { $('#settingsOverlay').classList.add('hidden'); if (typeof syncZoomToolbar === 'function') syncZoomToolbar(); } };

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
        state.settings = migrated.settings;
        state.groups = migrated.groups;
        state.notes = migrated.notes;
        state.trash = migrated.trash;
        ensureOrder();
        initAllLayout();
        // 导入即自救：先解除只读锁，否则 save() 会被 dataReadonly 拦截、导入内容无法落盘
        exitDataReadonly();
        save();
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

  $('#btnArrange').onclick = () => { arrangeNotes(); toast(t('toast_arranged_menu')); };
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
