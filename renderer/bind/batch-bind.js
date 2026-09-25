/* bind/batch-bind.js
   承接 bindUI 的「顶部工具条 / 批量选中 / 撤销重做 / 视图切换 / 分组芯片区」切片。
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.bindBatch。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.bindBatch = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

function bindBatch() {
  $('#btnAdd').onclick = () => {
    if (state.settings.viewMode === 'todo') {
      const n = createEmptyTodoNote();
      openReminder(n);
      toast(t('toast_todo_created'));
    } else {
      createNote();
    }
  };
  $('#btnQuickArrange').onclick = () => {
    arrangeNotes();
    toast(t('toast_arranged'));
  };
  $('#btnSaveOrder').onclick = () => saveCurrentOrder();

  $('#btnBatchToggle').onclick = () => toggleMultiSelect();
  $('#btnBatchExit').onclick = () => { if (multiSelect) toggleMultiSelect(); };
  $('#btnBatchSelectAll').onclick = selectAllVisible;
  $('#btnBatchClear').onclick = () => { selectedNotes.clear(); syncSelectedVisual(); };
  $('#btnBatchDelete').onclick = batchDeleteSelected;
  $('#btnBatchMove').onclick = batchMoveSelected;

  // 撤销 / 重做按钮
  $('#btnUndo').onclick = undo;
  $('#btnRedo').onclick = redo;

  $('#viewBoard').onclick = () => setViewMode('board');
  $('#viewMemo').onclick = () => setViewMode('memo');
  $('#viewTodo').onclick = () => setViewMode('todo');
  $('#viewDoc').onclick = () => setViewMode('doc');

  $$('#filterbar .chip[data-group]').forEach((c) => {
    c.onclick = () => setFilter('group', c.dataset.group);
  });

  // 归档视图开关：点击切换「只看归档/回到常规视图」
  const archiveChip = $('#btnArchiveFilter');
  if (archiveChip) {
    archiveChip.onclick = () => {
      filter.archive = !filter.archive;
      renderGroupChips();
      renderAll();
    };
  }

  // 分组过多时：鼠标滚轮在分组芯片区水平滚动，让「后面未显示的分组」可达
  const chipsWrap = $('#groupChips');
  if (chipsWrap) {
    chipsWrap.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        chipsWrap.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    // 左右箭头滚动分组：固定在两端，按是否可滚动方向置灰，无分组时隐藏
    const leftArrow = $('#btnChipsLeft');
    const rightArrow = $('#btnChipsRight');
    const chipsStep = () => Math.max(120, Math.round(chipsWrap.clientWidth * 0.7));
    const scrollChips = (dir) => { chipsWrap.scrollLeft += dir * chipsStep(); requestAnimationFrame(refreshChipsScroll); };
    if (leftArrow) leftArrow.onclick = () => scrollChips(-1);
    if (rightArrow) rightArrow.onclick = () => scrollChips(1);
    chipsWrap.addEventListener('scroll', refreshChipsScroll);
    window.addEventListener('resize', refreshChipsScroll);
    refreshChipsScroll();
  }
}

  return { bindBatch };
}));
