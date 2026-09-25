/* 便签与备忘卡片构建、通用事件绑定、z 序、页脚刷新。
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.noteCardView + 顶层全局。
   —— 本模块的函数通过顶层全局访问其他模块（与 board-layout.js 等同构）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.noteCardView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
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

/* —— 便签卡片工具栏（单一来源）——
   按钮 id 同时用于 settings.noteToolbarHidden（显示/隐藏）。
   primary：精简模式下直接显示；其余在精简模式收进「⋯ 更多」。
   ponytail: 「更多」直接复用便签右键菜单（showNoteContextMenu）作为溢出面板，
   省去重复的按钮动作；若日后要「图标式溢出」再单独做，不必现在抽象。 */
const NOTE_TOOL_PRIMARY = ['desktop', 'group', 'color', 'pin', 'del'];
const NOTE_TOOL_SECONDARY = ['desktop', 'todo', 'image', 'table', 'remind', 'preview'];

function noteToolHtml(id, n, isTodo) {
  switch (id) {
    case 'desktop': return `<button class="t-desktop" title="${t('desktop')}">📌</button>`;
    case 'todo': return `<button class="t-todo ${isTodo ? 'active' : ''}" title="${t('todo_mode')}">☑</button>`;
    case 'group': return `<button class="t-group ${n.groupId ? 'active' : ''}" title="${n.groupId ? t('remove_from_group') : t('add_to_group')}">🏷</button>`;
    case 'image': return `<button class="t-image" title="${t('insert_image')}">🖼️</button>`;
    case 'table': return `<button class="t-table" title="${t('insert_table')}">▦</button>`;
    case 'remind': return `<button class="t-remind" title="${t('todo_remind')}">⏰</button>`;
    case 'color': return `<button class="t-color" title="${t('color')}">🎨</button>`;
    case 'preview': return isTodo ? '' : `<button class="t-preview ${n.preview ? 'active' : ''}" title="${t(n.preview ? 'note_preview_off' : 'note_preview')}">👁</button>`;
    case 'pin': return `<button class="t-pin ${n.pinned ? 'active' : ''}" title="${t('pin')}">🔝</button>`;
    case 'del': return `<button class="t-del" title="${t('delete')}">🗑</button>`;
    default: return '';
  }
}

function noteToolsHtml(n, isTodo) {
  const hidden = new Set(state.settings.noteToolbarHidden || []);
  const compact = state.settings.noteToolbarCompact !== false;
  const render = (ids) => ids.filter((id) => !hidden.has(id)).map((id) => noteToolHtml(id, n, isTodo)).join('');
  if (!compact) return render(NOTE_TOOL_PRIMARY.concat(NOTE_TOOL_SECONDARY));
  return render(NOTE_TOOL_PRIMARY) + `<button class="t-more" title="${t('more')}">⋯</button>`;
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
      <div class="note-title-row">
        <span class="note-grip">⠿</span>
        <input class="note-title" value="${escapeHtml(n.title || '')}" placeholder="${t('note_title')}" />
      </div>
      <div class="note-tools">${noteToolsHtml(n, isTodo)}</div>
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
        <div class="memo-tools">${noteToolsHtml(n, isTodo)}</div>
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

  // 工具栏按钮统一走「存在才绑定」：精简模式或显示/隐藏设置下部分按钮可能不在 DOM
  const onTool = (sel, fn) => { const b = $(sel, el); if (b) b.onclick = fn; };
  // 「更多」：复用便签操作菜单作为溢出面板（见 noteToolsHtml 注释）
  onTool('.t-more', (e) => { e.stopPropagation(); showNoteContextMenu(e, n); });
  onTool('.t-pin', () => { pushUndo(); n.pinned = !n.pinned; n.updatedAt = Date.now(); save(); renderAll(); });
  onTool('.t-preview', () => { n.preview = !n.preview; n.updatedAt = Date.now(); save(); renderAll(); });
  onTool('.t-del', () => deleteNote(n.id));
  onTool('.t-color', (e) => { e.stopPropagation(); openColorPop(el, n); });
  onTool('.t-remind', () => openReminder(n));
  onTool('.t-group', (e) => {
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
  });
  onTool('.t-desktop', (e) => {
    e.stopPropagation();
    pushUndo();
    n.desktopPin = true;
    n.updatedAt = Date.now();
    saveNow();
    window.api.pinToDesktop(n.id);
    renderAll();
    toast(t('toast_pinned'));
  });
  onTool('.t-image', async (e) => {
    e.stopPropagation();
    const r = await window.api.pickNoteImage();
    if (r.ok) {
      insertImageByUrl(n, r.url);
    } else {
      clearSavedSelection();
      if (!r.canceled) toast(t('toast_img_saved_fail') + r.error);
    }
  });
  onTool('.t-table', (e) => {
    e.stopPropagation();
    openTableInsertDialog(n);
  });
  onTool('.t-todo', () => {
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
  });

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

  return { noteText, buildNoteEl, buildMemoEl, wireCommon, wireNoteEvents, wireMemoEvents, bringToFront, refreshFoot };
}));
