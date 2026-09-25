/* core/app-state.js 单元测试
   覆盖「主窗共享状态容器」的公开行为：访问器配对、跨 target 共享同一份存储、
   引用型状态整体替换、默认 state 结构、get/set 辅助函数等价性。

   测试目标（公开接口，不绑定内部实现）：
   1. install(target) 后，primitives 全部可读可写
   2. install(target) 后，refs 全部可读可写
   3. 访问器写入的值与 getPrimitive/getRef 读到的是同一份
   4. initState(initial) 返回传入对象本身；缺省时返回含 settings/groups/notes/trash 的结构
   5. setPrimitive/setRef 与访问器赋值等价
   6. 同一模块 install 到两个 target，两者共享同一份存储（防「两份 state」经典事故）
*/
const { test } = require('node:test');
const assert = require('node:assert');
const AppState = require('../renderer/core/app-state.js');

// 每个用例用干净 target，避免 install 的 defineProperty 互相污染
const freshTarget = () => ({});

test('install 后 primitives 全部可读可写（访问器成对）', () => {
  const t = freshTarget();
  AppState.install(t);
  for (const k of Object.keys(AppState.primitives)) {
    const desc = Object.getOwnPropertyDescriptor(t, k);
    assert.ok(desc, `缺少访问器属性: ${k}`);
    assert.strictEqual(typeof desc.get, 'function', `${k} 缺少 getter`);
    assert.strictEqual(typeof desc.set, 'function', `${k} 缺少 setter`);
    // 读一次不应抛错
    assert.doesNotThrow(() => t[k], `读取 ${k} 抛错`);
  }
});

test('install 后 refs 全部可读可写（访问器成对）', () => {
  const t = freshTarget();
  AppState.install(t);
  for (const k of Object.keys(AppState.refs)) {
    const desc = Object.getOwnPropertyDescriptor(t, k);
    assert.ok(desc, `缺少访问器属性: ${k}`);
    assert.strictEqual(typeof desc.get, 'function', `${k} 缺少 getter`);
    assert.strictEqual(typeof desc.set, 'function', `${k} 缺少 setter`);
    assert.doesNotThrow(() => t[k], `读取 ${k} 抛错`);
  }
});

test('原始值：通过访问器写入后可读回，且与 getPrimitive 是同一份存储', () => {
  const t = freshTarget();
  AppState.install(t);
  t.multiSelect = true;
  assert.strictEqual(t.multiSelect, true);
  assert.strictEqual(AppState.getPrimitive('multiSelect'), true, '访问器与 getPrimitive 不同步');
  AppState.setPrimitive('multiSelect', false);
  assert.strictEqual(t.multiSelect, false, 'setPrimitive 未反映到访问器');
});

test('引用型：通过访问器写入后可读回，且与 getRef 是同一份存储', () => {
  const t = freshTarget();
  AppState.install(t);
  const fake = { settings: {}, groups: [], notes: [{ id: 'x' }], trash: [] };
  t.state = fake;
  assert.strictEqual(t.state, fake);
  assert.strictEqual(AppState.getRef('state'), fake, '访问器与 getRef 不同步');
  // 引用型 getter 必须返回同一引用（不能是拷贝），否则跨模块改不到一起
  assert.strictEqual(t.selectedNotes, AppState.getRef('selectedNotes'));
});

test('initState(initial) 返回传入对象本身', () => {
  const initial = { settings: { language: 'zh' }, groups: [], notes: [], trash: [] };
  const got = AppState.initState(initial);
  assert.strictEqual(got, initial, 'initState 应返回同一引用');
  assert.strictEqual(AppState.getRef('state'), initial, 'initState 未写入 refs.state');
});

test('initState() 缺省返回含 settings/groups/notes/trash 的完整结构', () => {
  const got = AppState.initState();
  assert.ok(got && typeof got === 'object');
  for (const k of ['settings', 'groups', 'notes', 'trash']) {
    assert.ok(k in got, `缺省 state 缺少字段: ${k}`);
  }
  assert.ok(Array.isArray(got.groups) && Array.isArray(got.notes) && Array.isArray(got.trash));
});

test('★ 关键回归：安装到两个 target 时共享同一份存储（防「两份 state」事故）', () => {
  const a = freshTarget();
  const b = freshTarget();
  AppState.install(a);
  AppState.install(b);

  a.multiSelect = true;
  assert.strictEqual(b.multiSelect, true, 'target B 未看到 A 的写入 —— 状态已分裂！');
  b.multiSelect = false;
  assert.strictEqual(a.multiSelect, false, 'target A 未看到 B 的写入 —— 状态已分裂！');

  const shared = { notes: [] };
  a.state = shared;
  assert.strictEqual(b.state, shared, '引用型状态在两个 target 间不共享');
});

test('setRef 支持整体替换引用', () => {
  const newFilter = { group: 'work', query: 'abc', archive: true };
  AppState.setRef('filter', newFilter);
  assert.strictEqual(AppState.getRef('filter'), newFilter);
  assert.strictEqual(AppState.getRef('filter').group, 'work');
});
