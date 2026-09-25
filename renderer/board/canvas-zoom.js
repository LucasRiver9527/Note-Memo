/* 画布缩放平移、分组折叠、布局快照、新建/整理便签、框选与右键快捷插入。
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.canvasZoomView + 顶层全局。
   —— 本模块的函数通过顶层全局访问其他模块（与 board-layout.js 等同构）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.canvasZoomView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

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

function nextGridPosition() {
  const z = (typeof boardZoom === 'function') ? boardZoom() : 1;
  const maxX = Math.round((($('#canvas').clientWidth) || LAYOUT.defaultW * 6) / z);
  // 只按当前分组/筛选的可见便签找空位，避免「其他分组的便签占位」导致新便签落点怪异
  const inCurrentView = (n) => {
    if (n.desktopPin) return false;
    if (!!n.archived !== !!filter.archive) return false;
    if (isGroupCollapsed(n.groupId)) return false;
    if (!filter.archive) {
      if (filter.group === 'ungrouped') return !n.groupId;
      if (filter.group !== 'all' && filter.group !== 'ungrouped') return n.groupId === filter.group;
    }
    return true;
  };
  const vis = state.notes.filter(inCurrentView);
  // 与当前视图（分组/全部）不重叠：占用集合取当前视图内便签在该作用域下的位置（分组独立，不跨组占用）
  const allOccupied = vis.map((n) => { const p = effPos(n); return { x: p.x, y: p.y, w: n.w, h: n.h }; });
  // 候选：把新便签追加到当前分组便签的紧凑排列之后（紧邻），但不与任何便签重叠
  const placed = BoardLayout.arrangeShelf(
    vis.map((n) => ({ id: n.id, w: n.w, h: n.h })).concat([{ id: '__new', w: LAYOUT.defaultW, h: LAYOUT.newH }]),
    maxX
  );
  const last = placed[placed.length - 1];
  if (!BoardLayout.overlapsAny(last.x, last.y, LAYOUT.defaultW, LAYOUT.newH, allOccupied)) return { x: last.x, y: last.y };
  // 候选与现有便签重叠时，回退到全局网格扫描找真正空位
  return BoardLayout.nextGridPosition(allOccupied, maxX);
}

// 「全部」视图作用域下的新便签空位：避开所有便签的 positionAll，保证回到「全部」时不重叠。
// 用于在分组/未分组视图新建便签时，独立给出 positionAll（与分组作用域的 x,y 分开）。
function nextAllPosition() {
  const z = (typeof boardZoom === 'function') ? boardZoom() : 1;
  const maxX = Math.round((($('#canvas').clientWidth) || LAYOUT.defaultW * 6) / z);
  const occupied = state.notes.map((n) => {
    const p = n.positionAll || { x: n.x || 0, y: n.y || 0 };
    return { x: p.x, y: p.y, w: n.w || LAYOUT.defaultW, h: n.h || LAYOUT.defaultH };
  });
  return BoardLayout.nextGridPosition(occupied, maxX, {}, LAYOUT.defaultW, LAYOUT.newH);
}

function createNote(x, y) {
  pushUndo();
  const pos = (x != null && y != null) ? { x, y } : nextGridPosition();
  // 仅在「全部」视图时 positionAll 与当前作用域一致；分组/未分组视图独立算一个不重叠的「全部」空位。
  const allPos = (filter.group === 'all') ? pos : nextAllPosition();
  const n = {
    id: uid(),
    title: '',
    content: '',
    type: 'note',
    items: [],
    color: defaultNoteColor(),
    textColor: null,
    fontFamily: null,
    images: [],
    groupId: (filter.group && filter.group !== 'all' && filter.group !== 'ungrouped') ? filter.group : null,
    pinned: false,
    desktopPin: false,
    archived: false,
    preview: false,
    reminder: null,
    x: pos.x,
    y: pos.y,
    positionAll: { x: allPos.x, y: allPos.y },
    w: LAYOUT.defaultW,
    h: LAYOUT.newH,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  state.notes.push(n);
  ensureOrder();
  save();
  renderAll();
  focusNewNote(n.id);
  return n;
}

function focusNewNote(id) {
  const el = document.querySelector('[data-id="' + id + '"]');
  if (el) {
    const target = $('.note-content', el) || $('.note-title', el);
    if (target) target.focus();
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function visibleNotes() {
  const query = filter.query.trim().toLowerCase();
  return state.notes.filter((n) => {
    if (n.desktopPin) return false;
    if (!!n.archived !== !!filter.archive) return false;
    if (isGroupCollapsed(n.groupId)) return false;
    if (!filter.archive) {
      if (filter.group === 'ungrouped' && n.groupId) return false;
      if (filter.group !== 'all' && filter.group !== 'ungrouped' && n.groupId !== filter.group) return false;
    }
    if (query) {
      const g = state.groups.find((x) => x.id === n.groupId);
      const hay = ((n.title || '') + ' ' + noteText(n) + ' ' + (g ? g.name : '')).toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });
}

/* ============ 画布交互：平移 / 框选 / 右键快捷插入 ============ */
// 进入批量 UI（不切换开关）：显示批量工具条 + 进入 multi-select 态，供框选等批量入口复用
function ensureMultiSelectActive() {
  if (!multiSelect) {
    multiSelect = true;
    document.body.classList.add('multi-select');
    const toggle = $('#btnBatchToggle');
    if (toggle) toggle.classList.add('active');
    $('#batchBar').classList.remove('hidden');
  }
  syncSelectedVisual();
}

// 平移画布：通过修改 #canvas 的 scrollLeft/scrollTop 实现（缩放后内容超出视口才可平移）。
// 触发：空格+左键 或 鼠标中键（已在 app.js 的 mousedown 判定 target 为空白背景后调用）。
function startCanvasPan(e) {
  const canvas = $('#canvas');
  const startX = e.clientX;
  const startY = e.clientY;
  const sl = canvas.scrollLeft;
  const st = canvas.scrollTop;
  canvas.style.cursor = 'grabbing';
  document.body.classList.add('panning');
  const onMove = (ev) => {
    canvas.scrollLeft = Math.max(0, sl - (ev.clientX - startX));
    canvas.scrollTop = Math.max(0, st - (ev.clientY - startY));
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    canvas.removeEventListener('mouseleave', onUp);
    canvas.style.cursor = '';
    document.body.classList.remove('panning');
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  canvas.addEventListener('mouseleave', onUp);
}

// 框选：空白背景左键拖拽画出一个选择框，框内（与框相交）的可见便签被选中并进入批量 UI。
// 纯逻辑（矩形相交判定）复用 BoardLayout.rectsIntersect。
function startBoxSelect(e) {
  const board = $('#board');
  const z = boardZoom();
  const rect = board.getBoundingClientRect();
  const startBX = (e.clientX - rect.left) / z;
  const startBY = (e.clientY - rect.top) / z;
  let active = false;
  let marquee = null;
  let cur = { x: startBX, y: startBY, w: 0, h: 0 };

  const onMove = (ev) => {
    const bx = (ev.clientX - rect.left) / z;
    const by = (ev.clientY - rect.top) / z;
    if (!active) {
      const dist = Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY);
      if (dist < 4) return;
      active = true;
      marquee = document.createElement('div');
      marquee.id = 'marquee';
      board.appendChild(marquee);
    }
    const x = Math.min(startBX, bx);
    const y = Math.min(startBY, by);
    const w = Math.abs(bx - startBX);
    const h = Math.abs(by - startBY);
    cur = { x, y, w, h };
    marquee.style.left = x + 'px';
    marquee.style.top = y + 'px';
    marquee.style.width = w + 'px';
    marquee.style.height = h + 'px';
  };
  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    if (marquee) marquee.remove();
    if (active) {
      selectedNotes.clear();
      visibleNotes().forEach((n) => {
        const p = effPos(n);
        const nr = { x: p.x, y: p.y, w: n.w || LAYOUT.defaultW, h: n.h || LAYOUT.defaultH };
        if (BoardLayout.rectsIntersect(nr, cur)) selectedNotes.add(n.id);
      });
      if (selectedNotes.size) ensureMultiSelectActive();
      else clearSelection();
    } else {
      // 空白处单击：取消全部选择（不新建，双击仍负责新建）
      if (selectedNotes.size) clearSelection();
    }
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

// 空白画布右键菜单：快捷插入（新建便签 / 新建待办 / 粘贴为新便签 / 一键整理）
function showBoardContextMenu(e) {
  e.preventDefault();
  e.stopPropagation();
  closePops();
  const board = $('#board');
  const z = boardZoom();
  const rect = board.getBoundingClientRect();
  const bx = (e.clientX - rect.left) / z;
  const by = (e.clientY - rect.top) / z;
  const pop = document.createElement('div');
  pop.className = 'color-pop ctx-menu';
  pop.style.gridTemplateColumns = '1fr';
  pop.style.minWidth = '140px';
  pop.style.padding = '4px';
  pop.style.maxHeight = Math.min(window.innerHeight - 24, 440) + 'px';
  pop.style.overflowY = 'auto';

  const addItem = (icon, label, onClick, danger) => {
    const b = document.createElement('button');
    b.style.cssText = 'background:transparent;border:none;color:var(--fg);padding:4px 9px;border-radius:6px;cursor:pointer;text-align:left;font-size:12.5px;line-height:1.3;font-family:inherit;width:100%;display:flex;align-items:center;gap:6px;';
    b.innerHTML = `<span>${icon}</span><span>${label}</span>`;
    b.onmouseenter = () => (b.style.background = 'var(--accent-soft)');
    b.onmouseleave = () => (b.style.background = 'transparent');
    b.onclick = () => { closePops(); onClick(); };
    pop.appendChild(b);
  };

  addItem('📝', t('board_new_note'), () => createNote(Math.round(bx), Math.round(by)));
  addItem('☑', t('board_new_todo'), () => {
    const n = createTodoNote('', Math.round(bx), Math.round(by));
    renderAll();
    focusNewNote(n.id);
  });
  addItem('📥', t('board_paste_note'), async () => {
    const text = await window.api.readClipboard();
    if (text && text.trim()) createNoteWithContent(Math.round(bx), Math.round(by), text);
    else toast(t('toast_paste_empty'));
  });
  addItem('▦', t('board_arrange'), () => arrangeNotes());

  // 菜单外观（透明度/亚克力）已归位到「设置 → 外观」，不再挂在每个右键菜单底部
  document.body.appendChild(pop);
  const x = Math.max(8, Math.min(e.clientX, window.innerWidth - pop.offsetWidth - 8));
  const y = Math.max(8, Math.min(e.clientY, window.innerHeight - pop.offsetHeight - 8));
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
  activeColorPop = pop;
  setTimeout(() => document.addEventListener('mousedown', closePopsOnce), 0);
}

// 在指定位置新建一条带初始内容的便签（右键「粘贴为新便签」用）
function createNoteWithContent(x, y, content) {
  const n = createNote(x, y);
  n.content = content;
  n.updatedAt = Date.now();
  save();
  renderAll();
  focusNewNote(n.id);
  return n;
}

function selectAllVisible() {
  visibleNotes().forEach((n) => selectedNotes.add(n.id));
  syncSelectedVisual();
}

  return { boardZoom, isGroupCollapsed, toggleGroupCollapse, snapshotBoardLayout, restoreBoardLayout, setBoardScaledSize, syncZoomToolbar, applyBoardZoomRatio, zoomStep, zoomReset, nextGridPosition, nextAllPosition, startCanvasPan, startBoxSelect, showBoardContextMenu, createNoteWithContent, createNote, focusNewNote, ensureMultiSelectActive, selectAllVisible, visibleNotes };
}));
