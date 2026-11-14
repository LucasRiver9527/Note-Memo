/* bind/board-bind.js
   承接 bindUI 的「画布交互」切片：搜索 / 双击新建 / Ctrl+滚轮缩放 / 空格或中键平移 / 框选 / 右键快捷插入 / 缩放工具栏。
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.bindBoard。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.bindBoard = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

function bindRecentNotes(search) {
  const panel = $('#recentNotes');
  const wrapper = panel.parentElement;
  const list = $('.recent-note-list', panel);
  const hide = () => panel.classList.add('hidden');

  function show() {
    hide();
    if (search.value.trim() || docPickerReturn || multiSelect) return;
    const notes = visibleNotes().sort((a, b) =>
      (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)).slice(0, 6);
    if (!notes.length) return;
    const groups = new Map(state.groups.map((group) => [group.id, group.name]));
    list.replaceChildren(...notes.map((note) => {
      const button = document.createElement('button');
      button.type = 'button';
      const title = document.createElement('span');
      title.className = 'recent-note-title';
      title.textContent = note.title || t('untitled');
      const meta = document.createElement('span');
      meta.className = 'recent-note-meta';
      const date = note.updatedAt || note.createdAt;
      meta.textContent = [groups.get(note.groupId) || t('ungrouped'), date && formatDate(date)].filter(Boolean).join(' · ');
      button.append(title, meta);
      button.onclick = () => {
        hide();
        openNoteDetail(note.id, button);
      };
      return button;
    }));
    panel.classList.remove('hidden');
  }

  search.addEventListener('focus', show);
  search.addEventListener('click', show);
  search.addEventListener('input', () => {
    if (search.value.trim()) hide();
    else queueMicrotask(show);
  });
  $('#searchClear').addEventListener('click', () => search.focus());
  wrapper.addEventListener('focusout', (event) => {
    if (!wrapper.contains(event.relatedTarget)) hide();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!wrapper.contains(event.target)) hide();
  });
  wrapper.addEventListener('keydown', (event) => {
    if (panel.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      search.focus({ preventScroll: true });
      hide();
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const buttons = Array.from(list.children);
    const index = buttons.indexOf(document.activeElement);
    const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1)
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next].focus();
  });
}

function bindBoard() {
  const search = $('#searchInput');
  bindRecentNotes(search);
  search.addEventListener('input', () => {
    filter.query = search.value;
    if (docPickerReturn) {
      returnFromNoteDetail(false);
    } else if (state.settings.viewMode === 'doc' && docNoteId) docNoteId = null;
    $('#searchClear').classList.toggle('hidden', !search.value);
    renderAll();
  });
  $('#searchClear').onclick = () => { search.value = ''; filter.query = ''; $('#searchClear').classList.add('hidden'); renderAll(); };

  const canvas = $('#canvas');
  canvas.addEventListener('dblclick', (e) => {
    if (docPickerReturn || state.settings.viewMode === 'todo') return;
    if (state.settings.viewMode === 'memo') {
      const memoList = $('#memoList');
      if (e.target === memoList || e.target === canvas) {
        createNote();
      }
    } else {
      const board = $('#board');
      const z = boardZoom();
      if (e.target === board || e.target === canvas) {
        const rect = board.getBoundingClientRect();
        createNote(Math.round((e.clientX - rect.left) / z), Math.round((e.clientY - rect.top) / z));
      }
    }
  });

  // 画布缩放：Ctrl+滚轮（仅空白背景/非编辑区域）、工具栏按钮
  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    if (docPickerReturn || state.settings.viewMode !== 'board') return;
    const t = e.target;
    if (t && t.closest && t.closest('.note-content, .doc-content, .note-title, input, select, textarea, button, .resize-handle')) return;
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    applyBoardZoomRatio(boardZoom() + dir * LAYOUT.zoomStep, { mode: 'cursor', x: e.clientX, y: e.clientY });
  }, { passive: false });

  // 在捕获阶段接管空格+左键/中键，避免按在便签上时先触发卡片拖动或编辑。
  canvas.addEventListener('pointerdown', (e) => {
    if (docPickerReturn || state.settings.viewMode !== 'board') return;
    if ((e.button === 1) || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      e.stopPropagation();
      startCanvasPan(e);
    } else if (e.button === 0 && (e.target === canvas || e.target === board)) {
      // 左键空白背景：开启框选（拖拽拉框多选）
      startBoxSelect(e);
    }
  }, true);

  // 空白画布右键：快捷插入
  canvas.addEventListener('contextmenu', (e) => {
    if (docPickerReturn || state.settings.viewMode !== 'board') return;
    if (!(e.target === canvas || e.target === board)) return;
    e.preventDefault();
    showBoardContextMenu(e);
  });

  // 缩放工具栏
  $('#btnZoomOut').addEventListener('click', () => zoomStep(-1));
  $('#btnZoomIn').addEventListener('click', () => zoomStep(1));
  $('#btnZoomReset').addEventListener('click', () => zoomReset());
  $('#btnZoomPan').addEventListener('click', () => { toast(t('canvas_pan_hint')); });
  const ctExpand = $('#ctExpand');
  if (ctExpand) ctExpand.addEventListener('click', () => {
    const tb = $('#canvasToolbar');
    const expanded = tb.classList.toggle('expanded');
    ctExpand.textContent = expanded ? '✕' : '⤢';
    ctExpand.title = expanded ? t('canvas_zoom_toggle_close') : t('canvas_zoom_toggle');
  });
  syncZoomToolbar();
}

  return { bindBoard };
}));
