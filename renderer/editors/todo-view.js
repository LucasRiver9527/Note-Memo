/* editors/todo-view.js
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.todoView + 顶层全局。
   —— 本模块的函数通过顶层全局访问其他模块（与 board-layout.js 等同构）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.todoView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

/* ============ 待办区 ============ */
function createTodoNote(text, x, y) {
  pushUndo();
  const pos = (x != null && y != null) ? { x, y } : nextGridPosition();
  const allPos = (filter.group === 'all') ? pos : nextAllPosition();
  const n = {
    id: uid(),
    title: '待办',
    content: '',
    type: 'todo',
    items: [{ id: uid(), text, done: false }],
    color: defaultNoteColor(),
    textColor: null,
    fontFamily: null,
    images: [],
    files: [],
    groupId: (filter.group && filter.group !== 'all' && filter.group !== 'ungrouped') ? filter.group : null,
    pinned: false,
    desktopPin: false,
    archived: false,
    preview: false,
    reminder: null,
    x: pos.x,
    y: pos.y,
    positionAll: { x: allPos.x, y: allPos.y },
    w: LAYOUT.defaultW,
    h: LAYOUT.newH,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  state.notes.push(n);
  ensureOrder();
  save();
  return n;
}

function createEmptyTodoNote() {
  pushUndo();
  const pos = nextGridPosition();
  const allPos = (filter.group === 'all') ? pos : nextAllPosition();
  const n = {
    id: uid(),
    title: '待办',
    content: '',
    type: 'todo',
    items: [],
    color: defaultNoteColor(),
    textColor: null,
    fontFamily: null,
    images: [],
    files: [],
    groupId: (filter.group && filter.group !== 'all' && filter.group !== 'ungrouped') ? filter.group : null,
    pinned: false,
    desktopPin: false,
    archived: false,
    preview: false,
    reminder: null,
    x: pos.x,
    y: pos.y,
    positionAll: { x: allPos.x, y: allPos.y },
    w: LAYOUT.defaultW,
    h: LAYOUT.newH,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  state.notes.push(n);
  ensureOrder();
  save();
  renderAll();
  return n;
}

function renderTodoView() {
  const list = $('#todoList');
  if (!list) return;

  const visible = state.notes.filter((n) => {
    if (n.desktopPin) return false;
    if (!!n.archived !== !!filter.archive) return false;
    if (filter.group === 'ungrouped' && n.groupId) return false;
    if (filter.group !== 'all' && filter.group !== 'ungrouped' && n.groupId !== filter.group) return false;
    return true;
  });

  const todoEntries = [];
  getSortedNotes(visible).forEach((n) => {
    if (n.type === 'todo') {
      (n.items || []).forEach((it) => todoEntries.push({ note: n, item: it }));
    }
  });
  const openCount = todoEntries.filter((e) => !e.item.done).length;

  const remindEntries = visible
    .filter((n) => n.reminder && n.reminder.enabled && n.reminder.time)
    .sort((a, b) => new Date(a.reminder.time) - new Date(b.reminder.time));

  let html = '';
  html += `<div class="todo-panel-head"><h3>${t('todo_items')}</h3><span class="count">${openCount}</span></div>
    <div class="todo-add-box"><input id="todoQuickInput" type="text" placeholder="${t('add_todo_ph')}" /><button class="sp-btn" id="btnQuickAdd" style="width:auto;padding:0 18px">${t('add')}</button></div>`;

  html += `<div class="todo-section items"><h4>${t('todo_items')}（${todoEntries.length}）</h4>`;
  if (todoEntries.length === 0) {
    html += `<div class="todo-empty">${t('no_todos')}</div>`;
  } else {
    todoEntries.forEach(({ note, item }) => {
      const group = state.groups.find((g) => g.id === note.groupId);
      const reminder = note.reminder && note.reminder.enabled && note.reminder.time;
      const overdue = reminder && !note.reminder.fired && new Date(note.reminder.time).getTime() < Date.now();
      html += `<div class="todo-line ${item.done ? 'done' : ''}" data-note="${note.id}" data-item="${item.id}">
        <input type="checkbox" ${item.done ? 'checked' : ''} />
        <div class="tl-body">
          <div class="tl-text">${escapeHtml(item.text || t('empty_item'))}</div>
          <div class="tl-meta">
            ${group ? `<span class="dot" style="background:${group.color}"></span>` : ''}
            <span class="link" data-goto="${note.id}">${escapeHtml(note.title || t('untitled'))}</span>
          </div>
        </div>
        ${reminder ? `<span class="tl-flag ${overdue ? 'overdue' : ''}">${overdue ? t('overdue') : ''} ${formatDate(note.reminder.time)}</span>` : ''}
        <button class="tl-del" title="${t('delete_todo')}">✕</button>
      </div>`;
    });
  }
  html += '</div>';

  html += `<div class="todo-section remind"><h4>${t('time_todos')}（${remindEntries.length}）</h4>`;
  if (remindEntries.length === 0) {
    html += `<div class="todo-empty">${t('no_reminders')}</div>`;
  } else {
    remindEntries.forEach((note) => {
      const overdue = !note.reminder.fired && new Date(note.reminder.time).getTime() < Date.now();
      const group = state.groups.find((g) => g.id === note.groupId);
      html += `<div class="todo-line" data-note="${note.id}">
        <div class="tl-body">
          <div class="tl-text">${escapeHtml(note.title || t('untitled'))}</div>
          <div class="tl-meta">
            ${group ? `<span class="dot" style="background:${group.color}"></span>` : ''}
            <span class="link" data-goto="${note.id}">${t('open_note')}</span>
          </div>
        </div>
        <span class="tl-flag ${overdue ? 'overdue' : ''}">${overdue ? t('overdue') + ' · ' : ''}${formatDate(note.reminder.time)}</span>
        <button class="tl-del" data-remind-clear="${note.id}" title="${t('clear_time')}">✕</button>
      </div>`;
    });
  }
  html += '</div>';

  list.innerHTML = html;
  wireTodoView();
}

function wireTodoView() {
  const qinput = $('#todoQuickInput');
  const addBtn = $('#btnQuickAdd');
  const addTodo = () => {
    const text = qinput ? qinput.value.trim() : '';
    if (!text) return;
    createTodoNote(text);
    qinput.value = '';
    renderAll();
    toast(t('toast_todo_added'));
  };
  if (addBtn) addBtn.onclick = addTodo;
  if (qinput) qinput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTodo(); });

  $$('#todoList .todo-line').forEach((line) => {
    const noteId = line.dataset.note;
    const cb = $('input[type=checkbox]', line);
    if (cb) {
      cb.addEventListener('change', () => {
        const n = state.notes.find((x) => x.id === noteId);
        if (!n) return;
        const item = (n.items || []).find((i) => i.id === line.dataset.item);
        if (item) { item.done = cb.checked; n.updatedAt = Date.now(); save(); }
        renderAll();
      });
    }
    const del = $('.tl-del', line);
    if (del) {
      if (del.dataset.remindClear) {
        del.onclick = () => {
          const n = state.notes.find((x) => x.id === noteId);
          if (n) { n.reminder = null; n.updatedAt = Date.now(); save(); renderAll(); }
        };
      } else {
        del.onclick = () => {
          const n = state.notes.find((x) => x.id === noteId);
          if (n) { n.items = (n.items || []).filter((i) => i.id !== line.dataset.item); n.updatedAt = Date.now(); save(); renderAll(); }
        };
      }
    }
    $$('.link[data-goto]', line).forEach((link) => {
      link.onclick = () => openNoteById(link.dataset.goto);
    });
  });
}

function openNoteById(id) {
  setViewMode('board');
  filter.group = 'all';
  filter.query = '';
  const si = $('#searchInput');
  if (si) si.value = '';
  const sc = $('#searchClear');
  if (sc) sc.classList.add('hidden');
  renderGroupChips();
  renderAll();
  const el = document.querySelector('[data-id="' + id + '"]');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    bringToFront(el);
    const target = $('.note-title', el) || $('.note-content', el);
    if (target) target.focus();
  }
}

  return { createTodoNote, createEmptyTodoNote, renderTodoView, wireTodoView, openNoteById };
}));
