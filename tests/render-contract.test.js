const { test } = require('node:test');
const assert = require('node:assert');
const { renderRichContent, formatInlineText } = require('../renderer/logic.js');

const IMG = { id: 'i1', src: 'note-img://local/a.png', w: 120 };
const FILE = { id: 'f1', path: 'C:\\notes\\a.txt', isDir: false };
const TABLE = { id: 't1', rows: 2, cols: 2, cells: [['A', 'B'], ['C', 'D']], borderWidth: 3 };
const note = { images: [IMG], files: [FILE], tables: [TABLE] };
const opts = {};

function stripMarkerHtml(html) {
  // 渲染结果里不应残留任何 [[ 标记（否则会显示为文字）
  return html.replace(/\[\[/g, '').length === html.replace(/\]\]/g, '').length && !html.includes('[[align') && !html.includes('[[img:') && !html.includes('[[/');
}

test('renderRichContent: 图片渲染为 inline-img 且不泄漏标记', () => {
  const html = renderRichContent('前文[[img:i1]]后文', note, opts);
  assert.ok(html.includes('class="inline-img"'), '应包含 inline-img');
  assert.ok(html.includes('data-img-id="i1"'));
  assert.ok(!html.includes('[[img:'), '不应残留 [[img:');
  assert.ok(!html.includes('[[/'), '不应残留 [[/');
});

test('renderRichContent: 段落对齐渲染为 note-align 块，不泄漏', () => {
  const html = renderRichContent('[[align:center]]居中内容[[/align]]', note, opts);
  assert.ok(html.includes('note-align-center'));
  assert.ok(html.includes('text-align:center'));
  assert.ok(!html.includes('[[align'), '不应残留 [[align');
});

test('renderRichContent: 对齐包裹图片时图片仍为 inline-block（不拉伸 ✕）', () => {
  const html = renderRichContent('[[align:center]][[img:i1]][[/align]]', note, opts);
  assert.ok(html.includes('note-align-center'));
  // 图片不应被强制 display:block
  const imgSpan = /<span class="inline-img"[^>]*>/.exec(html);
  assert.ok(imgSpan, '应存在 inline-img span');
  assert.ok(!/inline-img"[^>]*style="display:block/.test(html), '图片不应被强制 block');
});

test('renderRichContent: 高亮/加粗/颜色/链接正常生成', () => {
  const html = renderRichContent('==高亮== **加粗** [[c:#ff0000]]红[[/c]] www.example.com', note, { ...opts, tr: (k) => k });
  assert.ok(html.includes('<mark class="hl">高亮</mark>'));
  assert.ok(html.includes('<b>加粗</b>'));
  assert.ok(html.includes('color:#ff0000'));
  assert.ok(html.includes('note-link'));
});

test('renderRichContent: 表格/文件引用正常生成', () => {
  const html = renderRichContent('[[table:t1]][[file:f1]]', note, opts);
  assert.ok(html.includes('note-table-block'));
  assert.ok(html.includes('file-link'));
});

test('renderRichContent: 反复渲染对齐块不产生嵌套或残留', () => {
  let s = '打字[[align:center]][[img:i1]]居中[[/align]]';
  const imgs = [IMG];
  for (let i = 0; i < 3; i++) {
    const html = renderRichContent(s, { images: imgs }, opts);
    assert.ok(!html.includes('[[align'), '第 ' + i + ' 次渲染残留 [[align');
    assert.ok(!html.includes('[[img:'), '第 ' + i + ' 次渲染残留 [[img:');
    // 重新构造相同标记（等价于理想序列化器输出）
    s = '[[align:center]][[img:i1]]居中[[/align]]';
  }
});

test('formatInlineText: 括号/标记相关纯文本不被误吞', () => {
  assert.strictEqual(formatInlineText('普通文本没有标记', opts), '普通文本没有标记');
});
