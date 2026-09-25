/* panels/sort-panel.js
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.sortPanelView + 顶层全局。
   —— 本模块的函数通过顶层全局访问其他模块（与 board-layout.js 等同构）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.sortPanelView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

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

  return { computeListGap, clearReorderIndicators, showReorderIndicator, placeMemoAtGap, startPointerReorder, renderSortPanel };
}));
