const { test } = require('node:test');
const assert = require('node:assert');
const { LAYOUT, gridCols, overlapsAny, nextGridPosition, arrangeShelf, arrangeCompact, initPositionAll, clampZoom, orderGroupsByRecent, rectsIntersect, suggestGroupIds } = require('../renderer/board-layout.js');

test('LAYOUT 常量默认值', () => {
  assert.strictEqual(LAYOUT.margin, 20);
  assert.strictEqual(LAYOUT.gap, 18);
  assert.strictEqual(LAYOUT.gridWidth, 260);
  assert.strictEqual(LAYOUT.gridHeight, 230);
});

test('gridCols 计算列数（与旧逻辑一致）', () => {
  // 旧逻辑: Math.max(1, Math.floor((canvasW - 40) / 260))，margin=20 -> canvasW-40
  assert.strictEqual(gridCols(300), 1);
  assert.strictEqual(gridCols(560), 2);   // (560-40)/260 = 2.0
  assert.strictEqual(gridCols(800), 2);   // (800-40)/260 = 2.92
  assert.strictEqual(gridCols(1000), 3);  // (1000-40)/260 = 3.69
});

test('nextGridPosition 空画布返回起始位', () => {
  const p = nextGridPosition([], 0);
  assert.deepStrictEqual(p, { x: 20, y: 20 });
});

test('nextGridPosition 避开已有便签（不重叠）', () => {
  // 已有便签占据第一格
  const existing = [{ x: 20, y: 20, w: 240, h: 200 }];
  const p = nextGridPosition(existing, 800);
  // 第一格(20,20)被占，应找下一格但仍在第一行：col=1 -> x=20+260=280
  assert.strictEqual(p.x, 280);
  assert.strictEqual(p.y, 20);
  // 且不与 existing 重叠
  assert.ok(!overlapsAny(p.x, p.y, 240, 200, existing), '不应与已有便签重叠');
});

test('nextGridPosition 扫满后落到最低点下方', () => {
  // 塞满前几格
  const existing = [];
  for (let c = 0; c < 4; c++) existing.push({ x: 20 + c * 260, y: 20, w: 20, h: 200 });
  const p = nextGridPosition(existing, 1080);
  assert.ok(p.y >= 20, '应落到下方');
});

test('arrangeShelf 紧凑行打包：间距恒定，按实际宽高排布', () => {
  const notes = [
    { id: 'a', w: 400, h: 300 },
    { id: 'b', w: 240, h: 180 },
    { id: 'c', w: 300, h: 200 },
    { id: 'd', w: 200, h: 150 }
  ];
  const out = arrangeShelf(notes, 1080);
  // 首行：a 从(20,20)，b 紧随其后
  const a = out.find((o) => o.id === 'a');
  const b = out.find((o) => o.id === 'b');
  assert.deepStrictEqual({ x: a.x, y: a.y }, { x: 20, y: 20 });
  assert.strictEqual(b.x, 20 + 400 + 18, 'b 应紧跟 a 之后（+宽+间距）');
  assert.strictEqual(b.y, 20);
  // 间距恒定
  assert.strictEqual(b.x - (a.x + 400), LAYOUT.gap);
});

test('arrangeShelf 换行：超过 maxX 折行，行高取本行最大', () => {
  const notes = [
    { id: 'a', w: 800, h: 300 },   // 一行放不下两个 800
    { id: 'b', w: 800, h: 200 },
    { id: 'c', w: 300, h: 150 }
  ];
  const out = arrangeShelf(notes, 900);
  const a = out.find((o) => o.id === 'a');
  const b = out.find((o) => o.id === 'b');
  const c = out.find((o) => o.id === 'c');
  assert.deepStrictEqual({ x: a.x, y: a.y }, { x: 20, y: 20 });
  // b 放不下同一行（1638>900）-> 换行到 a 下方，y = 20 + 300 + 18
  assert.strictEqual(b.y, 20 + 300 + LAYOUT.gap, 'b 应换行到 a 下方');
  assert.strictEqual(b.x, 20);
  // c 也放不下（838+300>900）-> 再次换行到 b 下方，y = 338 + 200 + 18
  assert.strictEqual(c.y, b.y + 200 + LAYOUT.gap, 'c 应换行到 b 下方');
  assert.strictEqual(c.x, 20);
});

test('overlapsAny 正确判断重叠/间距', () => {
  const existing = [{ x: 100, y: 100, w: 240, h: 180 }];
  // 完全错开
  assert.ok(!overlapsAny(0, 0, 80, 80, existing));
  // 与已有便签重叠
  assert.ok(overlapsAny(150, 150, 100, 100, existing));
  // 仅贴边不重叠（刚好 gap 距离）
  assert.ok(!overlapsAny(100 + 240 + 18, 100, 100, 100, existing));
});

test('arrangeCompact 尊重顺序、无重叠、无溢出', () => {
  const notes = [
    { id: 'big', w: 1244, h: 984 },
    { id: 'w', w: 1113, h: 431 },
    { id: 'a', w: 240, h: 200 },
    { id: 'b', w: 240, h: 200 },
    { id: 'c', w: 240, h: 200 },
    { id: 't', w: 501, h: 285 }
  ];
  const maxX = 2600, maxY = 1800;
  const out = arrangeCompact(notes, maxX);
  assert.strictEqual(out.length, notes.length);
  // 无重叠
  const rects = notes.map((n) => { const p = out.find((o) => o.id === n.id); return { x: p.x, y: p.y, w: n.w, h: n.h }; });
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    assert.ok(a.x + a.w + LAYOUT.gap <= b.x || b.x + b.w + LAYOUT.gap <= a.x || a.y + a.h + LAYOUT.gap <= b.y || b.y + b.h + LAYOUT.gap <= a.y, `${i} 与 ${j} 重叠`);
  }
  // 无溢出
  rects.forEach((r) => { assert.ok(r.x + r.w <= maxX, '超出画布宽'); assert.ok(r.y + r.h <= maxY, '超出画布高'); });
  // 读序=输入顺序（行优先）
  const reading = [...rects.map((r, i) => ({ id: notes[i].id, x: r.x, y: r.y }))].sort((a, b) => (Math.round(a.y / 100) - Math.round(b.y / 100)) || (a.x - b.x)).map((r) => r.id);
  assert.deepStrictEqual(reading, notes.map((n) => n.id));
});

test('arrangeCompact 空数组返回空', () => {
  assert.deepStrictEqual(arrangeCompact([], 2600), []);
});

test('initPositionAll：只给缺 positionAll 的旧数据补位，已有 positionAll 不移动（即使重叠）', () => {
  const notes = [
    { id: 'a', x: 500, y: 20, positionAll: { x: 500, y: 20 } },
    { id: 'b', x: 280, y: 20, positionAll: { x: 280, y: 20 } }, // 与 a 重叠，但应保持不变
    { id: 'c', x: 20, y: 20 } // 旧数据，无 positionAll
  ];
  const changed = initPositionAll(notes, 1440);
  assert.strictEqual(changed, true);
  assert.deepStrictEqual(notes[0].positionAll, { x: 500, y: 20 });
  assert.deepStrictEqual(notes[1].positionAll, { x: 280, y: 20 });
  assert.ok(notes[2].positionAll && typeof notes[2].positionAll.x === 'number', 'c 应被补上位置');
  // c 的落点不与 a、b 重叠
  assert.ok(!overlapsAny(notes[2].positionAll.x, notes[2].positionAll.y, 240, 180, [
    { x: 500, y: 20, w: 240, h: 180 }, { x: 280, y: 20, w: 240, h: 180 }
  ]));
});

test('initPositionAll：全部已有 positionAll 时返回 false', () => {
  const notes = [{ id: 'a', x: 1, y: 1, positionAll: { x: 1, y: 1 } }];
  assert.strictEqual(initPositionAll(notes, 1440), false);
});

test('clampZoom：只接受有限数字并收敛到 [min, max]', () => {
  assert.strictEqual(clampZoom(1), 1);
  assert.strictEqual(clampZoom(0.5), 0.5);
  assert.strictEqual(clampZoom(1.234), 1.23);
  // 越界 clamp + 保留两位小数
  assert.strictEqual(clampZoom(0.1), LAYOUT.zoomMin);
  assert.strictEqual(clampZoom(99), LAYOUT.zoomMax);
  assert.strictEqual(clampZoom(-3), LAYOUT.zoomMin);
  // 非法输入回退 1
  assert.strictEqual(clampZoom(NaN), 1);
  assert.strictEqual(clampZoom(undefined), 1);
  assert.strictEqual(clampZoom('5'), 1);
});

test('orderGroupsByRecent：命中的分组排到最前，其余保持原相对顺序', () => {
  const groups = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
    { id: 'd', name: 'D' }
  ];
  // 最近使用 [c, a]（c 最常使用）→ c, a 在最前，其余 b/d 按原顺序
  assert.deepStrictEqual(
    orderGroupsByRecent(groups, ['c', 'a']).map((g) => g.id),
    ['c', 'a', 'b', 'd']
  );
  // 去重 + 忽略不存在的 id
  assert.deepStrictEqual(
    orderGroupsByRecent(groups, ['c', 'c', 'x', 'b']).map((g) => g.id),
    ['c', 'b', 'a', 'd']
  );
  // 无 recents 时保持原顺序；不破坏入参
  const src = groups.slice();
  assert.deepStrictEqual(orderGroupsByRecent(groups, []).map((g) => g.id), ['a', 'b', 'c', 'd']);
  assert.deepStrictEqual(groups, src);
});

test('rectsIntersect：矩形相交/接触/不相交判定', () => {
  const r = { x: 10, y: 10, w: 100, h: 100 };
  // 相交
  assert.strictEqual(rectsIntersect(r, { x: 50, y: 50, w: 10, h: 10 }), true);
  // 恰好接触边界（右缘相接视为相交）
  assert.strictEqual(rectsIntersect(r, { x: 110, y: 10, w: 10, h: 10 }), true);
  // 不相交（在右 / 在下）
  assert.strictEqual(rectsIntersect(r, { x: 200, y: 10, w: 10, h: 10 }), false);
  assert.strictEqual(rectsIntersect(r, { x: 10, y: 200, w: 10, h: 10 }), false);
  // 缺参 / 空矩形
  assert.strictEqual(rectsIntersect(null, r), false);
  assert.strictEqual(rectsIntersect(r, { x: 1000, y: 1000 }), false);
});

test('suggestGroupIds：按笔记文本匹配 + 最近使用推荐分组', () => {
  const groups = [
    { id: 'g1', name: '工作' },
    { id: 'g2', name: '购物' },
    { id: 'g3', name: '旅行' },
    { id: 'g4', name: '学习' }
  ];
  // 文本命中「购物/学习」→ 这两个在最前（按出现顺序）
  assert.deepStrictEqual(
    suggestGroupIds('明天要购物清单，顺便学习', groups, []),
    ['g2', 'g4']
  );
  // 没有文本命中 → 回退到最近使用（最多 3 个）
  assert.deepStrictEqual(
    suggestGroupIds('随便的笔记', groups, ['g3', 'g1', 'g2']),
    ['g3', 'g1', 'g2']
  );
  // 文本命中优先；最近使用仅兜底且去重、限量
  assert.deepStrictEqual(
    suggestGroupIds('工作记录', groups, ['g4', 'g1', 'g2', 'g3']).slice(0, 2),
    ['g1', 'g4']
  );
  // 空文本不绑定分组
  assert.deepStrictEqual(suggestGroupIds('', groups, []), []);
});
