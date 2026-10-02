/* panels/filter-status.js
   UX-22A：当前筛选条件行（可逐个移除 + 全部清除 + 结果计数）。
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.filterStatusView + 顶层全局。
   —— 通过顶层全局访问 filter/state/t/$/renderAll/renderGroupChips/toggleGroupCollapse（与其它 panels 同构）。
   单一数据源仍是 filter/state.settings，本模块不新增任何筛选状态或持久化。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.filterStatusView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function groupLabel(id) {
    if (id === 'ungrouped') return t('ungrouped'); // 未分组：本地化，不显示原始英文 ID
    const g = (state.groups || []).find((x) => x.id === id);
    return (g && g.name) ? String(g.name) : String(id);
  }

  function collapsedIds() {
    const map = (state.settings && state.settings.collapsedGroups) || {};
    return Object.keys(map).filter((id) => map[id]);
  }

  function countText(n, viewMode) {
    return t(viewMode === 'todo' ? 'filter_count_todo' : 'filter_count_notes').replace('{n}', String(n));
  }

  function makeTag(kind, id, label) {
    const tag = document.createElement('span');
    tag.className = 'fs-tag' + (kind === 'archive' ? ' fs-tag-archive' : '');
    const lab = document.createElement('span');
    lab.className = 'fs-tag-label';
    lab.textContent = label;   // 安全：textContent，不注入 HTML
    lab.title = label;         // 截断时仍可查看完整内容（与可见文本一致）
    tag.appendChild(lab);
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'fs-tag-x';
    x.textContent = '✕';
    const aria = t('filter_dismiss').replace('{name}', label);
    x.setAttribute('aria-label', aria);
    x.title = aria;
    x.addEventListener('click', () => dismiss(kind, id, x));
    tag.appendChild(x);
    return tag;
  }

  // 移除单个条件；用现有状态路径（不走会退出归档的 setFilter(group,'all')）。
  function dismiss(kind, id, btn) {
    const all = Array.from(document.querySelectorAll('#filterStatus .fs-tag-x'));
    const idx = Math.max(0, all.indexOf(btn));
    if (kind === 'query') {
      filter.query = '';
      const s = $('#searchInput'); if (s) s.value = '';
      const c = $('#searchClear'); if (c) c.classList.add('hidden');
      renderAll();
      const s2 = $('#searchInput'); if (s2) s2.focus();
      return;
    }
    if (kind === 'group') {
      filter.group = 'all';
      sortPanelGroupId = 'all';
      if (typeof renderGroupChips === 'function') renderGroupChips();
      renderAll();
    } else if (kind === 'archive') {
      filter.archive = false; // 保留底层分组；清除归档后该分组重新生效
      if (typeof renderGroupChips === 'function') renderGroupChips();
      renderAll();
    } else if (kind === 'collapsed') {
      toggleGroupCollapse(id); // 现有实现：save + renderGroupChips + renderAll，保留其它折叠与快照
    }
    focusNext(idx);
  }

  function focusNext(idx) {
    const buttons = Array.from(document.querySelectorAll('#filterStatus .fs-tag-x'));
    if (buttons.length) { buttons[Math.min(idx, buttons.length - 1)].focus(); return; }
    const s = $('#searchInput'); if (s) s.focus();
  }

  function renderFilterStatus(resultCount, viewMode) {
    const row = $('#filterStatus');
    if (!row) return;
    row.textContent = '';

    const q = (filter.query || '').trim();
    const archived = !!filter.archive;
    const collapsed = collapsedIds();
    const tags = [];
    if (q) tags.push(makeTag('query', null, t('filter_tag_search') + ': ' + q));
    // 归档时底层分组被忽略：不显示为活动分组标签
    if (!archived && filter.group && filter.group !== 'all') {
      const name = groupLabel(filter.group);
      tags.push(makeTag('group', null, t('filter_tag_group') + ': ' + name));
    }
    if (archived) tags.push(makeTag('archive', null, t('filter_tag_archive')));
    collapsed.forEach((id) => {
      const name = groupLabel(id);
      tags.push(makeTag('collapsed', id, t('filter_tag_collapsed') + ': ' + name));
    });

    const has = tags.length > 0;
    row.classList.toggle('hidden', !has);
    if (!has) return;

    tags.forEach((tag) => row.appendChild(tag));
    if (archived && filter.group && filter.group !== 'all') {
      const note = document.createElement('span');
      note.className = 'fs-note';
      note.textContent = t('filter_archive_ignores_group').replace('{name}', groupLabel(filter.group));
      row.appendChild(note);
    }

    // 有筛选但零结果：显示无匹配提示（与条件标签并存）
    if (resultCount === 0) {
      const nm = document.createElement('span');
      nm.className = 'fs-nomatch';
      nm.textContent = t('filter_cond_none_matches');
      row.appendChild(nm);
    }

    const count = document.createElement('span');
    count.className = 'fs-count';
    count.textContent = countText(resultCount, viewMode);
    row.appendChild(count);

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'fs-clear';
    clear.textContent = t('filter_status_clear');
    clear.addEventListener('click', () => {
      if (typeof clearViewFilters === 'function') clearViewFilters(); // 已有实现：重置条件并聚焦搜索框
    });
    row.appendChild(clear);
  }

  return { renderFilterStatus };
}));
