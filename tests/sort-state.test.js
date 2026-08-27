const { test } = require('node:test');
const assert = require('node:assert');
const { resolveScope, posOf, writePos, readOrderFromLayout, reorderScoped, ensureOrderRefs, moveBefore, moveAfter, applySortStrategy } = require('../renderer/sort-state.js');

test('resolveScope：「全部/未分组/分组」映射到排序与布局两个作用域', () => {
  assert.deepStrictEqual(resolveScope('all'), { orderGid: null, layoutKey: '_all' });
  assert.deepStrictEqual(resolveScope('ungrouped'), { orderGid: null, layoutKey: '_ungrouped' });
  assert.deepStrictEqual(resolveScope('g1'), { orderGid: 'g1', layoutKey: 'g1' });
});

test('posOf：「全部」取 positionAll，其它取便签自身 x,y', () => {
  const n = { x: 10, y: 20, positionAll: { x: 100, y: 200 } };
  assert.deepStrictEqual(posOf(n, 'all'), { x: 100, y: 200 });
  assert.strictEqual(posOf(n, 'g1'), n);
  assert.strictEqual(posOf(n, 'ungrouped'), n);
  // 没有 positionAll 的旧数据在「全部」里退回自身 x,y
  const legacy = { x: 30, y: 40 };
  assert.strictEqual(posOf(legacy, 'all'), legacy);
});

test('writePos：「全部」写 positionAll，其它写 x,y', () => {
  const a = { x: 1, y: 1 };
  writePos(a, 9, 8, 'all');
  assert.deepStrictEqual(a.positionAll, { x: 9, y: 8 });
  assert.strictEqual(a.x, 1); // 不碰 x,y
  const b = { x: 1, y: 1 };
  writePos(b, 5, 6, 'g1');
  assert.strictEqual(b.x, 5);
  assert.strictEqual(b.y, 6);
  assert.strictEqual(b.positionAll, undefined);
});

test('readOrderFromLayout：「全部」按 positionAll 读序（回归：不得按分组旧 x,y 排序）', () => {
  const notes = [
    { id: 'a', x: 20, y: 20, positionAll: { x: 500, y: 20 } },   // 画面在右侧
    { id: 'b', x: 280, y: 20, positionAll: { x: 280, y: 20 } }   // 画面在左侧
  ];
  // 「全部」下视觉顺序：b（左）在 a（右）之前
  assert.deepStrictEqual(readOrderFromLayout(notes, 'all'), ['b', 'a']);
  // 分组/未分组下按 x,y（a 在左）
  assert.deepStrictEqual(readOrderFromLayout(notes, 'ungrouped'), ['a', 'b']);
});

test('readOrderFromLayout：先按行再按列（y 同排内按 x）', () => {
  const notes = [
    { id: 'row2', x: 20, y: 250 },
    { id: 'row1b', x: 300, y: 20 },
    { id: 'row1a', x: 20, y: 20 }
  ];
  assert.deepStrictEqual(readOrderFromLayout(notes, 'all'), ['row1a', 'row1b', 'row2']);
});

test('readOrderFromLayout：行分组稳定（floor + 容差），半带宽边界不拆行', () => {
  // y=60 与 y=20 同属第 0 行（floor），按 x 排序；round 会把 60 划到第 1 行导致顺序错乱
  const notes = [
    { id: 'right', x: 500, y: 60 },
    { id: 'left', x: 20, y: 20 }
  ];
  assert.deepStrictEqual(readOrderFromLayout(notes, 'all'), ['left', 'right']);
  // band 边界（y=100）仍归入下一行，不受浮点误差影响
  const notes2 = [
    { id: 'row0', x: 20, y: 99 },
    { id: 'row1', x: 20, y: 100 }
  ];
  assert.deepStrictEqual(readOrderFromLayout(notes2, 'all'), ['row0', 'row1']);
});


test('reorderScoped：只重排视图内便签，保留视图外相对顺序（回归：不得清空分组顺序）', () => {
  // 原顺序含分组便签 g1/g2 与未分组便签 u1/u2
  const order = ['g1', 'u1', 'g2', 'u2'];
  // 「未分组」保存时只重排 u1/u2（新顺序 u2,u1），分组便签相对顺序不变
  assert.deepStrictEqual(reorderScoped(order, ['u2', 'u1']), ['u2', 'u1', 'g1', 'g2']);
  // 「全部」保存时 ids 覆盖全部，等价于整体重排
  assert.deepStrictEqual(reorderScoped(order, ['u2', 'g2', 'u1', 'g1']), ['u2', 'g2', 'u1', 'g1']);
});

test('ensureOrderRefs：剔除已删除、补入缺失、每个分组独立维护顺序', () => {
  const notes = [
    { id: 'n1', groupId: null },
    { id: 'n2', groupId: 'g1' },
    { id: 'n3', groupId: 'g1' },
    { id: 'n4', groupId: 'g2' }
  ];
  const groups = [{ id: 'g1' }, { id: 'g2' }];
  const r = ensureOrderRefs(notes, groups, ['ghost', 'n2', 'n1'], { g1: ['ghost', 'n3'], g2: [] });
  // 全局顺序：剔除 ghost，补入缺失 n3/n4
  assert.deepStrictEqual(r.noteOrder, ['n2', 'n1', 'n3', 'n4']);
  // 分组顺序：g1 剔除 ghost 并补入 n2，g2 补入 n4
  assert.deepStrictEqual(r.groupOrders.g1, ['n3', 'n2']);
  assert.deepStrictEqual(r.groupOrders.g2, ['n4']);
});

test('moveBefore：fromId 在前/在后都正确移到 toId 之前（off-by-one 回归）', () => {
  // fromId 在 toId 之前（历史 off-by-one 会把 a 插到 c 之后变成 ['b','c','a']）
  assert.deepStrictEqual(moveBefore(['a', 'b', 'c'], 'a', 'c'), ['b', 'a', 'c']);
  // fromId 在 toId 之后
  assert.deepStrictEqual(moveBefore(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
  // 相邻前插
  assert.deepStrictEqual(moveBefore(['a', 'b', 'c'], 'b', 'a'), ['b', 'a', 'c']);
  // 相同索引（fi === ti）不动
  assert.deepStrictEqual(moveBefore(['a', 'b', 'c'], 'b', 'b'), ['a', 'b', 'c']);
});

test('moveAfter：正确移到 afterId 之后', () => {
  // fromId 在 afterId 之前
  assert.deepStrictEqual(moveAfter(['a', 'b', 'c'], 'a', 'c'), ['b', 'c', 'a']);
  // fromId 在 afterId 之后
  assert.deepStrictEqual(moveAfter(['a', 'b', 'c'], 'c', 'a'), ['a', 'c', 'b']);
  // 相同索引不动
  assert.deepStrictEqual(moveAfter(['a', 'b', 'c'], 'b', 'b'), ['a', 'b', 'c']);
});

test('applySortStrategy：排序策略只返回展示顺序，绝不动 noteOrder（读写分离）', () => {
  const notes = (arr) => arr.map((o) => ({ id: o.id, title: o.title, color: o.color, updatedAt: o.updatedAt, createdAt: o.createdAt, pinned: !!o.pinned }));
  const ns = notes([
    { id: 'a', title: 'Banana', color: '#00b894', updatedAt: 10, createdAt: 1 },
    { id: 'b', title: 'apple', color: '#e74c3c', updatedAt: 5, createdAt: 2, pinned: true },
    { id: 'c', title: 'Cherry', color: '#0984e3', updatedAt: 20, createdAt: 3 }
  ]);
  const order = ['c', 'a', 'b'];
  // custom：基准顺序优先
  assert.deepStrictEqual(applySortStrategy(ns, 'custom', 'all', order, {}), ['c', 'a', 'b']);
  // 新便签（不在 order）追加到末尾 → 一定参与排序
  assert.deepStrictEqual(applySortStrategy(ns.concat(notes([{ id: 'x', updatedAt: 99, createdAt: 9 }])), 'custom', 'all', order, {}), ['c', 'a', 'b', 'x']);
  // updated：置顶(pinned)优先，再按更新时间降序；且不改动传入的 order
  assert.deepStrictEqual(applySortStrategy(ns, 'updated', 'all', order, {}), ['b', 'c', 'a']);
  assert.deepStrictEqual(order, ['c', 'a', 'b'], '调用后 noteOrder 未被修改');
  // created / title（置顶 pinned 优先）
  assert.deepStrictEqual(applySortStrategy(ns, 'created', 'all', order, {}), ['b', 'c', 'a']);
  assert.deepStrictEqual(applySortStrategy(ns, 'title', 'all', order, {}), ['b', 'a', 'c']);
  // 分组作用域只取该分组基准顺序
  assert.deepStrictEqual(applySortStrategy(ns, 'custom', 'g1', [], { g1: ['b', 'a', 'c'] }), ['b', 'a', 'c']);
  // 空数组安全
  assert.deepStrictEqual(applySortStrategy([], 'updated', 'all', order, {}), []);
});
