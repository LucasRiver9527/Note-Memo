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

// v1.2.7 更新说明：仅列本版本新增/改进，之前版本内容不再列出。
const CHANGELOG = [
  { zh: '本版聚焦保存一致性、整理逻辑和界面细节：让主窗口保存时不再覆盖独立桌面便签的最新编辑，收紧访问检查，并改进整理、筛选提示与设置抽屉等交互', en: 'This release focuses on save consistency, arranging logic and UI details: the main window no longer overwrites your latest desktop-note edits on save, access checks are tightened, and arranging, filter hints and the settings drawer are improved' },
  { zh: '主窗保存不覆盖独立便签的最新内容：主窗口保存整份数据时保留独立桌面便签已保存的最新编辑字段，避免主窗旧内容覆盖独立窗的改动', en: 'Main-window saves keep your latest desktop-note edits: when saving the whole dataset, the newest saved fields from desktop notes are preserved so older main-window content does not overwrite them' },
  { zh: '独立便签保存失败提示与主窗一致：独立桌面便签写入失败时同样给出提示，与主窗口的保存失败处理保持一致', en: 'Desktop-note save failures match the main window: a failed desktop-note write now shows a prompt consistent with the main window’s save-failure handling' },
  { zh: '备份替换后正确同步：用备份替换数据后独立桌面便签与草稿同步到正确状态，导入失败不会留下被污染的草稿', en: 'Correct sync after backup replace: desktop notes and drafts line up correctly after replacing data from a backup, and a failed import leaves no polluted draft' },
  { zh: '加强访问检查：IPC 来源、外链、窗口导航与本地媒体访问经过更严格的校验，异常请求被拒绝', en: 'Tighter access checks: IPC origin, external links, in-window navigation and local media access are validated more strictly, and abnormal requests are rejected' },
  { zh: '整理不再隐式恢复：一键整理始终按当前顺序紧凑排列，恢复保存布局改为显式的「恢复保存布局」，并避让同一布局范围内被筛选隐藏的便签', en: 'Arranging no longer restores implicitly: arrange always packs by the current order, restoring the saved layout is an explicit action, and notes hidden by filters in the same scope are avoided' },
  { zh: '筛选条件提示：新增筛选条件提示与逐项清除，材质跟顶栏，无可清除条件时自动隐藏', en: 'Filter hints: a condition bar shows active filters with per-item clearing, follows the top bar material, and hides when there is nothing to clear' },
  { zh: '桌面便签摘要与唤起入口，便于快速回到独立便签', en: 'Desktop-note summary and reveal entry for quickly jumping back to a pinned note' },
  { zh: '文档工具栏分组并支持窄窗口换行，Markdown 导出入口保持可用', en: 'Doc toolbar groups actions and wraps in narrow windows while keeping the Markdown export entry available' },
  { zh: '斜线表头长文字自动排布避免穿线，已有斜线可再次编辑，移除改为显式操作；表格工具栏中英命名统一并显示禁用态', en: 'Diagonal headers lay out long text to avoid crossing lines, existing diagonals can be re-edited and removal is explicit; table toolbar labels are unified and show disabled states' },
  { zh: '设置中心更快地滑入与收回，不再出现右侧短暂留空，连续开关也能保持正常；快速重开正确恢复焦点，并支持「减少动态效果」', en: 'The settings drawer slides in and out faster with no brief gap on the right, and repeated toggling stays smooth; rapid reopen restores focus correctly and reduced-motion is respected' },
  { zh: '细节修正：便签底部信息换行与配色、待办输入提示对比度、弹窗焦点 / Escape 行为，以及设置与图标可访问名称', en: 'Detail fixes: note footer wrapping and colors, to-do input placeholder contrast, dialog focus/Escape behavior, and accessible names for settings controls and icons' }
];

const APP_VERSION = (window.api && window.api.appVersion) || '';

function renderChangelog() {
  const lang = (state && state.settings && state.settings.language) || 'zh';
  const list = $('#changelogList');
  list.innerHTML = CHANGELOG.map((c) => `<li>${c[lang] || c.zh}</li>`).join('');
}

let changelogOpener = null;
function openChangelog() {
  renderChangelog();
  changelogOpener = document.activeElement;
  $('#changelogOverlay').classList.remove('hidden');
  const closeBtn = $('#btnChangelogClose');
  if (closeBtn) closeBtn.focus();
}

function closeChangelog() {
  $('#changelogOverlay').classList.add('hidden');
  const opener = changelogOpener;
  changelogOpener = null;
  if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
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
    // 语言和 Markdown 会改变现有卡片的提示及富文本呈现。
    state.settings.language || 'zh',
    state.settings.markdown !== false ? 'md' : 'plain',
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
  const orders = snap.orders || {};
  state.settings.noteOrder = orders.noteOrder || [];
  state.settings.groupOrders = orders.groupOrders || {};
  // UX-30D：旧快照可能缺 sortMode/orderLayouts —— 缺键保留当前设置；存在（含空对象）按快照恢复。
  if (Object.prototype.hasOwnProperty.call(orders, 'sortMode')) state.settings.sortMode = orders.sortMode;
  if (Object.prototype.hasOwnProperty.call(orders, 'orderLayouts')) state.settings.orderLayouts = orders.orderLayouts || {};
  ensureOrder();
  if (typeof clearSelection === 'function') clearSelection();
  save();
  // 排序设置 UI 与真实排序模式保持一致（设置面板排序页 / 排序面板 / 可见控制）
  if (typeof syncSettingsInputs === 'function') syncSettingsInputs();
  if (typeof renderSortPanel === 'function') renderSortPanel();
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
// UX-30D：仅在确有变化时提交（低频显式操作），无变化保留 redo、不入栈
function commitUndoIfChanged() { UndoHistory.commitUndoIfChanged(state); }
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
      const recover = document.createElement('button');
      recover.type = 'button';
      recover.id = 'btnDataRecovery';
      recover.dataset.i18n = 'import';
      recover.textContent = t('import');
      recover.onclick = () => { $('#btnSettings').click(); switchTab('backup'); };
      bar.appendChild(recover);
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

function save(opts) {
  if (dataReadonly) return; // 损坏只读：不发起写入，避免覆盖唯一坏文件
  state.notes.forEach(cleanupRefs);
  const draftToken = window.api.captureDraft({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash });
  if (!draftToken) reportSaveError(new Error('恢复草稿写入失败'));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    state.notes.forEach(cleanupRefs);
    window.api.saveData({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash }, { draftToken, ...(opts || {}) }).catch(reportSaveError);
  }, 300);
}

function saveNow(opts) {
  if (dataReadonly && !(opts && opts.force)) return Promise.resolve(false);
  clearTimeout(saveTimer);
  saveTimer = null;
  state.notes.forEach(cleanupRefs);
  // 显式导入已有备份不生成编辑恢复草稿，避免导入失败后留下未提交的替换内容。
  const replacing = !!(opts && opts.replace);
  const draftToken = replacing ? undefined : window.api.captureDraft({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash });
  if (!replacing && !draftToken) reportSaveError(new Error('恢复草稿写入失败'));
  return window.api.saveData({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash }, { draftToken, ...(opts || {}) })
    .then(() => true, (err) => {
      reportSaveError(err);
      return false;
    });
}

// 「一键整理 / 保存当前排序」只在便签视图显示；其它视图排序简单，无需这两个按键（避免无关 bug）。
function syncSortToolbar(viewMode) {
  const arrangeBtn = $('#btnQuickArrange');
  const saveOrderBtn = $('#btnSaveOrder');
  const hidden = viewMode !== 'board' || state.notes.length === 0;
  if (arrangeBtn) arrangeBtn.classList.toggle('hidden', hidden);
  if (saveOrderBtn) saveOrderBtn.classList.toggle('hidden', hidden);
  if (typeof syncToolbarMore === 'function') syncToolbarMore();
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
      if (r.recovery) {
        const restore = await confirmModal(t('recovery_title'), t('recovery_message'));
        try {
          const resolved = await window.api.resolveRecovery(restore ? 'restore' : 'discard');
          if (!resolved.ok) throw new Error('recovery resolve failed');
          if (restore) { data = resolved.data; loadStatus = 'ok'; }
        } catch (err) {
          console.error('[recovery] 恢复草稿处理失败：', err);
          loadStatus = 'error';
          reportSaveError(err);
        }
      }
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
  if (loadStatus === 'corrupt' || loadStatus === 'error') enterDataReadonly();

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
  syncViewToggles(state.settings.viewMode);
  syncSortToolbar(state.settings.viewMode);

  setInterval(() => purgeTrash(), 60 * 60 * 1000);

  registerIpc();
}

init();
