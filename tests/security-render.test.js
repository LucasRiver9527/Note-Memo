// P0-04 渲染侧安全回归：恶意/损坏的导入字段不得注入标记或造成超大循环。
// 解析真实 logic.js 生成的 HTML（jsdom），断言无注入锚点/内联事件、数值有界、合法值保持。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const logic = require('../renderer/logic.js');

function render(note) {
  logic.setRenderLocale({ tr: (k) => k, mdOn: () => true });
  const html = logic.renderRichContent(note.content || '', note);
  const dom = new JSDOM(`<!doctype html><html><body><div class="note-content">${html}</div></body></html>`);
  return { html, doc: dom.window.document };
}

function inlineHandlerCount(doc) {
  let n = 0;
  doc.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes).forEach((a) => { if (/^on/i.test(a.name)) n++; });
  });
  return n;
}

test('恶意 img.w 不能注入锚点/事件，宽度回退且 src 保留', () => {
  const note = {
    content: '[[img:i1]]',
    images: [{ id: 'i1', src: 'note-img://local/ok.png', w: '200" ><a href="https://evil.example/x">p</a><img src="x' }]
  };
  const { html, doc } = render(note);
  assert.strictEqual(doc.querySelectorAll('a').length, 0);
  assert.strictEqual(inlineHandlerCount(doc), 0);
  assert.ok(!html.includes('evil.example'));
  const img = doc.querySelector('.inline-img img');
  assert.strictEqual(img.getAttribute('src'), 'note-img://local/ok.png');
  assert.match(img.getAttribute('style'), /width:200px/);
});

test('img.w 的极端/非法值有界且不抛错，数据不被修改', () => {
  const cases = [1e9, -5, 33.7, NaN, Infinity, {}, [], 'abc', '2e3', null, undefined, 0];
  for (const w of cases) {
    const note = { content: '[[img:i1]]', images: [{ id: 'i1', src: 'note-img://local/a.png', w }] };
    const { doc } = render(note);
    const img = doc.querySelector('.inline-img img');
    const m = /width:([0-9.]+)px/.exec(img.getAttribute('style'));
    assert.ok(m, 'width rendered for ' + String(w));
    const val = Number(m[1]);
    assert.ok(isFinite(val) && val >= 1 && val <= 100000, 'bounded width for ' + String(w) + ': ' + val);
    assert.strictEqual(note.images[0].w, w); // 原始值未被改写
  }
});

test('JSON 往返的恶意数值对象在各字段不抛错、回退默认且不改数据', () => {
  const hostile = JSON.parse('{"toString":null,"valueOf":0}');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(hostile)), hostile);
  const note = {
    content: '[[img:i1]][[table:t1]][[table:t2]]',
    images: [{ id: 'i1', src: 'note-img://local/a.png', w: hostile }],
    files: [],
    tables: [
      {
        id: 't1', rows: hostile, cols: hostile, cells: [['x']], borderWidth: hostile,
        merges: [{ r: 0, c: 0, rowspan: hostile, colspan: hostile }],
        diagonals: [{ r: 0, c: 0, dir: 'tlbr', tColor: '#808080', tSize: hostile }]
      },
      {
        id: 't2', rows: 1, cols: 1, cells: [['x']], fontSize: hostile,
        merges: [], diagonals: [{ r: 0, c: 0, dir: 'tlbr', tColor: '#808080', tSize: hostile }]
      }
    ]
  };
  const snapshot = JSON.stringify(note);
  const { html, doc } = render(note); // 不得抛错
  assert.ok(typeof html === 'string');
  assert.match(doc.querySelector('.inline-img img').getAttribute('style'), /width:200px/);
  const tables = doc.querySelectorAll('table.note-table');
  assert.strictEqual(tables.length, 2);
  assert.match(tables[0].getAttribute('style'), /--tbl-border-width:3px/); // hostile rows -> 0 行，宽度回退 3
  assert.ok(!tables[1].getAttribute('style').includes('font-size'));       // hostile fontSize -> 省略
  assert.strictEqual(doc.querySelectorAll('td').length, 1);                // t2 正常 1 单元格，t1 0 行
  assert.strictEqual(JSON.stringify(note), snapshot);                      // 原始数据未被修改
});

test('恶意 table.borderWidth / merge span 不能注入锚点，跨度被夹取', () => {
  const note = {
    content: '[[table:t1]]',
    tables: [{
      id: 't1', rows: 1, cols: 1, cells: [['x']],
      borderWidth: '3"><a href="https://evil.example/t">t</a>',
      borderColor: 'rgba(0,0,0,0.7)',
      merges: [{ r: 0, c: 0, rowspan: '1"><a href="https://evil.example/s">s</a>', colspan: '1"></span><script>x</script>' }]
    }]
  };
  const { html, doc } = render(note);
  assert.strictEqual(doc.querySelectorAll('a').length, 0);
  assert.strictEqual(doc.querySelectorAll('script').length, 0);
  assert.strictEqual(inlineHandlerCount(doc), 0);
  assert.ok(!html.includes('evil.example'));
  const table = doc.querySelector('table.note-table');
  assert.match(table.getAttribute('style'), /--tbl-border-width:3px/);
  const td = doc.querySelector('td');
  assert.strictEqual(td.getAttribute('rowspan'), '1');
  assert.strictEqual(td.getAttribute('colspan'), '1');
});

test('巨大 rows/cols 被限制在渲染预算内且不修改原始表格对象', () => {
  const tblRows = { id: 't1', rows: 1e9, cols: 1, cells: [['x']], merges: [], diagonals: [] };
  const r1 = render({ content: '[[table:t1]]', tables: [tblRows] });
  assert.ok(r1.doc.querySelectorAll('table.note-table tr').length <= 200);
  assert.ok(r1.doc.querySelectorAll('table.note-table tr').length >= 1);
  assert.strictEqual(tblRows.rows, 1e9);

  const tblCols = { id: 't2', rows: 1, cols: 1e9, cells: [['x']], merges: [], diagonals: [] };
  const r2 = render({ content: '[[table:t2]]', tables: [tblCols] });
  assert.ok(r2.doc.querySelectorAll('table.note-table td').length <= 200);
  assert.strictEqual(tblCols.cols, 1e9);
});

test('非数组 cells/merges/diagonals 不抛异常', () => {
  const { html } = render({ content: '[[table:t1]]', tables: [{ id: 't1', rows: 1, cols: 1, cells: 'x', merges: 'y', diagonals: {} }] });
  assert.ok(typeof html === 'string');
});

test('合法数值字符串宽度、零边框、正常合并与颜色保持不变', () => {
  const note = {
    content: '[[img:i1]][[table:t1]]',
    images: [{ id: 'i1', src: 'note-img://local/a.png', w: '150' }],
    tables: [{
      id: 't1', rows: 2, cols: 2, cells: [['A', 'B'], ['C', 'D']],
      borderWidth: '0', borderColor: '#ff0000', textColor: '#00ff00', fontSize: '16',
      merges: [{ r: 0, c: 0, rowspan: 2, colspan: 1 }], diagonals: []
    }]
  };
  const { doc } = render(note);
  assert.match(doc.querySelector('.inline-img img').getAttribute('style'), /width:150px/);
  const table = doc.querySelector('table.note-table');
  assert.match(table.getAttribute('style'), /--tbl-border-width:0px/);
  assert.match(table.getAttribute('style'), /--tbl-border-color:#ff0000/);
  assert.match(table.getAttribute('style'), /color:#00ff00/);
  assert.match(table.getAttribute('style'), /font-size:16px/);
  // rowspan=2 覆盖第 2 行首列 -> 只剩 3 个 td（A 跨两行 + B + D）
  assert.strictEqual(doc.querySelectorAll('td').length, 3);
  assert.strictEqual(doc.querySelector('td').getAttribute('rowspan'), '2');
});

test('恶意 file id / path 转义为惰性属性，不产生元素', () => {
  const note = { content: '[[file:f1]]', files: [{ id: 'f1', path: 'C:/x/<b>a</b>.txt', isDir: false }] };
  const { doc } = render(note);
  assert.strictEqual(doc.querySelectorAll('b').length, 0);
  const fl = doc.querySelector('.file-link');
  assert.ok(fl);
  assert.strictEqual(fl.getAttribute('data-path'), 'C:/x/<b>a</b>.txt');
});
