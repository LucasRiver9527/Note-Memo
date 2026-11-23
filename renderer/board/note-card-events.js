/* 画布与备忘录卡片的事件绑定、置顶层级及钉桌事务。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.noteCardEvents = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

// 三个钉桌入口共用同一事务：先保存最新编辑，再请求主进程落盘并开窗。
const desktopPinPending = new Set();
async function pinNoteToDesktop(n) {
  if (desktopPinPending.has(n.id)) return false;
  desktopPinPending.add(n.id);
  try {
    if (!(await saveNow())) return false;
    let pinned;
    try {
      pinned = await window.api.pinToDesktop(n.id);
    } catch (err) {
      console.error('[note] 钉到桌面失败：', err);
    }
    if (pinned !== true) {
      toast(t('toast_pin_failed'));
      return false;
    }
    pushUndo();
    n.desktopPin = true;
    renderAll();
    toast(t('toast_pinned'));
    return true;
  } finally {
    desktopPinPending.delete(n.id);
  }
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

  titleInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || event.shiftKey || event.isComposing) return;
    const firstTool = el.querySelector('.note-tools button:not(:disabled), .memo-tools button:not(:disabled)');
    if (!firstTool) return;
    event.preventDefault();
    titleInput.blur();
    firstTool.focus();
  });
  titleInput?.addEventListener('input', () => { n.title = titleInput.value; n.updatedAt = Date.now(); save(); refreshFoot(el, n); });
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
        (saveTimer ? saveNow() : Promise.resolve(true)).then((saved) => {
          if (saved) return window.api.openFilePath(n.id, fl.dataset.fileId);
        });
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
      const pasteRange = TextEditing.selectionWithin(content);
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
      if (text && pasteRange) TextEditing.insertText(content, text, { range: pasteRange });
    });
    content.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const paths = await window.api.getDroppedFilePaths();
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
      if (e.isComposing || e.keyCode === 229) return;
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
    if (n.gadget) { openGroupPop(el, n); return; }
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
    if (n.gadget && n.desktopPin) window.api.unpinFromDesktop(n.id);
    else pinNoteToDesktop(n);
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

  return { pinNoteToDesktop, wireCommon, wireNoteEvents, wireMemoEvents, bringToFront };
}));
