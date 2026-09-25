/* editors/doc-view.js
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.docView + 顶层全局。
   —— 本模块的函数通过顶层全局访问其他模块（与 board-layout.js 等同构）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.docView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

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

  return { renderDocView, wireDocView };
}));
