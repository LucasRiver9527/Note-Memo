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

function bindBoard() {
  const search = $('#searchInput');
  search.addEventListener('input', () => {
    filter.query = search.value;
    $('#searchClear').classList.toggle('hidden', !search.value);
    renderAll();
  });
  $('#searchClear').onclick = () => { search.value = ''; filter.query = ''; $('#searchClear').classList.add('hidden'); renderAll(); };

  const canvas = $('#canvas');
  canvas.addEventListener('dblclick', (e) => {
    if (state.settings.viewMode === 'todo') return;
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
    if (state.settings.viewMode !== 'board') return;
    const t = e.target;
    if (t && t.closest && t.closest('.note-content, .doc-content, .note-title, input, select, textarea, button, .resize-handle')) return;
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    applyBoardZoomRatio(boardZoom() + dir * LAYOUT.zoomStep, { mode: 'cursor', x: e.clientX, y: e.clientY });
  }, { passive: false });

  // 平移：空格+左键拖 或 鼠标中键拖（仅空白背景）
  canvas.addEventListener('mousedown', (e) => {
    if (state.settings.viewMode !== 'board') return;
    if (!(e.target === canvas || e.target === board)) return;
    if ((e.button === 1) || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      startCanvasPan(e);
    } else if (e.button === 0) {
      // 左键空白背景：开启框选（拖拽拉框多选）
      startBoxSelect(e);
    }
  });

  // 空白画布右键：快捷插入
  canvas.addEventListener('contextmenu', (e) => {
    if (state.settings.viewMode !== 'board') return;
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
