/* V128-01A：纯文本搜索匹配 / 片段 helper 单测（Node 内置 node:test）。
   覆盖契约：空/缺失、字段与 todo 顺序、字面量（正则/HTML 特殊字符）、大小写与 trim、
   Unicode astral 与大小写展开后的原始偏移、长文本/预算/长 query、非法/裁剪输入、深度冻结输入不变。
   仅测试纯 helper；不断言任何 Markdown/媒体/DOM 渲染能力。 */

const { test } = require('node:test');
const assert = require('node:assert');
const {
  findNoteSearchMatches,
  buildSearchSnippet,
} = require('../renderer/logic.js');

// 良构：不含未配对代理
function isWellFormed(str) {
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = str.charCodeAt(i + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}
const emittedLength = (snip) => snip.parts.reduce((a, p) => a + p.text.length, 0);

test('空/纯空白 query 与缺失字段：安全返回空', () => {
  const note = { title: 'Hello', content: 'World', items: [{ id: 'i1', text: '任务' }] };
  assert.deepStrictEqual(findNoteSearchMatches(note, '分组', ''), []);
  assert.deepStrictEqual(findNoteSearchMatches(note, '分组', '   '), []);
  assert.deepStrictEqual(findNoteSearchMatches(note, '分组', '\t\n '), []);
  // 缺失/null 字段不报错
  assert.deepStrictEqual(findNoteSearchMatches({}, undefined, 'x'), []);
  assert.deepStrictEqual(findNoteSearchMatches(null, null, 'x'), []);
  assert.deepStrictEqual(findNoteSearchMatches({ title: null, content: null, items: null }, null, 'x'), []);
});

test('字段顺序与首个命中：title → content → 每个 todo → group，各字段仅首个命中', () => {
  const note = {
    title: 'Alpha Beta',
    content: 'has Alpha twice Alpha',
    items: [{ id: 't1', text: 'Alpha task' }, { id: 't2', text: 'nothing' }, { id: 't3', text: 'alpha again' }],
  };
  const hits = findNoteSearchMatches(note, 'Alpha Group', 'alpha');
  assert.deepStrictEqual(hits.map((h) => h.field), ['title', 'content', 'todo', 'todo', 'group']);
  // 仅首个命中
  assert.strictEqual(hits[1].start, note.content.indexOf('Alpha'));
  assert.strictEqual(note.content.slice(hits[1].start, hits[1].end), 'Alpha');
  // todo 附带 id/index
  assert.strictEqual(hits[2].itemId, 't1');
  assert.strictEqual(hits[2].itemIndex, 0);
  assert.strictEqual(hits[3].itemId, 't3');
  assert.strictEqual(hits[3].itemIndex, 2);
  // 每个命中的 start/end 都精确对应原文子串（大小写不敏感）
  for (const h of hits) {
    assert.strictEqual(h.text.slice(h.start, h.end).toLowerCase(), 'alpha');
  }
});

test('字面量匹配：正则元字符与 HTML 特殊字符按字面处理，query 不当正则', () => {
  const note = { title: 'a.b[c] <x> & "y"', content: 'price: $10 (v1) *' };
  const h1 = findNoteSearchMatches(note, undefined, 'a.b[');
  assert.strictEqual(h1.length, 1);
  assert.strictEqual(note.title.slice(h1[0].start, h1[0].end), 'a.b[');
  const h2 = findNoteSearchMatches(note, undefined, '(v1)');
  assert.strictEqual(h2.length, 1);
  assert.strictEqual(note.content.slice(h2[0].start, h2[0].end), '(v1)');
  // 纯正则语义若被误当正则会命中，这里必须不命中
  assert.deepStrictEqual(findNoteSearchMatches({ title: 'aaa' }, undefined, 'a*'), []);
});

test('大小写不敏感与 query trim：前后空白不影响命中', () => {
  const note = { title: 'MixedCASE' };
  const a = findNoteSearchMatches(note, undefined, 'mixedcase');
  const b = findNoteSearchMatches(note, undefined, '  MixedCase  ');
  assert.strictEqual(a.length, 1);
  assert.strictEqual(b.length, 1);
  assert.strictEqual(note.title.slice(a[0].start, a[0].end), 'MixedCASE');
  assert.deepStrictEqual({ s: a[0].start, e: a[0].end }, { s: b[0].start, e: b[0].end });
});

test('Unicode astral（emoji）与中文前后的偏移：start/end 精确落在原文', () => {
  const content = '😀中文ABCdef后面';
  const note = { content };
  const hits = findNoteSearchMatches(note, undefined, 'abcdef');
  assert.strictEqual(hits.length, 1);
  const h = hits[0];
  assert.strictEqual(content.slice(h.start, h.end), 'ABCdef');
  // astral 占 2 个 UTF-16 码元：命中起点应在 emoji(2) + 中文(2) 之后 = 4
  assert.strictEqual(h.start, 4);
});

test('大小写展开（U+0130）不得错位：命中后续字符的原始偏移正确', () => {
  // 'İ'.toLowerCase() === 'i\u0307'（1 个源码元 → 2 个小写码元）
  const note = { content: 'İX' };
  const hits = findNoteSearchMatches(note, undefined, 'x');
  assert.strictEqual(hits.length, 1);
  // 必须指向原文的 'X'（索引 1），而不是被展开造成的错位
  assert.strictEqual(note.content.slice(hits[0].start, hits[0].end), 'X');
  assert.strictEqual(hits[0].start, 1);
  // 与当前 app 语义一致：'İ'.toLowerCase().includes('i') 为 true，命中应覆盖该源码元
  const iHit = findNoteSearchMatches(note, undefined, 'i');
  assert.strictEqual(note.content.slice(iHit[0].start, iHit[0].end), 'İ');
  // 希腊文大写（含词尾上下文 sigma）：整串 toLowerCase 下 'ΟΣ' -> 'ος'（末位 Σ 变 ς），
  // 命中 'ος' 应映射回原文 'ΟΣ' 两个源码元，偏移不错位。
  const greek = { content: 'ΟΣ尾' };
  assert.strictEqual('ΟΣ'.toLowerCase(), 'ος');
  const gHit = findNoteSearchMatches(greek, undefined, 'ος');
  assert.strictEqual(gHit.length, 1);
  assert.strictEqual(greek.content.slice(gHit[0].start, gHit[0].end), 'ΟΣ');
  assert.strictEqual(gHit[0].start, 0);
  assert.strictEqual(gHit[0].end, 2);
});

test('长文本片段：围绕命中居中、预算受限、截断标志正确', () => {
  const text = '前'.repeat(80) + '目标词' + '后'.repeat(80);
  const start = text.indexOf('目标词');
  const end = start + 3;
  const snip = buildSearchSnippet(text, start, end, 12);
  const joined = snip.parts.map((p) => p.text).join('');
  assert.ok(joined.includes('目标词'), '片段必须包含命中原文');
  assert.strictEqual(joined, text.slice(text.indexOf(joined), text.indexOf(joined) + joined.length)); // 连续子串
  assert.strictEqual(snip.truncatedBefore, true);
  assert.strictEqual(snip.truncatedAfter, true);
  const matchedParts = snip.parts.filter((p) => p.matched);
  assert.strictEqual(matchedParts.length, 1);
  assert.strictEqual(matchedParts[0].text, '目标词');
  // 预算严格：总输出 UTF-16 长度 <= budget（不是 +2 的软弱上界）
  assert.ok(emittedLength(snip) <= 12, `片段长度 ${emittedLength(snip)} 必须 <= 预算 12`);
  assert.ok(snip.parts.every((p) => isWellFormed(p.text)));
});

test('预算契约：1 / 奇数 / Infinity / NaN / 0 均严格受限且良构', () => {
  // budget=1：最多 1 个 UTF-16 单元
  const b1 = buildSearchSnippet('abc', 0, 1, 1);
  assert.ok(emittedLength(b1) <= 1);
  assert.ok(b1.parts.every((p) => isWellFormed(p.text)));

  // 奇数预算不向上取整、也不强制为偶数
  const b5 = buildSearchSnippet('abcdefghij', 4, 5, 5);
  assert.ok(emittedLength(b5) <= 5, `奇数预算 5 被违反：${emittedLength(b5)}`);
  assert.strictEqual(b5.parts.filter((p) => p.matched).length, 1);
  assert.strictEqual(b5.parts.find((p) => p.matched).text, 'e');

  // 非有限/无效预算回落到 120，绝不无界
  for (const bad of [Infinity, -Infinity, NaN, 0, -3]) {
    const r = buildSearchSnippet('x'.repeat(500), 250, 251, bad);
    assert.ok(emittedLength(r) <= 120, `无效预算 ${bad} 未被限制`);
    assert.ok(r.parts.every((p) => isWellFormed(p.text)));
  }
});

test('长 query 与超预算命中：命中段非空且封顶，区间保留', () => {
  const long = 'Q'.repeat(200);
  const text = 'x' + long + 'y';
  const start = 1, end = 1 + long.length;
  const snip = buildSearchSnippet(text, start, end, 20);
  // 严格受预算约束
  assert.ok(emittedLength(snip) <= 20, `超预算命中未被封顶：${emittedLength(snip)}`);
  // 命中段必须真实、非空、且是原文命中前缀
  const matched = snip.parts.filter((p) => p.matched);
  assert.strictEqual(matched.length, 1, '超预算命中仍应有一个非空匹配段');
  assert.ok(matched[0].text.length > 0);
  assert.strictEqual(matched[0].text, text.slice(start, start + matched[0].text.length));
  // 命中原始范围不受片段影响：调用方持有 start/end 仍可自行 slice
  assert.strictEqual(text.slice(start, start + 5), 'QQQQQ');
});

test('代理对边界：窗口/命中端点落在码点中间时不产生未配对代理', () => {
  // 命中区间落在低位代理上（😀abc，命中 [1,2)）：窗口须扩展到完整码点
  const r1 = buildSearchSnippet('😀abc', 1, 2, 4);
  assert.ok(r1.parts.every((p) => isWellFormed(p.text)), '不得切出未配对代理');
  assert.ok(r1.parts.map((p) => p.text).join('').includes('😀'));

  // 窗口起点落在第二个 emoji 的中间：窗口须对齐到完整码点，总长仍 <= 预算
  const r2 = buildSearchSnippet('😀😀abcd', 4, 6, 4);
  assert.ok(r2.parts.every((p) => isWellFormed(p.text)));
  assert.ok(emittedLength(r2) <= 4);

  // 命中两个端点都落在码点中间：命中段须扩展为完整码点且良构
  const r3 = buildSearchSnippet('😀abc😀', 1, 5, 6);
  assert.ok(r3.parts.every((p) => isWellFormed(p.text)));
  const m3 = r3.parts.filter((p) => p.matched);
  assert.strictEqual(m3.length, 1);
  assert.ok(isWellFormed(m3[0].text));

  // 极端：budget=1 且命中是 astral（2 单元）——允许省略命中但不得切半，且仍截断标记
  const r4 = buildSearchSnippet('😀abc', 0, 2, 1);
  assert.ok(emittedLength(r4) <= 1);
  assert.ok(r4.parts.every((p) => isWellFormed(p.text)));
});

test('片段非法/空范围：确定性、无 matched、且良构', () => {
  // 非整数/NaN/越界
  assert.deepStrictEqual(buildSearchSnippet('abc', NaN, NaN, 10).parts.map((p) => p.text).join(''), 'abc');
  assert.deepStrictEqual(buildSearchSnippet('abc', -5, 99, 10).parts.map((p) => p.text).join(''), 'abc');
  // 空命中范围（start===end）：无 matched 段
  const empty = buildSearchSnippet('abc', 2, 2, 10);
  assert.strictEqual(empty.parts.every((p) => p.matched === false), true);
  // 空文本
  assert.deepStrictEqual(buildSearchSnippet('', 0, 0, 10).parts.map((p) => p.text).join(''), '');
  // 代理对中间的空区间：start===end 落在 emoji 中间，必须保持「空」（不发明命中）
  const emptyMid = buildSearchSnippet('😀abc', 1, 1, 4);
  assert.strictEqual(emptyMid.parts.some((p) => p.matched), false, 'start===end 落在代理对中间不得产生 matched');
  assert.ok(emptyMid.parts.every((p) => isWellFormed(p.text)));
  // 反向/无效端点在归一化为空后同样不得产生 matched
  const reversed = buildSearchSnippet('😀abc', 5, 2, 4);
  assert.strictEqual(reversed.parts.some((p) => p.matched), false, '反向区间不得产生 matched');
  const nanMid = buildSearchSnippet('😀abc', NaN, NaN, 4);
  assert.strictEqual(nanMid.parts.some((p) => p.matched), false, 'NaN 区间不得产生 matched');
  // 所有情形 part 均良构
  for (const sn of [buildSearchSnippet('abc', NaN, NaN, 10), buildSearchSnippet('abc', -5, 99, 10), empty, emptyMid, reversed, nanMid]) {
    assert.ok(sn.parts.every((p) => isWellFormed(p.text)));
  }
});

test('片段为纯文本契约：parts 只有 text/matched，不含 HTML 转义或标记', () => {
  const text = 'a <b> & [c] 目标';
  const start = text.indexOf('目标');
  const snip = buildSearchSnippet(text, start, start + 2, 40);
  for (const p of snip.parts) {
    assert.strictEqual(typeof p.text, 'string');
    assert.strictEqual(typeof p.matched, 'boolean');
    assert.deepStrictEqual(Object.keys(p).sort(), ['matched', 'text']);
  }
  // 不应对原文做 HTML 转义（二次转义风险由调用方负责）
  const joined = snip.parts.map((p) => p.text).join('');
  assert.ok(joined.includes('<b>') && joined.includes('&'), '片段保持原始文本，不做 HTML 转义');
});

test('深度冻结的 note/数组不被修改', () => {
  const freeze = (o) => {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.values(o).forEach(freeze);
    }
    return o;
  };
  const note = freeze({
    id: 'n1', title: 'Alpha', content: 'contains Alpha', type: 'todo',
    items: [{ id: 'i1', text: 'Alpha item' }, { id: 'i2', text: 'other' }],
  });
  const snapshot = JSON.stringify(note);
  const hits = findNoteSearchMatches(note, 'Alpha Group', 'alpha');
  assert.ok(hits.length >= 3);
  assert.strictEqual(JSON.stringify(note), snapshot, '输入 must not be mutated');
});
