/* editors/doc-view.js
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.docView + 顶层全局。
   —— 本模块的函数通过顶层全局访问其他模块（与 board-layout.js 等同构）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.docView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

/* ============ V128-01E3：文档选择区自动前景色（玻璃/半透明合成背景对比度） ============ */
// 解析 #rgb / #rrggbb；非法返回 null（安全回退，不抛异常）。
function pickerHexToRgb(hex) {
  let h = String(hex == null ? '' : hex).trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function pickerRgbToHex(rgb) {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

/* ---- V128-01E3B：背景图代表色采样（有界、单张、按 URL 缓存，仅用于选择区可读性） ---- */
// 仅保留「当前 URL」的一次采样结果；透明像素按 alpha 预乘均值缓存，读取时再与画布/bgOpacity 合成，无需重载。
const __pickerBackdrop = { url: null, status: 'idle', gen: 0, sample: null, img: null };
const PICKER_PROTECT_WHITE = '0 1px 2px rgba(0,0,0,.38), 0 0 1px rgba(0,0,0,.22)';
const PICKER_PROTECT_DARK = '0 1px 1px rgba(255,255,255,.4)';

function pickerBackdropDisabled() {
  return !state.settings.backgroundImage || state.settings.backgroundReadability === false;
}

// 释放当前图像回调（取消尚未触发的 onload/onerror），避免陈旧回调影响新 URL 的 UI。
function pickerReleaseImg() {
  const prev = __pickerBackdrop.img;
  if (prev) { try { prev.onload = null; prev.onerror = null; } catch (_) {} __pickerBackdrop.img = null; }
}

// 代表色采样（一次 16×16，最大 256 像素）：仅在背景图存在且可读性开启时进行；同 URL 只加载一次，失败也缓存不重试。
function ensurePickerBackdropSample() {
  const url = state.settings.backgroundImage;
  if (pickerBackdropDisabled()) {
    if (__pickerBackdrop.url !== null || __pickerBackdrop.status !== 'idle') {
      __pickerBackdrop.gen++;
      pickerReleaseImg();
      __pickerBackdrop.url = null;
      __pickerBackdrop.status = 'idle';
      __pickerBackdrop.sample = null;
    }
    return;
  }
  if (__pickerBackdrop.url === url && __pickerBackdrop.status !== 'idle') return; // ready/loading/failed 均按 URL 缓存
  __pickerBackdrop.gen++;
  const gen = __pickerBackdrop.gen;
  pickerReleaseImg(); // URL 已切换：取消上一张
  __pickerBackdrop.url = url;
  __pickerBackdrop.status = 'loading';
  __pickerBackdrop.sample = null;
  let img;
  try { img = new Image(); } catch (_) { __pickerBackdrop.status = 'failed'; return; }
  __pickerBackdrop.img = img;
  const release = () => { try { img.onload = null; img.onerror = null; } catch (_) {} if (__pickerBackdrop.img === img) __pickerBackdrop.img = null; };
  img.onload = () => {
    if (gen !== __pickerBackdrop.gen) { release(); return; } // 陈旧回调：不刷新当前 UI
    try {
      const size = 16;
      const cv = document.createElement('canvas');
      cv.width = size; cv.height = size;
      const c2 = cv.getContext('2d');
      c2.drawImage(img, 0, 0, size, size);
      const data = c2.getImageData(0, 0, size, size).data;
      let r = 0, g = 0, b = 0, a = 0;
      const n = size * size;
      for (let i = 0; i < data.length; i += 4) {
        const al = data[i + 3] / 255;
        r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al; a += al;
      }
      __pickerBackdrop.sample = { rgb: [r / n, g / n, b / n], a: a / n };
      __pickerBackdrop.status = 'ready';
    } catch (_) {
      __pickerBackdrop.sample = null;
      __pickerBackdrop.status = 'failed'; // CORS/读取失败：安全回退，缓存不重试
    }
    release();
    refreshDocPickerForeground();
  };
  img.onerror = () => {
    if (gen !== __pickerBackdrop.gen) { release(); return; } // 陈旧回调：不刷新当前 UI
    __pickerBackdrop.sample = null;
    __pickerBackdrop.status = 'failed';
    release();
    refreshDocPickerForeground();
  };
  try { img.src = url; } catch (_) { if (gen === __pickerBackdrop.gen) __pickerBackdrop.status = 'failed'; release(); }
}

// 有效背景代表色：采样就绪时按 bgOpacity 合成图色与画布底色；否则退回画布底色。
function pickerBackdropRgb() {
  const base = pickerHexToRgb(currentBg()) || [255, 255, 255];
  const s = __pickerBackdrop;
  if (s.status !== 'ready' || !s.sample) return base;
  const rawOp = state.settings.bgOpacity;
  const num = (rawOp == null || rawOp === '') ? 100 : Number(rawOp);
  const safe = Number.isFinite(num) ? num : 100;
  const bgOp = Math.max(0, Math.min(1, Number((safe / 100).toFixed(2))));
  const sm = s.sample;
  return base.map((b, i) => b * (1 - bgOp * sm.a) + bgOp * sm.rgb[i]);
}

// 标题/提示自动前景（无 note 底色叠加）；显式全局文字色优先。
function pickerBackdropForeground() {
  const explicit = state.settings.noteTextColor;
  if (explicit) return sanitizeCss(explicit);
  const hex = pickerRgbToHex(pickerBackdropRgb());
  return contrastRatio('#ffffff', hex) >= contrastRatio('#2d2f38', hex) ? '#ffffff' : '#2d2f38';
}

// 一次渲染上下文：合成背景（含采样图色）、玻璃开关、实际 noteOpacity（有限值夹取，null/缺失按 100）、玻璃底色混合比例。
function pickerRenderContext() {
  const rawVal = state.settings.noteOpacity;
  const num = (rawVal == null || rawVal === '') ? 100 : Number(rawVal);
  const safe = Number.isFinite(num) ? num : 100;
  // 与实际渲染一致：applyTheme 用 (s.noteOpacity / 100).toFixed(2) 写入 --note-opacity；这里同样保留 2 位小数（合法 0 仍为 0）。
  const op = Math.max(0, Math.min(1, Number((safe / 100).toFixed(2))));
  return {
    glass: !!state.settings.glass,
    base: pickerBackdropRgb(),
    op,
    tint: 0.46,
    // E3A 浅色壁纸保守回退：壁纸存在 + 浅色主题，且（可读性关闭 或 图像尚不可用/失败）时沿用旧 autoTextColor；
    // 采样就绪后改用代表色估算。
    preserveWallpaperForeground: !!state.settings.backgroundImage && isLightTheme() && (pickerBackdropDisabled() || __pickerBackdrop.status !== 'ready'),
    // V128-01E3B2：壁纸可读性就绪（图存在 + 可读性开启 + 采样就绪且为当前 URL）——用于中间前景色与自动元信息类。
    wallpaperReady: !!state.settings.backgroundImage && state.settings.backgroundReadability !== false && __pickerBackdrop.status === 'ready' && __pickerBackdrop.url === state.settings.backgroundImage,
  };
}
// 自动前景：非玻璃不透明保持旧 autoTextColor；浅色主题 + 自定义背景图沿用旧 autoTextColor（保守）；
// 玻璃用 0.46 底色混合，非玻璃半透明用 tint=1。
// 前景自身也受整卡 opacity（归档固定 0.5）影响，按合成后再比较，在既有候选（白 / #2d2f38）中取真实对比度更优者。
function pickerAutoForeground(n, colorCss, ctx) {
  if (!ctx.glass && ctx.op >= 1) return autoTextColor(n.color); // 非玻璃不透明：保留既有行为
  // 浅色主题叠加自定义背景图时，实际像素可能是任意深色；图像内容不可知时，沿用原 autoTextColor 是更保守的选择。
  if (ctx.preserveWallpaperForeground) return autoTextColor(n.color);
  const note = pickerHexToRgb(colorCss);
  if (!note) return autoTextColor(n.color); // 非法/意外颜色安全回退
  const tint = ctx.glass ? ctx.tint : 1;
  // CSS `.doc-pick-item.archived { opacity: 0.5 }` 会覆盖基础 opacity（并非相乘），故归档卡直接取 0.5。
  const effOp = n.archived ? 0.5 : ctx.op;
  const bg = ctx.base.map((b, i) => effOp * (tint * note[i] + (1 - tint) * b) + (1 - effOp) * b);
  const bgHex = pickerRgbToHex(bg);
  const blend = (cand) => {
    const cc = pickerHexToRgb(cand);
    return pickerRgbToHex(cc.map((v, i) => effOp * v + (1 - effOp) * ctx.base[i]));
  };
  const cw = contrastRatio(blend('#ffffff'), bgHex);
  const cd = contrastRatio(blend('#2d2f38'), bgHex);
  let best = cw >= cd ? '#ffffff' : '#2d2f38';
  let bestR = Math.max(cw, cd);
  // V128-01E3B2：壁纸就绪且自动色时，若当前最佳对比 < 4.5，尝试更深的 #17191f（同样按有效 opacity 合成），仅严格更优才采用。
  if (ctx.wallpaperReady && bestR < 4.5) {
    const c171 = contrastRatio(blend('#17191f'), bgHex);
    if (c171 > bestR) { best = '#17191f'; bestR = c171; }
  }
  return best;
}
// 选择区前景：显式 n.textColor > 全局 noteTextColor > 自动；返回已 sanitize 的颜色。
function pickerForegroundFor(n, ctx) {
  const c = sanitizeCss(n.color);
  const explicitTc = n.textColor || state.settings.noteTextColor;
  return sanitizeCss(explicitTc ? explicitTc : pickerAutoForeground(n, c, ctx));
}
// 标题/提示：壁纸可读性开启且无显式全局文字色时按代表色自动前景（无 note 底色叠加）；否则清除 color/shadow 覆盖，恢复 CSS 继承。
function refreshDocPickerHeader() {
  const list = $('#docList');
  if (!list) return;
  const targets = [$('.doc-picker-head h3', list), $('.sp-hint', list)];
  const clear = () => targets.forEach((el) => { if (el) { el.style.color = ''; el.style.textShadow = ''; } });
  const wallpaper = !!state.settings.backgroundImage;
  const readability = state.settings.backgroundReadability !== false;
  const explicit = !!state.settings.noteTextColor;
  if (!wallpaper || !readability || explicit) { clear(); return; }
  const col = pickerBackdropForeground();
  const shadow = col === '#ffffff' ? '0 1px 2px rgba(0,0,0,.45)' : '0 1px 1px rgba(255,255,255,.45)';
  targets.forEach((el) => { if (el) { el.style.color = col; el.style.textShadow = shadow; } });
}

// 仅刷新「已存在」的选择区卡片/标题前景与文字边缘保护：不重建列表/编辑器、不保存、不设计时器/观察器，保留元素与焦点。
function refreshDocPickerForeground() {
  const list = $('#docList');
  if (!list) return;
  const items = $$('.doc-pick-item', list);
  if (!items.length) return;
  ensurePickerBackdropSample();
  const ctx = pickerRenderContext();
  const byId = new Map(state.notes.map((n) => [n.id, n])); // 一次建表，避免逐项 find 的二次复杂度
  const protectOn = !!state.settings.backgroundImage && state.settings.backgroundReadability !== false;
  items.forEach((el) => {
    const n = byId.get(el.dataset.id);
    if (!n) return;
    const explicit = !!(n.textColor || state.settings.noteTextColor);
    const tc = pickerForegroundFor(n, ctx);
    el.style.color = tc;
    if (protectOn && !explicit) el.style.setProperty('--doc-protect', tc === '#ffffff' ? PICKER_PROTECT_WHITE : PICKER_PROTECT_DARK);
    else el.style.removeProperty('--doc-protect'); // 显式颜色/非壁纸：不附加自动投影
    // V128-01E3B2：壁纸就绪的自动色卡片提升元信息/高亮可读性；显式/未就绪/无图移除该类。
    el.classList.toggle('doc-auto-wallpaper', ctx.wallpaperReady && !explicit);
  });
  refreshDocPickerHeader();
}


function renderDocView(visible) {
  const list = $('#docList');
  if (!list) return;
  if (!docNoteId) {
    // V128-01E3: 选择区在玻璃/半透明下的自动前景按合成背景对比度选取；显式颜色优先级不变。
    const pickerCtx = pickerRenderContext();
    const items = getSortedNotes(visible).map((n) => {
      const c = sanitizeCss(n.color);
      const tc = pickerForegroundFor(n, pickerCtx);
      return `
      <div class="doc-pick-item${n.archived ? ' archived' : ''}" data-id="${escapeHtml(n.id)}" style="--note-color:${c};background:${c || 'transparent'};color:${sanitizeCss(tc)}">
        <div class="dp-info">
          <div class="dp-title">${escapeHtml(n.title || t('untitled'))}</div>
          <div class="dp-sub">${escapeHtml((noteText(n) || '').slice(0, 80))}</div>
        </div>
        <span class="dp-arrow">→</span>
      </div>`;
    }).join('');
    list.innerHTML = `<div class="doc-picker-head"><h3>${t('doc_view')}</h3></div>
      <p class="sp-hint">${t('doc_pick_hint')}</p>
      <div class="doc-picker">${items}</div>`;
    const picker = $('.doc-picker', list);
    $$('.doc-pick-item', list).forEach((it) => {
      it.onclick = () => { docNoteId = it.dataset.id; renderAll(); };
      // 文档选择列表支持拖拽自定义排序（同备忘录，会切换到「自定义顺序」并保存）。
      // 用指针事件而非原生 HTML5 DnD，拖拽时仍可滚动画布滚轮，可边拖边滚。
      it.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (state.settings.sortMode !== 'custom') { ensureOrder(); state.settings.sortMode = 'custom'; }
        startPointerReorder(it.dataset.id, {
          container: picker,
          itemSel: '.doc-pick-item',
          gapFn: (clientY) => computeListGap(picker, '.doc-pick-item', clientY),
          commit: (gap) => placeMemoAtGap(picker, '.doc-pick-item', it.dataset.id, gap),
          threshold: 5,
        }, e);
      });
      // V128-01D3：仅在查询非空时构建搜索解释；按钮阻断拖拽/排序/打开事件。
      const note = state.notes.find((x) => x.id === it.dataset.id);
      const info = $('.dp-info', it);
      if (note && info && filter.query.trim()) {
        // TODO 无需脱离富文本渲染；仅非 TODO 才构建脱离 .note-content（避免查询为空时对每张卡都做富文本渲染）。
        const content = note.type === 'todo' ? null : docPickerContent(note);
        const target = docSearchTarget(note, content);
        if (target) {
          const nodes = buildDocSearchNodes(target);
          nodes.addEventListener('click', (e) => e.stopPropagation());
          ['pointerdown', 'mousedown', 'contextmenu'].forEach((name) => nodes.addEventListener(name, (e) => e.stopPropagation()));
          const btn = $('.doc-search-locate', nodes);
          if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); locateDocSearch(note.id); });
          info.appendChild(nodes);
          // 有安全摘要时隐藏原始 .dp-sub，避免重复与原始 Markdown 泄漏；清除搜索后 renderAll 重建即恢复。
          const sub = $('.dp-sub', info);
          if (sub) sub.style.display = 'none';
        }
      }
    });
    // V128-01E3B：首帧同步设置卡片/标题自动前景与文字边缘保护，并（在壁纸模式）触发一次代表色采样。
    refreshDocPickerForeground();
    return;
  }
  const n = state.notes.find((x) => x.id === docNoteId);
  if (!n) { docNoteId = null; renderAll(); return; }
  const isTodo = n.type === 'todo';
  const textColor = n.textColor || state.settings.noteTextColor || autoTextColor(n.color);
  const todoHtml = isTodo
    ? `<ul class="todo-list" style="margin-top:12px">${(n.items || []).map((it) => `<li class="todo-item ${it.done ? 'done' : ''}" data-item-id="${escapeHtml(it.id)}"><span style="font-size:16px">${it.done ? '☑' : '☐'}</span><span style="margin-left:8px;${it.done ? 'text-decoration:line-through;opacity:.5' : ''}">${escapeHtml(it.text || t('empty_item'))}</span></li>`).join('')}</ul>`
    : '';
  list.innerHTML = `
    <div class="doc-toolbar" style="--note-color:${sanitizeCss(n.color)};color:${sanitizeCss(textColor)}">
      <div class="doc-group doc-group-nav" role="group" aria-label="${t('doc_group_nav')}">
        <button class="doc-back" id="btnDocBack">${t('doc_back')}</button>
        ${!isTodo ? `<button class="doc-fmt-btn doc-preview-btn" id="btnDocPreview" title="${t(n.preview ? 'note_preview_off' : 'note_preview')}" aria-label="${t(n.preview ? 'note_preview_off' : 'note_preview')}" aria-pressed="${n.preview ? 'true' : 'false'}">👁<span class="doc-btn-label">${t(n.preview ? 'note_preview_off' : 'note_preview')}</span></button>` : ''}
      </div>
      ${!isTodo ? `<div class="doc-group doc-group-format" role="group" aria-label="${t('doc_group_format')}">
        <button class="doc-fmt-btn" id="btnDocBold" title="${t('bold')}"><b>B</b></button>
        <button class="doc-fmt-btn" id="btnDocHighlight" title="${t('highlight')}">🖍</button>
        <input type="color" id="btnDocHlColor" class="doc-hl-color" title="${t('highlight_color')}" value="${sanitizeCss(highlightColor())}" />
        <span class="doc-tb-sep"></span>
        <button class="doc-fmt-btn" id="btnDocAlignLeft" title="${t('align_left')}">⇤</button>
        <button class="doc-fmt-btn" id="btnDocAlignCenter" title="${t('align_center')}">⇹</button>
        <button class="doc-fmt-btn" id="btnDocAlignRight" title="${t('align_right')}">⇥</button>
      </div>` : ''}
      <div class="doc-group doc-group-insert" role="group" aria-label="${t('doc_group_insert')}">
        <button class="doc-fmt-btn" id="btnDocImage" title="${t('insert_image')}">🖼️</button>
        <button class="doc-fmt-btn" id="btnDocTable" title="${t('insert_table')}">▦</button>
      </div>
      <div class="doc-group doc-group-manage" role="group" aria-label="${t('doc_group_manage')}">
        <button class="doc-fmt-btn" id="btnDocDesktop" title="${t('desktop')}">📌</button>
        <button class="doc-fmt-btn" id="btnDocTodo" title="${t('todo_mode')}">☑</button>
        <button class="doc-fmt-btn" id="btnDocGroup" title="${t('add_to_group')}">🏷</button>
        <button class="doc-fmt-btn" id="btnDocRemind" title="${t('todo_remind')}">⏰</button>
        <button class="doc-fmt-btn" id="btnDocColor" title="${t('color')}">🎨</button>
        <button class="doc-fmt-btn" id="btnDocPin" title="${t('pin')}">🔝</button>
      </div>
      <div class="doc-group doc-group-export" role="group" aria-label="${t('doc_group_export')}">
        <button class="doc-fmt-btn doc-export-btn" id="btnDocExportMd" title="${t('export_markdown')}" aria-label="${t('export_markdown')}">MD↓</button>
      </div>
      <div class="doc-group doc-group-danger" role="group" aria-label="${t('delete')}">
        <button class="doc-fmt-btn doc-del-btn" id="btnDocDel" title="${t('delete')}" aria-label="${t('delete')}">🗑</button>
      </div>
      <span class="doc-hint">${t('doc_hint')}</span>
    </div>
    <div class="doc-editor ${isDarkColor(textColor) ? '' : 'note-text-light'}" style="--note-color:${sanitizeCss(n.color)};${(n.fontSize && isCssNumber(n.fontSize)) ? '--note-font-size:' + clampNum(n.fontSize, 0, 0, 999) + 'px;' : ''}color:${sanitizeCss(textColor)}">
      <input id="docTitle" class="doc-title-input" value="${escapeHtml(n.title || '')}" placeholder="${t('note_title')}" />
      ${isTodo ? todoHtml : `<div id="docContent" class="doc-content${n.preview ? ' note-preview' : ''}" contenteditable="${n.preview ? 'false' : 'true'}" spellcheck="false" data-placeholder="${t('note_content')}">${renderRichCached(n)}</div>`}
    </div>`;
  wireDocView(n, isTodo);
}

function wireDocView(n, isTodo) {
  const title = $('#docTitle');
  if (!title) return;
  title.addEventListener('input', () => { n.title = title.value; n.updatedAt = Date.now(); save(); refreshDocSearch(n); });
  // V128-01D3：打开文档时插入紧凑搜索解释（查询为空则不出现）。
  refreshDocSearch(n);
  const back = $('#btnDocBack');
  if (back) back.onclick = () => { docNoteId = null; renderAll(); };

  // 便签右上角功能按钮（文档模式）
  const pinBtn = $('#btnDocPin');
  if (pinBtn) pinBtn.onclick = () => { pushUndo(); n.pinned = !n.pinned; n.updatedAt = Date.now(); save(); renderAll(); };
  const todoBtn = $('#btnDocTodo');
  if (todoBtn) todoBtn.onclick = () => {
    pushUndo();
    if (n.type !== 'todo') {
      n.type = 'todo';
      n.items = n.items || [];
      if (n.content) { n.items.push({ id: uid(), text: n.content, done: false }); n.content = ''; }
    } else {
      n.type = 'note';
    }
    n.updatedAt = Date.now();
    save();
    renderAll();
  };
  const groupBtn = $('#btnDocGroup');
  if (groupBtn) groupBtn.onclick = () => {
    if (n.groupId) { n.groupId = null; n.updatedAt = Date.now(); save(); renderAll(); }
    else openGroupPop(noteAnchor(n), n);
  };
  const desktopBtn = $('#btnDocDesktop');
  if (desktopBtn) desktopBtn.onclick = () => pinNoteToDesktop(n);
  const imageBtn = $('#btnDocImage');
  if (imageBtn) imageBtn.onclick = async () => { const r = await window.api.pickNoteImage(); if (r.ok) insertImageByUrl(n, r.url); };
  const tableBtn = $('#btnDocTable');
  if (tableBtn) tableBtn.onclick = () => openTableInsertDialog(n);
  const remindBtn = $('#btnDocRemind');
  if (remindBtn) remindBtn.onclick = () => openReminder(n);
  const colorBtn = $('#btnDocColor');
  if (colorBtn) colorBtn.onclick = () => openColorPop(noteAnchor(n), n);
  const delBtn = $('#btnDocDel');
  if (delBtn) delBtn.onclick = () => deleteNote(n.id);
  const exportBtn = $('#btnDocExportMd');
  if (exportBtn) exportBtn.onclick = () => exportNoteAsMarkdown(n);
  const previewBtn = $('#btnDocPreview');
  if (previewBtn) previewBtn.onclick = () => {
    // renderAll 会重建工具栏：若用户是通过键盘/焦点激活预览，重建后把焦点还给新的预览按钮，
    // 这样可以继续用 Enter/Space 切换；无焦点的程序化重渲染不受影响（不抢焦点）。
    const hadFocus = document.activeElement === previewBtn;
    n.preview = !n.preview;
    n.updatedAt = Date.now();
    save();
    renderAll();
    if (hadFocus) {
      const next = $('#btnDocPreview');
      if (next) next.focus();
    }
  };

  if (isTodo) return;
  const content = $('#docContent');
  const boldBtn = $('#btnDocBold');
  const hlBtn = $('#btnDocHighlight');
  if (!content) return;
  if (n.preview) {
    // 预览：只保留链接/文件打开 与 右键菜单（退出预览），不挂编辑相关处理器
    content.addEventListener('contextmenu', (e) => { if (e.target.closest('button, input')) return; showNoteContextMenu(e, n); });
    content.addEventListener('click', (e) => {
      const link = e.target.closest('a.note-link');
      if (link) { const url = link.getAttribute('data-url'); if (url) window.api.openExternal(url); return; }
      const fl = e.target.closest('.file-link');
      if (fl) { e.stopPropagation(); window.api.openFilePath(fl.getAttribute('data-path'), fl.getAttribute('data-is-dir') === '1'); }
    });
    return;
  }
  if (boldBtn) boldBtn.onclick = () => { content.focus(); if (savedRange && savedNoteId === n.id) restoreSelection(); toggleBold(content); };
  if (hlBtn) hlBtn.onclick = () => { content.focus(); if (savedRange && savedNoteId === n.id) restoreSelection(); toggleHighlight(content); };
  const setAlign = (cmd) => {
    content.focus();
    if (savedRange && savedNoteId === n.id) restoreSelection();
    alignBlock(content, cmd);
    n.content = readRichContent(content);
    n.updatedAt = Date.now();
    save();
  };
  const alignLeftBtn = $('#btnDocAlignLeft');
  const alignCenterBtn = $('#btnDocAlignCenter');
  const alignRightBtn = $('#btnDocAlignRight');
  if (alignLeftBtn) alignLeftBtn.onclick = () => setAlign('justifyLeft');
  if (alignCenterBtn) alignCenterBtn.onclick = () => setAlign('justifyCenter');
  if (alignRightBtn) alignRightBtn.onclick = () => setAlign('justifyRight');
  const updateAlignState = () => {
    const state = { justifyLeft: false, justifyCenter: false, justifyRight: false };
    ['justifyLeft', 'justifyCenter', 'justifyRight'].forEach((c) => { try { state[c] = document.queryCommandState(c); } catch (_) {} });
    if (alignLeftBtn) alignLeftBtn.classList.toggle('align-active', state.justifyLeft);
    if (alignCenterBtn) alignCenterBtn.classList.toggle('align-active', state.justifyCenter);
    if (alignRightBtn) alignRightBtn.classList.toggle('align-active', state.justifyRight);
  };
  content.addEventListener('keyup', updateAlignState);
  content.addEventListener('mouseup', updateAlignState);
  content.addEventListener('input', updateAlignState);
  updateAlignState();
  const hlColor = $('#btnDocHlColor');
  if (hlColor) hlColor.addEventListener('input', (e) => setHighlightColor(e.target.value));

  content.addEventListener('contextmenu', (e) => {
    if (e.target.closest('button, input')) return;
    showNoteContextMenu(e, n);
  });

  content.addEventListener('click', (e) => {
    const link = e.target.closest('a.note-link');
    if (link) { const url = link.getAttribute('data-url'); if (url) window.api.openExternal(url); return; }
    const fl = e.target.closest('.file-link');
    if (fl) { e.stopPropagation(); window.api.openFilePath(fl.getAttribute('data-path'), fl.getAttribute('data-is-dir') === '1'); }
  });
  content.addEventListener('input', () => { n.content = readRichContent(content); n.updatedAt = Date.now(); save(); refreshDocSearch(n); });
  content.addEventListener('paste', async (e) => {
    const cd = e.clipboardData || window.clipboardData;
    const text = cd ? cd.getData('text/plain') : '';
    const items = (cd && cd.items) ? Array.from(cd.items) : [];
    const hasImage = items.some((it) => it.type && it.type.indexOf('image') === 0);
    if (copiedImage) { e.preventDefault(); insertImageReferenceAtCursor(n, copiedImage.src, copiedImage.w); return; }
    e.preventDefault();
    const files = await window.api.readClipboardFiles();
    if (files && files.length) { await insertPastedFilesAtCursor(n, files); return; }
    if (hasImage) { await handleImagePaste(cd, n); return; }
    if (text) {
      if (savedRange && savedNoteId === n.id) restoreSelection();
      document.execCommand('insertText', false, text);
    }
  });
  content.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    const paths = files.map((f) => window.api.getPathForFile(f)).filter((p) => p && p.length > 1);
    if (paths.length) {
      content.focus();
      await insertPastedFilesAtCursor(n, paths);
    }
  });
  content.addEventListener('blur', (e) => {
    n.content = readRichContent(content);
    const rt = e.relatedTarget;
    const inTable = rt && rt.closest && rt.closest('.note-table-block');
    if (!savedRange && !inTable) content.innerHTML = renderRichCached(n);
    save();
  });
  content.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    adjustNoteFontSize(n, e.deltaY < 0 ? 1 : -1, (sz) => { const ed = content.closest('.doc-editor'); if (ed) ed.style.setProperty('--note-font-size', sz + 'px'); });
  }, { passive: false });
  content.addEventListener('keydown', (e) => {
    const sc = whichShortcut(e, state.settings, 'editor');
    if (sc === 'bold') { e.preventDefault(); toggleBold(content); }
    else if (sc === 'highlight') { e.preventDefault(); toggleHighlight(content); }
    else if (sc === 'alignLeft') { e.preventDefault(); alignBlock(content, 'justifyLeft'); n.content = readRichContent(content); save(); }
    else if (sc === 'alignCenter') { e.preventDefault(); alignBlock(content, 'justifyCenter'); n.content = readRichContent(content); save(); }
    else if (sc === 'alignRight') { e.preventDefault(); alignBlock(content, 'justifyRight'); n.content = readRichContent(content); save(); }
    else if (sc === 'copyImage') {
      const imgSrc = getSelectedImageSrc(n);
      if (imgSrc) {
        e.preventDefault();
        const imgObj = (n.images || []).find((im) => im.src === imgSrc);
        copiedImage = { src: imgSrc, w: (imgObj && imgObj.w) || 200 };
        window.api.copyImage(imgSrc);
        toast(t('toast_img_copied'));
      } else {
        copiedImage = null;
      }
    }
  });
  wireImages(content, n);
  wireTables(content, n);
}

/* ============ V128-01D3：文档视图搜索解释与安全定位 ============ */
// 为拾取项构造一个「脱离文档」的 .note-content，用现有 renderRichCached 渲染后再交给共享可见文本助手，
// 不复制富文本解析、不 buildNoteEl（避免绑定事件/改 z）。
function docPickerContent(n) {
  const det = document.createElement('div');
  det.className = 'note-content';
  det.innerHTML = renderRichCached(n);
  return det;
}

// 计算一个便签在文档语境下的首个搜索目标。优先级（确定性）：
// 标题 > 本便签 TODO 项 > 非 TODO 的可见正文/表格/附件（渲染文本）> 分组 > 诚实通用回退。
// contentEl 为当前可见内容节点（打开文档为 #docContent；拾取项传脱离节点）；无则跳过正文渲染匹配。
function docSearchTarget(n, contentEl) {
  const query = filter.query.trim();
  if (!query || !n) return null;
  const group = state.groups.find((g) => g.id === n.groupId);
  const hits = findNoteSearchMatches(n, group && group.name, query);
  const title = hits.find((h) => h.field === 'title');
  if (title) return { kind: 'title', hit: title, targetEl: $('#docTitle') };
  if (n.type === 'todo') {
    const todoHit = hits.find((h) => h.field === 'todo');
    if (todoHit) return { kind: 'todo', hit: todoHit, itemId: todoHit.itemId, itemIndex: todoHit.itemIndex };
  } else {
    const map = contentEl ? cardPlainTextMap(contentEl) : null;
    const plain = hits.find((h) => h.field === 'content');
    // 纯文本且 DOM 可见文本与原始字段完全一致时，偏移可精确映射到 DOM（用原生 Range）。
    if (plain && map && map.text === plain.text) return { kind: 'body', hit: plain, exact: true, map, targetEl: contentEl };
    if (contentEl) {
      const sources = cardRenderedSearchSources(contentEl);
      for (const source of sources) {
        const rendered = findNoteSearchMatches({ content: source.text }, null, query)[0];
        if (rendered) {
          const kind = source.field === 'content' ? 'body' : source.field;
          return { kind, hit: Object.assign({}, rendered, { field: source.field }), viewOnly: true, targetEl: source.target };
        }
      }
    }
  }
  const groupHit = hits.find((h) => h.field === 'group');
  if (groupHit) return { kind: 'group', hit: groupHit };
  return { kind: 'fallback', hit: null };
}

// 构造「来源 + 片段 + 按钮」的纯 DOM 节点（textContent，绝不拼接 HTML）。
function buildDocSearchNodes(target) {
  const wrap = document.createElement('span');
  wrap.className = 'doc-search';
  const source = document.createElement('span');
  source.className = 'doc-search-source';
  const snippet = document.createElement('span');
  snippet.className = 'doc-search-snippet';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'doc-search-locate';
  if (!target || target.kind === 'fallback') {
    source.textContent = t('search_hit_content');
    snippet.textContent = t('search_hit_fallback');
    button.textContent = t('search_view_note');
  } else {
    const hit = target.hit;
    const fieldKey = target.kind === 'body' ? 'content' : target.kind;
    source.textContent = t('search_hit_' + fieldKey);
    const summary = buildSearchSnippet(hit.text, hit.start, hit.end);
    if (summary.truncatedBefore) snippet.appendChild(document.createTextNode('…'));
    summary.parts.forEach((part) => {
      const seg = document.createElement(part.matched ? 'mark' : 'span');
      seg.textContent = part.text;
      snippet.appendChild(seg);
    });
    if (summary.truncatedAfter) snippet.appendChild(document.createTextNode('…'));
    if (target.kind === 'title' || target.kind === 'todo' || (target.kind === 'body' && target.exact)) button.textContent = t('search_locate');
    else if (target.kind === 'table') button.textContent = t('search_view_table');
    else if (target.kind === 'file') button.textContent = t('search_view_file');
    else button.textContent = t('search_view_note'); // body viewOnly / group：诚实「查看」
  }
  wrap.append(source, snippet, button);
  return wrap;
}

// 打开文档后刷新（或移除）临时搜索解释；不重建编辑器，不触碰编辑内容/焦点/原生撤销。
function refreshDocSearch(n) {
  const editor = $('.doc-editor');
  if (!editor) return;
  const old = $('.doc-search', editor);
  if (old) old.remove();
  const target = docSearchTarget(n, $('#docContent'));
  if (!target) return;
  const nodes = buildDocSearchNodes(target);
  nodes.addEventListener('click', (e) => e.stopPropagation());
  const btn = $('.doc-search-locate', nodes);
  if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); locateDocSearch(n.id); });
  const title = $('#docTitle');
  if (title && title.parentNode === editor) editor.insertBefore(nodes, title.nextSibling);
  else editor.insertBefore(nodes, editor.firstChild);
}

// 定位：必要时打开该文档，重新计算实时命中（不信任旧偏移），聚焦/选中合适的实时目标。
// 不写 n.z/几何，不改变查询/分组/归档/排序/顺序，不触发文件/链接打开。
function locateDocSearch(noteId) {
  if (docNoteId !== noteId) { docNoteId = noteId; renderAll(); }
  const n = state.notes.find((x) => x.id === noteId);
  if (!n) return;
  const query = filter.query.trim();
  const target = docSearchTarget(n, $('#docContent'));
  if (!target) return;
  if (target.kind === 'title') {
    const ti = $('#docTitle');
    if (ti) {
      const fresh = findNoteSearchMatches({ title: n.title }, null, query).find((h) => h.field === 'title');
      ti.focus({ preventScroll: true });
      if (fresh) ti.setSelectionRange(fresh.start, fresh.end);
      ti.scrollIntoView({ block: 'nearest' });
    }
    return;
  }
  if (target.kind === 'todo') {
    const li = $$('#docList .todo-item').find((el) => el.dataset.itemId === target.itemId);
    const span = li ? li.querySelector('span:last-child') : null;
    if (span) {
      const item = (n.items || []).find((i) => i.id === target.itemId);
      const fresh = item ? findNoteSearchMatches({ items: [item] }, null, query).find((h) => h.field === 'todo') : null;
      if (!span.hasAttribute('tabindex')) span.tabIndex = -1;
      span.focus({ preventScroll: true });
      const node = span.firstChild && span.firstChild.nodeType === Node.TEXT_NODE ? span.firstChild : span;
      const range = document.createRange();
      range.setStart(node, fresh ? fresh.start : 0);
      range.setEnd(node, fresh ? fresh.end : 0);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      span.scrollIntoView({ block: 'nearest' });
    }
    return;
  }
  if (target.kind === 'body' && target.exact && target.map) {
    const content = $('#docContent');
    if (content) {
      if (!content.isContentEditable && !content.hasAttribute('tabindex')) content.tabIndex = -1;
      content.focus({ preventScroll: true });
      const boundary = (offset) => {
        for (const sp of target.map.spans) {
          if (offset <= sp.end) {
            if (sp.node.nodeType === Node.TEXT_NODE) return [sp.node, Math.max(0, offset - sp.start)];
            const index = Array.prototype.indexOf.call(content.childNodes, sp.node);
            return [content, index + (offset > sp.start ? 1 : 0)];
          }
        }
        return [content, content.childNodes.length];
      };
      const range = document.createRange();
      range.setStart(...boundary(target.hit.start));
      range.setEnd(...boundary(target.hit.end));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      content.scrollIntoView({ block: 'nearest' });
    }
    return;
  }
  if (target.kind === 'table' || target.kind === 'file') {
    const el = target.targetEl || (target.kind === 'table' ? document.querySelector('#docContent .note-table-block') : document.querySelector('#docContent .file-link'));
    if (el) {
      if (!el.hasAttribute('tabindex')) el.tabIndex = target.kind === 'table' ? 0 : -1;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest' });
    }
    return;
  }
  // body viewOnly / group / fallback：安全聚焦只读的 .doc-editor，绝不进入可编辑 #docContent
  // （进入 content 再失焦会触发 canonical readRichContent，可能改写富文本标记）。
  const editor = $('.doc-editor');
  if (editor) {
    if (!editor.hasAttribute('tabindex')) editor.tabIndex = -1;
    editor.focus({ preventScroll: true });
    editor.scrollIntoView({ block: 'nearest' });
  }
}

  return { renderDocView, wireDocView, refreshDocPickerForeground };
}));
