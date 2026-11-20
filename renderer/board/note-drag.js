/* 卡片拖动与缩放（指针事件）。
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.noteDragView + 顶层全局。
   —— 本模块的函数通过顶层全局访问其他模块（与 board-layout.js 等同构）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.noteDragView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

// 拖动抬升：把被拖动卡片暂时置于所有「未被拖动」的板内卡片之上，返回可恢复的原 inline z 记录。
// 不改 n.z / zCounter（不持久化）；批量时保持被拖动集合内部的原有相对层序：
// 先按各卡片「有效 computed z-index」数值升序，仅当相等时用 DOM 顺序作 tie-break（不能用 style 空值假设 0）。
function raiseDraggedNotes(draggedEls) {
  const board = $('#board');
  if (!board) return [];
  const draggedSet = new Set(draggedEls);
  // 有效 computed z（仅用于排序/取最大值；不改动卡片）。
  const effectiveZ = (x) => {
    const cz = parseInt(getComputedStyle(x).zIndex, 10);
    if (Number.isFinite(cz)) return cz;
    const iz = parseInt(x.style.zIndex, 10);
    return Number.isFinite(iz) ? iz : 0;
  };
  // 未被拖动卡片中的最高有效 z（不假设未设置即 0，取实际 computed）。
  let maxOther = 0;
  $$('.note', board).forEach((x) => {
    if (draggedSet.has(x)) return;
    const v = effectiveZ(x);
    if (v > maxOther) maxOther = v;
  });
  // 被拖动集合排序：有效 z 升序，tie-break 用 DOM 顺序；据此分配连续抬升 z，保持相对层序。
  const orderIndex = new Map();
  $$('.note', board).forEach((x, i) => orderIndex.set(x, i));
  const orderedDragged = draggedEls.slice().sort((a, b) => {
    const za = effectiveZ(a);
    const zb = effectiveZ(b);
    if (za !== zb) return za - zb;
    return (orderIndex.get(a) || 0) - (orderIndex.get(b) || 0);
  });
  const base = maxOther + 1;
  const records = [];
  orderedDragged.forEach((x, i) => {
    // 记录原 inline z 的「值 + 优先级」，恢复时按 setProperty(value, priority) 原样还原（含 !important）。
    records.push({ el: x, prev: x.style.zIndex, had: x.style.zIndex !== '', priority: x.style.getPropertyPriority('z-index') });
    x.style.zIndex = String(base + i);
    x.classList.add('drag-raised');
  });
  return records;
}

// 原样恢复拖动抬升前的 inline z-index（含「原本没有 inline z」与「原有 !important」的情形）并移除标记类。
function restoreRaisedNotes(records) {
  if (!records) return;
  records.forEach((r) => {
    if (!r || !r.el) return;
    if (r.had) r.el.style.setProperty('z-index', r.prev, r.priority || '');
    else r.el.style.removeProperty('z-index');
    r.el.classList.remove('drag-raised');
  });
}

function alignmentForAxis(moving, targets, dx, dy, axis, zoom) {
  const cross = axis === 'x' ? 'y' : 'x';
  const offset = axis === 'x' ? dx : dy;
  const crossOffset = axis === 'x' ? dy : dx;
  const from = moving[cross][0] + crossOffset;
  const to = moving[cross][2] + crossOffset;
  let best = null;
  for (const target of targets) {
    const [start, , end] = target[cross];
    const gap = Math.max(0, start - to, from - end);
    if (gap * zoom > 120) continue;
    for (let i = 0; i < 3; i++) {
      const at = target[axis][i];
      const correction = at - moving[axis][i] - offset;
      const distance = Math.abs(correction);
      if (distance * zoom > 6) continue;
      if (best && (distance > best.distance || (distance === best.distance && gap >= best.gap))) continue;
      best = { correction, distance, gap, at, start, end };
    }
  }
  return best;
}

function makeAlignmentGuides(board, dragged, origin, zoom) {
  const draggedSet = new Set(dragged);
  const bounds = (node) => {
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const left = (rect.left - origin.left) / zoom;
    const top = (rect.top - origin.top) / zoom;
    const width = rect.width / zoom;
    const height = rect.height / zoom;
    return { x: [left, left + width / 2, left + width], y: [top, top + height / 2, top + height] };
  };
  const group = dragged.map(bounds).filter(Boolean);
  const groupAxis = (axis) => {
    const start = Math.min(...group.map((r) => r[axis][0]));
    const end = Math.max(...group.map((r) => r[axis][2]));
    return [start, (start + end) / 2, end];
  };
  const moving = { x: groupAxis('x'), y: groupAxis('y') };
  const targets = Array.from(board.querySelectorAll('.note')).filter((node) => !draggedSet.has(node)).map(bounds).filter(Boolean);

  const lines = ['x', 'y'].map((axis) => {
    const line = document.createElement('div');
    line.className = 'note-align-guide';
    line.dataset.axis = axis;
    line.hidden = true;
    board.appendChild(line);
    return line;
  });

  const draw = (line, match, from, to, vertical) => {
    line.hidden = !match;
    if (!match) return;
    const start = to < match.start ? to : match.end < from ? match.end : Math.max(from, match.start);
    const end = to < match.start ? match.start : match.end < from ? from : Math.min(to, match.end);
    const length = Math.max(10 / zoom, end - start);
    const thickness = 1 / zoom;
    Object.assign(line.style, {
      left: (vertical ? match.at : start) + 'px',
      top: (vertical ? start : match.at) + 'px',
      width: (vertical ? thickness : length) + 'px',
      height: (vertical ? length : thickness) + 'px'
    });
  };

  return {
    apply(dx, dy, free, minDx, minDy) {
      let x = free ? null : alignmentForAxis(moving, targets, dx, dy, 'x', zoom);
      let y = free ? null : alignmentForAxis(moving, targets, dx, dy, 'y', zoom);
      if (x && dx + x.correction < minDx) x = null;
      if (y && dy + y.correction < minDy) y = null;
      const nextX = dx + (x?.correction || 0);
      const nextY = dy + (y?.correction || 0);
      draw(lines[0], x, moving.y[0] + nextY, moving.y[2] + nextY, true);
      draw(lines[1], y, moving.x[0] + nextX, moving.x[2] + nextX, false);
      return [nextX, nextY];
    },
    remove() { lines.forEach((line) => line.remove()); }
  };
}

function startDrag(el, n, e) {
  // 延迟提交：按下时只暂存前置快照；松开时若真的产生位移才入栈（点击不动 → 无历史项）
  beginUndo();
  const board = $('#board');
  const canvas = $('#canvas');
  let rect = board.getBoundingClientRect();
  const z = (typeof boardZoom === 'function') ? boardZoom() : 1;
  const npos = effPos(n);
  const offsetX = (e.clientX - rect.left) / z - npos.x;
  const offsetY = (e.clientY - rect.top) / z - npos.y;

  // 批量模式：拖动任意已选便签，其余选中便签同步移动
  const batch = multiSelect && selectedNotes.has(n.id);

  isBatchDragging = batch;
  const batchStart = new Map();
  if (batch) {
    state.notes.forEach((nn) => {
      if (selectedNotes.has(nn.id)) { const p = effPos(nn); batchStart.set(nn.id, { x: p.x, y: p.y }); }
    });
  }

  el.classList.add('dragging');
  document.body.classList.add('note-dragging');
  el.style.transform = 'translate3d(0,0,0)';

  // UX：拖动期间把被拖动的卡片暂时抬到所有「未被拖动」的板内卡片之上。
  // 仅改 inline z-index（不改 n.z/zCounter，不持久化），并记录原值以便原样恢复。
  // 批量时所有可见选中卡片一起抬升，保持它们原有的相对层级顺序（含 DOM 顺序 tie-break）。
  const draggedEls = batch
    ? $$('.note').filter((x) => selectedNotes.has(x.dataset.id))
    : [el];
  if (!draggedEls.includes(el)) draggedEls.unshift(el);
  const raised = raiseDraggedNotes(draggedEls);
  const guides = makeAlignmentGuides(board, draggedEls, rect, z);
  const minDx = -Math.min(npos.x, ...Array.from(batchStart.values(), (pos) => pos.x));
  const minDy = -Math.min(npos.y, ...Array.from(batchStart.values(), (pos) => pos.y));

  const updateRect = () => { rect = board.getBoundingClientRect(); };
  canvas.addEventListener('scroll', updateRect, { passive: true });

  let rafId = null;
  let lastEv = null;
  const applyMove = () => {
    rafId = null;
    if (!lastEv) return;
    const ev = lastEv;
    lastEv = null;
    const nx = Math.max(0, Math.round((ev.clientX - rect.left) / z - offsetX));
    const ny = Math.max(0, Math.round((ev.clientY - rect.top) / z - offsetY));
    const np = effPos(n);
    const rawX = Math.max(minDx, nx - np.x);
    const rawY = Math.max(minDy, ny - np.y);
    const [dx, dy] = guides.apply(rawX, rawY, ev.altKey || (!rawX && !rawY), minDx, minDy);
    el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    if (batch) {
      $$('.note').forEach((other) => {
        if (other === el) return;
        const id = other.dataset.id;
        if (!batchStart.has(id)) return;
        other.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      });
    }
    scheduleCanvasLinks();
  };
  const onMove = (ev) => {
    lastEv = ev;
    if (rafId == null) rafId = requestAnimationFrame(applyMove);
  };
  const onUp = () => {
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    if (lastEv) applyMove();
    const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(el.style.transform || '');
    let dx = 0, dy = 0;
    if (m) {
      dx = Math.round(parseFloat(m[1]));
      dy = Math.round(parseFloat(m[2]));
      const np = effPos(n);
      setEffPos(n, Math.max(0, Math.round(np.x + dx)), Math.max(0, Math.round(np.y + dy)));
    }
    // 无位移（纯点击）：丢弃暂存快照，不留无用历史项
    if (!dx && !dy) cancelUndo(); else commitUndo();
    // 批量：更新其余选中便签坐标
    if (batch && (dx || dy)) {
      state.notes.forEach((nn) => {
        if (!batchStart.has(nn.id)) return;
        const p0 = batchStart.get(nn.id);
        setEffPos(nn, Math.max(0, Math.round(p0.x + dx)), Math.max(0, Math.round(p0.y + dy)));
      });
      save();
    }
    el.style.transform = '';
    const fp = effPos(n);
    el.style.left = fp.x + 'px';
    el.style.top = fp.y + 'px';
    el.__snap = noteFingerprint(n);
    $$('.note.dragging').forEach((x) => { x.style.transform = ''; x.classList.remove('dragging'); });
    if (batch) {
      $$('.note').forEach((other) => {
        const id = other.dataset.id;
        const nn = state.notes.find((x) => x.id === id);
        if (nn && selectedNotes.has(id)) {
          const p = effPos(nn);
          // 必须清掉拖拽期间的 translate3d，否则新 left/top + 残留 transform 会造成「双重偏移/弹开」
          other.style.transform = '';
          other.style.left = p.x + 'px';
          other.style.top = p.y + 'px';
          other.__snap = noteFingerprint(nn);
        }
      });
    }
    guides.remove();
    canvas.removeEventListener('scroll', updateRect);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    el.classList.remove('dragging');
    document.body.classList.remove('note-dragging');
    isBatchDragging = false;
    // 恢复被临时抬升卡片的原始 inline z-index（原样、按原值恢复），并清掉拖拽标记类
    restoreRaisedNotes(raised);
    n.updatedAt = Date.now();
    save();
    if (batch) renderAll();
    else syncBoardSize();
    scheduleCanvasLinks();
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

function startResize(el, n, e) {
  // 延迟提交：按下时只暂存前置快照；松开时若尺寸真的变化才入栈
  beginUndo();
  const startX = e.clientX;
  const startY = e.clientY;
  const z = (typeof boardZoom === 'function') ? boardZoom() : 1;
  const origW = n.w || LAYOUT.defaultW;
  const origH = n.h || LAYOUT.defaultH;
  // 注意：onMove 起点就用 orig 赋值，故需单独记录是否发生过有效 move
  let changed = false;
  const onMove = (ev) => {
    const w = Math.max(LAYOUT.defaultW, origW + (ev.clientX - startX) / z);
    const h = Math.max(140, origH + (ev.clientY - startY) / z);
    if (w !== n.w || h !== n.h) changed = true;
    n.w = w;
    n.h = h;
    el.style.width = n.w + 'px';
    el.style.height = n.h + 'px';
    scheduleCanvasLinks();
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (!changed) { cancelUndo(); return; }   // 尺寸未变：不留无用历史项
    commitUndo();
    n.updatedAt = Date.now();
    el.__snap = noteFingerprint(n);
    save();
    syncBoardSize();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

  return { startDrag, startResize };
}));
