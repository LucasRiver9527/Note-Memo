/* 状态单一来源：settings 默认值 + 取值入口 + 数据迁移。
   作为普通 <script> 在页面加载（挂到 window.StateLogic / 顶层全局），
   也可被 Node 测试 require（module.exports）。单一来源，便于测试。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root['StateLogic'] = fns;
    // 挂到全局，等价于原来的顶层 const 声明，app.js 可直接按名字调用
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_THEME_ID = 'mint';
  const DEFAULT_NOTE_COLOR = '#93f1ce';

  // settings 默认值单一来源：新增持久化设置只改这里（A3）
  /** @type {AppSettings} */
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
    // 便签右键菜单显示模式：'compact' 精简（只列高频，低频收进二级）| 'full' 完整（全部平铺）
    // 由菜单顶部的开关切换，即时生效并持久化
    ctxMenuMode: 'compact',
    // 便签卡片工具栏：compact 时次要按钮收进「⋯ 更多」（打开便签操作菜单）；hidden 列出被隐藏的按钮 id
    noteToolbarCompact: true,
    noteToolbarHidden: [],
    shortcuts: {},
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
    noteRadius: 12,
    noteShadow: 0,
    noteBorderWidth: 0,
    noteBorderColor: null,
    noteLetterSpacing: 0,
    menuAcrylic: true,
    menuOpacity: 88,
    boardZoom: 1,
    recentGroups: [],
    collapsedGroups: {},
    collapseSnapshot: {},
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

  // 取值入口：settings[key] 未定义时回退到默认值。
  // 【预留 API，当前生产代码无调用点】migrateData 已用 DEFAULT_SETTINGS 回填全部默认值，
  // 故 200+ 处直接读 state.settings.xxx 是安全且有意的；此函数作为「显式兜底读」保留，
  // 供后续需要读可能缺失的键、或做设置项校验时使用。单测见 tests/state.test.js。
  function getSetting(settings, key, def) {
    const s = settings || {};
    if (s[key] === undefined || s[key] === null) {
      if (def !== undefined) return def;
      return DEFAULT_SETTINGS[key];
    }
    return s[key];
  }

  // 便签对象补齐默认字段 + 图片迁移（旧版便签图片未写入内容标记，补到末尾保持可见）
  /** @param {Note} n @param {(prefix?: string) => string} [uid] @returns {Note} */
  function migrateNote(n, uid) {
    if (!n || typeof n !== 'object') return n;
    if (!n.id && uid) n.id = uid('n');
    if (!Array.isArray(n.items)) n.items = [];
    if (!Array.isArray(n.images)) n.images = [];
    if (!Array.isArray(n.files)) n.files = [];
    if (!Array.isArray(n.tables)) n.tables = [];
    if (typeof n.archived !== 'boolean') n.archived = false;
    if (typeof n.preview !== 'boolean') n.preview = false;
    if (typeof n.opacity !== 'number') n.opacity = 100;
    const content = n.content || '';
    const missing = (n.images || []).filter((im) => im && content.indexOf('[[img:' + im.id + ']]') === -1);
    if (missing.length) n.content = content + (content ? '\n' : '') + missing.map((im) => '[[img:' + im.id + ']]').join('');
    return n;
  }

  // 迁移入口：data = { settings, groups, notes, trash }，就地升级并回填默认值，返回迁移后的对象
  /** @param {Partial<AppData>} data @param {(prefix?: string) => string} [uid] @returns {AppData} */
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
