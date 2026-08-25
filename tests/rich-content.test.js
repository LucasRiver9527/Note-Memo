const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { renderRichContent } = require('../renderer/logic.js');
const { readRichContent, uid } = require('../renderer/rich-content.js');

const IMG = { id: 'i1', src: 'note-img://local/a.png', w: 120 };
const FILE = { id: 'f1', path: 'C:\\notes\\a.txt', isDir: false };
const TABLE = { id: 't1', rows: 2, cols: 2, cells: [['A', 'B'], ['C', 'D']], borderWidth: 3 };
const note = { images: [IMG], files: [FILE], tables: [TABLE] };

function roundTrip(markerText, n, opts) {
  // render（logic）-> HTML -> DOM（jsdom）-> read（rich-content）-> 标记
  const html = renderRichContent(markerText, n || note, opts || {});
  const dom = new JSDOM('<!DOCTYPE html><body></body>');
  const root = dom.window.document.createElement('div');
  root.innerHTML = html;
  return { html, markers: readRichContent(root) };
}

test('uid 按前缀生成（app=n / 钉窗=i），不冲突', () => {
  assert.ok(uid('n').startsWith('n'));
  assert.ok(uid('i').startsWith('i'));
  assert.notStrictEqual(uid('n'), uid('n'));
});

test('readRichContent: 纯文本原样读取', () => {
  const { markers } = roundTrip('普通文本没有标记');
  assert.strictEqual(markers, '普通文本没有标记');
});

test('readRichContent: 图片序列化为 [[img:id]] 且不泄漏 ✕ 按钮', () => {
  const { html, markers } = roundTrip('前文[[img:i1]]后文');
  assert.ok(html.includes('inline-img'));
  assert.strictEqual(markers, '前文[[img:i1]]后文');
  assert.ok(!markers.includes('✕'), '不应把删除按钮文字读回');
});

test('readRichContent: 文件引用读回 [[file:id]]', () => {
  const { markers } = roundTrip('[[file:f1]]');
  assert.strictEqual(markers, '[[file:f1]]');
});

test('readRichContent: 表格读回 [[table:id]] 且不泄漏单元格文本', () => {
  const { html, markers } = roundTrip('[[table:t1]]');
  assert.ok(html.includes('note-table-block'));
  assert.strictEqual(markers, '[[table:t1]]');
});

test('readRichContent: 加粗/高亮/颜色互逆', () => {
  assert.strictEqual(roundTrip('**加粗**').markers, '**加粗**');
  assert.strictEqual(roundTrip('==高亮==').markers, '==高亮==');
  // 颜色会被浏览器归一化为 rgb(...)，但必须读回同构的颜色标记
  const color = roundTrip('[[c:#ff0000]]红[[/c]]').markers;
  assert.match(color, /^\[\[c:[^\]]+\]\]红\[\[\/c\]\]$/);
});

test('readRichContent: 对齐块互逆', () => {
  const { html, markers } = roundTrip('打字[[align:center]][[img:i1]]居中[[/align]]');
  assert.ok(html.includes('note-align-center'));
  assert.strictEqual(markers, '打字[[align:center]][[img:i1]]居中[[/align]]');
});

test('readRichContent: 换行（<br>）读回为 \\n', () => {
  const { markers } = roundTrip('第一行\n第二行');
  assert.strictEqual(markers, '第一行\n第二行');
});

test('readRichContent: 反复渲染对齐块不产生嵌套或残留', () => {
  // 关键防回归：read(render(s)) 是稳定的（幂等 = 不会"改一处崩一处"）
  let s = '打字[[align:center]][[img:i1]]居中[[/align]]';
  const first = roundTrip(s).markers;
  for (let i = 0; i < 3; i++) {
    const again = roundTrip(first).markers;
    assert.strictEqual(again, first, '第 ' + i + ' 次读回后应稳定，不新增嵌套/残留');
  }
  // 且能回到原始结构
  assert.strictEqual(first, s);
});
