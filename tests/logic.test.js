const { test } = require('node:test');
const assert = require('node:assert');
const {
  hexToRgba, isDarkColor, autoTextColor, escapeHtml,
  refIdsOf, cleanupRefs, sortNotes, tableToMarkdown, noteToMarkdown, referencedMedia
} = require('../renderer/logic.js');

test('hexToRgba 解析颜色', () => {
  assert.strictEqual(hexToRgba('#ff0000', 0.5), 'rgba(255, 0, 0, 0.5)');
  assert.strictEqual(hexToRgba('#00ff00', 1), 'rgba(0, 255, 0, 1)');
  assert.strictEqual(hexToRgba('336699', 0.25), 'rgba(51, 102, 153, 0.25)');
});

test('isDarkColor 判断明暗', () => {
  assert.strictEqual(isDarkColor('#000000'), true);
  assert.strictEqual(isDarkColor('#ffffff'), false);
  assert.strictEqual(isDarkColor('#1e1f26'), true);   // 深色主题底
  assert.strictEqual(isDarkColor('#f4f5fa'), false);  // 浅色底
  assert.strictEqual(isDarkColor(''), true);          // 空值按暗色处理
});

test('autoTextColor 自动文字色', () => {
  assert.strictEqual(autoTextColor('#000000'), '#ffffff');
  assert.strictEqual(autoTextColor('#ffffff'), '#2d2f38');
});

test('escapeHtml 转义特殊字符', () => {
  assert.strictEqual(escapeHtml('<a>'), '&lt;a&gt;');
  assert.strictEqual(escapeHtml(`"&'`), '&quot;&amp;&#39;');
  assert.strictEqual(escapeHtml(123), '123');
});

test('refIdsOf 收集引用的图/文件/表格 id', () => {
  const n = { content: '文字[[img:i1]]和[[file:f2]]和[[table:t3]]以及[[' };
  const ids = refIdsOf(n);
  assert.ok(ids.has('i1'));
  assert.ok(ids.has('f2'));
  assert.ok(ids.has('t3'));
  assert.strictEqual(ids.size, 3);
  assert.strictEqual(refIdsOf({ content: '无引用' }).size, 0);
});

test('cleanupRefs 剔除未被引用的媒体', () => {
  const n = {
    content: '见[[img:keep]]和[[file:keepF]]和[[table:keepT]]',
    images: [{ id: 'keep' }, { id: 'drop' }],
    files: [{ id: 'keepF' }, { id: 'dropF' }],
    tables: [{ id: 'keepT' }, { id: 'dropT' }]
  };
  cleanupRefs(n);
  assert.deepStrictEqual(n.images.map((x) => x.id), ['keep']);
  assert.deepStrictEqual(n.files.map((x) => x.id), ['keepF']);
  assert.deepStrictEqual(n.tables.map((x) => x.id), ['keepT']);
  cleanupRefs(null); // 不应抛错
});

test('sortNotes 按更新时间（默认 updated）', () => {
  const arr = [
    { id: 'a', updatedAt: 100, createdAt: 1 },
    { id: 'b', updatedAt: 300, createdAt: 2 },
    { id: 'c', updatedAt: 200, createdAt: 3 }
  ];
  const r = sortNotes(arr, {}).map((x) => x.id);
  assert.deepStrictEqual(r, ['b', 'c', 'a']);
});

test('sortNotes 按创建时间 created', () => {
  const arr = [{ id: 'a', createdAt: 3 }, { id: 'b', createdAt: 1 }, { id: 'c', createdAt: 2 }];
  const r = sortNotes(arr, { sortMode: 'created' }).map((x) => x.id);
  assert.deepStrictEqual(r, ['a', 'c', 'b']);
});

test('sortNotes 置顶优先（除 custom）', () => {
  const arr = [
    { id: 'a', pinned: true, updatedAt: 1 },
    { id: 'b', pinned: false, updatedAt: 99 }
  ];
  const r = sortNotes(arr, { sortMode: 'updated' }).map((x) => x.id);
  assert.strictEqual(r[0], 'a');
});

test('sortNotes 自定义顺序 + 未出现项按创建时间置尾', () => {
  const arr = [
    { id: 'x', createdAt: 100 },
    { id: 'y', createdAt: 200 },
    { id: 'z', createdAt: 300 }
  ];
  const r = sortNotes(arr, { sortMode: 'custom', noteOrder: ['z', 'x'] }).map((x) => x.id);
  assert.deepStrictEqual(r, ['z', 'x', 'y']);
});

test('sortNotes 不修改原数组', () => {
  const arr = [{ id: 'a', updatedAt: 1 }];
  sortNotes(arr, {});
  assert.strictEqual(arr.length, 1);
});

test('noteToMarkdown 处理标题/加粗/高亮/颜色', () => {
  const md = noteToMarkdown({ title: '备忘', content: '**bold** 与 ==hi== 以及[[c:#ff0000]]红[[/c]]' });
  assert.ok(md.includes('# 备忘'));
  assert.ok(md.includes('**bold**'));
  assert.ok(md.includes('<mark>hi</mark>'));
  assert.ok(md.includes('<span style="color:#ff0000">红</span>'));
});

test('noteToMarkdown 图片可被解密器替换（自包含）', () => {
  const md = noteToMarkdown({ title: '', content: '[[img:i1]]', images: [{ id: 'i1', src: 'note-img://local/a.png' }] }, { image: (src) => 'data:image/png;base64,AAA' });
  assert.ok(md.includes('![i1](data:image/png;base64,AAA)'));
});

test('noteToMarkdown 文件链接', () => {
  const md = noteToMarkdown({ content: '[[file:f1]]', files: [{ id: 'f1', path: 'C:\\\\notes\\\\a.txt' }] });
  assert.ok(md.includes('[a.txt]'));
});

test('noteToMarkdown 表格', () => {
  const tbl = { id: 't1', rows: 2, cols: 2, cells: [['A', 'B'], ['C', 'D']] };
  const md = noteToMarkdown({ content: '[[table:t1]]', tables: [tbl] });
  assert.ok(md.includes('| A | B |'));
  assert.ok(md.includes('| --- | --- |'));
  assert.ok(md.includes('| C | D |'));
});

test('noteToMarkdown 待办清单', () => {
  const md = noteToMarkdown({ type: 'todo', items: [{ text: '买咖啡', done: true }, { text: '写代码', done: false }] });
  assert.ok(md.includes('- [x] 买咖啡'));
  assert.ok(md.includes('- [ ] 写代码'));
});

test('tableToMarkdown 处理合并单元格与斜线表头不抛错', () => {
  const tbl = { rows: 2, cols: 2, cells: [['A', ''], ['', 'B']], merges: [{ r: 0, c: 0, rowspan: 2, colspan: 1 }], diagonals: [{ r: 0, c: 1, dir: 'trbl', t1: '左', t2: '右' }] };
  const md = tableToMarkdown(tbl);
  assert.ok(typeof md === 'string' && md.length > 0);
});

test('referencedMedia 收集被引用的媒体（含回收站），不含孤儿', () => {
  const data = {
    settings: { backgroundImage: 'note-bg://local/bg-x.png', customFonts: [{ url: 'note-font://local/f.tf' }], reminderSoundPath: 'note-sound://local/s.mp3' },
    notes: [{ images: [{ src: 'note-img://local/a.png' }] }],
    trash: [{ note: { images: [{ src: 'note-img://local/b.png' }] } }]
  };
  const r = referencedMedia(data);
  assert.ok(r.images.has('a.png'));
  assert.ok(r.images.has('b.png')); // 回收站里的也要保留
  assert.ok(r.backgrounds.has('bg-x.png'));
  assert.ok(r.fonts.has('f.tf'));
  assert.ok(r.sounds.has('s.mp3'));
  assert.ok(!r.images.has('orphan.png')); // 未引用 -> 孤儿
});
