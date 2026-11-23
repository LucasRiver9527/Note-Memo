/* 画布与备忘录卡片的结构、工具栏和增量刷新。 */
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

function renderCardBody(n, isTodo) {
  const items = n.items || [];
  let bodyHtml = '';
  if (isTodo) {
    bodyHtml = `<ul class="todo-list">${items.map((it, idx) => `
      <li class="todo-item ${it.done ? 'done' : ''}" data-idx="${idx}">
        <input type="checkbox" ${it.done ? 'checked' : ''} />
        <input class="todo-text" value="${escapeHtml(it.text)}" placeholder="${t('todo_ph')}" />
        <button class="todo-del" title="${escapeHtml(t('delete'))}" aria-label="${escapeHtml(t('delete'))}">✕</button>
      </li>`).join('')}</ul>
      <button class="todo-add">${t('add_todo')}</button>`;
  } else if (n.preview) {
    // 预览：渲染后的富文本只读展示（不进入编辑）
    bodyHtml = `<div class="note-content note-preview" contenteditable="false" spellcheck="false">${renderRichCached(n)}</div>`;
  } else {
    bodyHtml = `<div class="note-content" contenteditable="true" spellcheck="false" data-placeholder="${t('note_content')}">${renderRichCached(n)}</div>`;
  }
  return bodyHtml;
}

/* —— 便签卡片工具栏（单一来源）——
   按钮 id 同时用于 settings.noteToolbarHidden（显示/隐藏）。
   primary：精简模式下直接显示；其余在精简模式收进「⋯ 更多」。
   ponytail: 「更多」直接复用便签右键菜单（showNoteContextMenu）作为溢出面板，
   省去重复的按钮动作；若日后要「图标式溢出」再单独做，不必现在抽象。 */
const NOTE_TOOL_PRIMARY = ['desktop', 'group', 'color', 'pin', 'del'];
const NOTE_TOOL_SECONDARY = ['todo', 'image', 'table', 'remind', 'preview'];

function noteToolHtml(id, n, isTodo) {
  // 纯图标按钮：本地化名称同时写入 title 与 aria-label（aria-label 显式覆盖符号文本）。
  // 名称只来自 i18n 静态文案，不含用户内容；进属性前用 escapeHtml 转义。
  const A = (key) => `title="${escapeHtml(t(key))}" aria-label="${escapeHtml(t(key))}"`;
  const pressed = (on) => `aria-pressed="${on ? 'true' : 'false'}"`;
  switch (id) {
    case 'desktop': return `<button class="t-desktop" ${A(n.gadget && n.desktopPin ? 'unpin' : 'desktop')}><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#ui-pin"/></svg></button>`;
    case 'todo': return `<button class="t-todo ${isTodo ? 'active' : ''}" ${A('todo_mode')} ${pressed(isTodo)}><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#ui-todo"/></svg></button>`;
    case 'group': return `<button class="t-group ${n.groupId ? 'active' : ''}" ${A(n.groupId && !n.gadget ? 'remove_from_group' : 'add_to_group')}><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#ui-folder"/></svg></button>`;
    case 'image': return `<button class="t-image" ${A('insert_image')}><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#ui-image"/></svg></button>`;
    case 'table': return `<button class="t-table" ${A('insert_table')}><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#ui-arrange"/></svg></button>`;
    case 'remind': return `<button class="t-remind" ${A('todo_remind')}><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#ui-clock"/></svg></button>`;
    case 'color': return `<button class="t-color" ${A('color')}><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#ui-color"/></svg></button>`;
    case 'preview': return isTodo ? '' : `<button class="t-preview ${n.preview ? 'active' : ''}" ${A(n.preview ? 'note_preview_off' : 'note_preview')} ${pressed(n.preview)}><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#ui-eye"/></svg></button>`;
    case 'pin': return `<button class="t-pin ${n.pinned ? 'active' : ''}" ${A('pin')} ${pressed(n.pinned)}><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#ui-raise"/></svg></button>`;
    case 'del': return `<button class="t-del" ${A('delete')}><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#ui-trash"/></svg></button>`;
    default: return '';
  }
}

function noteToolsHtml(n, isTodo, onBoard = false) {
  const hidden = new Set(state.settings.noteToolbarHidden || []);
  const compact = !!n.gadget || state.settings.noteToolbarCompact !== false;
  const render = (ids) => ids.filter((id) => !hidden.has(id)).map((id) => noteToolHtml(id, n, isTodo)).join('');
  const allTools = NOTE_TOOL_PRIMARY.concat(NOTE_TOOL_SECONDARY);
  if (!compact && onBoard) return render(allTools);
  const primaryTools = onBoard ? NOTE_TOOL_PRIMARY.filter((id) => id !== 'pin') : NOTE_TOOL_PRIMARY;
  const quickTools = render(compact ? primaryTools : allTools);
  return `<div class="${compact ? 'compact-quick-tools' : 'memo-full-tools'}">${quickTools}</div><button class="t-more" title="${escapeHtml(t('more'))}" aria-label="${escapeHtml(t('more'))}"><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#ui-more"/></svg></button>`;
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
  const groupName = escapeHtml(group ? group.name : t('ungrouped'));
  if (n.gadget) {
    buildCanvasGadget(el, n, noteToolsHtml(n, false, true), groupName, sanitizeCss(group && group.color));
    noteCardEvents.wireNoteEvents(el, n);
    return el;
  }
  const updated = formatDate(n.updatedAt || n.createdAt);
  const isTodo = n.type === 'todo';
  const reminder = n.reminder && n.reminder.enabled && n.reminder.time;
  const overdue = reminder && !n.reminder.fired && new Date(n.reminder.time).getTime() < Date.now();

  const bodyHtml = renderCardBody(n, isTodo);

  el.innerHTML = `
    <div class="note-head">
      <div class="note-title-row">
        <span class="note-grip">⠿</span>
        <input class="note-title" value="${escapeHtml(n.title || '')}" placeholder="${t('note_title')}" />
      </div>
      <div class="note-tools${state.settings.noteToolbarCompact !== false ? ' compact-tools' : ''}">${noteToolsHtml(n, isTodo, true)}</div>
    </div>
    <div class="note-body">${bodyHtml}</div>
    <div class="note-foot">
      <span class="group-tag" title="${groupName}"><span class="dot" style="background:${sanitizeCss(group && group.color) || '#999'}"></span><span class="note-foot-label">${groupName}</span></span>
      ${reminder ? `<span class="reminder-chip ${overdue ? 'overdue' : ''}" title="${formatDate(n.reminder.time)}"><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#ui-clock"/></svg><span class="note-foot-label">${formatDate(n.reminder.time)}</span></span>` : ''}
      <span class="date" title="${updated}">${updated}</span>
    </div>
    <div class="resize-handle"></div>`;

  noteCardEvents.wireNoteEvents(el, n);
  cardSearchView.bindCardSearch(el, n);
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
  const reminder = n.reminder && n.reminder.enabled && n.reminder.time;
  const overdue = reminder && !n.reminder.fired && new Date(n.reminder.time).getTime() < Date.now();

  const bodyHtml = renderCardBody(n, isTodo);

  el.innerHTML = `
    <div class="memo-content">
      <div class="memo-head">
        <span class="memo-grip" title="${t('drag_sort')}">⠿</span>
        <input class="note-title" value="${escapeHtml(n.title || '')}" placeholder="${t('note_title')}" />
        <div class="memo-tools${state.settings.noteToolbarCompact !== false ? ' compact-tools' : ''}">${noteToolsHtml(n, isTodo)}</div>
      </div>
      <div class="memo-body">${bodyHtml}</div>
      <div class="memo-foot">
        <span class="group-tag${group ? '' : ' memo-ungrouped'}" title="${t('set_group')}"><span class="dot" style="background:${sanitizeCss(group && group.color) || '#999'}"></span>${group ? escapeHtml(group.name) : t('ungrouped')}</span>
        ${reminder ? `<span class="reminder-chip ${overdue ? 'overdue' : ''}" title="${formatDate(n.reminder.time)}"><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#ui-clock"/></svg><span>${formatDate(n.reminder.time)}</span></span>` : ''}
        <span class="date">${formatDate(n.updatedAt || n.createdAt)}</span>
      </div>
    </div>`;

  noteCardEvents.wireMemoEvents(el, n);
  cardSearchView.bindCardSearch(el, n);
  return el;
}

function refreshBoardCards(board, visible) {
  const visibleIds = new Set(visible.map((n) => n.id));
  for (const [id, el] of boardEls) {
    if (!visibleIds.has(id)) { el.remove(); boardEls.delete(id); }
  }
  getSortedNotes(visible).forEach((n) => {
    const existing = boardEls.get(n.id);
    const snap = noteFingerprint(n);
    if (existing && existing.__snap === snap && (!n.gadget || existing.__gadgetNote === n)) {
      if (!n.gadget) cardSearchView.refreshCardSearch(existing, n);
      return;
    }
    const el = buildNoteEl(n);
    el.__snap = snap;
    if (existing) existing.replaceWith(el); else board.appendChild(el);
    boardEls.set(n.id, el);
  });
}

function refreshFoot(el, n) {
  const date = $('.date', el);
  if (date) date.textContent = formatDate(n.updatedAt || n.createdAt);
}

  return { noteText, buildNoteEl, buildMemoEl, refreshBoardCards, refreshFoot };
}));
