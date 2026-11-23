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
    if (arrangeNotes()) toast(t('toast_arranged'));
  };
  $('#btnSaveOrder').onclick = () => saveCurrentOrder();

  $('#btnBatchToggle').onclick = () => toggleMultiSelect();
  $('#btnEmptyCreate').onclick = () => $('#btnAdd').click();
  const moreWrap = $('#toolbarMoreWrap');
  const moreMenu = $('#toolbarMoreMenu');
  const moreButton = $('#btnToolbarMore');
  const entries = () => Array.from(moreMenu.querySelectorAll('button:not(.hidden):not(:disabled)'));
  const closeMore = (restoreFocus = false) => {
    if (moreMenu.classList.contains('hidden')) return;
    moreMenu.classList.add('hidden');
    moreButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus) moreButton.focus();
  };
  const sortMode = $('#sortMode');
  const sortRules = $('#toolbarSortRules');
  const openMore = () => {
    sortRules.replaceChildren(...Array.from(sortMode.options, (option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tb-btn secondary';
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', String(option.selected));
      button.textContent = option.textContent;
      button.onclick = () => {
        if (sortMode.value === option.value) return;
        sortMode.value = option.value;
        sortMode.dispatchEvent(new Event('change'));
      };
      return button;
    }));
    moreMenu.classList.remove('hidden');
    moreButton.setAttribute('aria-expanded', 'true');
    entries()[0]?.focus();
  };
  moreButton.onclick = () => {
    if (moreMenu.classList.contains('hidden')) openMore();
    else closeMore(true);
  };
  moreButton.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); openMore(); }
  });
  moreMenu.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = entries();
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
      (i + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  });
  moreMenu.addEventListener('click', (event) => {
    const action = event.target.closest('button');
    if (action) closeMore(action.id !== 'btnWorkspaceSort');
  });
  moreWrap.addEventListener('focusout', (event) => { if (!moreWrap.contains(event.relatedTarget)) closeMore(); });
  document.addEventListener('pointerdown', (event) => { if (!moreWrap.contains(event.target)) closeMore(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !moreMenu.classList.contains('hidden')) {
      event.preventDefault();
      closeMore(true);
    }
  });
  // Keep feedback above the batch actions, including when translated buttons wrap.
  const batchBar = $('#batchBar');
  new ResizeObserver(() => {
    const bounds = batchBar.getBoundingClientRect();
    const bottom = bounds.height ? window.innerHeight - bounds.top + 12 : 24;
    document.documentElement.style.setProperty('--toast-bottom', bottom + 'px');
  }).observe(batchBar);
  $('#btnBatchExit').onclick = () => { if (multiSelect) toggleMultiSelect(); };
  $('#btnBatchSelectAll').onclick = selectAllVisible;
  $('#btnBatchClear').onclick = () => { selectedNotes.clear(); syncSelectedVisual(); };
  $('#btnBatchArrange').onclick = () => {
    if (arrangeSelectedNotes()) toast(t('toast_batch_arranged'));
  };
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

  const nav = $('#filterbar');
  const navToggle = $('#btnWorkspaceNav');
  const setNav = (open) => {
    nav.classList.toggle('workspace-nav-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
  };
  const narrowNav = window.matchMedia('(max-width: 820px)');
  const add = $('#btnAdd');
  const navItems = nav.querySelector('.workspace-nav-items');
  const fixedNav = nav.querySelector('.workspace-nav-fixed');
  const updateNavScrolling = () => {
    if (!navItems.clientHeight) return;
    const style = getComputedStyle(navItems);
    const spacing = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.rowGap);
    // Keep room for almost three group rows; a shorter sidebar scrolls as one region.
    navItems.classList.toggle('workspace-nav-overflow', navItems.clientHeight - fixedNav.offsetHeight - spacing < 100);
  };
  const navResize = new ResizeObserver(updateNavScrolling);
  navResize.observe(navItems);
  navResize.observe(fixedNav);
  const placeAdd = () => {
    if (narrowNav.matches) {
      navToggle.parentElement.appendChild(add);
      return;
    }
    fixedNav.prepend(add);
    setNav(false);
  };
  narrowNav.addEventListener('change', placeAdd);
  placeAdd();
  navToggle.onclick = () => {
    const open = !nav.classList.contains('workspace-nav-open');
    setNav(open);
    if (open) (nav.querySelector('.chip.active') || nav.querySelector('.chip')).focus();
  };
  document.addEventListener('pointerdown', (event) => {
    if ($('#settingsPanel').classList.contains('hidden') &&
        !nav.contains(event.target) && !navToggle.contains(event.target) &&
        !event.target.closest('.group-edit-pop')) setNav(false);
  });
  document.addEventListener('keydown', (event) => {
    if (!event.defaultPrevented && event.key === 'Escape' && nav.classList.contains('workspace-nav-open') && navToggle.offsetWidth && $('#settingsPanel').classList.contains('hidden')) {
      setNav(false);
      navToggle.focus();
    }
  });
  nav.addEventListener('click', (event) => {
    if (event.composedPath().some((el) => el instanceof Element && el.matches('.filter-scope .chip, #groupChips .chip, #canvasShortcuts .ct-btn, #canvasGadgetEntries .chip'))) {
      if (nav.classList.contains('workspace-nav-open') && navToggle.offsetWidth) navToggle.focus();
      setNav(false);
    }
  }, true);
}

  return { bindBatch };
}));
