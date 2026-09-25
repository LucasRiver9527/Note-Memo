/* ============ 便签 - 渲染进程逻辑 ============ */

// $ / $$ / toast 已拆分到 core/dom.js（L1 零依赖，挂顶层全局）

const NOTE_COLORS = ['#000000', '#1e1e28', '#2d2f38', '#24344d', '#3a2a4d', '#1f3d33', '#4d2a2a', '#f7d65a', '#ffb3c1', '#a8e6cf', '#a0d8ff', '#d0b3ff', '#ffd8a8', '#f5a97f', '#e6c9ff'];
const ACCENTS = ['#6c5ce7', '#e84393', '#00b894', '#0984e3', '#e17055', '#fdcb6e', '#00cec9', '#d63031', '#2ecc71', '#5b8cff'];
const HIGHLIGHT_COLORS = ['#fff59d', '#ffd54f', '#ffb3c1', '#a8e6cf', '#a0d8ff', '#d0b3ff', '#ffd8a8', '#ff8a80', '#b2ff59', '#80d8ff'];

const PRESETS = [
  { id: 'mint', name: '薄荷', en: 'Mint', light: true, bg: '#eafaf1', accent: '#00b894', mini: ['#00b894', '#a8e6cf'] },
  { id: 'dark', name: '深夜', en: 'Midnight', light: false, bg: '#1e1f26', accent: '#6c5ce7', mini: ['#6c5ce7', '#f7d65a'] },
  { id: 'light', name: '纯净', en: 'Clean', light: true, bg: '#f4f5fa', accent: '#6c5ce7', mini: ['#6c5ce7', '#ffd8a8'] },
  { id: 'midnight', name: '午夜蓝', en: 'Navy', light: false, bg: '#131726', accent: '#5b8cff', mini: ['#5b8cff', '#00cec9'] },
  { id: 'forest', name: '森林', en: 'Forest', light: false, bg: '#152019', accent: '#2ecc71', mini: ['#2ecc71', '#a8e6cf'] },
  { id: 'sunset', name: '暮色', en: 'Sunset', light: false, bg: '#241820', accent: '#e84393', mini: ['#e84393', '#ffb3c1'] },
  { id: 'paper', name: '羊皮纸', en: 'Paper', light: true, bg: '#f3ecd9', accent: '#b8860b', mini: ['#b8860b', '#f7d65a'] },
  { id: 'ocean', name: '海洋', en: 'Ocean', light: false, bg: '#0e1f2f', accent: '#00bcd4', mini: ['#00bcd4', '#a0d8ff'] },
  { id: 'sakura', name: '樱花', en: 'Sakura', light: true, bg: '#fff0f3', accent: '#ff6b9d', mini: ['#ff6b9d', '#ffd8e6'] },
  { id: 'graphite', name: '石墨', en: 'Graphite', light: false, bg: '#202124', accent: '#9aa0a6', mini: ['#9aa0a6', '#5f6368'] },
  { id: 'coffee', name: '咖啡', en: 'Coffee', light: false, bg: '#2b1d14', accent: '#c47f5a', mini: ['#c47f5a', '#8a5a3a'] },
  { id: 'aurora', name: '极光', en: 'Aurora', light: false, bg: '#101d2b', accent: '#48c6ef', mini: ['#48c6ef', '#7b68ee'] }
];

const FONTS = {
  system: '-apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
  "'Segoe UI', sans-serif": "'Segoe UI', sans-serif",
  "'Microsoft YaHei', sans-serif": "'Microsoft YaHei', sans-serif",
  "'KaiTi', 'STKaiti', serif": "'KaiTi', 'STKaiti', serif",
  "'FangSong', 'STFangsong', serif": "'FangSong', 'STFangsong', serif",
  "'Consolas', monospace": "'Consolas', monospace"
};

const FONT_OPTIONS = [
  { v: 'system', label: '系统默认' },
  { v: "'Segoe UI', sans-serif", label: 'Segoe UI' },
  { v: "'Microsoft YaHei', sans-serif", label: '微软雅黑' },
  { v: "'KaiTi', 'STKaiti', serif", label: '楷体' },
  { v: "'FangSong', 'STFangsong', serif", label: '仿宋' },
  { v: "'Consolas', monospace", label: '等宽 Consolas' }
];

const TEXT_COLORS = ['#2d2f38', '#000000', '#444444', '#ffffff', '#c0392b', '#b8860b', '#1e5a8a', '#1e7d5a', '#5b2d8f', '#7f8c8d'];

// settings 默认值 / 取值 / 迁移已收归 state.js（见 StateLogic 顶层全局）

function t(key) {
  const lang = (state && state.settings && state.settings.language) || 'zh';
  return T(key, lang);
}

// v1.2.5 更新说明：仅列本版本新增/改进，之前版本内容不再列出。
const CHANGELOG = [
  { zh: '一键排列改良：可切换策略（紧凑 / 书架 / 网格 / 置顶优先 / 按分组分段）', en: 'Arrange improvements: switchable strategies (compact / shelf / grid / pinned-first / by group segments)' },
  { zh: '保存当前排序 ↔ 一键整理 联动：保存排序记录顺序+位置快照，一键整理在所有视图精确恢复', en: 'Save-order + one-click-arrange: saving records order & position snapshot; arrange restores it precisely in every view' },
  { zh: '画布缩放 / 平移：Ctrl+滚轮缩放、空格或中键平移，右下角工具栏一键恢复 100%', en: 'Canvas zoom & pan: Ctrl+wheel to zoom, Space/middle-drag to pan, toolbar to reset to 100%' },
  { zh: '便签框选：空白处拖框多选，配合批量删除、移动分组、整组拖动', en: 'Box select: drag a box on empty canvas to multi-select for batch delete / move-to-group / drag group' },
  { zh: '分组折叠：折叠隐藏分组便签，取消折叠精确恢复折叠前布局', en: 'Group collapse: fold a group to hide its notes, un-collapse restores the exact prior layout' },
  { zh: '最近使用分组：常用分组自动置顶，切换更顺手', en: 'Recently-used groups: frequently used groups moved to the front for quicker switching' },
  { zh: '空白画布右键快捷插入：新建便签 / 新建待办 / 粘贴为新便签 / 一键整理', en: 'Right-click quick insert on empty canvas: new note / new to-do / paste as note / arrange all' },
  { zh: 'Markdown 预览：便签与文档可切换为只读预览，直接看到加粗、高亮、图片、表格等渲染效果', en: 'Markdown preview: toggle notes & docs to a read-only view showing bold, highlight, images, tables rendered' },
  { zh: '便签归档 / 置灰：归档便签移出常规视图，提供单独「归档」入口查看与恢复', en: 'Archive / gray-out: archived notes leave the normal view, with a dedicated Archive entry to view & restore' },
  { zh: '撤销 / 重做完善：新建、删除、移动、缩放、分组等结构操作可撤销重做', en: 'Fuller undo/redo: undo & redo for create, delete, move, resize and group operations' },
  { zh: '撤销 / 重做加入全局快捷键：Ctrl+Z / Ctrl+Shift+Z，可在全局设置内改键', en: 'Undo/redo shortcuts added: Ctrl+Z / Ctrl+Shift+Z, rebindable in global settings' },
  { zh: '提醒稍后再响：闹铃可延后 5 / 10 / 30 分钟再次提醒', en: 'Reminder snooze: postpone the alarm by 5 / 10 / 30 minutes' },
  { zh: '标签建议：按笔记内容在「添加到分组」里自动推荐最合适的分组', en: 'Group suggestions: auto-suggest the best-matching group when assigning a note' },
  { zh: '快捷键系统：全局唤起 / 新建 + 编辑器加粗、高亮、对齐等，均可在设置内改键与恢复默认', en: 'Shortcut system: global & editor shortcuts, all rebindable and resettable in settings' },
  { zh: '分组芯片左右滚动箭头；画布滚动条随内容自适应', en: 'Left/right scroll arrows for group chips; adaptive canvas scrollbar' },
  { zh: '主题化关闭确认弹窗；窗口尺寸与最大化状态跨重启记忆；亚克力下顶栏控件更清晰统一', en: 'Themed close-confirm dialog; window size & maximized state remembered across restarts; clearer title-bar controls under acrylic' },
  { zh: '右键菜单「精简 / 完整」双模式：默认精简，低频操作收进二级子菜单，删除固定在最后；偏好持久化', en: 'Context menu compact/full modes: compact by default with low-frequency actions in submenus, Delete always last; preference persisted' },
  { zh: '菜单外观归位：透明度 / 亚克力移到「设置 → 外观 → 便签」，不再挂在右键菜单底部', en: 'Menu appearance moved to Settings → Appearance → Notes (opacity & acrylic), no longer a footer in the context menu' },
  { zh: '便签工具栏：精简模式次要按钮收进「更多」，可在设置内显示 / 隐藏按钮；标题短时工具栏靠右，标题长时自动换行', en: 'Note toolbar: secondary buttons fold under “More” in compact mode, per-button show/hide in settings; stays right of short titles and wraps for long ones' },
  { zh: '修复表格越界行列 / 负数索引导致的崩溃与数据错乱（3 个边界 bug）', en: 'Fixed table crashes and data corruption from out-of-range rows/cols or negative indices (3 boundary bugs)' }
];

const APP_VERSION = (window.api && window.api.appVersion) || '';

function renderChangelog() {
  const lang = (state && state.settings && state.settings.language) || 'zh';
  const list = $('#changelogList');
  list.innerHTML = CHANGELOG.map((c) => `<li>${c[lang] || c.zh}</li>`).join('');
}

function openChangelog() {
  renderChangelog();
  $('#changelogOverlay').classList.remove('hidden');
}

function closeChangelog() {
  $('#changelogOverlay').classList.add('hidden');
}

// ---- 共享可变状态统一由 core/app-state.js 持有（跨模块同一份） ----
// install 在顶层全局定义访问器（multiSelect / state / filter 等），
// 因此 notes-view.js 等经典脚本里的裸读写继续生效，无需改调用点。
AppState.install(window);

function initStateStore() {
  AppState.initState({ settings: { ...DEFAULT_SETTINGS }, groups: [], notes: [], trash: [] });
}
initStateStore();

// 批量选中：一组被选中的便签 id（Set），multiSelect 开启后点击即切换选中
// （multiSelect / selectedNotes / filter / zCounter / saveTimer / activeColorPop / activeGroupPop /
//   dragSortId / docNoteId / savedRange / savedSelText / savedNoteId / savedImageSrc / copiedImage /
//   richCache / lastRenderView / boardEls 等状态已在 core/app-state.js 声明，此处不再重复 let）

// 便签卡片渲染指纹：任一影响卡片的属性变化都会导致该卡片重建
function noteFingerprint(n) {
  const p = effPos(n);
  return [
    n.id, n.title || '', n.content || '',
    n.color || '', n.textColor || '', n.fontSize || '', n.fontFamily || '',
    n.pinned ? 1 : 0, n.groupId || '', n.type || '',
    n.archived ? 1 : 0, n.preview ? 1 : 0,
    p.x || 0, p.y || 0, n.w || 0, n.h || 0, n.z || 0,
    n.reminder ? (n.reminder.time || '') + '/' + (n.reminder.fired ? 1 : 0) : '',
    // 工具栏全局外观：变化时需重建卡片才能反映显隐/精简（否则增量渲染会复用旧 DOM）
    state.settings.noteToolbarCompact !== false ? 'c' : 'f',
    (state.settings.noteToolbarHidden || []).join(','),
    JSON.stringify(n.images || []), JSON.stringify(n.files || []), JSON.stringify(n.tables || [])
  ].join('|');
}

/* ============ 撤销 / 重做（结构操作快照历史） ============ */
// 快照栈与纯快照逻辑已拆分到 core/undo-history.js（UndoHistory，挂顶层全局）。
// 此处只保留「应用快照」——它依赖 ensureOrder/renderAll 等上层函数，故留在 app.js，
// 并通过 UndoHistory.setApplier 注入，避免 L2 反向依赖。
function applySnapshot(snap) {
  if (!snap) return;
  state.notes = snap.notes;
  state.trash = snap.trash;
  state.groups = snap.groups || [];
  state.settings.noteOrder = (snap.orders && snap.orders.noteOrder) || [];
  state.settings.groupOrders = (snap.orders && snap.orders.groupOrders) || {};
  ensureOrder();
  if (typeof clearSelection === 'function') clearSelection();
  save();
  renderAll();
  // 撤销/重做可能改变分组或回收站，刷新相应列表（若有）
  if (typeof renderGroupChips === 'function') renderGroupChips();
  if (typeof renderTrashPanel === 'function') renderTrashPanel();
}
// 薄包装：把 state 注入 core/undo-history.js（保持 pushUndo() / undo() / redo() 调用签名不变）
function pushUndo() { UndoHistory.pushUndo(state); }
// 延迟提交：拖动/缩放「按下即开始、松开才知道是否真变化」，避免点击无位移留下无用历史项
function beginUndo() { UndoHistory.beginUndo(state); }
function commitUndo() { UndoHistory.commitUndo(); }
function cancelUndo() { UndoHistory.cancelUndo(); }
function undo() { UndoHistory.undo(state); }
function redo() { UndoHistory.redo(state); }
function syncUndoButtons() { UndoHistory.syncUndoButtons(); }

// 让快照栈能回调本文件的 applySnapshot
UndoHistory.setApplier(applySnapshot);

/* ============ 工具函数 ============ */
function defaultNoteColor() {
  return state.settings.noteColor || DEFAULT_NOTE_COLOR;
}

// 分组芯片区左右箭头状态刷新：无可滚动/在最左/在最右时置灰；无分组时隐藏。供芯片重渲染后调用。
function refreshChipsScroll() {
  const wrap = $('#groupChips');
  const left = $('#btnChipsLeft');
  const right = $('#btnChipsRight');
  if (!wrap || !left || !right) return;
  const empty = wrap.childElementCount === 0;
  left.classList.toggle('hidden', empty);
  right.classList.toggle('hidden', empty);
  const max = wrap.scrollWidth - wrap.clientWidth;
  left.disabled = empty || max <= 0 || wrap.scrollLeft <= 1;
  right.disabled = empty || max <= 0 || wrap.scrollLeft >= max - 1;
}

function getTheme() {
  const id = state.settings.themeId;
  return PRESETS.find((p) => p.id === id)
    || (state.settings.customThemes || []).find((t) => t.id === id)
    || PRESETS.find((p) => p.id === DEFAULT_THEME_ID) || PRESETS[0];
}

function isLightTheme() {
  const mode = state.settings.appearanceMode || 'auto';
  if (mode === 'light') return true;
  if (mode === 'dark') return false;
  return getTheme().light;
}

function currentBg() {
  const s = state.settings;
  const preset = getTheme();
  const mode = s.appearanceMode || 'auto';
  let light = preset.light;
  if (mode === 'light') light = true;
  if (mode === 'dark') light = false;
  let bg = s.canvasColor || preset.bg;
  if (!s.canvasColor) {
    if (mode === 'light') bg = '#f4f5fa';
    else if (mode === 'dark') bg = '#1e1f26';
  }
  return bg;
}

function themeName(p) {
  return (state.settings.language === 'en' && p.en) ? p.en : p.name;
}

function resolveFontCss(key) {
  if (!key || key === 'system') return FONTS.system;
  if (FONTS[key]) return FONTS[key];
  const cf = (state.settings.customFonts || []).find((f) => f.family === key);
  if (cf) return "'" + cf.family + "', sans-serif";
  return FONTS.system;
}

function highlightColor() {
  return state.settings.highlightColor || '#fff59d';
}

// 富文本/表格 HTML 构建（formatInlineText / inlineImgHtml / fileLinkHtml / tableBlockHtml / renderRichContent）
// 已统一到 logic.js（单一来源），此处由 logic.js 全局提供；仅保留渲染时注入翻译上下文。
setRenderLocale({ tr: t, mdOn: () => state.settings.markdown !== false });

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `${t('today')} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// toast() 已拆分到 core/dom.js（挂顶层全局）

// 保存失败提示：不静默丢数据（已尝试 toast 一次，避免每次保存都弹）
// （saveErrorShown 见 core/app-state.js）
function reportSaveError(err) {
  console.error('[save] 数据保存失败：', err);
  if (!saveErrorShown) {
    saveErrorShown = true;
    try { toast(t('toast_save_failed')); } catch (_) {}
  }
}

// 数据损坏只读保护：拦截写入、禁用画布置交互，并常驻警告条引导「导入备份」自救。
// 只读闸门不依赖 notes-view.js 内部逻辑，只从 app.js 顶层生效，避免改动 2774 行的大文件。
// （dataReadonly 见 core/app-state.js）
function enterDataReadonly() {
  if (dataReadonly) return;
  dataReadonly = true;
  document.body.classList.add('data-readonly');
  try {
    const bar = $('#dataAlert');
    if (bar) {
      bar.textContent = t('toast_data_corrupt_locked');
      bar.classList.remove('hidden');
    }
  } catch (_) {}
  try { toast(t('toast_data_corrupt_locked')); } catch (_) {}
}

function exitDataReadonly() {
  if (!dataReadonly) return;
  dataReadonly = false;
  document.body.classList.remove('data-readonly');
  try {
    const bar = $('#dataAlert');
    if (bar) bar.classList.add('hidden');
  } catch (_) {}
}

function save() {
  if (dataReadonly) return; // 损坏只读：不发起写入，避免覆盖唯一坏文件
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    state.notes.forEach(cleanupRefs);
    window.api.saveData({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash }).catch(reportSaveError);
  }, 300);
}

function saveNow() {
  if (dataReadonly) return;
  clearTimeout(saveTimer);
  state.notes.forEach(cleanupRefs);
  window.api.saveData({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash }).catch(reportSaveError);
}

// 「一键整理 / 保存当前排序」只在便签视图显示；其它视图排序简单，无需这两个按键（避免无关 bug）。
function syncSortToolbar(viewMode) {
  const arrangeBtn = $('#btnQuickArrange');
  const saveOrderBtn = $('#btnSaveOrder');
  if (arrangeBtn) arrangeBtn.classList.toggle('hidden', viewMode !== 'board');
  if (saveOrderBtn) saveOrderBtn.classList.toggle('hidden', viewMode !== 'board');
}

/* ============ 主题 / 字体 / 语言 / 设置面板（已拆分到 settings-panel.js，见全局 SettingsPanel） ============ */
/* ============ 排序 / 整理排列（已拆分到 system/arrange.js，挂顶层全局） ============ */

/* ============ 快捷键设置 / 快速保存排序（已拆分到 system/shortcuts-panel.js + system/arrange.js） ============ */
/* ============ 便签视图 / 表格 / 待办区 / 主渲染 / 回收站 / 批量 / 颜色分组弹窗（已拆分到 notes-view.js，经典脚本） ============ */
/* ============ 待办提醒 / 闹铃声音 / 闹铃提醒弹窗（已拆分到 system/alarm.js） ============ */

/* ============ 通用弹窗 / 关闭确认弹窗 / 备份（已拆分到 system/dialogs.js） ============ */
function switchTab(name) {
  $$('.sp-nav-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.sp-tab').forEach((s) => s.classList.toggle('hidden', s.dataset.tab !== name));
  if (name === 'appearance') { syncSettingsInputs(); renderThemePanel(); }
  if (name === 'font') { renderFontSelect(); renderFontList(); syncSettingsInputs(); }
  if (name === 'reminder') syncSettingsInputs();
  if (name === 'sort') renderSortPanel();
  if (name === 'shortcuts') renderShortcutPanel();
  if (name === 'backup') { const el = $('#backupDir'); if (el) el.value = state.settings.backupDir || ''; }
  if (name === 'trash') renderTrashPanel();
  if (name === 'about') syncSettingsInputs();
}

/* ============ 事件绑定（薄壳调度器） ============ */
// 各域绑定已拆分到 bind/*（board / batch / settings / appearance），此处仅按域聚合。
function bindUI() {
  bindBoard();
  bindBatch();
  bindSettings();
  bindAppearance();
}

/* ============ 提示气泡（已拆分到 system/dialogs.js） ============ */

/* ============ 初始化 ============ */
async function init() {
  bindUI();
  initTooltips();
  bindGlobalInput();

  // data:load 现返回 { data, status, corruptPath }；status 区分首次运行与数据损坏
  let data = null;
  let loadStatus = 'ok';
  try {
    const r = await window.api.loadData();
    // 兼容：万一拿到旧形状（直接是数据对象）也不至于崩
    if (r && typeof r === 'object' && 'status' in r) {
      data = r.data || null;
      loadStatus = r.status || 'ok';
    } else {
      data = r || null;
    }
  } catch (err) {
    // 读取失败不静默：记录日志并提示（避免用户误以为数据被清空）
    console.error('[data] 读取数据失败：', err);
    loadStatus = 'error';
    try { toast(t('toast_load_failed')); } catch (_) {}
  }
  if (data) {
    // A3：设置单一入口 + 数据迁移集中到 state.js（migrateData），就地回填默认值/版本迁移/补齐便签字段
    const migrated = migrateData(data, uid);
    state.settings = migrated.settings;
    state.groups = migrated.groups;
    state.notes = migrated.notes;
    state.trash = migrated.trash;
  }
  // 损坏且无可用备份：进入只读，防止任何写入覆盖用户仅存的坏文件（留待「导入备份」自救）
  if (loadStatus === 'corrupt') enterDataReadonly();

  ensureOrder();
  initAllLayout();
  purgeTrash();
  applyCustomFonts();
  applyTheme();
  applyLanguage();

  if (!state.settings.lastSeenVersion || state.settings.lastSeenVersion !== APP_VERSION) {
    state.settings.lastSeenVersion = APP_VERSION;
    save();
    openChangelog();
  }

  syncSettingsInputs();
  renderThemePanel();
  renderGroupChips();
  renderAll();
  $('#viewBoard').classList.toggle('active', state.settings.viewMode !== 'memo' && state.settings.viewMode !== 'todo' && state.settings.viewMode !== 'doc');
  $('#viewMemo').classList.toggle('active', state.settings.viewMode === 'memo');
  $('#viewTodo').classList.toggle('active', state.settings.viewMode === 'todo');
  $('#viewDoc').classList.toggle('active', state.settings.viewMode === 'doc');
  syncSortToolbar(state.settings.viewMode);

  setInterval(() => purgeTrash(), 60 * 60 * 1000);

  registerIpc();
}

init();
