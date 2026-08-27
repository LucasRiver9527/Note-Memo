/* ============ 便签 - 渲染进程逻辑 ============ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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

// v1.2.5（预览测试版）更新说明：仅列本版本新增/改进，之前版本内容不再列出。
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
  { zh: '主题化关闭确认弹窗；窗口尺寸与最大化状态跨重启记忆；亚克力下顶栏控件更清晰统一', en: 'Themed close-confirm dialog; window size & maximized state remembered across restarts; clearer title-bar controls under acrylic' }
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

let state = {
  settings: { ...DEFAULT_SETTINGS },
  groups: [],
  notes: [],
  trash: []
};

// 批量选中：一组被选中的便签 id（Set），multiSelect 开启后点击即切换选中
let multiSelect = false;
const selectedNotes = new Set();
let isBatchDragging = false;
let spaceDown = false;

let filter = { group: 'all', query: '', archive: false };
let zCounter = 10;
let saveTimer = null;
let activeColorPop = null;
let activeGroupPop = null;
let dragSortId = null;
let docNoteId = null;
let savedRange = null;
let savedSelText = '';
let savedNoteId = null;
let savedImageSrc = null;
let copiedImage = null;

// 富文本 HTML 缓存：键为内容/媒体/语言/markdown 的指纹，内容不变则不重复解析
const richCache = new Map(); // noteId -> { key, html }

// 画布增量渲染：记上一次视图与已建卡片，便于复用未变化的卡片、避免全量重建
let lastRenderView = null;
const boardEls = new Map(); // noteId -> 卡片 Element

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
    JSON.stringify(n.images || []), JSON.stringify(n.files || []), JSON.stringify(n.tables || [])
  ].join('|');
}

/* ============ 画布缩放 / 平移 ============ */
function boardZoom() {
  return state.settings.boardZoom || 1;
}

// 分组折叠状态：collapsedGroups[gid] === true 时该分组的便签在所有视图隐藏（折叠）
function isGroupCollapsed(gid) {
  return !!(gid && state.settings.collapsedGroups && state.settings.collapsedGroups[gid]);
}

function toggleGroupCollapse(gid) {
  if (!gid) return;
  const map = state.settings.collapsedGroups || {};
  const nowCollapsed = !map[gid];
  map[gid] = nowCollapsed;
  state.settings.collapsedGroups = map;
  if (nowCollapsed) {
    // 折叠：把当前布局快照下来（两组坐标，覆盖「全部/分组」两套作用域），供取消折叠时原样恢复
    state.settings.collapseSnapshot[gid] = snapshotBoardLayout();
  } else {
    // 取消折叠：把布局恢复到折叠前（便签回到原始位置，不与后来整理/排布的便签重叠）
    const snap = state.settings.collapseSnapshot[gid];
    if (snap) restoreBoardLayout(snap);
    delete state.settings.collapseSnapshot[gid];
  }
  save();
  renderGroupChips();
  renderAll();
}

// 快照当前所有便签的布局：同时记录「全部」作用域(positionAll)与分组作用域(x,y)，保证任意视图下取消折叠都能还原。
function snapshotBoardLayout() {
  const all = [];
  const grp = [];
  state.notes.forEach((n) => {
    const pa = n.positionAll || { x: n.x || 0, y: n.y || 0 };
    all.push({ id: n.id, x: pa.x, y: pa.y });
    grp.push({ id: n.id, x: n.x || 0, y: n.y || 0 });
  });
  return { all, grp };
}

// 从快照恢复布局：写回 positionAll（「全部」作用域）与 x,y（分组作用域）
function restoreBoardLayout(snap) {
  if (!snap) return;
  const allById = new Map((snap.all || []).map((s) => [s.id, s]));
  const grpById = new Map((snap.grp || []).map((s) => [s.id, s]));
  state.notes.forEach((n) => {
    const a = allById.get(n.id);
    if (a && typeof a.x === 'number') n.positionAll = { x: a.x, y: a.y };
    const g = grpById.get(n.id);
    if (g && typeof g.x === 'number') { n.x = g.x; n.y = g.y; }
  });
}

// 把 #board 的已算好的未缩放尺寸（dataset.uw/uh）套用当前缩放：width/height *= zoom + transform: scale。
// 缩放作用于 #board（transform-origin:0 0），这样便签的 left/top 仍用未缩放坐标，视觉按 zoom 放大。
function setBoardScaledSize() {
  const board = $('#board');
  if (!board) return;
  const z = boardZoom();
  const uw = parseFloat(board.dataset.uw) || (board.clientWidth + 100);
  const uh = parseFloat(board.dataset.uh) || (board.clientHeight + 100);
  board.style.width = (uw * z) + 'px';
  board.style.height = (uh * z) + 'px';
  board.style.transform = 'scale(' + z + ')';
  board.style.transformOrigin = '0 0';
}

// 更新缩放控件显示：把当前缩放值写到画布右下角工具栏（可见/不可见跟随画布视图；设置面板打开时隐藏避免遮挡）
function syncZoomToolbar() {
  const wrap = $('#canvasToolbar');
  if (!wrap) return;
  const settingsOpen = $('#settingsOverlay') && !$('#settingsOverlay').classList.contains('hidden');
  const boardView = state.settings.viewMode === 'board';
  const show = boardView && !settingsOpen;
  wrap.classList.toggle('hidden', !show);
  if (!show) {
    // 收起时让展开态复位，下次显示回归小圆钮
    wrap.classList.remove('expanded');
    const exp = $('#ctExpand');
    if (exp) { exp.textContent = '⤢'; exp.title = t('canvas_zoom_toggle'); }
  }
  const label = $('#zoomLabel');
  if (label) label.textContent = Math.round(boardZoom() * 100) + '%';
}

/* ============ 撤销 / 重做（结构操作快照历史） ============ */
const MAX_UNDO = 60;
const undoStack = [];
const redoStack = [];

// 深拷贝便签与回收站（notes-data 均为纯数据，JSON 克隆安全）
function cloneNotes(arr) {
  return (arr || []).map((n) => JSON.parse(JSON.stringify(n)));
}
function cloneTrash(arr) {
  return (arr || []).map((t) => ({ ...t, note: JSON.parse(JSON.stringify(t.note)) }));
}
function cloneOrders() {
  return { noteOrder: (state.settings.noteOrder || []).slice(), groupOrders: JSON.parse(JSON.stringify(state.settings.groupOrders || {})) };
}
function snapshotState() {
  return { notes: cloneNotes(state.notes), trash: cloneTrash(state.trash), groups: JSON.parse(JSON.stringify(state.groups || [])), orders: cloneOrders() };
}
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
function pushUndo() {
  undoStack.push(snapshotState());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  syncUndoButtons();
}
function undo() {
  const snap = undoStack.pop();
  if (!snap) return;
  redoStack.push(snapshotState());
  applySnapshot(snap);
  syncUndoButtons();
}
function redo() {
  const snap = redoStack.pop();
  if (!snap) return;
  undoStack.push(snapshotState());
  applySnapshot(snap);
  syncUndoButtons();
}
function syncUndoButtons() {
  const bu = $('#btnUndo');
  const br = $('#btnRedo');
  if (bu) bu.disabled = undoStack.length === 0;
  if (br) br.disabled = redoStack.length === 0;
}

// 调整缩放。anchor：{ mode: 'cursor'|'center'|'reset', x, y }。
function applyBoardZoomRatio(newRatio, anchor) {
  const canvas = $('#canvas');
  const board = $('#board');
  if (!canvas || !board) return;
  const oldZ = boardZoom();
  const newZ = clampZoom(newRatio);
  if (newZ === oldZ) return;
  const cRect = canvas.getBoundingClientRect();
  const bRect = board.getBoundingClientRect();
  const anchorObj = anchor || {};
  const useCursor = anchorObj.mode === 'cursor';
  const refScreenX = useCursor ? (anchorObj.x != null ? anchorObj.x : cRect.left + cRect.width / 2) : cRect.left + cRect.width / 2;
  const refScreenY = useCursor ? (anchorObj.y != null ? anchorObj.y : cRect.top + cRect.height / 2) : cRect.top + cRect.height / 2;
  // 参考点（光标/中心）在「未缩放板坐标」上的位置
  const refX = (refScreenX - bRect.left) / oldZ;
  const refY = (refScreenY - bRect.top) / oldZ;
  state.settings.boardZoom = newZ;
  setBoardScaledSize();
  // 让参考点在新缩放下仍落在原屏幕位置：scrollLeft = cRect.left + refX*newZ - refScreenX
  canvas.scrollLeft = Math.max(0, cRect.left + refX * newZ - refScreenX);
  canvas.scrollTop = Math.max(0, cRect.top + refY * newZ - refScreenY);
  syncZoomToolbar();
  save();
}

function zoomStep(dir) {
  applyBoardZoomRatio(boardZoom() + dir * LAYOUT.zoomStep, { mode: 'center' });
}

function zoomReset() {
  const canvas = $('#canvas');
  const board = $('#board');
  if (!canvas || !board) return;
  // 以画布中心为参考缩放回 100%
  const cRect = canvas.getBoundingClientRect();
  const bRect = board.getBoundingClientRect();
  const refX = (cRect.left + cRect.width / 2 - bRect.left) / boardZoom();
  const refY = (cRect.top + cRect.height / 2 - bRect.top) / boardZoom();
  const oldZ = boardZoom();
  state.settings.boardZoom = 1;
  setBoardScaledSize();
  canvas.scrollLeft = Math.max(0, cRect.left + refX * 1 - (cRect.left + cRect.width / 2));
  canvas.scrollTop = Math.max(0, cRect.top + refY * 1 - (cRect.top + cRect.height / 2));
  syncZoomToolbar();
  save();
}


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

function noteFontSize(n) {
  return n.fontSize || state.settings.fontSize || 14;
}

function adjustNoteFontSize(n, delta, apply) {
  const cur = noteFontSize(n);
  const next = Math.min(22, Math.max(11, cur + delta));
  if (next === cur) return;
  n.fontSize = next;
  n.updatedAt = Date.now();
  save();
  if (apply) apply(next);
}

/* ============ 选区捕获 / 恢复（右键菜单、图片插入用） ============ */
function captureSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    savedRange = sel.getRangeAt(0).cloneRange();
    savedSelText = sel.toString();
  } else {
    savedRange = null;
    savedSelText = '';
  }
}

function restoreSelection() {
  if (!savedRange) return false;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(savedRange);
  return true;
}

function clearSavedSelection() {
  savedRange = null;
  savedSelText = '';
  savedNoteId = null;
  savedImageSrc = null;
}

function focusNoteContent(n) {
  let c = document.querySelector('[data-id="' + n.id + '"] .note-content');
  if (!c && docNoteId === n.id) c = document.getElementById('docContent');
  return c;
}

function noteAnchor(n) {
  return document.querySelector('[data-id="' + n.id + '"]') || document.querySelector('.doc-editor') || document.body;
}

/* ============ 加粗 / 高亮 切换 ============ */
function selectionHasHighlight() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  const cn = range.commonAncestorContainer;
  const el = cn && (cn.nodeType === 1 ? cn : cn.parentElement);
  const scope = el && el.closest('.note-content, .dn-content, .doc-content');
  if (!scope) return false;
  const marks = scope.querySelectorAll('mark.hl, span[style*="background"], font[style*="background"]');
  for (const m of marks) {
    if (range.intersectsNode(m) || m.contains(range.startContainer) || m.contains(range.endContainer)) return true;
  }
  return false;
}

function removeHighlightFromSelection() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const cn = range.commonAncestorContainer;
  const el = cn && (cn.nodeType === 1 ? cn : cn.parentElement);
  const scope = el && el.closest('.note-content, .dn-content, .doc-content');
  if (!scope) return;
  const marks = Array.from(scope.querySelectorAll('mark.hl, span[style*="background"], font[style*="background"]'));
  marks.forEach((m) => {
    if (range.intersectsNode(m)) {
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    }
  });
}

function toggleBold(contentEl) {
  if (contentEl) contentEl.focus();
  document.execCommand('bold');
}

/* 对齐光标所在「段落/块」或选区覆盖的多个块（含图片），不使用 execCommand，避免杂散 span 或触发高亮 */
function alignBlock(contentEl, cmd) {
  const map = { justifyLeft: 'left', justifyCenter: 'center', justifyRight: 'right' };
  const value = map[cmd] || 'left';
  if (!contentEl) return;
  contentEl.focus();
  const sel = window.getSelection();

  // 若光标/选区聚焦在某张图片上，则只对齐该图片（独立块）
  const focusedImg = (() => {
    const selImg = contentEl.querySelector('.inline-img.selected');
    if (selImg) return selImg;
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const candidates = [];
    [range.startContainer, range.endContainer, sel.anchorNode, sel.focusNode].forEach((node) => {
      if (node) candidates.push(node);
      if (node && node.nodeType === 1) node.childNodes.forEach((c) => candidates.push(c));
    });
    for (const node of candidates) {
      let el = node && node.nodeType === 1 ? node : (node && node.parentElement);
      if (el && el.classList && el.classList.contains('inline-img')) return el;
      if (el && el.closest) {
        const im = el.closest('.inline-img');
        if (im) return im;
      }
    }
    return null;
  })();
  const alignImg = (im) => {
    // 图片保持 inline-block（随宽度收缩，删除/大小按钮不被拉伸），
    // 用「包裹块」的 text-align 让图片按左/中/右移动，不破坏按钮定位
    im.style.display = '';
    im.style.margin = '';
    const parent = im.parentElement;
    if (!parent) return;
    // 若已处在 note-align 块内，直接对齐该块
    const inBlock = im.closest('.note-align');
    if (inBlock) { inBlock.style.textAlign = value; return; }
    // 否则把图片所在行段包进新的 note-align 块（从上一 <br> 到下一 <br>）
    const wrap = document.createElement('div');
    wrap.className = 'note-align note-align-' + value;
    wrap.style.textAlign = value;
    let startNode = im;
    let prev = im.previousSibling;
    while (prev && !(prev.nodeName === 'BR')) { startNode = prev; prev = prev.previousSibling; }
    let endNode = im;
    let next = im.nextSibling;
    while (next && !(next.nodeName === 'BR')) { endNode = next; next = next.nextSibling; }
    const nodes = [];
    let cur = startNode;
    while (cur) {
      const n = cur;
      nodes.push(n);
      if (n === endNode) break;
      cur = n.nextSibling;
    }
    parent.insertBefore(wrap, startNode);
    nodes.forEach((n) => wrap.appendChild(n));
    wrap.style.textAlign = value;
  };

  if (focusedImg) {
    alignImg(focusedImg);
    if (sel) sel.removeAllRanges();
    return;
  }

  // 收集选区覆盖的块级元素（已有 .note-align div / 内容容器）
  let blocks = [];
  const collect = () => {
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      const candidates = contentEl.querySelectorAll('.note-align, div, p');
      candidates.forEach((bl) => {
        if (bl.closest('.note-align') && bl !== bl.closest('.note-align')) return; // 只取最外层
        if (range.intersectsNode(bl) || bl.contains(range.startContainer) || bl.contains(range.endContainer)) {
          if (!blocks.includes(bl)) blocks.push(bl);
        }
      });
    }
    if (!blocks.length) blocks = [contentEl];
  };
  collect();

  blocks.forEach((bl) => {
    bl.style.textAlign = value;
  });

  // 若无独立块（内容未分块），把全部内容包进一个 note-align 块（避免整篇直接设 text-align 导致序列化时嵌套包裹）
  const onlyContainer = blocks.length === 1 && (blocks[0] === contentEl || /note-content|doc-content|dn-content/.test(blocks[0].className || ''));
  if (onlyContainer && contentEl.childNodes.length) {
    const wrap = document.createElement('div');
    wrap.className = 'note-align note-align-' + value;
    wrap.style.textAlign = value;
    while (contentEl.firstChild) wrap.appendChild(contentEl.firstChild);
    contentEl.appendChild(wrap);
  }

  if (sel) sel.removeAllRanges();
}

function toggleHighlight(contentEl) {
  if (contentEl) contentEl.focus();
  if (selectionHasHighlight()) {
    removeHighlightFromSelection();
    if (contentEl) contentEl.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    document.execCommand('hiliteColor', false, highlightColor());
  }
}

function setHighlightColor(color) {
  state.settings.highlightColor = color;
  const hc = $('#highlightColorInput');
  if (hc) hc.value = color;
  applyTheme();
  save();
}

function applyInlineColor(n, range, color) {
  const contentEl = focusNoteContent(n);
  if (!contentEl || !range) return;
  contentEl.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand('foreColor', false, color);
  n.content = readRichContent(contentEl);
  n.updatedAt = Date.now();
  save();
  renderAll();
}

function getSelectedImageSrc(n) {
  const sel = window.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed) {
    const frag = sel.getRangeAt(0).cloneContents();
    const img = frag.querySelector('.inline-img img');
    if (img) return img.getAttribute('src');
  }
  const el = document.querySelector('[data-id="' + n.id + '"] .inline-img.selected img');
  if (el) return el.getAttribute('src');
  return null;
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `${t('today')} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2200);
}

// 保存失败提示：不静默丢数据（已尝试 toast 一次，避免每次保存都弹）
let saveErrorShown = false;
function reportSaveError(err) {
  console.error('[save] 数据保存失败：', err);
  if (!saveErrorShown) {
    saveErrorShown = true;
    try { toast(t('toast_save_failed')); } catch (_) {}
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    state.notes.forEach(cleanupRefs);
    window.api.saveData({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash }).catch(reportSaveError);
  }, 300);
}

function saveNow() {
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
/* ============ 排序 ============ */
// 视图位置/排序作用域已收归 sort-state.js（纯函数，可单测）；此处仅保留绑定全局 filter 的薄封装。
// 「全部」用 positionAll、分组/未分组用便签自身 x,y（相互独立，分组内整理不影响「全部」，反之亦然）。
function effPos(n) { return posOf(n, filter.group); }
function setEffPos(n, x, y) { writePos(n, x, y, filter.group); }
// 当前视图排序数组作用域：null 用全局 noteOrder，分组用 groupOrders[id]
function activeGroupId() { return resolveScope(filter.group).orderGid; }
// 布局快照作用域键：'all'→'_all'、'ungrouped'→'_ungrouped'、分组→分组 id
function layoutScopeKey() { return resolveScope(filter.group).layoutKey; }
// 当前画布可视宽度（供初始化「全部」位置/一键整理用），取不到时回退到默认
function canvasMaxX() {
  return (($('#canvas') && $('#canvas').clientWidth)) || LAYOUT.defaultW * 6;
}
// 为「没有 positionAll」的旧数据/导入数据补全「全部」位置（纯逻辑在 board-layout.initPositionAll）
function initAllLayout() {
  if (BoardLayout.initPositionAll(state.notes, canvasMaxX())) save();
}
// 取某个作用域的排序数组引用：gid 为 null 用全局 noteOrder，否则用该分组自己的 groupOrders[gid]
function orderRefFor(gid) {
  if (gid) {
    state.settings.groupOrders = state.settings.groupOrders || {};
    if (!state.settings.groupOrders[gid]) state.settings.groupOrders[gid] = [];
    return state.settings.groupOrders[gid];
  }
  if (!state.settings.noteOrder) state.settings.noteOrder = [];
  return state.settings.noteOrder;
}
// 排序面板当前选中的分组（'all' = 全局），与视图 filter.group 相互独立
let sortPanelGroupId = 'all';
// 排序面板作用域对应的排序数组：'all'/'ungrouped' 用全局 noteOrder，具体分组用 groupOrders[id]
function sortPanelGid() {
  return resolveScope(sortPanelGroupId).orderGid;
}

function ensureOrder() {
  const r = ensureOrderRefs(state.notes, state.groups, state.settings.noteOrder, state.settings.groupOrders);
  state.settings.noteOrder = r.noteOrder;
  state.settings.groupOrders = r.groupOrders;
}

function getSortedNotes(arr) {
  // 显示顺序 = 排序策略（custom 用 noteOrder/groupOrders；其它按时间/标题/颜色动态计算，绝不改动存储基准）
  const ids = SortState.applySortStrategy(arr, state.settings.sortMode, filter.group, state.settings.noteOrder, state.settings.groupOrders);
  const byId = new Map(arr.map((n) => [n.id, n]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function moveSortBy(id, dir) {
  const order = orderRefFor(sortPanelGid());
  const idx = order.indexOf(id);
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= order.length) return;
  order.splice(idx, 1);
  order.splice(target, 0, id);
  save();
  renderSortPanel();
  renderAll();
}

function moveSortItem(fromId, toId) {
  const order = orderRefFor(sortPanelGid());
  moveBefore(order, fromId, toId);
  save();
  renderSortPanel();
  renderAll();
}

function memoReorder(fromId, toId) {
  ensureOrder();
  state.settings.sortMode = 'custom';
  const order = orderRefFor(activeGroupId());
  moveBefore(order, fromId, toId);
  save();
  renderAll();
}

function memoReorderAfter(fromId, afterId) {
  ensureOrder();
  state.settings.sortMode = 'custom';
  const order = orderRefFor(activeGroupId());
  moveAfter(order, fromId, afterId);
  save();
  renderAll();
}

/* —— 列表/文档选择器 指针拖拽重排 ——
   原生 HTML5 DnD 在拖拽进行中会禁用鼠标滚轮（无法边拖边滚），因此改用 pointer 事件：
   拖拽时滚轮仍可滚动 `#canvas`，同时按指针位置实时计算插入空隙并给出落点指示。 */
// 计算指针 clientY 在 itemSel 列表中的插入位置（0..rows.length）
function computeListGap(container, itemSel, clientY) {
  const rows = $$(itemSel, container);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return i;
  }
  return rows.length;
}

function clearReorderIndicators(container, itemSel) {
  $$(itemSel, container).forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-target'));
}

function showReorderIndicator(container, itemSel, gap) {
  clearReorderIndicators(container, itemSel);
  const rows = $$(itemSel, container);
  if (gap < rows.length) rows[gap].classList.add('drop-before');
  else if (rows.length) rows[rows.length - 1].classList.add('drop-after');
}

// 在 itemSel 列表的 gap 处放置 fromId（gap 含被拖行自身；列表重排统一走 memoReorder）
function placeMemoAtGap(container, itemSel, fromId, gap) {
  const ids = $$(itemSel, container).map((r) => r.dataset.id);
  const fromPos = ids.indexOf(fromId);
  if (fromPos < 0) return;
  const rest = ids.filter((id) => id !== fromId);
  let g = gap;
  if (fromPos < gap) g -= 1;
  g = Math.max(0, Math.min(rest.length, g));
  if (g < rest.length) {
    memoReorder(fromId, rest[g]);
  } else if (rest.length > 0) {
    memoReorderAfter(fromId, rest[rest.length - 1]);
  }
}

// 通用指针拖拽重排入口（由 pointerdown 触发，传 downEvent 记录起始点）。
// opts: { container, itemSel, gapFn(clientY)->gap, commit(gap), threshold?, scrollEl? }
//   · threshold>0：移动超过该像素才视为拖拽（用于可点击项，区分「点击」与「拖动」）。
//   · scrollEl：滚轮滚动会改变各行的视觉位置，滚动时用最近一次指针 clientY 刷新落点指示。
function startPointerReorder(fromId, opts, downEvent) {
  const { container, itemSel, gapFn, commit } = opts;
  const threshold = opts.threshold || 0;
  const scrollEl = opts.scrollEl || $('#canvas');
  const startX = downEvent.clientX, startY = downEvent.clientY;
  let lastY = null, dragging = false;

  const rowEl = () => $$(itemSel, container).find((r) => r.dataset.id === fromId) || null;
  const setDragging = (on) => { const el = rowEl(); if (el) el.classList.toggle('dragging', on); };
  const cleanup = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    if (scrollEl) scrollEl.removeEventListener('scroll', onScroll);
  };
  const onScroll = () => { if (dragging && lastY != null) showReorderIndicator(container, itemSel, gapFn(lastY)); };
  const onMove = (e) => {
    if (!dragging) {
      if (threshold > 0 && Math.hypot(e.clientX - startX, e.clientY - startY) < threshold) return;
      setDragging(true);
      dragging = true;
    }
    lastY = e.clientY;
    showReorderIndicator(container, itemSel, gapFn(e.clientY));
  };
  const onUp = (e) => {
    if (!dragging) { cleanup(); return; }
    cleanup();
    clearReorderIndicators(container, itemSel);
    setDragging(false);
    lastY = e.clientY;
    commit(gapFn(e.clientY));
  };
  const onCancel = () => {
    cleanup();
    clearReorderIndicators(container, itemSel);
    setDragging(false);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
  if (scrollEl) scrollEl.addEventListener('scroll', onScroll);
}

function renderSortPanel() {
  const sel = $('#sortMode');
  if (sel) sel.value = state.settings.sortMode || 'updated';
  const list = $('#sortList');
  const groupSel = $('#sortGroup');
  const scopeRow = $('#sortScopeRow');
  if (scopeRow) scopeRow.classList.toggle('hidden', state.settings.sortMode !== 'custom');
  // 填充分组选择（各自独立调整顺序）
  if (groupSel) {
    groupSel.innerHTML = '';
    const addOpt = (v, label) => { const o = document.createElement('option'); o.value = v; o.textContent = label; groupSel.appendChild(o); };
    addOpt('all', t('sort_scope_all'));
    state.groups.forEach((g) => addOpt(g.id, g.name));
    addOpt('ungrouped', t('ungrouped'));
    if (![...groupSel.options].some((o) => o.value === sortPanelGroupId)) sortPanelGroupId = 'all';
    groupSel.value = sortPanelGroupId;
  }
  if (!list) return;
  const isCustom = state.settings.sortMode === 'custom';
  const hint = $('#sortHint');
  if (hint) hint.classList.toggle('hidden', !isCustom);
  list.innerHTML = '';
  if (!isCustom) {
    const empty = document.createElement('div');
    empty.className = 'trash-empty';
    empty.textContent = t('drag_to_sort');
    list.appendChild(empty);
    return;
  }
  ensureOrder();
  // 当前作用域下的便签
  let scopeNotes = state.notes.filter((n) => !n.desktopPin);
  if (sortPanelGroupId === 'ungrouped') scopeNotes = scopeNotes.filter((n) => !n.groupId);
  else if (sortPanelGroupId !== 'all') scopeNotes = scopeNotes.filter((n) => n.groupId === sortPanelGroupId);
  // 统一走单一来源 applySortStrategy（与主视图 getSortedNotes 一致），避免排序面板与实际画面顺序产生分歧。
  const ids = SortState.applySortStrategy(scopeNotes, state.settings.sortMode, sortPanelGroupId, state.settings.noteOrder, state.settings.groupOrders);
  const byId = new Map(scopeNotes.map((n) => [n.id, n]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  ordered.forEach((n) => {
    const el = document.createElement('div');
    el.className = 'sort-item';
    el.draggable = true;
    el.dataset.id = n.id;
    el.innerHTML = `
      <span class="drag-handle">⠿</span>
      <span class="sort-color" style="background:${n.color}"></span>
      <span class="sort-title">${escapeHtml(n.title || t('untitled'))}</span>
      <button class="sort-arrow" data-dir="up" title="${t('up')}">↑</button>
      <button class="sort-arrow" data-dir="down" title="${t('down')}">↓</button>`;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      dragSortId = n.id;
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (dragSortId && dragSortId !== n.id) el.classList.add('dragover');
    });
    el.addEventListener('dragleave', () => el.classList.remove('dragover'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('dragover');
      moveSortItem(dragSortId, n.id);
      dragSortId = null;
    });
    el.addEventListener('dragend', () => {
      dragSortId = null;
      $$('.sort-item').forEach((x) => x.classList.remove('dragover'));
    });
    $('[data-dir="up"]', el).onclick = (e) => { e.stopPropagation(); moveSortBy(n.id, -1); };
    $('[data-dir="down"]', el).onclick = (e) => { e.stopPropagation(); moveSortBy(n.id, 1); };
    list.appendChild(el);
  });
}

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
let shortcutRecordingId = null;
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

// 快速保存：不进设置，把当前排列顺序保存为自定义排序（并记录布局快照供「一键整理」恢复）
function saveCurrentOrder() {
  ensureOrder();
  const inView = (n) => {
    if (n.desktopPin) return false;
    if (filter.group === 'ungrouped') return !n.groupId;
    if (filter.group !== 'all' && filter.group !== 'ungrouped') return n.groupId === filter.group;
    return true;
  };
  const inViewNotes = state.notes.filter(inView);
  // 先捕获「当前显示顺序」，再改 sortMode（否则改成 custom 后就拿不到原排序模式下的顺序了）。
  //   - 「便签（画布）」视图：按画布坐标读序（先行后列，经 posOf 取当前作用域位置）。
  //   - 列表视图（备忘录/待办/文档）：以「当前显示顺序」为准（getSortedNotes 按当前排序模式排好）。
  let ids;
  if (state.settings.viewMode === 'board') {
    ids = readOrderFromLayout(inViewNotes, filter.group);
  } else {
    ids = getSortedNotes(inViewNotes).map((n) => n.id);
  }
  state.settings.sortMode = 'custom';
  const order = orderRefFor(activeGroupId());
  // 只重排当前视图内的便签，保留视图外便签原有相对顺序（如「未分组」保存时不清空分组便签顺序）
  const reordered = reorderScoped(order, ids);
  order.length = 0;
  reordered.forEach((id) => order.push(id));
  state.notes.forEach((n) => { if (inView(n) && !order.includes(n.id)) order.push(n.id); });
  // 记录布局快照（供「一键整理」恢复到保存时的精确位置，并对重叠便签轻移去重叠）。
  state.settings.orderLayouts = state.settings.orderLayouts || {};
  const snap = {};
  state.notes.filter(inView).forEach((n) => { const p = effPos(n); snap[n.id] = { x: p.x, y: p.y }; });
  state.settings.orderLayouts[layoutScopeKey()] = snap;
  save();
  renderSortPanel();
  renderAll();
  toast(t('toast_sort_saved'));
}

/* ============ 便签视图 / 表格 / 待办区 / 主渲染 / 回收站 / 批量 / 颜色分组弹窗（已拆分到 notes-view.js，经典脚本） ============ */
/* ============ 待办提醒 ============ */
let reminderNoteId = null;

function openReminder(n) {
  reminderNoteId = n.id;
  $('#reminderTitle').textContent = n.title || t('set_todo_time');
  const input = $('#reminderInput');
  if (n.reminder && n.reminder.time) {
    const d = new Date(n.reminder.time);
    const pad = (x) => String(x).padStart(2, '0');
    input.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } else {
    const d = new Date(Date.now() + 3600000);
    const pad = (x) => String(x).padStart(2, '0');
    input.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  $('#reminderOverlay').classList.remove('hidden');
}

function closeReminder() {
  $('#reminderOverlay').classList.add('hidden');
  reminderNoteId = null;
}

/* ============ 闹铃声音 ============ */
let alarmAudio = null;    // 自定义声音 Audio（循环播放）
let alarmCtx = null;      // 默认提示音 WebAudio 上下文
let alarmTimer = null;    // 默认提示音循环定时器

function defaultAlarmVolume() {
  return (state.settings.reminderVolume != null ? state.settings.reminderVolume : 70) / 100;
}

function stopAlarm() {
  if (alarmTimer) { clearInterval(alarmTimer); alarmTimer = null; }
  if (alarmAudio) { try { alarmAudio.pause(); alarmAudio.currentTime = 0; } catch (e) { /* ignore */ } alarmAudio = null; }
  if (alarmCtx) { try { alarmCtx.close(); } catch (e) { /* ignore */ } alarmCtx = null; }
}

function playDefaultBeep(ctx, volume) {
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.01, volume), now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
  gain.connect(ctx.destination);
  const freqs = [880, 988, 880, 988];
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    osc.connect(gain);
    osc.start(now + i * 0.18);
    osc.stop(now + i * 0.18 + 0.16);
  });
}

function startDefaultAlarm(volume, loop) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  alarmCtx = ctx;
  if (ctx.state === 'suspended') ctx.resume();
  playDefaultBeep(ctx, volume);
  if (loop) {
    alarmTimer = setInterval(() => {
      if (!alarmCtx) return;
      playDefaultBeep(alarmCtx, volume);
    }, 1500);
  }
}

function playReminderSound(info) {
  stopAlarm();
  // 若明确禁用则静音
  if (info && info.enabled === false) return;
  let url = null;
  let volume = defaultAlarmVolume();
  if (info) {
    url = info.url || info.path || null;
    volume = (info.volume != null ? info.volume : defaultAlarmVolume());
  } else {
    url = state.settings.reminderSoundPath || null;
  }

  if (url) {
    try {
      const a = new Audio(url);
      a.loop = true;
      a.volume = Math.max(0, Math.min(1, volume));
      a.play().catch(() => {});
      alarmAudio = a;
    } catch (e) { /* ignore */ }
    return;
  }
  startDefaultAlarm(volume, true);
}

function previewReminderSound() {
  stopAlarm();
  const url = state.settings.reminderSoundPath || null;
  const volume = defaultAlarmVolume();
  if (url) {
    try {
      const a = new Audio(url);
      a.loop = false;
      a.volume = Math.max(0, Math.min(1, volume));
      a.play().catch(() => {});
      alarmAudio = a;
    } catch (e) { /* ignore */ }
    return;
  }
  startDefaultAlarm(volume, false);
}

/* ============ 闹铃提醒弹窗 ============ */
let alarmNoteId = null;

function showAlarmModal(n) {
  alarmNoteId = n && n.id;
  const title = n.title || t('untitled');
  const body = n.type === 'todo'
    ? (n.items || []).filter((i) => !i.done).map((i) => i.text).join('\n')
    : (n.content || '').replace(/\[\[(?:img|file):[a-zA-Z0-9_-]+\]\]/g, '');
  $('#alarmTitle').textContent = '⏰ ' + title;
  $('#alarmBody').textContent = (body || '').slice(0, 400);
  $('#alarmOverlay').classList.remove('hidden');
}

function dismissAlarm() {
  alarmNoteId = null;
  stopAlarm();
  $('#alarmOverlay').classList.add('hidden');
}

// 稍后再响：把当前闹铃的提醒重新武装为「minutes 分钟后」，关闭弹窗并让主进程重新调度。
function snoozeAlarm(minutes) {
  const n = state.notes.find((x) => x.id === alarmNoteId);
  if (n && n.reminder) {
    n.reminder = { enabled: true, time: new Date(Date.now() + minutes * 60000).toISOString(), fired: false };
    n.updatedAt = Date.now();
    save();
    renderAll();
    toast(t('alarm_snoozed').replace('{n}', minutes));
  }
  dismissAlarm();
}

/* ============ 通用弹窗 ============ */
function promptModal(title, placeholder, def) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;border-radius:14px;';
    const modal = document.createElement('div');
    modal.style.cssText = 'width:280px;background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;';
    modal.innerHTML = `
      <header style="padding:14px 16px;font-weight:700;border-bottom:1px solid var(--border)">${escapeHtml(title)}</header>
      <div style="padding:16px"><input id="pmInput" style="width:100%;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:9px 10px;font-family:inherit;font-size:14px" value="${escapeHtml(def || '')}" /></div>
      <footer style="padding:12px 16px;display:flex;gap:10px;justify-content:flex-end">
        <button id="pmCancel" class="sp-btn ghost" style="width:auto;padding:8px 18px">${t('cancel')}</button>
        <button id="pmOk" class="sp-btn primary" style="width:auto;padding:8px 18px">${t('ok')}</button>
      </footer>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const input = $('#pmInput', modal);
    const done = (val) => { overlay.remove(); resolve(val); };
    $('#pmOk', modal).onclick = () => done(input.value);
    $('#pmCancel', modal).onclick = () => done(null);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value); });
    input.focus();
    input.select();
  });
}

function confirmModal(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;border-radius:14px;';
    const modal = document.createElement('div');
    modal.style.cssText = 'width:300px;background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;';
    modal.innerHTML = `
      <header style="padding:14px 16px;font-weight:700;border-bottom:1px solid var(--border)">${escapeHtml(title)}</header>
      <div style="padding:16px;font-size:13.5px;color:var(--fg-dim);line-height:1.6">${escapeHtml(message)}</div>
      <footer style="padding:12px 16px;display:flex;gap:10px;justify-content:flex-end">
        <button id="cmCancel" class="sp-btn ghost" style="width:auto;padding:8px 18px">${t('cancel')}</button>
        <button id="cmOk" class="sp-btn" style="width:auto;padding:8px 18px;background:#e5484d">${t('ok')}</button>
      </footer>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    $('#cmOk', modal).onclick = () => { overlay.remove(); resolve(true); };
    $('#cmCancel', modal).onclick = () => { overlay.remove(); resolve(false); };
  });
}

/* ============ 关闭确认弹窗（主题化三个选择） ============ */
let closeDecisionResolve = null;
function showCloseDecisionModal() {
  return new Promise((resolve) => {
    // 若已有弹窗在等待，先关闭上一个
    if (closeDecisionResolve) { const r = closeDecisionResolve; closeDecisionResolve = null; r('cancel'); }
    closeDecisionResolve = resolve;
    const overlay = $('#closeOverlay');
    if (!overlay) { resolve('cancel'); return; }
    overlay.classList.remove('hidden');
  });
}

function hideCloseDecisionModal() {
  const overlay = $('#closeOverlay');
  if (overlay) overlay.classList.add('hidden');
}

function closeDecision(choice) {
  const r = closeDecisionResolve;
  closeDecisionResolve = null;
  hideCloseDecisionModal();
  if (r) r(choice);
}


/* ============ 整理排列 ============ */
function arrangeNotes() {
  const canvasEl = $('#canvas');
  // 按「当前可视画布宽度」打包，确保整理后所有便签都落在窗口可视范围内。
  // 缩放后画布可视区域对应的「未缩放」宽度 = clientWidth / zoom（便签坐标始终未缩放）。
  const maxX = (canvasEl && canvasEl.clientWidth) ? Math.round(canvasEl.clientWidth / boardZoom()) : (BoardLayout.LAYOUT.defaultW * 6);
  // 每个分组独立整理：只打包当前分组/筛选的便签，不关心其它分组；「全部」视图打包所有便签。
  // 折叠分组视为不占位：整理仅作用于当前可见（未折叠）便签，让它们填满整个画布（含折叠组腾出的空白）。
  const inView = (n) => {
    if (n.desktopPin) return false;
    if (isGroupCollapsed(n.groupId)) return false;
    if (filter.group === 'ungrouped') return !n.groupId;
    if (filter.group !== 'all' && filter.group !== 'ungrouped') return n.groupId === filter.group;
    return true;
  };
  ensureOrder();
  const inViewNotes = state.notes.filter(inView);
  // 一键整理：精确恢复「保存当前排序」时记录的布局快照（保持保存的顺序与位置）。
  // 说明：快照是「保存当前排序」那一刻的样子；若手动调整后想以新布局为基准，请再点一次「保存当前排序」。
  // 未保存过（无快照）时，按当前排序模式紧凑「填空」排列。
  const snap = (state.settings.orderLayouts || {})[layoutScopeKey()];
  if (state.settings.sortMode === 'custom' && snap) {
    inViewNotes.forEach((n) => {
      const s = snap[n.id];
      if (s && typeof s.x === 'number') setEffPos(n, s.x, s.y);
    });
    // 未保存（新建）便签：按默认方案（创建时间降序）排序后，逐个放到不重叠空位；绝不移动已保存便签的位置。
    const occupied = [];
    inViewNotes.forEach((n) => {
      if (snap[n.id] && typeof snap[n.id].x === 'number') {
        const p = effPos(n);
        occupied.push({ x: p.x, y: p.y, w: n.w || LAYOUT.defaultW, h: n.h || LAYOUT.defaultH });
      }
    });
    const unsaved = inViewNotes.filter((n) => !(snap[n.id] && typeof snap[n.id].x === 'number'));
    unsaved.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).forEach((n) => {
      const w = n.w || LAYOUT.defaultW, h = n.h || LAYOUT.defaultH;
      const cand = BoardLayout.nextGridPosition(occupied, maxX, {}, w, h);
      setEffPos(n, cand.x, cand.y);
      occupied.push({ x: cand.x, y: cand.y, w, h });
    });
  } else {
    const sorted = getSortedNotes(inViewNotes);
    if (!sorted.length) return;
    // 超大（超出画布宽）便签放到最后再排：避免它在中间占位导致后面便签被挤到下方、中间留出大块空白。
    // 排布仍按当前排序顺序（仅把超大便签整体后移），其余便签保持阅读顺序紧凑打包。
    const maxW = (maxX > 0) ? maxX : Infinity;
    const ordered = sorted.slice().sort((a, b) =>
      (((a.w || LAYOUT.defaultW) > maxW) ? 1 : 0) - (((b.w || LAYOUT.defaultW) > maxW) ? 1 : 0)
    );
    const payload = ordered.map((n) => ({ id: n.id, w: n.w, h: n.h }));
    const placed = BoardLayout.arrangeCompact(payload, maxX);
    const posMap = new Map(placed.map((p) => [p.id, p]));
    sorted.forEach((n) => {
      const p = posMap.get(n.id);
      if (p) setEffPos(n, p.x, p.y);
    });
  }
  save();
  renderSortPanel();
  renderAll();
}

/* ============ 备份 ============ */
async function chooseBackupDir() {
  const r = await window.api.chooseDirectory();
  if (r.ok) {
    state.settings.backupDir = r.path;
    const el = $('#backupDir');
    if (el) el.value = r.path;
    save();
  }
}

async function backupNow() {
  const r = await window.api.backupExport(
    { settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash },
    state.settings.backupDir || null
  );
  if (r.ok) toast(t('toast_backup_ok') + r.path);
  else toast(t('toast_backup_fail') + r.error);
}

async function openBackupDir() {
  await window.api.openPath(state.settings.backupDir || null);
}

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

/* ============ 事件绑定 ============ */
function bindUI() {
  $('#btnAdd').onclick = () => {
    if (state.settings.viewMode === 'todo') {
      const n = createEmptyTodoNote();
      openReminder(n);
      toast(t('toast_todo_created'));
    } else {
      createNote();
    }
  };
  $('#btnQuickArrange').onclick = () => {
    arrangeNotes();
    toast(t('toast_arranged'));
  };
  $('#btnSaveOrder').onclick = () => saveCurrentOrder();


  $('#btnBatchToggle').onclick = () => toggleMultiSelect();
  $('#btnBatchExit').onclick = () => { if (multiSelect) toggleMultiSelect(); };
  $('#btnBatchSelectAll').onclick = selectAllVisible;
  $('#btnBatchClear').onclick = () => { selectedNotes.clear(); syncSelectedVisual(); };
  $('#btnBatchDelete').onclick = batchDeleteSelected;
  $('#btnBatchMove').onclick = batchMoveSelected;

  // 撤销 / 重做按钮
  $('#btnUndo').onclick = undo;
  $('#btnRedo').onclick = redo;


  $('#viewBoard').onclick = () => setViewMode('board');
  $('#viewMemo').onclick = () => setViewMode('memo');
  $('#viewTodo').onclick = () => setViewMode('todo');
  $('#viewDoc').onclick = () => setViewMode('doc');

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

  $$('#filterbar .chip[data-group]').forEach((c) => {
    c.onclick = () => setFilter('group', c.dataset.group);
  });

  // 归档视图开关：点击切换「只看归档/回到常规视图」
  const archiveChip = $('#btnArchiveFilter');
  if (archiveChip) {
    archiveChip.onclick = () => {
      filter.archive = !filter.archive;
      renderGroupChips();
      renderAll();
    };
  }

  // 分组过多时：鼠标滚轮在分组芯片区水平滚动，让「后面未显示的分组」可达
  const chipsWrap = $('#groupChips');
  if (chipsWrap) {
    chipsWrap.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        chipsWrap.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    // 左右箭头滚动分组：固定在两端，按是否可滚动方向置灰，无分组时隐藏
    const leftArrow = $('#btnChipsLeft');
    const rightArrow = $('#btnChipsRight');
    const chipsStep = () => Math.max(120, Math.round(chipsWrap.clientWidth * 0.7));
    const scrollChips = (dir) => { chipsWrap.scrollLeft += dir * chipsStep(); requestAnimationFrame(refreshChipsScroll); };
    if (leftArrow) leftArrow.onclick = () => scrollChips(-1);
    if (rightArrow) rightArrow.onclick = () => scrollChips(1);
    chipsWrap.addEventListener('scroll', refreshChipsScroll);
    window.addEventListener('resize', refreshChipsScroll);
    refreshChipsScroll();
  }

  const search = $('#searchInput');
  search.addEventListener('input', () => {
    filter.query = search.value;
    $('#searchClear').classList.toggle('hidden', !search.value);
    renderAll();
  });
  $('#searchClear').onclick = () => { search.value = ''; filter.query = ''; $('#searchClear').classList.add('hidden'); renderAll(); };

  const canvas = $('#canvas');
  canvas.addEventListener('dblclick', (e) => {
    if (state.settings.viewMode === 'todo') return;
    if (state.settings.viewMode === 'memo') {
      const memoList = $('#memoList');
      if (e.target === memoList || e.target === canvas) {
        createNote();
      }
    } else {
      const board = $('#board');
      const z = boardZoom();
      if (e.target === board || e.target === canvas) {
        const rect = board.getBoundingClientRect();
        createNote(Math.round((e.clientX - rect.left) / z), Math.round((e.clientY - rect.top) / z));
      }
    }
  });

  // 画布缩放：Ctrl+滚轮（仅空白背景/非编辑区域）、工具栏按钮
  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    if (state.settings.viewMode !== 'board') return;
    const t = e.target;
    if (t && t.closest && t.closest('.note-content, .doc-content, .note-title, input, select, textarea, button, .resize-handle')) return;
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    applyBoardZoomRatio(boardZoom() + dir * LAYOUT.zoomStep, { mode: 'cursor', x: e.clientX, y: e.clientY });
  }, { passive: false });

  // 平移：空格+左键拖 或 鼠标中键拖（仅空白背景）
  canvas.addEventListener('mousedown', (e) => {
    if (state.settings.viewMode !== 'board') return;
    if (!(e.target === canvas || e.target === board)) return;
    if ((e.button === 1) || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      startCanvasPan(e);
    } else if (e.button === 0) {
      // 左键空白背景：开启框选（拖拽拉框多选）
      startBoxSelect(e);
    }
  });

  // 空白画布右键：快捷插入
  canvas.addEventListener('contextmenu', (e) => {
    if (state.settings.viewMode !== 'board') return;
    if (!(e.target === canvas || e.target === board)) return;
    e.preventDefault();
    showBoardContextMenu(e);
  });

  // 缩放工具栏
  $('#btnZoomOut').addEventListener('click', () => zoomStep(-1));
  $('#btnZoomIn').addEventListener('click', () => zoomStep(1));
  $('#btnZoomReset').addEventListener('click', () => zoomReset());
  $('#btnZoomPan').addEventListener('click', () => { toast(t('canvas_pan_hint')); });
  const ctExpand = $('#ctExpand');
  if (ctExpand) ctExpand.addEventListener('click', () => {
    const tb = $('#canvasToolbar');
    const expanded = tb.classList.toggle('expanded');
    ctExpand.textContent = expanded ? '✕' : '⤢';
    ctExpand.title = expanded ? t('canvas_zoom_toggle_close') : t('canvas_zoom_toggle');
  });
  syncZoomToolbar();

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

/* ============ 提示气泡 ============ */
let activeTipEl = null;
let tipTimer = null;
let tipEl = null;

function initTooltips() {
  tipEl = document.createElement('div');
  tipEl.id = 'tooltip';
  document.body.appendChild(tipEl);

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[title]');
    if (el && el !== activeTipEl) {
      restoreTipEl();
      const text = el.getAttribute('title');
      if (text && text.trim()) {
        activeTipEl = el;
        el.setAttribute('data-tip-text', text);
        el.removeAttribute('title');
        showTooltip(el, text);
      }
    }
  });

  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest('[title], [data-tip-text]');
    if (el && el === activeTipEl) {
      if (e.relatedTarget && el.contains(e.relatedTarget)) return;
      restoreTipEl();
      hideTooltip();
    }
  });

  document.addEventListener('mousedown', hideTooltip);
  $('#canvas').addEventListener('scroll', hideTooltip);
  window.addEventListener('blur', hideTooltip);
}

function showTooltip(el, text) {
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => {
    if (!activeTipEl) return;
    tipEl.textContent = text;
    tipEl.classList.add('visible');
    positionTooltip(el);
  }, 350);
}

function positionTooltip(el) {
  const r = el.getBoundingClientRect();
  const tw = tipEl.offsetWidth;
  const th = tipEl.offsetHeight;
  let left = r.left + r.width / 2;
  let top = r.bottom + 8;
  if (top + th > window.innerHeight - 4) top = r.top - th - 8;
  if (left - tw / 2 < 4) left = tw / 2 + 4;
  if (left + tw / 2 > window.innerWidth - 4) left = window.innerWidth - tw / 2 - 4;
  tipEl.style.left = left + 'px';
  tipEl.style.top = top + 'px';
}

function hideTooltip() {
  clearTimeout(tipTimer);
  if (tipEl) tipEl.classList.remove('visible');
}

function restoreTipEl() {
  if (activeTipEl) {
    if (activeTipEl.hasAttribute('data-tip-text')) {
      activeTipEl.setAttribute('title', activeTipEl.getAttribute('data-tip-text'));
      activeTipEl.removeAttribute('data-tip-text');
    }
    activeTipEl = null;
  }
}

/* ============ 初始化 ============ */
async function init() {
  bindUI();
  initTooltips();

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

  let data = null;
  try {
    data = await window.api.loadData();
  } catch (err) {
    // 读取失败不静默：记录日志并提示（避免用户误以为数据被清空）
    console.error('[data] 读取数据失败：', err);
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
    if (ok) window.api.downloadUpdate();
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


  // 开发版标记：启动提示构建信息，便于确认运行的是最新代码
  try { toast('开发版 build 2026-08-26（v1.2.5 预览测试版）'); } catch (e) { /* ignore */ }

  window.addEventListener('beforeunload', () => {
    window.api.saveData({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash });
  });
}

init();
