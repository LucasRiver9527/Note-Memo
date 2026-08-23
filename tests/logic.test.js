const { test } = require('node:test');
const assert = require('node:assert');
const {
  hexToRgba, isDarkColor, autoTextColor, escapeHtml, luminance, contrastRatio,
  refIdsOf, cleanupRefs, sortNotes, tableToMarkdown, noteToMarkdown, referencedMedia, parseNullSeparated, hdropString,
  setRenderLocale, formatInlineText, tableBlockHtml, renderRichContent, sanitizeCss,
  I18N, I18N_MERGED, T, mergeI18n
} = require('../renderer/logic.js');

test('hexToRgba 解析颜色', () => {
  assert.strictEqual(hexToRgba('#ff0000', 0.5), 'rgba(255, 0, 0, 0.5)');
  assert.strictEqual(hexToRgba('#00ff00', 1), 'rgba(0, 255, 0, 1)');
  assert.strictEqual(hexToRgba('336699', 0.25), 'rgba(51, 102, 153, 0.25)');
});

test('luminance 相对亮度', () => {
  assert.ok(luminance('#ffffff') > 0.95);
  assert.ok(luminance('#000000') < 0.01);
  assert.ok(luminance('#ffffff') > luminance('#111111'));
  assert.strictEqual(luminance(''), 0);
});

test('contrastRatio WCAG 对比度', () => {
  // 黑白对比接近 21
  const bw = contrastRatio('#000000', '#ffffff');
  assert.ok(bw > 20 && bw <= 21);
  assert.strictEqual(contrastRatio('#ffffff', '#ffffff'), 1);
  // 深字浅底 vs 浅字浅底
  assert.ok(contrastRatio('#2d2f38', '#f4f5fa') > contrastRatio('#ffffff', '#f4f5fa'));
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

// 回归：导出备份与清理孤儿必须共用同一「引用集合」，否则备份漏拷回收站媒体或清理残留孤儿。
test('referencedMedia 一致性：备份媒体集合 = 清理所保留的集合（含回收站、排除孤儿）', () => {
  const data = {
    settings: {},
    notes: [{ images: [{ src: 'note-img://local/keep.png' }] }],
    trash: [{ note: { images: [{ src: 'note-img://local/trash.png' }] } }]
  };
  const refs = referencedMedia(data);
  const orphan = { src: 'note-img://local/orphan.png' };
  // 备份视角：trash 媒体的文件名必须出现在集合里（否则恢复后回收站断图）
  assert.ok(refs.images.has('trash.png'));
  // 清理视角：orphan 的引用 id 不在内容里，不应进入集合（否则清不干净）
  assert.ok(!refs.images.has('orphan.png'));
  // collectMedia（备份）与 cleaner 共用同一函数，故两者所得集合恒等
  assert.deepStrictEqual(Array.from(refs.images).sort(), ['keep.png', 'trash.png']);
});

test('parseNullSeparated 按 \\0 拆分并去重、忽略短项', () => {
  const out = parseNullSeparated('C:\\\\a.txt\0D:\\\\b.txt\0C:\\\\a.txt\0\0x\0', []);
  assert.deepStrictEqual(out, ['C:\\\\a.txt', 'D:\\\\b.txt']);
});

test('hdropString 解析 CF_HDROP 宽字符路径', () => {
  const buf = Buffer.alloc(64);
  buf.writeUInt32LE(20, 0);            // pFiles 偏移 = 20
  buf.writeUInt32LE(1, 16);            // fWide = true
  buf.write('C:\\\\notes\\\\a.txt\0D:\\\\x\0', 20, 'utf16le'); // 从偏移 20 写入路径
  const str = hdropString(buf);
  expectNulPaths(str, ['C:\\\\notes\\\\a.txt', 'D:\\\\x']);
});

test('hdropString 对空/过短缓冲区返回空串', () => {
  assert.strictEqual(hdropString(null), '');
  assert.strictEqual(hdropString(Buffer.alloc(0)), '');
  assert.strictEqual(hdropString(Buffer.alloc(8)), '');
});

// —— 以下为「共享渲染函数」单一来源的回归测试（B）——
test('formatInlineText 加粗/高亮/颜色/链接（默认 mdOn、identity 翻译）', () => {
  setRenderLocale({ tr: (k) => k, mdOn: () => true });
  const out = formatInlineText('普通 **加粗** ==高亮== 和 [[c:#ff0000]]红[[/c]]');
  assert.ok(out.includes('<b>加粗</b>'));
  assert.ok(out.includes('<mark class="hl">高亮</mark>'));
  assert.ok(out.includes('<span style="color:#ff0000">红</span>'));
  const link = formatInlineText('go www.example.com');
  assert.ok(link.includes('http://www.example.com'));
});

test('formatInlineText 受 setRenderLocale 的 mdOn 与翻译器控制', () => {
  setRenderLocale({ tr: (k) => '[' + k + ']', mdOn: () => false });
  const out = formatInlineText('**不转** go www.example.com');
  assert.ok(!out.includes('<b>'));
  assert.ok(!out.includes('<mark'));
  assert.ok(out.includes('**不转**'));
  assert.ok(out.includes('[open_link]')); // 链接提示用自定义翻译器
  setRenderLocale({ tr: (k) => k, mdOn: () => true }); // 复位，避免影响后续用例
});

test('formatInlineText 可被按调用显式覆盖（opts 优先于全局）', () => {
  setRenderLocale({ tr: () => 'GLOBAL', mdOn: () => true });
  // 即便全局 mdOn 已为 true，opts.mdOn=false 仍生效
  const off = formatInlineText('==不转==', { mdOn: () => false });
  assert.ok(!off.includes('<mark'));
  // opts.tr 覆盖全局翻译器
  const t = formatInlineText('go www.example.com', { tr: () => 'X' });
  assert.ok(t.includes('"X"')); // link tooltip 用 opts.tr
  setRenderLocale({ tr: (k) => k, mdOn: () => true });
});

test('tableBlockHtml 生成表格 HTML、斜线表头与样式', () => {
  setRenderLocale({ tr: (k) => k, mdOn: () => true });
  const tbl = { id: 't1', rows: 2, cols: 2, cells: [['A', 'B'], ['C', 'D']], diagonals: [{ r: 0, c: 1, dir: 'trbl', t1: '左', t2: '右' }], borderWidth: 2, borderColor: '#ff0000' };
  const html = tableBlockHtml(tbl);
  assert.ok(html.includes('note-table'));
  assert.ok(html.includes('<td'));
  assert.ok(html.includes('data-table-id="t1"'));
});

test('renderRichContent 组装表格/图片/文件引用', () => {
  setRenderLocale({ tr: (k) => k, mdOn: () => true });
  const note = {
    content: '前[[table:t1]]中[[img:i1]]后',
    tables: [{ id: 't1', rows: 2, cols: 2, cells: [['A', 'B'], ['C', 'D']] }],
    images: [{ id: 'i1', src: 'note-img://local/a.png', w: 120 }]
  };
  const html = renderRichContent(note.content, note);
  assert.ok(html.includes('前'));
  assert.ok(html.includes('note-table'));
  assert.ok(html.includes('inline-img'));
  assert.ok(html.includes('后'));
});

test('sanitizeCss 去掉危险字符、保留合法颜色', () => {
  assert.strictEqual(sanitizeCss('#ff0000'), '#ff0000');
  assert.strictEqual(sanitizeCss('rgba(0,0,0,0.7)'), 'rgba(0,0,0,0.7)');
  assert.strictEqual(sanitizeCss('red'), 'red');
  assert.strictEqual(sanitizeCss(null), '');
  // 注入样式会被剥离开闭字符
  assert.ok(!sanitizeCss('red;position:fixed;z-index:999').includes(';'));
  assert.ok(!sanitizeCss('red;position:fixed').includes(':'));
});

test('内联颜色被清洗，阻断样式注入', () => {
  setRenderLocale({ tr: (k) => k, mdOn: () => true });
  const html = formatInlineText('[[c:#ff0000;position:fixed]]红[[/c]]');
  assert.ok(!html.includes(';'));
  assert.ok(!html.includes('position:'));
  // 合法颜色不受影响
  assert.ok(formatInlineText('[[c:#00ff00]]绿[[/c]]').includes('color:#00ff00'));
});

// —— 国际化单一来源回归 ——
test('I18N 双语完整：zh 与 en 键集合一致，无缺漏', () => {
  const zh = Object.keys(I18N.zh);
  const en = Object.keys(I18N.en);
  assert.deepStrictEqual(zh.sort(), en.sort());
});

test('I18N_MERGED 并集：保留主表与钉窗全部键，note 覆盖 color', () => {
  // 主表专属键仍在
  for (const k of ['app_name', 'settings_title', 'new_note']) {
    assert.ok(k in I18N_MERGED.zh, 'missing merged key: ' + k);
    assert.ok(k in I18N_MERGED.en, 'missing merged en key: ' + k);
  }
  // 钉窗专属键并入
  for (const k of ['notfound', 'opacity', 'unpin']) {
    assert.ok(k in I18N_MERGED.zh, 'missing note key: ' + k);
    assert.ok(k in I18N_MERGED.en, 'missing note en key: ' + k);
  }
  // 唯一差异 color：钉窗覆盖为「改变颜色 / Change color」，主表保持「颜色 / Color」
  assert.strictEqual(I18N_MERGED.zh.color, '改变颜色');
  assert.strictEqual(I18N_MERGED.en.color, 'Change color');
  assert.strictEqual(I18N.zh.color, '颜色');
  assert.strictEqual(I18N.en.color, 'Color');
});

test('T 按语言取值并回退 zh/key', () => {
  assert.strictEqual(T('app_name', 'zh'), '便签');
  assert.strictEqual(T('app_name', 'en'), 'Notes');
  assert.strictEqual(T('app_name', 'fr'), '便签');      // 未知语言回退 zh
  assert.strictEqual(T('unknown_key', 'zh'), 'unknown_key'); // 缺失回退 key
  assert.strictEqual(T('color', 'zh', I18N_MERGED), '改变颜色'); // 钉窗表覆盖
});

test('mergeI18n 以 b 覆盖 a，并保留并集', () => {
  const a = { zh: { x: 'ax', y: 'ay' }, en: { x: 'ax' } };
  const b = { zh: { y: 'by', z: 'bz' }, en: { y: 'by' } };
  const m = mergeI18n(a, b);
  assert.strictEqual(m.zh.x, 'ax');
  assert.strictEqual(m.zh.y, 'by'); // b 覆盖
  assert.strictEqual(m.zh.z, 'bz');
  assert.strictEqual(m.en.x, 'ax');
  assert.strictEqual(m.en.y, 'by');
});

function expectNulPaths(str, expected) {
  const got = str.split('\0').filter((p) => p && p.length > 1);
  assert.deepStrictEqual(got, expected);
}
