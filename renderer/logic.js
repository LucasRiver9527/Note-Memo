/* 纯逻辑模块：颜色、转义、引用清理、排序。
   作为普通 <script> 在页面加载（挂到 window.NoteLogic / 顶层全局），
   也可被 Node 测试 require（module.exports）。单一来源，便于测试。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root['NoteLogic'] = fns;
    // 挂到全局，等价于原来的顶层 function 声明，app.js 可直接按名字调用
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function hexToRgba(hex, alpha) {
    const h = String(hex || '').replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // 相对亮度（WCAG）0~1：颜色越亮越接近 1
  function luminance(hex) {
    const h = String(hex || '').replace('#', '');
    if (h.length < 6) return 0;
    const lin = (c) => {
      const v = parseInt(c, 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const r = lin(h.slice(0, 2)), g = lin(h.slice(2, 4)), b = lin(h.slice(4, 6));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // WCAG 对比度 1~21（两种颜色）
  function contrastRatio(a, b) {
    const l1 = luminance(a), l2 = luminance(b);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  // ---- 国际化单一来源（由脚本从 app.js/note.js 提取并合并，勿手改键值） ----
  /* i18n 数据表已拆到 core/i18n.js（I18N / I18N_MERGED / T / mergeI18n）。
     index.html 与 note.html 均在 logic.js 之前加载它；Node 测试直接 require('core/i18n.js')。 */

  function isDarkColor(hex) {
    const h = String(hex || '').replace('#', '');
    if (h.length < 6) return true;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55;
  }

  function autoTextColor(bg) {
    return isDarkColor(bg) ? '#ffffff' : '#2d2f38';
  }

  // ---- 便签外观纯逻辑（可单测）：阴影强度映射为 CSS 值 ----
  // 阴影强度：0=默认，1~3 逐级加深 → 基础阴影与 hover 阴影
  function noteShadowCss(strength) {
    const s = Math.max(0, Math.min(3, strength || 0));
    const map = [
      '0 6px 20px rgba(0,0,0,0.22)',
      '0 8px 24px rgba(0,0,0,0.3)',
      '0 12px 34px rgba(0,0,0,0.4)',
      '0 16px 46px rgba(0,0,0,0.5)'
    ];
    return { base: map[s], hover: map[Math.min(s + 1, 3)] };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 收集内容里引用的图/文件/表格 id
  function refIdsOf(n) {
    const ids = new Set();
    const re = /\[\[(?:img|file|table):([a-zA-Z0-9_-]+)\]\]/g;
    let m;
    const s = String((n && n.content) || '');
    while ((m = re.exec(s)) !== null) ids.add(m[1]);
    return ids;
  }

  // 删除内容里已不引用的图/文件/表格
  function cleanupRefs(n) {
    if (!n) return;
    const refs = refIdsOf(n);
    n.images = (n.images || []).filter((im) => refs.has(im.id));
    n.files = (n.files || []).filter((f) => refs.has(f.id));
    n.tables = (n.tables || []).filter((tb) => refs.has(tb.id));
  }

  // 便签排序，settings 传 { sortMode, noteOrder, groupOrders }，groupId 用于按分组的自定义顺序（可选）
  function sortNotes(arr, settings, groupId) {
    const mode = (settings && settings.sortMode) || 'updated';
    let order = (settings && settings.noteOrder) || [];
    if (mode === 'custom' && groupId) {
      const go = (settings && settings.groupOrders) || {};
      order = go[groupId] || [];
    }
    const a = [...arr];
    a.sort((x, y) => {
      if (mode !== 'custom' && x.pinned !== y.pinned) return x.pinned ? -1 : 1;
      if (mode === 'custom') {
        const ix = order.indexOf(x.id);
        const iy = order.indexOf(y.id);
        if (ix === -1 && iy === -1) return (y.createdAt || 0) - (x.createdAt || 0);
        if (ix === -1) return 1;
        if (iy === -1) return -1;
        return ix - iy;
      }
      if (mode === 'created') return (y.createdAt || 0) - (x.createdAt || 0);
      if (mode === 'title') return (x.title || '').localeCompare(y.title || '', 'zh');
      if (mode === 'color') return String(x.color).localeCompare(String(y.color));
      return (y.updatedAt || y.createdAt || 0) - (x.updatedAt || x.createdAt || 0);
    });
    return a;
  }

  // ---------- Markdown 导出（纯函数，主进程与测试均可 require） ----------
  function tableToMarkdown(tbl) {
    const rows = tbl.rows || 0, cols = tbl.cols || 0;
    const cells = tbl.cells || [];
    const merges = tbl.merges || [];
    const diagonals = tbl.diagonals || [];
    const grid = [];
    const occupied = [];
    for (let r = 0; r < rows; r++) { grid.push(new Array(cols).fill('')); occupied.push(new Array(cols).fill(false)); }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (occupied[r][c]) continue;
        const mg = merges.find((m) => m.r === r && m.c === c);
        const diag = diagonals.find((d) => d.r === r && d.c === c);
        let txt = (cells[r] && cells[r][c]) || '';
        if (diag) txt = [diag.t1, diag.t2].filter(Boolean).join(' ');
        grid[r][c] = txt.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
        if (mg) {
          for (let rr = r; rr < r + mg.rowspan; rr++)
            for (let cc = c; cc < c + mg.colspan; cc++)
              if (rr < rows && cc < cols) occupied[rr][cc] = true;
        }
      }
    }
    if (!rows || !cols) return '';
    const lines = [];
    const scr = (arr) => '| ' + arr.map((x) => x.replace(/\n/g, '<br>')).join(' | ') + ' |';
    lines.push(scr(grid[0]));
    lines.push('| ' + grid[0].map(() => '---').join(' | ') + ' |');
    for (let r = 1; r < rows; r++) lines.push(scr(grid[r]));
    return lines.join('\n');
  }

  // noteToMarkdown(note, { image(src)->md } )：把一条便签转成 Markdown 字符串
  function noteToMarkdown(note, opts) {
    opts = opts || {};
    const resolveImg = opts.image || ((src) => src);
    const out = [];
    const title = (note && note.title) || '';
    if (title) out.push('# ' + title);

    // 待办清单
    if (note && note.type === 'todo' && Array.isArray(note.items)) {
      const list = note.items.map((it) => '- [' + (it.done ? 'x' : ' ') + '] ' + (it.text || '')).join('\n');
      out.push(list);
      return out.join('\n\n');
    }

    const imgMap = {}; (note.images || []).forEach((im) => { imgMap[im.id] = im; });
    const fileMap = {}; (note.files || []).forEach((f) => { fileMap[f.id] = f; });
    const tableMap = {}; (note.tables || []).forEach((tb) => { tableMap[tb.id] = tb; });

    let text = String((note && note.content) || '');
    // 颜色 -> 内联 HTML
    text = text.replace(/\[\[c:([^\]]+)\]\]/g, (m, c) => '<span style="color:' + c + '">');
    text = text.replace(/\[\[\/c\]\]/g, '</span>');
    // 高亮 -> <mark>
    text = text.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
    // 图片 / 文件 / 表格引用
    text = text.replace(/\[\[img:([a-zA-Z0-9_-]+)\]\]/g, (m, id) => {
      const im = imgMap[id]; if (!im) return '';
      return '![' + (im.id || 'img') + '](' + resolveImg(im.src || '') + ')';
    });
    text = text.replace(/\[\[file:([a-zA-Z0-9_-]+)\]\]/g, (m, id) => {
      const f = fileMap[id]; if (!f) return '';
      const name = (f.path || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
      return '[' + (name || f.path || 'file') + '](<' + (f.path || '') + '>)';
    });
    text = text.replace(/\[\[table:([a-zA-Z0-9_-]+)\]\]/g, (m, id) => {
      const tb = tableMap[id]; if (!tb) return '';
      return '\n\n' + tableToMarkdown(tb) + '\n\n';
    });

    out.push(text);
    return out.join('\n\n');
  }

  // 收集被引用（仍在使用）的媒体文件名，按目录归类。含回收站，避免误删可恢复数据。
  function referencedMedia(data) {
    const byDir = { images: new Set(), backgrounds: new Set(), fonts: new Set(), sounds: new Set() };
    const add = (url) => {
      if (typeof url !== 'string') return;
      const m = /^note-(img|bg|font|sound):\/\/local\/(.+)$/.exec(url);
      if (!m) return;
      const kind = { img: 'images', bg: 'backgrounds', font: 'fonts', sound: 'sounds' }[m[1]];
      if (byDir[kind]) byDir[kind].add(decodeURIComponent(m[2]));
    };
    const addNote = (n) => { if (n) (n.images || []).forEach((im) => add(im.src)); };
    (data.notes || []).forEach(addNote);
    (data.trash || []).forEach((t) => addNote(t && t.note));
    const s = data.settings || {};
    add(s.backgroundImage);
    (s.customFonts || []).forEach((f) => add(f.url));
    add(s.reminderSoundPath);
    return byDir;
  }

  // 把 \0 分隔的字面文件路径去重收集进 into 数组
  function parseNullSeparated(str, into) {
    (str || '').split('\0').forEach((p) => { if (p && p.length > 1 && !into.includes(p)) into.push(p); });
    return into;
  }

  // 解析 CF_HDROP 缓冲区里的文件路径（视写入格式做 UTF-16 / Latin1 解码）
  function hdropString(buf) {
    if (!buf || buf.length <= 16) return '';
    const pFiles = buf.readUInt32LE(0);
    const fWide = buf.readUInt32LE(16) !== 0;
    return buf.slice(pFiles).toString(fWide ? 'utf16le' : 'latin1');
  }

  // ---------- 渲染层共享（单一来源） ----------
  // 主窗口(app.js)与钉窗(note.js)统一使用这些富文本/表格 HTML 构建函数，
  // 消除两窗口的重复实现。Node 测试亦可 require 验证。
  // 每个窗口在渲染前调用 setRenderLocale({ tr, mdOn }) 注入翻译器与 Markdown 开关；
  // mdOn 传入函数以实时读取当前设置，避免语言/Markdown 切换后失效。
  let _tr = (k) => k;
  let _mdOn = () => true;
  function setRenderLocale(opts) {
    if (opts && typeof opts.tr === 'function') _tr = opts.tr;
    if (opts && typeof opts.mdOn === 'function') _mdOn = opts.mdOn;
  }

  // 清洗拼进内联 style 的值：只保留合法字符，去掉 ; : " ' < > { } 等，防止数据注入样式/属性。
  function sanitizeCss(v) {
    return String(v == null ? '' : v).replace(/[^#\w\s.,%()+\-]/g, '');
  }

  // opts 可缺省；提供 { tr, mdOn } 时覆盖全局 _tr/_mdOn，实现按调用显式控制、无状态依赖。
  function formatInlineText(text, opts) {
    const tr = (opts && opts.tr) || _tr;
    const mdOn = (opts && typeof opts.mdOn === 'function') ? opts.mdOn() : _mdOn();
    const urlRe = /^(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/i;
    let out = '';
    let i = 0;
    while (i < text.length) {
      const rest = text.slice(i);
      let handled = false;
      const cm = rest.match(/^\[\[c:([^\]]+)\]\]/);
      if (cm) {
        const closeIdx = text.indexOf('[[/c]]', i + cm[0].length);
        if (closeIdx >= 0) {
          const inner = text.slice(i + cm[0].length, closeIdx);
          out += '<span style="color:' + sanitizeCss(cm[1]) + '">' + formatInlineText(inner, opts) + '</span>';
          i = closeIdx + 6;
          handled = true;
        }
      }
      if (!handled && mdOn) {
        let m = rest.match(/^==([^=\n]+)==/);
        if (m) {
          out += '<mark class="hl">' + escapeHtml(m[1]) + '</mark>';
          i += m[0].length; handled = true;
        } else {
          m = rest.match(/^\*\*([^*\n]+)\*\*/);
          if (m) {
            out += '<b>' + escapeHtml(m[1]) + '</b>';
            i += m[0].length; handled = true;
          }
        }
      }
      if (!handled) {
        const um = rest.match(urlRe);
        if (um) {
          const url = um[0];
          const href = /^www\./i.test(url) ? 'http://' + url : url;
          out += `<a class="note-link" contenteditable="false" data-url="${escapeHtml(href)}" title="${tr('open_link')}">${escapeHtml(url)}</a>`;
          i += url.length;
        } else {
          out += escapeHtml(text[i]);
          i += 1;
        }
      }
    }
    return out;
  }

  function inlineImgHtml(img, opts) {
    const tr = (opts && opts.tr) || _tr;
    return `<span class="inline-img" data-img-id="${img.id}" contenteditable="false" tabindex="0"><img src="${escapeHtml(img.src)}" style="width:${img.w || 200}px" /><button class="img-del" title="${tr('delete_image')}">✕</button><div class="img-resize" title="${tr('resize_image')}"></div></span>`;
  }

  function fileLinkHtml(f) {
    const name = (f.path || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    const icon = f.isDir ? '📁' : '📄';
    return `<span class="file-link" contenteditable="false" data-file-id="${f.id}" data-path="${escapeHtml(f.path)}" data-is-dir="${f.isDir ? '1' : '0'}" title="${escapeHtml(f.path)}">${icon} ${escapeHtml(name || f.path)}</span>`;
  }

  function tableBlockHtml(tbl, opts) {
    const rows = tbl.rows, cols = tbl.cols;
    const cells = tbl.cells || [];
    const merges = tbl.merges || [];
    const diagonals = tbl.diagonals || [];
    const occupied = [];
    for (let r = 0; r < rows; r++) occupied.push(new Array(cols).fill(false));
    let html = '';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) {
        if (occupied[r][c]) continue;
        const mg = merges.find((m) => m.r === r && m.c === c);
        const diag = diagonals.find((d) => d.r === r && d.c === c);
        const text = (cells[r] && cells[r][c]) || '';
        let attrs = '';
        let inner = formatInlineText(text, opts).replace(/\n/g, '<br>');
        if (mg) {
          attrs = ` rowspan="${mg.rowspan}" colspan="${mg.colspan}"`;
          for (let rr = r; rr < r + mg.rowspan; rr++)
            for (let cc = c; cc < c + mg.colspan; cc++)
              if (rr < rows && cc < cols) occupied[rr][cc] = true;
        }
        let diagCls = '';
        if (diag) {
          const isTrbl = diag.dir === 'trbl';
          diagCls = ' diag diag-' + (isTrbl ? 'trbl' : 'tlbr');
          const line = isTrbl ? '<line x1="0" y1="100" x2="100" y2="0"/>' : '<line x1="0" y1="0" x2="100" y2="100"/>';
          const ds = (diag.tColor ? 'color:' + sanitizeCss(diag.tColor) + ';' : '') + (diag.tSize ? 'font-size:' + sanitizeCss(diag.tSize) + 'px;' : '');
          inner = `<svg class="diag-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${line}</svg><span class="tbl-t1"${ds ? ' style="' + ds + '"' : ''}>${formatInlineText(diag.t1 || '', opts).replace(/\n/g, '<br>')}</span><span class="tbl-t2"${ds ? ' style="' + ds + '"' : ''}>${formatInlineText(diag.t2 || '', opts).replace(/\n/g, '<br>')}</span>`;
        }
        html += `<td${attrs}${diagCls ? ' class="' + diagCls.trim() + '"' : ''} data-r="${r}" data-c="${c}">${inner}</td>`;
      }
      html += '</tr>';
    }
    const bw = tbl.borderWidth != null ? tbl.borderWidth : 3;
    const bc = sanitizeCss(tbl.borderColor) || 'rgba(0,0,0,0.7)';
    const ts = (tbl.textColor ? 'color:' + sanitizeCss(tbl.textColor) + ';' : '') + (tbl.fontSize ? 'font-size:' + sanitizeCss(tbl.fontSize) + 'px;' : '');
    return `<div class="note-table-block" contenteditable="false" data-table-id="${tbl.id}" tabindex="0"><table class="note-table" style="--tbl-border-width:${bw}px;--tbl-border-color:${bc};${ts}">${html}</table></div>`;
  }

  function renderRichContent(text, n, opts) {
    n = n || {};
    const imgMap = {};
    (n.images || []).forEach((im) => { imgMap[im.id] = im; });
    const fileMap = {};
    (n.files || []).forEach((f) => { fileMap[f.id] = f; });
    const tableMap = {};
    (n.tables || []).forEach((tb) => { tableMap[tb.id] = tb; });
    const stripAlignMarkers = (s) => String(s || '')
      .replace(/\[\[alignimg:(left|center|right)\]\]/g, '')
      .replace(/\[\[\/alignimg\]\]/g, '')
      .replace(/\[\[align:(left|center|right)\]\]/g, '')
      .replace(/\[\[\/align\]\]/g, '');
    const renderSeg = (seg) => {
      const re = /\[\[(img|file|table):([a-zA-Z0-9_-]+)\]\]/g;
      let segOut = '';
      let segLast = 0;
      let sm;
      while ((sm = re.exec(seg)) !== null) {
        segOut += formatInlineText(stripAlignMarkers(seg.slice(segLast, sm.index)), opts);
        if (sm[1] === 'img') {
          const im = imgMap[sm[2]];
          if (im) segOut += inlineImgHtml(im, opts);
        } else if (sm[1] === 'file') {
          const f = fileMap[sm[2]];
          if (f) segOut += fileLinkHtml(f);
        } else {
          const tb = tableMap[sm[2]];
          if (tb) segOut += tableBlockHtml(tb, opts);
        }
        segLast = sm.index + sm[0].length;
      }
      segOut += formatInlineText(stripAlignMarkers(seg.slice(segLast)), opts);
      return segOut;
    };
    const s = String(text || '');
    const alignRe = /\[\[align:(left|center|right)\]\]/g;
    let out = '';
    let last = 0;
    let m;
    while ((m = alignRe.exec(s)) !== null) {
      const closeIdx = s.indexOf('[[/align]]', m.index + m[0].length);
      if (closeIdx < 0) break;
      out += renderSeg(s.slice(last, m.index));
      out += '<div class="note-align note-align-' + m[1] + '" style="text-align:' + m[1] + '">' + renderSeg(s.slice(m.index + m[0].length, closeIdx)) + '</div>';
      last = closeIdx + '[[/align]]'.length;
      alignRe.lastIndex = last;
    }
    out += renderSeg(s.slice(last));
    return out;
  }


  return { hexToRgba, luminance, contrastRatio, isDarkColor, autoTextColor, noteShadowCss, escapeHtml, refIdsOf, cleanupRefs, sortNotes, tableToMarkdown, noteToMarkdown, referencedMedia, parseNullSeparated, hdropString, setRenderLocale, formatInlineText, inlineImgHtml, fileLinkHtml, tableBlockHtml, renderRichContent, sanitizeCss };
});
