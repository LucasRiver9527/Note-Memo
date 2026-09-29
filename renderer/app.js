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

// v1.2.6 更新说明：仅列本版本新增/改进，之前版本内容不再列出。
const CHANGELOG = [
  { zh: '测试版说明：这是面向 1.2.5 稳定版用户的 1.2.6 测试版，功能与稳定性仍可能继续调整，更新前请先备份重要数据，使用中遇到问题欢迎反馈', en: 'Test build: this is the 1.2.6 test build for 1.2.5 stable users; features and stability may still change, so back up important data before updating and report any issues you find' },
  { zh: '数据恢复：异常退出或保存中断时，本机保留恢复草稿，下次启动由你选择恢复或丢弃，不会自动覆盖正式存档', en: 'Data recovery: if the app exits abnormally or a save is interrupted, a local recovery draft is kept and offered at next launch — you choose to restore or discard; saved data is never overwritten automatically' },
  { zh: '更稳妥的保存与退出：退出、安装更新、钉到桌面等操作会等待便签保存成功，失败时明确提示，避免改动丢失', en: 'Safer saving & exit: quitting, installing updates and pinning to desktop wait for notes to save and warn on failure so changes are not lost' },
  { zh: '存档结构校验：读取存档与 .bak 时做最低限度结构检查，发现明显损坏时保留原文件证据并进入恢复 / 只读保护', en: 'Save-file checks: main data and .bak are structure-checked on load; obvious corruption is preserved as evidence and the app falls back to recovery / read-only protection' },
  { zh: '搜索与空结果：搜索框随窗口宽度自适应；画布、备忘录、文档、待办筛选无结果时明确提示「没有匹配的内容」并提供「清除筛选」', en: 'Search & empty results: the search box stretches with the window; canvas, memo, doc and to-do views clearly show “no matching content” with a “clear filters” action when nothing matches' },
  { zh: '窄窗口布局：顶部在窄窗口拆分为操作行与搜索行，整理 / 保存排序 / 批量选择收入「更多」；空画布提供「＋ 新建」按钮', en: 'Narrow layout: the top bar splits into an actions row and a search row, with arrange / save order / batch select under “More”; an empty canvas offers a “＋ New” button' },
  { zh: '画布平移：空格＋左键或鼠标中键可从便签区域起拖平移画布，输入区空格仍用于输入', en: 'Canvas panning: Space+left-drag or middle-drag pans the canvas from the note area, while Space still types in input fields' },
  { zh: '文档导出 Markdown：文档模式新增「导出为 Markdown」，工具栏在背景图上更清晰', en: 'Doc Markdown export: docs can be exported to Markdown; the toolbar stays legible over background images' },
  { zh: '工具栏整理：备忘录操作键靠右排列；切换语言或 Markdown 开关后画布卡片即时刷新，无需重启', en: 'Toolbar polish: memo actions align to the right; toggling language or Markdown refreshes existing canvas cards immediately, no restart needed' },
  { zh: '稳定更新通道：显式锁定稳定通道，预览版不会卡在预发布通道，稳定版也不会收到预发布更新', en: 'Stable update channel: explicitly locked to the stable channel, so preview builds are not stuck on pre-release updates and stable builds reject pre-release ones' },
  { zh: '修复：精简右键菜单展开「格式 ▸」子菜单时被撑宽的问题', en: 'Fixed: compact context menu widened when expanding the “Format ▸” submenu' }
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
  state.notes.forEach(cleanupRefs);
  const draftToken = window.api.captureDraft({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash });
  if (!draftToken) reportSaveError(new Error('恢复草稿写入失败'));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    state.notes.forEach(cleanupRefs);
    window.api.saveData({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash }, { draftToken }).catch(reportSaveError);
  }, 300);
}

function saveNow() {
  if (dataReadonly) return Promise.resolve(false);
  clearTimeout(saveTimer);
  saveTimer = null;
  state.notes.forEach(cleanupRefs);
  const draftToken = window.api.captureDraft({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash });
  if (!draftToken) reportSaveError(new Error('恢复草稿写入失败'));
  return window.api.saveData({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash }, { draftToken })
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
  $('#viewBoard').classList.toggle('active', state.settings.viewMode !== 'memo' && state.settings.viewMode !== 'todo' && state.settings.viewMode !== 'doc');
  $('#viewMemo').classList.toggle('active', state.settings.viewMode === 'memo');
  $('#viewTodo').classList.toggle('active', state.settings.viewMode === 'todo');
  $('#viewDoc').classList.toggle('active', state.settings.viewMode === 'doc');
  syncSortToolbar(state.settings.viewMode);

  setInterval(() => purgeTrash(), 60 * 60 * 1000);

  registerIpc();
}

init();
