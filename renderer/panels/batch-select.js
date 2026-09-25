/* panels/batch-select.js
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.batchSelectView + 顶层全局。
   —— 本模块的函数通过顶层全局访问其他模块（与 board-layout.js 等同构）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.batchSelectView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

/* ============ 批量选中 ============ */
function toggleMultiSelect() {
  multiSelect = !multiSelect;
  document.body.classList.toggle('multi-select', multiSelect);
  const toggle = $('#btnBatchToggle');
  if (toggle) toggle.classList.toggle('active', multiSelect);
  if (multiSelect) {
    selectedNotes.clear();
    // 进入批量模式：若正聚焦在某个可编辑区，先失焦，避免后续点击直接进入编辑
    const ae = document.activeElement;
    if (ae && ae !== document.body && ae.blur) ae.blur();
    syncSelectedVisual();
    $('#batchBar').classList.remove('hidden');
  } else {
    clearSelection();
  }
}

function clearSelection() {
  selectedNotes.clear();
  syncSelectedVisual();
  if (!multiSelect) $('#batchBar').classList.add('hidden');
  updateBatchCount();
}

function syncSelectedVisual() {
  const visibleIds = new Set(visibleNotes().map((n) => n.id));
  $$('.note, .memo-row').forEach((el) => {
    el.classList.toggle('selected', selectedNotes.has(el.dataset.id));
  });
  // 保持选中集只含可见便签（避免筛选/分组后仍留着看不见的）
  for (const id of Array.from(selectedNotes)) {
    if (!visibleIds.has(id)) selectedNotes.delete(id);
  }
  updateBatchCount();
}

function toggleSelectNote(id) {
  if (selectedNotes.has(id)) selectedNotes.delete(id);
  else selectedNotes.add(id);
  syncSelectedVisual();
}

function updateBatchCount() {
  const el = $('#batchCount');
  if (el) el.textContent = t('batch_selected_count').replace('{n}', selectedNotes.size);
}

function batchDeleteSelected() {
  const ids = Array.from(selectedNotes);
  if (!ids.length) return;
  const count = ids.length;
  pushUndo();
  const idSet = new Set(ids);
  const removed = state.notes.filter((n) => idSet.has(n.id));
  state.notes = state.notes.filter((n) => !idSet.has(n.id));
  removed.forEach((n) => {
    if (n.desktopPin) window.api.unpinFromDesktop(n.id);
    n.desktopPin = false;
    state.trash.push({ note: n, deletedAt: Date.now() });
  });
  clearSelection();
  save();
  renderAll();
  toast(t('toast_batch_deleted').replace('{n}', count));
}

function batchMoveSelected() {
  const ids = Array.from(selectedNotes);
  if (!ids.length) return;
  openGroupPopForBatch();
}

function setBatchGroup(groupId) {
  const count = selectedNotes.size;
  if (!count) return;
  pushUndo();
  const idSet = new Set(selectedNotes);
  state.notes.forEach((n) => {
    if (idSet.has(n.id)) n.groupId = groupId;
  });
  clearSelection();
  save();
  renderAll();
  toast(t('toast_batch_moved').replace('{n}', count));
}

function openGroupPopForBatch() {
  closePops();
  const pop = document.createElement('div');
  pop.className = 'color-pop ctx-menu';
  pop.style.gridTemplateColumns = '1fr';
  pop.style.minWidth = '150px';
  pop.style.padding = '5px';

  const mkItem = (label, labelColor, onClick, active) => {
    const b = document.createElement('button');
    b.style.cssText = 'background:transparent;border:none;color:var(--fg);padding:6px 10px;border-radius:6px;cursor:pointer;text-align:left;font-size:12.5px;font-family:inherit;width:100%;display:flex;align-items:center;gap:8px;';
    b.innerHTML = `<span class="dot" style="background:${labelColor};width:10px;height:10px;border-radius:50%;flex-shrink:0"></span><span>${label}</span>`;
    if (active) b.style.background = 'var(--accent-soft)';
    b.onmouseenter = () => (b.style.background = 'var(--accent-soft)');
    b.onmouseleave = () => (b.style.background = active ? 'var(--accent-soft)' : 'transparent');
    b.onclick = () => { closePops(); onClick(); };
    pop.appendChild(b);
  };

  mkItem(t('ungrouped'), '#999', () => setBatchGroup(null), false);
  state.groups.forEach((g) => {
    mkItem(escapeHtml(g.name), g.color, () => setBatchGroup(g.id), false);
  });

  const rect = ($('#batchBar') || document.body).getBoundingClientRect();
  const elW = $('#btnBatchMove');
  const anchor = (elW || $('#batchBar') || document.body).getBoundingClientRect();
  document.body.appendChild(pop);
  const x = Math.max(8, Math.min(anchor.left, window.innerWidth - pop.offsetWidth - 8));
  const y = Math.max(8, Math.min(anchor.top - pop.offsetHeight - 6, window.innerHeight - pop.offsetHeight - 8));
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
  activeColorPop = pop;
  setTimeout(() => document.addEventListener('mousedown', closePopsOnce), 0);
}

  return { toggleMultiSelect, clearSelection, syncSelectedVisual, toggleSelectNote, updateBatchCount, batchDeleteSelected, batchMoveSelected, setBatchGroup, openGroupPopForBatch };
}));
