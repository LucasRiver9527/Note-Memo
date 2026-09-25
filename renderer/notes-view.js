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
  const query = filter.query.trim().toLowerCase();

  const visible = state.notes.filter((n) => {
    if (n.desktopPin) return false;
    if (!!n.archived !== !!filter.archive) return false;
    if (isGroupCollapsed(n.groupId)) return false;
    if (!filter.archive) {
      // 常规视图：按分组筛选（归档便签已在上方排除）
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

  if (state.settings.viewMode === 'todo') {
    board.classList.add('hidden');
    memoList.classList.add('hidden');
    todoList.classList.remove('hidden');
    docList.classList.add('hidden');
    board.innerHTML = '';
    memoList.innerHTML = '';
    docList.innerHTML = '';
    lastRenderView = 'todo';
    renderTodoView();
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
  $('#emptyHint').classList.toggle('hidden', !empty || state.settings.viewMode === 'todo' || state.settings.viewMode === 'doc');
  if (multiSelect) syncSelectedVisual();

  if (state.settings.viewMode === 'board') syncBoardSize();
  if (typeof syncZoomToolbar === 'function') syncZoomToolbar();
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
  // 当前分组/筛选下的可见便签（与 renderAll 一致）
  const inView = (n) => {
    if (n.desktopPin) return false;
    if (!!n.archived !== !!filter.archive) return false;
    if (typeof isGroupCollapsed === 'function' && isGroupCollapsed(n.groupId)) return false;
    if (!filter.archive) {
      if (filter.group === 'ungrouped') return !n.groupId;
      if (filter.group !== 'all' && filter.group !== 'ungrouped') return n.groupId === filter.group;
    }
    return true;
  };
  let maxRight = L.margin;
  let maxBottom = L.margin;
  state.notes.filter(inView).forEach((n) => {
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

function setViewMode(mode) {
  state.settings.viewMode = mode;
  if (mode !== 'doc') docNoteId = null;
  $('#viewBoard').classList.toggle('active', mode === 'board');
  $('#viewMemo').classList.toggle('active', mode === 'memo');
  $('#viewTodo').classList.toggle('active', mode === 'todo');
  $('#viewDoc').classList.toggle('active', mode === 'doc');
  syncSortToolbar(mode);
  save();
  renderAll();
}





































