/* 画布和文档共用的插入、斜线表头和外观设置弹窗。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.tableDialogsView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

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

function openDiagonalEditor(n, tbl, r, c, block) {
  const opener = document.activeElement;
  const existing = (tbl.diagonals || []).find((d) => d.r === r && d.c === c);
  const overlay = document.createElement('div');
  overlay.setAttribute('data-modal-overlay', '');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:6500;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;';
  const modal = document.createElement('div');
  modal.className = 'diag-editor-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', t('diag_line'));
  modal.style.cssText = 'width:300px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);';
  let dir = (existing && existing.dir === 'trbl') ? 'trbl' : 'tlbr';
  let composing = false;
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
  // 对话框期间：拦截背景快捷键，Tab 在对话框内循环，Escape 取消（无写入），输入法组合态忽略 Escape。
  const focusables = () => $$('button, input, select, textarea, [tabindex]:not([tabindex="-1"])', modal)
    .filter((el) => !el.disabled && el.tabIndex !== -1 && el.offsetParent !== null);
  const onKey = (e) => {
    if (composing || e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); return; }
    if (e.key !== 'Tab') { e.stopPropagation(); return; } // 阻断背景快捷键（编辑快捷键等）
    const f = focusables();
    if (!f.length) return;
    const idx = f.indexOf(document.activeElement);
    const next = e.shiftKey ? (idx <= 0 ? f.length - 1 : idx - 1) : (idx === -1 || idx === f.length - 1 ? 0 : idx + 1);
    e.preventDefault();
    f[next].focus();
  };
  const cleanup = () => {
    document.removeEventListener('keydown', onKey, true);
    const back = (opener && opener.isConnected && typeof opener.focus === 'function') ? opener : block;
    if (back && typeof back.focus === 'function') { try { back.focus(); } catch (e) { /* ignore */ } }
  };
  const close = (applyIt) => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    if (applyIt) apply();
    cleanup();
  };
  document.addEventListener('keydown', onKey, true);
  modal.addEventListener('compositionstart', () => { composing = true; });
  modal.addEventListener('compositionend', () => { composing = false; });

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
    if (block) refreshTableBlock(block, n);
  };
  $('#diagOk', modal).onclick = () => close(true);
  $('#diagCancel', modal).onclick = () => close(false);
  $('#diagRemove', modal).onclick = () => {
    $('#diagRemove', modal).disabled = !existing; // 无既有斜线时禁用移除
    if (!existing) return;
    tbl.diagonals = (tbl.diagonals || []).filter((d) => !(d.r === r && d.c === c));
    if (block) refreshTableBlock(block, n);
    close(false);
  };
  $('#diagRemove', modal).disabled = !existing;
  const first = $('#diagT1', modal);
  if (first) first.focus();
}

function openTableSettingsDialog(n, tbl, block) {
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

  return { openTableInsertDialog, openDiagonalEditor, openTableSettingsDialog };
}));
