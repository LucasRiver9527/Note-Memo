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
    maxCells: 5000    // 网格扫描上限，防死循环
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

  // 网格式排布（旧版策略，保留作为可选）
  function arrangeGrid(notes, cols, opts) {
    const L = optsOf(opts);
    cols = cols || 1;
    const out = [];
    (notes || []).forEach((n, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      out.push({ id: n.id, x: L.margin + col * L.gridWidth, y: L.margin + row * L.gridHeight });
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

  return { LAYOUT, gridCols, overlapsAny, nextGridPosition, arrangeShelf, arrangeGrid, arrangeCompact, initPositionAll };
}));
