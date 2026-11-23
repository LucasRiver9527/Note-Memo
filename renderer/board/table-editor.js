/* 表格数据操作、选区和单元格交互。纯数据变换由 table-logic.js 提供。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.tableEditorView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

function getTableById(n, id) {
  return (n.tables || []).find((x) => x.id === id);
}

function insertTableAtCursor(n, rows, cols) {
  const tbl = newTable(rows, cols, uid());
  n.tables = n.tables || [];
  n.tables.push(tbl);
  insertTextAtCaret(n, '\n[[table:' + tbl.id + ']]\n');
  cleanupRefs(n);
  n.updatedAt = Date.now();
  save();
  renderAll();
}

function removeTableFromNote(n, id) {
  n.tables = (n.tables || []).filter((x) => x.id !== id);
  n.content = (n.content || '').replace(new RegExp('\\[\\[table:' + id + '\\]\\]', 'g'), '');
  n.updatedAt = Date.now();
  save();
}

function refreshTableBlock(block, n) {
  const tbl = getTableById(n, block.dataset.tableId);
  if (!tbl) { block.remove(); return; }
  const tmp = document.createElement('div');
  tmp.innerHTML = tableBlockHtml(tbl);
  block.innerHTML = tmp.firstChild.innerHTML;
  n.updatedAt = Date.now();
  save();
  tableToolbarView.refreshToolbarEligibility(); // 结构变更后刷新按钮可用性
}

function deselectTable() {
  if (activeTableEl) activeTableEl.classList.remove('tbl-selected');
  activeTableEl = null;
  activeTableNote = null;
  activeTableSelCell = null;
  activeTableSelBox = null;
  tableToolbarView.hideTableToolbar();
}

function setActiveTable(block, n, cell) {
  if (activeTableEl && activeTableEl !== block) activeTableEl.classList.remove('tbl-selected');
  activeTableEl = block;
  activeTableNote = n;
  activeTableSelCell = cell;
  activeTableSelBox = null;
  block.classList.add('tbl-selected');
  $$('td', block).forEach((td) => td.classList.remove('cell-selected'));
  if (cell) {
    const td = $(`td[data-r="${cell.r}"][data-c="${cell.c}"]`, block);
    if (td) td.classList.add('cell-selected');
  }
  tableToolbarView.showTableToolbar(block);
}
function wireTables(el, n) {
  $$('.note-table-block', el).forEach((block) => {
    bindColumnResize(block, () => getTableById(n, block.dataset.tableId), () => refreshTableBlock(block, n));
    bindTableSelection(block, (cell) => setActiveTable(block, n, cell), (box) => {
      setActiveTable(block, n, null);
      activeTableSelBox = box;
      tableToolbarView.refreshToolbarEligibility();
    });
    block.addEventListener('dblclick', (e) => {
      const td = e.target.closest('td');
      if (!td) return;
      const r = Number(td.dataset.r), c = Number(td.dataset.c);
      const tbl = getTableById(n, block.dataset.tableId);
      if (!tbl) return;
      const diag = (tbl.diagonals || []).find((d) => d.r === r && d.c === c);
      if (diag) tableDialogsView.openDiagonalEditor(n, tbl, r, c, block);
      else editCell(block, td, n, tbl, r, c);
    });

    block.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (block.querySelector('.cell-editing')) return;
        e.preventDefault();
        e.stopPropagation();
        removeTableFromNote(n, block.dataset.tableId);
        deselectTable();
        renderAll();
      }
    });
    block.addEventListener('contextmenu', (e) => tableToolbarView.showTableContextMenu(e, n, block));
  });
}

function editCell(block, td, n, tbl, r, c) {
  if (td.classList.contains('cell-editing')) return; // 已在编辑：重复 dblclick 不再叠加监听器
  td.contentEditable = 'true';
  td.classList.add('cell-editing');
  td.focus();
  let composing = false;
  let finished = false;
  const done = (commit, nav, endFocus) => {
    if (finished) return; // 幂等：blur 与 mousedown 可能重复触发
    finished = true;
    document.removeEventListener('mousedown', onDocDown, true);
    td.onblur = null;
    td.onkeydown = null;
    td.removeEventListener('compositionstart', onCompStart);
    td.removeEventListener('compositionend', onCompEnd);
    td.contentEditable = 'false';
    td.classList.remove('cell-editing');
    if (commit) {
      tbl.cells[r][c] = readRichContent(td);
      refreshTableBlock(block, n);
    } else {
      const tmp = document.createElement('div');
      tmp.innerHTML = tableBlockHtml(tbl);
      block.innerHTML = tmp.firstChild.innerHTML;
    }
    if (nav) {
      // 重渲染后按 r/c 重新定位实时节点（绝不复用旧 td）。
      const target = findOrdinaryTableCell(block, nav.r, nav.c);
      if (target) {
        setActiveTable(block, n, { r: nav.r, c: nav.c });
        editCell(block, target, n, tbl, nav.r, nav.c);
      } else {
        setActiveTable(block, n, null);
        if (typeof block.focus === 'function') block.focus();
      }
      return;
    }
    if (endFocus || !commit) {
      // 边界 Tab 结束编辑 / Escape 取消：聚焦「实时」表格块，避免聚焦已脱离文档的 td。
      setActiveTable(block, n, null);
      if (typeof block.focus === 'function') block.focus();
    }
  };
  const onDocDown = (e) => { if (!td.contains(e.target)) done(true); };
  const onCompStart = () => { composing = true; };
  const onCompEnd = () => { composing = false; };
  document.addEventListener('mousedown', onDocDown, true);
  td.addEventListener('compositionstart', onCompStart);
  td.addEventListener('compositionend', onCompEnd);
  td.onblur = () => done(true);
  td.onkeydown = (e) => {
    if (composing || e.isComposing || e.keyCode === 229) return; // IME 组合态：把按键交给输入法
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation(); // 拥有的普通 Tab 不再冒泡给全局/自定义快捷键
      const nav = nextOrdinaryTableRC(block, td, e.shiftKey); // 提交前记录目标 r/c
      done(true, nav, !nav); // 无目标（边界）=> 提交并结束编辑
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); TextEditing.insertLineBreak(td); }
    else if (e.key === 'Escape') { e.preventDefault(); done(false); }
    else if (whichShortcut(e, state.settings, 'editor') === 'bold') { e.preventDefault(); toggleBold(td); }
    else if (whichShortcut(e, state.settings, 'editor') === 'highlight') { e.preventDefault(); toggleHighlight(td); }
  };
}

  return { getTableById, insertTableAtCursor, removeTableFromNote, refreshTableBlock, deselectTable, setActiveTable, wireTables, editCell };
}));
