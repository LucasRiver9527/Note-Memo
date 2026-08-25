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

const CHANGELOG = [
  { zh: '文本对齐：便签 / 文档 / 钉桌便签加入左·居中·右对齐（Ctrl+L / Ctrl+E / Ctrl+R），图片也支持独立对齐', en: 'Text alignment: left/center/right for notes, doc & pinned notes (Ctrl+L/E/R); images align independently' },
  { zh: '批量选中：点选便签多选，支持批量删除、移动分组、拖动整组移动', en: 'Batch select: multi-select notes for batch delete, move to group, drag-group move' },
  { zh: '「贴靠」恢复：窗口拖到屏幕边缘自动调整（顶部最大化、左右半屏、四角四分屏），并支持 Win11 贴靠布局', en: 'Snap restored: drag to screen edges to maximize/half/quarter, supports Win11 snap layouts' },
  { zh: '修复 Win11 拖动便签卡顿、钉桌便签玻璃拟态失效、便签粘贴图片失效', en: 'Fix Win11 note-drag stutter, desktop-note glass, and image paste' },
  { zh: '批量操作栏跟随顶栏外观自定义（颜色 / 透明度 / 亚克力）', en: 'Batch bar follows the title bar appearance customization' },
  { zh: '修复：便签内 Ctrl+C / Ctrl+V 无法复制粘贴的问题（含标题），粘贴现可正常插入', en: 'Fix: Ctrl+C/Ctrl+V copy & paste now work in notes (incl. title)' },
  { zh: '「关于」页新增「检查更新」按钮，可手动检测版本更新', en: 'Added a "Check for updates" button on the About page' },
  { zh: '数据安全加固：原子写入、版本号与损坏自动回退，断电也不怕数据写坏', en: 'Data safety: atomic writes, versioning & crash recovery' },
  { zh: '备份自包含：一键备份自动打包图片 / 字体 / 声音等媒体，跨设备迁移不断图', en: 'Self-contained backup: bundles images/fonts/sounds for lossless migration' },
  { zh: '图片等媒体缺失时显示友好占位提示，一键移除，不再破图', en: 'Graceful placeholder for missing media instead of broken images' },
  { zh: '「贴靠」：窗口拖到屏幕边缘自动调整大小（顶部最大化、左右半屏、四角四分屏）', en: 'Snap windows to screen edges (maximize / half / quarter)' },
  { zh: '便签钉桌面支持 Windows 亚克力玻璃模糊', en: 'Acrylic blur for desktop-pinned notes' },
  { zh: '顶栏亚克力模糊，可自定义顶栏底色与透明度', en: 'Title bar acrylic blur with custom color & opacity' },
  { zh: '右上角最小化 / 最大化 / 关闭按钮与顶栏样式统一', en: 'Window control buttons unified with the title bar' },
  { zh: '外观设置分模块（便签外观 / 主程序外观），12 套主题，薄荷默认置顶', en: 'Modular appearance settings, 12 themes, Mint by default' },
  { zh: '恢复默认外观与默认主题一致；图表按钮高对比优化', en: 'Reset appearance matches the default theme; high-contrast buttons' },
  { zh: '图片按光标插入位置放置，支持拖入文件 / 文件夹快捷打开', en: 'Insert images at the cursor; paste file/folder paths to open quickly' },
  { zh: '支持 Markdown 加粗 / 高亮（Ctrl+B / Ctrl+H）', en: 'Markdown bold / highlight (Ctrl+B / Ctrl+H)' },
  { zh: '编辑时 Ctrl+滚轮快捷调整字体大小', en: 'Ctrl+scroll to adjust font size while editing' },
  { zh: '新增「文档」视图，像文档一样查看与编辑便签', en: 'New Document view to read & edit notes like a document' },
  { zh: '备忘录可拖动调整顺序；待办区集中管理', en: 'Reorder memos by drag; centralized todo area' },
  { zh: '全新表格：插入 / 合并 / 拆分单元格，自定义边框、文字颜色与大小，斜线表头，双击编辑并可换行', en: 'New table: merge/split cells, borders & text styling, diagonal header, edit cells with line breaks' },
  { zh: '待办提醒闹铃声音，可自定义声音与音量，待机也保证提醒', en: 'Reminder alarm sound, custom file & volume, works in standby' },
  { zh: '新增「关于」页面：版本、作者、更新说明', en: 'New About page: version, author, changelog' }
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

let filter = { group: 'all', query: '' };
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
    p.x || 0, p.y || 0, n.w || 0, n.h || 0, n.z || 0,
    n.reminder ? (n.reminder.time || '') + '/' + (n.reminder.fired ? 1 : 0) : '',
    JSON.stringify(n.images || []), JSON.stringify(n.files || []), JSON.stringify(n.tables || [])
  ].join('|');
}

/* ============ 工具函数 ============ */
function defaultNoteColor() {
  return state.settings.noteColor || DEFAULT_NOTE_COLOR;
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

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    state.notes.forEach(cleanupRefs);
    window.api.saveData({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash });
  }, 300);
}

function saveNow() {
  clearTimeout(saveTimer);
  state.notes.forEach(cleanupRefs);
  window.api.saveData({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash });
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
  return sortNotes(arr, state.settings, activeGroupId());
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
  // 按作用域顺序排序（'all'/'ungrouped' 用全局 noteOrder，具体分组用该组顺序）
  const ordered = sortNotes(scopeNotes, state.settings, sortPanelGid());
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
  // 记录布局快照（供一键整理恢复到保存时的精确位置）——所有视图都记录。
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
function showAlarmModal(n) {
  const title = n.title || t('untitled');
  const body = n.type === 'todo'
    ? (n.items || []).filter((i) => !i.done).map((i) => i.text).join('\n')
    : (n.content || '').replace(/\[\[(?:img|file):[a-zA-Z0-9_-]+\]\]/g, '');
  $('#alarmTitle').textContent = '⏰ ' + title;
  $('#alarmBody').textContent = (body || '').slice(0, 400);
  $('#alarmOverlay').classList.remove('hidden');
}

function dismissAlarm() {
  stopAlarm();
  $('#alarmOverlay').classList.add('hidden');
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

/* ============ 整理排列 ============ */
function arrangeNotes() {
  const canvasEl = $('#canvas');
  // 按「当前可视画布宽度」打包，确保整理后所有便签都落在窗口可视范围内。
  const maxX = (canvasEl && canvasEl.clientWidth) ? canvasEl.clientWidth : (BoardLayout.LAYOUT.defaultW * 6);
  // 每个分组独立整理：只打包当前分组/筛选的便签，不关心其它分组；「全部」视图打包所有便签
  const inView = (n) => {
    if (n.desktopPin) return false;
    if (filter.group === 'ungrouped') return !n.groupId;
    if (filter.group !== 'all' && filter.group !== 'ungrouped') return n.groupId === filter.group;
    return true;
  };
  ensureOrder();
  // 保存过当前排序（自定义排序 + 有布局快照）：一键整理 = 恢复到保存时的精确位置。
  // 其它情况（未保存 / 非自定义排序）：退回紧凑整理。
  if (state.settings.sortMode === 'custom') {
    const snap = (state.settings.orderLayouts || {})[layoutScopeKey()];
    if (snap) {
      state.notes.filter(inView).forEach((n) => {
        const s = snap[n.id];
        if (s && typeof s.x === 'number') setEffPos(n, s.x, s.y);
      });
      save();
      renderSortPanel();
      renderAll();
      return;
    }
  }
  // 普通整理：按当前排序模式（尊重自定义或其它排序方式）的顺序紧凑整齐排列
  const sorted = getSortedNotes(state.notes.filter(inView));
  if (!sorted.length) return;
  const placed = BoardLayout.arrangeCompact(
    sorted.map((n) => ({ id: n.id, w: n.w, h: n.h })),
    maxX
  );
  const posMap = new Map(placed.map((p) => [p.id, p]));
  sorted.forEach((n) => {
    const p = posMap.get(n.id);
    if (p) setEffPos(n, p.x, p.y);
  });
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
  };
  $('#btnCloseSettings').onclick = () => $('#settingsOverlay').classList.add('hidden');
  $('#settingsOverlay').onclick = (e) => { if (e.target.id === 'settingsOverlay') $('#settingsOverlay').classList.add('hidden'); };

  $('#btnChangelog').onclick = openChangelog;
  $('#btnChangelogClose').onclick = closeChangelog;
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
      if (e.target === board || e.target === canvas) {
        const rect = board.getBoundingClientRect();
        createNote(Math.round(e.clientX - rect.left), Math.round(e.clientY - rect.top));
      }
    }
  });

  // 外观输入
  $('#noteOpacity').addEventListener('input', (e) => { state.settings.noteOpacity = Number(e.target.value); applyTheme(); });
  $('#noteOpacity').addEventListener('change', save);
  $('#noteColorInput').addEventListener('input', (e) => { state.settings.noteColor = e.target.value; });
  $('#noteColorInput').addEventListener('change', save);
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

  const data = await window.api.loadData();
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

  // 开发版标记：启动提示构建信息，便于确认运行的是最新代码
  try { toast('开发版 build 2026-08-25（快照恢复 · 指针拖拽排序 · 批量只选不编辑）'); } catch (e) { /* ignore */ }

  window.addEventListener('beforeunload', () => {
    window.api.saveData({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash });
  });
}

init();
