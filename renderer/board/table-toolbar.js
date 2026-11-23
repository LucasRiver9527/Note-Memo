/* 表格浮动工具栏、选区可用性和右键动作。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.tableToolbarView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

function hideTableToolbar() {
  if (activeTableToolbar) { activeTableToolbar.remove(); activeTableToolbar = null; }
}

function showTableToolbar(block) {
  hideTableToolbar();
  const tb = document.createElement('div');
  tb.className = 'table-toolbar';
  // 可见短标签：主窗（简体）用现有本地化短标签；语义 aria-label/title 用完整本地化动作名。
  const btn = (label, ariaFull, fn, opts) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-label', ariaFull);
    b.title = ariaFull;
    b.dataset.act = (opts && opts.act) || '';
    b.onclick = (e) => { e.stopPropagation(); if (!b.disabled) fn(); };
    tb.appendChild(b);
    return b;
  };
  const btnRow = btn(t('tb_add_row'), t('add_row'), () => { const tbl = getTableById(activeTableNote, block.dataset.tableId); if (tbl) { tableAddRow(tbl); refreshTableBlock(block, activeTableNote); } });
  const btnCol = btn(t('tb_add_col'), t('add_col'), () => { const tbl = getTableById(activeTableNote, block.dataset.tableId); if (tbl) { tableAddCol(tbl); refreshTableBlock(block, activeTableNote); } });
  const btnDelRow = btn(t('tb_del_row'), t('del_row'), () => { const tbl = getTableById(activeTableNote, block.dataset.tableId); if (tbl && activeTableSelCell) { tableRemoveRow(tbl, activeTableSelCell.r); activeTableSelCell = null; refreshTableBlock(block, activeTableNote); } });
  const btnDelCol = btn(t('tb_del_col'), t('del_col'), () => { const tbl = getTableById(activeTableNote, block.dataset.tableId); if (tbl && activeTableSelCell) { tableRemoveCol(tbl, activeTableSelCell.c); activeTableSelCell = null; refreshTableBlock(block, activeTableNote); } });
  const btnMerge = btn(t('tb_merge'), t('merge_cells'), () => {
    const tbl = getTableById(activeTableNote, block.dataset.tableId);
    if (tbl && activeTableSelBox) { tableMerge(tbl, activeTableSelBox.r1, activeTableSelBox.c1, activeTableSelBox.r2, activeTableSelBox.c2); activeTableSelBox = null; refreshTableBlock(block, activeTableNote); }
  });
  const btnSplit = btn(t('tb_split'), t('split_cell'), () => {
    const tbl = getTableById(activeTableNote, block.dataset.tableId);
    if (tbl && activeTableSelCell) { tableSplit(tbl, activeTableSelCell.r, activeTableSelCell.c); refreshTableBlock(block, activeTableNote); }
  });
  // 斜线：始终打开编辑器（预填）；移除是编辑器内的独立按钮。禁用条件：无有效单元格或该格已合并。
  const btnDiag = btn(t('tb_diag'), t('diag_line'), () => {
    const tbl = getTableById(activeTableNote, block.dataset.tableId);
    if (tbl && activeTableSelCell) tableDialogsView.openDiagonalEditor(activeTableNote, tbl, activeTableSelCell.r, activeTableSelCell.c, block);
  });
  const btnSet = btn(t('tb_settings'), t('table_settings'), () => {
    const tbl = getTableById(activeTableNote, block.dataset.tableId);
    if (tbl) tableDialogsView.openTableSettingsDialog(activeTableNote, tbl, block);
  });
  btn(t('tb_del_table'), t('del_table'), () => { removeTableFromNote(activeTableNote, block.dataset.tableId); deselectTable(); renderAll(); });
  document.body.appendChild(tb);
  activeTableToolbar = tb;
  tb.__btn = { delRow: btnDelRow, delCol: btnDelCol, merge: btnMerge, split: btnSplit, diag: btnDiag, row: btnRow, col: btnCol, set: btnSet };
  refreshToolbarEligibility();
  const rect = block.getBoundingClientRect();
  tb.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - tb.offsetWidth - 4)) + 'px';
  tb.style.top = Math.max(4, rect.top - tb.offsetHeight - 6) + 'px';
}

// 依据当前选中（单元格/框选/合并状态）刷新工具栏按钮可用性；不改变任何数据。
function refreshToolbarEligibility() {
  const tb = activeTableToolbar;
  if (!tb || !tb.__btn) return;
  const tbl = activeTableNote ? getTableById(activeTableNote, activeTableEl && activeTableEl.dataset.tableId) : null;
  const btn = tb.__btn;
  const cell = activeTableSelCell;
  const box = activeTableSelBox;
  const validCell = !!(tbl && cell && tbl.cells[cell.r] && typeof tbl.cells[cell.r][cell.c] !== 'undefined');
  const merges = (tbl && Array.isArray(tbl.merges)) ? tbl.merges : [];
  const mergeAt = (r, c) => merges.find((m) => m && m.r === r && m.c === c);
  const coveredByMerge = (r, c) => merges.some((m) => m && r >= m.r && r < m.r + (m.rowspan || 1) && c >= m.c && c < m.c + (m.colspan || 1));
  const multiRect = !!(box && (box.r2 - box.r1 > 0 || box.c2 - box.c1 > 0));
  const anchorMerged = validCell && !!mergeAt(cell.r, cell.c);
  const cellMerged = validCell && coveredByMerge(cell.r, cell.c);
  const hasDiag = !!(tbl && validCell && (tbl.diagonals || []).some((d) => d && d.r === cell.r && d.c === cell.c));

  btn.delRow.disabled = !(validCell && tbl.rows > 1);
  btn.delCol.disabled = !(validCell && tbl.cols > 1);
  btn.merge.disabled = !multiRect;
  btn.split.disabled = !anchorMerged;
  btn.diag.disabled = !(validCell && !cellMerged); // 已合并（锚点或被覆盖）不可加斜线
  btn.diag.classList.toggle('has-diag', hasDiag);  // 已有斜线仍可打开（预填）
}

function showTableContextMenu(e, n, block) {
  e.preventDefault();
  e.stopPropagation();
  setActiveTable(block, n, null);
  const pop = document.createElement('div');
  pop.className = 'color-pop ctx-menu';
  pop.style.gridTemplateColumns = '1fr';
  pop.style.minWidth = '140px';
  pop.style.padding = '6px';
  const addItem = (icon, label, onClick, danger) => {
    const b = document.createElement('button');
    b.style.cssText = 'background:transparent;border:none;color:var(--fg);padding:7px 10px;border-radius:7px;cursor:pointer;text-align:left;font-size:12px;font-family:inherit;width:100%;display:flex;align-items:center;gap:8px;';
    b.innerHTML = `<span>${icon}</span><span>${label}</span>`;
    b.onmouseenter = () => (b.style.background = 'var(--accent-soft)');
    b.onmouseleave = () => (b.style.background = 'transparent');
    b.onclick = () => { pop.remove(); onClick(); };
    pop.appendChild(b);
  };
  addItem('⚙', t('table_settings'), () => {
    const tbl = getTableById(n, block.dataset.tableId);
    if (tbl) tableDialogsView.openTableSettingsDialog(n, tbl, block);
  });
  if (getTableById(n, block.dataset.tableId)?.columnWidths) {
    addItem('↔', t('table_auto_width'), () => {
      resetTableColumnWidths(getTableById(n, block.dataset.tableId), () => refreshTableBlock(block, n));
    });
  }
  addItem('🗑', t('del_table'), () => {
    removeTableFromNote(n, block.dataset.tableId);
    deselectTable();
    renderAll();
  }, true);
  // 菜单外观（透明度/亚克力）已归位到「设置 → 外观」，不再挂在每个右键菜单底部
  document.body.appendChild(pop);
  const x = Math.max(8, Math.min(e.clientX, window.innerWidth - pop.offsetWidth - 8));
  const y = Math.max(8, Math.min(e.clientY, window.innerHeight - pop.offsetHeight - 8));
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
  setTimeout(() => document.addEventListener('mousedown', function h(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', h); } }), 0);
}

  return { hideTableToolbar, showTableToolbar, refreshToolbarEligibility, showTableContextMenu };
}));
