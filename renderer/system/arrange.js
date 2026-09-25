/* system/arrange.js
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.systemArrange + 顶层全局。
   —— 本模块的函数通过顶层全局访问其他模块（与 board-layout.js / sort-panel.js 等同构）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.systemArrange = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

/* ============ 排序 ============ */
// 视图位置/排序作用域已收归 sort-state.js（纯函数，可单测）；此处仅保留绑定全局 filter 的薄封装。
// 「全部」用 positionAll、分组/未分组用便签自身 x,y（相互独立，分组内整理不影响「全部」，反之亦然）。
function effPos(n) { return posOf(n, filter.group); }
function setEffPos(n, x, y) { writePos(n, x, y, filter.group); }
// 当前视图排序数组作用域：null 用全局 noteOrder，分组用 groupOrders[id]
function activeGroupId() { return resolveScope(filter.group).orderGid; }
// 布局快照作用域键：'all'→'_all'、'ungrouped'→'_ungrouped'、分组→分组 id
function layoutScopeKey() { return resolveScope(filter.group).layoutKey; }
// 当前画布可视宽度（供初始化「全部」位置/一键整理用），取不到时回退到默认。
// ★ 缩放一致性：便签坐标始终「未缩放」，故可视区对应的可用宽度 = clientWidth / zoom
//   （放大时可视范围变小，与 arrangeNotes 的打包口径一致，避免初始化补位排到屏幕外）。
// ⚠️ 非法缩放值（0/负数/NaN/Infinity）一律兜底为 1 —— 否则会产出 NaN/Infinity/负宽度。
function canvasMaxX() {
  const el = $('#canvas');
  const w = el && el.clientWidth;
  if (!w || w <= 0) return LAYOUT.defaultW * 6;
  const z = boardZoom();
  const zSafe = (typeof z === 'number' && isFinite(z) && z > 0) ? z : 1;
  return Math.round(w / zSafe);
}
// 为「没有 positionAll」的旧数据/导入数据补全「全部」位置（纯逻辑在 board-layout.initPositionAll）
function initAllLayout() {
  if (BoardLayout.initPositionAll(state.notes, canvasMaxX())) save();
}
// 取某个作用域的排序数组引用：gid 为 null 用全局 noteOrder，否则用该分组自己的 groupOrders[gid]
function orderRefFor(gid) {
  if (gid) {
    state.settings.groupOrders = state.settings.groupOrders || {};
    if (!state.settings.groupOrders[gid]) state.settings.groupOrders[gid] = [];
    return state.settings.groupOrders[gid];
  }
  if (!state.settings.noteOrder) state.settings.noteOrder = [];
  return state.settings.noteOrder;
}
// 排序面板当前选中的分组（'all' = 全局），与视图 filter.group 相互独立
// （sortPanelGroupId 见 core/app-state.js）
// 排序面板作用域对应的排序数组：'all'/'ungrouped' 用全局 noteOrder，具体分组用 groupOrders[id]
function sortPanelGid() {
  return resolveScope(sortPanelGroupId).orderGid;
}

function ensureOrder() {
  const r = ensureOrderRefs(state.notes, state.groups, state.settings.noteOrder, state.settings.groupOrders);
  state.settings.noteOrder = r.noteOrder;
  state.settings.groupOrders = r.groupOrders;
}

function getSortedNotes(arr) {
  // 显示顺序 = 排序策略（custom 用 noteOrder/groupOrders；其它按时间/标题/颜色动态计算，绝不改动存储基准）
  const ids = SortState.applySortStrategy(arr, state.settings.sortMode, filter.group, state.settings.noteOrder, state.settings.groupOrders);
  const byId = new Map(arr.map((n) => [n.id, n]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function moveSortBy(id, dir) {
  const order = orderRefFor(sortPanelGid());
  const idx = order.indexOf(id);
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= order.length) return;
  order.splice(idx, 1);
  order.splice(target, 0, id);
  save();
  renderSortPanel();
  renderAll();
}

function moveSortItem(fromId, toId) {
  const order = orderRefFor(sortPanelGid());
  moveBefore(order, fromId, toId);
  save();
  renderSortPanel();
  renderAll();
}

function memoReorder(fromId, toId) {
  ensureOrder();
  state.settings.sortMode = 'custom';
  const order = orderRefFor(activeGroupId());
  moveBefore(order, fromId, toId);
  save();
  renderAll();
}

function memoReorderAfter(fromId, afterId) {
  ensureOrder();
  state.settings.sortMode = 'custom';
  const order = orderRefFor(activeGroupId());
  moveAfter(order, fromId, afterId);
  save();
  renderAll();
}

// 快速保存：不进设置，把当前排列顺序保存为自定义排序（并记录布局快照供「一键整理」恢复）
function saveCurrentOrder() {
  ensureOrder();
  const inView = (n) => {
    if (n.desktopPin) return false;
    if (filter.group === 'ungrouped') return !n.groupId;
    if (filter.group !== 'all' && filter.group !== 'ungrouped') return n.groupId === filter.group;
    return true;
  };
  const inViewNotes = state.notes.filter(inView);
  // 先捕获「当前显示顺序」，再改 sortMode（否则改成 custom 后就拿不到原排序模式下的顺序了）。
  //   - 「便签（画布）」视图：按画布坐标读序（先行后列，经 posOf 取当前作用域位置）。
  //   - 列表视图（备忘录/待办/文档）：以「当前显示顺序」为准（getSortedNotes 按当前排序模式排好）。
  let ids;
  if (state.settings.viewMode === 'board') {
    ids = readOrderFromLayout(inViewNotes, filter.group);
  } else {
    ids = getSortedNotes(inViewNotes).map((n) => n.id);
  }
  state.settings.sortMode = 'custom';
  const order = orderRefFor(activeGroupId());
  // 只重排当前视图内的便签，保留视图外便签原有相对顺序（如「未分组」保存时不清空分组便签顺序）
  const reordered = reorderScoped(order, ids);
  order.length = 0;
  reordered.forEach((id) => order.push(id));
  state.notes.forEach((n) => { if (inView(n) && !order.includes(n.id)) order.push(n.id); });
  // 记录布局快照（供「一键整理」恢复到保存时的精确位置，并对重叠便签轻移去重叠）。
  state.settings.orderLayouts = state.settings.orderLayouts || {};
  const snap = {};
  state.notes.filter(inView).forEach((n) => { const p = effPos(n); snap[n.id] = { x: p.x, y: p.y }; });
  state.settings.orderLayouts[layoutScopeKey()] = snap;
  save();
  renderSortPanel();
  renderAll();
  toast(t('toast_sort_saved'));
}

/* ============ 整理排列 ============ */function arrangeNotes() {
  // 按「当前可视画布宽度」打包，确保整理后所有便签都落在窗口可视范围内。
  // 复用 canvasMaxX()：可视区对应的「未缩放」宽度 = clientWidth / zoom（便签坐标始终未缩放），
  // 与初始化补位保持同一口径（此前两处各算一次，缩放时口径可能不一致）。
  const maxX = canvasMaxX();
  // 每个分组独立整理：只打包当前分组/筛选的便签，不关心其它分组；「全部」视图打包所有便签。
  // 折叠分组视为不占位：整理仅作用于当前可见（未折叠）便签，让它们填满整个画布（含折叠组腾出的空白）。
  const inView = (n) => {
    if (n.desktopPin) return false;
    if (isGroupCollapsed(n.groupId)) return false;
    if (filter.group === 'ungrouped') return !n.groupId;
    if (filter.group !== 'all' && filter.group !== 'ungrouped') return n.groupId === filter.group;
    return true;
  };
  ensureOrder();
  const inViewNotes = state.notes.filter(inView);
  // 一键整理：精确恢复「保存当前排序」时记录的布局快照（保持保存的顺序与位置）。
  // 说明：快照是「保存当前排序」那一刻的样子；若手动调整后想以新布局为基准，请再点一次「保存当前排序」。
  // 未保存过（无快照）时，按当前排序模式紧凑「填空」排列。
  const snap = (state.settings.orderLayouts || {})[layoutScopeKey()];
  if (state.settings.sortMode === 'custom' && snap) {
    inViewNotes.forEach((n) => {
      const s = snap[n.id];
      if (s && typeof s.x === 'number') setEffPos(n, s.x, s.y);
    });
    // 未保存（新建）便签：按默认方案（创建时间降序）排序后，逐个放到不重叠空位；绝不移动已保存便签的位置。
    const occupied = [];
    inViewNotes.forEach((n) => {
      if (snap[n.id] && typeof snap[n.id].x === 'number') {
        const p = effPos(n);
        occupied.push({ x: p.x, y: p.y, w: n.w || LAYOUT.defaultW, h: n.h || LAYOUT.defaultH });
      }
    });
    const unsaved = inViewNotes.filter((n) => !(snap[n.id] && typeof snap[n.id].x === 'number'));
    unsaved.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).forEach((n) => {
      const w = n.w || LAYOUT.defaultW, h = n.h || LAYOUT.defaultH;
      const cand = BoardLayout.nextGridPosition(occupied, maxX, {}, w, h);
      setEffPos(n, cand.x, cand.y);
      occupied.push({ x: cand.x, y: cand.y, w, h });
    });
  } else {
    const sorted = getSortedNotes(inViewNotes);
    if (!sorted.length) return;
    // 超大（超出画布宽）便签放到最后再排：避免它在中间占位导致后面便签被挤到下方、中间留出大块空白。
    // 排布仍按当前排序顺序（仅把超大便签整体后移），其余便签保持阅读顺序紧凑打包。
    const maxW = (maxX > 0) ? maxX : Infinity;
    const ordered = sorted.slice().sort((a, b) =>
      (((a.w || LAYOUT.defaultW) > maxW) ? 1 : 0) - (((b.w || LAYOUT.defaultW) > maxW) ? 1 : 0)
    );
    const payload = ordered.map((n) => ({ id: n.id, w: n.w, h: n.h }));
    const placed = BoardLayout.arrangeCompact(payload, maxX);
    const posMap = new Map(placed.map((p) => [p.id, p]));
    sorted.forEach((n) => {
      const p = posMap.get(n.id);
      if (p) setEffPos(n, p.x, p.y);
    });
  }
  save();
  renderSortPanel();
  renderAll();
}

  return {
    effPos, setEffPos, activeGroupId, layoutScopeKey, canvasMaxX, initAllLayout,
    orderRefFor, sortPanelGid, ensureOrder, getSortedNotes,
    moveSortBy, moveSortItem, memoReorder, memoReorderAfter, saveCurrentOrder, arrangeNotes
  };
}));
