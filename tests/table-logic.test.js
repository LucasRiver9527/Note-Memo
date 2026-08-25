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
