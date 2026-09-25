/* 表格块编辑：插入/编辑/工具栏/对角/设置/右键菜单。依赖 table-logic.js 与顶层全局。
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.tableEditorView + 顶层全局。
   —— 本模块的函数通过顶层全局访问其他模块（与 board-layout.js 等同构）。 */
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

// 表格数据纯逻辑（newTable/tableAddRow/…/tableSplit）已收归 table-logic.js（可单测），此处由全局提供。
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

function openTableInsertDialog(n) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:6500;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;';
  const modal = document.createElement('div');
  modal.style.cssText = 'width:280px;background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;';
  modal.innerHTML = `
    <header style="padding:14px 16px;font-weight:700;border-bottom:1px solid var(--border)">${t('insert_table')}</header>
    <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
      <label style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--fg-dim)"><span>${t('table_rows')}</span><input id="tbRows" type="number" min="1" max="20" value="3" style="width:80px;background:var(--bg-soft);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px" /></label>
      <label style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--fg-dim)"><span>${t('table_cols')}</span><input id="tbCols" type="number" min="1" max="20" value="3" style="width:80px;background:var(--bg-soft);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px" /></label>
    </div>
    <footer style="padding:12px 16px;display:flex;gap:10px;justify-content:flex-end">
      <button id="tbCancel" class="sp-btn ghost" style="width:auto;padding:8px 18px">${t('cancel')}</button>
      <button id="tbOk" class="sp-btn primary" style="width:auto;padding:8px 18px">${t('ok')}</button>
    </footer>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const done = (ok) => {
    overlay.remove();
    if (ok) {
      const rows = Math.min(20, Math.max(1, Number($('#tbRows', modal).value) || 3));
      const cols = Math.min(20, Math.max(1, Number($('#tbCols', modal).value) || 3));
      insertTableAtCursor(n, rows, cols);
    }
  };
  $('#tbOk', modal).onclick = () => done(true);
  $('#tbCancel', modal).onclick = () => done(false);
}

function refreshTableBlock(block, n) {
  const tbl = getTableById(n, block.dataset.tableId);
  if (!tbl) { block.remove(); return; }
  const tmp = document.createElement('div');
  tmp.innerHTML = tableBlockHtml(tbl);
  block.innerHTML = tmp.firstChild.innerHTML;
  n.updatedAt = Date.now();
  save();
}

function deselectTable() {
  if (activeTableEl) activeTableEl.classList.remove('tbl-selected');
  activeTableEl = null;
  activeTableNote = null;
  activeTableSelCell = null;
  activeTableSelBox = null;
  hideTableToolbar();
}

function hideTableToolbar() {
  if (activeTableToolbar) { activeTableToolbar.remove(); activeTableToolbar = null; }
}

function showTableToolbar(block) {
  hideTableToolbar();
  const tb = document.createElement('div');
  tb.className = 'table-toolbar';
  const btn = (html, title, fn) => {
    const b = document.createElement('button');
    b.innerHTML = html;
    b.title = title;
    b.onclick = (e) => { e.stopPropagation(); fn(); };
    tb.appendChild(b);
  };
  btn('＋行', t('add_row'), () => { const tbl = getTableById(activeTableNote, block.dataset.tableId); if (tbl) { tableAddRow(tbl); refreshTableBlock(block, activeTableNote); } });
  btn('＋列', t('add_col'), () => { const tbl = getTableById(activeTableNote, block.dataset.tableId); if (tbl) { tableAddCol(tbl); refreshTableBlock(block, activeTableNote); } });
  btn('−行', t('del_row'), () => { const tbl = getTableById(activeTableNote, block.dataset.tableId); if (tbl && activeTableSelCell) { tableRemoveRow(tbl, activeTableSelCell.r); activeTableSelCell = null; refreshTableBlock(block, activeTableNote); } });
  btn('−列', t('del_col'), () => { const tbl = getTableById(activeTableNote, block.dataset.tableId); if (tbl && activeTableSelCell) { tableRemoveCol(tbl, activeTableSelCell.c); activeTableSelCell = null; refreshTableBlock(block, activeTableNote); } });
  btn('合并', t('merge_cells'), () => {
    const tbl = getTableById(activeTableNote, block.dataset.tableId);
    if (tbl && activeTableSelBox) { tableMerge(tbl, activeTableSelBox.r1, activeTableSelBox.c1, activeTableSelBox.r2, activeTableSelBox.c2); activeTableSelBox = null; refreshTableBlock(block, activeTableNote); }
  });
  btn('拆分', t('split_cell'), () => {
    const tbl = getTableById(activeTableNote, block.dataset.tableId);
    if (tbl && activeTableSelCell) { tableSplit(tbl, activeTableSelCell.r, activeTableSelCell.c); refreshTableBlock(block, activeTableNote); }
  });
  btn('斜线', t('diag_line'), () => {
    const tbl = getTableById(activeTableNote, block.dataset.tableId);
    if (tbl && activeTableSelCell) {
      const r = activeTableSelCell.r, c = activeTableSelCell.c;
      const has = (tbl.diagonals || []).some((d) => d.r === r && d.c === c);
      if (has) {
        tbl.diagonals = (tbl.diagonals || []).filter((d) => !(d.r === r && d.c === c));
        refreshTableBlock(block, activeTableNote);
      } else {
        openDiagonalEditor(activeTableNote, tbl, r, c);
      }
    }
  });
  btn('⚙', t('table_settings'), () => {
    const tbl = getTableById(activeTableNote, block.dataset.tableId);
    if (tbl) openTableSettingsDialog(activeTableNote, tbl);
  });
  btn('✕', t('del_table'), () => { removeTableFromNote(activeTableNote, block.dataset.tableId); deselectTable(); renderAll(); });
  document.body.appendChild(tb);
  activeTableToolbar = tb;
  const rect = block.getBoundingClientRect();
  tb.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - tb.offsetWidth - 4)) + 'px';
  tb.style.top = Math.max(4, rect.top - tb.offsetHeight - 6) + 'px';
}

function openDiagonalEditor(n, tbl, r, c) {
  const block = activeTableEl;
  const existing = (tbl.diagonals || []).find((d) => d.r === r && d.c === c);
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:6500;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;';
  const modal = document.createElement('div');
  modal.style.cssText = 'width:300px;background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;';
  let dir = (existing && existing.dir === 'trbl') ? 'trbl' : 'tlbr';
  modal.innerHTML = `
    <header style="padding:14px 16px;font-weight:700;border-bottom:1px solid var(--border)">${t('diag_line')}</header>
    <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;gap:6px">
        <button id="diagDirTL" class="seg ${dir === 'tlbr' ? 'active' : ''}" style="flex:1">↘ ${t('diag_tlbr')}</button>
        <button id="diagDirTR" class="seg ${dir === 'trbl' ? 'active' : ''}" style="flex:1">↙ ${t('diag_trbl')}</button>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--fg-dim)"><span style="width:56px">${t('diag_t1')}</span><input id="diagT1" style="flex:1;background:var(--bg-soft);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px" value="${escapeHtml(existing ? existing.t1 : '')}" /></label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--fg-dim)"><span style="width:56px">${t('diag_t2')}</span><input id="diagT2" style="flex:1;background:var(--bg-soft);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px" value="${escapeHtml(existing ? existing.t2 : '')}" /></label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--fg-dim)"><span style="width:56px">${t('diag_t_color')}</span><input id="diagTColor" type="color" value="${(existing && existing.tColor) || '#808080'}" style="width:46px;height:28px;border:1px solid var(--border);border-radius:6px;background:transparent;cursor:pointer;padding:2px" /></label>
      <div style="display:flex;gap:5px;flex-wrap:wrap;padding-left:64px;margin-top:-8px">${TEXT_COLORS.map(c => `<button type="button" class="diag-tc-swatch" data-c="${c}" style="width:18px;height:18px;border-radius:5px;cursor:pointer;border:2px solid ${((existing && existing.tColor) || '#808080') === c ? 'var(--accent)' : 'var(--border)'};background:${c};padding:0"></button>`).join('')}</div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--fg-dim)"><span style="width:56px">${t('diag_t_size')}</span><input id="diagTSize" type="number" min="10" max="24" value="${existing && existing.tSize ? existing.tSize : ''}" placeholder="${t('follow_global')}" style="width:80px;background:var(--bg-soft);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px" /></label>
    </div>
    <footer style="padding:12px 16px;display:flex;gap:10px;justify-content:space-between">
      <button id="diagRemove" class="sp-btn ghost" style="width:auto;padding:8px 12px;color:#e5484d">${t('diag_remove')}</button>
      <div style="display:flex;gap:10px">
        <button id="diagCancel" class="sp-btn ghost" style="width:auto;padding:8px 18px">${t('cancel')}</button>
        <button id="diagOk" class="sp-btn primary" style="width:auto;padding:8px 18px">${t('ok')}</button>
      </div>
    </footer>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  $('#diagDirTL', modal).onclick = () => { dir = 'tlbr'; $('#diagDirTL', modal).classList.add('active'); $('#diagDirTR', modal).classList.remove('active'); };
  $('#diagDirTR', modal).onclick = () => { dir = 'trbl'; $('#diagDirTR', modal).classList.add('active'); $('#diagDirTL', modal).classList.remove('active'); };
  $$('.diag-tc-swatch', modal).forEach((sw) => { sw.onclick = () => { $('#diagTColor', modal).value = sw.dataset.c; }; });
  const apply = () => {
    const t1 = $('#diagT1', modal).value;
    const t2 = $('#diagT2', modal).value;
    const tColor = $('#diagTColor', modal).value;
    const tSizeVal = $('#diagTSize', modal).value;
    const tSize = tSizeVal ? Math.min(24, Math.max(10, Number(tSizeVal) || 0)) : null;
    tbl.diagonals = (tbl.diagonals || []).filter((d) => !(d.r === r && d.c === c));
    tbl.diagonals.push({ r, c, dir, t1, t2, tColor, tSize });
    overlay.remove();
    if (block) refreshTableBlock(block, n);
  };
  $('#diagOk', modal).onclick = apply;
  $('#diagCancel', modal).onclick = () => overlay.remove();
  $('#diagRemove', modal).onclick = () => {
    tbl.diagonals = (tbl.diagonals || []).filter((d) => !(d.r === r && d.c === c));
    overlay.remove();
    if (block) refreshTableBlock(block, n);
  };
}

function openTableSettingsDialog(n, tbl) {
  const block = activeTableEl;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:6500;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;';
  const modal = document.createElement('div');
  modal.style.cssText = 'width:280px;background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;';
  const curColor = tbl.borderColor || '#808080';
  const curWidth = tbl.borderWidth != null ? tbl.borderWidth : 2;
  modal.innerHTML = `
    <header style="padding:14px 16px;font-weight:700;border-bottom:1px solid var(--border)">${t('table_settings')}</header>
    <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
      <label style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--fg-dim)"><span>${t('tbl_border_color')}</span><input id="tblBColor" type="color" value="${curColor}" style="width:46px;height:28px;border:1px solid var(--border);border-radius:6px;background:transparent;cursor:pointer;padding:2px" /></label>
      <label style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--fg-dim)"><span>${t('tbl_border_width')}</span><input id="tblBWidth" type="range" min="1" max="6" value="${curWidth}" style="width:150px;accent-color:var(--accent)" /></label>
      <div id="tblBWidthVal" style="text-align:right;font-size:12px;color:var(--fg-dim)">${curWidth}px</div>
      <label style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--fg-dim)"><span>${t('tbl_text_color')}</span><input id="tblTColor" type="color" value="${tbl.textColor || '#808080'}" style="width:46px;height:28px;border:1px solid var(--border);border-radius:6px;background:transparent;cursor:pointer;padding:2px" /></label>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:-8px">${TEXT_COLORS.map(c => `<button type="button" class="tbl-tc-swatch" data-c="${c}" style="width:18px;height:18px;border-radius:5px;cursor:pointer;border:2px solid ${(tbl.textColor || '#808080') === c ? 'var(--accent)' : 'var(--border)'};background:${c};padding:0"></button>`).join('')}</div>
      <label style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--fg-dim)"><span>${t('tbl_text_size')}</span><input id="tblTSize" type="number" min="10" max="24" value="${tbl.fontSize ? tbl.fontSize : ''}" placeholder="${t('follow_global')}" style="width:80px;background:var(--bg-soft);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px" /></label>
    </div>
    <footer style="padding:12px 16px;display:flex;gap:10px;justify-content:flex-end">
      <button id="tblSetCancel" class="sp-btn ghost" style="width:auto;padding:8px 18px">${t('cancel')}</button>
      <button id="tblSetOk" class="sp-btn primary" style="width:auto;padding:8px 18px">${t('ok')}</button>
    </footer>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const wVal = $('#tblBWidthVal', modal);
  $('#tblBWidth', modal).addEventListener('input', (e) => { wVal.textContent = e.target.value + 'px'; });
  $$('.tbl-tc-swatch', modal).forEach((sw) => { sw.onclick = () => { $('#tblTColor', modal).value = sw.dataset.c; }; });
  const done = (ok) => {
    overlay.remove();
    if (ok) {
      tbl.borderColor = $('#tblBColor', modal).value || null;
      tbl.borderWidth = Number($('#tblBWidth', modal).value) || 2;
      tbl.textColor = $('#tblTColor', modal).value || null;
      const tSizeVal = $('#tblTSize', modal).value;
      tbl.fontSize = tSizeVal ? Math.min(24, Math.max(10, Number(tSizeVal) || 0)) : null;
      if (block) refreshTableBlock(block, n);
      else { n.updatedAt = Date.now(); save(); renderAll(); }
    }
  };
  $('#tblSetOk', modal).onclick = () => done(true);
  $('#tblSetCancel', modal).onclick = () => done(false);
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
    if (tbl) openTableSettingsDialog(n, tbl);
  });
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
  showTableToolbar(block);
}

function highlightBox(block, box) {
  $$('td', block).forEach((td) => {
    const r = Number(td.dataset.r), c = Number(td.dataset.c);
    td.classList.toggle('box-selected', r >= box.r1 && r <= box.r2 && c >= box.c1 && c <= box.c2);
  });
}

function wireTables(el, n) {
  $$('.note-table-block', el).forEach((block) => {
    block.addEventListener('click', (e) => {
      e.stopPropagation();
      if (Date.now() - lastTableBoxTime < 150) return;
      const td = e.target.closest('td');
      if (td) setActiveTable(block, n, { r: Number(td.dataset.r), c: Number(td.dataset.c) });
      else setActiveTable(block, n, null);
    });

    block.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const td = e.target.closest('td');
      if (!td) return;
      e.preventDefault();
      const startR = Number(td.dataset.r), startC = Number(td.dataset.c);
      let box = { r1: startR, c1: startC, r2: startR, c2: startC };
      let moved = false;
      const onMove = (ev) => {
        const t = document.elementFromPoint(ev.clientX, ev.clientY);
        const tdd = t && t.closest ? t.closest('td') : null;
        if (tdd) {
          const rr = Number(tdd.dataset.r), cc = Number(tdd.dataset.c);
          box = { r1: Math.min(startR, rr), c1: Math.min(startC, cc), r2: Math.max(startR, rr), c2: Math.max(startC, cc) };
          if (box.r2 - box.r1 > 0 || box.c2 - box.c1 > 0) moved = true;
          highlightBox(block, box);
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (moved) {
          lastTableBoxTime = Date.now();
          setActiveTable(block, n, null);
          activeTableSelBox = box;
          highlightBox(block, box);
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    block.addEventListener('dblclick', (e) => {
      const td = e.target.closest('td');
      if (!td) return;
      const r = Number(td.dataset.r), c = Number(td.dataset.c);
      const tbl = getTableById(n, block.dataset.tableId);
      if (!tbl) return;
      const diag = (tbl.diagonals || []).find((d) => d.r === r && d.c === c);
      if (diag) openDiagonalEditor(n, tbl, r, c);
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
    block.addEventListener('contextmenu', (e) => showTableContextMenu(e, n, block));
  });
}

function editCell(block, td, n, tbl, r, c) {
  td.contentEditable = 'true';
  td.classList.add('cell-editing');
  td.focus();
  const done = (commit) => {
    document.removeEventListener('mousedown', onDocDown, true);
    td.onblur = null;
    td.onkeydown = null;
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
  };
  const onDocDown = (e) => { if (!td.contains(e.target)) done(true); };
  document.addEventListener('mousedown', onDocDown, true);
  td.onblur = () => done(true);
  td.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); }
    else if (e.key === 'Escape') { e.preventDefault(); done(false); }
    else if (whichShortcut(e, state.settings, 'editor') === 'bold') { e.preventDefault(); toggleBold(td); }
    else if (whichShortcut(e, state.settings, 'editor') === 'highlight') { e.preventDefault(); toggleHighlight(td); }
  };
}

  return { getTableById, insertTableAtCursor, removeTableFromNote, openTableInsertDialog, refreshTableBlock, deselectTable, hideTableToolbar, showTableToolbar, openDiagonalEditor, openTableSettingsDialog, showTableContextMenu, setActiveTable, highlightBox, wireTables, editCell };
}));
