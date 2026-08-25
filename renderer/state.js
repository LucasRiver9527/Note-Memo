/* 状态单一来源：settings 默认值 + 取值入口 + 数据迁移。
   作为普通 <script> 在页面加载（挂到 window.StateLogic / 顶层全局），
   也可被 Node 测试 require（module.exports）。单一来源，便于测试。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.StateLogic = fns;
    // 挂到全局，等价于原来的顶层 const 声明，app.js 可直接按名字调用
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_THEME_ID = 'mint';
  const DEFAULT_NOTE_COLOR = '#93f1ce';

  // settings 默认值单一来源：新增持久化设置只改这里（A3）
  const DEFAULT_SETTINGS = {
    themeId: DEFAULT_THEME_ID,
    appearanceMode: 'auto',
    accent: '#00b894',
    noteOpacity: 100,
    winOpacity: 100,
    fontSize: 14,
    fontFamily: 'system',
    canvasColor: null,
    alwaysOnTop: false,
    backgroundImage: null,
    backgroundMode: 'cover',
    backgroundReadability: true,
    noteTextColor: null,
    viewMode: 'board',
    bgOpacity: 100,
    topBarColor: null,
    topBarOpacity: 100,
    topBarAcrylic: false,
    sortMode: 'updated',
    noteOrder: [],
    groupOrders: {},
    customThemes: [],
    recycleBinDays: 7,
    backupDir: null,
    language: 'zh',
    customFonts: [],
    todoSearchColor: null,
    todoSearchOpacity: 100,
    todoItemsColor: null,
    todoItemsOpacity: 100,
    todoRemindColor: null,
    todoRemindOpacity: 100,
    noteColor: DEFAULT_NOTE_COLOR,
    glass: false,
    desktopMica: false,
    markdown: true,
    highlightColor: null,
    reminderSound: false,
    reminderSoundPath: null,
    reminderSoundName: null,
    reminderVolume: 70
  };

  // 数据版本号：用于 migrateData 判断需要跑哪些迁移
  const CURRENT_VERSION = 2;

  // 取值入口：settings[key] 未定义时回退到默认值（解耦 200+ 处直接读 state.settings.xxx）
  function getSetting(settings, key, def) {
    const s = settings || {};
    if (s[key] === undefined || s[key] === null) {
      if (def !== undefined) return def;
      return DEFAULT_SETTINGS[key];
    }
    return s[key];
  }

  // 便签对象补齐默认字段 + 图片迁移（旧版便签图片未写入内容标记，补到末尾保持可见）
  function migrateNote(n, uid) {
    if (!n || typeof n !== 'object') return n;
    if (!n.id && uid) n.id = uid('n');
    if (!Array.isArray(n.items)) n.items = [];
    if (!Array.isArray(n.images)) n.images = [];
    if (!Array.isArray(n.files)) n.files = [];
    if (!Array.isArray(n.tables)) n.tables = [];
    const content = n.content || '';
    const missing = (n.images || []).filter((im) => im && content.indexOf('[[img:' + im.id + ']]') === -1);
    if (missing.length) n.content = content + (content ? '\n' : '') + missing.map((im) => '[[img:' + im.id + ']]').join('');
    return n;
  }

  // 迁移入口：data = { settings, groups, notes, trash }，就地升级并回填默认值，返回迁移后的对象
  function migrateData(data, uid) {
    const d = data || {};
    const settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
    settings.version = settings.version || CURRENT_VERSION;
    // 未来版本迁移示例：if (settings.version < 3) { ...; settings.version = 3; }
    settings.version = CURRENT_VERSION;

    const notes = (d.notes || []).map((n) => migrateNote(n, uid));
    const trash = (d.trash || []).map((t) => {
      if (t && t.note) {
        if (!t.note.id && uid) t.note.id = uid('n');
        migrateNote(t.note, uid);
      }
      return t;
    });

    return { settings, groups: d.groups || [], notes, trash };
  }

  return {
    DEFAULT_SETTINGS,
    DEFAULT_THEME_ID,
    DEFAULT_NOTE_COLOR,
    CURRENT_VERSION,
    getSetting,
    migrateNote,
    migrateData
  };
}));
