/* core/undo-history.js 单元测试
   覆盖「撤销/重做快照栈」的公开行为：快照深拷贝、栈管理、上限裁剪、
   依赖注入回调、undo↔redo 往返一致性。

   测试目标（公开接口）：
   1. snapshotState 产出深拷贝（改原对象不影响快照，反之亦然）
   2. pushUndo 后再 undo，注入的 applier 收到的是压栈时的快照
   3. undo → redo 往返后状态与 undo 前一致
   4. 撤销栈超过 MAX_UNDO 时丢弃最旧项
   5. pushUndo 清空 redoStack（新操作使其后的重做失效）
   6. setApplier(fn) 注入生效；未注入时 undo 不抛错
   7. clearStacks 后 undo/redo 为无操作
   8. cloneTrash 深拷贝内层 note
   9. 空栈时 undo/redo 不抛错（边界）
*/
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const H = require('../renderer/core/undo-history.js');

// syncUndoButtons 会查 #btnUndo/#btnRedo；Node 无 document，提供最小 stub
globalThis.document = globalThis.document || { querySelector: () => null };

beforeEach(() => {
  H.clearStacks();
  H.cancelUndo();          // 清掉可能残留的 pending 快照
  H.setApplier(() => {});
});

const mkState = (notes) => ({
  notes: notes || [],
  trash: [],
  groups: [],
  settings: { noteOrder: [], groupOrders: {} }
});

test('snapshotState 产出深拷贝：改原对象不影响快照', () => {
  const state = mkState([{ id: 'a', title: '原' }]);
  const snap = H.snapshotState(state);
  state.notes[0].title = '改了';
  state.notes.push({ id: 'b' });
  assert.strictEqual(snap.notes[0].title, '原', '快照被原对象后续修改污染');
  assert.strictEqual(snap.notes.length, 1, '快照遗漏了深拷贝');
});

test('snapshotState 深拷贝 settings 排序字段', () => {
  const state = mkState();
  state.settings.noteOrder = ['a', 'b'];
  state.settings.groupOrders = { g1: ['a'] };
  const snap = H.snapshotState(state);
  state.settings.noteOrder.push('c');
  state.settings.groupOrders.g1.push('x');
  assert.deepStrictEqual(snap.orders.noteOrder, ['a', 'b']);
  assert.deepStrictEqual(snap.orders.groupOrders, { g1: ['a'] });
});

test('pushUndo 后 undo：applier 收到压栈时的快照', () => {
  let received = null;
  H.setApplier((s) => { received = s; });
  const state = mkState([{ id: 'a', title: 'v1' }]);
  H.pushUndo(state);
  state.notes[0].title = 'v2';
  H.undo(state);
  assert.ok(received, 'applier 未被调用');
  assert.strictEqual(received.notes[0].title, 'v1', '收到的是修改后的状态而非快照');
});

test('★ 关键回归：undo → redo 往返后状态与 undo 前一致', () => {
  let applied = null;
  H.setApplier((s) => { applied = s; });
  const state = mkState([{ id: 'a', title: 'v1' }]);
  H.pushUndo(state);
  state.notes[0].title = 'v2';

  H.undo(state);                              // 回到 v1
  assert.strictEqual(applied.notes[0].title, 'v1');
  state.notes[0].title = 'v1';                // 模拟 applier 真正恢复

  H.redo(state);                              // 重做到 v2
  assert.strictEqual(applied.notes[0].title, 'v2', 'redo 未恢复到 undo 前的状态');
});

test('撤销栈超过 MAX_UNDO 时丢弃最旧项', () => {
  const state = mkState();
  for (let i = 0; i < H.MAX_UNDO + 5; i++) {
    state.notes = [{ id: 'n' + i }];
    H.pushUndo(state);
  }
  assert.strictEqual(H.stacks().undoStack.length, H.MAX_UNDO, '栈未按上限裁剪');
  // 最旧项应已被丢弃：逐次 undo 拿到的第一个快照不应是 n0
  let last = null;
  H.setApplier((s) => { last = s; });
  for (let i = 0; i < H.MAX_UNDO; i++) H.undo(state);
  assert.notStrictEqual(last.notes[0].id, 'n0', '最旧快照未被丢弃');
});

test('pushUndo 清空 redoStack（新操作使重做失效）', () => {
  const state = mkState([{ id: 'a' }]);
  H.pushUndo(state);
  H.undo(state);
  assert.strictEqual(H.stacks().redoStack.length, 1, 'undo 后应有可重做项');
  H.pushUndo(mkState([{ id: 'b' }]));
  assert.strictEqual(H.stacks().redoStack.length, 0, 'pushUndo 未清空 redoStack');
});

test('setApplier 注入生效；未注入时 undo 不抛错', () => {
  const calls = [];
  H.setApplier((s) => calls.push(s));
  H.pushUndo(mkState());
  H.undo(mkState());
  assert.strictEqual(calls.length, 1);

  H.setApplier(null);                          // 复位为 noop
  H.pushUndo(mkState());
  assert.doesNotThrow(() => H.undo(mkState()));
});

test('clearStacks 后 undo/redo 为无操作', () => {
  H.pushUndo(mkState());
  H.clearStacks();
  let called = 0;
  H.setApplier(() => { called++; });
  H.undo(mkState());
  H.redo(mkState());
  assert.strictEqual(called, 0, '清栈后仍触发了恢复');
  assert.strictEqual(H.stacks().undoStack.length, 0);
  assert.strictEqual(H.stacks().redoStack.length, 0);
});

test('cloneTrash 深拷贝内层 note', () => {
  const trash = [{ id: 't1', deletedAt: 1, note: { id: 'a', title: '原' } }];
  const copy = H.cloneTrash(trash);
  trash[0].note.title = '改了';
  assert.strictEqual(copy[0].note.title, '原', 'cloneTrash 未深拷贝内层 note');
});

test('空栈时 undo/redo 不抛错，且不破坏栈状态', () => {
  assert.doesNotThrow(() => H.undo(mkState()));
  assert.doesNotThrow(() => H.redo(mkState()));
  assert.strictEqual(H.stacks().undoStack.length, 0);
  assert.strictEqual(H.stacks().redoStack.length, 0);
});

test('cloneNotes 对 null/undefined 安全（边界）', () => {
  assert.deepStrictEqual(H.cloneNotes(null), []);
  assert.deepStrictEqual(H.cloneNotes(undefined), []);
  assert.deepStrictEqual(H.cloneTrash(null), []);
});

/* ===== 延迟提交（beginUndo / commitUndo / cancelUndo）=====
   动机：拖动/缩放历史上在「按下」即 pushUndo，导致点击无位移也产生历史项。
   新语义：beginUndo 只暂存前置快照，确认有变化才 commitUndo 入栈。 */

test('beginUndo 不入栈：仅暂存前置快照', () => {
  const state = mkState([{ id: 'a', title: 'v1' }]);
  H.beginUndo(state);
  assert.strictEqual(H.stacks().undoStack.length, 0, 'beginUndo 不应直接入栈');
});

test('★ 关键回归：beginUndo + cancelUndo（点击无位移）不产生历史项', () => {
  const state = mkState([{ id: 'a', title: 'v1' }]);
  H.beginUndo(state);
  H.cancelUndo();                                 // 模拟 pointerup 时位移为 0
  assert.strictEqual(H.stacks().undoStack.length, 0, '无变化操作产生了历史项（本次修复的缺陷）');
  let applied = null;
  H.setApplier((s) => { applied = s; });
  H.undo(state);
  assert.strictEqual(applied, null, '无历史项时 undo 不应触发恢复');
});

test('★ 关键回归：beginUndo + commitUndo 后撤销可回到操作前状态', () => {
  let applied = null;
  H.setApplier((s) => { applied = s; });
  const state = mkState([{ id: 'a', title: 'v1' }]);
  H.beginUndo(state);                             // 拖动开始：记录 v1
  state.notes[0].title = 'v2';                    // 拖动发生位移
  H.commitUndo();                                 // 确认有变化：入栈
  assert.strictEqual(H.stacks().undoStack.length, 1, 'commitUndo 未入栈');
  H.undo(state);
  assert.strictEqual(applied.notes[0].title, 'v1', '撤销未回到拖动前状态');
});

test('beginUndo 覆盖写：连续 beginUndo 只有最后一次生效', () => {
  const s1 = mkState([{ id: 'a', title: 'first' }]);
  const s2 = mkState([{ id: 'a', title: 'second' }]);
  H.beginUndo(s1);
  H.beginUndo(s2);
  H.commitUndo();
  assert.strictEqual(H.stacks().undoStack.length, 1, '重复 beginUndo 产生了多个历史项');
  let applied = null;
  H.setApplier((s) => { applied = s; });
  H.undo(mkState());
  assert.strictEqual(applied.notes[0].title, 'second', '入栈的不是最后一次暂存快照');
});

test('commitUndo 在无 pending 时为无操作（安全）', () => {
  H.commitUndo();
  assert.strictEqual(H.stacks().undoStack.length, 0, '无暂存时 commitUndo 不应入栈');
});

test('cancelUndo 在无 pending 时为无操作（安全）', () => {
  assert.doesNotThrow(() => H.cancelUndo());
  assert.strictEqual(H.stacks().undoStack.length, 0);
});

test('commitUndo 清空 redoStack（新操作使重做失效）', () => {
  const state = mkState([{ id: 'a' }]);
  H.pushUndo(state);
  H.undo(state);
  assert.strictEqual(H.stacks().redoStack.length, 1);
  H.beginUndo(state);
  H.commitUndo();
  assert.strictEqual(H.stacks().redoStack.length, 0, 'commitUndo 未清空 redoStack');
});

test('beginUndo(null) 安全：后续 commitUndo 不入栈', () => {
  assert.doesNotThrow(() => H.beginUndo(null));
  H.commitUndo();
  assert.strictEqual(H.stacks().undoStack.length, 0, 'beginUndo(null) 后 commitUndo 不应入栈');
});

test('commitUndo 也受 MAX_UNDO 上限约束', () => {
  const state = mkState();
  for (let i = 0; i < H.MAX_UNDO + 3; i++) {
    state.notes = [{ id: 'n' + i }];
    H.beginUndo(state);
    H.commitUndo();
  }
  assert.strictEqual(H.stacks().undoStack.length, H.MAX_UNDO, 'commitUndo 未按上限裁剪');
});

test('cancelUndo 不影响已有历史项', () => {
  const state = mkState([{ id: 'a' }]);
  H.pushUndo(state);
  H.beginUndo(state);
  H.cancelUndo();
  assert.strictEqual(H.stacks().undoStack.length, 1, 'cancelUndo 误删了已有历史项');
});

/* ===== cloneNotes 深拷贝完整性（便签含嵌套结构时不能被浅拷贝共享引用） ===== */

test('★ 关键回归：cloneNotes 深拷 reminder 嵌套对象（改副本不影响原对象）', () => {
  const notes = [{ id: 'a', reminder: { enabled: true, time: 'T1', fired: false } }];
  const copy = H.cloneNotes(notes);
  copy[0].reminder.fired = true;
  copy[0].reminder.time = 'T2';
  assert.strictEqual(notes[0].reminder.fired, false, 'reminder 被浅拷贝共享引用');
  assert.strictEqual(notes[0].reminder.time, 'T1', 'reminder 被浅拷贝共享引用');
});

test('★ 关键回归：cloneNotes 深拷 items（待办项数组内对象）', () => {
  const notes = [{ id: 'a', items: [{ id: 'i1', text: '第一', done: false }] }];
  const copy = H.cloneNotes(notes);
  copy[0].items[0].text = '改了';
  copy[0].items[0].done = true;
  copy[0].items.push({ id: 'i2', text: '新的', done: false });
  assert.strictEqual(notes[0].items.length, 1, 'items 数组被共享');
  assert.strictEqual(notes[0].items[0].text, '第一', 'items 内对象被共享');
  assert.strictEqual(notes[0].items[0].done, false, 'items 内对象被共享');
});

test('★ 关键回归：cloneNotes 深拷 tables 的二维 cells（表格最容易漏）', () => {
  const notes = [{
    id: 'a',
    tables: [{ id: 't1', rows: 2, cols: 2, cells: [['a1', 'a2'], ['b1', 'b2']], merges: [{ r: 0, c: 0 }], diagonals: [] }]
  }];
  const copy = H.cloneNotes(notes);
  copy[0].tables[0].cells[0][0] = '改了';
  copy[0].tables[0].cells[1].push('新列');
  copy[0].tables[0].merges[0].r = 9;
  assert.strictEqual(notes[0].tables[0].cells[0][0], 'a1', 'cells 外层数组被共享');
  assert.strictEqual(notes[0].tables[0].cells[1].length, 2, 'cells 内层数组被共享（二维拷贝不完整）');
  assert.strictEqual(notes[0].tables[0].merges[0].r, 0, 'merges 内对象被共享');
});

test('★ 关键回归：cloneNotes 深拷 images / files', () => {
  const notes = [{ id: 'a', images: [{ id: 'im1', src: 'x', w: 10 }], files: [{ id: 'f1', name: 'a.txt', path: '/p' }] }];
  const copy = H.cloneNotes(notes);
  copy[0].images[0].w = 999;
  copy[0].files[0].name = '改了';
  assert.strictEqual(notes[0].images[0].w, 10, 'images 内对象被共享');
  assert.strictEqual(notes[0].files[0].name, 'a.txt', 'files 内对象被共享');
});

test('★ 关键回归：cloneNotes 保留新增未知字段（未来加字段不能被丢弃）', () => {
  const notes = [{ id: 'a', 未来字段: { deep: [1, 2, 3] } }];
  const copy = H.cloneNotes(notes);
  assert.ok(copy[0].未来字段, '未知字段被丢弃（会静默丢数据）');
  copy[0].未来字段.deep.push(4);
  assert.strictEqual(notes[0].未来字段.deep.length, 3, '未知嵌套字段被共享引用');
});

test('cloneNotes 对便签 15 类字段的结构化克隆与 JSON 克隆结果深等', () => {
  const sample = [{
    id: 'n1', title: '标题', content: '正文 [[img:im1]]', color: '#fff', textColor: '#000',
    fontSize: 14, fontFamily: 'system', pinned: true, groupId: 'g1', type: 'todo',
    archived: false, preview: false, desktopPin: false, opacity: 100,
    x: 1, y: 2, w: 260, h: 200, z: 5, positionAll: { x: 3, y: 4 },
    createdAt: 1, updatedAt: 2,
    reminder: { enabled: true, time: 'T', fired: false },
    items: [{ id: 'i1', text: '待办', done: false }],
    images: [{ id: 'im1', src: 'data:', w: 10, h: 20 }],
    files: [{ id: 'f1', name: 'f.txt', path: '/p', size: 1 }],
    tables: [{ id: 't1', rows: 1, cols: 1, cells: [['x']], merges: [], diagonals: [] }]
  }];
  const a = JSON.stringify(H.cloneNotes(sample));
  const b = JSON.stringify(JSON.parse(JSON.stringify(sample)));
  assert.strictEqual(a, b, '结构化克隆与 JSON 克隆结果不一致（有字段被漏拷或改形）');
});


