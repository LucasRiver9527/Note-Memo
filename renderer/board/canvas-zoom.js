/* 画布视口缩放与平移。延续工作区模块的 UMD 接口。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.canvasZoomView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

/* ============ 画布缩放 / 平移 ============ */
function boardZoom() {
  return state.settings.boardZoom || 1;
}

// 把 #board 的已算好的未缩放尺寸（dataset.uw/uh）套用当前缩放：width/height *= zoom + transform: scale。
// 缩放作用于 #board（transform-origin:0 0），这样便签的 left/top 仍用未缩放坐标，视觉按 zoom 放大。
function setBoardScaledSize() {
  const board = $('#board');
  if (!board) return;
  const z = boardZoom();
  const uw = parseFloat(board.dataset.uw) || (board.clientWidth + 100);
  const uh = parseFloat(board.dataset.uh) || (board.clientHeight + 100);
  board.style.width = (uw * z) + 'px';
  board.style.height = (uh * z) + 'px';
  board.style.transform = 'scale(' + z + ')';
  board.style.transformOrigin = '0 0';
}

// 页头缩放入口只在便签画布显示。
function syncZoomToolbar() {
  const wrap = $('#canvasToolbar');
  if (!wrap) return;
  const settingsOpen = $('#settingsPanel') && !$('#settingsPanel').classList.contains('hidden');
  const boardView = state.settings.viewMode === 'board';
  const show = boardView && !settingsOpen && !docPickerReturn;
  wrap.classList.toggle('hidden', !show);
  if (!show) wrap.classList.remove('expanded');
  const expanded = wrap.classList.contains('expanded');
  $('#ctGroup').inert = !expanded;
  const ratio = Math.round(boardZoom() * 100) + '%';
  const toggle = $('#ctExpand');
  const action = t(expanded ? 'canvas_zoom_toggle_close' : 'canvas_zoom_toggle');
  $('#zoomLabel').textContent = ratio;
  toggle.title = action;
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-label', action + ' · ' + ratio);
}

// 调整缩放。anchor：{ mode: 'cursor'|'center'|'reset', x, y }。
function applyBoardZoomRatio(newRatio, anchor) {
  const canvas = $('#canvas');
  const board = $('#board');
  if (!canvas || !board) return;
  const oldZ = boardZoom();
  const newZ = clampZoom(newRatio);
  if (newZ === oldZ) return;
  const cRect = canvas.getBoundingClientRect();
  const bRect = board.getBoundingClientRect();
  const anchorObj = anchor || {};
  const useCursor = anchorObj.mode === 'cursor';
  const refScreenX = useCursor ? (anchorObj.x != null ? anchorObj.x : cRect.left + cRect.width / 2) : cRect.left + cRect.width / 2;
  const refScreenY = useCursor ? (anchorObj.y != null ? anchorObj.y : cRect.top + cRect.height / 2) : cRect.top + cRect.height / 2;
  // 参考点（光标/中心）在「未缩放板坐标」上的位置
  const refX = (refScreenX - bRect.left) / oldZ;
  const refY = (refScreenY - bRect.top) / oldZ;
  state.settings.boardZoom = newZ;
  setBoardScaledSize();
  // 让参考点在新缩放下仍落在原屏幕位置：scrollLeft = cRect.left + refX*newZ - refScreenX
  canvas.scrollLeft = Math.max(0, cRect.left + refX * newZ - refScreenX);
  canvas.scrollTop = Math.max(0, cRect.top + refY * newZ - refScreenY);
  syncZoomToolbar();
  scheduleCanvasLinks();
  save();
}

function zoomStep(dir) {
  applyBoardZoomRatio(boardZoom() + dir * LAYOUT.zoomStep, { mode: 'center' });
}

function zoomReset() {
  const canvas = $('#canvas');
  const board = $('#board');
  if (!canvas || !board) return;
  // 以画布中心为参考缩放回 100%
  const cRect = canvas.getBoundingClientRect();
  const bRect = board.getBoundingClientRect();
  const refX = (cRect.left + cRect.width / 2 - bRect.left) / boardZoom();
  const refY = (cRect.top + cRect.height / 2 - bRect.top) / boardZoom();
  const oldZ = boardZoom();
  state.settings.boardZoom = 1;
  setBoardScaledSize();
  canvas.scrollLeft = Math.max(0, cRect.left + refX * 1 - (cRect.left + cRect.width / 2));
  canvas.scrollTop = Math.max(0, cRect.top + refY * 1 - (cRect.top + cRect.height / 2));
  syncZoomToolbar();
  scheduleCanvasLinks();
  save();
}

// 平移画布：通过修改 #canvas 的 scrollLeft/scrollTop 实现。
// 触发：空格+左键或鼠标中键，可从便签区域开始拖动。
function startCanvasPan(e) {
  const canvas = $('#canvas');
  const pointerId = e.pointerId;
  const startX = e.clientX;
  const startY = e.clientY;
  const sl = canvas.scrollLeft;
  const st = canvas.scrollTop;
  canvas.style.cursor = 'grabbing';
  document.body.classList.add('panning');
  canvas.setPointerCapture(pointerId);
  const onMove = (ev) => {
    if (ev.pointerId !== pointerId) return;
    canvas.scrollLeft = Math.max(0, sl - (ev.clientX - startX));
    canvas.scrollTop = Math.max(0, st - (ev.clientY - startY));
  };
  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    window.removeEventListener('blur', onUp);
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    canvas.style.cursor = '';
    document.body.classList.remove('panning');
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
  window.addEventListener('blur', onUp);
}

  return { boardZoom, setBoardScaledSize, syncZoomToolbar, applyBoardZoomRatio, zoomStep, zoomReset, startCanvasPan };
}));
