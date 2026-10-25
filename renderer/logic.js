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
  // 与渲染预算一致的表格导出上限：超出不静默截断，而是描述性拒绝，避免导出缺失数据的产物。
  const TABLE_MD_MAX_DIM = 200;

  // 有限索引：仅接受 number/非空数字字符串；负数/非有限/对象等返回 null（不做对象强转）。
  function normTableIndex(v) {
    const n = toFiniteNumber(v);
    if (n === null) return null;
    const i = Math.trunc(n);
    return i < 0 ? null : i;
  }
  // 维度：非法/负数/非有限一律视为 0（空表），绝不参与 new Array 分配。
  function normTableDim(v) {
    const i = normTableIndex(v);
    return i === null ? 0 : i;
  }
  // 单元格文本：仅字符串/有限数字/布尔安全转字符串；null/undefined/对象/数组一律空串（不触发对象强转）。
  function safeCellText(v) {
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return '';
  }

  function tableToMarkdown(tbl) {
    tbl = tbl && typeof tbl === 'object' ? tbl : {};
    const rows = normTableDim(tbl.rows);
    const cols = normTableDim(tbl.cols);
    if (rows === 0 || cols === 0) return '';
    // 过大的有限维度：描述性拒绝（由导出 UI 捕获并可见提示），而不是静默截断丢数据。
    if (rows > TABLE_MD_MAX_DIM || cols > TABLE_MD_MAX_DIM) {
      throw Object.assign(new Error('table too large to export: ' + rows + 'x' + cols + ' (limit ' + TABLE_MD_MAX_DIM + ')'), { code: 'TABLE_MD_TOO_LARGE', limit: TABLE_MD_MAX_DIM });
    }
    const cells = Array.isArray(tbl.cells) ? tbl.cells : [];
    const merges = Array.isArray(tbl.merges) ? tbl.merges : [];
    const diagonals = Array.isArray(tbl.diagonals) ? tbl.diagonals : [];
    const grid = [];
    const occupied = [];
    for (let r = 0; r < rows; r++) { grid.push(new Array(cols).fill('')); occupied.push(new Array(cols).fill(false)); }
    for (let r = 0; r < rows; r++) {
      const row = Array.isArray(cells[r]) ? cells[r] : [];
      for (let c = 0; c < cols; c++) {
        if (occupied[r][c]) continue;
        const mg = merges.find((m) => m && normTableIndex(m.r) === r && normTableIndex(m.c) === c);
        const diag = diagonals.find((d) => d && normTableIndex(d.r) === r && normTableIndex(d.c) === c);
        let txt = safeCellText(row[c]);
        if (diag) {
          const t1 = safeCellText(diag.t1), t2 = safeCellText(diag.t2);
          txt = [t1, t2].filter(Boolean).join(' ');
        }
        grid[r][c] = txt.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
        if (mg) {
          // span 仅接受有限数值/数字字符串，夹取到实际网格范围内；循环次数有界，绝不按原始巨大 span 迭代。
          const spanR = clampInt(mg.rowspan, 1, 1, rows - r);
          const spanC = clampInt(mg.colspan, 1, 1, cols - c);
          for (let rr = r; rr < r + spanR; rr++)
            for (let cc = c; cc < c + spanC; cc++)
              occupied[rr][cc] = true;
        }
      }
    }
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

  // P0-04 渲染侧安全预算：导入/历史数据可能带恶意或损坏的数值。
  // 全部先数值化并夹取，再拼进 HTML，避免属性逃逸与超大循环卡死；不修改原始数据。
  const RICH_RENDER_MAX_DIM = 200;   // 表格最多渲染的行/列（编辑器上限 20，留足余量）
  const IMG_RENDER_MIN_W = 1;
  const IMG_RENDER_MAX_W = 100000;   // 图片宽度上限（编辑器无上限，仅挡非有限/极端值）
  const TABLE_BORDER_MIN = 0;        // 0 = 无边框，需保留
  const TABLE_BORDER_MAX = 64;

  // 仅接受 number 或非空数字字符串，转成有限数；对象/数组/布尔/null/空串/空白一律返回 null。
  // 关键：绝不对任意对象调用 Number()（{toString:null,valueOf:0} 会抛 TypeError），先按类型判定再转换。
  function toFiniteNumber(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
      const s = v.trim();
      if (s === '') return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }
  // 数值 → [min,max] 内的整数；不可安全转换时回退 def。不修改入参。
  function clampInt(v, def, min, max) {
    const n = toFiniteNumber(v);
    if (n === null) return def;
    return Math.max(min, Math.min(max, Math.trunc(n)));
  }
  // 数值 → [min,max] 内的有限数（允许小数）；不可安全转换时回退 def。
  function clampNum(v, def, min, max) {
    const n = toFiniteNumber(v);
    if (n === null) return def;
    return Math.max(min, Math.min(max, n));
  }
  // 是否可安全当 CSS 数值（用于 font-size 等；非数值则整段省略而不是渲染 0px）。
  function isCssNumber(v) {
    return toFiniteNumber(v) !== null;
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
    // 宽度：非有限/空/0 回退 200；其余数值化并夹取，杜绝宽度字段逃逸成属性。
    const w = !img.w ? 200 : clampNum(img.w, 200, IMG_RENDER_MIN_W, IMG_RENDER_MAX_W);
    return `<span class="inline-img" data-img-id="${escapeHtml(img.id)}" contenteditable="false" tabindex="0"><img src="${escapeHtml(img.src)}" style="width:${w}px" /><button class="img-del" title="${tr('delete_image')}">✕</button><div class="img-resize" title="${tr('resize_image')}"></div></span>`;
  }

  function fileLinkHtml(f) {
    const p = f.path == null ? '' : String(f.path);
    const name = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    const icon = f.isDir ? '📁' : '📄';
    return `<span class="file-link" contenteditable="false" data-file-id="${escapeHtml(f.id)}" data-path="${escapeHtml(p)}" data-is-dir="${f.isDir ? '1' : '0'}" title="${escapeHtml(p)}">${icon} ${escapeHtml(name || p)}</span>`;
  }

  function tableBlockHtml(tbl, opts) {
    tbl = tbl || {};
    // 行/列/跨度一律先夹取：恶意巨大的 rows/cols 只渲染前 N 行/列，避免同步大循环卡死。
    const rows = clampInt(tbl.rows, 0, 0, RICH_RENDER_MAX_DIM);
    const cols = clampInt(tbl.cols, 0, 0, RICH_RENDER_MAX_DIM);
    const cells = Array.isArray(tbl.cells) ? tbl.cells : [];
    const merges = Array.isArray(tbl.merges) ? tbl.merges : [];
    const diagonals = Array.isArray(tbl.diagonals) ? tbl.diagonals : [];
    const occupied = [];
    for (let r = 0; r < rows; r++) occupied.push(new Array(cols).fill(false));
    let html = '';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) {
        if (occupied[r][c]) continue;
        const mg = merges.find((m) => m && m.r === r && m.c === c);
        const diag = diagonals.find((d) => d && d.r === r && d.c === c);
        const cellRow = Array.isArray(cells[r]) ? cells[r] : [];
        const text = cellRow[c] ? String(cellRow[c]) : '';
        let attrs = '';
        let inner = formatInlineText(text, opts).replace(/\n/g, '<br>');
        if (mg) {
          // span 夹取到表格边界内且至少 1，绝不越界写入 occupied。
          const spanR = clampInt(mg.rowspan, 1, 1, rows - r);
          const spanC = clampInt(mg.colspan, 1, 1, cols - c);
          attrs = ` rowspan="${spanR}" colspan="${spanC}"`;
          for (let rr = r; rr < r + spanR; rr++)
            for (let cc = c; cc < c + spanC; cc++)
              if (rr < rows && cc < cols) occupied[rr][cc] = true;
        }
        let diagCls = '';
        if (diag) {
          const isTrbl = diag.dir === 'trbl';
          diagCls = ' diag diag-' + (isTrbl ? 'trbl' : 'tlbr');
          const line = isTrbl ? '<line x1="0" y1="100" x2="100" y2="0"/>' : '<line x1="0" y1="0" x2="100" y2="100"/>';
          let ds = '';
          if (diag.tColor) ds += 'color:' + sanitizeCss(diag.tColor) + ';';
          if (isCssNumber(diag.tSize)) ds += 'font-size:' + clampNum(diag.tSize, 0, 0, 999) + 'px;';
          const dt1 = diag.t1 == null ? '' : String(diag.t1);
          const dt2 = diag.t2 == null ? '' : String(diag.t2);
          // 使用 2×2 等分 intrinsic 网格：两行等高（由更高标签撑开），对角放置两个标签，
          // 让长文本（中文/无空格英文/换行）在安全象限内换行且不越出单元格；SVG 仍覆盖整格。
          const lb1 = `<span class="tbl-t1"${ds ? ' style="' + ds + '"' : ''}>${formatInlineText(dt1, opts).replace(/\n/g, '<br>')}</span>`;
          const lb2 = `<span class="tbl-t2"${ds ? ' style="' + ds + '"' : ''}>${formatInlineText(dt2, opts).replace(/\n/g, '<br>')}</span>`;
          const t1Cell = isTrbl ? 'diag-a' : 'diag-b';   // tlbr: t1 右上 / trbl: t1 左上
          const t2Cell = isTrbl ? 'diag-d' : 'diag-c';   // tlbr: t2 左下 / trbl: t2 右下
          inner = `<svg class="diag-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${line}</svg><span class="diag-box"><span class="diag-cell ${t1Cell}">${lb1}</span><span class="diag-cell ${t2Cell}">${lb2}</span></span>`;
        }
        html += `<td${attrs}${diagCls ? ' class="' + diagCls.trim() + '"' : ''} data-r="${r}" data-c="${c}">${inner}</td>`;
      }
      html += '</tr>';
    }
    const bw = (tbl.borderWidth == null || tbl.borderWidth === '') ? 3 : clampNum(tbl.borderWidth, 3, TABLE_BORDER_MIN, TABLE_BORDER_MAX);
    const bc = sanitizeCss(tbl.borderColor) || 'color-mix(in srgb, currentColor 55%, transparent)';
    let ts = '';
    if (tbl.textColor) ts += 'color:' + sanitizeCss(tbl.textColor) + ';';
    if (isCssNumber(tbl.fontSize)) ts += 'font-size:' + clampNum(tbl.fontSize, 0, 0, 999) + 'px;';
    return `<div class="note-table-block" contenteditable="false" data-table-id="${escapeHtml(tbl.id)}" tabindex="0"><table class="note-table" style="--tbl-border-width:${bw}px;--tbl-border-color:${bc};${ts}">${html}</table></div>`;
  }

  function renderRichContent(text, n, opts) {
    n = n || {};
    const imgMap = {};
    (Array.isArray(n.images) ? n.images : []).forEach((im) => { if (im && typeof im === 'object' && im.id != null) imgMap[im.id] = im; });
    const fileMap = {};
    (Array.isArray(n.files) ? n.files : []).forEach((f) => { if (f && typeof f === 'object' && f.id != null) fileMap[f.id] = f; });
    const tableMap = {};
    (Array.isArray(n.tables) ? n.tables : []).forEach((tb) => { if (tb && typeof tb === 'object' && tb.id != null) tableMap[tb.id] = tb; });
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


  /* ================= 搜索匹配 / 片段（V128-01A，纯文本阶段） =================
     说明（明确范围，避免误用）：
     - 本阶段只在「原始纯文本字段」上做大小写不敏感的字面量匹配，与当前 visibleNotes 的
       String.toLowerCase().includes() 语义保持一致（不做正则、不做 Unicode 规范化）。
     - 不解析 Markdown / 富文本标记 / 媒体（[[img:...]]、[[table:...]] 等）的「渲染后文本」，
       也不做 DOM caret 定位；后续 UI 步骤可基于这里的结构化结果自行处理。
     - 所有返回值均为纯数据；snippet 的片段是**纯文本**（matched 仅布尔标记），
       调用方必须用 textContent 或 escapeHtml 自行渲染，模块内部绝不生成 HTML、也不对原始文本做 HTML 转义
       （在片段层转义会造成二次转义）。 */

  // 构造「小写化 + 原始 UTF-16 偏移映射」：lower 中每个 UTF-16 码元对应 original 中的起始偏移。
  // 处理变长小写映射（如 U+0130 'İ' -> 'i\u0307'）与全角等，使后续命中能准确映射回原文偏移。
  function lowerWithMap(s) {
    const src = String(s);
    const lower = src.toLowerCase();
    const map = new Array(lower.length);
    let si = 0; // 源码元游标
    let li = 0; // lower 码元游标
    while (si < src.length) {
      const cp = src.codePointAt(si);
      const ch = String.fromCodePoint(cp);
      const srcLen = ch.length; // UTF-16 长度（astral 为 2）
      const lowCh = ch.toLowerCase();
      for (let k = 0; k < lowCh.length; k++) map[li + k] = si;
      li += lowCh.length;
      si += srcLen;
    }
    return { lower, map };
  }

  // 在字段文本中找 query 的第一个「字面量大小写不敏感」命中；返回 {start,end}（原文 UTF-16 偏移，end 独占）或 null。
  function firstLiteralHit(text, query) {
    const src = String(text == null ? '' : text);
    const q = String(query);
    if (!q) return null;
    const { lower, map } = lowerWithMap(src);
    const qLower = q.toLowerCase();
    const idx = lower.indexOf(qLower);
    if (idx < 0) return null;
    const start = map[idx];
    // end 用「映射到原文的结束位置」：lower 命中末码元 + 1 个 lower 码元对应的原文区间末尾；
    // 若命中跨多个来源码元（如变长映射），取最后一个 lower 码元映射到的源码元末尾。
    const lastLower = idx + qLower.length - 1;
    const lastSrcStart = map[lastLower];
    const lastCp = src.codePointAt(lastSrcStart);
    const end = lastSrcStart + String.fromCodePoint(lastCp).length;
    return { start, end };
  }

  /**
   * findNoteSearchMatches(note, groupName, query)
   * 对 title / content / 每个 todo item.text / groupName 逐字段做「首个命中」匹配，
   * 返回按固定顺序（title, content, 每个 todo 项, groupName）排列的命中数组。
   * query 去首尾空白；空/纯空白 -> []。缺失/null 字段安全忽略。绝不修改输入、不把 query 当正则。
   * 每条命中形状：{ field, text, start, end, itemId?, itemIndex? }
   *   - field:   'title' | 'content' | 'todo' | 'group'
   *   - text:    该字段的原始文本（未转义、未截断）
   *   - start/end: text 内命中的原始 UTF-16 起始/结束（end 独占）
   *   - itemId/itemIndex: 仅 todo 命中时给出（it.id / 其索引）
   */
  function findNoteSearchMatches(note, groupName, query) {
    const q = String(query == null ? '' : query).trim();
    if (!q) return [];
    const n = note || {};
    const out = [];
    const push = (field, text, extras) => {
      if (text == null) return;
      const hit = firstLiteralHit(text, q);
      if (!hit) return;
      out.push(Object.assign({ field, text: String(text), start: hit.start, end: hit.end }, extras || {}));
    };
    push('title', n.title);
    push('content', n.content);
    const items = Array.isArray(n.items) ? n.items : [];
    items.forEach((it, index) => {
      if (!it) return;
      push('todo', it.text, { itemId: it.id, itemIndex: index });
    });
    push('group', groupName);
    return out;
  }

  // 将「可能切在代理对中间」的位置对齐到完整码点边界（不产生未配对代理）。
  // isHigh/isLow 判断某个 UTF-16 码元是否分别为高位/低位代理。
  // 仅当 p 恰好落在某个代理对中间（p 指向低位代理、且其前一位是高位代理）时才调整：
  //   alignDown：退到该码点起点（p-1），使切片不包含该码点的后半；
  //   alignUp：  进到该码点之后（p+1），使切片包含完整码点。
  // 其余位置（含恰好指向高位代理起点、或指向代理对之后）保持不变。
  function isHigh(c) { return c >= 0xd800 && c <= 0xdbff; }
  function isLow(c) { return c >= 0xdc00 && c <= 0xdfff; }
  function alignDown(s, p) {
    if (p <= 0) return 0;
    if (p >= s.length) return s.length;
    if (isLow(s.charCodeAt(p)) && isHigh(s.charCodeAt(p - 1))) return p - 1;
    return p;
  }
  function alignUp(s, p) {
    if (p <= 0) return 0;
    if (p >= s.length) return s.length;
    if (isLow(s.charCodeAt(p)) && isHigh(s.charCodeAt(p - 1))) return p + 1;
    return p;
  }

  /**
   * buildSearchSnippet(text, start, end, maxChars = 120)
   * 围绕给定的首个命中区间 [start,end) 生成「纯文本」片段：
   * 返回 { parts: [{text, matched}], truncatedBefore, truncatedAfter }。
   * 契约：
   * - 预算：仅接受「有限且 >= 1」的 maxChars 并向下取整；非有限/<=0/NaN/缺省 -> 120。
   *   绝不把奇数预算向上取整或强制为偶数。窗口严格 <= budget（UTF-16 码元数）。
   * - 空命中区间（start === end，含反向/无效被归一化后的空区间）绝不被扩展成命中：
   *   不产生任何 matched 段（即使 start/end 落在代理对中间）。空区间端点可一起移动到安全边界。
   * - 正长度命中区间先规范化为「完整码点」范围后夹取到文本内；窗口在不超预算前提下尽量包含命中并居中。
   *   命中放不下时，窗口从命中起点（对齐后）开始、长度 <= budget；匹配段被截断但良构。
   *   注意：budget 很小（如 1）且命中是 2 单元的 astral 码点时，窗口可能容不下该码点，此时可返回无 matched 段。
   * - 所有返回的 part 对良构原文都是良构的：绝不在匹配端点或窗口边界处切出未配对代理。
   * - 即使片段被裁剪，命中记录里的 start/end 保持原样（本函数只影响展示）。
   * - 各部分为纯文本，matched 仅布尔；本函数不生成 HTML、不转义（调用方用 textContent/escapeHtml）。
   */
  function buildSearchSnippet(text, start, end, maxChars) {
    const s = String(text == null ? '' : text);
    const budget = (Number.isFinite(maxChars) && maxChars >= 1) ? Math.floor(maxChars) : 120;

    // 规范化命中区间：夹取到文本内
    let st = Number.isInteger(start) ? start : 0;
    let en = Number.isInteger(end) ? end : 0;
    if (st < 0) st = 0;
    if (st > s.length) st = s.length;
    if (en < st) en = st;
    if (en > s.length) en = s.length;
    // 原始是否为空区间：必须在任何码点扩展之前判定，避免把「空」扩展成「命中」
    const isEmpty = en <= st;
    if (isEmpty) {
      // 空区间：端点一起移到安全边界（不扩大为命中）
      st = alignDown(s, st);
      en = st;
    } else {
      // 正长度命中：端点各向外扩展到完整码点，纳入命中所在码点
      st = alignDown(s, st);
      en = alignUp(s, en);
    }
    const hitLen = en - st;

    // 期望窗口：以命中居中；先按预算定长，再夹取到文本范围
    let winStart = st - Math.floor((budget - Math.min(hitLen, budget)) / 2);
    let winEnd = winStart + budget;
    if (winEnd > s.length) { winEnd = s.length; winStart = Math.max(0, winEnd - budget); }
    if (winStart < 0) { winStart = 0; winEnd = Math.min(s.length, budget); }
    // 命中在预算内必须被窗口包含
    if (hitLen <= budget) {
      if (st < winStart) { winStart = st; winEnd = Math.min(s.length, winStart + budget); }
      if (en > winEnd) { winEnd = en; winStart = Math.max(0, winEnd - budget); }
    } else {
      // 命中超预算：窗口从命中起点开始（命中段被截断；极端 budget=1 + astral 时可能无 matched 段）
      winStart = st;
      winEnd = Math.min(s.length, st + budget);
    }
    // 窗口边界向内对齐到完整码点：严格不超预算、不切代理对
    let ws = alignUp(s, winStart);
    let we = alignDown(s, winEnd);
    if (we - ws > budget) we = ws + budget; // 兜底：码点对齐后仍超预算（极少见）时严格收紧
    if (we < ws) we = ws;

    // 匹配段夹取到窗口内（并保持码点完整）
    let mStart = alignUp(s, Math.max(ws, Math.min(st, we)));
    let mEnd = alignDown(s, Math.max(mStart, Math.min(en, we)));
    if (mEnd < mStart) mEnd = mStart;

    const before = ws > 0;
    const after = we < s.length;

    const parts = [];
    if (mStart > ws) parts.push({ text: s.slice(ws, mStart), matched: false });
    if (mEnd > mStart) parts.push({ text: s.slice(mStart, mEnd), matched: true });
    if (we > mEnd) parts.push({ text: s.slice(mEnd, we), matched: false });
    if (!parts.length) parts.push({ text: '', matched: false });

    return { parts, truncatedBefore: before, truncatedAfter: after };
  }

  return { hexToRgba, luminance, contrastRatio, isDarkColor, autoTextColor, noteShadowCss, escapeHtml, refIdsOf, cleanupRefs, sortNotes, tableToMarkdown, noteToMarkdown, referencedMedia, parseNullSeparated, hdropString, setRenderLocale, formatInlineText, inlineImgHtml, fileLinkHtml, tableBlockHtml, renderRichContent, sanitizeCss, clampInt, clampNum, isCssNumber, findNoteSearchMatches, buildSearchSnippet };
});
