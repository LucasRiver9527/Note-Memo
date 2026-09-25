const { test } = require('node:test');
const assert = require('node:assert');
const { newTable, tableAddRow, tableAddCol, tableRemoveRow, tableRemoveCol, tableMerge, tableSplit } = require('../renderer/table-logic.js');

test('newTable：创建 rows×cols 空表与默认样式', () => {
  const t = newTable(2, 3, 't1');
  assert.strictEqual(t.id, 't1');
  assert.strictEqual(t.rows, 2);
  assert.strictEqual(t.cols, 3);
  assert.deepStrictEqual(t.cells, [['', '', ''], ['', '', '']]);
  assert.deepStrictEqual(t.merges, []);
  assert.strictEqual(t.borderWidth, 3);
});

test('tableAddRow / tableAddCol：行列增减', () => {
  const t = newTable(2, 2, 't');
  tableAddRow(t);
  assert.strictEqual(t.rows, 3);
  assert.strictEqual(t.cells.length, 3);
  assert.strictEqual(t.cells[2].length, 2);
  tableAddCol(t);
  assert.strictEqual(t.cols, 3);
  t.cells.forEach((row) => assert.strictEqual(row.length, 3));
});

test('tableRemoveRow：删行并校正合并/斜线行号', () => {
  const t = newTable(3, 3, 't');
  t.cells[0][0] = 'A'; t.cells[1][1] = 'B'; t.cells[2][2] = 'C';
  t.merges = [{ r: 2, c: 0, rowspan: 1, colspan: 1 }];
  t.diagonals = [{ r: 2, c: 1, dir: 'tlbr', t1: 'x', t2: 'y' }];
  tableRemoveRow(t, 0);
  assert.strictEqual(t.rows, 2);
  assert.deepStrictEqual(t.cells[0], ['', 'B', '']);
  assert.deepStrictEqual(t.merges, [{ r: 1, c: 0, rowspan: 1, colspan: 1 }]);
  assert.deepStrictEqual(t.diagonals, [{ r: 1, c: 1, dir: 'tlbr', t1: 'x', t2: 'y' }]);
});

test('tableRemoveCol：删列并校正合并/斜线列号', () => {
  const t = newTable(2, 3, 't');
  t.merges = [{ r: 0, c: 2, rowspan: 1, colspan: 1 }];
  t.diagonals = [{ r: 1, c: 2, dir: 'tlbr', t1: 'x', t2: 'y' }];
  tableRemoveCol(t, 0);
  assert.strictEqual(t.cols, 2);
  assert.deepStrictEqual(t.merges, [{ r: 0, c: 1, rowspan: 1, colspan: 1 }]);
  assert.deepStrictEqual(t.diagonals, [{ r: 1, c: 1, dir: 'tlbr', t1: 'x', t2: 'y' }]);
});

test('tableMerge：合并范围、合并文本、清空其余、记录 merge', () => {
  const t = newTable(2, 2, 't');
  t.cells = [['甲', '乙'], ['丙', '丁']];
  tableMerge(t, 0, 0, 1, 1);
  assert.strictEqual(t.cells[0][0], '甲 乙 丙 丁');
  assert.strictEqual(t.cells[0][1], '');
  assert.strictEqual(t.cells[1][0], '');
  assert.strictEqual(t.cells[1][1], '');
  assert.deepStrictEqual(t.merges, [{ r: 0, c: 0, rowspan: 2, colspan: 2 }]);
});

test('tableMerge：单格不产生合并', () => {
  const t = newTable(2, 2, 't');
  tableMerge(t, 1, 1, 1, 1);
  assert.deepStrictEqual(t.merges, []);
});

test('tableSplit：移除指定单元格的合并', () => {
  const t = newTable(2, 2, 't');
  t.merges = [{ r: 0, c: 0, rowspan: 2, colspan: 2 }];
  tableSplit(t, 0, 0);
  assert.deepStrictEqual(t.merges, []);
});

/* ============ 边界安全（2026-09-23 补）：越界必须无操作，不得污染数据或抛错 ============ */

test('★ 关键回归：越界删行必须无操作（此前 rows 减了、cells 没删，导致数据脱节）', () => {
  const t = newTable(3, 2, 't');
  tableRemoveRow(t, 99);
  assert.strictEqual(t.rows, 3, 'rows 不应变化');
  assert.strictEqual(t.cells.length, 3, 'cells 行数应与 rows 保持一致');
});

test('★ 关键回归：负数索引删行必须无操作（此前 -1 会误删最后一行）', () => {
  const t = newTable(3, 1, 't');
  t.cells[0][0] = 'A'; t.cells[1][0] = 'B'; t.cells[2][0] = 'C';
  tableRemoveRow(t, -1);
  assert.strictEqual(t.rows, 3, 'rows 不应变化');
  assert.deepStrictEqual(t.cells.map((r) => r[0]), ['A', 'B', 'C'], '不应误删最后一行');
});

test('★ 关键回归：越界删列必须无操作', () => {
  const t = newTable(2, 3, 't');
  tableRemoveCol(t, 99);
  assert.strictEqual(t.cols, 3);
  t.cells.forEach((row) => assert.strictEqual(row.length, 3, '列宽应与 cols 保持一致'));

  const t2 = newTable(2, 3, 't');
  tableRemoveCol(t2, -1);
  assert.strictEqual(t2.cols, 3, '负数索引不应删列');
});

test('★ 关键回归：越界合并不得抛错，且不得改动数据（此前 TypeError 崩溃）', () => {
  const t = newTable(2, 2, 't');
  t.cells = [['甲', '乙'], ['丙', '丁']];
  assert.doesNotThrow(() => tableMerge(t, 0, 0, 5, 5), '越界合并抛异常');
  assert.deepStrictEqual(t.merges, [], '越界合并不应产生合并记录');
  assert.deepStrictEqual(t.cells, [['甲', '乙'], ['丙', '丁']], '越界合并不应清空原数据');
});

test('★ 关键回归：负数/反向坐标合并必须无操作', () => {
  const t = newTable(2, 2, 't');
  t.cells = [['甲', '乙'], ['丙', '丁']];
  assert.doesNotThrow(() => tableMerge(t, -1, -1, 1, 1));
  assert.deepStrictEqual(t.cells, [['甲', '乙'], ['丙', '丁']], '负坐标合并污染了数据');
  assert.deepStrictEqual(t.merges, []);
});

test('最后一行/最后一列删除被拒绝（不得把表格删空）', () => {
  const t = newTable(1, 1, 't');
  tableRemoveRow(t, 0);
  assert.strictEqual(t.rows, 1, '不应删掉唯一行');
  tableRemoveCol(t, 0);
  assert.strictEqual(t.cols, 1, '不应删掉唯一列');
});

test('tableSplit 对越界坐标为无操作（不抛错）', () => {
  const t = newTable(2, 2, 't');
  t.merges = [{ r: 0, c: 0, rowspan: 2, colspan: 2 }];
  assert.doesNotThrow(() => tableSplit(t, 99, 99));
  assert.deepStrictEqual(t.merges, [{ r: 0, c: 0, rowspan: 2, colspan: 2 }], '越界拆分不应破坏已有合并');
});

/* ============ 既有设计行为的固化（不是 bug，但改动前须知） ============ */

test('设计固化：只有合并区左上角能拆分，区域内其它格无效', () => {
  const t = newTable(2, 2, 't');
  t.merges = [{ r: 0, c: 0, rowspan: 2, colspan: 2 }];
  tableSplit(t, 1, 1);
  assert.deepStrictEqual(t.merges, [{ r: 0, c: 0, rowspan: 2, colspan: 2 }],
    '非左上角拆分若改为生效，须同步 UI 与渲染层的 occupied 计算');
});

test('设计固化：删中间行不收缩跨越合并的 rowspan（超出表格底部的合并由渲染层按边界兜住）', () => {
  const t = newTable(3, 1, 't');
  t.merges = [{ r: 0, c: 0, rowspan: 3, colspan: 1 }];
  tableRemoveRow(t, 1);
  assert.deepStrictEqual(t.merges, [{ r: 0, c: 0, rowspan: 3, colspan: 1 }],
    '若改为收缩 rowspan，须同步 tableBlockHtml 的 occupied 逻辑');
});

test('设计固化：addRow/addCol 不扩展已有合并的跨度（合并保持在原范围）', () => {
  const t = newTable(2, 2, 't');
  t.merges = [{ r: 0, c: 0, rowspan: 2, colspan: 2 }];
  tableAddCol(t);
  tableAddRow(t);
  assert.deepStrictEqual(t.merges, [{ r: 0, c: 0, rowspan: 2, colspan: 2 }]);
});

test('newTable 接受 0 行 0 列（不抛错，返回空 cells）', () => {
  const t = newTable(0, 0, 't');
  assert.strictEqual(t.rows, 0);
  assert.deepStrictEqual(t.cells, []);
});

test('tableMerge 覆盖已有合并：旧合并被替换，不残留', () => {
  const t = newTable(3, 3, 't');
  t.merges = [{ r: 0, c: 0, rowspan: 2, colspan: 2 }];
  tableMerge(t, 0, 0, 2, 2);
  assert.strictEqual(t.merges.length, 1, '旧合并未被替换，会产生重叠渲染');
  assert.deepStrictEqual(t.merges, [{ r: 0, c: 0, rowspan: 3, colspan: 3 }]);
});

test('tableMerge 清掉范围内的斜线表头（避免合并区残留斜线）', () => {
  const t = newTable(2, 2, 't');
  t.diagonals = [{ r: 0, c: 0, dir: 'tlbr', t1: 'x', t2: 'y' }];
  tableMerge(t, 0, 0, 1, 1);
  assert.deepStrictEqual(t.diagonals, [], '合并区内的斜线表头应被清除');
});

test('tableMerge 只拼接非空文本（空格不会因为空单元格而累积）', () => {
  const t = newTable(1, 3, 't');
  t.cells = [['甲', '', '乙']];
  tableMerge(t, 0, 0, 0, 2);
  assert.strictEqual(t.cells[0][0], '甲 乙', '空单元格不应贡献多余空格');
});
