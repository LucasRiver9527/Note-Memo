/* bind/appearance-bind.js
   承接 bindUI 的「外观输入 / 主题预设 / 待办区样式 / 提醒设置 / 待办与闹铃弹窗 / 窗口 resize」切片。
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.bindAppearance。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.bindAppearance = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

function bindAppearance() {
  // 外观输入
  $('#noteOpacity').addEventListener('input', (e) => { state.settings.noteOpacity = Number(e.target.value); applyTheme(); });
  $('#noteOpacity').addEventListener('change', save);
  $('#noteColorInput').addEventListener('input', (e) => { state.settings.noteColor = e.target.value; });
  $('#noteColorInput').addEventListener('change', save);
  $('#noteRadius').addEventListener('input', (e) => { state.settings.noteRadius = Number(e.target.value); applyTheme(); });
  $('#noteRadius').addEventListener('change', save);
  $('#noteShadow').addEventListener('input', (e) => { state.settings.noteShadow = Number(e.target.value); applyTheme(); });
  $('#noteShadow').addEventListener('change', save);
  $('#noteBorderWidth').addEventListener('input', (e) => { state.settings.noteBorderWidth = Number(e.target.value); applyTheme(); });
  $('#noteBorderWidth').addEventListener('change', save);
  $('#noteBorderColor').addEventListener('input', (e) => { state.settings.noteBorderColor = e.target.value; applyTheme(); });
  $('#noteBorderColor').addEventListener('change', save);
  $('#noteLetterSpacing').addEventListener('input', (e) => { state.settings.noteLetterSpacing = Number(e.target.value); applyTheme(); });
  $('#noteLetterSpacing').addEventListener('change', save);
  $('#btnResetNoteColor').onclick = () => {
    state.settings.noteColor = DEFAULT_NOTE_COLOR;
    syncSettingsInputs();
    save();
    toast(t('toast_note_bg_reset'));
  };
  $('#winOpacity').addEventListener('input', (e) => { state.settings.winOpacity = Number(e.target.value); applyTheme(); });
  $('#winOpacity').addEventListener('change', save);
  $('#fontSize').addEventListener('input', (e) => { state.settings.fontSize = Number(e.target.value); applyTheme(); });
  $('#fontSize').addEventListener('change', (e) => { state.settings.fontSize = Number(e.target.value); save(); window.api.setFontSize(Number(e.target.value)); });
  $('#fontFamily').addEventListener('change', (e) => { state.settings.fontFamily = e.target.value; applyTheme(); save(); });
  $('#noteTextColor').addEventListener('input', (e) => { state.settings.noteTextColor = e.target.value; applyTheme(); renderAll(); });
  $('#noteTextColor').addEventListener('change', save);
  $('#customAccent').addEventListener('input', (e) => { state.settings.accent = e.target.value; applyTheme(); renderThemePanel(); });
  $('#customAccent').addEventListener('change', save);
  $('#canvasColor').addEventListener('input', (e) => { state.settings.canvasColor = e.target.value; applyTheme(); });
  $('#canvasColor').addEventListener('change', save);
  $('#backgroundMode').addEventListener('change', (e) => { state.settings.backgroundMode = e.target.value; applyBackground(); applyTheme(); save(); });
  $('#bgOpacity').addEventListener('input', (e) => { state.settings.bgOpacity = Number(e.target.value); applyBackground(); applyTheme(); });
  $('#bgOpacity').addEventListener('change', save);
  $('#bgReadabilityToggle').addEventListener('change', (e) => { state.settings.backgroundReadability = e.target.checked; applyTheme(); save(); });
  $('#topBarOpacity').addEventListener('input', (e) => { state.settings.topBarOpacity = Number(e.target.value); applyBackground(); });
  $('#topBarOpacity').addEventListener('change', save);
  $('#topBarAcrylicToggle').addEventListener('change', (e) => {
    state.settings.topBarAcrylic = e.target.checked;
    if (e.target.checked && (state.settings.topBarOpacity == null || state.settings.topBarOpacity >= 100)) {
      state.settings.topBarOpacity = 25;
    } else if (!e.target.checked) {
      state.settings.topBarOpacity = 100;
    }
    syncSettingsInputs();
    applyTheme();
    save();
  });
  $('#topBarColor').addEventListener('input', (e) => { state.settings.topBarColor = e.target.value; applyBackground(); });
  $('#topBarColor').addEventListener('change', save);

  $('#todoSearchColor').addEventListener('input', (e) => { state.settings.todoSearchColor = e.target.value; applyTodoStyle(); });
  $('#todoSearchColor').addEventListener('change', save);
  $('#todoSearchOpacity').addEventListener('input', (e) => { state.settings.todoSearchOpacity = Number(e.target.value); applyTodoStyle(); });
  $('#todoSearchOpacity').addEventListener('change', save);
  $('#todoItemsColor').addEventListener('input', (e) => { state.settings.todoItemsColor = e.target.value; applyTodoStyle(); });
  $('#todoItemsColor').addEventListener('change', save);
  $('#todoItemsOpacity').addEventListener('input', (e) => { state.settings.todoItemsOpacity = Number(e.target.value); applyTodoStyle(); });
  $('#todoItemsOpacity').addEventListener('change', save);
  $('#todoRemindColor').addEventListener('input', (e) => { state.settings.todoRemindColor = e.target.value; applyTodoStyle(); });
  $('#todoRemindColor').addEventListener('change', save);
  $('#todoRemindOpacity').addEventListener('input', (e) => { state.settings.todoRemindOpacity = Number(e.target.value); applyTodoStyle(); });
  $('#todoRemindOpacity').addEventListener('change', save);
  $('#btnResetTodoArea').onclick = () => {
    state.settings.todoSearchColor = null;
    state.settings.todoItemsColor = null;
    state.settings.todoRemindColor = null;
    state.settings.todoSearchOpacity = 100;
    state.settings.todoItemsOpacity = 100;
    state.settings.todoRemindOpacity = 100;
    syncSettingsInputs();
    applyTodoStyle();
    save();
    toast(t('toast_todo_reset'));
  };

  $('#btnPickImage').onclick = async () => {
    const r = await window.api.pickImage();
    if (r.ok) {
      state.settings.backgroundImage = r.url;
      applyBackground();
      save();
      toast(t('toast_bg_set'));
    } else if (!r.canceled) {
      toast(t('toast_set_fail') + r.error);
    }
  };
  $('#btnClearImage').onclick = () => {
    state.settings.backgroundImage = null;
    applyBackground();
    save();
    toast(t('toast_bg_cleared'));
  };
  $('#btnResetTheme').onclick = () => {
    state.settings = { ...DEFAULT_SETTINGS };
    syncSettingsInputs();
    renderThemePanel();
    applyTheme();
    save();
    toast(t('toast_reset'));
  };

  $('#btnDefaultTheme').onclick = () => {
    const def = PRESETS.find((p) => p.id === DEFAULT_THEME_ID) || PRESETS[0];
    state.settings.themeId = def.id;
    state.settings.canvasColor = null;
    state.settings.accent = def.accent;
    state.settings.appearanceMode = 'auto';
    syncSettingsInputs();
    renderThemePanel();
    applyTheme();
    save();
    toast(t('toast_theme_updated'));
  };

  $('#glassToggle').addEventListener('change', (e) => { state.settings.glass = e.target.checked; applyTheme(); save(); });
  $('#desktopMicaToggle').addEventListener('change', (e) => { state.settings.desktopMica = e.target.checked; applyTheme(); save(); });
  $('#markdownToggle').addEventListener('change', (e) => { state.settings.markdown = e.target.checked; renderAll(); save(); });
  // 菜单外观：原挂在每一个右键菜单底部（与本便签无关的全局设置，且易误触）→ 归位到设置页
  $('#menuOpacity').addEventListener('input', (e) => { state.settings.menuOpacity = Number(e.target.value); applyMenuAppearance(); });
  $('#menuOpacity').addEventListener('change', save);
  $('#menuAcrylicToggle').addEventListener('change', (e) => { state.settings.menuAcrylic = e.target.checked; applyMenuAppearance(); save(); });
  // 便签工具栏：精简开关 + 按钮显隐（即时重建便签卡片）
  const ntc = $('#noteToolbarCompact');
  if (ntc) ntc.addEventListener('change', (e) => { state.settings.noteToolbarCompact = e.target.checked; renderAll(); save(); });
  $$('#noteToolbarVis input[data-tool]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const set = new Set(state.settings.noteToolbarHidden || []);
      if (cb.checked) set.delete(cb.dataset.tool); else set.add(cb.dataset.tool);
      state.settings.noteToolbarHidden = Array.from(set);
      renderAll();
      save();
    });
  });
  $('#highlightColorInput').addEventListener('input', (e) => { state.settings.highlightColor = e.target.value; applyTheme(); });
  $('#highlightColorInput').addEventListener('change', save);

  // 外观模块切换
  $$('#appearanceModuleSeg .seg').forEach((b) => {
    b.onclick = () => {
      $$('#appearanceModuleSeg .seg').forEach((x) => x.classList.toggle('active', x === b));
      const isMain = b.dataset.appModule === 'main';
      const mainEl = $('#appModuleMain');
      const noteEl = $('#appModuleNote');
      if (mainEl) mainEl.classList.toggle('hidden', !isMain);
      if (noteEl) noteEl.classList.toggle('hidden', isMain);
    };
  });

  // 提醒设置
  $('#reminderSoundToggle').addEventListener('change', (e) => { state.settings.reminderSound = e.target.checked; save(); });
  $('#reminderVolume').addEventListener('input', (e) => { state.settings.reminderVolume = Number(e.target.value); });
  $('#reminderVolume').addEventListener('change', save);
  $('#btnPickSound').onclick = async () => {
    const r = await window.api.pickSound();
    if (r.ok) {
      state.settings.reminderSoundPath = r.url;
      state.settings.reminderSoundName = r.name;
      syncSettingsInputs();
      save();
      toast(t('toast_sound_set'));
    } else if (!r.canceled) {
      toast(t('toast_set_fail') + r.error);
    }
  };
  $('#btnClearSound').onclick = () => {
    state.settings.reminderSoundPath = null;
    state.settings.reminderSoundName = null;
    syncSettingsInputs();
    save();
    toast(t('toast_sound_cleared'));
  };
  $('#btnTestSound').onclick = () => {
    previewReminderSound();
  };

  // 待办提醒弹窗
  $('#btnReminderCancel').onclick = closeReminder;
  $('#reminderOverlay').onclick = (e) => { if (e.target.id === 'reminderOverlay') closeReminder(); };

  // 闹铃提醒弹窗
  $('#btnAlarmDismiss').onclick = dismissAlarm;
  $('#btnAlarmSnooze5').onclick = () => snoozeAlarm(5);
  $('#btnAlarmSnooze10').onclick = () => snoozeAlarm(10);
  $('#btnAlarmSnooze30').onclick = () => snoozeAlarm(30);
  $('#alarmOverlay').onclick = (e) => { if (e.target.id === 'alarmOverlay') dismissAlarm(); };
  $('#btnReminderSave').onclick = () => {
    const val = $('#reminderInput').value;
    const n = state.notes.find((x) => x.id === reminderNoteId);
    if (n && val) {
      n.reminder = { enabled: true, time: new Date(val).toISOString(), fired: false };
      n.updatedAt = Date.now();
      save();
      renderAll();
      toast(t('toast_todo_set'));
    }
    closeReminder();
  };

  // 窗口尺寸变化后，让画布尺寸跟随视口（内容不溢出时收起滚动条）
  window.addEventListener('resize', () => {
    if (state.settings.viewMode === 'board' && typeof syncBoardSize === 'function') syncBoardSize();
  });
}

  return { bindAppearance };
}));
