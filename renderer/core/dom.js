/* DOM 基础工具（L1 · 零依赖）：查询、toast。
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.DomUtil + 顶层全局。
   —— 只放「不依赖任何状态/翻译」的纯 DOM 工具，保证 L1 层无反向依赖。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root['DomUtil'] = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const $ = (sel, rootEl = document) => rootEl.querySelector(sel);
  const $$ = (sel, rootEl = document) => Array.from(rootEl.querySelectorAll(sel));

  // 底部浮层提示，2.2s 自动隐藏（后一条覆盖前一条）
  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), 2200);
  }

  return { $, $$, toast };
}));
