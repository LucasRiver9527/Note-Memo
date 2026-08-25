/* 表格数据纯逻辑模块（不含 DOM）：行/列增删、合并/拆分、创建。单一来源，可单测。
   - Node: module.exports
   - 浏览器: 挂 root.TableLogic + 顶层全局，notes-view.js 可直接按名字调用 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.TableLogic = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function newTable(rows, cols, id) {
    const cells = [];
    for (let r = 0; r < rows; r++) cells.push(new Array(cols).fill(''));
    return { id: (id != null ? id : 't' + Math.random().toString(36).slice(2, 8)), rows, cols, cells, merges: [], diagonals: [], borderWidth: 3, borderColor: null, fontSize: null, textColor: null };
  }

  function tableAddRow(tbl) {
    tbl.rows++;
    tbl.cells.push(new Array(tbl.cols).fill(''));
  }
  function tableAddCol(tbl) {
    tbl.cols++;
    (tbl.cells || []).forEach((row) => row.push(''));
  }
  function tableRemoveRow(tbl, r) {
    if (tbl.rows <= 1) return;
    tbl.rows--;
    tbl.cells.splice(r, 1);
    tbl.merges = (tbl.merges || []).filter((m) => m.r !== r).map((m) => m.r > r ? { r: m.r - 1, c: m.c, rowspan: m.rowspan, colspan: m.colspan } : m);
    tbl.diagonals = (tbl.diagonals || []).filter((d) => d.r !== r).map((d) => d.r > r ? { r: d.r - 1, c: d.c, dir: d.dir, t1: d.t1, t2: d.t2 } : d);
  }
  function tableRemoveCol(tbl, c) {
    if (tbl.cols <= 1) return;
    tbl.cols--;
    (tbl.cells || []).forEach((row) => row.splice(c, 1));
    tbl.merges = (tbl.merges || []).filter((m) => m.c !== c).map((m) => m.c > c ? { r: m.r, c: m.c - 1, rowspan: m.rowspan, colspan: m.colspan } : m);
    tbl.diagonals = (tbl.diagonals || []).filter((d) => d.c !== c).map((d) => d.c > c ? { r: d.r, c: d.c - 1, dir: d.dir, t1: d.t1, t2: d.t2 } : d);
  }
  function tableMerge(tbl, r1, c1, r2, c2) {
    if (r1 === r2 && c1 === c2) return;
    tbl.merges = (tbl.merges || []).filter((m) => !(m.r >= r1 && m.r <= r2 && m.c >= c1 && m.c <= c2));
    tbl.diagonals = (tbl.diagonals || []).filter((d) => !(d.r >= r1 && d.r <= r2 && d.c >= c1 && d.c <= c2));
    const joined = [];
    for (let r = r1; r <= r2; r++)
      for (let c = c1; c <= c2; c++) {
        const t = (tbl.cells[r] && tbl.cells[r][c]) || '';
        if (t) joined.push(t);
      }
    tbl.merges.push({ r: r1, c: c1, rowspan: r2 - r1 + 1, colspan: c2 - c1 + 1 });
    tbl.cells[r1][c1] = joined.join(' ');
    for (let r = r1; r <= r2; r++)
      for (let c = c1; c <= c2; c++)
        if (r !== r1 || c !== c1) tbl.cells[r][c] = '';
  }
  function tableSplit(tbl, r, c) {
    const idx = (tbl.merges || []).findIndex((m) => m.r === r && m.c === c);
    if (idx >= 0) tbl.merges.splice(idx, 1);
  }

  return { newTable, tableAddRow, tableAddCol, tableRemoveRow, tableRemoveCol, tableMerge, tableSplit };
}));
