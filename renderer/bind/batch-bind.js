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

const compactToolbar = typeof window === 'undefined'
  ? { matches: false, addEventListener() {} }
  : window.matchMedia('(max-width: 1050px)');
function syncToolbarMore() {
  const wrap = $('#toolbarMoreWrap');
  const menu = $('#toolbarMoreMenu');
  const undoBtn = $('#btnUndo');
  if (!wrap || !menu || !undoBtn) return;
  const actions = ['btnQuickArrange', 'btnSaveOrder', 'btnBatchToggle'].map((id) => $('#' + id));
  if (compactToolbar.matches) {
    actions.forEach((button) => { if (button.parentElement !== menu) menu.appendChild(button); });
    wrap.classList.toggle('hidden', !actions.some((button) => !button.classList.contains('hidden')));
    actions.forEach((button) => button.setAttribute('role', 'menuitem'));
  } else {
    actions.forEach((button) => { if (button.parentElement !== undoBtn.parentElement) undoBtn.before(button); });
    actions.forEach((button) => button.removeAttribute('role'));
    wrap.classList.add('hidden');
    menu.classList.add('hidden');
    $('#btnToolbarMore').setAttribute('aria-expanded', 'false');
  }
}

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
  $('#btnEmptyCreate').onclick = () => $('#btnAdd').click();
  const moreWrap = $('#toolbarMoreWrap');
  const moreMenu = $('#toolbarMoreMenu');
  const moreButton = $('#btnToolbarMore');
  const closeMore = () => { moreMenu.classList.add('hidden'); moreButton.setAttribute('aria-expanded', 'false'); };
  moreButton.onclick = () => {
    const opening = moreMenu.classList.contains('hidden');
    moreMenu.classList.toggle('hidden', !opening);
    moreButton.setAttribute('aria-expanded', String(opening));
  };
  moreMenu.addEventListener('click', (event) => { if (event.target.closest('button')) closeMore(); });
  document.addEventListener('pointerdown', (event) => { if (!moreWrap.contains(event.target)) closeMore(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMore(); });
  compactToolbar.addEventListener('change', syncToolbarMore);
  syncToolbarMore();
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

  return { bindBatch, syncToolbarMore };
}));
