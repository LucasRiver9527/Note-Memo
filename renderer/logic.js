/* 纯逻辑模块：颜色、转义、引用清理、排序。
   作为普通 <script> 在页面加载（挂到 window.NoteLogic / 顶层全局），
   也可被 Node 测试 require（module.exports）。单一来源，便于测试。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.NoteLogic = fns;
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

  // 便签排序，settings 传 { sortMode, noteOrder }
  function sortNotes(arr, settings) {
    const mode = (settings && settings.sortMode) || 'updated';
    const order = (settings && settings.noteOrder) || [];
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

  return { hexToRgba, isDarkColor, autoTextColor, escapeHtml, refIdsOf, cleanupRefs, sortNotes, tableToMarkdown, noteToMarkdown, referencedMedia };
});
