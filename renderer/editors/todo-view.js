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
  prepareNewNoteVisibility();
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
  prepareNewNoteVisibility();
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

function renderTodoView(visible, query) {
  const list = $('#todoList');
  if (!list) return 0;

  query = query || '';
  visible = visible || [];

  const todoEntries = [];
  getSortedNotes(visible).forEach((n) => {
    if (n.type === 'todo') {
      const group = state.groups.find((g) => g.id === n.groupId);
      // V128-01E1：标题与分组各自独立匹配，避免 title+group 拼接产生跨字段短语假命中。
      const noteMatch = !query || [n.title || '', group ? group.name : ''].some((f) => f.toLowerCase().includes(query));
      (n.items || []).filter((it) => noteMatch || (it.text || '').toLowerCase().includes(query))
        .forEach((it) => todoEntries.push({ note: n, item: it }));
    }
  });
  const openCount = todoEntries.filter((e) => !e.item.done).length;

  const remindEntries = visible
    .filter((n) => n.reminder && n.reminder.enabled && n.reminder.time)
    .filter((n) => {
      if (!query) return true;
      const group = state.groups.find((g) => g.id === n.groupId);
      const titleOrGroup = [n.title || '', group ? group.name : ''].some((f) => f.toLowerCase().includes(query));
      if (titleOrGroup) return true;
      // V128-01E2：普通便签正文复用可见渲染文本助手（文件/表格/富文本命中不被第二层过滤丢弃）；
      // TODO 类型提醒保持旧的 title/group/raw-content 规则，不因兄弟任务命中而新增提醒行。
      if (n.type === 'todo') return (n.content || '').toLowerCase().includes(query);
      return noteSearchContentMatches(n, query);
    })
    .sort((a, b) => new Date(a.reminder.time) - new Date(b.reminder.time));

  let html = '';
  html += `<div class="todo-panel-head"><h3>${t('todo_items')}</h3><span class="count">${t('todo_open_count')} ${openCount}</span></div>
    <div class="todo-add-box"><input id="todoQuickInput" type="text" placeholder="${t('add_todo_ph')}" /><button class="sp-btn" id="btnQuickAdd" style="width:auto;padding:0 18px">${t('add')}</button></div>`;

  html += `<div class="todo-section items"><h4>${t('todo_all_items')}（${todoEntries.length}）</h4>`;
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
  return todoEntries.length + remindEntries.length;
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

  // V128-01D2：按当前查询注入搜索解释（展示层；不改变过滤/数据）。
  applyTodoSearch();
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
  return el || null; // V128-01D2：附加返回，供搜索定位复用（不改变既有调用方语义）
}

/* ============ V128-01D2：待办视图搜索解释与安全定位 ============ */
// 只检查「当前这一行」自身的任务项 + 该便签的标题/分组，绝不借用兄弟项。
// 返回 { kind: 'todo'|'title'|'group'|'fallback', hit, itemIndex? } 或 null（无查询）。
// 优先级（确定性）：本行任务项 > 标题 > 分组 > 通用回退（仅原始正文/跨字段命中时）。
function todoSearchTarget(note, item, query) {
  if (!query || !note) return null;
  if (item) {
    const own = findNoteSearchMatches({ items: [item] }, null, query).find((h) => h.field === 'todo');
    if (own) return { kind: 'todo', hit: own };
  }
  const title = findNoteSearchMatches({ title: note.title }, null, query).find((h) => h.field === 'title');
  if (title) return { kind: 'title', hit: title };
  const group = state.groups.find((g) => g.id === note.groupId);
  const groupHit = group ? findNoteSearchMatches({}, group.name, query).find((h) => h.field === 'group') : null;
  if (groupHit) return { kind: 'group', hit: groupHit };
  // 仅原始富文本正文 / 跨字段索引命中：不做精确富文本偏移声明，给出诚实的通用回退。
  return { kind: 'fallback', hit: null };
}

// 构造一行紧凑的「来源 + 片段 + 定位」节点（纯 DOM、textContent，绝不拼接 HTML）。
function buildTodoSearchNodes(target) {
  const wrap = document.createElement('span');
  wrap.className = 'todo-search';
  const source = document.createElement('span');
  source.className = 'todo-search-source';
  const snippet = document.createElement('span');
  snippet.className = 'todo-search-snippet';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'todo-search-locate';

  if (!target || target.kind === 'fallback') {
    source.textContent = t('search_hit_content');
    snippet.textContent = t('search_hit_fallback');
    button.textContent = t('search_view_note');
  } else if (target.kind === 'todo') {
    // 任务文字已在 .tl-text 内高亮，此处不重复整段摘要，仅给来源标签与定位。
    source.textContent = t('search_hit_todo');
    button.textContent = t('search_locate');
  } else {
    const hit = target.hit;
    source.textContent = t('search_hit_' + hit.field);
    const summary = buildSearchSnippet(hit.text, hit.start, hit.end);
    if (summary.truncatedBefore) snippet.appendChild(document.createTextNode('…'));
    summary.parts.forEach((part) => {
      const seg = document.createElement(part.matched ? 'mark' : 'span');
      seg.textContent = part.text; // 字面用户文本，绝不 HTML 注入
      snippet.appendChild(seg);
    });
    if (summary.truncatedAfter) snippet.appendChild(document.createTextNode('…'));
    button.textContent = target.kind === 'group' ? t('search_view_group') : t('search_locate');
  }
  wrap.append(source, snippet, button);
  return wrap;
}

// 给当前列表的每一行按需注入搜索解释；查询为空时清理，恢复原状。
function applyTodoSearch() {
  const list = $('#todoList');
  if (!list) return;
  const query = filter.query.trim();
  $$('.todo-line', list).forEach((line) => {
    const prev = $('.todo-search', line);
    if (prev) prev.remove();
    if (!query) return;
    const note = state.notes.find((n) => n.id === line.dataset.note);
    if (!note) return;
    const item = line.dataset.item ? (note.items || []).find((i) => i.id === line.dataset.item) : null;
    const target = todoSearchTarget(note, item, query);
    if (!target) return;
    // 本行任务命中：安全标记既有 .tl-text（纯 DOM 文本节点，不改可编辑态/数据模型）。
    if (target.kind === 'todo' && item) {
      const tlText = $('.tl-text', line);
      if (tlText) {
        tlText.textContent = '';
        const before = item.text.slice(0, target.hit.start);
        const mid = item.text.slice(target.hit.start, target.hit.end);
        const after = item.text.slice(target.hit.end);
        if (before) tlText.appendChild(document.createTextNode(before));
        const mark = document.createElement('mark');
        mark.textContent = mid;
        tlText.appendChild(mark);
        if (after) tlText.appendChild(document.createTextNode(after));
      }
    }
    const meta = $('.tl-meta', line);
    if (meta) {
      const nodes = buildTodoSearchNodes(target);
      // 搜索操作绝不触发批量选择/删除/拖动等副作用。
      ['click', 'pointerdown', 'mousedown', 'contextmenu'].forEach((name) => nodes.addEventListener(name, (e) => e.stopPropagation()));
      const btn = $('.todo-search-locate', nodes);
      if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); locateTodoSearch(note.id, item ? item.id : null, query); });
      meta.appendChild(nodes);
    }
  });
}

// 定位：重新计算实时命中（不信任旧偏移），导航到画布后按稳定 item id/index 或标题聚焦并选中。
function locateTodoSearch(noteId, itemId, query) {
  const note = state.notes.find((n) => n.id === noteId);
  if (!note) return;
  const item = itemId ? (note.items || []).find((i) => i.id === itemId) : null;
  const target = todoSearchTarget(note, item, query);
  const el = openNoteById(noteId); // 会清空查询并切到画布；返回构建好的卡片元素
  if (!el) return;
  if (target && target.kind === 'todo' && item) {
    const idx = (note.items || []).indexOf(item);
    const input = $$('.todo-text', el)[idx];
    if (input) {
      const fresh = findNoteSearchMatches({ items: [item] }, null, query).find((h) => h.field === 'todo');
      input.focus({ preventScroll: true });
      if (fresh) input.setSelectionRange(fresh.start, fresh.end);
      input.scrollIntoView({ block: 'nearest' });
    }
    return;
  }
  if (target && target.kind === 'title') {
    const input = $('.note-title', el);
    if (input) {
      const fresh = findNoteSearchMatches({ title: note.title }, null, query).find((h) => h.field === 'title');
      input.focus({ preventScroll: true });
      if (fresh) input.setSelectionRange(fresh.start, fresh.end);
      input.scrollIntoView({ block: 'nearest' });
    }
    return;
  }
  if (target && target.kind === 'group') {
    const tag = $('.group-tag', el);
    if (tag) {
      if (!tag.hasAttribute('tabindex')) tag.tabIndex = -1;
      tag.focus({ preventScroll: true });
      tag.scrollIntoView({ block: 'nearest' });
    }
    return;
  }
  // 原始正文 / 跨字段回退：安全打开并聚焦卡片本身，不声明精确插入符，也不触发链接/文件。
  if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
  el.focus({ preventScroll: true });
}

  return { createTodoNote, createEmptyTodoNote, renderTodoView, wireTodoView, openNoteById };
}));
