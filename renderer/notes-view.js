/* 便签视图纯功能模块（DOM/事件胶水，经典脚本）：便签渲染、表格、待办区、主渲染、回收站、批量选中、颜色/分组弹窗。
   该模块含顶层 let 状态（activeTableEl 等）且被 app.js 的 init 读取，故保持为经典脚本（全局作用域），
   非 UMD（其函数需 DOM / window.api，无法在 Node 单测）。加载顺序须在 app.js 之前。 */
/* ============ 便签渲染 ============ */
function noteText(n) {
  const raw = n.type === 'todo'
    ? (n.items || []).map((i) => i.text).join(' ')
    : n.content || '';
  let txt = raw.replace(/\[\[(?:img|file|table):[a-zA-Z0-9_-]+\]\]/g, '').replace(/\[\[c:[^\]]+\]\]|\[\[\/c\]\]/g, '').trim();
  (n.tables || []).forEach((tb) => {
    (tb.cells || []).forEach((row) => {
      (row || []).forEach((c) => { if (c) txt += ' ' + c; });
    });
    (tb.diagonals || []).forEach((d) => { if (d.t1) txt += ' ' + d.t1; if (d.t2) txt += ' ' + d.t2; });
  });
  return txt;
}

function buildNoteEl(n) {
  const el = document.createElement('div');
  el.className = 'note' + (n.pinned ? ' pinned' : '') + (n.archived ? ' archived' : '');
  el.dataset.id = n.id;
  const pos = effPos(n);
  el.style.left = pos.x + 'px';
  el.style.top = pos.y + 'px';
  el.style.width = (n.w || LAYOUT.defaultW) + 'px';
  el.style.height = (n.h || LAYOUT.defaultH) + 'px';
  el.style.background = n.color;
  el.style.setProperty('--note-color', n.color);
  if (n.fontSize) el.style.setProperty('--note-font-size', n.fontSize + 'px');
  el.style.zIndex = n.z || (++zCounter);

  let textColor = n.textColor || state.settings.noteTextColor;
  if (!textColor) textColor = autoTextColor(n.color);
  el.style.color = textColor;
  el.classList.toggle('note-text-light', !isDarkColor(textColor));
  if (n.fontFamily && n.fontFamily !== 'system') el.style.fontFamily = FONTS[n.fontFamily] || n.fontFamily;

  const group = state.groups.find((g) => g.id === n.groupId);
  const isTodo = n.type === 'todo';
  const items = n.items || [];
  const reminder = n.reminder && n.reminder.enabled && n.reminder.time;
  const overdue = reminder && !n.reminder.fired && new Date(n.reminder.time).getTime() < Date.now();

  let bodyHtml = '';
  if (isTodo) {
    bodyHtml = `<ul class="todo-list">${items.map((it, idx) => `
      <li class="todo-item ${it.done ? 'done' : ''}" data-idx="${idx}">
        <input type="checkbox" ${it.done ? 'checked' : ''} />
        <input class="todo-text" value="${escapeHtml(it.text)}" placeholder="${t('todo_ph')}" />
        <button class="todo-del" title="${t('delete')}">✕</button>
      </li>`).join('')}</ul>
      <button class="todo-add">${t('add_todo')}</button>`;
  } else if (n.preview) {
    // 预览：渲染后的富文本只读展示（不进入编辑）
    bodyHtml = `<div class="note-content note-preview" contenteditable="false" spellcheck="false">${renderRichCached(n)}</div>`;
  } else {
    bodyHtml = `<div class="note-content" contenteditable="true" spellcheck="false" data-placeholder="${t('note_content')}">${renderRichCached(n)}</div>`;
  }

  el.innerHTML = `
    <div class="note-head">
      <span class="note-grip">⠿</span>
      <input class="note-title" value="${escapeHtml(n.title || '')}" placeholder="${t('note_title')}" />
      <div class="note-tools">
        <button class="t-desktop" title="${t('desktop')}">📌</button>
        <button class="t-todo ${isTodo ? 'active' : ''}" title="${t('todo_mode')}">☑</button>
        <button class="t-group ${n.groupId ? 'active' : ''}" title="${n.groupId ? t('remove_from_group') : t('add_to_group')}">🏷</button>
        <button class="t-image" title="${t('insert_image')}">🖼️</button>
        <button class="t-table" title="${t('insert_table')}">▦</button>
        <button class="t-remind" title="${t('todo_remind')}">⏰</button>
        <button class="t-color" title="${t('color')}">🎨</button>
        ${isTodo ? '' : `<button class="t-preview ${n.preview ? 'active' : ''}" title="${t(n.preview ? 'note_preview_off' : 'note_preview')}">👁</button>`}
        <button class="t-pin ${n.pinned ? 'active' : ''}" title="${t('pin')}">🔝</button>
        <button class="t-del" title="${t('delete')}">🗑</button>
      </div>
    </div>
    <div class="note-body">${bodyHtml}</div>
    <div class="note-foot">
      <span class="group-tag" title="${t('set_group')}"><span class="dot" style="background:${group ? group.color : '#999'}"></span>${group ? escapeHtml(group.name) : t('ungrouped')}</span>
      ${reminder ? `<span class="reminder-chip ${overdue ? 'overdue' : ''}" title="${formatDate(n.reminder.time)}">⏰ ${formatDate(n.reminder.time)}</span>` : ''}
      <span class="date">${formatDate(n.updatedAt || n.createdAt)}</span>
    </div>
    <div class="resize-handle"></div>`;

  wireNoteEvents(el, n);
  return el;
}

function buildMemoEl(n) {
  const el = document.createElement('div');
  el.className = 'memo-row' + (n.pinned ? ' pinned' : '') + (n.archived ? ' archived' : '');
  el.dataset.id = n.id;
  el.style.setProperty('--note-color', n.color);
  if (n.fontSize) el.style.setProperty('--note-font-size', n.fontSize + 'px');

  let textColor = n.textColor || state.settings.noteTextColor;
  if (!textColor) textColor = autoTextColor(n.color);
  el.style.color = textColor;
  el.classList.toggle('note-text-light', !isDarkColor(textColor));
  if (n.fontFamily && n.fontFamily !== 'system') el.style.fontFamily = FONTS[n.fontFamily] || n.fontFamily;

  const group = state.groups.find((g) => g.id === n.groupId);
  const isTodo = n.type === 'todo';
  const items = n.items || [];
  const reminder = n.reminder && n.reminder.enabled && n.reminder.time;
  const overdue = reminder && !n.reminder.fired && new Date(n.reminder.time).getTime() < Date.now();

  let bodyHtml = '';
  if (isTodo) {
    bodyHtml = `<ul class="todo-list">${items.map((it, idx) => `
      <li class="todo-item ${it.done ? 'done' : ''}" data-idx="${idx}">
        <input type="checkbox" ${it.done ? 'checked' : ''} />
        <input class="todo-text" value="${escapeHtml(it.text)}" placeholder="${t('todo_ph')}" />
        <button class="todo-del" title="${t('delete')}">✕</button>
      </li>`).join('')}</ul>
      <button class="todo-add">${t('add_todo')}</button>`;
  } else if (n.preview) {
    bodyHtml = `<div class="note-content note-preview" contenteditable="false" spellcheck="false">${renderRichCached(n)}</div>`;
  } else {
    bodyHtml = `<div class="note-content" contenteditable="true" spellcheck="false" data-placeholder="${t('note_content')}">${renderRichCached(n)}</div>`;
  }

  el.innerHTML = `
    <div class="memo-content">
      <div class="memo-head">
        <span class="memo-grip" title="${t('drag_sort')}">⠿</span>
        <input class="note-title" value="${escapeHtml(n.title || '')}" placeholder="${t('note_title')}" />
        <div class="memo-tools">
          <button class="t-desktop" title="${t('desktop')}">📌</button>
          <button class="t-todo ${isTodo ? 'active' : ''}" title="${t('todo_mode')}">☑</button>
          <button class="t-group ${n.groupId ? 'active' : ''}" title="${n.groupId ? t('remove_from_group') : t('add_to_group')}">🏷</button>
          <button class="t-image" title="${t('insert_image')}">🖼️</button>
          <button class="t-table" title="${t('insert_table')}">▦</button>
          <button class="t-remind" title="${t('todo_remind')}">⏰</button>
          <button class="t-color" title="${t('color')}">🎨</button>
          ${isTodo ? '' : `<button class="t-preview ${n.preview ? 'active' : ''}" title="${t(n.preview ? 'note_preview_off' : 'note_preview')}">👁</button>`}
          <button class="t-pin ${n.pinned ? 'active' : ''}" title="${t('pin')}">🔝</button>
          <button class="t-del" title="${t('delete')}">🗑</button>
        </div>
      </div>
      <div class="memo-body">${bodyHtml}</div>
      <div class="memo-foot">
        <span class="group-tag" title="${t('set_group')}"><span class="dot" style="background:${group ? group.color : '#999'}"></span>${group ? escapeHtml(group.name) : t('ungrouped')}</span>
        ${reminder ? `<span class="reminder-chip ${overdue ? 'overdue' : ''}" title="${formatDate(n.reminder.time)}">⏰ ${formatDate(n.reminder.time)}</span>` : ''}
        <span class="date">${formatDate(n.updatedAt || n.createdAt)}</span>
      </div>
    </div>`;

  wireMemoEvents(el, n);
  return el;
}

function wireCommon(el, n) {
  const titleInput = $('.note-title', el);
  const content = $('.note-content', el);
  const todoTexts = $$('.todo-text', el);

  el.addEventListener('contextmenu', (e) => {
    if (e.target.closest('button')) return;
    showNoteContextMenu(e, n);
  });
  const checkboxes = $$('.todo-item input[type=checkbox]', el);

  titleInput.addEventListener('input', () => { n.title = titleInput.value; n.updatedAt = Date.now(); save(); refreshFoot(el, n); });
  if (content) {
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
        $$('.inline-img', el).forEach((x) => x.classList.remove('selected'));
        ii.classList.add('selected');
      }
    });
    if (!n.preview) {
    content.addEventListener('input', () => { n.content = readRichContent(content); n.updatedAt = Date.now(); save(); });
    content.addEventListener('paste', async (e) => {
      const cd = e.clipboardData || window.clipboardData;
      const text = cd ? cd.getData('text/plain') : '';
      const items = (cd && cd.items) ? Array.from(cd.items) : [];
      const hasImage = items.some((it) => it.type && it.type.indexOf('image') === 0);
      if (copiedImage) {
        e.preventDefault();
        insertImageReferenceAtCursor(n, copiedImage.src, copiedImage.w);
        return;
      }
      e.preventDefault();
      const files = await window.api.readClipboardFiles();
      if (files && files.length) {
        await insertPastedFilesAtCursor(n, files);
        return;
      }
      if (hasImage) {
        await handleImagePaste(cd, n);
        return;
      }
      if (text) {
        if (savedRange && savedNoteId === n.id) restoreSelection();
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
        await insertPastedFilesAtCursor(n, paths);
      }
    });
    content.addEventListener('blur', (e) => {
      n.content = readRichContent(content);
      n.updatedAt = Date.now();
      const rt = e.relatedTarget;
      const inTable = rt && rt.closest && rt.closest('.note-table-block');
      if (!savedRange && !inTable) content.innerHTML = renderRichCached(n);
      save();
    });
    content.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      adjustNoteFontSize(n, e.deltaY < 0 ? 1 : -1, (sz) => { el.style.setProperty('--note-font-size', sz + 'px'); });
    }, { passive: false });
    content.addEventListener('keydown', (e) => {
      const sc = whichShortcut(e, state.settings, 'editor');
      if (sc === 'bold') { e.preventDefault(); toggleBold(content); }
      else if (sc === 'highlight') { e.preventDefault(); toggleHighlight(content); }
      else if (sc === 'alignLeft') { e.preventDefault(); alignBlock(content, 'justifyLeft'); n.content = readRichContent(content); n.updatedAt = Date.now(); save(); }
      else if (sc === 'alignCenter') { e.preventDefault(); alignBlock(content, 'justifyCenter'); n.content = readRichContent(content); n.updatedAt = Date.now(); save(); }
      else if (sc === 'alignRight') { e.preventDefault(); alignBlock(content, 'justifyRight'); n.content = readRichContent(content); n.updatedAt = Date.now(); save(); }
      else if (sc === 'copyImage') {
        const imgSrc = getSelectedImageSrc(n);
        if (imgSrc) {
          e.preventDefault();
          const imgObj = (n.images || []).find((im) => im.src === imgSrc);
          copiedImage = { src: imgSrc, w: (imgObj && imgObj.w) || 200 };
          window.api.copyImage(imgSrc);
          toast(t('toast_img_copied'));
        } else {
          copiedImage = null;
        }
      }
    });
    }
  }
  todoTexts.forEach((inp) => {
    inp.addEventListener('input', () => {
      const idx = Number(inp.closest('.todo-item').dataset.idx);
      n.items[idx].text = inp.value;
      n.updatedAt = Date.now();
      save();
    });
  });
  checkboxes.forEach((cb) => {
    cb.addEventListener('change', () => {
      const idx = Number(cb.closest('.todo-item').dataset.idx);
      n.items[idx].done = cb.checked;
      cb.closest('.todo-item').classList.toggle('done', cb.checked);
      n.updatedAt = Date.now();
      save();
    });
  });

  $('.t-pin', el).onclick = () => { pushUndo(); n.pinned = !n.pinned; n.updatedAt = Date.now(); save(); renderAll(); };
  const previewBtn = $('.t-preview', el);
  if (previewBtn) previewBtn.onclick = () => { n.preview = !n.preview; n.updatedAt = Date.now(); save(); renderAll(); };
  $('.t-del', el).onclick = () => deleteNote(n.id);
  $('.t-color', el).onclick = (e) => { e.stopPropagation(); openColorPop(el, n); };
  $('.t-remind', el).onclick = () => openReminder(n);
  $('.t-group', el).onclick = (e) => {
    e.stopPropagation();
    if (n.groupId) {
      const gname = (state.groups.find((g) => g.id === n.groupId) || {}).name;
      n.groupId = null;
      n.updatedAt = Date.now();
      save();
      renderAll();
      toast(t('toast_unpin') + (gname ? '「' + gname + '」' : ''));
    } else {
      openGroupPop(el, n);
    }
  };
  $('.t-desktop', el).onclick = (e) => {
    e.stopPropagation();
    pushUndo();
    n.desktopPin = true;
    n.updatedAt = Date.now();
    saveNow();
    window.api.pinToDesktop(n.id);
    renderAll();
    toast(t('toast_pinned'));
  };
  $('.t-image', el).onclick = async (e) => {
    e.stopPropagation();
    const r = await window.api.pickNoteImage();
    if (r.ok) {
      insertImageByUrl(n, r.url);
    } else {
      clearSavedSelection();
      if (!r.canceled) toast(t('toast_img_saved_fail') + r.error);
    }
  };
  $('.t-table', el).onclick = (e) => {
    e.stopPropagation();
    openTableInsertDialog(n);
  };
  $('.t-todo', el).onclick = () => {
    pushUndo();
    if (n.type !== 'todo') {
      n.type = 'todo';
      n.items = n.items || [];
      if (n.content) { n.items.push({ id: uid(), text: n.content, done: false }); n.content = ''; }
    } else {
      n.type = 'note';
    }
    n.updatedAt = Date.now();
    save();
    renderAll();
  };

  const addBtn = $('.todo-add', el);
  if (addBtn) {
    addBtn.onclick = () => {
      n.items = n.items || [];
      n.items.push({ id: uid(), text: '', done: false });
      n.updatedAt = Date.now();
      save();
      renderAll();
      const last = $$('[data-id="' + n.id + '"] .todo-text').pop();
      if (last) last.focus();
    };
  }

  $$('.todo-del', el).forEach((b) => {
    b.onclick = () => {
      const idx = Number(b.closest('.todo-item').dataset.idx);
      n.items.splice(idx, 1);
      n.updatedAt = Date.now();
      save();
      renderAll();
    };
  });

  const groupTag = $('.group-tag', el);
  if (groupTag) groupTag.onclick = (e) => { e.stopPropagation(); openGroupPop(el, n); };

  wireImages(el, n);
  wireTables(el, n);
}

function insertTextAtCaret(n, text) {
  const contentEl = focusNoteContent(n);
  if (contentEl && (document.activeElement === contentEl || contentEl.contains(document.activeElement))) {
    contentEl.focus();
    document.execCommand('insertText', false, text);
    n.content = readRichContent(contentEl);
  } else if (contentEl && savedNoteId === n.id && savedRange) {
    contentEl.focus();
    restoreSelection();
    document.execCommand('insertText', false, text);
    n.content = readRichContent(contentEl);
  } else {
    n.content = ((n.content || '').trim() ? n.content + '\n' : '') + text;
  }
  clearSavedSelection();
}

function insertImageMarkerAtCursor(n, imgId) {
  insertTextAtCaret(n, '[[img:' + imgId + ']]');
}

function addImageToNote(n, img) {
  n.images = n.images || [];
  n.images.push(img);
  insertImageMarkerAtCursor(n, img.id);
  cleanupRefs(n);
  n.updatedAt = Date.now();
  save();
  renderAll();
}

function insertImageByUrl(n, url) {
  addImageToNote(n, { id: uid(), src: url, w: 200 });
}

function insertImageReferenceAtCursor(n, src, w) {
  addImageToNote(n, { id: uid(), src, w: w || 200 });
}

async function addNoteImageFromDataUrl(dataUrl, n) {
  const r = await window.api.saveNoteImage(dataUrl);
  if (r.ok) {
    insertImageByUrl(n, r.url);
    toast(t('toast_img_pasted'));
  } else {
    toast(t('toast_img_saved_fail') + r.error);
  }
}

function addFileToNote(n, filePath, isDir) {
  const id = uid();
  n.files = n.files || [];
  n.files.push({ id, path: filePath, isDir });
  insertTextAtCaret(n, '[[file:' + id + ']]');
  cleanupRefs(n);
  n.updatedAt = Date.now();
  save();
  renderAll();
}

async function insertPastedFilesAtCursor(n, paths) {
  for (const p of paths) {
    const lower = p.toLowerCase();
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
    if (imageExts.some((e) => lower.endsWith(e))) {
      const r = await window.api.addImageFile(p);
      if (r.ok) insertImageByUrl(n, r.url);
    } else {
      const st = await window.api.statPath(p);
      if (st && st.exists) addFileToNote(n, p, !!st.isDirectory);
    }
  }
}

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

async function readClipboardImageAsDataUrl() {
  try {
    const fromMain = await window.api.readClipboardImage();
    if (fromMain) return fromMain;
  } catch (e) { /* ignore */ }
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = (item.types || []).find((t) => t.indexOf('image/') === 0);
        if (imgType) {
          const blob = await item.getType(imgType);
          return await blobToDataUrl(blob);
        }
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function handleImagePaste(cd, n) {
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
      await addNoteImageFromDataUrl(dataUrl, n);
      return;
    }
  }
}

function removeImageById(n, id) {
  n.images = (n.images || []).filter((x) => x.id !== id);
  n.content = (n.content || '').replace(new RegExp('\\[\\[img:' + id + '\\]\\]', 'g'), '');
  n.updatedAt = Date.now();
  save();
  renderAll();
}

function wireImages(el, n) {
  $$('.inline-img', el).forEach((item) => {
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
        label.textContent = t('img_missing');
        img.replaceWith(label);
      };
      img.addEventListener('error', markMissing);
      if (img.complete && img.naturalWidth === 0) markMissing();
    }

    if (del) del.onclick = (e) => {
      e.stopPropagation();
      removeImageById(n, id);
    };

    item.setAttribute('tabindex', '0');
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        e.stopPropagation();
        removeImageById(n, id);
      }
    });

    if (handle) handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const imgObj = (n.images || []).find((x) => x.id === id);
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
        n.updatedAt = Date.now();
        save();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

/* ============ 表格 ============ */
let activeTableEl = null;
let activeTableNote = null;
let activeTableToolbar = null;
let activeTableSelCell = null;
let activeTableSelBox = null;
let lastTableBoxTime = 0;

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
  appendMenuAppearanceFooter(pop);
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

function wireNoteEvents(el, n) {
  wireCommon(el, n);

  const head = $('.note-head', el);
  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, input, .note-tools')) return;
    e.preventDefault();
    if (multiSelect) {
      // 点击未选中的便签：选中；点击已选中的便签：拖动整组
      if (!selectedNotes.has(n.id)) { toggleSelectNote(n.id); return; }
      head.setPointerCapture(e.pointerId);
      startDrag(el, n, e);
      return;
    }
    head.setPointerCapture(e.pointerId);
    startDrag(el, n, e);
  });

  const handle = $('.resize-handle', el);
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startResize(el, n, e);
  });

  el.addEventListener('mousedown', (e) => {
    if (multiSelect) {
      if (isBatchDragging) return;
      e.preventDefault();
      toggleSelectNote(n.id);
      return;
    }
    el.style.zIndex = ++zCounter;
    n.z = el.style.zIndex;
    bringToFront(el);
  });
}

function wireMemoEvents(el, n) {
  wireCommon(el, n);

  if (multiSelect) el.classList.toggle('selected', selectedNotes.has(n.id));
  // 批量模式：mousedown 即选中并阻止进入编辑（contenteditable 在 mousedown 时聚焦，click 已太晚）
  el.addEventListener('mousedown', (e) => {
    if (!multiSelect) return;
    if (e.button !== 0) return;
    if (isBatchDragging) return;
    e.preventDefault();
    toggleSelectNote(n.id);
  });

  // 备忘录：拖拽把手改用指针事件（原生 HTML5 DnD 拖拽时会禁用滚轮，无法边拖边滚）。
  // 指针拖拽期间仍可滚动画布滚轮，落点由 startPointerReorder 实时计算并指示。
  const grip = $('.memo-grip', el);
  if (grip) {
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (multiSelect) return;
      e.preventDefault();
      startPointerReorder(n.id, {
        container: $('#memoList'),
        itemSel: '.memo-row',
        gapFn: (clientY) => computeListGap($('#memoList'), '.memo-row', clientY),
        commit: (gap) => placeMemoAtGap($('#memoList'), '.memo-row', n.id, gap),
        threshold: 0,
      }, e);
    });
  }
}

function bringToFront(el) {
  $$('.note').forEach((x) => x.classList.remove('focused'));
  el.classList.add('focused');
}

function refreshFoot(el, n) {
  const date = $('.date', el);
  if (date) date.textContent = formatDate(n.updatedAt || n.createdAt);
}

function startDrag(el, n, e) {
  pushUndo();
  const board = $('#board');
  const canvas = $('#canvas');
  let rect = board.getBoundingClientRect();
  const z = (typeof boardZoom === 'function') ? boardZoom() : 1;
  const npos = effPos(n);
  const offsetX = (e.clientX - rect.left) / z - npos.x;
  const offsetY = (e.clientY - rect.top) / z - npos.y;

  // 批量模式：拖动任意已选便签，其余选中便签同步移动
  const batch = multiSelect && selectedNotes.has(n.id);
  const batchIds = Array.from(selectedNotes);
  isBatchDragging = batch;
  const batchStart = new Map();
  if (batch) {
    state.notes.forEach((nn) => {
      if (selectedNotes.has(nn.id)) { const p = effPos(nn); batchStart.set(nn.id, { x: p.x, y: p.y }); }
    });
  }

  el.classList.add('dragging');
  document.body.classList.add('note-dragging');
  el.style.transform = 'translate3d(0,0,0)';

  const updateRect = () => { rect = board.getBoundingClientRect(); };
  canvas.addEventListener('scroll', updateRect, { passive: true });

  let rafId = null;
  let lastEv = null;
  const applyMove = () => {
    rafId = null;
    if (!lastEv) return;
    const ev = lastEv;
    lastEv = null;
    const nx = Math.max(0, Math.round((ev.clientX - rect.left) / z - offsetX));
    const ny = Math.max(0, Math.round((ev.clientY - rect.top) / z - offsetY));
    const np = effPos(n);
    const dx = nx - np.x;
    const dy = ny - np.y;
    el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    if (batch) {
      $$('.note').forEach((other) => {
        if (other === el) return;
        const id = other.dataset.id;
        if (!batchStart.has(id)) return;
        other.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      });
    }
  };
  const onMove = (ev) => {
    lastEv = ev;
    if (rafId == null) rafId = requestAnimationFrame(applyMove);
  };
  const onUp = () => {
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    if (lastEv) applyMove();
    const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(el.style.transform || '');
    let dx = 0, dy = 0;
    if (m) {
      dx = Math.round(parseFloat(m[1]));
      dy = Math.round(parseFloat(m[2]));
      const np = effPos(n);
      setEffPos(n, Math.max(0, Math.round(np.x + dx)), Math.max(0, Math.round(np.y + dy)));
    }
    // 批量：更新其余选中便签坐标
    if (batch && (dx || dy)) {
      state.notes.forEach((nn) => {
        if (!batchStart.has(nn.id)) return;
        const p0 = batchStart.get(nn.id);
        setEffPos(nn, Math.max(0, Math.round(p0.x + dx)), Math.max(0, Math.round(p0.y + dy)));
      });
      save();
    }
    el.style.transform = '';
    const fp = effPos(n);
    el.style.left = fp.x + 'px';
    el.style.top = fp.y + 'px';
    el.__snap = noteFingerprint(n);
    $$('.note.dragging').forEach((x) => { x.style.transform = ''; x.classList.remove('dragging'); });
    if (batch) {
      $$('.note').forEach((other) => {
        const id = other.dataset.id;
        const nn = state.notes.find((x) => x.id === id);
        if (nn && selectedNotes.has(id)) {
          const p = effPos(nn);
          // 必须清掉拖拽期间的 translate3d，否则新 left/top + 残留 transform 会造成「双重偏移/弹开」
          other.style.transform = '';
          other.style.left = p.x + 'px';
          other.style.top = p.y + 'px';
          other.__snap = noteFingerprint(nn);
        }
      });
    }
    canvas.removeEventListener('scroll', updateRect);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    el.classList.remove('dragging');
    document.body.classList.remove('note-dragging');
    isBatchDragging = false;
    n.updatedAt = Date.now();
    save();
    if (batch) renderAll();
    else syncBoardSize();
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

function startResize(el, n, e) {
  pushUndo();
  const startX = e.clientX;
  const startY = e.clientY;
  const z = (typeof boardZoom === 'function') ? boardZoom() : 1;
  const origW = n.w || LAYOUT.defaultW;
  const origH = n.h || LAYOUT.defaultH;
  const onMove = (ev) => {
    n.w = Math.max(LAYOUT.defaultW, origW + (ev.clientX - startX) / z);
    n.h = Math.max(140, origH + (ev.clientY - startY) / z);
    el.style.width = n.w + 'px';
    el.style.height = n.h + 'px';
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    n.updatedAt = Date.now();
    el.__snap = noteFingerprint(n);
    save();
    syncBoardSize();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

/* ============ 待办区 ============ */
function createTodoNote(text, x, y) {
  pushUndo();
  const pos = (x != null && y != null) ? { x, y } : nextGridPosition();
  const allPos = (filter.group === 'all') ? pos : nextAllPosition();
  const n = {
    id: uid(),
    title: '待办',
    content: '',
    type: 'todo',
    items: [{ id: uid(), text, done: false }],
    color: defaultNoteColor(),
    textColor: null,
    fontFamily: null,
    images: [],
    files: [],
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
  return n;
}

function createEmptyTodoNote() {
  pushUndo();
  const pos = nextGridPosition();
  const allPos = (filter.group === 'all') ? pos : nextAllPosition();
  const n = {
    id: uid(),
    title: '待办',
    content: '',
    type: 'todo',
    items: [],
    color: defaultNoteColor(),
    textColor: null,
    fontFamily: null,
    images: [],
    files: [],
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
  return n;
}

function renderTodoView() {
  const list = $('#todoList');
  if (!list) return;

  const visible = state.notes.filter((n) => {
    if (n.desktopPin) return false;
    if (!!n.archived !== !!filter.archive) return false;
    if (filter.group === 'ungrouped' && n.groupId) return false;
    if (filter.group !== 'all' && filter.group !== 'ungrouped' && n.groupId !== filter.group) return false;
    return true;
  });

  const todoEntries = [];
  getSortedNotes(visible).forEach((n) => {
    if (n.type === 'todo') {
      (n.items || []).forEach((it) => todoEntries.push({ note: n, item: it }));
    }
  });
  const openCount = todoEntries.filter((e) => !e.item.done).length;

  const remindEntries = visible
    .filter((n) => n.reminder && n.reminder.enabled && n.reminder.time)
    .sort((a, b) => new Date(a.reminder.time) - new Date(b.reminder.time));

  let html = '';
  html += `<div class="todo-panel-head"><h3>${t('todo_items')}</h3><span class="count">${openCount}</span></div>
    <div class="todo-add-box"><input id="todoQuickInput" type="text" placeholder="${t('add_todo_ph')}" /><button class="sp-btn" id="btnQuickAdd" style="width:auto;padding:0 18px">${t('add')}</button></div>`;

  html += `<div class="todo-section items"><h4>${t('todo_items')}（${todoEntries.length}）</h4>`;
  if (todoEntries.length === 0) {
    html += `<div class="todo-empty">${t('no_todos')}</div>`;
  } else {
    todoEntries.forEach(({ note, item }) => {
      const group = state.groups.find((g) => g.id === note.groupId);
      const reminder = note.reminder && note.reminder.enabled && note.reminder.time;
      const overdue = reminder && !note.reminder.fired && new Date(note.reminder.time).getTime() < Date.now();
      html += `<div class="todo-line ${item.done ? 'done' : ''}" data-note="${note.id}" data-item="${item.id}">
        <input type="checkbox" ${item.done ? 'checked' : ''} />
        <div class="tl-body">
          <div class="tl-text">${escapeHtml(item.text || t('empty_item'))}</div>
          <div class="tl-meta">
            ${group ? `<span class="dot" style="background:${group.color}"></span>` : ''}
            <span class="link" data-goto="${note.id}">${escapeHtml(note.title || t('untitled'))}</span>
          </div>
        </div>
        ${reminder ? `<span class="tl-flag ${overdue ? 'overdue' : ''}">${overdue ? t('overdue') : ''} ${formatDate(note.reminder.time)}</span>` : ''}
        <button class="tl-del" title="${t('delete_todo')}">✕</button>
      </div>`;
    });
  }
  html += '</div>';

  html += `<div class="todo-section remind"><h4>${t('time_todos')}（${remindEntries.length}）</h4>`;
  if (remindEntries.length === 0) {
    html += `<div class="todo-empty">${t('no_reminders')}</div>`;
  } else {
    remindEntries.forEach((note) => {
      const overdue = !note.reminder.fired && new Date(note.reminder.time).getTime() < Date.now();
      const group = state.groups.find((g) => g.id === note.groupId);
      html += `<div class="todo-line" data-note="${note.id}">
        <div class="tl-body">
          <div class="tl-text">${escapeHtml(note.title || t('untitled'))}</div>
          <div class="tl-meta">
            ${group ? `<span class="dot" style="background:${group.color}"></span>` : ''}
            <span class="link" data-goto="${note.id}">${t('open_note')}</span>
          </div>
        </div>
        <span class="tl-flag ${overdue ? 'overdue' : ''}">${overdue ? t('overdue') + ' · ' : ''}${formatDate(note.reminder.time)}</span>
        <button class="tl-del" data-remind-clear="${note.id}" title="${t('clear_time')}">✕</button>
      </div>`;
    });
  }
  html += '</div>';

  list.innerHTML = html;
  wireTodoView();
}

function wireTodoView() {
  const qinput = $('#todoQuickInput');
  const addBtn = $('#btnQuickAdd');
  const addTodo = () => {
    const text = qinput ? qinput.value.trim() : '';
    if (!text) return;
    createTodoNote(text);
    qinput.value = '';
    renderAll();
    toast(t('toast_todo_added'));
  };
  if (addBtn) addBtn.onclick = addTodo;
  if (qinput) qinput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTodo(); });

  $$('#todoList .todo-line').forEach((line) => {
    const noteId = line.dataset.note;
    const cb = $('input[type=checkbox]', line);
    if (cb) {
      cb.addEventListener('change', () => {
        const n = state.notes.find((x) => x.id === noteId);
        if (!n) return;
        const item = (n.items || []).find((i) => i.id === line.dataset.item);
        if (item) { item.done = cb.checked; n.updatedAt = Date.now(); save(); }
        renderAll();
      });
    }
    const del = $('.tl-del', line);
    if (del) {
      if (del.dataset.remindClear) {
        del.onclick = () => {
          const n = state.notes.find((x) => x.id === noteId);
          if (n) { n.reminder = null; n.updatedAt = Date.now(); save(); renderAll(); }
        };
      } else {
        del.onclick = () => {
          const n = state.notes.find((x) => x.id === noteId);
          if (n) { n.items = (n.items || []).filter((i) => i.id !== line.dataset.item); n.updatedAt = Date.now(); save(); renderAll(); }
        };
      }
    }
    $$('.link[data-goto]', line).forEach((link) => {
      link.onclick = () => openNoteById(link.dataset.goto);
    });
  });
}

function openNoteById(id) {
  setViewMode('board');
  filter.group = 'all';
  filter.query = '';
  const si = $('#searchInput');
  if (si) si.value = '';
  const sc = $('#searchClear');
  if (sc) sc.classList.add('hidden');
  renderGroupChips();
  renderAll();
  const el = document.querySelector('[data-id="' + id + '"]');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    bringToFront(el);
    const target = $('.note-title', el) || $('.note-content', el);
    if (target) target.focus();
  }
}

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

function renderDocView(visible) {
  const list = $('#docList');
  if (!list) return;
  if (!docNoteId) {
    const items = getSortedNotes(visible).map((n) => {
      const tc = n.textColor || state.settings.noteTextColor || autoTextColor(n.color);
      return `
      <div class="doc-pick-item${n.archived ? ' archived' : ''}" data-id="${n.id}" style="--note-color:${n.color};background:${n.color};color:${tc}">
        <div class="dp-info">
          <div class="dp-title">${escapeHtml(n.title || t('untitled'))}</div>
          <div class="dp-sub">${escapeHtml((noteText(n) || '').slice(0, 80))}</div>
        </div>
        <span class="dp-arrow">→</span>
      </div>`;
    }).join('');
    list.innerHTML = `<div class="doc-picker-head"><h3>${t('doc_view')}</h3></div>
      <p class="sp-hint">${t('doc_pick_hint')}</p>
      <div class="doc-picker">${items}</div>`;
    const picker = $('.doc-picker', list);
    $$('.doc-pick-item', list).forEach((it) => {
      it.onclick = () => { docNoteId = it.dataset.id; renderAll(); };
      // 文档选择列表支持拖拽自定义排序（同备忘录，会切换到「自定义顺序」并保存）。
      // 用指针事件而非原生 HTML5 DnD，拖拽时仍可滚动画布滚轮，可边拖边滚。
      it.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (state.settings.sortMode !== 'custom') { ensureOrder(); state.settings.sortMode = 'custom'; }
        startPointerReorder(it.dataset.id, {
          container: picker,
          itemSel: '.doc-pick-item',
          gapFn: (clientY) => computeListGap(picker, '.doc-pick-item', clientY),
          commit: (gap) => placeMemoAtGap(picker, '.doc-pick-item', it.dataset.id, gap),
          threshold: 5,
        }, e);
      });
    });
    return;
  }
  const n = state.notes.find((x) => x.id === docNoteId);
  if (!n) { docNoteId = null; renderAll(); return; }
  const isTodo = n.type === 'todo';
  const textColor = n.textColor || state.settings.noteTextColor || autoTextColor(n.color);
  const todoHtml = isTodo
    ? `<ul class="todo-list" style="margin-top:12px">${(n.items || []).map((it) => `<li class="todo-item ${it.done ? 'done' : ''}"><span style="font-size:16px">${it.done ? '☑' : '☐'}</span><span style="margin-left:8px;${it.done ? 'text-decoration:line-through;opacity:.5' : ''}">${escapeHtml(it.text || t('empty_item'))}</span></li>`).join('')}</ul>`
    : '';
  list.innerHTML = `
    <div class="doc-toolbar">
      <button class="doc-back" id="btnDocBack">${t('doc_back')}</button>
      ${!isTodo ? `<button class="doc-fmt-btn" id="btnDocBold" title="${t('bold')}"><b>B</b></button>
      <button class="doc-fmt-btn" id="btnDocHighlight" title="${t('highlight')}">🖍</button>
      <input type="color" id="btnDocHlColor" class="doc-hl-color" title="${t('highlight_color')}" value="${highlightColor()}" />
      <span class="doc-tb-sep"></span>
      <button class="doc-fmt-btn" id="btnDocAlignLeft" title="${t('align_left')}">⇤</button>
      <button class="doc-fmt-btn" id="btnDocAlignCenter" title="${t('align_center')}">⇹</button>
      <button class="doc-fmt-btn" id="btnDocAlignRight" title="${t('align_right')}">⇥</button>` : ''}
      <span class="doc-tb-sep"></span>
      ${!isTodo ? `<button class="doc-fmt-btn" id="btnDocPreview" title="${t(n.preview ? 'note_preview_off' : 'note_preview')}">👁</button>` : ''}
      <button class="doc-fmt-btn" id="btnDocDesktop" title="${t('desktop')}">📌</button>
      <button class="doc-fmt-btn" id="btnDocTodo" title="${t('todo_mode')}">☑</button>
      <button class="doc-fmt-btn" id="btnDocGroup" title="${t('add_to_group')}">🏷</button>
      <button class="doc-fmt-btn" id="btnDocImage" title="${t('insert_image')}">🖼️</button>
      <button class="doc-fmt-btn" id="btnDocTable" title="${t('insert_table')}">▦</button>
      <button class="doc-fmt-btn" id="btnDocRemind" title="${t('todo_remind')}">⏰</button>
      <button class="doc-fmt-btn" id="btnDocColor" title="${t('color')}">🎨</button>
      <button class="doc-fmt-btn" id="btnDocPin" title="${t('pin')}">🔝</button>
      <button class="doc-fmt-btn" id="btnDocDel" title="${t('delete')}">🗑</button>
      <span class="doc-hint">${t('doc_hint')}</span>
    </div>
    <div class="doc-editor ${isDarkColor(textColor) ? '' : 'note-text-light'}" style="--note-color:${n.color};${n.fontSize ? '--note-font-size:' + n.fontSize + 'px;' : ''}color:${textColor}">
      <input id="docTitle" class="doc-title-input" value="${escapeHtml(n.title || '')}" placeholder="${t('note_title')}" />
      ${isTodo ? todoHtml : `<div id="docContent" class="doc-content${n.preview ? ' note-preview' : ''}" contenteditable="${n.preview ? 'false' : 'true'}" spellcheck="false" data-placeholder="${t('note_content')}">${renderRichCached(n)}</div>`}
    </div>`;
  wireDocView(n, isTodo);
}

function wireDocView(n, isTodo) {
  const title = $('#docTitle');
  if (!title) return;
  title.addEventListener('input', () => { n.title = title.value; n.updatedAt = Date.now(); save(); });
  const back = $('#btnDocBack');
  if (back) back.onclick = () => { docNoteId = null; renderAll(); };

  // 便签右上角功能按钮（文档模式）
  const pinBtn = $('#btnDocPin');
  if (pinBtn) pinBtn.onclick = () => { pushUndo(); n.pinned = !n.pinned; n.updatedAt = Date.now(); save(); renderAll(); };
  const todoBtn = $('#btnDocTodo');
  if (todoBtn) todoBtn.onclick = () => {
    pushUndo();
    if (n.type !== 'todo') {
      n.type = 'todo';
      n.items = n.items || [];
      if (n.content) { n.items.push({ id: uid(), text: n.content, done: false }); n.content = ''; }
    } else {
      n.type = 'note';
    }
    n.updatedAt = Date.now();
    save();
    renderAll();
  };
  const groupBtn = $('#btnDocGroup');
  if (groupBtn) groupBtn.onclick = () => {
    if (n.groupId) { n.groupId = null; n.updatedAt = Date.now(); save(); renderAll(); }
    else openGroupPop(noteAnchor(n), n);
  };
  const desktopBtn = $('#btnDocDesktop');
  if (desktopBtn) desktopBtn.onclick = () => { n.desktopPin = true; n.updatedAt = Date.now(); saveNow(); window.api.pinToDesktop(n.id); renderAll(); toast(t('toast_pinned')); };
  const imageBtn = $('#btnDocImage');
  if (imageBtn) imageBtn.onclick = async () => { const r = await window.api.pickNoteImage(); if (r.ok) insertImageByUrl(n, r.url); };
  const tableBtn = $('#btnDocTable');
  if (tableBtn) tableBtn.onclick = () => openTableInsertDialog(n);
  const remindBtn = $('#btnDocRemind');
  if (remindBtn) remindBtn.onclick = () => openReminder(n);
  const colorBtn = $('#btnDocColor');
  if (colorBtn) colorBtn.onclick = () => openColorPop(noteAnchor(n), n);
  const delBtn = $('#btnDocDel');
  if (delBtn) delBtn.onclick = () => deleteNote(n.id);
  const previewBtn = $('#btnDocPreview');
  if (previewBtn) previewBtn.onclick = () => { n.preview = !n.preview; n.updatedAt = Date.now(); save(); renderAll(); };

  if (isTodo) return;
  const content = $('#docContent');
  const boldBtn = $('#btnDocBold');
  const hlBtn = $('#btnDocHighlight');
  if (!content) return;
  if (n.preview) {
    // 预览：只保留链接/文件打开 与 右键菜单（退出预览），不挂编辑相关处理器
    content.addEventListener('contextmenu', (e) => { if (e.target.closest('button, input')) return; showNoteContextMenu(e, n); });
    content.addEventListener('click', (e) => {
      const link = e.target.closest('a.note-link');
      if (link) { const url = link.getAttribute('data-url'); if (url) window.api.openExternal(url); return; }
      const fl = e.target.closest('.file-link');
      if (fl) { e.stopPropagation(); window.api.openFilePath(fl.getAttribute('data-path'), fl.getAttribute('data-is-dir') === '1'); }
    });
    return;
  }
  if (boldBtn) boldBtn.onclick = () => { content.focus(); if (savedRange && savedNoteId === n.id) restoreSelection(); toggleBold(content); };
  if (hlBtn) hlBtn.onclick = () => { content.focus(); if (savedRange && savedNoteId === n.id) restoreSelection(); toggleHighlight(content); };
  const setAlign = (cmd) => {
    content.focus();
    if (savedRange && savedNoteId === n.id) restoreSelection();
    alignBlock(content, cmd);
    n.content = readRichContent(content);
    n.updatedAt = Date.now();
    save();
  };
  const alignLeftBtn = $('#btnDocAlignLeft');
  const alignCenterBtn = $('#btnDocAlignCenter');
  const alignRightBtn = $('#btnDocAlignRight');
  if (alignLeftBtn) alignLeftBtn.onclick = () => setAlign('justifyLeft');
  if (alignCenterBtn) alignCenterBtn.onclick = () => setAlign('justifyCenter');
  if (alignRightBtn) alignRightBtn.onclick = () => setAlign('justifyRight');
  const updateAlignState = () => {
    const state = { justifyLeft: false, justifyCenter: false, justifyRight: false };
    ['justifyLeft', 'justifyCenter', 'justifyRight'].forEach((c) => { try { state[c] = document.queryCommandState(c); } catch (_) {} });
    if (alignLeftBtn) alignLeftBtn.classList.toggle('align-active', state.justifyLeft);
    if (alignCenterBtn) alignCenterBtn.classList.toggle('align-active', state.justifyCenter);
    if (alignRightBtn) alignRightBtn.classList.toggle('align-active', state.justifyRight);
  };
  content.addEventListener('keyup', updateAlignState);
  content.addEventListener('mouseup', updateAlignState);
  content.addEventListener('input', updateAlignState);
  updateAlignState();
  const hlColor = $('#btnDocHlColor');
  if (hlColor) hlColor.addEventListener('input', (e) => setHighlightColor(e.target.value));

  content.addEventListener('contextmenu', (e) => {
    if (e.target.closest('button, input')) return;
    showNoteContextMenu(e, n);
  });

  content.addEventListener('click', (e) => {
    const link = e.target.closest('a.note-link');
    if (link) { const url = link.getAttribute('data-url'); if (url) window.api.openExternal(url); return; }
    const fl = e.target.closest('.file-link');
    if (fl) { e.stopPropagation(); window.api.openFilePath(fl.getAttribute('data-path'), fl.getAttribute('data-is-dir') === '1'); }
  });
  content.addEventListener('input', () => { n.content = readRichContent(content); n.updatedAt = Date.now(); save(); });
  content.addEventListener('paste', async (e) => {
    const cd = e.clipboardData || window.clipboardData;
    const text = cd ? cd.getData('text/plain') : '';
    const items = (cd && cd.items) ? Array.from(cd.items) : [];
    const hasImage = items.some((it) => it.type && it.type.indexOf('image') === 0);
    if (copiedImage) { e.preventDefault(); insertImageReferenceAtCursor(n, copiedImage.src, copiedImage.w); return; }
    e.preventDefault();
    const files = await window.api.readClipboardFiles();
    if (files && files.length) { await insertPastedFilesAtCursor(n, files); return; }
    if (hasImage) { await handleImagePaste(cd, n); return; }
    if (text) {
      if (savedRange && savedNoteId === n.id) restoreSelection();
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
      await insertPastedFilesAtCursor(n, paths);
    }
  });
  content.addEventListener('blur', (e) => {
    n.content = readRichContent(content);
    const rt = e.relatedTarget;
    const inTable = rt && rt.closest && rt.closest('.note-table-block');
    if (!savedRange && !inTable) content.innerHTML = renderRichCached(n);
    save();
  });
  content.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    adjustNoteFontSize(n, e.deltaY < 0 ? 1 : -1, (sz) => { const ed = content.closest('.doc-editor'); if (ed) ed.style.setProperty('--note-font-size', sz + 'px'); });
  }, { passive: false });
  content.addEventListener('keydown', (e) => {
    const sc = whichShortcut(e, state.settings, 'editor');
    if (sc === 'bold') { e.preventDefault(); toggleBold(content); }
    else if (sc === 'highlight') { e.preventDefault(); toggleHighlight(content); }
    else if (sc === 'alignLeft') { e.preventDefault(); alignBlock(content, 'justifyLeft'); n.content = readRichContent(content); save(); }
    else if (sc === 'alignCenter') { e.preventDefault(); alignBlock(content, 'justifyCenter'); n.content = readRichContent(content); save(); }
    else if (sc === 'alignRight') { e.preventDefault(); alignBlock(content, 'justifyRight'); n.content = readRichContent(content); save(); }
    else if (sc === 'copyImage') {
      const imgSrc = getSelectedImageSrc(n);
      if (imgSrc) {
        e.preventDefault();
        const imgObj = (n.images || []).find((im) => im.src === imgSrc);
        copiedImage = { src: imgSrc, w: (imgObj && imgObj.w) || 200 };
        window.api.copyImage(imgSrc);
        toast(t('toast_img_copied'));
      } else {
        copiedImage = null;
      }
    }
  });
  wireImages(content, n);
  wireTables(content, n);
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

/* ============ 回收站 ============ */
function deleteNote(id) {
  const n = state.notes.find((x) => x.id === id);
  if (!n) return;
  pushUndo();
  if (n.desktopPin) window.api.unpinFromDesktop(id);
  n.desktopPin = false;
  state.notes = state.notes.filter((x) => x.id !== id);
  state.trash.push({ note: n, deletedAt: Date.now() });
  closePops();
  save();
  renderAll();
  toast(t('toast_removed'));
}

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

function toggleSelectNote(id) {
  if (selectedNotes.has(id)) selectedNotes.delete(id);
  else selectedNotes.add(id);
  syncSelectedVisual();
}

function updateBatchCount() {
  const el = $('#batchCount');
  if (el) el.textContent = t('batch_selected_count').replace('{n}', selectedNotes.size);
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

  appendMenuAppearanceFooter(pop);
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

function purgeTrash() {
  const days = Number(state.settings.recycleBinDays != null ? state.settings.recycleBinDays : 7);
  if (!days) return;
  const cutoff = Date.now() - days * 86400000;
  const before = state.trash.length;
  state.trash = state.trash.filter((t) => t.deletedAt >= cutoff);
  if (state.trash.length !== before) save();
}

function restoreTrashItem(id) {
  const idx = state.trash.findIndex((t) => t.note.id === id);
  if (idx < 0) return;
  pushUndo();
  const { note } = state.trash[idx];
  state.trash.splice(idx, 1);
  state.notes.push(note);
  ensureOrder();
  save();
  renderAll();
  renderTrashPanel();
  toast(t('toast_restored'));
}

function deleteTrashItem(id) {
  state.trash = state.trash.filter((t) => t.note.id !== id);
  save();
  renderTrashPanel();
}

function emptyTrash() {
  state.trash = [];
  save();
  renderTrashPanel();
  toast(t('toast_trash_empty'));
}

function renderTrashPanel() {
  const wrap = $('#trashList');
  if (!wrap) return;
  purgeTrash();
  if (state.trash.length === 0) {
    wrap.innerHTML = `<div class="trash-empty">${t('trash_empty')}</div>`;
    return;
  }
  wrap.innerHTML = '';
  state.trash.slice().sort((a, b) => b.deletedAt - a.deletedAt).forEach((tr) => {
    const n = tr.note;
    const el = document.createElement('div');
    el.className = 'trash-item';
    const title = (n.title || noteText(n) || t('untitled')).slice(0, 40);
    el.innerHTML = `
      <span class="trash-color" style="background:${n.color}"></span>
      <div class="trash-info">
        <div class="trash-title">${escapeHtml(title)}</div>
        <div class="trash-date">${t('deleted_at')}${formatDate(tr.deletedAt)}</div>
      </div>
      <button class="restore" title="${t('restore_note')}">${t('restore_note')}</button>
      <button class="del" title="${t('delete_forever')}">${t('delete')}</button>`;
    $('.restore', el).onclick = () => restoreTrashItem(n.id);
    $('.del', el).onclick = () => deleteTrashItem(n.id);
    wrap.appendChild(el);
  });
}

/* ============ 颜色 / 分组弹窗 ============ */
function closePops() {
  if (activeColorPop) { activeColorPop.remove(); activeColorPop = null; }
  if (activeGroupPop) { activeGroupPop.remove(); activeGroupPop = null; }
}

function showNoteContextMenu(e, n) {
  e.preventDefault();
  e.stopPropagation();
  closePops();
  savedNoteId = n.id;
  captureSelection();
  savedImageSrc = getSelectedImageSrc(n);
  const pop = document.createElement('div');
  pop.className = 'color-pop ctx-menu';
  pop.style.gridTemplateColumns = '1fr';
  pop.style.minWidth = '132px';
  pop.style.padding = '4px';
  pop.style.maxHeight = Math.min(window.innerHeight - 24, 440) + 'px';
  pop.style.overflowY = 'auto';

  const addItem = (icon, label, onClick) => {
    const b = document.createElement('button');
    b.style.cssText = 'background:transparent;border:none;color:var(--fg);padding:3.5px 8px;border-radius:6px;cursor:pointer;text-align:left;font-size:12px;line-height:1.3;font-family:inherit;width:100%;display:flex;align-items:center;gap:5px;';
    b.innerHTML = `<span>${icon}</span><span>${label}</span>`;
    b.onmouseenter = () => (b.style.background = 'var(--accent-soft)');
    b.onmouseleave = () => (b.style.background = 'transparent');
    b.onclick = () => { closePops(); onClick(); };
    pop.appendChild(b);
  };

  addItem('💾', t('save'), () => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    n.updatedAt = Date.now();
    save();
    renderAll();
    clearSavedSelection();
    toast(t('toast_saved'));
  });
  addItem('📋', t('copy'), () => {
    const imgSrc = savedImageSrc;
    if (imgSrc) {
      const imgObj = (n.images || []).find((im) => im.src === imgSrc);
      copiedImage = { src: imgSrc, w: (imgObj && imgObj.w) || 200 };
      window.api.copyImage(imgSrc);
      toast(t('toast_img_copied'));
    } else {
      copiedImage = null;
      if (savedSelText) window.api.writeClipboard(savedSelText);
      else window.api.writeClipboard(noteText(n));
    }
    clearSavedSelection();
  });
  addItem('✂️', t('cut'), () => {
    const c = focusNoteContent(n);
    if (c) c.focus();
    if (savedRange && savedNoteId === n.id) restoreSelection();
    document.execCommand('cut');
    copiedImage = null;
    clearSavedSelection();
  });
  addItem('📥', t('paste'), async () => {
    if (copiedImage) {
      insertImageReferenceAtCursor(n, copiedImage.src, copiedImage.w);
      clearSavedSelection();
      return;
    }
    const files = await window.api.readClipboardFiles();
    if (files && files.length) {
      await insertPastedFilesAtCursor(n, files);
      clearSavedSelection();
      return;
    }
    const imgDataUrl = await readClipboardImageAsDataUrl();
    if (imgDataUrl) {
      await addNoteImageFromDataUrl(imgDataUrl, n);
      clearSavedSelection();
      return;
    }
    const text = await window.api.readClipboard();
    if (text) {
      const c = focusNoteContent(n);
      if (c) {
        c.focus();
        if (savedRange && savedNoteId === n.id) restoreSelection();
        document.execCommand('insertText', false, text);
      }
    }
    clearSavedSelection();
  });
  addItem('▤', t('select_all'), () => {
    const c = focusNoteContent(n);
    if (c) { c.focus(); document.execCommand('selectAll'); }
    else { const ae = document.activeElement; if (ae && ae.select) ae.select(); else document.execCommand('selectAll'); }
    clearSavedSelection();
  });
  const isBold = !!document.queryCommandState('bold');
  const isHl = selectionHasHighlight();
  addItem('𝗕', isBold ? t('unbold') : t('bold'), () => {
    const c = focusNoteContent(n);
    if (c) {
      c.focus();
      if (savedRange && savedNoteId === n.id) restoreSelection();
      toggleBold(c);
    }
    clearSavedSelection();
  });
  addItem('🖍', isHl ? t('unhighlight') : t('highlight'), () => {
    const c = focusNoteContent(n);
    if (c) {
      c.focus();
      if (savedRange && savedNoteId === n.id) restoreSelection();
      toggleHighlight(c);
    }
    clearSavedSelection();
  });

  const alignNote = (cmd) => {
    const c = focusNoteContent(n);
    if (c) {
      c.focus();
      if (savedRange && savedNoteId === n.id) restoreSelection();
      alignBlock(c, cmd);
      n.content = readRichContent(c);
      n.updatedAt = Date.now();
      save();
      renderAll();
    }
    clearSavedSelection();
  };
  addItem('⇤', t('align_left'), () => alignNote('justifyLeft'));
  addItem('⇹', t('align_center'), () => alignNote('justifyCenter'));
  addItem('⇥', t('align_right'), () => alignNote('justifyRight'));;

  const hlLabel = document.createElement('div');
  hlLabel.style.cssText = 'font-size:11px;color:var(--fg-dim);padding:8px 10px 2px;';
  hlLabel.textContent = t('highlight_color');
  pop.appendChild(hlLabel);
  const hlRow = document.createElement('div');
  hlRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;padding:4px 10px 8px;';
  HIGHLIGHT_COLORS.forEach((c) => {
    const s = document.createElement('button');
    s.className = 'swatch' + (highlightColor() === c ? ' active' : '');
    s.style.background = c;
    s.title = c;
    s.onclick = (e) => { e.stopPropagation(); setHighlightColor(c); };
    hlRow.appendChild(s);
  });
  const hlCustom = document.createElement('input');
  hlCustom.type = 'color';
  hlCustom.value = highlightColor();
  hlCustom.title = t('custom');
  hlCustom.style.cssText = 'width:26px;height:26px;border:1px solid var(--border);border-radius:7px;background:transparent;cursor:pointer;padding:0;';
  hlCustom.oninput = (e) => setHighlightColor(e.target.value);
  hlCustom.onclick = (e) => e.stopPropagation();
  hlRow.appendChild(hlCustom);
  pop.appendChild(hlRow);

  const sep2 = document.createElement('div');
  sep2.style.cssText = 'height:1px;background:var(--border);margin:4px 0;';
  pop.appendChild(sep2);
  addItem('▦', t('insert_table'), () => openTableInsertDialog(n));
  addItem('🖼️', t('insert_image'), async () => {
    const r = await window.api.pickNoteImage();
    if (r.ok) insertImageByUrl(n, r.url);
    else if (!r.canceled) toast(t('toast_img_saved_fail') + r.error);
  });
  addItem('📌', n.pinned ? t('unpin_note') : t('pin'), () => { n.pinned = !n.pinned; n.updatedAt = Date.now(); save(); renderAll(); });
  addItem('☑', t('todo_mode'), () => {
    if (n.type !== 'todo') {
      n.type = 'todo';
      n.items = n.items || [];
      if (n.content) { n.items.push({ id: uid(), text: n.content, done: false }); n.content = ''; }
    } else {
      n.type = 'note';
    }
    n.updatedAt = Date.now();
    save();
    renderAll();
  });
  addItem('🏷', n.groupId ? t('remove_from_group') : t('add_to_group'), () => {
    if (n.groupId) { n.groupId = null; n.updatedAt = Date.now(); save(); renderAll(); }
    else openGroupPop(noteAnchor(n), n);
  });
  addItem('📌', t('desktop'), () => {
    n.desktopPin = true;
    n.updatedAt = Date.now();
    saveNow();
    window.api.pinToDesktop(n.id);
    renderAll();
    toast(t('toast_pinned'));
  });
  addItem('⏰', t('todo_remind'), () => openReminder(n));
  addItem('🎨', t('color'), () => openColorPop(noteAnchor(n), n, e.clientX, e.clientY));
  addItem('📥', t(n.archived ? 'note_unarchive' : 'note_archive'), () => {
    n.archived = !n.archived;
    n.updatedAt = Date.now();
    save();
    renderAll();
    toast(t(n.archived ? 'toast_archived' : 'toast_unarchived'));
  });
  if (n.type !== 'todo') {
    addItem('👁', t(n.preview ? 'note_preview_off' : 'note_preview'), () => {
      n.preview = !n.preview;
      n.updatedAt = Date.now();
      save();
      renderAll();
    });
  }
  addItem('📝', t('export_markdown'), async () => {
    const fname = ((n.title || '').replace(/[\\/:*?"<>|]/g, '_').trim() || '便签') + '.md';
    const md = noteToMarkdown(n, { image: (src) => src });
    const r = await window.api.exportNoteMarkdown(md, fname);
    if (r.ok) toast(t('toast_exported') + r.path);
    else if (!r.canceled) toast(t('toast_export_fail') + r.error);
  });
  addItem('🗑', t('delete'), () => deleteNote(n.id), true);

  appendMenuAppearanceFooter(pop);
  document.body.appendChild(pop);
  const x = Math.max(8, Math.min(e.clientX, window.innerWidth - pop.offsetWidth - 8));
  const y = Math.max(8, Math.min(e.clientY, window.innerHeight - pop.offsetHeight - 8));
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
  activeColorPop = pop;
  setTimeout(() => document.addEventListener('mousedown', closePopsOnce), 0);
}

function openColorPop(el, n, atX, atY) {
  closePops();
  const selRange = savedRange;
  const selNoteId = savedNoteId;
  const selText = savedSelText;
  clearSavedSelection();
  const pop = document.createElement('div');
  pop.className = 'color-pop';

  const addSwatch = (color, active, onClick) => {
    const s = document.createElement('button');
    s.className = 'swatch' + (active ? ' active' : '');
    s.style.background = color;
    s.onclick = (e) => { e.stopPropagation(); onClick(); };
    pop.appendChild(s);
  };

  NOTE_COLORS.forEach((c) => {
    addSwatch(c, n.color === c, () => { n.color = c; n.updatedAt = Date.now(); save(); renderAll(); });
  });

  const bgLabel = document.createElement('div');
  bgLabel.className = 'color-pop-label';
  bgLabel.textContent = t('custom_bg');
  pop.appendChild(bgLabel);

  const customInput = document.createElement('input');
  customInput.type = 'color';
  customInput.value = n.color || '#000000';
  customInput.title = t('custom_bg');
  customInput.style.cssText = 'grid-column:1/-1;width:100%;height:30px;border:1px solid var(--border);border-radius:7px;background:transparent;cursor:pointer;padding:2px;';
  customInput.addEventListener('input', (e) => {
    n.color = e.target.value;
    n.updatedAt = Date.now();
    const liveEl = document.querySelector('[data-id="' + n.id + '"]');
    if (liveEl) {
      liveEl.style.background = n.color;
      liveEl.style.setProperty('--note-color', n.color);
      const tc = n.textColor || state.settings.noteTextColor || autoTextColor(n.color);
      liveEl.style.color = tc;
    }
  });
  customInput.addEventListener('change', () => save());
  pop.appendChild(customInput);

  const label = document.createElement('div');
  label.className = 'color-pop-label';
  label.textContent = t('text_color');
  pop.appendChild(label);

  TEXT_COLORS.forEach((c) => {
    addSwatch(c, (n.textColor || state.settings.noteTextColor) === c, () => {
      if (selRange && selText && selNoteId === n.id) {
        applyInlineColor(n, selRange, c);
      } else {
        n.textColor = c;
        n.updatedAt = Date.now();
        save();
        renderAll();
      }
    });
  });

  const fontLabel = document.createElement('div');
  fontLabel.className = 'color-pop-label';
  fontLabel.textContent = t('font');
  pop.appendChild(fontLabel);

  const fontSelect = document.createElement('select');
  fontSelect.style.cssText = 'grid-column:1/-1;width:100%;background:var(--bg-soft);color:var(--fg);border:1px solid var(--border);border-radius:7px;padding:5px 8px;font-family:inherit;font-size:12px;cursor:pointer;';
  const defFontOpt = document.createElement('option');
  defFontOpt.value = '';
  defFontOpt.textContent = t('follow_global');
  fontSelect.appendChild(defFontOpt);
  FONT_OPTIONS.forEach((f) => {
    const o = document.createElement('option');
    o.value = f.v;
    o.textContent = f.label;
    fontSelect.appendChild(o);
  });
  (state.settings.customFonts || []).forEach((f) => {
    const o = document.createElement('option');
    o.value = f.family;
    o.textContent = f.name;
    fontSelect.appendChild(o);
  });
  fontSelect.value = n.fontFamily || '';
  fontSelect.addEventListener('change', () => {
    n.fontFamily = fontSelect.value || null;
    n.updatedAt = Date.now();
    save();
    renderAll();
  });
  pop.appendChild(fontSelect);

  const def = document.createElement('button');
  def.className = 'color-pop-def';
  def.textContent = t('default_color');
  def.onclick = (e) => { e.stopPropagation(); n.textColor = null; n.updatedAt = Date.now(); save(); renderAll(); };
  pop.appendChild(def);

  document.body.appendChild(pop);
  let left, top;
  if (atX != null && atY != null) {
    left = Math.max(8, Math.min(atX + 8, window.innerWidth - pop.offsetWidth - 8));
    top = Math.max(8, Math.min(atY - 6, window.innerHeight - pop.offsetHeight - 8));
  } else {
    const r = el.getBoundingClientRect();
    left = Math.min(r.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8);
    top = Math.max(8, Math.min(r.top + 28, window.innerHeight - pop.offsetHeight - 8));
  }
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  activeColorPop = pop;
  setTimeout(() => document.addEventListener('mousedown', closePopsOnce), 0);
}

function openGroupPop(el, n) {
  closePops();
  clearSavedSelection();
  const pop = document.createElement('div');
  pop.className = 'color-pop';
  pop.style.gridTemplateColumns = '1fr';
  pop.style.minWidth = '140px';
  pop.style.padding = '6px';

  const assignGroup = (id) => { pushUndo(); n.groupId = id; n.updatedAt = Date.now(); save(); renderAll(); };

  // 标签建议：按笔记文本 + 最近使用推荐最可能归属的分组（顶到最前面，便于快速选择）
  const suggestIds = (typeof BoardLayout !== 'undefined' && BoardLayout.suggestGroupIds)
    ? BoardLayout.suggestGroupIds(noteText(n), state.groups, state.settings.recentGroups)
    : [];
  if (suggestIds.length) {
    const lbl = document.createElement('div');
    lbl.className = 'color-pop-label';
    lbl.textContent = t('group_suggest');
    pop.appendChild(lbl);
    suggestIds.forEach((id) => {
      const g = state.groups.find((x) => x.id === id);
      if (!g) return;
      const b = document.createElement('button');
      b.style.cssText = 'background:var(--accent-soft);border:none;color:var(--fg);padding:7px 10px;border-radius:7px;cursor:pointer;text-align:left;font-size:13px;font-family:inherit;';
      b.innerHTML = `<span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${g.color};margin-right:6px"></span>${escapeHtml(g.name)}${n.groupId === g.id ? ' ✓' : ''}`;
      b.onmouseenter = () => (b.style.background = 'var(--accent)');
      b.onmouseleave = () => (b.style.background = 'var(--accent-soft)');
      b.onclick = (e) => { e.stopPropagation(); assignGroup(g.id); };
      pop.appendChild(b);
    });
    const sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:var(--border);margin:4px 0;';
    pop.appendChild(sep);
  }

  const items = [
    { label: t('ungrouped'), id: null },
    ...state.groups.map((g) => ({ label: g.name, id: g.id }))
  ];
  items.forEach((it) => {
    const b = document.createElement('button');
    b.style.cssText = 'background:transparent;border:none;color:var(--fg);padding:7px 10px;border-radius:7px;cursor:pointer;text-align:left;font-size:13px;font-family:inherit;';
    b.innerHTML = `${it.id ? `<span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${(state.groups.find(g=>g.id===it.id)||{}).color};margin-right:6px"></span>` : ''}${escapeHtml(it.label)}${n.groupId === it.id ? ' ✓' : ''}`;
    b.onmouseenter = () => (b.style.background = 'var(--accent-soft)');
    b.onmouseleave = () => (b.style.background = 'transparent');
    b.onclick = (e) => { e.stopPropagation(); assignGroup(it.id); };
    pop.appendChild(b);
  });

  const newBtn = document.createElement('button');
  newBtn.style.cssText = 'background:transparent;border:1px dashed var(--border);color:var(--fg-dim);padding:7px 10px;border-radius:7px;cursor:pointer;text-align:left;font-size:13px;font-family:inherit;margin-top:4px;';
  newBtn.textContent = t('add_group');
  newBtn.onclick = (e) => {
    e.stopPropagation();
    closePops();
    promptModal(t('new_group'), t('group_name'), '').then((name) => {
      if (name) {
        const g = createGroup(name.trim());
        pushUndo();
        n.groupId = g.id;
        n.updatedAt = Date.now();
        save();
        renderAll();
      }
    });
  };
  pop.appendChild(newBtn);

  document.body.appendChild(pop);
  const r = el.getBoundingClientRect();
  pop.style.left = r.left + 'px';
  pop.style.top = Math.min(r.bottom + 4, window.innerHeight - pop.offsetHeight - 8) + 'px';
  activeGroupPop = pop;
  setTimeout(() => document.addEventListener('mousedown', closePopsOnce), 0);
}

function closePopsOnce(e) {
  if (activeColorPop && !activeColorPop.contains(e.target)) { activeColorPop.remove(); activeColorPop = null; document.removeEventListener('mousedown', closePopsOnce); clearSavedSelection(); }
  if (activeGroupPop && !activeGroupPop.contains(e.target)) { activeGroupPop.remove(); activeGroupPop = null; document.removeEventListener('mousedown', closePopsOnce); clearSavedSelection(); }
}

function openGroupEditPop(anchorEl, g) {
  closePops();
  clearSavedSelection();
  const pop = document.createElement('div');
  pop.className = 'color-pop';
  pop.style.gridTemplateColumns = '1fr';
  pop.style.minWidth = '170px';
  pop.style.padding = '6px';

  const addBtn = (html, onClick) => {
    const b = document.createElement('button');
    b.style.cssText = 'background:transparent;border:none;color:var(--fg);padding:8px 10px;border-radius:7px;cursor:pointer;text-align:left;font-size:13px;font-family:inherit;width:100%;';
    b.innerHTML = html;
    b.onmouseenter = () => (b.style.background = 'var(--accent-soft)');
    b.onmouseleave = () => (b.style.background = 'transparent');
    b.onclick = (e) => { e.stopPropagation(); closePops(); onClick(); };
    pop.appendChild(b);
  };

  addBtn(`✏ ${t('rename_group')}`, () => {
    promptModal(t('rename_group'), t('group_name'), g.name).then((name) => {
      if (name && name.trim()) {
        g.name = name.trim();
        save();
        renderGroupChips();
      }
    });
  });

  addBtn(isGroupCollapsed(g.id) ? (t('group_expand') + (state.notes.some((n) => n.groupId === g.id) ? '（' + state.notes.filter((n) => n.groupId === g.id).length + '）' : '')) : `▾ ${t('group_collapse')}`, () => {
    toggleGroupCollapse(g.id);
  });


  const colorLabel = document.createElement('div');
  colorLabel.style.cssText = 'font-size:11px;color:var(--fg-dim);padding:8px 10px 2px;';
  colorLabel.textContent = t('change_color');
  pop.appendChild(colorLabel);

  const colorRow = document.createElement('div');
  colorRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;padding:4px 10px 8px;';
  ACCENTS.forEach((c) => {
    const s = document.createElement('button');
    s.className = 'swatch' + (g.color === c ? ' active' : '');
    s.style.background = c;
    s.onclick = (e) => {
      e.stopPropagation();
      g.color = c;
      save();
      renderGroupChips();
      closePops();
    };
    colorRow.appendChild(s);
  });
  pop.appendChild(colorRow);

  addBtn(`<span style="color:#e5484d">🗑 ${t('delete_group')}</span>`, () => {
    confirmModal(t('delete_group'), `${t('confirm_delete_group_msg')}（${g.name}）`).then((ok) => {
      if (ok) {
        pushUndo();
        state.groups = state.groups.filter((x) => x.id !== g.id);
        state.notes.forEach((n) => { if (n.groupId === g.id) n.groupId = null; });
        if (filter.group === g.id) filter.group = 'all';
        save();
        renderGroupChips();
        renderAll();
        toast(t('toast_group_deleted'));
      }
    });
  });

  appendMenuAppearanceFooter(pop);
  document.body.appendChild(pop);
  const r = anchorEl.getBoundingClientRect();
  pop.style.left = r.left + 'px';
  pop.style.top = Math.min(r.bottom + 4, window.innerHeight - pop.offsetHeight - 8) + 'px';
  activeColorPop = pop;
  setTimeout(() => document.addEventListener('mousedown', closePopsOnce), 0);
}

// 在右键菜单底部附加「外观」控制：亚克力开关 + 透明度滑杆（实时生效并持久化）
function appendMenuAppearanceFooter(pop) {
  if (typeof applyMenuAppearance !== 'function') return;
  const row = document.createElement('div');
  row.className = 'cm-opacity-row';
  const op = (state.settings.menuOpacity != null) ? state.settings.menuOpacity : 88;
  const acrylic = !!state.settings.menuAcrylic;
  row.innerHTML = `<span>${t('ctx_menu_opacity')}</span>
    <input type="range" class="cm-opacity" min="30" max="100" value="${op}" />
    <label><input type="checkbox" class="cm-acrylic" ${acrylic ? 'checked' : ''}/>${t('ctx_menu_acrylic')}</label>`;
  pop.appendChild(row);
  const range = row.querySelector('.cm-opacity');
  const cb = row.querySelector('.cm-acrylic');
  range.addEventListener('input', (e) => {
    e.stopPropagation();
    state.settings.menuOpacity = Number(range.value);
    applyMenuAppearance();
    save();
  });
  cb.addEventListener('change', (e) => {
    e.stopPropagation();
    state.settings.menuAcrylic = cb.checked;
    applyMenuAppearance();
    save();
  });
}

