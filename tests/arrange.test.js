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
  isGroupCollapsed: (gid) => !!(global.state && global.state.settings.collapsedGroups && global.state.settings.collapsedGroups[gid]),
  boardZoom: () => 1,
  $: () => null,                 // 默认无 #canvas → 走回退分支
  sortPanelGroupId: 'all',
  filter: { group: 'all', query: '' }
});

// 真实可见选择器与 noteText：来自生产 UMD 模块（依赖 global state/filter），不复制实现。
const CanvasZoom = require('../renderer/board/canvas-zoom.js');
const NoteCard = require('../renderer/board/note-card.js');
const UndoHistory = require('../renderer/core/undo-history.js');
// syncUndoButtons 会查 #btnUndo/#btnRedo；Node 无 document，提供最小 stub（看护真实栈行为）
globalThis.document = globalThis.document || { querySelector: () => null };
Object.assign(global, {
  noteText: NoteCard.noteText,
  visibleNotes: CanvasZoom.visibleNotes,
  isGroupCollapsed: CanvasZoom.isGroupCollapsed,
  UndoHistory,
  // arrange.js 通过顶层全局调用（app.js 提供）；测试注入真实栈的薄封装
  beginUndo: () => UndoHistory.beginUndo(state),
  commitUndoIfChanged: () => UndoHistory.commitUndoIfChanged(state)
});

const A = require('../renderer/system/arrange.js');

let state;
beforeEach(() => {
  calls.save = 0; calls.renderAll = 0; calls.renderSortPanel = 0; calls.toast = [];
  global.filter = { group: 'all', query: '' };
  global.sortPanelGroupId = 'all';
  UndoHistory.clearStacks();
  UndoHistory.cancelUndo();
  UndoHistory.setApplier(() => {});
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

/* ============ UX-30A：可见范围（arrange / saveCurrentOrder） ============ */
const posSnap = () => state.notes.map((n) => ({ id: n.id, x: n.x, y: n.y, pa: n.positionAll })).map((r) => JSON.stringify(r));

test('UX-30A arrangeNotes：只整理可见便签（隐藏项坐标/尺寸/updatedAt 不变），无结果返回 false', () => {
  state.notes = [
    mkNote('v1', { groupId: 'g1', x: 0, y: 0, positionAll: { x: 0, y: 0 }, w: 100, h: 80, updatedAt: 111 }),
    mkNote('v2', { groupId: 'g1', x: 0, y: 0, positionAll: { x: 0, y: 0 }, w: 100, h: 80, updatedAt: 111 }),
    mkNote('hid', { groupId: 'g2', x: 999, y: 888, w: 150, h: 90, updatedAt: 222 })
  ];
  state.groups = [{ id: 'g1' }, { id: 'g2' }];
  global.filter = { group: 'g1', query: '' };
  const beforeHidden = JSON.stringify(state.notes.find((n) => n.id === 'hid'));
  const ok = A.arrangeNotes();
  assert.strictEqual(ok, true, '可见时 arrange 应返回 true');
  assert.strictEqual(JSON.stringify(state.notes.find((n) => n.id === 'hid')), beforeHidden, '隐藏便签被改动');
  // 可见两项被重新打包（分组作用域 x/y 不再停留在 0,0 重叠）
  const v1 = state.notes.find((n) => n.id === 'v1');
  const v2 = state.notes.find((n) => n.id === 'v2');
  assert.ok(v1.x !== v2.x || v1.y !== v2.y, '可见项未被打包去重叠');

  // 无可见结果：返回 false 且不写盘/不渲染/不改 sortMode
  global.filter = { group: 'ghost', query: '' };
  calls.save = 0; calls.renderAll = 0; calls.renderSortPanel = 0; calls.toast = [];
  const before = JSON.stringify(state.notes);
  assert.strictEqual(A.arrangeNotes(), false, '无可见结果应 false');
  assert.strictEqual(calls.save, 0, '无结果不应 save');
  assert.strictEqual(calls.renderAll, 0, '无结果不应 renderAll');
  assert.strictEqual(calls.toast.length, 0, '无结果不应 toast');
  assert.strictEqual(JSON.stringify(state.notes), before, '无结果不得改动数据');
  assert.strictEqual(state.settings.sortMode, 'updated', '无结果不得切换 sortMode');
});

test('UX-30A saveCurrentOrder：只保存可见顺序/位置；隐藏项槽位与坐标保留；快照合并不丢旧项', () => {
  state.notes = [
    mkNote('a', { groupId: 'g1', x: 10, y: 10, positionAll: { x: 10, y: 10 } }),
    mkNote('b', { groupId: 'g1', x: 20, y: 20, positionAll: { x: 20, y: 20 } }),
    mkNote('h', { groupId: 'g2', x: 777, y: 777, positionAll: { x: 777, y: 777 } })
  ];
  state.groups = [{ id: 'g1' }, { id: 'g2' }];
  state.settings.noteOrder = ['h', 'a', 'b']; // 全局顺序：隐藏项 h 占首槽
  state.settings.groupOrders = { g2: ['h'] };
  state.settings.orderLayouts = { _all: { h: { x: 777, y: 777 } } }; // 已有 scope 快照含隐藏项
  global.filter = { group: 'g1', query: '' };
  const ok = A.saveCurrentOrder();
  assert.strictEqual(ok, true, '可见时 saveCurrentOrder 应 true');
  // 隐藏项 h 仍在 noteOrder 中，槽位未被挤掉
  assert.ok(state.settings.noteOrder.includes('h'), 'noteOrder 丢失隐藏项');
  assert.strictEqual(state.settings.groupOrders.g2[0], 'h', '非可见分组的 groupOrders 被改动');
  // 快照合并：隐藏项旧条目保留，可见项写入（scope 键 = 当前分组 g1）
  const sc = state.settings.orderLayouts.g1;
  assert.ok(sc && sc.a && sc.b, '可见项未写入快照');
  assert.strictEqual(state.settings.orderLayouts._all.h.x, 777, '旧快照（其他 scope）被覆盖丢失');

  // 无可见结果：false + 不写盘/不渲染/不 toast/不建快照
  global.filter = { group: 'ghost', query: '' };
  calls.save = 0; calls.renderAll = 0; calls.toast = [];
  const layoutsBefore = JSON.stringify(state.settings.orderLayouts);
  assert.strictEqual(A.saveCurrentOrder(), false, '无可见结果应 false');
  assert.strictEqual(calls.save, 0);
  assert.strictEqual(calls.toast.length, 0);
  assert.strictEqual(JSON.stringify(state.settings.orderLayouts), layoutsBefore, '无结果不应创建快照');
});

test('UX-30A 归档：忽略底层分组过滤，跨分组归档结果一致，且不改动分组 groupOrders', () => {
  state.notes = [
    mkNote('a1', { groupId: 'g1', archived: true, x: 5, y: 5, positionAll: { x: 5, y: 5 } }),
    mkNote('a2', { groupId: 'g2', archived: true, x: 6, y: 6, positionAll: { x: 6, y: 6 } }),
    mkNote('a3', { groupId: null, archived: true, x: 7, y: 7, positionAll: { x: 7, y: 7 } }),
    mkNote('act', { groupId: 'g1', archived: false }),
    mkNote('dp', { archived: true, desktopPin: true })
  ];
  state.groups = [{ id: 'g1' }, { id: 'g2' }];
  state.settings.noteOrder = ['a1', 'a2', 'a3'];
  state.settings.groupOrders = { g1: ['a1'], g2: ['a2'] };
  const g1Before = JSON.stringify(state.settings.groupOrders.g1);
  global.filter = { group: 'g1', archive: true, query: '' }; // 归档 + 底层分组 g1
  assert.strictEqual(A.saveCurrentOrder(), true);
  // 归档忽略底层分组：跨 g1/g2/未分组三项均保留（集合不被裁掉）
  ['a1', 'a2', 'a3'].forEach((id) => assert.ok(state.settings.noteOrder.includes(id), '归档保存丢失 ' + id));
  // 归档保存不得重排 g1 已有顺序（a1 仍居首；ensureOrder 可能补入其他合法 g1 成员）
  assert.strictEqual(state.settings.groupOrders.g1[0], 'a1', '归档保存重排了分组 g1 顺序');
  // ensureOrder 之后归档三项仍完整（不被剔除）
  A.ensureOrder();
  ['a1', 'a2', 'a3'].forEach((id) => assert.ok(state.settings.noteOrder.includes(id), 'ensureOrder 后归档项被剔除：' + id));
});

test('UX-30A 归档读写一致：保存后显示顺序=全局 noteOrder（非分组），ensureOrder 后仍一致', () => {
  // 复现外部评审用例：arc1(g1,x400) arc2(g2,x20) active(g1,非钉桌)
  state.notes = [
    mkNote('arc1', { groupId: 'g1', archived: true, x: 400, y: 400, positionAll: { x: 400, y: 400 }, w: 200, h: 160 }),
    mkNote('arc2', { groupId: 'g2', archived: true, x: 20, y: 20, positionAll: { x: 20, y: 20 }, w: 200, h: 160 }),
    mkNote('active', { groupId: 'g1', archived: false, x: 10, y: 10, positionAll: { x: 10, y: 10 }, w: 200, h: 160 })
  ];
  state.groups = [{ id: 'g1' }, { id: 'g2' }];
  state.settings.noteOrder = [];
  state.settings.groupOrders = { g1: [], g2: [] };
  global.filter = { group: 'g1', archive: true, query: '' }; // 归档 + 底层分组 g1
  // 空间读序：arc2(20,20) 在 arc1(400,400) 之前
  assert.strictEqual(A.saveCurrentOrder(), true);
  // 显示顺序（归档）必须来自全局 noteOrder，而不是分组 g1 的顺序
  const disp = A.getSortedNotes(global.visibleNotes()).map((n) => n.id);
  assert.deepStrictEqual(disp, ['arc2', 'arc1'], '归档显示顺序未按全局 noteOrder');
  // 全局 noteOrder 记录同一顺序（arc2 在 arc1 前）
  assert.ok(state.settings.noteOrder.indexOf('arc2') < state.settings.noteOrder.indexOf('arc1'), 'noteOrder 顺序不一致');
  // g1 分组顺序不被归档保存污染
  assert.deepStrictEqual(state.settings.groupOrders.g1.includes('arc2'), false, 'g1 顺序被写入 g2 归档项');
  // ensureOrder 后仍一致
  A.ensureOrder();
  assert.deepStrictEqual(A.getSortedNotes(global.visibleNotes()).map((n) => n.id).filter((id) => id !== 'active'), ['arc2', 'arc1']);
});

test('UX-30A 真实 noteText：表格单元格/待办文本命中查询', () => {
  state.notes = [
    mkNote('tbl', { groupId: null, content: 'x', tables: [{ id: 'T', rows: 1, cols: 1, cells: [['表格词']], merges: [], diagonals: [] }] }),
    mkNote('todo', { groupId: null, type: 'todo', items: [{ text: '任务词', done: false }] }),
    mkNote('other', { groupId: null, content: '无关' })
  ];
  state.groups = [];
  global.filter = { group: 'all', query: '表格词' };
  assert.deepStrictEqual(global.visibleNotes().map((n) => n.id), ['tbl'], '表格文本未被真实 noteText 命中');
  global.filter = { group: 'all', query: '任务词' };
  assert.deepStrictEqual(global.visibleNotes().map((n) => n.id), ['todo'], '待办文本未被真实 noteText 命中');
});

test('UX-30A 自定义快照整理：arrange 现按当前顺序紧凑打包（不再套用快照），隐藏项仍被排除', () => {
  state.notes = [
    mkNote('v1', { groupId: 'g1', x: 999, y: 999, w: 200, h: 160 }),
    mkNote('v2', { groupId: 'g1', x: 888, y: 888, w: 200, h: 160 }),
    mkNote('hid', { groupId: 'g2', x: 777, y: 777, w: 200, h: 160 })
  ];
  state.groups = [{ id: 'g1' }, { id: 'g2' }];
  state.settings.sortMode = 'custom';
  state.settings.noteOrder = ['v2', 'v1', 'hid'];
  state.settings.groupOrders = { g1: ['v2', 'v1'] };
  state.settings.orderLayouts = { g1: { v1: { x: 30, y: 30 }, v2: { x: 240, y: 30 } } }; // 旧快照（arrange 不再套用）
  global.filter = { group: 'g1', query: '' };
  const snapBefore = JSON.stringify(state.settings.orderLayouts);
  const hidBefore = JSON.stringify(state.notes.find((n) => n.id === 'hid'));
  assert.strictEqual(A.arrangeNotes(), true);
  // 新版语义：按当前自定义顺序 v2,v1 紧凑打包（v2 在 v1 前），而非旧快照的 v1(30)→v2(240)
  const v1 = state.notes.find((n) => n.id === 'v1');
  const v2 = state.notes.find((n) => n.id === 'v2');
  assert.ok(v2.x < v1.x || v2.y < v1.y, '未按当前自定义顺序紧凑打包');
  assert.strictEqual(JSON.stringify(state.settings.orderLayouts), snapBefore, 'arrange 改动了已保存快照');
  assert.strictEqual(JSON.stringify(state.notes.find((n) => n.id === 'hid')), hidBefore, '隐藏项被整理移动');
});

/* ============ UX-30B：整理与显式恢复分离 ============ */
test('UX-30B arrange 遵循新的自定义顺序，不覆盖旧快照，也不切换排序模式', () => {
  state.notes = [
    mkNote('a', { groupId: 'g1', x: 0, y: 0, w: 200, h: 160 }),
    mkNote('b', { groupId: 'g1', x: 0, y: 0, w: 200, h: 160 })
  ];
  state.groups = [{ id: 'g1' }];
  state.settings.sortMode = 'custom';
  state.settings.noteOrder = ['b', 'a'];                 // 当前自定义顺序 b 在前
  state.settings.groupOrders = { g1: ['b', 'a'] };       // 分组视图读取 groupOrders
  state.settings.orderLayouts = { g1: { a: { x: 500, y: 500 }, b: { x: 900, y: 900 } } }; // 旧快照（应忽略）
  global.filter = { group: 'g1', query: '' };
  const snapBefore = JSON.stringify(state.settings.orderLayouts);
  assert.strictEqual(A.arrangeNotes(), true);
  const a = state.notes.find((n) => n.id === 'a');
  const b = state.notes.find((n) => n.id === 'b');
  // 按 b→a 顺序：b 排在 a 之前（行优先）
  assert.ok(b.y < a.y || (b.y === a.y && b.x < a.x), 'arrange 未遵循当前自定义顺序');
  assert.strictEqual(JSON.stringify(state.settings.orderLayouts), snapBefore, 'arrange 覆盖了旧快照');
  assert.strictEqual(state.settings.sortMode, 'custom', 'arrange 切换了排序模式');
  assert.deepStrictEqual(state.settings.noteOrder, ['b', 'a'], 'arrange 改动了自定义顺序');
});

test('UX-30B 显式恢复：忽略当前排序模式，仅还原有效匹配可见项；新/隐藏项不动；内容/尺寸/顺序不变', () => {
  state.notes = [
    mkNote('v1', { groupId: 'g1', content: 'c1', x: 5, y: 5, w: 222, h: 111 }),
    mkNote('v2', { groupId: 'g1', content: 'c2', x: 6, y: 6, w: 222, h: 111 }),
    mkNote('new', { groupId: 'g1', content: 'cn', x: 7, y: 7, w: 200, h: 160 }),   // 未保存：不在快照
    mkNote('hid', { groupId: 'g2', content: 'ch', x: 777, y: 777, w: 200, h: 160 }) // 隐藏
  ];
  state.groups = [{ id: 'g1' }, { id: 'g2' }];
  state.settings.sortMode = 'updated'; // 非 custom 也可恢复
  state.settings.orderLayouts = { g1: { v1: { x: 30, y: 40 }, v2: { x: 260, y: 40 }, hid: { x: 1, y: 1 } } };
  global.filter = { group: 'g1', query: '' };
  const hidBefore = JSON.stringify(state.notes.find((n) => n.id === 'hid'));
  const newBefore = JSON.stringify(state.notes.find((n) => n.id === 'new'));
  assert.strictEqual(A.canRestoreSavedLayout(), true);
  assert.strictEqual(A.restoreSavedLayout(), true);
  assert.deepStrictEqual({ x: state.notes.find((n) => n.id === 'v1').x, y: state.notes.find((n) => n.id === 'v1').y }, { x: 30, y: 40 });
  assert.deepStrictEqual({ x: state.notes.find((n) => n.id === 'v2').x, y: state.notes.find((n) => n.id === 'v2').y }, { x: 260, y: 40 });
  assert.strictEqual(JSON.stringify(state.notes.find((n) => n.id === 'new')), newBefore, '未保存可见项被恢复移动');
  assert.strictEqual(JSON.stringify(state.notes.find((n) => n.id === 'hid')), hidBefore, '隐藏项被恢复移动');
  assert.strictEqual(state.notes.find((n) => n.id === 'v1').content, 'c1');
  assert.deepStrictEqual({ w: state.notes.find((n) => n.id === 'v1').w, h: state.notes.find((n) => n.id === 'v1').h }, { w: 222, h: 111 });
  assert.strictEqual(state.settings.sortMode, 'updated', '恢复改动了排序模式');
});

test('UX-30B 恢复：缺失/畸形快照、全被过滤时 false 且无副作用；all/group 作用域互相独立', () => {
  state.notes = [mkNote('n1', { groupId: 'g1', x: 1, y: 1 })];
  state.groups = [{ id: 'g1' }];
  // 无快照
  state.settings.orderLayouts = {};
  global.filter = { group: 'g1', query: '' };
  assert.strictEqual(A.canRestoreSavedLayout(), false);
  calls.save = 0; calls.renderAll = 0; calls.toast = [];
  assert.strictEqual(A.restoreSavedLayout(), false);
  assert.strictEqual(calls.save, 0, '无快照时不应 save');
  assert.strictEqual(calls.renderAll, 0, '无快照时不应 renderAll');
  assert.strictEqual(calls.toast.length, 0, '无快照时不应 toast');
  // 畸形 / 可强制转换 / 继承条目一律不算可恢复，且 restore 无任何副作用
  const badCases = [
    { x: NaN, y: 3 }, { x: 1, y: Infinity }, { x: -1, y: 5 }, { x: 5, y: -2 },
    { x: '5', y: '6' }, { x: true, y: false }, { x: null, y: 3 }, [1, 2], 'nope', 5
  ];
  for (const bad of badCases) {
    state.settings.orderLayouts = { g1: { n1: bad } };
    calls.save = 0; calls.renderAll = 0; calls.toast = [];
    const before = JSON.stringify(state.notes);
    assert.strictEqual(A.canRestoreSavedLayout(), false, '可恢复误判：' + JSON.stringify(bad));
    assert.strictEqual(A.restoreSavedLayout(), false, 'restore 未拒绝：' + JSON.stringify(bad));
    assert.strictEqual(calls.save, 0, '非法条目触发了 save');
    assert.strictEqual(calls.renderAll, 0, '非法条目触发了 renderAll');
    assert.strictEqual(calls.toast.length, 0, '非法条目触发了 toast');
    assert.strictEqual(JSON.stringify(state.notes), before, '非法条目改动了位置');
  }
  // 继承条目（原型上存在，但非自有）不得被恢复
  const proto = { n1: { x: 7, y: 7 } };
  const inherited = Object.create(proto);
  state.settings.orderLayouts = { g1: inherited };
  assert.strictEqual(A.canRestoreSavedLayout(), false, '继承条目被误判为可恢复');
  assert.strictEqual(A.restoreSavedLayout(), false, '继承条目被恢复');
  // 全被查询过滤：可见为空 -> false
  state.settings.orderLayouts = { g1: { n1: { x: 5, y: 5 } } };
  global.filter = { group: 'g1', query: 'zzz' };
  assert.strictEqual(A.canRestoreSavedLayout(), false);
  // 作用域独立：_all 快照不改 g1 视图的可恢复性
  state.settings.orderLayouts = { _all: { n1: { x: 9, y: 9 } } };
  global.filter = { group: 'g1', query: '' };
  assert.strictEqual(A.canRestoreSavedLayout(), false, 'g1 视图误读了 _all 快照');
  global.filter = { group: 'all', query: '' };
  assert.strictEqual(A.canRestoreSavedLayout(), true, 'all 视图未读到 _all 快照');
});

test('UX-30B 成功恢复：快照 map 与排序顺序保持不变', () => {
  state.notes = [
    mkNote('v1', { groupId: 'g1', x: 5, y: 5 }),
    mkNote('v2', { groupId: 'g1', x: 6, y: 6 })
  ];
  state.groups = [{ id: 'g1' }];
  state.settings.sortMode = 'custom';
  state.settings.groupOrders = { g1: ['v2', 'v1'] };
  state.settings.orderLayouts = { g1: { v1: { x: 30, y: 40 }, v2: { x: 260, y: 40 } } };
  global.filter = { group: 'g1', query: '' };
  const snapBefore = JSON.stringify(state.settings.orderLayouts);
  const orderBefore = JSON.stringify(state.settings.groupOrders);
  assert.strictEqual(A.restoreSavedLayout(), true);
  assert.strictEqual(JSON.stringify(state.settings.orderLayouts), snapBefore, '恢复改动了快照 map');
  assert.strictEqual(JSON.stringify(state.settings.groupOrders), orderBefore, '恢复改动了排序顺序');
});

/* ============ UX-30C：视口/固定隐藏项/恢复冲突 ============ */
test('UX-30C arrange：为被查询隐藏的同作用域便签保留固定矩形，清空查询后不新暴露重叠', () => {
  state.notes = [
    mkNote('a', { groupId: null, x: 20, y: 20, positionAll: { x: 20, y: 20 }, w: 240, h: 200 }),
    mkNote('b', { groupId: null, x: 300, y: 20, positionAll: { x: 300, y: 20 }, w: 240, h: 200 }),
    mkNote('hid', { groupId: null, x: 20, y: 260, positionAll: { x: 20, y: 260 }, w: 240, h: 200 })
  ];
  state.groups = [];
  global.filter = { group: 'all', query: 'a' };   // 只命中 a（title a）；b/hid 隐藏
  const hidBefore = JSON.stringify(state.notes.find((n) => n.id === 'hid'));
  assert.strictEqual(A.arrangeNotes(), true);
  // a 被排布；hid 固定位置不变
  assert.strictEqual(JSON.stringify(state.notes.find((n) => n.id === 'hid')), hidBefore, '隐藏项被移动');
  // a 不与 hid 固定矩形重叠
  const a = state.notes.find((n) => n.id === 'a');
  const hid = state.notes.find((n) => n.id === 'hid');
  const overlap = (a.x < hid.x + hid.w + 18) && (a.x + a.w + 18 > hid.x) && (a.y < hid.y + hid.h + 18) && (a.y + a.h + 18 > hid.y);
  assert.ok(!overlap, 'arrange 后 a 与隐藏项重叠');
  // 清空查询：b/hid 位置不变，无新增重叠（a/b/hid 两两不重叠）
  global.filter = { group: 'all', query: '' };
  const rs = ['a', 'b', 'hid'].map((id) => state.notes.find((n) => n.id === id));
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const x = rs[i], y = rs[j];
    const ov = (x.x < y.x + y.w + 18) && (x.x + x.w + 18 > y.x) && (x.y < y.y + y.h + 18) && (x.y + x.h + 18 > y.y);
    assert.ok(!ov, x.id + ' 与 ' + y.id + ' 清空查询后重叠');
  }
});

test('UX-30C 恢复冲突：数列出重叠/越界并提示冲突；无关既有重叠不误报；无匹配无副作用', () => {
  state.notes = [
    mkNote('a', { groupId: null, x: 5, y: 5, w: 240, h: 200 }),
    mkNote('b', { groupId: null, x: 6, y: 6, w: 600, h: 200 })  // 恢复后越界（>可用宽）
  ];
  state.groups = [];
  global.filter = { group: 'all', query: '' };
  global.$ = (sel) => (sel === '#canvas' ? { clientWidth: 400 } : null); // 视口 400 -> 可用 360，600 越界
  global.boardZoom = () => 1;
  state.settings.orderLayouts = { _all: { a: { x: 20, y: 20 }, b: { x: 20, y: 20 } } };
  calls.toast = [];
  assert.strictEqual(A.restoreSavedLayout(), true);
  // 精确恢复（不做静默适配）：b 被放到保存位置（越界由提示说明）
  assert.deepStrictEqual(state.notes.find((n) => n.id === 'b').positionAll, { x: 20, y: 20 });
  assert.deepStrictEqual(calls.toast, ['toast_layout_restored_conflict'], '越界未给冲突提示');
  // 无冲突（正常）使用普通成功提示
  state.settings.orderLayouts = { _all: { a: { x: 20, y: 20 } } };
  state.notes = [mkNote('a', { groupId: null, x: 5, y: 5, w: 240, h: 200 })];
  calls.toast = [];
  assert.strictEqual(A.restoreSavedLayout(), true);
  assert.deepStrictEqual(calls.toast, ['toast_layout_restored'], '正常恢复未用普通提示');
  // 无匹配：false 且无副作用
  state.settings.orderLayouts = { _all: {} };
  calls.save = 0; calls.renderAll = 0; calls.toast = [];
  assert.strictEqual(A.restoreSavedLayout(), false);
  assert.strictEqual(calls.save, 0); assert.strictEqual(calls.renderAll, 0); assert.strictEqual(calls.toast.length, 0);
  global.$ = () => null;
});

test('UX-30C 恢复冲突仅限同作用域：其他分组/相反归档/钉桌不计为障碍', () => {
  state.notes = [
    mkNote('a', { groupId: 'g1', x: 5, y: 5, w: 240, h: 200 }),
    // 与 a 恢复位置重叠，但属于其他分组 -> 不应算障碍
    mkNote('other', { groupId: 'g2', x: 20, y: 20, w: 240, h: 200 }),
    mkNote('dp', { groupId: 'g1', desktopPin: true, x: 20, y: 20, w: 240, h: 200 })
  ];
  state.groups = [{ id: 'g1' }, { id: 'g2' }];
  global.filter = { group: 'g1', query: '' };
  state.settings.orderLayouts = { g1: { a: { x: 20, y: 20 } } };
  calls.toast = [];
  assert.strictEqual(A.restoreSavedLayout(), true);
  assert.deepStrictEqual(calls.toast, ['toast_layout_restored'], '其他分组/钉桌被误判为障碍');
});

test('UX-30C arrange 混合普通/超大（400 视口）：普通在可用宽内打包，超大在下方一行，首个超大无幻影行', () => {
  state.notes = [
    mkNote('n1', { groupId: null, x: 0, y: 0, positionAll: { x: 0, y: 0 }, w: 200, h: 160 }),
    mkNote('n2', { groupId: null, x: 0, y: 0, positionAll: { x: 0, y: 0 }, w: 200, h: 160 }),
    mkNote('big', { groupId: null, x: 0, y: 0, positionAll: { x: 0, y: 0 }, w: 385, h: 160 })
  ];
  state.groups = [];
  global.filter = { group: 'all', query: '' };
  global.$ = (sel) => (sel === '#canvas' ? { clientWidth: 400 } : null); // 可用 360
  global.boardZoom = () => 1;
  assert.strictEqual(A.arrangeNotes(), true);
  const pa = (id) => state.notes.find((n) => n.id === id).positionAll;
  const big = pa('big');
  // 超大：左边界、在普通卡下方，自身尺寸不变
  assert.strictEqual(big.x, LAYOUT.margin);
  assert.ok(big.y > pa('n1').y && big.y > pa('n2').y, '超大未排在普通卡下方');
  assert.strictEqual(state.notes.find((n) => n.id === 'big').w, 385);
  // 普通卡右边界 <= 380
  ['n1', 'n2'].forEach((id) => { const p = pa(id); const n = state.notes.find((x) => x.id === id); assert.ok(p.x + n.w <= 400 - LAYOUT.margin, id + ' 越界'); });
  global.$ = () => null;
});

test('UX-30C arrange 单个超大（无普通/障碍）：从 y=margin 开始，无幻影行', () => {
  state.notes = [mkNote('big', { groupId: null, x: 0, y: 0, positionAll: { x: 0, y: 0 }, w: 385, h: 160 })];
  state.groups = [];
  global.filter = { group: 'all', query: '' };
  global.$ = (sel) => (sel === '#canvas' ? { clientWidth: 400 } : null);
  global.boardZoom = () => 1;
  assert.strictEqual(A.arrangeNotes(), true);
  assert.deepStrictEqual(state.notes[0].positionAll, { x: LAYOUT.margin, y: LAYOUT.margin }, '首个超大未从 margin 开始（幻影行）');
  global.$ = () => null;
});

test('UX-30C 恢复提示用真实重叠（不含间距）：贴边/近距不误报，真实重叠与越出视口才报警', () => {
  global.$ = (sel) => (sel === '#canvas' ? { clientWidth: 400 } : null); // 视口 400（右边界 400）
  global.boardZoom = () => 1;
  // 保存时故意贴边（a 右边缘正好到 400）：不报警
  state.notes = [
    mkNote('a', { groupId: null, x: 250, y: 20, w: 150, h: 200 }),
    mkNote('b', { groupId: null, x: 20, y: 20, w: 220, h: 200 }) // 与 a 仅 10px 间距
  ];
  state.groups = [];
  global.filter = { group: 'all', query: '' };
  state.settings.orderLayouts = { _all: { a: { x: 250, y: 20 }, b: { x: 20, y: 20 } } };
  calls.toast = [];
  assert.strictEqual(A.restoreSavedLayout(), true);
  assert.deepStrictEqual(calls.toast, ['toast_layout_restored'], '贴边/近距被误报为冲突');
  // 真实重叠：报警
  state.settings.orderLayouts = { _all: { a: { x: 100, y: 20 }, b: { x: 150, y: 20 } } };
  calls.toast = [];
  assert.strictEqual(A.restoreSavedLayout(), true);
  assert.deepStrictEqual(calls.toast, ['toast_layout_restored_conflict'], '真实重叠未报警');
  // 恰好贴到视口右边界（a x250+w150=400）：不算越界
  state.notes = [mkNote('a', { groupId: null, x: 5, y: 5, w: 150, h: 200 })];
  state.settings.orderLayouts = { _all: { a: { x: 250, y: 20 } } };
  calls.toast = [];
  assert.strictEqual(A.restoreSavedLayout(), true);
  assert.deepStrictEqual(calls.toast, ['toast_layout_restored'], '恰好贴边被误报越界');
  // 真正超出视口（x260+w150=410>400）：报警
  state.notes = [mkNote('a', { groupId: null, x: 5, y: 5, w: 150, h: 200 })];
  state.settings.orderLayouts = { _all: { a: { x: 260, y: 20 } } };
  calls.toast = [];
  assert.strictEqual(A.restoreSavedLayout(), true);
  assert.deepStrictEqual(calls.toast, ['toast_layout_restored_conflict'], '真实越界未报警');
  global.$ = () => null;
});

/* ============ UX-30D：撤销/重做布局操作（真实 UndoHistory） ============ */
test('UX-30D saveCurrentOrder：一次操作恰好一个历史项，快照含坐标/顺序/设置；重复无变化不入栈、保 redo', () => {
  state.notes = [mkNote('a', { groupId: null, x: 20, y: 20, positionAll: { x: 20, y: 20 } }), mkNote('b', { groupId: null, x: 300, y: 20, positionAll: { x: 300, y: 20 } })];
  state.groups = [];
  state.settings.sortMode = 'updated';
  state.settings.orderLayouts = {};
  global.filter = { group: 'all', query: '' };
  assert.strictEqual(A.saveCurrentOrder(), true);
  const u1 = UndoHistory.stacks().undoStack;
  assert.strictEqual(u1.length, 1, '一次 save 应恰好一个历史项');
  // 快照含设置（sortMode 变 custom；orderLayouts 含可见项）
  assert.strictEqual(u1[0].orders.sortMode, 'updated', '快照未记录操作前 sortMode');
  assert.deepStrictEqual(u1[0].orders.orderLayouts, {}, '快照未记录操作前 orderLayouts');
  assert.deepStrictEqual(u1[0].orders.noteOrder, [], '快照未记录操作前 noteOrder');
  // 制造 redo：undo 一次
  UndoHistory.undo(state);
  assert.strictEqual(UndoHistory.stacks().redoStack.length, 1);
  // 重复同一 save（当前状态与操作后一致，但相对 pending 无变化）→ 不入栈、保 redo
  assert.strictEqual(A.saveCurrentOrder(), true);
  assert.strictEqual(UndoHistory.stacks().undoStack.length, 0, '无变化仍入栈');
  assert.strictEqual(UndoHistory.stacks().redoStack.length, 1, '无变化清空了 redo');
});

test('UX-30D arrangeNotes：一次操作一个历史项（含 ensureOrder 变更）；再次整理无变化不入栈并保 redo', () => {
  state.notes = [mkNote('a', { groupId: null, x: 900, y: 900, positionAll: { x: 900, y: 900 } }), mkNote('b', { groupId: null, x: 1500, y: 700, positionAll: { x: 1500, y: 700 } })];
  state.groups = [];
  state.settings.sortMode = 'updated';
  state.settings.noteOrder = [];
  global.filter = { group: 'all', query: '' };
  assert.strictEqual(A.arrangeNotes(), true);
  assert.strictEqual(UndoHistory.stacks().undoStack.length, 1, 'arrange 应恰好一个历史项');
  const before = UndoHistory.stacks().undoStack[0];
  // 快照记录的是「操作前」状态：此时 noteOrder 为空（未 ensureOrder）
  assert.deepStrictEqual(before.orders.noteOrder, [], '快照未记录操作前 noteOrder');
  // 操作后 ensureOrder 已把缺失 ID 补入（说明 ensureOrder 变更确实发生，可被撤销回退）
  assert.deepStrictEqual(state.settings.noteOrder.slice().sort(), ['a', 'b'], 'arrange 后 ensureOrder 未补全');
  UndoHistory.undo(state);
  assert.strictEqual(UndoHistory.stacks().redoStack.length, 1);
  // 再次 arrange：坐标已就位，相对 pending 无变化 → 不入栈、保 redo
  assert.strictEqual(A.arrangeNotes(), true);
  assert.strictEqual(UndoHistory.stacks().undoStack.length, 0, '重复 arrange 入栈');
  assert.strictEqual(UndoHistory.stacks().redoStack.length, 1, '重复 arrange 清空 redo');
});

test('UX-30D restoreSavedLayout：有可恢复项→一个历史项；无目标/无变化→无历史项且无副作用', () => {
  state.notes = [mkNote('a', { groupId: null, x: 500, y: 500, positionAll: { x: 500, y: 500 } })];
  state.groups = [];
  state.settings.orderLayouts = { _all: { a: { x: 20, y: 20 } } };
  global.filter = { group: 'all', query: '' };
  assert.strictEqual(A.restoreSavedLayout(), true);
  assert.strictEqual(UndoHistory.stacks().undoStack.length, 1, 'restore 应恰好一个历史项');
  assert.deepStrictEqual(UndoHistory.stacks().undoStack[0].orders.orderLayouts, { _all: { a: { x: 20, y: 20 } } }, '快照未记录恢复前 orderLayouts');
  // 再次 restore：位置已等于保存值 → 无变化，不入栈
  const u = UndoHistory.stacks().undoStack.length;
  assert.strictEqual(A.restoreSavedLayout(), true);
  assert.strictEqual(UndoHistory.stacks().undoStack.length, u, '无变化 restore 入栈');
  // 无目标：false，不入栈、无 save/render/toast
  state.settings.orderLayouts = {};
  assert.strictEqual(UndoHistory.stacks().undoStack.length, u);
  calls.save = 0; calls.renderAll = 0; calls.toast = [];
  assert.strictEqual(A.restoreSavedLayout(), false);
  assert.strictEqual(UndoHistory.stacks().undoStack.length, u, '无目标 restore 入栈');
  assert.strictEqual(calls.save, 0); assert.strictEqual(calls.renderAll, 0); assert.strictEqual(calls.toast.length, 0);
});
