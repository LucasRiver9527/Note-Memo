/* 分组折叠及全部、分组两套坐标的布局快照。延续工作区模块的 UMD 接口。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.groupCollapseView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

// 分组折叠状态：collapsedGroups[gid] === true 时该分组的便签在所有视图隐藏（折叠）
function isGroupCollapsed(gid) {
  return !!(gid && state.settings.collapsedGroups && state.settings.collapsedGroups[gid]);
}

function toggleGroupCollapse(gid) {
  if (!gid) return;
  const map = state.settings.collapsedGroups || {};
  const nowCollapsed = !map[gid];
  map[gid] = nowCollapsed;
  state.settings.collapsedGroups = map;
  if (nowCollapsed) {
    // 折叠：把当前布局快照下来（两组坐标，覆盖「全部/分组」两套作用域），供取消折叠时原样恢复
    state.settings.collapseSnapshot[gid] = snapshotBoardLayout();
  } else {
    // 取消折叠：把布局恢复到折叠前（便签回到原始位置，不与后来整理/排布的便签重叠）
    const snap = state.settings.collapseSnapshot[gid];
    if (snap) restoreBoardLayout(snap);
    delete state.settings.collapseSnapshot[gid];
  }
  save();
  renderGroupChips();
  renderAll();
}

// 快照当前所有便签的布局：同时记录「全部」作用域(positionAll)与分组作用域(x,y)，保证任意视图下取消折叠都能还原。
function snapshotBoardLayout() {
  const all = [];
  const grp = [];
  state.notes.forEach((n) => {
    const pa = n.positionAll || { x: n.x || 0, y: n.y || 0 };
    all.push({ id: n.id, x: pa.x, y: pa.y });
    grp.push({ id: n.id, x: n.x || 0, y: n.y || 0 });
  });
  return { all, grp };
}

// 从快照恢复布局：写回 positionAll（「全部」作用域）与 x,y（分组作用域）
function restoreBoardLayout(snap) {
  if (!snap) return;
  const allById = new Map((snap.all || []).map((s) => [s.id, s]));
  const grpById = new Map((snap.grp || []).map((s) => [s.id, s]));
  state.notes.forEach((n) => {
    const a = allById.get(n.id);
    if (a && typeof a.x === 'number') n.positionAll = { x: a.x, y: a.y };
    const g = grpById.get(n.id);
    if (g && typeof g.x === 'number') { n.x = g.x; n.y = g.y; }
  });
}

  return { isGroupCollapsed, toggleGroupCollapse, snapshotBoardLayout, restoreBoardLayout };
}));
