/* system/arrange.js 单测：排序作用域与重排逻辑。
   arrange.js 的函数体通过「顶层全局」访问其他模块（项目 UMD 惯例），
   故测试在 global 上注入**真实依赖**（sort-state / board-layout）+ 最小副作用桩（save/renderAll/toast…）。
   这样测到的是真实组合行为，而不是假桩下的空转。

   ⚠️ 覆盖不到的部分（强 DOM / 缩放）留给 e2e：arrangeNotes 的画布打包依赖 #canvas.clientWidth 与 boardZoom()。

   运行：node --test tests/arrange.test.js */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const SortState = require('../renderer/sort-state.js');
const BoardLayout = require('../renderer/board-layout.js');

// —— 注入真实依赖到全局（arrange.js 直接按名字调用）——
Object.assign(global, {
  SortState,
  BoardLayout,
  LAYOUT: BoardLayout.LAYOUT,
  resolveScope: SortState.resolveScope,
  posOf: SortState.posOf,
  writePos: SortState.writePos,
  readOrderFromLayout: SortState.readOrderFromLayout,
  reorderScoped: SortState.reorderScoped,
  ensureOrderRefs: SortState.ensureOrderRefs,
  moveBefore: SortState.moveBefore,
  moveAfter: SortState.moveAfter,
  applySortStrategy: SortState.applySortStrategy
});

// —— 副作用桩：只记录调用，不真的渲染 ——
const calls = { save: 0, renderAll: 0, renderSortPanel: 0, toast: [] };
Object.assign(global, {
  save: () => { calls.save++; },
  renderAll: () => { calls.renderAll++; },
  renderSortPanel: () => { calls.renderSortPanel++; },
  toast: (m) => { calls.toast.push(m); },
  t: (k) => k,
  isGroupCollapsed: () => false,
  boardZoom: () => 1,
  $: () => null,                 // 默认无 #canvas → 走回退分支
  sortPanelGroupId: 'all',
  filter: { group: 'all' }
});

const A = require('../renderer/system/arrange.js');

let state;
beforeEach(() => {
  calls.save = 0; calls.renderAll = 0; calls.renderSortPanel = 0; calls.toast = [];
  global.filter = { group: 'all' };
  global.sortPanelGroupId = 'all';
  state = {
    notes: [],
    groups: [],
    settings: { sortMode: 'updated', viewMode: 'board', noteOrder: [], groupOrders: {} }
  };
  global.state = state;
});

const mkNote = (id, extra) => Object.assign(
  { id, title: id, createdAt: 1, updatedAt: 1, x: 0, y: 0 }, extra || {}
);

/* ============ orderRefFor：排序数组作用域 ============ */

test('orderRefFor(null) 返回全局 noteOrder，缺失时自动创建', () => {
  delete state.settings.noteOrder;
  const r = A.orderRefFor(null);
  assert.ok(Array.isArray(r), '未自动创建 noteOrder');
  assert.strictEqual(r, state.settings.noteOrder, '返回的不是 noteOrder 引用本身');
});

test('orderRefFor(gid) 返回该分组独立的 groupOrders[gid]', () => {
  const g1 = A.orderRefFor('g1');
  const g2 = A.orderRefFor('g2');
  assert.notStrictEqual(g1, g2, '不同分组共享了同一个排序数组');
  g1.push('a');
  assert.deepStrictEqual(g2, [], '改 g1 污染了 g2');
});

test('orderRefFor(gid) 幂等：重复调用返回同一引用', () => {
  const a = A.orderRefFor('g1');
  a.push('x');
  assert.deepStrictEqual(A.orderRefFor('g1'), ['x'], '未复用同一数组');
});

test('orderRefFor 缺失 groupOrders 容器时自动创建', () => {
  delete state.settings.groupOrders;
  const r = A.orderRefFor('g1');
  assert.ok(state.settings.groupOrders, '未创建 groupOrders 容器');
  assert.deepStrictEqual(r, []);
});

/* ============ activeGroupId / layoutScopeKey：作用域解析 ============ */

test('activeGroupId：全部/未分组视图 → null（用全局 noteOrder）', () => {
  global.filter.group = 'all';
  assert.strictEqual(A.activeGroupId(), null);
  global.filter.group = 'ungrouped';
  assert.strictEqual(A.activeGroupId(), null, '未分组视图不应使用分组排序');
});

test('activeGroupId：分组视图 → 该分组 id', () => {
  global.filter.group = 'g1';
  assert.strictEqual(A.activeGroupId(), 'g1');
});

test('layoutScopeKey：all→_all、ungrouped→_ungrouped、分组→分组 id', () => {
  global.filter.group = 'all';
  assert.strictEqual(A.layoutScopeKey(), '_all');
  global.filter.group = 'ungrouped';
  assert.strictEqual(A.layoutScopeKey(), '_ungrouped');
  global.filter.group = 'gX';
  assert.strictEqual(A.layoutScopeKey(), 'gX');
});

test('sortPanelGid 独立于视图 filter.group（排序面板可看别的作用域）', () => {
  global.filter.group = 'g1';       // 视图在分组 g1
  global.sortPanelGroupId = 'all';  // 但排序面板看全局
  assert.strictEqual(A.sortPanelGid(), null, 'sortPanelGid 被视图 filter 污染');
  global.sortPanelGroupId = 'g2';
  assert.strictEqual(A.sortPanelGid(), 'g2');
});

/* ============ canvasMaxX：无 DOM 时的回退 ============ */

test('canvasMaxX 无 #canvas 时回退到默认宽度（不返回 NaN/0）', () => {
  const v = A.canvasMaxX();
  assert.ok(typeof v === 'number' && v > 0, '回退值非法：' + v);
  assert.strictEqual(v, BoardLayout.LAYOUT.defaultW * 6);
});

test('canvasMaxX 有 #canvas 时取 clientWidth', () => {
  global.$ = (sel) => (sel === '#canvas' ? { clientWidth: 1234 } : null);
  assert.strictEqual(A.canvasMaxX(), 1234);
  global.$ = () => null;
});

/* ============ canvasMaxX：缩放一致性（便签坐标始终未缩放） ============ */

test('★ 关键回归：canvasMaxX 按缩放换算（可视宽度 → 未缩放宽度）', () => {
  global.$ = (sel) => (sel === '#canvas' ? { clientWidth: 1200 } : null);
  global.boardZoom = () => 2;
  assert.strictEqual(A.canvasMaxX(), 600, '放大 2 倍时可视区只对应 600 的未缩放宽度');
  global.boardZoom = () => 0.5;
  assert.strictEqual(A.canvasMaxX(), 2400, '缩小到 0.5 时应换算为 2400');
  global.boardZoom = () => 1;
  global.$ = () => null;
});

test('★ 关键回归：canvasMaxX 对非法缩放值兜底为 1（不得产生 NaN/Infinity/负数）', () => {
  global.$ = (sel) => (sel === '#canvas' ? { clientWidth: 1200 } : null);
  for (const bad of [0, -1, NaN, Infinity, -Infinity, undefined, null]) {
    global.boardZoom = () => bad;
    const v = A.canvasMaxX();
    assert.ok(typeof v === 'number' && isFinite(v) && v > 0,
      '非法 zoom ' + String(bad) + ' 产生了非法结果：' + v);
  }
  global.boardZoom = () => 1;
  global.$ = () => null;
});

test('canvasMaxX 结果取整（避免亚像素坐标抖动）', () => {
  global.$ = (sel) => (sel === '#canvas' ? { clientWidth: 1000 } : null);
  global.boardZoom = () => 3;
  const v = A.canvasMaxX();
  assert.strictEqual(v, Math.round(v), '未取整：' + v);
  global.boardZoom = () => 1;
  global.$ = () => null;
});

/* ============ moveSortBy：上下移动与边界 ============ */

test('moveSortBy 上移/下移', () => {
  state.settings.noteOrder = ['a', 'b', 'c'];
  A.moveSortBy('b', -1);
  assert.deepStrictEqual(state.settings.noteOrder, ['b', 'a', 'c'], '上移失败');
  A.moveSortBy('b', 1);
  assert.deepStrictEqual(state.settings.noteOrder, ['a', 'b', 'c'], '下移失败');
});

test('★ 关键回归：moveSortBy 越界时为无操作（不丢项、不 wrap-around）', () => {
  state.settings.noteOrder = ['a', 'b', 'c'];
  A.moveSortBy('a', -1);                       // 首项再上移
  assert.deepStrictEqual(state.settings.noteOrder, ['a', 'b', 'c'], '首项上移越界却改动了顺序');
  A.moveSortBy('c', 1);                        // 末项再下移
  assert.deepStrictEqual(state.settings.noteOrder, ['a', 'b', 'c'], '末项下移越界却改动了顺序');
});

test('moveSortBy 对不在列表中的 id 无操作（不抛错、不插入）', () => {
  state.settings.noteOrder = ['a', 'b'];
  A.moveSortBy('不存在', 1);
  assert.deepStrictEqual(state.settings.noteOrder, ['a', 'b']);
});

test('moveSortBy 生效后触发 save + renderSortPanel + renderAll', () => {
  state.settings.noteOrder = ['a', 'b'];
  A.moveSortBy('b', -1);
  assert.ok(calls.save === 1 && calls.renderSortPanel === 1 && calls.renderAll === 1,
    '副作用未触发：' + JSON.stringify(calls));
});

test('moveSortBy 越界时不触发 save（无谓的持久化）', () => {
  state.settings.noteOrder = ['a'];
  A.moveSortBy('a', -1);
  assert.strictEqual(calls.save, 0, '无操作却写盘了');
});

/* ============ moveSortItem / memoReorder / memoReorderAfter ============ */

test('moveSortItem 把 fromId 移到 toId 之前', () => {
  state.settings.noteOrder = ['a', 'b', 'c'];
  A.moveSortItem('c', 'a');
  assert.deepStrictEqual(state.settings.noteOrder, ['c', 'a', 'b']);
});

test('★ 关键回归：memoReorder 会把 sortMode 切成 custom（否则拖动「看起来动了、刷新就复原」）', () => {
  state.settings.sortMode = 'updated';
  state.notes = [mkNote('a'), mkNote('b')];
  state.settings.noteOrder = ['a', 'b'];
  A.memoReorder('b', 'a');
  assert.strictEqual(state.settings.sortMode, 'custom', '拖动重排后未切成 custom');
  assert.deepStrictEqual(state.settings.noteOrder, ['b', 'a']);
});

test('memoReorderAfter 把 fromId 放到 afterId 之后', () => {
  state.notes = [mkNote('a'), mkNote('b'), mkNote('c')];
  state.settings.noteOrder = ['a', 'b', 'c'];
  A.memoReorderAfter('a', 'c');
  assert.deepStrictEqual(state.settings.noteOrder, ['b', 'c', 'a']);
});

test('★ 关键回归：分组内重排只改该分组的排序，不动全局 noteOrder', () => {
  global.filter.group = 'g1';
  state.notes = [mkNote('a', { groupId: 'g1' }), mkNote('b', { groupId: 'g1' })];
  state.settings.noteOrder = ['a', 'b'];
  state.settings.groupOrders = { g1: ['a', 'b'] };
  A.memoReorder('b', 'a');
  assert.deepStrictEqual(state.settings.groupOrders.g1, ['b', 'a'], '分组内重排未生效');
  assert.deepStrictEqual(state.settings.noteOrder, ['a', 'b'], '★ 污染了全局 noteOrder');
});

/* ============ getSortedNotes ============ */

test('getSortedNotes 返回按当前策略排好的便签对象（不是 id）', () => {
  state.notes = [mkNote('a', { updatedAt: 1 }), mkNote('b', { updatedAt: 3 }), mkNote('c', { updatedAt: 2 })];
  const out = A.getSortedNotes(state.notes);
  assert.strictEqual(out.length, 3);
  assert.ok(out.every((n) => n && typeof n === 'object'), '返回了非便签对象');
  assert.deepStrictEqual(out.map((n) => n.id), ['b', 'c', 'a'], '未按更新时间降序');
});

test('getSortedNotes 丢弃已不存在的 id（引用清理后不留空洞）', () => {
  state.notes = [mkNote('a')];
  state.settings.sortMode = 'custom';
  state.settings.noteOrder = ['a', '已删除', 'b'];
  const out = A.getSortedNotes(state.notes);
  assert.deepStrictEqual(out.map((n) => n.id), ['a'], '残留了不存在的便签');
});

/* ============ saveCurrentOrder ============ */

test('★ 关键回归：saveCurrentOrder 只重排视图内便签，视图外的保留原有相对顺序', () => {
  // 视图：未分组（只有 c 无 groupId）；a/b 属于 g1，不在视图内
  global.filter.group = 'ungrouped';
  state.settings.viewMode = 'memo';
  state.notes = [
    mkNote('a', { groupId: 'g1', updatedAt: 3 }),
    mkNote('b', { groupId: 'g1', updatedAt: 2 }),
    mkNote('c', { updatedAt: 1 })
  ];
  state.settings.noteOrder = ['a', 'b', 'c'];
  A.saveCurrentOrder();
  assert.strictEqual(state.settings.sortMode, 'custom');
  const order = state.settings.noteOrder;
  // 视图内只有 c；a/b 的相对顺序必须保住
  const ia = order.indexOf('a'), ib = order.indexOf('b'), ic = order.indexOf('c');
  assert.ok(ia >= 0 && ib >= 0 && ic >= 0, '有便签被丢弃：' + JSON.stringify(order));
  assert.ok(ia < ib, '视图外便签 a/b 的相对顺序被破坏：' + JSON.stringify(order));
});

test('saveCurrentOrder 排除桌面钉住的便签（desktopPin）', () => {
  global.filter.group = 'all';
  state.settings.viewMode = 'memo';
  state.notes = [mkNote('a'), mkNote('p', { desktopPin: true })];
  state.settings.noteOrder = ['a', 'p'];
  A.saveCurrentOrder();
  // desktopPin 不参与当前视图排序；但不应被从 order 里删掉
  assert.ok(state.settings.noteOrder.includes('p'), '钉桌便签被从排序里删掉了');
  assert.ok(state.settings.noteOrder.includes('a'));
});

test('saveCurrentOrder 记录布局快照到 orderLayouts[作用域]', () => {
  global.filter.group = 'g1';
  state.settings.viewMode = 'memo';
  state.notes = [mkNote('a', { groupId: 'g1', x: 11, y: 22 })];
  state.settings.noteOrder = ['a'];
  A.saveCurrentOrder();
  const snap = (state.settings.orderLayouts || {})['g1'];
  assert.ok(snap, '未记录布局快照');
  assert.deepStrictEqual(snap.a, { x: 11, y: 22 }, '快照坐标不对（应取当前作用域位置）');
});

test('saveCurrentOrder 的快照作用域随视图切换（分组独立，互不覆盖）', () => {
  state.settings.viewMode = 'memo';
  state.notes = [mkNote('a', { groupId: 'g1', x: 1, y: 1 }), mkNote('b', { groupId: 'g2', x: 2, y: 2 })];
  state.settings.noteOrder = ['a', 'b'];

  global.filter.group = 'g1';
  A.saveCurrentOrder();
  global.filter.group = 'g2';
  A.saveCurrentOrder();

  assert.ok(state.settings.orderLayouts.g1 && state.settings.orderLayouts.g2, '两个作用域的快照都应存在');
  assert.deepStrictEqual(state.settings.orderLayouts.g1.a, { x: 1, y: 1 });
  assert.deepStrictEqual(state.settings.orderLayouts.g2.b, { x: 2, y: 2 });
  assert.ok(!state.settings.orderLayouts.g1.b, '快照串了作用域');
});

test('saveCurrentOrder 提示 toast', () => {
  state.settings.viewMode = 'memo';
  state.notes = [mkNote('a')];
  state.settings.noteOrder = ['a'];
  A.saveCurrentOrder();
  assert.ok(calls.toast.length === 1, '未提示 toast：' + JSON.stringify(calls.toast));
});

test('saveCurrentOrder 在「画布」视图下按坐标读序（而非显示顺序）', () => {
  global.filter.group = 'all';
  state.settings.viewMode = 'board';
  // 横向排开：x 不同、y 相同 → 读序应为 x 升序
  state.notes = [
    mkNote('right', { x: 300, y: 0 }),
    mkNote('left', { x: 0, y: 0 }),
    mkNote('mid', { x: 150, y: 0 })
  ];
  state.settings.noteOrder = ['right', 'left', 'mid'];
  A.saveCurrentOrder();
  assert.deepStrictEqual(state.settings.noteOrder, ['left', 'mid', 'right'],
    '画布视图未按坐标读序：' + JSON.stringify(state.settings.noteOrder));
});

/* ============ ensureOrder ============ */

test('ensureOrder 把补全后的 noteOrder/groupOrders 写回 state.settings', () => {
  state.notes = [mkNote('a'), mkNote('b')];
  state.settings.noteOrder = [];
  state.settings.groupOrders = {};
  A.ensureOrder();
  assert.deepStrictEqual(state.settings.noteOrder.slice().sort(), ['a', 'b'], '未补全全局顺序');
});
