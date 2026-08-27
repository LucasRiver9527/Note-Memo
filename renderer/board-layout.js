/* 画布 / 便签布局纯逻辑模块：单一来源，可被单元测试，也可挂到页面全局。
   - Node: module.exports
   - 浏览器: 挂 root.BoardLayout + 顶层全局，app.js 可直接按名字调用 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.BoardLayout = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 布局常量统一入口：画布缩放宽高、网格、间距改动只改这里
  const LAYOUT = {
    margin: 20,       // 画布内边距 / 起始偏移
    gap: 18,          // 便签间距
    gridWidth: 260,   // 网格单元宽（用于计算列数）
    gridHeight: 230,  // 网格单元高
    defaultW: 240,    // 便签默认宽
    defaultH: 180,    // 便签默认高
    newH: 200,        // 新便签默认高（nextGridPosition 用）
    maxCells: 5000,   // 网格扫描上限，防死循环
    segmentGap: 36,   // 「按分组分段」策略：各分段之间的垂直间距
    zoomMin: 0.4,     // 画布缩放下限
    zoomMax: 2,       // 画布缩放上限
    zoomStep: 0.1,    // 画布缩放步长
    recentGroupLimit: 8 // 「最近使用分组」最多保留的数量
  };

  function optsOf(opts) { return { ...LAYOUT, ...(opts || {}) }; }

  function gridCols(canvasW, opts) {
    const L = optsOf(opts);
    return Math.max(1, Math.floor((canvasW - L.margin * 2 + L.gap) / L.gridWidth));
  }

  function overlapsAny(x, y, w, h, existing, opts) {
    const L = optsOf(opts);
    return (existing || []).some((n) => {
      const nw = n.w || L.defaultW;
      const nh = n.h || L.defaultH;
      return (x < n.x + nw + L.gap) && (x + w + L.gap > n.x) && (y < n.y + nh + L.gap) && (y + h + L.gap > n.y);
    });
  }

  function nextGridPosition(existing, canvasW, opts, nw, nh) {
    const L = optsOf(opts);
    const cols = gridCols(canvasW, opts);
    const newW = (typeof nw === 'number' && nw > 0) ? nw : L.defaultW;
    const newH = (typeof nh === 'number' && nh > 0) ? nh : L.newH;
    const arr = existing || [];
    for (let i = 0; i < L.maxCells; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = L.margin + col * L.gridWidth;
      const y = L.margin + row * L.gridHeight;
      if (canvasW > 0 && x + newW > canvasW) continue;
      if (!overlapsAny(x, y, newW, newH, arr, opts)) return { x, y };
    }
    let maxBottom = L.margin;
    arr.forEach((n) => { maxBottom = Math.max(maxBottom, (n.y || L.margin) + (n.h || L.defaultH)); });
    const fx = (canvasW > 0) ? Math.max(L.margin, canvasW - newW) : L.margin;
    return { x: fx, y: maxBottom + L.gap };
  }

  // 行式紧凑打包：按便签实际宽高排布，间距恒定，返回 [{ id, x, y }]
  function arrangeShelf(notes, maxX, opts) {
    const L = optsOf(opts);
    let x = L.margin;
    let y = L.margin;
    let rowMaxH = L.margin;
    const out = [];
    (notes || []).forEach((n) => {
      const w = n.w || L.defaultW;
      const h = n.h || L.defaultH;
      if (x > L.margin && x + w > maxX) {
        x = L.margin;
        y += rowMaxH + L.gap;
        rowMaxH = 0;
      }
      out.push({ id: n.id, x, y });
      x += w + L.gap;
      rowMaxH = Math.max(rowMaxH, h);
    });
    return out;
  }

  // 紧凑「填空型」书架排布：按传入顺序，把每个便签放到最低且最左、可放下且不与已放便签重叠的位置，
  // 从而填满宽/高便签旁边的空隙，得到紧凑无重叠、尊重自定义排序的布局。
  // 关键：落点必须在阅读顺序上「不早于」上一个便签（行优先、行内按 x），保证视觉阅读顺序与传入顺序一致。
  function arrangeCompact(notes, maxX, opts) {
    const L = optsOf(opts);
    const band = 100;
    const keyOf = (x, y) => (Math.round(y / band) * 1e6 + Math.round(x));
    const placed = [];
    const out = [];
    let lastKey = -Infinity;
    (notes || []).forEach((n, i) => {
      const w = n.w || L.defaultW;
      const h = n.h || L.defaultH;
      // 候选 y：画布顶部、以及每个已放便签的下边缘下方
      const ySet = new Set([L.margin]);
      placed.forEach((p) => ySet.add(p.y + p.h + L.gap));
      const yList = Array.from(ySet).sort((a, b) => a - b);
      let best = null;
      for (const y of yList) {
        // 候选 x：画布左侧、以及与该 y 垂直带重叠的已放便签的右边缘
        const xSet = new Set([L.margin]);
        placed.forEach((p) => {
          const vover = !(p.y > y + h + L.gap - 1 || y > p.y + p.h + L.gap - 1);
          if (vover) xSet.add(p.x + p.w + L.gap);
        });
        const xList = Array.from(xSet).sort((a, b) => a - b);
        for (const x of xList) {
          if (maxX > 0 && x + w > maxX) continue;
          if (keyOf(x, y) < lastKey) continue;
          if (!overlapsAny(x, y, w, h, placed, opts)) { best = { x, y }; break; }
        }
        if (best) break;
      }
      if (!best) {
        let maxBottom = L.margin;
        placed.forEach((p) => { maxBottom = Math.max(maxBottom, p.y + p.h); });
        best = { x: L.margin, y: maxBottom + L.gap };
      }
      placed.push({ x: best.x, y: best.y, w, h });
      out.push({ id: n.id, x: best.x, y: best.y });
      lastKey = keyOf(best.x, best.y);
    });
    return out;
  }

  // 为「没有 positionAll」的旧数据分配互不重叠的「全部」位置（已有 positionAll 的保持不动，尊重手工布局）。
  // 优先沿用便签自身的 x,y；若与已分配位置重叠则落到空网格。返回是否有变更。
  function initPositionAll(notes, maxX, opts) {
    const L = optsOf(opts);
    const mX = (typeof maxX === 'number' && maxX > 0) ? maxX : (L.defaultW * 6);
    const accepted = [];
    let changed = false;
    (notes || []).forEach((n) => {
      if (!n || typeof n !== 'object') return;
      const cur = (n.positionAll && typeof n.positionAll.x === 'number') ? n.positionAll : null;
      if (cur) { accepted.push({ x: cur.x, y: cur.y, w: n.w || L.defaultW, h: n.h || L.defaultH }); return; }
      const nw = n.w || L.defaultW;
      const nh = n.h || L.defaultH;
      const home = { x: n.x || 0, y: n.y || 0 };
      const p = overlapsAny(home.x, home.y, nw, nh, accepted, opts)
        ? nextGridPosition(accepted, mX, opts, nw, nh)
        : home;
      n.positionAll = { x: p.x, y: p.y };
      accepted.push({ x: p.x, y: p.y, w: nw, h: nh });
      changed = true;
    });
    return changed;
  }

  // 「优先级」策略被移除（随「一键整理策略」设置删除）：一键整理统一用 compact。
  // 画布缩放值收敛：只接受有限数字，clamp 到 [zoomMin, zoomMax]，并保留两位小数。
  function clampZoom(z) {
    const v = (typeof z === 'number' && isFinite(z)) ? z : 1;
    return Math.max(LAYOUT.zoomMin, Math.min(LAYOUT.zoomMax, Math.round(v * 100) / 100));
  }

  // 按「最近使用」给分组排序：recentIds（最近的在前）命中的分组排到最前，其余保持原相对顺序。
  // 纯函数：输入 groups + recentIds，输出重排后的分组数组（不改动入参）。未命中 recents 时退化为原顺序。
  function orderGroupsByRecent(groups, recentIds) {
    const gs = Array.isArray(groups) ? groups : [];
    const recent = Array.isArray(recentIds) ? recentIds : [];
    const byId = new Map();
    gs.forEach((g) => { if (g && g.id != null) byId.set(g.id, g); });
    const out = [];
    const used = new Set();
    recent.forEach((id) => {
      if (id != null && byId.has(id) && !used.has(id)) { out.push(byId.get(id)); used.add(id); }
    });
    gs.forEach((g) => { if (g && !used.has(g.id)) out.push(g); });
    return out;
  }

  // 两个矩形是否有交集（含边界接触）。a/b: { x, y, w, h }；无交集/缺参返回 false。供「框选」命中检测用。
  function rectsIntersect(a, b) {
    if (!a || !b) return false;
    const ax = a.x || 0, ay = a.y || 0, aw = a.w || 0, ah = a.h || 0;
    const bx = b.x || 0, by = b.y || 0, bw = b.w || 0, bh = b.h || 0;
    return !(bx > ax + aw || bx + bw < ax || by > ay + ah || by + bh < ay);
  }

  // 「标签建议」：根据便签文本 + 最近使用，推荐最可能归属的分组 id（最多 3 个，按相关度排序）。
  // 优先「分组名出现在笔记文本里」（中文也适用子串匹配），其次是最近使用的分组。纯函数、可单测。
  function suggestGroupIds(text, groups, recentIds) {
    const t = String(text || '').toLowerCase();
    const gs = Array.isArray(groups) ? groups : [];
    const recents = Array.isArray(recentIds) ? recentIds : [];
    const ids = [];
    gs.forEach((g) => {
      const name = String((g && g.name) || '').toLowerCase();
      if (name && t.includes(name) && !ids.includes(g.id)) ids.push(g.id);
    });
    recents.forEach((id) => {
      if (id != null && gs.some((g) => g.id === id) && !ids.includes(id)) ids.push(id);
    });
    return ids.slice(0, 3);
  }

  return { LAYOUT, gridCols, overlapsAny, nextGridPosition, arrangeShelf, arrangeCompact, initPositionAll, clampZoom, orderGroupsByRecent, rectsIntersect, suggestGroupIds };
}));
