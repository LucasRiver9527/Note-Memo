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
  const batchIds = Array.from(selectedNotes);
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
    const dx = nx - np.x;
    const dy = ny - np.y;
    el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    if (batch) {
      $$('.note').forEach((other) => {
        if (other === el) return;
        const id = other.dataset.id;
        if (!batchStart.has(id)) return;
        other.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      });
    }
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
    canvas.removeEventListener('scroll', updateRect);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    el.classList.remove('dragging');
    document.body.classList.remove('note-dragging');
    isBatchDragging = false;
    n.updatedAt = Date.now();
    save();
    if (batch) renderAll();
    else syncBoardSize();
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
