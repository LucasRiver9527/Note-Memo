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
// 当前视图排序数组作用域：归档视图忽略底层分组（与渲染一致，用全局 noteOrder）、
// 分组视图用 groupOrders[id]、其余为 null（全局 noteOrder）。
function activeGroupId() {
  if (filter.archive) return null; // 归档忽略底层分组：读写都走全局 noteOrder，避免污染某分组顺序
  return resolveScope(filter.group).orderGid;
}
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
// opts.persist===false：只就地补全 positionAll、不触发 save()。导入等「先改内存、待显式 replace 提交」的
// 流程必须用此变体，否则 save() 会 captureDraft 出一份「尚未提交的替换内容」草稿，replace 失败后该草稿
// 仍会覆盖用户原有的合法恢复草稿。其它调用者不传参，保持原有隐式保存行为（仅在有变更时保存）。
function initAllLayout(opts) {
  if (BoardLayout.initPositionAll(state.notes, canvasMaxX()) && !(opts && opts.persist === false)) save();
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
  // 归档忽略底层分组：用全局 noteOrder 读取，与 activeGroupId/保存路径保持一致。
  const scopeGroup = filter.archive ? 'all' : filter.group;
  const ids = SortState.applySortStrategy(arr, state.settings.sortMode, scopeGroup, state.settings.noteOrder, state.settings.groupOrders);
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

// 快速保存：把当前排列顺序保存为自定义排序，并记录布局快照（供「恢复保存布局」显式恢复；不做碰撞修复）。
// 返回布尔：可见结果为空时不改动任何状态并返回 false（调用方据此决定是否提示）。
function saveCurrentOrder() {
  const inViewNotes = visibleNotes(); // 单一可见选择器（与 renderAll/arrange 一致）
  if (!inViewNotes.length) return false;
  beginUndo(); // UX-30D：显式操作前记录，结束时按是否真变化提交
  ensureOrder();
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
  // 归档忽略底层分组由 activeGroupId() 解析为 null（全局 noteOrder）
  const order = orderRefFor(activeGroupId());
  // 只重排当前视图内便签（保留视图外原有槽位与相对顺序）。
  const reordered = reorderScoped(order, ids);
  order.length = 0;
  reordered.forEach((id) => order.push(id));
  // 记录布局快照（供「一键整理」恢复到保存时的精确位置，并对重叠便签轻移去重叠）：
  // 合并进已有 scope 快照，保留未可见项旧条目，不用筛选子集整体覆盖。
  state.settings.orderLayouts = state.settings.orderLayouts || {};
  const key = layoutScopeKey();
  const snap = state.settings.orderLayouts[key] || {};
  inViewNotes.forEach((n) => { const p = effPos(n); snap[n.id] = { x: p.x, y: p.y }; });
  state.settings.orderLayouts[key] = snap;
  commitUndoIfChanged(); // UX-30D：确有变化才入栈（无变化保留 redo）
  save();
  renderSortPanel();
  renderAll();
  toast(t('toast_sort_saved'));
  return true;
}

/* ============ 整理排列 ============ */
// 一键整理：ALWAYS 按当前排序策略/顺序紧凑打包当前可见便签；不恢复快照（恢复是显式操作，见 restoreSavedLayout）。
// 边界与碰撞：可用宽度 = canvasMaxX - 2*margin（左右对称留白）；超出者视为「超大」，单独放左边界下方一行。
// 为「被查询/折叠隐藏但共享当前坐标作用域」的普通便签保留固定矩形参与避让，清空筛选后不新暴露重叠。
function arrangeNotes() {
  const maxX = canvasMaxX();
  const inViewNotes = visibleNotes();
  if (!inViewNotes.length) return false; // 无可见结果：不改动任何状态、不提示
  beginUndo(); // UX-30D：显式操作前记录，结束时按是否真变化提交
  ensureOrder();
  const sorted = getSortedNotes(inViewNotes);
  if (!sorted.length) { cancelUndo(); return false; } // 起始后提前返回：丢弃挂起快照，避免污染下一次提交
  const margin = LAYOUT.margin;
  const availW = Math.max(0, (maxX > 0 ? maxX : Infinity) - margin * 2);
  const oversize = (w) => (w > availW); // 可用宽为 0 时，任何正宽都算超大
  // 普通在前（保持当前顺序），超大在后（保持相对顺序）
  const ordered = sorted.slice().sort((a, b) =>
    (oversize(a.w || LAYOUT.defaultW) ? 1 : 0) - (oversize(b.w || LAYOUT.defaultW) ? 1 : 0)
  );
  const normals = ordered.filter((n) => !oversize(n.w || LAYOUT.defaultW));
  const bigs = ordered.filter((n) => oversize(n.w || LAYOUT.defaultW));
  // 固定障碍：与当前可见集共享坐标作用域、但被查询/折叠隐藏的普通便签（排除钉桌与相反归档状态）。
  const fixed = fixedHiddenRects(inViewNotes);
  // 只对普通便签做紧凑打包（含固定障碍避让）。
  const payload = normals.map((n) => ({ id: n.id, w: n.w, h: n.h }));
  const placed = BoardLayout.arrangeCompact(payload, maxX, undefined, fixed);
  const posMap = new Map(placed.map((p) => [p.id, p]));
  normals.forEach((n) => {
    const p = posMap.get(n.id);
    if (p) setEffPos(n, p.x, p.y);
  });
  // 超大项：从「普通结果 + 固定障碍」的下方开始，每个单独一行（各只放一次，无幻影行）。
  // 无普通项/障碍时第一个超大项从 y=margin 开始。
  if (bigs.length) {
    let bottom = (normals.length || fixed.length) ? margin : null;
    if (bottom !== null) {
      placed.forEach((p) => { const n = normals.find((x) => x.id === p.id); if (n) bottom = Math.max(bottom, p.y + (n.h || LAYOUT.defaultH)); });
      fixed.forEach((r) => { bottom = Math.max(bottom, r.y + r.h); });
    }
    bigs.forEach((n, i) => {
      if (i === 0) bottom = (bottom === null) ? margin : bottom + LAYOUT.gap;
      else bottom = bottom + LAYOUT.gap;
      setEffPos(n, margin, bottom);
      bottom += (n.h || LAYOUT.defaultH);
    });
  }
  // 说明：整理只改可见便签的位置；不写入 orderLayouts 快照、不改 sortMode、不改用户自定义顺序。
  commitUndoIfChanged(); // UX-30D
  save();
  renderSortPanel();
  renderAll();
  return true;
}

// 与当前可见集共享「坐标作用域」、但被查询/折叠隐藏的普通便签的保留矩形。
// - 排除 desktopPin 与相反归档状态；归档视图用同一 effPos 作用域（effPos 仍取 filter.group，归档忽略分组的选择只影响可见集）。
// - 位置一律用 effPos(n)（不是无条件 positionAll）：all->positionAll，其余->x,y。
function fixedHiddenRects(visibleList) {
  const visIds = new Set(visibleList.map((n) => n.id));
  const rects = [];
  state.notes.forEach((n) => {
    if (!n || n.desktopPin) return;
    if (!!n.archived !== !!filter.archive) return;
    if (visIds.has(n.id)) return; // 可见项本身参与排布，不算固定障碍
    let inScope;
    if (filter.archive || filter.group === 'all') inScope = true;
    else if (filter.group === 'ungrouped') inScope = !n.groupId;
    else inScope = n.groupId === filter.group;
    if (!inScope) return;
    const p = effPos(n);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0) return;
    rects.push({ x: p.x, y: p.y, w: n.w || LAYOUT.defaultW, h: n.h || LAYOUT.defaultH });
  });
  return rects;
}

// 有效快照项：必须是快照 map 的**自有**属性，值为对象，且 x/y 为有限数字（Number.isFinite，不接受数字字符串/布尔/null），均 >= 0。
function validSavedPos(map, id) {
  if (!map || typeof map !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(map, id)) return null;
  const s = map[id];
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) return null;
  if (s.x < 0 || s.y < 0) return null;
  return { x: s.x, y: s.y };
}

// 是否可显式恢复：当前 layoutScopeKey 快照中，至少有一个当前可见便签拥有有效的 x/y 对。
// 纯函数：不做任何写入/渲染。
function canRestoreSavedLayout() {
  const snap = (state.settings.orderLayouts || {})[layoutScopeKey()];
  return visibleNotes().some((n) => validSavedPos(snap, n.id) !== null);
}

// 显式恢复保存布局：只把「当前可见且快照中有有效 x/y」的便签用 setEffPos 放回保存位置（EXACT，不做静默适配）。
// 隐藏项、未保存（新建）可见项保持原位；不改内容/尺寸/排序模式/自定义顺序；快照保持原样。
// 恢复后如与「当前尺寸/水平边界」冲突（涉及被恢复的便签），给出一次性本地化提示；否则用普通成功提示。
// 返回布尔：无可恢复项时 false 且不写盘/不渲染/不提示。
function restoreSavedLayout() {
  const snap = (state.settings.orderLayouts || {})[layoutScopeKey()];
  const targets = visibleNotes()
    .map((n) => ({ n, pos: validSavedPos(snap, n.id) }))
    .filter((t) => t.pos !== null);
  if (!targets.length) return false;
  beginUndo(); // UX-30D：显式操作前记录，结束时按是否真变化提交
  targets.forEach(({ n, pos }) => { setEffPos(n, pos.x, pos.y); });
  const conflict = restoreConflict(targets);
  commitUndoIfChanged();
  save();
  renderSortPanel();
  renderAll();
  toast(t(conflict ? 'toast_layout_restored_conflict' : 'toast_layout_restored'));
  return true;
}

// 计算「恢复后」是否与被恢复便签相关地冲突：真实矩形重叠（不含间距）或实际水平越出视口（右边界 > canvasMaxX）。
// 只统计涉及被恢复便签的冲突；无关的既有重叠、以及保存时故意贴边/近距不影响。不含竖直方向（画布可纵向滚动）。
function restoreConflict(targets) {
  const maxX = canvasMaxX();
  const rightEdge = (maxX > 0) ? maxX : Infinity; // 实际视口宽度，非装饰性 margin
  const restoredIds = new Set(targets.map((t) => t.n.id));
  const rectOf = (n) => { const p = effPos(n); return { x: p.x, y: p.y, w: n.w || LAYOUT.defaultW, h: n.h || LAYOUT.defaultH, id: n.id }; };
  const restored = targets.map((t) => rectOf(t.n));
  // 同作用域未恢复普通便签（隐藏/未保存）的当前位置
  const others = state.notes
    .filter((n) => n && !n.desktopPin && !!n.archived === !!filter.archive && !restoredIds.has(n.id))
    .filter((n) => {
      if (filter.archive || filter.group === 'all') return true;
      if (filter.group === 'ungrouped') return !n.groupId;
      return n.groupId === filter.group;
    })
    .map(rectOf);
  // 严格矩形相交（不含 LAYOUT.gap）：用户可有意保存贴边/近距布局，不应因间距不足报警。
  const hit = (a, b) => (a.x < b.x + b.w) && (a.x + a.w > b.x) && (a.y < b.y + b.h) && (a.y + a.h > b.y);
  for (const r of restored) {
    if (r.x + r.w > rightEdge + 0.5) return true; // 实际越出视口右侧（贴边不算）
  }
  for (let i = 0; i < restored.length; i++) {
    for (let j = i + 1; j < restored.length; j++) if (hit(restored[i], restored[j])) return true;
    for (const o of others) if (hit(restored[i], o)) return true;
  }
  return false;
}

  return {
    effPos, setEffPos, activeGroupId, layoutScopeKey, canvasMaxX, initAllLayout,
    orderRefFor, sortPanelGid, ensureOrder, getSortedNotes,
    moveSortBy, moveSortItem, memoReorder, memoReorderAfter, saveCurrentOrder, arrangeNotes,
    canRestoreSavedLayout, restoreSavedLayout
  };
}));
