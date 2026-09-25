/* editors/rich-tools.js
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.richToolsView + 顶层全局。
   —— 本模块的函数通过顶层全局访问其他模块（与 board-layout.js 等同构）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.richToolsView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

function noteFontSize(n) {
  return n.fontSize || state.settings.fontSize || 14;
}

function adjustNoteFontSize(n, delta, apply) {
  const cur = noteFontSize(n);
  const next = Math.min(22, Math.max(11, cur + delta));
  if (next === cur) return;
  n.fontSize = next;
  n.updatedAt = Date.now();
  save();
  if (apply) apply(next);
}

/* ============ 选区捕获 / 恢复（右键菜单、图片插入用） ============ */
function captureSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    savedRange = sel.getRangeAt(0).cloneRange();
    savedSelText = sel.toString();
  } else {
    savedRange = null;
    savedSelText = '';
  }
}

function restoreSelection() {
  if (!savedRange) return false;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(savedRange);
  return true;
}

function clearSavedSelection() {
  savedRange = null;
  savedSelText = '';
  savedNoteId = null;
  savedImageSrc = null;
}

function focusNoteContent(n) {
  let c = document.querySelector('[data-id="' + n.id + '"] .note-content');
  if (!c && docNoteId === n.id) c = document.getElementById('docContent');
  return c;
}

function noteAnchor(n) {
  return document.querySelector('[data-id="' + n.id + '"]') || document.querySelector('.doc-editor') || document.body;
}

/* ============ 加粗 / 高亮 切换 ============ */
function selectionHasHighlight() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  const cn = range.commonAncestorContainer;
  const el = cn && (cn.nodeType === 1 ? cn : cn.parentElement);
  const scope = el && el.closest('.note-content, .dn-content, .doc-content');
  if (!scope) return false;
  const marks = scope.querySelectorAll('mark.hl, span[style*="background"], font[style*="background"]');
  for (const m of marks) {
    if (range.intersectsNode(m) || m.contains(range.startContainer) || m.contains(range.endContainer)) return true;
  }
  return false;
}

function removeHighlightFromSelection() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const cn = range.commonAncestorContainer;
  const el = cn && (cn.nodeType === 1 ? cn : cn.parentElement);
  const scope = el && el.closest('.note-content, .dn-content, .doc-content');
  if (!scope) return;
  const marks = Array.from(scope.querySelectorAll('mark.hl, span[style*="background"], font[style*="background"]'));
  marks.forEach((m) => {
    if (range.intersectsNode(m)) {
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    }
  });
}

function toggleBold(contentEl) {
  if (contentEl) contentEl.focus();
  document.execCommand('bold');
}

/* 对齐光标所在「段落/块」或选区覆盖的多个块（含图片），不使用 execCommand，避免杂散 span 或触发高亮 */
function alignBlock(contentEl, cmd) {
  const map = { justifyLeft: 'left', justifyCenter: 'center', justifyRight: 'right' };
  const value = map[cmd] || 'left';
  if (!contentEl) return;
  contentEl.focus();
  const sel = window.getSelection();

  // 若光标/选区聚焦在某张图片上，则只对齐该图片（独立块）
  const focusedImg = (() => {
    const selImg = contentEl.querySelector('.inline-img.selected');
    if (selImg) return selImg;
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const candidates = [];
    [range.startContainer, range.endContainer, sel.anchorNode, sel.focusNode].forEach((node) => {
      if (node) candidates.push(node);
      if (node && node.nodeType === 1) node.childNodes.forEach((c) => candidates.push(c));
    });
    for (const node of candidates) {
      let el = node && node.nodeType === 1 ? node : (node && node.parentElement);
      if (el && el.classList && el.classList.contains('inline-img')) return el;
      if (el && el.closest) {
        const im = el.closest('.inline-img');
        if (im) return im;
      }
    }
    return null;
  })();
  const alignImg = (im) => {
    // 图片保持 inline-block（随宽度收缩，删除/大小按钮不被拉伸），
    // 用「包裹块」的 text-align 让图片按左/中/右移动，不破坏按钮定位
    im.style.display = '';
    im.style.margin = '';
    const parent = im.parentElement;
    if (!parent) return;
    // 若已处在 note-align 块内，直接对齐该块
    const inBlock = im.closest('.note-align');
    if (inBlock) { inBlock.style.textAlign = value; return; }
    // 否则把图片所在行段包进新的 note-align 块（从上一 <br> 到下一 <br>）
    const wrap = document.createElement('div');
    wrap.className = 'note-align note-align-' + value;
    wrap.style.textAlign = value;
    let startNode = im;
    let prev = im.previousSibling;
    while (prev && !(prev.nodeName === 'BR')) { startNode = prev; prev = prev.previousSibling; }
    let endNode = im;
    let next = im.nextSibling;
    while (next && !(next.nodeName === 'BR')) { endNode = next; next = next.nextSibling; }
    const nodes = [];
    let cur = startNode;
    while (cur) {
      const n = cur;
      nodes.push(n);
      if (n === endNode) break;
      cur = n.nextSibling;
    }
    parent.insertBefore(wrap, startNode);
    nodes.forEach((n) => wrap.appendChild(n));
    wrap.style.textAlign = value;
  };

  if (focusedImg) {
    alignImg(focusedImg);
    if (sel) sel.removeAllRanges();
    return;
  }

  // 收集选区覆盖的块级元素（已有 .note-align div / 内容容器）
  let blocks = [];
  const collect = () => {
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      const candidates = contentEl.querySelectorAll('.note-align, div, p');
      candidates.forEach((bl) => {
        if (bl.closest('.note-align') && bl !== bl.closest('.note-align')) return; // 只取最外层
        if (range.intersectsNode(bl) || bl.contains(range.startContainer) || bl.contains(range.endContainer)) {
          if (!blocks.includes(bl)) blocks.push(bl);
        }
      });
    }
    if (!blocks.length) blocks = [contentEl];
  };
  collect();

  blocks.forEach((bl) => {
    bl.style.textAlign = value;
  });

  // 若无独立块（内容未分块），把全部内容包进一个 note-align 块（避免整篇直接设 text-align 导致序列化时嵌套包裹）
  const onlyContainer = blocks.length === 1 && (blocks[0] === contentEl || /note-content|doc-content|dn-content/.test(blocks[0].className || ''));
  if (onlyContainer && contentEl.childNodes.length) {
    const wrap = document.createElement('div');
    wrap.className = 'note-align note-align-' + value;
    wrap.style.textAlign = value;
    while (contentEl.firstChild) wrap.appendChild(contentEl.firstChild);
    contentEl.appendChild(wrap);
  }

  if (sel) sel.removeAllRanges();
}

function toggleHighlight(contentEl) {
  if (contentEl) contentEl.focus();
  if (selectionHasHighlight()) {
    removeHighlightFromSelection();
    if (contentEl) contentEl.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    document.execCommand('hiliteColor', false, highlightColor());
  }
}

function setHighlightColor(color) {
  state.settings.highlightColor = color;
  const hc = $('#highlightColorInput');
  if (hc) hc.value = color;
  applyTheme();
  save();
}

function applyInlineColor(n, range, color) {
  const contentEl = focusNoteContent(n);
  if (!contentEl || !range) return;
  contentEl.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand('foreColor', false, color);
  n.content = readRichContent(contentEl);
  n.updatedAt = Date.now();
  save();
  renderAll();
}

function getSelectedImageSrc(n) {
  const sel = window.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed) {
    const frag = sel.getRangeAt(0).cloneContents();
    const img = frag.querySelector('.inline-img img');
    if (img) return img.getAttribute('src');
  }
  const el = document.querySelector('[data-id="' + n.id + '"] .inline-img.selected img');
  if (el) return el.getAttribute('src');
  return null;
}

  return { selectionHasHighlight, removeHighlightFromSelection, toggleBold, alignBlock, toggleHighlight, setHighlightColor, applyInlineColor, getSelectedImageSrc, captureSelection, restoreSelection, clearSavedSelection, focusNoteContent, noteAnchor, noteFontSize, adjustNoteFontSize };
}));
