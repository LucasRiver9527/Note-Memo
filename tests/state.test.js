const { test } = require('node:test');
const assert = require('node:assert');
const { DEFAULT_SETTINGS, DEFAULT_THEME_ID, DEFAULT_NOTE_COLOR, getSetting, migrateNote, migrateData } = require('../renderer/state.js');

test('DEFAULT_SETTINGS 默认值完整且稳定', () => {
  assert.strictEqual(DEFAULT_SETTINGS.themeId, DEFAULT_THEME_ID);
  assert.strictEqual(DEFAULT_SETTINGS.noteColor, DEFAULT_NOTE_COLOR);
  assert.strictEqual(DEFAULT_SETTINGS.fontSize, 14);
  assert.strictEqual(DEFAULT_SETTINGS.viewMode, 'board');
  assert.strictEqual(DEFAULT_SETTINGS.language, 'zh');
  assert.strictEqual(DEFAULT_SETTINGS.markdown, true);
  // 便签外观自定义默认值（阶段 B：新自定义美化）
  assert.strictEqual(DEFAULT_SETTINGS.noteRadius, 12);
  assert.strictEqual(DEFAULT_SETTINGS.noteShadow, 0);
  assert.strictEqual(DEFAULT_SETTINGS.noteBorderWidth, 0);
  assert.strictEqual(DEFAULT_SETTINGS.noteBorderColor, null);
  assert.strictEqual(DEFAULT_SETTINGS.noteLetterSpacing, 0);
  // 右键菜单外观（阶段 C：亚克力 + 透明度）
  assert.strictEqual(DEFAULT_SETTINGS.menuAcrylic, true);
  assert.strictEqual(DEFAULT_SETTINGS.menuOpacity, 88);
  // 阶段 B：使用逻辑改良（画布缩放 / 最近使用分组 / 分组折叠）
  assert.strictEqual(DEFAULT_SETTINGS.boardZoom, 1);
  assert.deepStrictEqual(DEFAULT_SETTINGS.recentGroups, []);
  assert.deepStrictEqual(DEFAULT_SETTINGS.collapsedGroups, {});
  assert.deepStrictEqual(DEFAULT_SETTINGS.collapseSnapshot, {});
});

test('getSetting 取值入口：未定义回退默认值，显式覆盖优先', () => {
  assert.strictEqual(getSetting({}, 'fontSize'), 14);
  assert.strictEqual(getSetting({ fontSize: 18 }, 'fontSize'), 18);
  // 显式传入的 def 优先于默认值
  assert.strictEqual(getSetting({}, 'missingKey', 'fallback'), 'fallback');
  // null 也视为未设置
  assert.strictEqual(getSetting({ fontSize: null }, 'fontSize'), 14);
});

test('migrateNote 补齐默认数组且不破坏原字段', () => {
  const n = { id: 'a', content: '', images: [{ id: 'i1', src: 'x', w: 200 }] };
  migrateNote(n);
  assert.deepStrictEqual(n.items, []);
  assert.deepStrictEqual(n.files, []);
  assert.deepStrictEqual(n.tables, []);
  // 旧版便签图片未写入内容 -> 补到末尾
  assert.ok(n.content.includes('[[img:i1]]'));
});

test('migrateNote 已含标记的图片不重复追加', () => {
  const n = { id: 'a', content: '前文[[img:i1]]', images: [{ id: 'i1', src: 'x', w: 200 }] };
  migrateNote(n);
  assert.strictEqual(n.content, '前文[[img:i1]]');
});

test('migrateData 回填 settings 默认值 + 设置版本号', () => {
  const out = migrateData({ settings: { fontSize: 20 }, notes: [] });
  assert.strictEqual(out.settings.fontSize, 20);
  assert.strictEqual(out.settings.themeId, DEFAULT_THEME_ID);
  assert.strictEqual(out.settings.markdown, true);
  assert.ok(out.settings.version);
});

test('migrateData 处理回收站中无 id 的便签并补图片标记', () => {
  const out = migrateData({
    settings: {},
    notes: [],
    trash: [{ note: { content: '', images: [{ id: 'i9', src: 's', w: 100 }] }, deletedAt: 1 }]
  }, (p) => 'gen-' + p);
  const tn = out.trash[0].note;
  assert.ok(tn.id, '应为回收站便签生成 id');
  assert.ok(tn.content.includes('[[img:i9]]'));
});

test('migrateData 空数据返回结构完整', () => {
  const out = migrateData();
  assert.deepStrictEqual(out.groups, []);
  assert.deepStrictEqual(out.notes, []);
  assert.deepStrictEqual(out.trash, []);
  assert.ok(out.settings);
});
