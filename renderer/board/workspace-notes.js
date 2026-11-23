/* 工作区便签的可见范围、新建和落点。延续工作区模块的 UMD 接口。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.workspaceNotesView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

function nextGridPosition() {
  const z = (typeof boardZoom === 'function') ? boardZoom() : 1;
  const maxX = Math.round((($('#canvas').clientWidth) || LAYOUT.defaultW * 6) / z);
  // 只按当前分组/筛选的可见便签找空位，避免「其他分组的便签占位」导致新便签落点怪异
  const inCurrentView = (n) => {
    if (n.desktopPin) return false;
    if (!!n.archived !== !!filter.archive) return false;
    if (isGroupCollapsed(n.groupId)) return false;
    if (!filter.archive) {
      if (filter.group === 'ungrouped') return !n.groupId;
      if (filter.group !== 'all' && filter.group !== 'ungrouped') return n.groupId === filter.group;
    }
    return true;
  };
  const vis = state.notes.filter(inCurrentView);
  // 与当前视图（分组/全部）不重叠：占用集合取当前视图内便签在该作用域下的位置（分组独立，不跨组占用）
  const allOccupied = vis.map((n) => { const p = effPos(n); return { x: p.x, y: p.y, w: n.w, h: n.h }; });
  // 候选：把新便签追加到当前分组便签的紧凑排列之后（紧邻），但不与任何便签重叠
  const placed = BoardLayout.arrangeShelf(
    vis.map((n) => ({ id: n.id, w: n.w, h: n.h })).concat([{ id: '__new', w: LAYOUT.defaultW, h: LAYOUT.newH }]),
    maxX
  );
  const last = placed[placed.length - 1];
  if (!BoardLayout.overlapsAny(last.x, last.y, LAYOUT.defaultW, LAYOUT.newH, allOccupied)) return { x: last.x, y: last.y };
  // 候选与现有便签重叠时，回退到全局网格扫描找真正空位
  return BoardLayout.nextGridPosition(allOccupied, maxX);
}

// 「全部」视图作用域下的新便签空位：避开所有便签的 positionAll，保证回到「全部」时不重叠。
// 用于在分组/未分组视图新建便签时，独立给出 positionAll（与分组作用域的 x,y 分开）。
function nextAllPosition() {
  const z = (typeof boardZoom === 'function') ? boardZoom() : 1;
  const maxX = Math.round((($('#canvas').clientWidth) || LAYOUT.defaultW * 6) / z);
  const occupied = state.notes.map((n) => {
    const p = n.positionAll || { x: n.x || 0, y: n.y || 0 };
    return { x: p.x, y: p.y, w: n.w || LAYOUT.defaultW, h: n.h || LAYOUT.defaultH };
  });
  return BoardLayout.nextGridPosition(occupied, maxX, {}, LAYOUT.defaultW, LAYOUT.newH);
}

function createNote(x, y, gadget = null) {
  prepareNewNoteVisibility();
  pushUndo();
  const pos = (x != null && y != null) ? { x, y } : nextGridPosition();
  // 仅在「全部」视图时 positionAll 与当前作用域一致；分组/未分组视图独立算一个不重叠的「全部」空位。
  const allPos = (filter.group === 'all') ? pos : nextAllPosition();
  const groupId = (filter.group && filter.group !== 'all' && filter.group !== 'ungrouped') ? filter.group : null;
  const n = makeWorkspaceNote(pos, allPos, groupId, gadget);
  state.notes.push(n);
  ensureOrder();
  save();
  renderAll();
  focusNewNote(n.id);
  return n;
}

function makeWorkspaceNote(pos, allPos, groupId, gadget = null) {
  return {
    id: uid(),
    title: gadget ? t('gadget_' + gadget.kind) : '',
    ...(gadget ? { gadget } : {}),
    content: '',
    type: 'note',
    items: [],
    color: defaultNoteColor(),
    textColor: null,
    fontFamily: null,
    images: [],
    groupId,
    pinned: false,
    desktopPin: false,
    archived: false,
    preview: false,
    reminder: null,
    x: pos.x,
    y: pos.y,
    positionAll: { x: allPos.x, y: allPos.y },
    w: gadget ? 262 : LAYOUT.defaultW,
    h: gadget ? (gadget.kind === 'calendar' ? 378 : 230) : LAYOUT.newH,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function focusNewNote(id) {
  const el = document.querySelector('[data-id="' + id + '"]');
  if (el) {
    const target = $('.note-content', el) || $('.note-title', el) || $('.gadget-body button', el);
    if (target) target.focus();
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function visibleNotes() {
  const query = filter.query.trim().toLowerCase();
  return state.notes.filter((n) => {
    if (n.desktopPin && !n.gadget) return false;
    if (n.gadget && (state.settings.viewMode !== 'board' || docPickerReturn)) return false;
    if (!!n.archived !== !!filter.archive) return false;
    if (isGroupCollapsed(n.groupId)) return false;
    if (!filter.archive) {
      if (filter.group === 'ungrouped' && n.groupId) return false;
      if (filter.group !== 'all' && filter.group !== 'ungrouped' && n.groupId !== filter.group) return false;
    }
    if (query) {
      const g = state.groups.find((x) => x.id === n.groupId);
      // V128-01E1/E2：title/group 各自独立匹配；正文用可见渲染文本助手（按单元匹配，避免隐藏/跨单元假命中）。
      const titleMatch = (n.title || '').toLowerCase().includes(query);
      const groupMatch = g ? g.name.toLowerCase().includes(query) : false;
      const focusMatch = n.gadget?.kind === 'timer' && n.gadget.text?.toLowerCase().includes(query);
      if (!titleMatch && !groupMatch && !focusMatch && !noteSearchContentMatches(n, query)) return false;
    }
    return true;
  });
}

// 在指定位置新建一条带初始内容的便签（右键「粘贴为新便签」用）
function createNoteWithContent(x, y, content) {
  const n = createNote(x, y);
  n.content = content;
  n.updatedAt = Date.now();
  save();
  renderAll();
  focusNewNote(n.id);
  return n;
}

  return { nextGridPosition, nextAllPosition, createNote, makeWorkspaceNote, focusNewNote, createNoteWithContent, visibleNotes };
}));
