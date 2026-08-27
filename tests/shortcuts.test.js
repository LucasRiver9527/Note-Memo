const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../renderer/shortcuts.js');

test('DEFAULT_SHORTCUTS 默认值完整且含全局+编辑器两组', () => {
  assert.strictEqual(S.DEFAULT_SHORTCUTS.toggleWindow, 'CommandOrControl+Shift+M');
  assert.strictEqual(S.DEFAULT_SHORTCUTS.createNote, 'CommandOrControl+Shift+N');
  assert.strictEqual(S.DEFAULT_SHORTCUTS.bold, 'CommandOrControl+B');
  assert.strictEqual(S.DEFAULT_SHORTCUTS.highlight, 'CommandOrControl+H');
  assert.strictEqual(S.DEFAULT_SHORTCUTS.alignLeft, 'CommandOrControl+L');
  assert.strictEqual(S.DEFAULT_SHORTCUTS.alignCenter, 'CommandOrControl+E');
  assert.strictEqual(S.DEFAULT_SHORTCUTS.alignRight, 'CommandOrControl+R');
  assert.strictEqual(S.DEFAULT_SHORTCUTS.copyImage, 'CommandOrControl+C');
  assert.strictEqual(S.DEFAULT_SHORTCUTS.undo, 'CommandOrControl+Z');
  assert.strictEqual(S.DEFAULT_SHORTCUTS.redo, 'CommandOrControl+Shift+Z');
  // SHORTCUT_DEFS 每个 id 都有默认值
  S.SHORTCUT_DEFS.forEach((d) => assert.ok(S.DEFAULT_SHORTCUTS[d.id], '缺少默认: ' + d.id));
  // 应用级(app)快捷键包含撤销/重做
  const appIds = S.SHORTCUT_DEFS.filter((d) => d.scope === 'app').map((d) => d.id);
  assert.deepStrictEqual(appIds, ['undo', 'redo']);
});

test('effectiveShortcuts：未覆盖用默认，覆盖生效', () => {
  const eff = S.effectiveShortcuts({ shortcuts: { bold: 'Control+Shift+K' } });
  assert.strictEqual(eff.bold, 'Control+Shift+K');
  assert.strictEqual(eff.toggleWindow, 'CommandOrControl+Shift+M');
  // 空 settings 全默认
  const d = S.effectiveShortcuts({});
  assert.deepStrictEqual(d, S.buildDefaultShortcuts());
  // shortcuts 为 null 安全
  const d2 = S.effectiveShortcuts({ shortcuts: null });
  assert.strictEqual(d2.bold, 'CommandOrControl+B');
});

test('getShortcut：按 id 取覆盖值或默认', () => {
  assert.strictEqual(S.getShortcut({ shortcuts: { bold: 'Control+Z' } }, 'bold'), 'Control+Z');
  assert.strictEqual(S.getShortcut({}, 'bold'), 'CommandOrControl+B');
});

test('parseAccel：正确拆分修饰键与主键', () => {
  const p = S.parseAccel('CommandOrControl+Shift+M');
  assert.strictEqual(p.mods.cmdcntrl, true);
  assert.strictEqual(p.mods.shift, true);
  assert.strictEqual(p.key, 'M');
  const q = S.parseAccel('Control+B');
  assert.strictEqual(q.mods.ctrl, true);
  assert.strictEqual(q.mods.cmdcntrl, false);
  assert.strictEqual(q.key, 'B');
});

test('matchesAccelerator：单修饰键精确匹配（多按不误触）', () => {
  const ev = (o) => ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: 'b', ...o });
  // Ctrl+B 命中
  assert.ok(S.matchesAccelerator('CommandOrControl+B', ev({ ctrlKey: true })));
  assert.ok(S.matchesAccelerator('Control+B', ev({ ctrlKey: true })));
  // Ctrl+Shift+B 不应命中（shift 未声明）
  assert.ok(!S.matchesAccelerator('CommandOrControl+B', ev({ ctrlKey: true, shiftKey: true })));
  // Ctrl+Alt+B 不应命中
  assert.ok(!S.matchesAccelerator('CommandOrControl+B', ev({ ctrlKey: true, altKey: true })));
  // Ctrl+B 不命中纯 Ctrl+B？—— key 大小写均可
  assert.ok(S.matchesAccelerator('Control+B', ev({ ctrlKey: true, key: 'B' })));
  // 大小写不敏感：'b' 与 'B' 均命中
  assert.ok(S.matchesAccelerator('Control+B', ev({ ctrlKey: true, key: 'B' })));
  // 无修饰键不命中
  assert.ok(!S.matchesAccelerator('CommandOrControl+B', ev({})));
});

test('matchesAccelerator：cmdorctrl 接受 Ctrl 或 Cmd', () => {
  assert.ok(S.matchesAccelerator('CommandOrControl+B', { ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: 'b' }));
  assert.ok(S.matchesAccelerator('CommandOrControl+B', { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 'b' }));
});

test('matchesAccelerator：显式含 shift 时接受 shift', () => {
  assert.ok(S.matchesAccelerator('CommandOrControl+Shift+M', { ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, key: 'M' }));
  assert.ok(!S.matchesAccelerator('CommandOrControl+Shift+M', { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 'M' }));
});

test('isShortcut：设置驱动 + 覆盖生效', () => {
  const settings = { shortcuts: { bold: 'Control+Shift+K' } };
  assert.ok(S.isShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, key: 'k' }, 'bold', settings));
  assert.ok(!S.isShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 'b' }, 'bold', settings));
});

test('acceleratorFromEvent：生成 Electron 加速键；无修饰键/未知键返回 null', () => {
  assert.strictEqual(S.acceleratorFromEvent({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 'm' }), 'CommandOrControl+M');
  assert.strictEqual(S.acceleratorFromEvent({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, key: 'n' }), 'CommandOrControl+Shift+N');
  assert.strictEqual(S.acceleratorFromEvent({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: 'a' }), null);
  assert.strictEqual(S.acceleratorFromEvent({ ctrlKey: true, altKey: false, shiftKey: false, key: 'ArrowUp' }), 'CommandOrControl+Up');
  // shift 单独出现
  assert.strictEqual(S.acceleratorFromEvent({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: true, key: 'a' }), 'Shift+A');
});

test('toDisplay：转成 Ctrl+Shift+M 形式', () => {
  assert.strictEqual(S.toDisplay('CommandOrControl+Shift+M'), 'Ctrl+Shift+M');
  assert.strictEqual(S.toDisplay('Control+B'), 'Ctrl+B');
  assert.strictEqual(S.toDisplay('Alt+Space'), 'Alt+Space');
});

test('isValidAccelerator：必须有修饰键 + 主键', () => {
  assert.ok(S.isValidAccelerator('CommandOrControl+B'));
  assert.ok(S.isValidAccelerator('Shift+A'));
  assert.ok(!S.isValidAccelerator('A'));       // 无修饰键
  assert.ok(!S.isValidAccelerator('CommandOrControl+')); // 无主键
});

test('默认全局快捷键不与常见系统 Windows 默认冲突', () => {
  // 系统级默认（不能抢）——只对 global 快捷键（globalShortcut 全局注册）要求避开；
  // 编辑器快捷键是应用内事件，不抢占系统按键，无需避开 Ctrl+C/V/X 等通用编辑键。
  const sys = ['CommandOrControl+Shift+Esc', 'Alt+Tab', 'Alt+F4', 'Alt+Space',
    'Super+D', 'Super+L', 'Super+E', 'Super+R', 'CommandOrControl+Esc',
    'CommandOrControl+Shift+Delete', 'CommandOrControl+Alt+Delete'];
  const globals = S.SHORTCUT_DEFS.filter((d) => d.scope === 'global').map((d) => S.getDefaultShortcut(d.id));
  assert.ok(globals.length >= 1, '应有全局快捷键');
  globals.forEach((a) => {
    assert.ok(!sys.includes(a), '默认全局快捷键与系统冲突: ' + a);
    assert.ok(a, '全局快捷键必须有默认值');
  });
  // 全局快捷键必须带修饰键（避免单键全局抢占）
  globals.forEach((a) => assert.ok(S.isValidAccelerator(a), '全局快捷键非法: ' + a));
});

test('默认编辑器快捷键互不重复且合法', () => {
  const editors = S.SHORTCUT_DEFS.filter((d) => d.scope === 'editor').map((d) => S.getDefaultShortcut(d.id));
  const vals = Object.values(S.DEFAULT_SHORTCUTS);
  assert.strictEqual(new Set(vals).size, vals.length, '所有默认快捷键互不重复');
  editors.forEach((a) => assert.ok(S.isValidAccelerator(a), '编辑器快捷键非法: ' + a));
});
