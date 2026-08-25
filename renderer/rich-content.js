/* 富文本序列化单一来源：DOM -> [[marker]] 序列化。
   历史教训：改序列化协议（[[img]]/[[align]]/高亮等 marker）必须 readRichContent <-> renderRichContent
   双向同步 + 单测，否则会"改一处崩一处"（[[align:left]] 泄漏成文字、[ 累积、✕ 按钮乱飞均因此）。
   - Node: module.exports
   - 浏览器: 挂 root.RichContent + 顶层全局，app.js / note.js 可直接按名字调用 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.RichContent = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 媒体 id 生成：app 窗口用 'n' 前缀、钉桌便签窗口用 'i' 前缀，避免跨窗口 id 冲突
  function uid(prefix) {
    return (prefix || 'n') + Date.now().toString(36) + Math.random().toString(36).slice(2, prefix === 'i' ? 6 : 7);
  }

  // DOM -> [[marker]]：遍历可编辑内容根节点，把图片/文件/表格/对齐/加粗/高亮/颜色还原为标记文本。
  // 与 logic.js 的 renderRichContent（marker -> HTML）互逆，必须保持一致。
  function readRichContent(root) {
    let out = '';
    (root.childNodes || []).forEach((node) => {
      if (node.nodeType === 3) {
        out += node.textContent;
      } else if (node.nodeType === 1) {
        const tag = node.tagName;
        if (node.classList && node.classList.contains('inline-img')) {
          out += '[[img:' + node.getAttribute('data-img-id') + ']]';
        } else if (node.classList && node.classList.contains('file-link')) {
          out += '[[file:' + node.getAttribute('data-file-id') + ']]';
        } else if (node.classList && node.classList.contains('note-table-block')) {
          out += '[[table:' + node.getAttribute('data-table-id') + ']]';
        } else if (tag === 'BR') {
          out += '\n';
        } else if (tag === 'B' || tag === 'STRONG') {
          out += '**' + readRichContent(node) + '**';
        } else if (tag === 'MARK') {
          out += '==' + readRichContent(node) + '==';
        } else if (tag === 'FONT' && node.getAttribute('color')) {
          out += '[[c:' + node.getAttribute('color') + ']]' + readRichContent(node) + '[[/c]]';
        } else if (tag === 'SPAN' && node.style) {
          const bg = node.style.backgroundColor;
          const fw = node.style.fontWeight;
          const color = node.style.color;
          if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
            out += '==' + readRichContent(node) + '==';
          } else if (color && color !== '' && color !== 'inherit') {
            out += '[[c:' + color + ']]' + readRichContent(node) + '[[/c]]';
          } else if (fw === 'bold' || Number(fw) >= 600) {
            out += '**' + readRichContent(node) + '**';
          } else {
            out += readRichContent(node);
          }
        } else if ((tag === 'DIV' || tag === 'P') && node.style && node.style.textAlign && node.style.textAlign !== '' && node.style.textAlign !== 'start') {
          out += '[[align:' + node.style.textAlign + ']]' + readRichContent(node) + '[[/align]]';
        } else {
          out += readRichContent(node);
        }
      }
    });
    if (root && root.style && root.style.textAlign && root.style.textAlign !== '' && root.style.textAlign !== 'start' &&
        /dn-content/.test(root.className || '')) {
      return '[[align:' + root.style.textAlign + ']]' + out + '[[/align]]';
    }
    return out;
  }

  return { uid, readRichContent };
}));
