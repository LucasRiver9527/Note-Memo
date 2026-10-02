/* 便签视图（薄壳）：承载主渲染入口 renderAll / setViewMode / syncBoardSize 与增量渲染缓存。
   具体域已拆分到 board/*（卡片、媒体、表格、拖动、画布）等模块。
   非 UMD（需 DOM / window.api）；加载顺序须在 app.js 之前、各域模块之后。 */

/* ============ 表格 ============ */
// activeTableEl / activeTableNote / activeTableToolbar / activeTableSelCell / activeTableSelBox /
// lastTableBoxTime 已移至 core/app-state.js（跨模块共享，顶层访问器）



























/* ============ 主渲染 ============ */
// 富文本渲染 + 指纹缓存：内容/媒体/语言/markdown 有任一变化才重新解析
function renderRichCached(n) {
  const s = state.settings;
  const key = [
    n.content || '',
    JSON.stringify(n.images || []),
    JSON.stringify(n.files || []),
    JSON.stringify(n.tables || []),
    s.markdown !== false ? 1 : 0,
    s.language || 'zh'
  ].join('|');
  const hit = richCache.get(n.id);
  if (hit && hit.key === key) return hit.html;
  const html = renderRichContent(n.content || '', n);
  richCache.set(n.id, { key, html });
  // 防止无界增长：保留仍在用的便签，剔除已删除项
  if (richCache.size > state.notes.length + 64) {
    const ids = new Set(state.notes.map((x) => x.id));
    for (const id of Array.from(richCache.keys())) if (!ids.has(id)) richCache.delete(id);
  }
  return html;
}

function renderAll() {
  deselectTable();
  const board = $('#board');
  const memoList = $('#memoList');
  const todoList = $('#todoList');
  const docList = $('#docList');

  // 单一可见选择器：canvas-zoom.visibleNotes（正确处理 desktopPin/归档精确状态/折叠分组/查询/分组）。
  const visible = visibleNotes();
  const query = filter.query.trim().toLowerCase(); // 仅用于 todo 视图匹配与 no-match 判定

  let resultCount = visible.length;
  if (state.settings.viewMode === 'todo') {
    board.classList.add('hidden');
    memoList.classList.add('hidden');
    todoList.classList.remove('hidden');
    docList.classList.add('hidden');
    board.innerHTML = '';
    memoList.innerHTML = '';
    docList.innerHTML = '';
    lastRenderView = 'todo';
    resultCount = renderTodoView(visible, query);
  } else if (state.settings.viewMode === 'memo') {
    board.classList.add('hidden');
    memoList.classList.remove('hidden');
    todoList.classList.add('hidden');
    docList.classList.add('hidden');
    board.innerHTML = '';
    memoList.innerHTML = '';
    docList.innerHTML = '';
    lastRenderView = 'memo';
    getSortedNotes(visible).forEach((n) => memoList.appendChild(buildMemoEl(n)));
  } else if (state.settings.viewMode === 'doc') {
    board.classList.add('hidden');
    memoList.classList.add('hidden');
    todoList.classList.add('hidden');
    docList.classList.remove('hidden');
    board.innerHTML = '';
    memoList.innerHTML = '';
    todoList.innerHTML = '';
    lastRenderView = 'doc';
    if (docNoteId && !visible.some((n) => n.id === docNoteId)) docNoteId = null;
    renderDocView(visible);
  } else {
    board.classList.remove('hidden');
    memoList.classList.add('hidden');
    todoList.classList.add('hidden');
    docList.classList.add('hidden');
    memoList.innerHTML = '';
    todoList.innerHTML = '';
    docList.innerHTML = '';

    // 进入画布视图：全量重建；保持在画布：增量复用未变化卡片
    if (lastRenderView !== 'board') {
      board.innerHTML = '';
      boardEls.clear();
    }
    lastRenderView = 'board';

    const visibleIds = new Set(visible.map((n) => n.id));
    for (const [id, el] of boardEls) {
      if (!visibleIds.has(id)) { el.remove(); boardEls.delete(id); }
    }
    getSortedNotes(visible).forEach((n) => {
      const existing = boardEls.get(n.id);
      const snap = noteFingerprint(n);
      if (existing && existing.__snap === snap) return;
      const el = buildNoteEl(n);
      el.__snap = snap;
      if (existing) existing.replaceWith(el); else board.appendChild(el);
      boardEls.set(n.id, el);
    });
  }

  $('#noteCount').textContent = state.notes.length;
  const empty = state.notes.length === 0;
  const hasFilter = !!query || !!filter.archive || filter.group !== 'all' ||
    Object.values(state.settings.collapsedGroups || {}).some(Boolean);
  const noMatches = !empty && hasFilter && resultCount === 0;
  const showEmpty = empty && state.settings.viewMode !== 'todo';
  const emptyHint = $('#emptyHint');
  emptyHint.classList.toggle('hidden', !showEmpty && !noMatches);
  $('.empty-icon', emptyHint).textContent = noMatches ? '⌕' : '🗒️';
  $('p:not(.sub)', emptyHint).textContent = t(noMatches ? 'no_matches' : 'no_notes');
  $('.sub', emptyHint).textContent = t(noMatches ? 'no_matches_sub' : 'no_notes_sub');
  $('#btnEmptyCreate').classList.toggle('hidden', !showEmpty);
  $('#btnClearFilters').classList.toggle('hidden', !noMatches);
  $('#btnClearFilters').onclick = clearViewFilters;
  if (noMatches && state.settings.viewMode === 'todo') todoList.classList.add('hidden');
  if ((noMatches || showEmpty) && state.settings.viewMode === 'doc') docList.classList.add('hidden');
  $('#btnBatchToggle').classList.toggle('hidden', empty);
  $('#btnQuickArrange').classList.toggle('hidden', empty || state.settings.viewMode !== 'board');
  $('#btnSaveOrder').classList.toggle('hidden', empty || state.settings.viewMode !== 'board');
  if (typeof syncToolbarMore === 'function') syncToolbarMore();
  if (multiSelect) syncSelectedVisual();

  if (state.settings.viewMode === 'board') syncBoardSize();
  if (typeof syncZoomToolbar === 'function') syncZoomToolbar();
  if (typeof renderDesktopNotes === 'function') renderDesktopNotes();
  if (typeof renderFilterStatus === 'function') renderFilterStatus(resultCount, state.settings.viewMode);
  // UX-30B：显式「恢复保存布局」按钮的可用性随视图/筛选/查询/保存/导入更新。
  const restoreBtn = $('#btnRestoreLayout');
  if (restoreBtn) restoreBtn.disabled = !(typeof canRestoreSavedLayout === 'function' && canRestoreSavedLayout());
}

function clearViewFilters() {
  filter.query = '';
  filter.group = 'all';
  filter.archive = false;
  sortPanelGroupId = 'all';
  const search = $('#searchInput');
  search.value = '';
  $('#searchClear').classList.add('hidden');
  const collapsed = state.settings.collapsedGroups || {};
  const snapshots = state.settings.collapseSnapshot || {};
  const collapsedIds = Object.keys(collapsed).filter((id) => collapsed[id]);
  collapsedIds.forEach((id) => {
    if (snapshots[id]) restoreBoardLayout(snapshots[id]);
    delete snapshots[id];
    collapsed[id] = false;
  });
  if (collapsedIds.length) save();
  renderGroupChips();
  renderAll();
  search.focus();
}

// 新建内容必须立即可见：保留当前分组归属，仅退出会把空白新便签藏起来的条件。
function prepareNewNoteVisibility() {
  if (filter.query) {
    filter.query = '';
    $('#searchInput').value = '';
    $('#searchClear').classList.add('hidden');
  }
  if (filter.archive) {
    filter.archive = false;
    renderGroupChips();
  }
  if (isGroupCollapsed(filter.group)) toggleGroupCollapse(filter.group);
}

// 自适应画布尺寸：让「画布」高度/宽度至少等于视口，随便签内容增大。
// 这样内容不超视口时不出现滚动条（#canvas overflow:auto 因 content<=client 而无滚动），
// 超出时出现并让滚动条拇指长度随内容自适应。仅画布视图需要。
// 内部始终以「未缩放坐标」计算内容边界，再交给 setBoardScaledSize 套用缩放（宽度/高度 *= zoom + transform）。
function syncBoardSize() {
  const board = $('#board');
  const canvas = $('#canvas');
  if (!board || !canvas) return;
  const L = (typeof BoardLayout !== 'undefined' && BoardLayout.LAYOUT) ? BoardLayout.LAYOUT : { margin: 20, gap: 18 };
  const cw = canvas.clientWidth || 0;
  const ch = canvas.clientHeight || 0;
  // 当前可见便签：复用单一选择器 visibleNotes（与 renderAll/arrange 完全一致，含查询过滤），
  // 避免被搜索隐藏的便签仍把画布尺寸撑大。
  let maxRight = L.margin;
  let maxBottom = L.margin;
  visibleNotes().forEach((n) => {
    const p = effPos(n);
    const w = n.w || L.defaultW || L.margin;
    const h = n.h || L.defaultH || L.margin;
    if (p && typeof p.x === 'number') maxRight = Math.max(maxRight, p.x + w + L.gap);
    if (p && typeof p.y === 'number') maxBottom = Math.max(maxBottom, p.y + h + L.gap);
  });
  const boardW = Math.max(cw, maxRight);
  const boardH = Math.max(ch, maxBottom);
  board.dataset.uw = boardW;
  board.dataset.uh = boardH;
  if (typeof setBoardScaledSize === 'function') setBoardScaledSize();
  else { board.style.width = boardW + 'px'; board.style.height = boardH + 'px'; }
}

// 视图切换按钮：active 视觉态与 aria-pressed 始终同源。
// 增量渲染可能复用旧 DOM，任何真正切换视图的地方都要走这里，避免留下过期状态。
function syncViewToggles(mode) {
  mode = (mode === 'memo' || mode === 'todo' || mode === 'doc') ? mode : 'board';
  ['board', 'memo', 'todo', 'doc'].forEach((m) => {
    const btn = $('#view' + m.charAt(0).toUpperCase() + m.slice(1));
    if (!btn) return;
    btn.classList.toggle('active', mode === m);
    btn.setAttribute('aria-pressed', mode === m ? 'true' : 'false');
  });
}

function setViewMode(mode) {
  state.settings.viewMode = mode;
  if (mode !== 'doc') docNoteId = null;
  syncViewToggles(mode);
  syncSortToolbar(mode);
  save();
  renderAll();
}





































