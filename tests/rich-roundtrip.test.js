/* 富文本序列化往返测试：readRichContent(DOM) ↔ renderRichContent(marker)。
   历史教训（见 renderer/rich-content.js 头部）：改序列化协议（[[img]]/[[align]]/高亮/[[c:]] 等 marker）
   必须双向同步，否则会出现「[[align:left]] 泄漏成文字」「每次编辑 [ 累积」「✕ 删除按钮乱飞」。
   本文件即该约束的守护网：任何一侧改形，这里必须立刻红。

   运行：node --test tests/rich-roundtrip.test.js */
const { test, before } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const { renderRichContent, setRenderLocale, escapeHtml } = require('../renderer/logic.js');
const { readRichContent } = require('../renderer/rich-content.js');

let doc;
before(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  doc = dom.window.document;
  // 与运行时一致：身份翻译器 + Markdown 开启
  setRenderLocale({ tr: (k) => k, mdOn: () => true });
});

// 渲染 → 写进 DOM → 读回 → 应还原为等价 marker
function roundTrip(text, note) {
  const html = renderRichContent(text, note || {});
  const host = doc.createElement('div');
  host.innerHTML = html;
  return readRichContent(host);
}

test('往返：纯文本保持不变', () => {
  assert.strictEqual(roundTrip('普通文本'), '普通文本');
  assert.strictEqual(roundTrip('含 <>&"\' 等需转义字符'), '含 <>&"\' 等需转义字符');
});

test('往返：加粗 **text**', () => {
  assert.strictEqual(roundTrip('前**粗**后'), '前**粗**后');
});

test('往返：高亮 ==text==', () => {
  assert.strictEqual(roundTrip('前==亮==后'), '前==亮==后');
});

test('往返：颜色 [[c:#ff0000]]…[[/c]]', () => {
  // jsdom 会把 style.color 规范化为 rgb()，读回即 rgb(...) 形式，语义等价
  const back = roundTrip('[[c:#ff0000]]红[[/c]]');
  assert.ok(/^\[\[c:rgb\(255, 0, 0\)\]\]红\[\[\/c\]\]$/.test(back),
    '颜色 marker 未往返还原，实际：' + back);
});

test('往返：对齐 [[align:center]]…[[/align]]（★ 曾泄漏成文字）', () => {
  assert.strictEqual(roundTrip('[[align:center]]居中[[/align]]'),
    '[[align:center]]居中[[/align]]');
  assert.strictEqual(roundTrip('前[[align:right]]右[[/align]]后'),
    '前[[align:right]]右[[/align]]后');
});

test('往返：图片 [[img:id]]', () => {
  const note = { images: [{ id: 'i1', src: 'note-img://local/a.png', w: 120 }] };
  assert.strictEqual(roundTrip('前[[img:i1]]后', note), '前[[img:i1]]后');
});

test('往返：文件 [[file:id]]', () => {
  const note = { files: [{ id: 'f1', path: 'C:\\\\dir\\\\a.txt', isDir: false }] };
  assert.strictEqual(roundTrip('前[[file:f1]]后', note), '前[[file:f1]]后');
});

test('往返：表格 [[table:id]]', () => {
  const note = { tables: [{ id: 't1', rows: 1, cols: 2, cells: [['A', 'B']] }] };
  assert.strictEqual(roundTrip('前[[table:t1]]后', note), '前[[table:t1]]后');
});

test('★ 关键回归：多种 marker 混排不丢、不增、不泄漏（[ 累积的根因）', () => {
  const note = {
    images: [{ id: 'i1', src: 'note-img://local/a.png', w: 120 }],
    files: [{ id: 'f1', path: '/tmp/a.txt' }],
    tables: [{ id: 't1', rows: 1, cols: 1, cells: [['X']] }]
  };
  const text = '开头**粗**==亮==[[img:i1]]中[[table:t1]]尾[[file:f1]]';
  const back = roundTrip(text, note);
  assert.strictEqual(back, text, '往返不等价，会导致每编辑一次标记累积');
});

test('★ 关键回归：连续两次往返幂等（编辑不会让 marker 累积）', () => {
  const text = '[[align:left]]左[[/align]]尾巴';
  const once = roundTrip(text);
  const twice = roundTrip(once);
  assert.strictEqual(twice, once, '二次往返产生累积，说明 marker 未被正确消费');
  assert.ok(!/\[\[align:left\]\]\[\[align:left\]\]/.test(twice), '出现了重复的 align 标记');
});

test('★ 关键回归：未闭合的 [[align: 不会吞掉后续文本', () => {
  // 历史 bug：缺失 [[/align]] 时整段被吞；此处确认只是当作普通文本渲染
  const out = renderRichContent('前[[align:left]]无闭合', {});
  assert.ok(out.length > 0);
  const host = doc.createElement('div');
  host.innerHTML = out;
  assert.ok(readRichContent(host).includes('无闭合'), '未闭合标记吞掉了后续文本');
});

test('★ 关键回归：未知/不存在的引用 id —— 以字面文本呈现，且必须被转义', () => {
  // 现状（既有行为，不改）：找不到对应媒体的 marker 不会被丢弃，而是作为普通文本显示，
  // 例如 [[img:已删除的id]]。孤儿引用应由 cleanupRefs 在数据层清理，不在渲染层吞掉。
  // 这里守住的是安全红线：字面量必须转义，绝不能变成可执行 HTML。
  const out = renderRichContent('前[[img:不存在]]后', { images: [] });
  assert.ok(out.includes('[[img:不存在]]'), '未知 marker 被静默吞掉（行为变更，需确认）');
  // 注入类 payload 必须被转义
  const evil = renderRichContent('[[img:<img src=x onerror=alert(1)>]]', { images: [] });
  assert.ok(!/<img\s+src=x/i.test(evil), '⚠️ 未转义的 marker 造成了 HTML 注入');
  assert.ok(evil.includes('&lt;img'), 'marker 内的 HTML 未转义');
});

test('往返：表格内的加粗/高亮被保留在 cells 文本里（不参与外层往返）', () => {
  const note = { tables: [{ id: 't1', rows: 1, cols: 1, cells: [['**粗**']] }] };
  const html = renderRichContent('[[table:t1]]', note);
  assert.ok(html.includes('<b>粗</b>'), '表格单元格内的 Markdown 未渲染');
  // 读回只还原 [[table:t1]]（单元格内部由表格编辑器单独维护）
  const host = doc.createElement('div');
  host.innerHTML = html;
  assert.strictEqual(readRichContent(host), '[[table:t1]]');
});

test('escapeHtml 阻断 HTML 注入（往返后不产生可执行标签）', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const html = renderRichContent(evil, {});
  assert.ok(!html.includes('<img src=x'), '原始 HTML 未被转义');
  assert.ok(html.includes('&lt;img'), '未正确转义');
});
