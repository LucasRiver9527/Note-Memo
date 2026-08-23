const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

const NOTE_COLORS = ['#000000', '#1e1e28', '#2d2f38', '#24344d', '#3a2a4d', '#1f3d33', '#4d2a2a', '#f7d65a', '#ffb3c1', '#a8e6cf', '#a0d8ff', '#d0b3ff', '#ffd8a8', '#f5a97f', '#e6c9ff'];
const TEXT_COLORS = ['#2d2f38', '#000000', '#444444', '#ffffff', '#c0392b', '#b8860b', '#1e5a8a', '#1e7d5a', '#5b2d8f', '#7f8c8d'];

function uid() { return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
// 复用 logic.js 的 isDarkColor，避免两窗口各自实现同一算法
const isDark = isDarkColor;

const noteId = new URLSearchParams(location.search).get('id');
let note = null;
let settings = {};
let saveTimer = null;
let lang = 'zh';
let savedRange = null;
let savedSelText = '';
let savedImageSrc = null;
let copiedImage = null;

function tr(key) {
  return T(key, lang, I18N_MERGED);
}

function markdownOn() { return settings.markdown !== false; }
function highlightColor() { return settings.highlightColor || '#fff59d'; }

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
  savedImageSrc = null;
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

function toggleHighlight(contentEl) {
  if (contentEl) contentEl.focus();
  if (selectionHasHighlight()) {
    removeHighlightFromSelection();
    if (contentEl) contentEl.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    document.execCommand('hiliteColor', false, highlightColor());
  }
}

function getSelectedImageSrc() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed) {
    const frag = sel.getRangeAt(0).cloneContents();
    const img = frag.querySelector('.inline-img img');
    if (img) return img.getAttribute('src');
  }
  const el = document.querySelector('.inline-img.selected img');
  if (el) return el.getAttribute('src');
  return null;
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (note) {
      cleanupRefs();
      window.api.noteUpdate(note);
    }
  }, 300);
}

// 富文本/表格 HTML 构建已统一到 logic.js（单一来源），此处由 logic.js 全局提供；
// 仅在此注入本窗口翻译器与 Markdown 开关。
setRenderLocale({ tr, mdOn: markdownOn });

function readRichContent(root) {
  let out = '';
  (root.childNodes || []).forEach((node) => {
    if (node.nodeType === 3) {
      out += node.textContent;
    } else if (node.nodeType === 1) {
      const tag = node.tagName;
      if (node.classList && node.classList.contains('inline-img')) {
        out += '[[img:' + node.getAttribute('data-img-id') + ']]';
      } else if (node.classList && node.classList.contains('file-link')) {
        out += '[[file:' + node.getAttribute('data-file-id') + ']]';
      } else if (node.classList && node.classList.contains('note-table-block')) {
        out += '[[table:' + node.getAttribute('data-table-id') + ']]';
      } else if (tag === 'BR') {
        out += '\n';
      } else if (tag === 'B' || tag === 'STRONG') {
        out += '**' + readRichContent(node) + '**';
      } else if (tag === 'MARK') {
        out += '==' + readRichContent(node) + '==';
      } else if (tag === 'FONT' && node.getAttribute('color')) {
        out += '[[c:' + node.getAttribute('color') + ']]' + readRichContent(node) + '[[/c]]';
      } else if (tag === 'SPAN' && node.style) {
        const bg = node.style.backgroundColor;
        const fw = node.style.fontWeight;
        const color = node.style.color;
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
          out += '==' + readRichContent(node) + '==';
        } else if (color && color !== '' && color !== 'inherit') {
          out += '[[c:' + color + ']]' + readRichContent(node) + '[[/c]]';
        } else if (fw === 'bold' || Number(fw) >= 600) {
          out += '**' + readRichContent(node) + '**';
        } else {
          out += readRichContent(node);
        }
      } else if ((tag === 'DIV' || tag === 'P') && node.style && node.style.textAlign && node.style.textAlign !== '' && node.style.textAlign !== 'start') {
        out += '[[align:' + node.style.textAlign + ']]' + readRichContent(node) + '[[/align]]';
      } else {
        out += readRichContent(node);
      }
    }
  });
  if (root && root.style && root.style.textAlign && root.style.textAlign !== '' && root.style.textAlign !== 'start' &&
      /dn-content/.test(root.className || '')) {
    return '[[align:' + root.style.textAlign + ']]' + out + '[[/align]]';
  }
  return out;
}

// 复用 logic.js 的同名纯逻辑（单一来源），仅绑定到当前 note 全局变量
function refIdsOf() { return NoteLogic.refIdsOf(note); }
function cleanupRefs() { if (note) NoteLogic.cleanupRefs(note); }

function wireImages() {
  $$('.inline-img').forEach((item) => {
    const id = item.dataset.imgId;
    const img = $('img', item);
    const del = $('.img-del', item);
    const handle = $('.img-resize', item);

    if (img) {
      const markMissing = () => {
        item.classList.add('img-missing');
        if (handle) handle.remove();
        const label = document.createElement('div');
        label.className = 'img-missing-label';
        label.textContent = tr('img_missing');
        img.replaceWith(label);
      };
      img.addEventListener('error', markMissing);
      if (img.complete && img.naturalWidth === 0) markMissing();
    }

    const removeImage = () => {
      note.images = (note.images || []).filter((x) => x.id !== id);
      note.content = (note.content || '').replace(new RegExp('\\[\\[img:' + id + '\\]\\]', 'g'), '');
      save();
      renderBody();
    };

    if (del) del.onclick = (e) => { e.stopPropagation(); removeImage(); };
    item.setAttribute('tabindex', '0');
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        e.stopPropagation();
        removeImage();
      }
    });

    if (handle) handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const imgObj = (note.images || []).find((x) => x.id === id);
      if (!imgObj) return;
      const startX = e.clientX;
      const startW = imgObj.w || 200;
      const onMove = (ev) => {
        const w = Math.max(60, Math.round(startW + (ev.clientX - startX)));
        imgObj.w = w;
        img.style.width = w + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        save();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

/* ============ 表格 ============ */
let activeTableEl = null;
let activeTableToolbar = null;
let activeTableSelCell = null;
let activeTableSelBox = null;
let lastTableBoxTime = 0;

function newTable(rows, cols) {
  const cells = [];
  for (let r = 0; r < rows; r++) cells.push(new Array(cols).fill(''));
  return { id: uid(), rows, cols, cells, merges: [], diagonals: [], borderWidth: 3, borderColor: null, fontSize: null, textColor: null };
}

function getTableById(id) {
  return (note.tables || []).find((x) => x.id === id);
}

function insertTableAtCursor(rows, cols) {
  const tbl = newTable(rows, cols);
  note.tables = note.tables || [];
  note.tables.push(tbl);
  insertMarkerAtCursor('\n[[table:' + tbl.id + ']]\n');
  cleanupRefs();
  save();
  renderBody();
}

function removeTableFromNote(id) {
  note.tables = (note.tables || []).filter((x) => x.id !== id);
  note.content = (note.content || '').replace(new RegExp('\\[\\[table:' + id + '\\]\\]', 'g'), '');
  save();
}

function openTableInsertDialog() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:6500;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;';
  const modal = document.createElement('div');
  modal.style.cssText = 'width:280px;background:#1e1f26;border:1px solid rgba(255,255,255,0.1);border-radius:14px;overflow:hidden;';
  modal.innerHTML = `
    <header style="padding:14px 16px;font-weight:700;border-bottom:1px solid rgba(255,255,255,0.1)">${tr('insert_table')}</header>
    <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
      <label style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:#9a9ba6"><span>${tr('table_rows')}</span><input id="tbRows" type="number" min="1" max="20" value="3" style="width:80px;background:#26272f;color:#ececf1;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px" /></label>
      <label style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:#9a9ba6"><span>${tr('table_cols')}</span><input id="tbCols" type="number" min="1" max="20" value="3" style="width:80px;background:#26272f;color:#ececf1;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px" /></label>
    </div>
    <footer style="padding:12px 16px;display:flex;gap:10px;justify-content:flex-end">
      <button id="tbCancel" style="background:transparent;border:1px solid rgba(255,255,255,0.1);color:#9a9ba6;padding:8px 18px;border-radius:8px;cursor:pointer">${tr('cancel')}</button>
      <button id="tbOk" style="background:#6c5ce7;color:#fff;border:none;padding:8px 18px;border-radius:8px;cursor:pointer">${tr('ok')}</button>
    </footer>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const done = (ok) => {
    overlay.remove();
    if (ok) {
      const rows = Math.min(20, Math.max(1, Number($('#tbRows', modal).value) || 3));
      const cols = Math.min(20, Math.max(1, Number($('#tbCols', modal).value) || 3));
      insertTableAtCursor(rows, cols);
    }
  };
  $('#tbOk', modal).onclick = () => done(true);
  $('#tbCancel', modal).onclick = () => done(false);
}

function tableAddRow(tbl) { tbl.rows++; tbl.cells.push(new Array(tbl.cols).fill('')); }
function tableAddCol(tbl) { tbl.cols++; (tbl.cells || []).forEach((row) => row.push('')); }
function tableRemoveRow(tbl, r) {
  if (tbl.rows <= 1) return;
  tbl.rows--;
  tbl.cells.splice(r, 1);
  tbl.merges = (tbl.merges || []).filter((m) => m.r !== r).map((m) => m.r > r ? { r: m.r - 1, c: m.c, rowspan: m.rowspan, colspan: m.colspan } : m);
  tbl.diagonals = (tbl.diagonals || []).filter((d) => d.r !== r).map((d) => d.r > r ? { r: d.r - 1, c: d.c, dir: d.dir, t1: d.t1, t2: d.t2 } : d);
}
function tableRemoveCol(tbl, c) {
  if (tbl.cols <= 1) return;
  tbl.cols--;
  (tbl.cells || []).forEach((row) => row.splice(c, 1));
  tbl.merges = (tbl.merges || []).filter((m) => m.c !== c).map((m) => m.c > c ? { r: m.r, c: m.c - 1, rowspan: m.rowspan, colspan: m.colspan } : m);
  tbl.diagonals = (tbl.diagonals || []).filter((d) => d.c !== c).map((d) => d.c > c ? { r: d.r, c: d.c - 1, dir: d.dir, t1: d.t1, t2: d.t2 } : d);
}
function tableMerge(tbl, r1, c1, r2, c2) {
  if (r1 === r2 && c1 === c2) return;
  tbl.merges = (tbl.merges || []).filter((m) => !(m.r >= r1 && m.r <= r2 && m.c >= c1 && m.c <= c2));
  tbl.diagonals = (tbl.diagonals || []).filter((d) => !(d.r >= r1 && d.r <= r2 && d.c >= c1 && d.c <= c2));
  const joined = [];
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) {
      const t = (tbl.cells[r] && tbl.cells[r][c]) || '';
      if (t) joined.push(t);
    }
  tbl.merges.push({ r: r1, c: c1, rowspan: r2 - r1 + 1, colspan: c2 - c1 + 1 });
  tbl.cells[r1][c1] = joined.join(' ');
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++)
      if (r !== r1 || c !== c1) tbl.cells[r][c] = '';
}
function tableSplit(tbl, r, c) {
  const idx = (tbl.merges || []).findIndex((m) => m.r === r && m.c === c);
  if (idx >= 0) tbl.merges.splice(idx, 1);
}

function refreshTableBlock(block) {
  const tbl = getTableById(block.dataset.tableId);
  if (!tbl) { block.remove(); return; }
  const tmp = document.createElement('div');
  tmp.innerHTML = tableBlockHtml(tbl);
  block.innerHTML = tmp.firstChild.innerHTML;
  save();
}

function deselectTable() {
  if (activeTableEl) activeTableEl.classList.remove('tbl-selected');
  activeTableEl = null;
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
  btn('＋行', tr('add_row'), () => { const tbl = getTableById(block.dataset.tableId); if (tbl) { tableAddRow(tbl); refreshTableBlock(block); } });
  btn('＋列', tr('add_col'), () => { const tbl = getTableById(block.dataset.tableId); if (tbl) { tableAddCol(tbl); refreshTableBlock(block); } });
  btn('−行', tr('del_row'), () => { const tbl = getTableById(block.dataset.tableId); if (tbl && activeTableSelCell) { tableRemoveRow(tbl, activeTableSelCell.r); activeTableSelCell = null; refreshTableBlock(block); } });
  btn('−列', tr('del_col'), () => { const tbl = getTableById(block.dataset.tableId); if (tbl && activeTableSelCell) { tableRemoveCol(tbl, activeTableSelCell.c); activeTableSelCell = null; refreshTableBlock(block); } });
  btn('合并', tr('merge_cells'), () => { const tbl = getTableById(block.dataset.tableId); if (tbl && activeTableSelBox) { tableMerge(tbl, activeTableSelBox.r1, activeTableSelBox.c1, activeTableSelBox.r2, activeTableSelBox.c2); activeTableSelBox = null; refreshTableBlock(block); } });
  btn('拆分', tr('split_cell'), () => { const tbl = getTableById(block.dataset.tableId); if (tbl && activeTableSelCell) { tableSplit(tbl, activeTableSelCell.r, activeTableSelCell.c); refreshTableBlock(block); } });
  btn('斜线', tr('diag_line'), () => { const tbl = getTableById(block.dataset.tableId); if (tbl && activeTableSelCell) { const r = activeTableSelCell.r, c = activeTableSelCell.c; const has = (tbl.diagonals || []).some((d) => d.r === r && d.c === c); if (has) { tbl.diagonals = (tbl.diagonals || []).filter((d) => !(d.r === r && d.c === c)); refreshTableBlock(block); } else { openDiagonalEditor(tbl, r, c); } } });
  btn('⚙', tr('table_settings'), () => { const tbl = getTableById(block.dataset.tableId); if (tbl) openTableSettingsDialog(tbl); });
  btn('✕', tr('del_table'), () => { removeTableFromNote(block.dataset.tableId); deselectTable(); renderBody(); });
  document.body.appendChild(tb);
  activeTableToolbar = tb;
  const rect = block.getBoundingClientRect();
  tb.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - tb.offsetWidth - 4)) + 'px';
  tb.style.top = Math.max(4, rect.top - tb.offsetHeight - 6) + 'px';
}

function openDiagonalEditor(tbl, r, c) {
  const block = activeTableEl;
  const existing = (tbl.diagonals || []).find((d) => d.r === r && d.c === c);
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:6500;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;';
  const modal = document.createElement('div');
  modal.style.cssText = 'width:300px;background:#1e1f26;border:1px solid rgba(255,255,255,0.1);border-radius:14px;overflow:hidden;';
  let dir = (existing && existing.dir === 'trbl') ? 'trbl' : 'tlbr';
  modal.innerHTML = `
    <header style="padding:14px 16px;font-weight:700;border-bottom:1px solid rgba(255,255,255,0.1)">${tr('diag_line')}</header>
    <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;gap:6px">
        <button id="diagDirTL" style="flex:1;padding:7px;border-radius:8px;cursor:pointer;border:1px solid rgba(255,255,255,0.1);background:${dir === 'tlbr' ? '#6c5ce7' : 'transparent'};color:${dir === 'tlbr' ? '#fff' : '#9a9ba6'}">↘ ${tr('diag_tlbr')}</button>
        <button id="diagDirTR" style="flex:1;padding:7px;border-radius:8px;cursor:pointer;border:1px solid rgba(255,255,255,0.1);background:${dir === 'trbl' ? '#6c5ce7' : 'transparent'};color:${dir === 'trbl' ? '#fff' : '#9a9ba6'}">↙ ${tr('diag_trbl')}</button>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#9a9ba6"><span style="width:56px">${tr('diag_t1')}</span><input id="diagT1" style="flex:1;background:#26272f;color:#ececf1;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px" value="${escapeHtml(existing ? existing.t1 : '')}" /></label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#9a9ba6"><span style="width:56px">${tr('diag_t2')}</span><input id="diagT2" style="flex:1;background:#26272f;color:#ececf1;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px" value="${escapeHtml(existing ? existing.t2 : '')}" /></label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#9a9ba6"><span style="width:56px">${tr('diag_t_color')}</span><input id="diagTColor" type="color" value="${(existing && existing.tColor) || '#808080'}" style="width:46px;height:28px;border:1px solid rgba(255,255,255,0.1);border-radius:6px;background:transparent;cursor:pointer;padding:2px" /></label>
      <div style="display:flex;gap:5px;flex-wrap:wrap;padding-left:64px;margin-top:-8px">${TEXT_COLORS.map(c => `<button type="button" class="diag-tc-swatch" data-c="${c}" style="width:18px;height:18px;border-radius:5px;cursor:pointer;border:2px solid ${((existing && existing.tColor) || '#808080') === c ? '#6c5ce7' : 'rgba(255,255,255,0.1)'};background:${c};padding:0"></button>`).join('')}</div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#9a9ba6"><span style="width:56px">${tr('diag_t_size')}</span><input id="diagTSize" type="number" min="10" max="24" value="${existing && existing.tSize ? existing.tSize : ''}" placeholder="${tr('follow_global')}" style="width:80px;background:#26272f;color:#ececf1;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px" /></label>
    </div>
    <footer style="padding:12px 16px;display:flex;gap:10px;justify-content:space-between">
      <button id="diagRemove" style="background:transparent;border:1px solid rgba(229,72,77,0.4);color:#e5484d;padding:8px 12px;border-radius:8px;cursor:pointer">${tr('diag_remove')}</button>
      <div style="display:flex;gap:10px">
        <button id="diagCancel" style="background:transparent;border:1px solid rgba(255,255,255,0.1);color:#9a9ba6;padding:8px 18px;border-radius:8px;cursor:pointer">${tr('cancel')}</button>
        <button id="diagOk" style="background:#6c5ce7;color:#fff;border:none;padding:8px 18px;border-radius:8px;cursor:pointer">${tr('ok')}</button>
      </div>
    </footer>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  $('#diagDirTL', modal).onclick = () => { dir = 'tlbr'; $('#diagDirTL', modal).style.background = '#6c5ce7'; $('#diagDirTL', modal).style.color = '#fff'; $('#diagDirTR', modal).style.background = 'transparent'; $('#diagDirTR', modal).style.color = '#9a9ba6'; };
  $('#diagDirTR', modal).onclick = () => { dir = 'trbl'; $('#diagDirTR', modal).style.background = '#6c5ce7'; $('#diagDirTR', modal).style.color = '#fff'; $('#diagDirTL', modal).style.background = 'transparent'; $('#diagDirTL', modal).style.color = '#9a9ba6'; };
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
    if (block) refreshTableBlock(block);
  };
  $('#diagOk', modal).onclick = apply;
  $('#diagCancel', modal).onclick = () => overlay.remove();
  $('#diagRemove', modal).onclick = () => {
    tbl.diagonals = (tbl.diagonals || []).filter((d) => !(d.r === r && d.c === c));
    overlay.remove();
    if (block) refreshTableBlock(block);
  };
}

function openTableSettingsDialog(tbl) {
  const block = activeTableEl;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:6500;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;';
  const modal = document.createElement('div');
  modal.style.cssText = 'width:280px;background:#1e1f26;border:1px solid rgba(255,255,255,0.1);border-radius:14px;overflow:hidden;';
  const curColor = tbl.borderColor || '#808080';
  const curWidth = tbl.borderWidth != null ? tbl.borderWidth : 2;
  modal.innerHTML = `
    <header style="padding:14px 16px;font-weight:700;border-bottom:1px solid rgba(255,255,255,0.1)">${tr('table_settings')}</header>
    <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
      <label style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:#9a9ba6"><span>${tr('tbl_border_color')}</span><input id="tblBColor" type="color" value="${curColor}" style="width:46px;height:28px;border:1px solid rgba(255,255,255,0.1);border-radius:6px;background:transparent;cursor:pointer;padding:2px" /></label>
      <label style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:#9a9ba6"><span>${tr('tbl_border_width')}</span><input id="tblBWidth" type="range" min="1" max="6" value="${curWidth}" style="width:150px;accent-color:#6c5ce7" /></label>
      <div id="tblBWidthVal" style="text-align:right;font-size:12px;color:#9a9ba6">${curWidth}px</div>
      <label style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:#9a9ba6"><span>${tr('tbl_text_color')}</span><input id="tblTColor" type="color" value="${tbl.textColor || '#808080'}" style="width:46px;height:28px;border:1px solid rgba(255,255,255,0.1);border-radius:6px;background:transparent;cursor:pointer;padding:2px" /></label>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:-8px">${TEXT_COLORS.map(c => `<button type="button" class="tbl-tc-swatch" data-c="${c}" style="width:18px;height:18px;border-radius:5px;cursor:pointer;border:2px solid ${(tbl.textColor || '#808080') === c ? '#6c5ce7' : 'rgba(255,255,255,0.1)'};background:${c};padding:0"></button>`).join('')}</div>
      <label style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:#9a9ba6"><span>${tr('tbl_text_size')}</span><input id="tblTSize" type="number" min="10" max="24" value="${tbl.fontSize ? tbl.fontSize : ''}" placeholder="${tr('follow_global')}" style="width:80px;background:#26272f;color:#ececf1;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px" /></label>
    </div>
    <footer style="padding:12px 16px;display:flex;gap:10px;justify-content:flex-end">
      <button id="tblSetCancel" style="background:transparent;border:1px solid rgba(255,255,255,0.1);color:#9a9ba6;padding:8px 18px;border-radius:8px;cursor:pointer">${tr('cancel')}</button>
      <button id="tblSetOk" style="background:#6c5ce7;color:#fff;border:none;padding:8px 18px;border-radius:8px;cursor:pointer">${tr('ok')}</button>
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
      if (block) refreshTableBlock(block);
      else { save(); renderBody(); }
    }
  };
  $('#tblSetOk', modal).onclick = () => done(true);
  $('#tblSetCancel', modal).onclick = () => done(false);
}

function showTableContextMenu(e, block) {
  e.preventDefault();
  e.stopPropagation();
  setActiveTable(block, null);
  const pop = document.createElement('div');
  pop.className = 'ctx-menu';
  pop.style.minWidth = '140px';
  const addItem = (icon, label, onClick) => {
    const b = document.createElement('button');
    b.className = 'cm-item';
    b.innerHTML = `<span>${icon}</span><span>${label}</span>`;
    b.onclick = () => { pop.remove(); onClick(); };
    pop.appendChild(b);
  };
  addItem('⚙', tr('table_settings'), () => {
    const tbl = getTableById(block.dataset.tableId);
    if (tbl) openTableSettingsDialog(tbl);
  });
  addItem('🗑', tr('del_table'), () => {
    removeTableFromNote(block.dataset.tableId);
    deselectTable();
    renderBody();
  });
  pop.classList.remove('hidden');
  document.body.appendChild(pop);
  const x = Math.max(4, Math.min(e.clientX, window.innerWidth - pop.offsetWidth - 4));
  const y = Math.max(4, Math.min(e.clientY, window.innerHeight - pop.offsetHeight - 4));
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
  setTimeout(() => document.addEventListener('mousedown', function h(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', h); } }), 0);
}

function setActiveTable(block, cell) {
  if (activeTableEl && activeTableEl !== block) activeTableEl.classList.remove('tbl-selected');
  activeTableEl = block;
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

function wireTables() {
  $$('.note-table-block').forEach((block) => {
    block.addEventListener('click', (e) => {
      e.stopPropagation();
      if (Date.now() - lastTableBoxTime < 150) return;
      const td = e.target.closest('td');
      if (td) setActiveTable(block, { r: Number(td.dataset.r), c: Number(td.dataset.c) });
      else setActiveTable(block, null);
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
          setActiveTable(block, null);
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
      const tbl = getTableById(block.dataset.tableId);
      if (!tbl) return;
      const diag = (tbl.diagonals || []).find((d) => d.r === r && d.c === c);
      if (diag) openDiagonalEditor(tbl, r, c);
      else editCell(block, td, tbl, r, c);
    });
    block.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (block.querySelector('.cell-editing')) return;
        e.preventDefault();
        e.stopPropagation();
        removeTableFromNote(block.dataset.tableId);
        deselectTable();
        renderBody();
      }
    });
    block.addEventListener('contextmenu', (e) => showTableContextMenu(e, block));
  });
}

function editCell(block, td, tbl, r, c) {
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
      refreshTableBlock(block);
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
    else if (e.ctrlKey && !e.shiftKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); toggleBold(td); }
    else if (e.ctrlKey && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); toggleHighlight(td); }
  };
}

function insertMarkerAtCursor(marker) {
  const content = $('#dnText');
  if (content && (document.activeElement === content || content.contains(document.activeElement))) {
    content.focus();
    document.execCommand('insertText', false, marker);
    note.content = readRichContent(content);
  } else if (content && savedRange) {
    content.focus();
    restoreSelection();
    document.execCommand('insertText', false, marker);
    note.content = readRichContent(content);
  } else {
    note.content = ((note.content || '').trim() ? note.content + '\n' : '') + marker;
  }
  clearSavedSelection();
}

function addImageToNote(img) {
  note.images = note.images || [];
  note.images.push(img);
  insertMarkerAtCursor('[[img:' + img.id + ']]');
  cleanupRefs();
  save();
  renderBody();
}

function insertImageReferenceAtCursor(src, w) {
  addImageToNote({ id: uid(), src, w: w || 200 });
}

function addFileToNote(path, isDir) {
  const id = uid();
  note.files = note.files || [];
  note.files.push({ id, path, isDir });
  insertMarkerAtCursor('[[file:' + id + ']]');
  cleanupRefs();
  save();
  renderBody();
}

async function insertPastedFilesAtCursor(paths) {
  for (const p of paths) {
    const lower = p.toLowerCase();
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
    if (imageExts.some((e) => lower.endsWith(e))) {
      const r = await window.api.addImageFile(p);
      if (r.ok) addImageToNote({ id: uid(), src: r.url, w: 200 });
    } else {
      const st = await window.api.statPath(p);
      if (st && st.exists) addFileToNote(p, !!st.isDirectory);
    }
  }
}

async function handleImagePaste(cd) {
  const items = Array.from(cd.items || []);
  for (const it of items) {
    if (it.type && it.type.indexOf('image') === 0) {
      const blob = it.getAsFile();
      if (!blob) continue;
      const dataUrl = await new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.readAsDataURL(blob);
      });
      const r = await window.api.saveNoteImage(dataUrl);
      if (r.ok) addImageToNote({ id: uid(), src: r.url, w: 200 });
      return;
    }
  }
}

function renderBody() {
  deselectTable();
  const body = $('#dnBody');
  if (note.type === 'todo') {
    const items = note.items || [];
    body.innerHTML = `<ul class="todo-list">${items.map((it, idx) => `
      <li class="todo-item ${it.done ? 'done' : ''}" data-idx="${idx}">
        <input type="checkbox" ${it.done ? 'checked' : ''} />
        <input class="todo-text" value="${escapeHtml(it.text)}" placeholder="${tr('todo_ph')}" />
        <button class="todo-del" title="${tr('delete')}">✕</button>
      </li>`).join('')}</ul>
      <button class="todo-add">${tr('add_todo')}</button>`;
    wireTodo();
  } else {
    body.innerHTML = `<div id="dnText" class="dn-content" contenteditable="true" spellcheck="false" data-placeholder="${tr('note_content')}">${renderRichContent(note.content || '', note)}</div>`;
    const content = $('#dnText');
    content.addEventListener('click', (e) => {
      const link = e.target.closest('a.note-link');
      if (link) {
        const url = link.getAttribute('data-url');
        if (url) window.api.openExternal(url);
        return;
      }
      const fl = e.target.closest('.file-link');
      if (fl) {
        e.stopPropagation();
        window.api.openFilePath(fl.getAttribute('data-path'), fl.getAttribute('data-is-dir') === '1');
        return;
      }
      const ii = e.target.closest('.inline-img');
      if (ii && !e.target.closest('.img-resize') && !e.target.closest('.img-del')) {
        $$('.inline-img').forEach((x) => x.classList.remove('selected'));
        ii.classList.add('selected');
      }
    });
    content.addEventListener('input', () => { note.content = readRichContent(content); save(); });
    content.addEventListener('paste', async (e) => {
      const cd = e.clipboardData || window.clipboardData;
      const text = cd ? cd.getData('text/plain') : '';
      const items = (cd && cd.items) ? Array.from(cd.items) : [];
      const hasImage = items.some((it) => it.type && it.type.indexOf('image') === 0);
      if (copiedImage) { e.preventDefault(); insertImageReferenceAtCursor(copiedImage.src, copiedImage.w); return; }
      e.preventDefault();
      const files = await window.api.readClipboardFiles();
      if (files && files.length) { await insertPastedFilesAtCursor(files); return; }
      if (hasImage) { await handleImagePaste(cd); return; }
      if (text) {
        if (savedRange) restoreSelection();
        document.execCommand('insertText', false, text);
      }
    });
    content.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      const paths = files.map((f) => window.api.getPathForFile(f)).filter((p) => p && p.length > 1);
      if (paths.length) {
        content.focus();
        await insertPastedFilesAtCursor(paths);
      }
    });
    content.addEventListener('blur', (e) => {
      note.content = readRichContent(content);
      const rt = e.relatedTarget;
      const inTable = rt && rt.closest && rt.closest('.note-table-block');
      if (!savedRange && !inTable) content.innerHTML = renderRichContent(note.content, note);
      save();
    });
    content.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      adjustFontSize(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    content.addEventListener('keydown', (e) => {
      if (e.ctrlKey && !e.shiftKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        toggleBold(content);
      } else if (e.ctrlKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        toggleHighlight(content);
      } else if (e.ctrlKey && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        const imgSrc = getSelectedImageSrc();
        if (imgSrc) {
          e.preventDefault();
          const imgObj = (note.images || []).find((im) => im.src === imgSrc);
          copiedImage = { src: imgSrc, w: (imgObj && imgObj.w) || 200 };
          window.api.copyImage(imgSrc);
        } else {
          copiedImage = null;
        }
      }
    });
    wireImages();
    wireTables();
  }
}

function adjustFontSize(delta) {
  const cur = note.fontSize || settings.fontSize || 14;
  const next = Math.min(22, Math.max(11, cur + delta));
  if (next === cur) return;
  note.fontSize = next;
  const wrap = $('#note');
  if (wrap) wrap.style.setProperty('--note-font-size', next + 'px');
  save();
}

function wireTodo() {
  $$('.todo-text').forEach((inp) => {
    inp.addEventListener('input', () => {
      const idx = Number(inp.closest('.todo-item').dataset.idx);
      note.items[idx].text = inp.value;
      save();
    });
  });
  $$('.todo-item input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const idx = Number(cb.closest('.todo-item').dataset.idx);
      note.items[idx].done = cb.checked;
      cb.closest('.todo-item').classList.toggle('done', cb.checked);
      save();
    });
  });
  $$('.todo-del').forEach((b) => {
    b.onclick = () => {
      const idx = Number(b.closest('.todo-item').dataset.idx);
      note.items.splice(idx, 1);
      save();
      renderBody();
    };
  });
  const addBtn = $('.todo-add');
  if (addBtn) {
    addBtn.onclick = () => {
      note.items = note.items || [];
      note.items.push({ id: uid(), text: '', done: false });
      save();
      renderBody();
      const last = $$('.todo-text').pop();
      if (last) last.focus();
    };
  }
}

/* ============ 右键菜单 ============ */
function hideCtx() { $('#ctxMenu').classList.add('hidden'); }

function showCtxMenu(e) {
  e.preventDefault();
  captureSelection();
  savedImageSrc = getSelectedImageSrc();
  const menu = $('#ctxMenu');
  menu.innerHTML = '';

  const addItem = (icon, label, onClick, danger) => {
    const b = document.createElement('button');
    b.className = 'cm-item' + (danger ? ' danger' : '');
    b.innerHTML = `<span>${icon}</span><span>${label}</span>`;
    b.onclick = () => { hideCtx(); onClick(); };
    menu.appendChild(b);
  };

  addItem('📋', tr('copy'), () => {
    const imgSrc = savedImageSrc;
    if (imgSrc) {
      const imgObj = (note.images || []).find((im) => im.src === imgSrc);
      copiedImage = { src: imgSrc, w: (imgObj && imgObj.w) || 200 };
      window.api.copyImage(imgSrc);
    } else {
      copiedImage = null;
      if (savedSelText) window.api.writeClipboard(savedSelText);
      else window.api.writeClipboard(note.type === 'todo' ? (note.items || []).map((i) => i.text).join('\n') : (note.content || ''));
    }
    clearSavedSelection();
  });
  addItem('📥', tr('paste'), async () => {
    if (copiedImage) {
      insertImageReferenceAtCursor(copiedImage.src, copiedImage.w);
      clearSavedSelection();
      return;
    }
    const files = await window.api.readClipboardFiles();
    if (files && files.length) { await insertPastedFilesAtCursor(files); clearSavedSelection(); return; }
    const r = await window.api.readClipboardImage();
    if (r) {
      const saved = await window.api.saveNoteImage(r);
      if (saved.ok) addImageToNote({ id: uid(), src: saved.url, w: 200 });
      clearSavedSelection();
      return;
    }
    const text = await window.api.readClipboard();
    if (text) {
      const c = $('#dnText');
      if (c) { c.focus(); if (savedRange) restoreSelection(); document.execCommand('insertText', false, text); }
    }
    clearSavedSelection();
  });
  addItem('🎨', tr('text_color'), () => { hideCtx(); showTextColorMenu(); });

  const alignNote = (cmd) => {
    const c = $('#dnText');
    if (c) {
      c.focus();
      if (savedRange) restoreSelection();
      const map = { justifyLeft: 'left', justifyCenter: 'center', justifyRight: 'right' };
      const value = map[cmd] || 'left';
      let block = null;
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        let node = sel.getRangeAt(0).startContainer;
        if (node.nodeType === 3) node = node.parentElement;
        block = node && node.closest ? node.closest('.note-align, .dn-content') : null;
      }
      if (!block) block = c;
      const isContainer = block === c || /dn-content/.test(block.className || '');
      if (isContainer) {
        // 整篇对齐：把全部内容包进一个 note-align 块（避免容器 text-align 不持久）
        const wrap = document.createElement('div');
        wrap.className = 'note-align note-align-' + value;
        wrap.style.textAlign = value;
        while (c.firstChild) wrap.appendChild(c.firstChild);
        c.appendChild(wrap);
      } else {
        block.style.textAlign = value;
      }
      c.querySelectorAll('.inline-img').forEach((im) => { im.style.display = ''; im.style.margin = ''; });
      if (sel) sel.removeAllRanges();
      note.content = readRichContent(c);
      note.updatedAt = Date.now();
      save();
    }
    clearSavedSelection();
  };
  addItem('⇤', tr('align_left'), () => alignNote('justifyLeft'));
  addItem('⇹', tr('align_center'), () => alignNote('justifyCenter'));
  addItem('⇥', tr('align_right'), () => alignNote('justifyRight'));

  menu.classList.remove('hidden');
  const x = Math.max(4, Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 4));
  const y = Math.max(4, Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 4));
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

function showTextColorMenu() {
  const menu = $('#ctxMenu');
  menu.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'cm-label';
  label.textContent = tr('text_color');
  menu.appendChild(label);
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:4px 10px 10px;';
  TEXT_COLORS.forEach((c) => {
    const s = document.createElement('button');
    s.style.cssText = 'width:26px;height:26px;border-radius:7px;cursor:pointer;border:2px solid ' + ((note.textColor || settings.noteTextColor) === c ? '#fff' : 'transparent') + ';background:' + c + ';';
    s.onclick = () => {
      const r = savedRange;
      if (r) applyInlineColor(r, c);
      else { note.textColor = c; save(); }
      hideCtx();
      clearSavedSelection();
    };
    row.appendChild(s);
  });
  menu.appendChild(row);
  menu.classList.remove('hidden');
}

function applyInlineColor(range, color) {
  const content = $('#dnText');
  if (!content || !range) return;
  content.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand('foreColor', false, color);
  note.content = readRichContent(content);
  save();
}

async function handleNativeMenuAction(a) {
  if (!a) return;
  const action = a.action;
  if (action === 'copy') {
    const imgSrc = savedImageSrc;
    if (imgSrc) {
      const imgObj = (note.images || []).find((im) => im.src === imgSrc);
      copiedImage = { src: imgSrc, w: (imgObj && imgObj.w) || 200 };
      window.api.copyImage(imgSrc);
    } else {
      copiedImage = null;
      if (savedSelText) window.api.writeClipboard(savedSelText);
      else window.api.writeClipboard(note.type === 'todo' ? (note.items || []).map((i) => i.text).join('\n') : (note.content || ''));
    }
    clearSavedSelection();
  } else if (action === 'paste') {
    if (copiedImage) {
      insertImageReferenceAtCursor(copiedImage.src, copiedImage.w);
      clearSavedSelection();
      return;
    }
    const files = await window.api.readClipboardFiles();
    if (files && files.length) { await insertPastedFilesAtCursor(files); clearSavedSelection(); return; }
    const r = await window.api.readClipboardImage();
    if (r) {
      const saved = await window.api.saveNoteImage(r);
      if (saved.ok) addImageToNote({ id: uid(), src: saved.url, w: 200 });
      clearSavedSelection();
      return;
    }
    const text = await window.api.readClipboard();
    if (text) {
      const c = $('#dnText');
      if (c) { c.focus(); if (savedRange) restoreSelection(); document.execCommand('insertText', false, text); }
    }
    clearSavedSelection();
  } else if (action === 'text-color') {
    const r = savedRange;
    if (r && savedSelText) applyInlineColor(r, a.color);
    else { note.textColor = a.color; save(); }
    clearSavedSelection();
  } else if (action === 'note-color') {
    note.color = a.color;
    applyNoteStyle();
    save();
  }
}

function showColorMenu() {
  const menu = $('#ctxMenu');
  menu.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'cm-label';
  label.textContent = tr('color');
  menu.appendChild(label);
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:4px 10px 10px;';
  NOTE_COLORS.forEach((c) => {
    const s = document.createElement('button');
    s.style.cssText = 'width:26px;height:26px;border-radius:7px;cursor:pointer;border:2px solid ' + (note.color === c ? '#fff' : 'transparent') + ';background:' + c + ';';
    s.onclick = () => {
      note.color = c;
      applyNoteStyle();
      window.api.noteUpdate(note);
      hideCtx();
    };
    row.appendChild(s);
  });
  menu.appendChild(row);
  menu.classList.remove('hidden');
}

function applyNoteStyle() {
  const wrap = $('#note');
  const tc = note.textColor || settings.noteTextColor || (isDark(note.color) ? '#ffffff' : '#2d2f38');
  wrap.style.color = tc;
  wrap.style.setProperty('--note-color', note.color);
  if (settings.desktopMica) {
    wrap.style.background = hexToRgba(note.color, 0.35);
    document.body.classList.add('glass');
  } else {
    wrap.style.background = note.color;
    document.body.classList.remove('glass');
  }
}

async function init() {
  const r = await window.api.noteGet(noteId);
  note = r.note;
  settings = r.settings || {};

  if (!note) { document.body.textContent = tr('notfound'); return; }

  // 迁移旧图片到内容标记
  if (note.images && note.images.length) {
    const content = note.content || '';
    const missing = note.images.filter((im) => content.indexOf('[[img:' + im.id + ']]') === -1);
    if (missing.length) {
      note.content = content + (content ? '\n' : '') + missing.map((im) => '[[img:' + im.id + ']]').join('');
    }
  }
  if (!note.files) note.files = [];
  if (!note.images) note.images = [];
  if (!note.tables) note.tables = [];

  lang = (settings.language === 'en') ? 'en' : 'zh';
  const wrap = $('#note');
  applyNoteStyle();
  if (note.fontSize) wrap.style.setProperty('--note-font-size', note.fontSize + 'px');
  wrap.style.opacity = (settings.noteOpacity != null ? settings.noteOpacity : 100) / 100;
  window.api.onNoteOpacity((v) => { wrap.style.opacity = (v != null ? v : 100) / 100; });
  const applyFx = (fx) => {
    if (fx && typeof fx.desktopMica !== 'undefined') {
      settings.desktopMica = !!fx.desktopMica;
      applyNoteStyle();
    }
    if (fx && fx.highlightColor) {
      settings.highlightColor = fx.highlightColor;
      document.documentElement.style.setProperty('--hl-color', fx.highlightColor);
      document.documentElement.style.setProperty('--hl-fg', isDark(fx.highlightColor) ? '#ffffff' : '#2d2f38');
    }
  };
  applyFx(settings);
  window.api.onEffects(applyFx);

  document.documentElement.style.setProperty('--font-size', (settings.fontSize || 14) + 'px');
  let fam;
  if (note.fontFamily && note.fontFamily !== 'system') fam = note.fontFamily;
  else if (settings.fontFamily && settings.fontFamily !== 'system') fam = settings.fontFamily;
  else fam = '-apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
  document.documentElement.style.setProperty('--font', fam);
  document.documentElement.style.setProperty('--accent', settings.accent || '#6c5ce7');
  const hl = settings.highlightColor || '#fff59d';
  document.documentElement.style.setProperty('--hl-color', hl);
  document.documentElement.style.setProperty('--hl-fg', isDark(hl) ? '#ffffff' : '#2d2f38');

  window.api.onFontSize((v) => {
    if (v) {
      settings.fontSize = v;
      document.documentElement.style.setProperty('--font-size', v + 'px');
    }
  });

  const title = $('#dnTitle');
  title.value = note.title || '';
  title.placeholder = tr('note_title');
  title.addEventListener('input', () => { note.title = title.value; save(); });

  renderBody();

  const unpinBtn = $('#dnUnpin');
  unpinBtn.title = tr('unpin');
  unpinBtn.onclick = () => window.api.unpinFromDesktop(noteId);

  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (e.target.closest('.note-table-block')) return;
    captureSelection();
    savedImageSrc = getSelectedImageSrc();
    const action = window.api.showNativeMenu({ x: e.clientX, y: e.clientY, textColors: TEXT_COLORS, noteColors: NOTE_COLORS });
    action.then((a) => handleNativeMenuAction(a));
  });
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('drop', (e) => { e.preventDefault(); });
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#ctxMenu')) { hideCtx(); clearSavedSelection(); }
    if (activeTableEl && !activeTableEl.contains(e.target) && !(activeTableToolbar && activeTableToolbar.contains(e.target))) {
      deselectTable();
    }
  });

  window.addEventListener('beforeunload', () => { if (note) { cleanupRefs(); window.api.noteUpdate(note); } });
}

init();
