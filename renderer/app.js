/* ============ 便签 - 渲染进程逻辑 ============ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const NOTE_COLORS = ['#000000', '#1e1e28', '#2d2f38', '#24344d', '#3a2a4d', '#1f3d33', '#4d2a2a', '#f7d65a', '#ffb3c1', '#a8e6cf', '#a0d8ff', '#d0b3ff', '#ffd8a8', '#f5a97f', '#e6c9ff'];
const ACCENTS = ['#6c5ce7', '#e84393', '#00b894', '#0984e3', '#e17055', '#fdcb6e', '#00cec9', '#d63031', '#2ecc71', '#5b8cff'];

const PRESETS = [
  { id: 'dark', name: '深夜', en: 'Midnight', light: false, bg: '#1e1f26', accent: '#6c5ce7', mini: ['#6c5ce7', '#f7d65a'] },
  { id: 'light', name: '纯净', en: 'Clean', light: true, bg: '#f4f5fa', accent: '#6c5ce7', mini: ['#6c5ce7', '#ffd8a8'] },
  { id: 'midnight', name: '午夜蓝', en: 'Navy', light: false, bg: '#131726', accent: '#5b8cff', mini: ['#5b8cff', '#00cec9'] },
  { id: 'forest', name: '森林', en: 'Forest', light: false, bg: '#152019', accent: '#2ecc71', mini: ['#2ecc71', '#a8e6cf'] },
  { id: 'sunset', name: '暮色', en: 'Sunset', light: false, bg: '#241820', accent: '#e84393', mini: ['#e84393', '#ffb3c1'] },
  { id: 'paper', name: '羊皮纸', en: 'Paper', light: true, bg: '#f3ecd9', accent: '#b8860b', mini: ['#b8860b', '#f7d65a'] },
  { id: 'ocean', name: '海洋', en: 'Ocean', light: false, bg: '#0e1f2f', accent: '#00bcd4', mini: ['#00bcd4', '#a0d8ff'] },
  { id: 'sakura', name: '樱花', en: 'Sakura', light: true, bg: '#fff0f3', accent: '#ff6b9d', mini: ['#ff6b9d', '#ffd8e6'] },
  { id: 'graphite', name: '石墨', en: 'Graphite', light: false, bg: '#202124', accent: '#9aa0a6', mini: ['#9aa0a6', '#5f6368'] },
  { id: 'mint', name: '薄荷', en: 'Mint', light: true, bg: '#eafaf1', accent: '#00b894', mini: ['#00b894', '#a8e6cf'] },
  { id: 'coffee', name: '咖啡', en: 'Coffee', light: false, bg: '#2b1d14', accent: '#c47f5a', mini: ['#c47f5a', '#8a5a3a'] },
  { id: 'aurora', name: '极光', en: 'Aurora', light: false, bg: '#101d2b', accent: '#48c6ef', mini: ['#48c6ef', '#7b68ee'] }
];

const FONTS = {
  system: '-apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
  "'Segoe UI', sans-serif": "'Segoe UI', sans-serif",
  "'Microsoft YaHei', sans-serif": "'Microsoft YaHei', sans-serif",
  "'KaiTi', 'STKaiti', serif": "'KaiTi', 'STKaiti', serif",
  "'FangSong', 'STFangsong', serif": "'FangSong', 'STFangsong', serif",
  "'Consolas', monospace": "'Consolas', monospace"
};

const FONT_OPTIONS = [
  { v: 'system', label: '系统默认' },
  { v: "'Segoe UI', sans-serif", label: 'Segoe UI' },
  { v: "'Microsoft YaHei', sans-serif", label: '微软雅黑' },
  { v: "'KaiTi', 'STKaiti', serif", label: '楷体' },
  { v: "'FangSong', 'STFangsong', serif", label: '仿宋' },
  { v: "'Consolas', monospace", label: '等宽 Consolas' }
];

const TEXT_COLORS = ['#2d2f38', '#000000', '#444444', '#ffffff', '#c0392b', '#b8860b', '#1e5a8a', '#1e7d5a', '#5b2d8f', '#7f8c8d'];

const DEFAULT_SETTINGS = {
  themeId: 'dark',
  appearanceMode: 'auto',
  accent: '#6c5ce7',
  noteOpacity: 100,
  winOpacity: 100,
  fontSize: 14,
  fontFamily: 'system',
  canvasColor: null,
  alwaysOnTop: false,
  backgroundImage: null,
  backgroundMode: 'cover',
  noteTextColor: null,
  viewMode: 'board',
  bgOpacity: 100,
  topBarColor: null,
  topBarOpacity: 100,
  sortMode: 'updated',
  noteOrder: [],
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
  todoRemindOpacity: 100
};

/* ============ 国际化 ============ */
const I18N = {
  zh: {
    app_name: '便签',
    settings_title: '⚙ 全局设置',
    tab_appearance: '🎨 外观', tab_font: '🔤 字体', tab_sort: '↕ 排序', tab_backup: '⬇ 备份', tab_trash: '🗑 回收站', tab_data: '📦 数据',
    mode: '模式', mode_auto: '跟随主题', mode_light: '普通（浅色）', mode_dark: '夜间（深色）',
    theme: '主题', accent: '强调色', custom: '自定义',
    note_appearance: '便签外观', note_opacity: '便签不透明度', win_opacity: '窗口不透明度',
    canvas_bg: '画布背景', bg_color: '背景色', bg_image: '背景图片', bg_fill: '填充', bg_fit: '适应', bg_stretch: '拉伸', bg_tile: '平铺', bg_center: '居中',
    pick_image: '选择图片…', clear_image: '清除图片',
    topbar_bg: '顶栏与背景', topbar_color: '顶栏底色', topbar_opacity: '顶栏透明度', bg_opacity: '背景图片透明度',
    todo_area: '待办区', todo_area_hint: '待办区各区域底色默认跟随主题，可自定义颜色与透明度。',
    search_bg: '搜索框底色', search_opacity: '搜索框透明度', items_bg: '待办事项底色', items_opacity: '待办事项透明度', remind_bg: '时间待办底色', remind_opacity: '时间待办透明度',
    reset_todo: '恢复待办区默认（跟随主题）', reset_theme: '恢复默认外观',
    font_family: '字体', font_size: '字体大小', font_color: '字体颜色', font_color_hint: '字体颜色应用到便签内容与界面文字；选择默认则跟随主题。', font_color_follow: '跟随主题',
    custom_fonts: '自定义字体', custom_fonts_hint: '可导入你下载的字体文件（.ttf/.otf/.woff），内置字体不可删除。', add_font: '添加字体',
    sort_mode: '排序方式', sort_custom: '自定义顺序', sort_updated: '按更新时间', sort_created: '按创建时间', sort_title: '按标题', sort_color: '按颜色',
    sort_hint: '排序在「备忘录」和「待办」视图中生效；选择「自定义顺序」后可拖动下方便签调整顺序。', custom_order: '自定义顺序',
    backup_folder: '备份文件夹', backup_hint: '设置一个专门的备份文件夹，「一键导出」会把备份文件保存到该文件夹内。', backup_dir_placeholder: '默认：应用数据目录/backups',
    choose: '选择…', backup_now: '⬇ 一键导出', open_folder: '打开文件夹', more: '更多', export_as: '导出到指定位置…', import: '导入备份…',
    recycle_bin: '回收站', keep_days: '保留天数', forever: '永久保留', trash_hint: '删除的便签会先进入回收站，超过保留天数后自动彻底删除。', empty_trash: '🗑 清空回收站',
    language: '语言', organize: '整理与清空', arrange: '▦ 整理排列便签', clear_all: '🗑 清空全部便签', clear_all_hint: '清空全部便签会将其移入回收站，可在回收站中恢复。',
    new_note: '＋ 新建', new_note_tip: '新建便签 (Ctrl+Shift+N)', quick_arrange: '⚡ 一键整理', global_settings: '全局设置',
    always_on_top: '窗口置顶', minimize: '最小化', maximize: '最大化', restore: '还原', close: '关闭到托盘',
    search: '搜索便签…', clear: '清除', all: '全部', ungrouped: '未分组', add_group: '＋ 分组', new_group: '新建分组',
    board_view: '便签视图', memo_view: '备忘录视图', todo_view: '待办区',
    no_notes: '还没有便签', no_notes_sub: '双击空白处或点击右上角「＋ 新建」创建',
    note_title: '标题', note_content: '写点什么…', todo_ph: '待办…', add_todo: '＋ 添加待办',
    pin: '置顶', todo_mode: '待办模式', add_to_group: '加入分组', remove_from_group: '退出分组', desktop: '钉在桌面', todo_remind: '待办提醒', color: '颜色', delete: '删除', insert_image: '插入图片',
    delete_image: '删除图片', resize_image: '拖动调整大小', set_group: '点击设置分组', drag_sort: '拖动排序',
    set_todo_time: '设置待办时间', cancel: '取消', ok: '确定',
    todo_items: '待办事项', time_todos: '时间待办', add_todo_ph: '添加待办，回车确认…', add: '添加', untitled: '未命名便签', open_note: '打开便签', delete_todo: '删除待办', clear_time: '清除时间待办', overdue: '已逾期',
    no_todos: '暂无待办事项，点击右上「＋ 新建」或在上方输入添加', no_reminders: '暂无时间待办，在便签上点击 ⏰ 设置',
    delete_group: '删除分组', rename_group: '重命名分组', group_name: '分组名称', change_color: '修改颜色',
    custom_bg: '自定义底色', text_color: '文字颜色', font: '字体', default_color: '默认颜色', follow_global: '跟随全局',
    new_theme: '＋ 新建主题', edit_theme: '编辑主题', create_theme: '新建主题', theme_name: '主题名称', base_mode: '基础模式', my_theme: '我的主题',
    canvas_bg_color: '画布背景色', note_color_1: '便签色 1', note_color_2: '便签色 2', save: '保存',
    toast_pinned: '已钉在桌面', toast_unpin: '已退出分组', toast_group_created: '分组已创建', toast_group_deleted: '分组已删除',
    toast_removed: '已移入回收站', toast_restored: '已恢复便签', toast_trash_empty: '回收站已清空',
    toast_theme_deleted: '主题已删除', toast_theme_updated: '主题已更新', toast_theme_created: '主题已创建',
    toast_bg_set: '背景图片已设置', toast_bg_cleared: '已清除背景图片', toast_reset: '已恢复默认外观',
    toast_todo_set: '待办已设置', toast_todo_added: '已添加待办', toast_todo_created: '已新建待办，可设置待办时间',
    toast_reminder: '待办提醒：', toast_arranged: '已一键整理', toast_arranged_menu: '已整理排列', toast_moved_trash: '已移入回收站',
    toast_todo_reset: '待办区已恢复跟随主题', toast_img_pasted: '图片已粘贴', toast_img_saved_fail: '图片保存失败：',
    toast_exported: '已导出：', toast_export_fail: '导出失败：', toast_backup_ok: '已备份：', toast_backup_fail: '备份失败：',
    toast_imported: '导入成功', toast_import_fail: '导入失败：', toast_font_added: '字体已添加', toast_font_deleted: '字体已删除',
    confirm_import_title: '导入备份', confirm_import_msg: '导入将覆盖当前全部便签与设置，确定继续？',
    confirm_clear_all_title: '清空全部', confirm_clear_all_msg: '确定将所有便签移入回收站？可在回收站中恢复。',
    confirm_empty_trash_title: '清空回收站', confirm_empty_trash_msg: '确定彻底删除回收站中的所有便签？此操作不可撤销。',
    confirm_delete_group_msg: '分组内的便签将变为未分组。',
    drag_to_sort: '选择「自定义顺序」后可拖动排序',
    built_in: '内置',
    today: '今天', open_link: '打开链接', up: '上移', down: '下移', restore_note: '恢复', delete_forever: '彻底删除', deleted_at: '删除于 ', empty_item: '（空）',
    left_click_filter: '左键筛选 · 右键编辑分组', delete_link: '打开链接', trash_empty: '回收站是空的', toast_set_fail: '设置失败：',
    copy: '复制', cut: '剪切', paste: '粘贴', select_all: '全选', toast_saved: '已保存',
    about: '关于', changelog_title: '更新说明', changelog_open: '✨ 查看更新说明', got_it: '知道了'
  },
  en: {
    app_name: 'Notes',
    settings_title: '⚙ Global Settings',
    tab_appearance: '🎨 Appearance', tab_font: '🔤 Font', tab_sort: '↕ Sort', tab_backup: '⬇ Backup', tab_trash: '🗑 Recycle Bin', tab_data: '📦 Data',
    mode: 'Mode', mode_auto: 'Follow theme', mode_light: 'Light', mode_dark: 'Dark',
    theme: 'Theme', accent: 'Accent', custom: 'Custom',
    note_appearance: 'Note appearance', note_opacity: 'Note opacity', win_opacity: 'Window opacity',
    canvas_bg: 'Canvas background', bg_color: 'Background color', bg_image: 'Background image', bg_fill: 'Fill', bg_fit: 'Fit', bg_stretch: 'Stretch', bg_tile: 'Tile', bg_center: 'Center',
    pick_image: 'Choose image…', clear_image: 'Clear image',
    topbar_bg: 'Title bar & background', topbar_color: 'Title bar color', topbar_opacity: 'Title bar opacity', bg_opacity: 'Background image opacity',
    todo_area: 'Todo area', todo_area_hint: 'Todo area backgrounds follow the theme by default; you can customize color and opacity.',
    search_bg: 'Search box bg', search_opacity: 'Search box opacity', items_bg: 'Todo items bg', items_opacity: 'Todo items opacity', remind_bg: 'Reminders bg', remind_opacity: 'Reminders opacity',
    reset_todo: 'Reset todo area (follow theme)', reset_theme: 'Reset appearance',
    font_family: 'Font', font_size: 'Font size', font_color: 'Font color', font_color_hint: 'Font color applies to note content and UI text; default follows the theme.', font_color_follow: 'Follow theme',
    custom_fonts: 'Custom fonts', custom_fonts_hint: 'Import your own font files (.ttf/.otf/.woff). Built-in fonts cannot be deleted.', add_font: 'Add font',
    sort_mode: 'Sort order', sort_custom: 'Custom order', sort_updated: 'By update time', sort_created: 'By create time', sort_title: 'By title', sort_color: 'By color',
    sort_hint: 'Sorting applies in List and Todo views; choose "Custom order" to drag notes below.', custom_order: 'Custom order',
    backup_folder: 'Backup folder', backup_hint: 'Set a dedicated backup folder; "Export now" saves backup files into it.', backup_dir_placeholder: 'Default: app data dir/backups',
    choose: 'Choose…', backup_now: '⬇ Export now', open_folder: 'Open folder', more: 'More', export_as: 'Export to…', import: 'Import…',
    recycle_bin: 'Recycle Bin', keep_days: 'Retention days', forever: 'Forever', trash_hint: 'Deleted notes go to the recycle bin first, and are permanently removed after the retention period.', empty_trash: '🗑 Empty recycle bin',
    language: 'Language', organize: 'Organize & clear', arrange: '▦ Arrange notes', clear_all: '🗑 Clear all notes', clear_all_hint: 'Clearing all notes moves them to the recycle bin, where they can be restored.',
    new_note: '＋ New', new_note_tip: 'New note (Ctrl+Shift+N)', quick_arrange: '⚡ Arrange', global_settings: 'Global Settings',
    always_on_top: 'Always on top', minimize: 'Minimize', maximize: 'Maximize', restore: 'Restore', close: 'Close to tray',
    search: 'Search notes…', clear: 'Clear', all: 'All', ungrouped: 'Ungrouped', add_group: '＋ Group', new_group: 'New group',
    board_view: 'Board view', memo_view: 'List view', todo_view: 'Todo view',
    no_notes: 'No notes yet', no_notes_sub: 'Double-click a blank area or click ＋ New',
    note_title: 'Title', note_content: 'Write something…', todo_ph: 'Todo…', add_todo: '＋ Add todo',
    pin: 'Pin', todo_mode: 'Todo mode', add_to_group: 'Add to group', remove_from_group: 'Remove from group', desktop: 'Pin to desktop', todo_remind: 'Reminder', color: 'Color', delete: 'Delete', insert_image: 'Insert image',
    delete_image: 'Delete image', resize_image: 'Drag to resize', set_group: 'Click to set group', drag_sort: 'Drag to sort',
    set_todo_time: 'Set todo time', cancel: 'Cancel', ok: 'OK',
    todo_items: 'Todo items', time_todos: 'Time todos', add_todo_ph: 'Add a todo, press Enter…', add: 'Add', untitled: 'Untitled note', open_note: 'Open note', delete_todo: 'Delete todo', clear_time: 'Clear time', overdue: 'Overdue',
    no_todos: 'No todos yet. Click ＋ New or type above to add.', no_reminders: 'No time todos yet. Click ⏰ on a note to set one.',
    delete_group: 'Delete group', rename_group: 'Rename group', group_name: 'Group name', change_color: 'Change color',
    custom_bg: 'Custom color', text_color: 'Text color', font: 'Font', default_color: 'Default color', follow_global: 'Follow global',
    new_theme: '＋ New theme', edit_theme: 'Edit theme', create_theme: 'New theme', theme_name: 'Theme name', base_mode: 'Base mode', my_theme: 'My theme',
    canvas_bg_color: 'Canvas background', note_color_1: 'Note color 1', note_color_2: 'Note color 2', save: 'Save',
    toast_pinned: 'Pinned to desktop', toast_unpin: 'Removed from group', toast_group_created: 'Group created', toast_group_deleted: 'Group deleted',
    toast_removed: 'Moved to recycle bin', toast_restored: 'Note restored', toast_trash_empty: 'Recycle bin emptied',
    toast_theme_deleted: 'Theme deleted', toast_theme_updated: 'Theme updated', toast_theme_created: 'Theme created',
    toast_bg_set: 'Background image set', toast_bg_cleared: 'Background image cleared', toast_reset: 'Appearance reset',
    toast_todo_set: 'Todo set', toast_todo_added: 'Todo added', toast_todo_created: 'Todo created, set a time',
    toast_reminder: 'Reminder: ', toast_arranged: 'Arranged', toast_arranged_menu: 'Arranged', toast_moved_trash: 'Moved to recycle bin',
    toast_todo_reset: 'Todo area follows theme again', toast_img_pasted: 'Image pasted', toast_img_saved_fail: 'Failed to save image: ',
    toast_exported: 'Exported: ', toast_export_fail: 'Export failed: ', toast_backup_ok: 'Backed up: ', toast_backup_fail: 'Backup failed: ',
    toast_imported: 'Imported', toast_import_fail: 'Import failed: ', toast_font_added: 'Font added', toast_font_deleted: 'Font deleted',
    confirm_import_title: 'Import backup', confirm_import_msg: 'Importing will overwrite all current notes and settings. Continue?',
    confirm_clear_all_title: 'Clear all', confirm_clear_all_msg: 'Move all notes to the recycle bin? They can be restored there.',
    confirm_empty_trash_title: 'Empty recycle bin', confirm_empty_trash_msg: 'Permanently delete all notes in the recycle bin? This cannot be undone.',
    confirm_delete_group_msg: 'Notes in this group will become ungrouped.',
    drag_to_sort: 'Choose "Custom order" to drag and sort',
    built_in: 'Built-in',
    today: 'Today', open_link: 'Open link', up: 'Move up', down: 'Move down', restore_note: 'Restore', delete_forever: 'Delete forever', deleted_at: 'Deleted ', empty_item: '(empty)',
    left_click_filter: 'Left-click filter · Right-click edit', delete_link: 'Open link', trash_empty: 'Recycle bin is empty', toast_set_fail: 'Setting failed: ',
    copy: 'Copy', cut: 'Cut', paste: 'Paste', select_all: 'Select all', toast_saved: 'Saved',
    about: 'About', changelog_title: "What's New", changelog_open: '✨ View changelog', got_it: 'Got it'
  }
};

function t(key) {
  const lang = (state && state.settings && state.settings.language) || 'zh';
  return (I18N[lang] && I18N[lang][key]) || I18N.zh[key] || key;
}

const CHANGELOG = [
  { zh: '全新设置中心：外观、字体、排序、备份、回收站、数据，一个面板全搞定', en: 'New settings center: appearance, font, sort, backup, recycle bin and data in one panel' },
  { zh: '支持简体中文 / English 双语界面', en: 'Bilingual UI: Simplified Chinese / English' },
  { zh: '便签可插入图片：粘贴、选图、拖拽调整大小', en: 'Insert images into notes: paste, pick, or drag to resize' },
  { zh: '可导入自定义字体文件（.ttf / .otf / .woff）', en: 'Import custom font files (.ttf / .otf / .woff)' },
  { zh: '新增「待办区」视图，集中管理待办与时间提醒', en: 'New Todo view to manage todos and reminders in one place' },
  { zh: '一键导出备份，可自选备份文件夹', en: 'One-click backup export with a custom folder' },
  { zh: '回收站：误删可恢复，到期自动清理', en: 'Recycle bin: restore deleted notes, auto cleanup' },
  { zh: '一键整理便签，多种排序方式', en: 'One-click arrange and multiple sort options' }
];

const APP_VERSION = '1.1.0';

function renderChangelog() {
  const lang = (state && state.settings && state.settings.language) || 'zh';
  const list = $('#changelogList');
  list.innerHTML = CHANGELOG.map((c) => `<li>${c[lang] || c.zh}</li>`).join('');
}

function openChangelog() {
  renderChangelog();
  $('#changelogOverlay').classList.remove('hidden');
}

function closeChangelog() {
  $('#changelogOverlay').classList.add('hidden');
}

let state = {
  settings: { ...DEFAULT_SETTINGS },
  groups: [],
  notes: [],
  trash: []
};

let filter = { group: 'all', query: '' };
let zCounter = 10;
let saveTimer = null;
let activeColorPop = null;
let activeGroupPop = null;
let dragSortId = null;
let dragMemoId = null;

/* ============ 工具函数 ============ */
function uid() { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isDarkColor(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length < 6) return true;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55;
}

function autoTextColor(bg) {
  return isDarkColor(bg) ? '#ffffff' : '#2d2f38';
}

function getTheme() {
  const id = state.settings.themeId;
  return PRESETS.find((p) => p.id === id)
    || (state.settings.customThemes || []).find((t) => t.id === id)
    || PRESETS[0];
}

function isLightTheme() {
  const mode = state.settings.appearanceMode || 'auto';
  if (mode === 'light') return true;
  if (mode === 'dark') return false;
  return getTheme().light;
}

function themeName(p) {
  return (state.settings.language === 'en' && p.en) ? p.en : p.name;
}

function resolveFontCss(key) {
  if (!key || key === 'system') return FONTS.system;
  if (FONTS[key]) return FONTS[key];
  const cf = (state.settings.customFonts || []).find((f) => f.family === key);
  if (cf) return "'" + cf.family + "', sans-serif";
  return FONTS.system;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function linkifyText(text) {
  const urlRegex = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
  const parts = [];
  let last = 0;
  let m;
  while ((m = urlRegex.exec(text)) !== null) {
    parts.push(escapeHtml(text.slice(last, m.index)));
    const url = m[0];
    const href = /^www\./i.test(url) ? 'http://' + url : url;
    parts.push(`<a class="note-link" contenteditable="false" data-url="${escapeHtml(href)}" title="${t('open_link')}">${escapeHtml(url)}</a>`);
    last = m.index + url.length;
  }
  parts.push(escapeHtml(text.slice(last)));
  return parts.join('');
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `${t('today')} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2200);
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    window.api.saveData({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash });
  }, 300);
}

function saveNow() {
  clearTimeout(saveTimer);
  window.api.saveData({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash });
}

/* ============ 主题 ============ */
function applyTheme() {
  const s = state.settings;
  const preset = getTheme();
  const mode = s.appearanceMode || 'auto';
  let light = preset.light;
  if (mode === 'light') light = true;
  if (mode === 'dark') light = false;

  let bg = s.canvasColor || preset.bg;
  if (!s.canvasColor) {
    if (mode === 'light') bg = '#f4f5fa';
    else if (mode === 'dark') bg = '#1e1f26';
  }
  const accent = s.accent || preset.accent;
  const root = document.documentElement;

  root.style.setProperty('--bg', bg);
  root.style.setProperty('--bg-soft', light ? 'rgba(0,0,0,0.045)' : 'rgba(255,255,255,0.06)');
  root.style.setProperty('--border', light ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.09)');
  let fg = light ? '#2d2f38' : '#ececf1';
  let fgDim = light ? '#7a7c86' : '#9a9ba6';
  if (s.noteTextColor) {
    fg = s.noteTextColor;
    fgDim = hexToRgba(s.noteTextColor, light ? 0.55 : 0.6);
  }
  root.style.setProperty('--fg', fg);
  root.style.setProperty('--fg-dim', fgDim);
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-soft', hexToRgba(accent, light ? 0.14 : 0.2));
  root.style.setProperty('--note-opacity', (s.noteOpacity / 100).toFixed(2));
  root.style.setProperty('--font-size', s.fontSize + 'px');
  root.style.setProperty('--font-family', resolveFontCss(s.fontFamily));
  root.style.setProperty('--titlebar-bg', light ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.18)');
  root.style.setProperty('--shadow', light ? '0 2px 16px rgba(0,0,0,0.08)' : '0 10px 40px rgba(0,0,0,0.45)');

  window.api.setOpacity(s.winOpacity / 100);
  window.api.setAlwaysOnTop(!!s.alwaysOnTop);

  const pinBtn = $('#btnPin');
  if (pinBtn) pinBtn.classList.toggle('active', !!s.alwaysOnTop);

  document.body.classList.toggle('light-mode', light);
  applyTodoStyle();
  applyBackground();
}

function todoAreaBg(color, opacity) {
  const base = (color == null || color === '') ? (isLightTheme() ? '#e6e9f2' : '#2c2e3a') : color;
  return hexToRgba(base, (opacity != null ? opacity : 100) / 100);
}

function applyTodoStyle() {
  const s = state.settings;
  const root = document.documentElement;
  root.style.setProperty('--todo-search-bg', todoAreaBg(s.todoSearchColor, s.todoSearchOpacity));
  root.style.setProperty('--todo-items-bg', todoAreaBg(s.todoItemsColor, s.todoItemsOpacity));
  root.style.setProperty('--todo-remind-bg', todoAreaBg(s.todoRemindColor, s.todoRemindOpacity));
}

function applyBackground() {
  const s = state.settings;
  const bgLayer = $('#bgLayer');
  if (!bgLayer) return;

  bgLayer.style.opacity = ((s.bgOpacity != null ? s.bgOpacity : 100) / 100).toFixed(2);

  if (s.backgroundImage) {
    const mode = s.backgroundMode || 'cover';
    let size = 'cover';
    let repeat = 'no-repeat';
    let position = 'center center';
    if (mode === 'contain') { size = 'contain'; }
    else if (mode === 'stretch') { size = '100% 100%'; }
    else if (mode === 'repeat') { size = 'auto'; repeat = 'repeat'; position = 'top left'; }
    else if (mode === 'center') { size = 'auto'; }
    bgLayer.style.backgroundImage = `url("${s.backgroundImage}")`;
    bgLayer.style.backgroundSize = size;
    bgLayer.style.backgroundRepeat = repeat;
    bgLayer.style.backgroundPosition = position;
  } else {
    bgLayer.style.backgroundImage = 'none';
    bgLayer.style.backgroundSize = '';
    bgLayer.style.backgroundRepeat = '';
    bgLayer.style.backgroundPosition = '';
  }

  const borderBase = s.topBarColor || (isLightTheme() ? '#ffffff' : '#000000');
  const borderAlpha = (s.topBarOpacity != null ? s.topBarOpacity : 100) / 100;
  const bc = hexToRgba(borderBase, borderAlpha);
  const tb = $('#titlebar');
  if (tb) tb.style.backgroundColor = bc;
  const fb = $('#filterbar');
  if (fb) fb.style.backgroundColor = bc;
}

function renderThemePanel() {
  const grid = $('#themeGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const themes = [...PRESETS, ...(state.settings.customThemes || [])];
  themes.forEach((p) => {
    const isCustom = !PRESETS.some((x) => x.id === p.id);
    const card = document.createElement('div');
    card.className = 'theme-card' + (state.settings.themeId === p.id ? ' active' : '') + (isCustom ? ' custom' : '');
    card.innerHTML = `
      <div class="preview" style="background:${p.bg}">
        <div class="mini-note" style="background:${p.mini[0]}"></div>
        <div class="mini-note" style="background:${p.mini[1]}"></div>
      </div>
      <span class="tname">${escapeHtml(themeName(p))}</span>
      ${isCustom ? `<button class="t-del" title="${t('delete')}">✕</button>` : ''}`;
    card.onclick = () => {
      state.settings.themeId = p.id;
      state.settings.canvasColor = null;
      state.settings.accent = p.accent;
      syncSettingsInputs();
      applyTheme();
      renderThemePanel();
      save();
    };
    if (isCustom) {
      $('.t-del', card).onclick = (e) => {
        e.stopPropagation();
        deleteCustomTheme(p.id);
      };
    }
    grid.appendChild(card);
  });

  const addCard = document.createElement('div');
  addCard.className = 'theme-card add-card';
  addCard.innerHTML = `<span class="tname">${t('new_theme')}</span>`;
  addCard.onclick = () => openThemeEditor();
  grid.appendChild(addCard);

  const sw = $('#accentSwatches');
  if (sw) {
    sw.innerHTML = '';
    ACCENTS.forEach((c) => {
      const s = document.createElement('button');
      s.className = 'swatch' + (state.settings.accent === c ? ' active' : '');
      s.style.background = c;
      s.onclick = () => {
        state.settings.accent = c;
        applyTheme();
        renderThemePanel();
        save();
      };
      sw.appendChild(s);
    });
  }

  $('#customAccent').value = state.settings.accent;
}

function deleteCustomTheme(id) {
  state.settings.customThemes = (state.settings.customThemes || []).filter((t) => t.id !== id);
  if (state.settings.themeId === id) {
    state.settings.themeId = PRESETS[0].id;
    state.settings.accent = PRESETS[0].accent;
    state.settings.canvasColor = null;
    applyTheme();
  }
  renderThemePanel();
  save();
  toast(t('toast_theme_deleted'));
}

function openThemeEditor(existing) {
  const isEdit = !!existing;
  const theme = existing || { id: 'ct' + uid(), name: '', light: false, bg: '#1e1f26', accent: '#6c5ce7', mini: ['#6c5ce7', '#f7d65a'] };

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:6500;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;border-radius:14px;';
  const modal = document.createElement('div');
  modal.className = 'theme-editor-modal';
  modal.innerHTML = `
    <header style="padding:14px 16px;font-weight:700;border-bottom:1px solid var(--border)">${isEdit ? t('edit_theme') : t('create_theme')}</header>
    <div class="te-row">
      <label><span>${t('theme_name')}</span></label>
      <input type="text" id="teName" value="${escapeHtml(theme.name)}" placeholder="${t('my_theme')}" />
    </div>
    <div class="te-row">
      <label><span>${t('base_mode')}</span></label>
      <div class="seg-row">
        <button class="seg ${!theme.light ? 'active' : ''}" data-te-light="0">${t('mode_dark')}</button>
        <button class="seg ${theme.light ? 'active' : ''}" data-te-light="1">${t('mode_light')}</button>
      </div>
    </div>
    <div class="te-row">
      <label><span>${t('canvas_bg_color')}</span><input type="color" id="teBg" value="${theme.bg}" /></label>
      <label><span>${t('accent')}</span><input type="color" id="teAccent" value="${theme.accent}" /></label>
      <label><span>${t('note_color_1')}</span><input type="color" id="teMini1" value="${theme.mini[0]}" /></label>
      <label><span>${t('note_color_2')}</span><input type="color" id="teMini2" value="${theme.mini[1]}" /></label>
    </div>
    <footer style="padding:12px 16px;display:flex;gap:10px;justify-content:flex-end">
      <button id="teCancel" class="sp-btn ghost" style="width:auto;padding:8px 18px">${t('cancel')}</button>
      <button id="teOk" class="sp-btn primary" style="width:auto;padding:8px 18px">${t('save')}</button>
    </footer>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let light = theme.light;
  $$('[data-te-light]', modal).forEach((b) => {
    b.onclick = () => {
      light = b.dataset.teLight === '1';
      $$('[data-te-light]', modal).forEach((x) => x.classList.toggle('active', x === b));
    };
  });

  const done = (doSave) => {
    overlay.remove();
    if (!doSave) return;
    const name = $('#teName', modal).value.trim() || t('my_theme');
    const t = {
      id: theme.id,
      name,
      light,
      bg: $('#teBg', modal).value,
      accent: $('#teAccent', modal).value,
      mini: [$('#teMini1', modal).value, $('#teMini2', modal).value]
    };
    const arr = state.settings.customThemes || [];
    const idx = arr.findIndex((x) => x.id === t.id);
    if (idx >= 0) arr[idx] = t; else arr.push(t);
    state.settings.customThemes = arr;
    state.settings.themeId = t.id;
    state.settings.accent = t.accent;
    state.settings.canvasColor = null;
    applyTheme();
    renderThemePanel();
    save();
    toast(isEdit ? t('toast_theme_updated') : t('toast_theme_created'));
  };
  $('#teOk', modal).onclick = () => done(true);
  $('#teCancel', modal).onclick = () => done(false);
}

function syncModeSeg() {
  $$('#modeSeg .seg').forEach((b) => b.classList.toggle('active', b.dataset.mode === (state.settings.appearanceMode || 'auto')));
}

function syncSettingsInputs() {
  renderFontSelect();
  $('#noteOpacity').value = state.settings.noteOpacity;
  $('#winOpacity').value = state.settings.winOpacity;
  $('#fontSize').value = state.settings.fontSize;
  $('#fontFamily').value = state.settings.fontFamily;
  $('#canvasColor').value = state.settings.canvasColor || getTheme().bg;
  $('#backgroundMode').value = state.settings.backgroundMode || 'cover';
  $('#noteTextColor').value = state.settings.noteTextColor || (isLightTheme() ? '#2d2f38' : '#ececf1');
  $('#bgOpacity').value = state.settings.bgOpacity != null ? state.settings.bgOpacity : 100;
  $('#topBarOpacity').value = state.settings.topBarOpacity != null ? state.settings.topBarOpacity : 100;
  $('#topBarColor').value = state.settings.topBarColor || (isLightTheme() ? '#ffffff' : '#000000');
  const soft = isLightTheme() ? '#e6e9f2' : '#2c2e3a';
  $('#todoSearchColor').value = state.settings.todoSearchColor || soft;
  $('#todoSearchOpacity').value = state.settings.todoSearchOpacity != null ? state.settings.todoSearchOpacity : 100;
  $('#todoItemsColor').value = state.settings.todoItemsColor || soft;
  $('#todoItemsOpacity').value = state.settings.todoItemsOpacity != null ? state.settings.todoItemsOpacity : 100;
  $('#todoRemindColor').value = state.settings.todoRemindColor || soft;
  $('#todoRemindOpacity').value = state.settings.todoRemindOpacity != null ? state.settings.todoRemindOpacity : 100;
  syncModeSeg();
}

/* ============ 自定义字体 / 语言 ============ */
function applyCustomFonts() {
  let styleEl = $('#customFontStyles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'customFontStyles';
    document.head.appendChild(styleEl);
  }
  const fonts = state.settings.customFonts || [];
  styleEl.textContent = fonts.map((f) => `@font-face { font-family: '${f.family}'; src: url('${f.url}'); }`).join('\n');
}

function renderFontSelect() {
  const sel = $('#fontFamily');
  if (!sel) return;
  const cur = state.settings.fontFamily || 'system';
  sel.innerHTML = '';
  const addOpt = (value, label) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    sel.appendChild(o);
  };
  addOpt('system', state.settings.language === 'en' ? 'System default' : '系统默认');
  FONT_OPTIONS.forEach((f) => addOpt(f.v, f.label));
  (state.settings.customFonts || []).forEach((f) => addOpt(f.family, f.name));
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  else sel.value = 'system';
}

function renderFontList() {
  const wrap = $('#fontList');
  if (!wrap) return;
  wrap.innerHTML = '';
  const fonts = state.settings.customFonts || [];
  if (fonts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'trash-empty';
    empty.textContent = t('custom_fonts_hint');
    wrap.appendChild(empty);
    return;
  }
  fonts.forEach((f) => {
    const el = document.createElement('div');
    el.className = 'font-item';
    el.innerHTML = `
      <span class="font-name" style="font-family:'${f.family}',sans-serif">${escapeHtml(f.name)}</span>
      <span class="font-builtin"></span>
      <button class="del" data-i18n="delete">删除</button>`;
    $('.del', el).onclick = () => deleteCustomFont(f.id);
    wrap.appendChild(el);
  });
}

async function addCustomFont() {
  const r = await window.api.pickFont();
  if (r.ok) {
    const fonts = state.settings.customFonts || [];
    if (fonts.some((f) => f.family === r.family)) {
      toast(t('toast_font_added'));
      return;
    }
    fonts.push({ id: r.id, name: r.name, family: r.family, url: r.url });
    state.settings.customFonts = fonts;
    applyCustomFonts();
    renderFontSelect();
    renderFontList();
    save();
    toast(t('toast_font_added'));
  } else if (!r.canceled) {
    toast(t('toast_import_fail') + r.error);
  }
}

function deleteCustomFont(id) {
  state.settings.customFonts = (state.settings.customFonts || []).filter((f) => f.id !== id);
  const cur = state.settings.fontFamily;
  const stillCustom = (state.settings.customFonts || []).some((f) => f.family === cur);
  if (cur && cur.indexOf('CustomFont-') === 0 && !stillCustom) {
    state.settings.fontFamily = 'system';
  }
  applyCustomFonts();
  renderFontSelect();
  renderFontList();
  applyTheme();
  save();
  toast(t('toast_font_deleted'));
}

function applyLanguage() {
  const lang = state.settings.language || 'zh';
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  $$('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  const ls = $('#languageSelect');
  if (ls) ls.value = lang;
  renderFontSelect();
  renderFontList();
  renderGroupChips();
  renderThemePanel();
  renderAll();
}
function renderGroupChips() {
  const wrap = $('#groupChips');
  wrap.innerHTML = '';
  state.groups.forEach((g) => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (filter.group === g.id ? ' active' : '');
    chip.innerHTML = `<span class="dot" style="background:${g.color}"></span>${escapeHtml(g.name)}`;
    chip.title = t('left_click_filter');
    chip.onclick = () => setFilter('group', g.id);
    chip.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openGroupEditPop(chip, g);
    });
    wrap.appendChild(chip);
  });
  $$('#filterbar .chip[data-group]').forEach((c) => {
    c.classList.toggle('active', c.dataset.group === filter.group);
  });
}

function setFilter(key, val) {
  filter[key] = val;
  if (key === 'group') {
    renderGroupChips();
  }
  renderAll();
}

function createGroup(name) {
  const g = { id: uid(), name, color: ACCENTS[state.groups.length % ACCENTS.length] };
  state.groups.push(g);
  save();
  renderGroupChips();
  return g;
}

/* ============ 排序 ============ */
function ensureOrder() {
  let order = state.settings.noteOrder || [];
  order = order.filter((id) => state.notes.some((n) => n.id === id));
  state.notes.forEach((n) => { if (!order.includes(n.id)) order.push(n.id); });
  state.settings.noteOrder = order;
}

function getSortedNotes(arr) {
  const mode = state.settings.sortMode || 'updated';
  const order = state.settings.noteOrder || [];
  const a = [...arr];
  a.sort((x, y) => {
    if (x.pinned !== y.pinned) return x.pinned ? -1 : 1;
    if (mode === 'custom') {
      const ix = order.indexOf(x.id);
      const iy = order.indexOf(y.id);
      if (ix === -1 && iy === -1) return (y.createdAt || 0) - (x.createdAt || 0);
      if (ix === -1) return 1;
      if (iy === -1) return -1;
      return ix - iy;
    }
    if (mode === 'created') return (y.createdAt || 0) - (x.createdAt || 0);
    if (mode === 'title') return (x.title || '').localeCompare(y.title || '', 'zh');
    if (mode === 'color') return String(x.color).localeCompare(String(y.color));
    return (y.updatedAt || y.createdAt || 0) - (x.updatedAt || x.createdAt || 0);
  });
  return a;
}

function moveSortBy(id, dir) {
  const order = state.settings.noteOrder || [];
  const idx = order.indexOf(id);
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= order.length) return;
  order.splice(idx, 1);
  order.splice(target, 0, id);
  state.settings.noteOrder = order;
  save();
  renderSortPanel();
  if (state.settings.viewMode !== 'board') renderAll();
}

function moveSortItem(fromId, toId) {
  const order = state.settings.noteOrder || [];
  const fi = order.indexOf(fromId);
  const ti = order.indexOf(toId);
  if (fi < 0 || ti < 0 || fi === ti) return;
  order.splice(fi, 1);
  order.splice(ti, 0, fromId);
  state.settings.noteOrder = order;
  save();
  renderSortPanel();
  if (state.settings.viewMode !== 'board') renderAll();
}

function memoReorder(fromId, toId) {
  ensureOrder();
  state.settings.sortMode = 'custom';
  const order = state.settings.noteOrder;
  const fi = order.indexOf(fromId);
  const ti = order.indexOf(toId);
  if (fi < 0 || ti < 0 || fi === ti) return;
  order.splice(fi, 1);
  order.splice(ti, 0, fromId);
  state.settings.noteOrder = order;
  save();
  renderAll();
}

function renderSortPanel() {
  const sel = $('#sortMode');
  if (sel) sel.value = state.settings.sortMode || 'updated';
  const list = $('#sortList');
  if (!list) return;
  const isCustom = state.settings.sortMode === 'custom';
  const hint = $('#sortHint');
  if (hint) hint.classList.toggle('hidden', !isCustom);
  list.innerHTML = '';
  if (!isCustom) {
    const empty = document.createElement('div');
    empty.className = 'trash-empty';
    empty.textContent = t('drag_to_sort');
    list.appendChild(empty);
    return;
  }
  ensureOrder();
  const ordered = getSortedNotes(state.notes.filter((n) => !n.desktopPin));
  ordered.forEach((n) => {
    const el = document.createElement('div');
    el.className = 'sort-item';
    el.draggable = true;
    el.dataset.id = n.id;
    el.innerHTML = `
      <span class="drag-handle">⠿</span>
      <span class="sort-color" style="background:${n.color}"></span>
      <span class="sort-title">${escapeHtml(n.title || t('untitled'))}</span>
      <button class="sort-arrow" data-dir="up" title="${t('up')}">↑</button>
      <button class="sort-arrow" data-dir="down" title="${t('down')}">↓</button>`;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      dragSortId = n.id;
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (dragSortId && dragSortId !== n.id) el.classList.add('dragover');
    });
    el.addEventListener('dragleave', () => el.classList.remove('dragover'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('dragover');
      moveSortItem(dragSortId, n.id);
      dragSortId = null;
    });
    el.addEventListener('dragend', () => {
      dragSortId = null;
      $$('.sort-item').forEach((x) => x.classList.remove('dragover'));
    });
    $('[data-dir="up"]', el).onclick = (e) => { e.stopPropagation(); moveSortBy(n.id, -1); };
    $('[data-dir="down"]', el).onclick = (e) => { e.stopPropagation(); moveSortBy(n.id, 1); };
    list.appendChild(el);
  });
}

/* ============ 便签渲染 ============ */
function noteText(n) {
  return n.type === 'todo'
    ? (n.items || []).map((i) => i.text).join(' ')
    : n.content || '';
}

function imagesHtml(n) {
  const imgs = n.images || [];
  if (!imgs.length) return '';
  return `<div class="note-images">${imgs.map((img) => `
    <div class="note-img-item" data-img-id="${img.id}">
      <img src="${escapeHtml(img.src)}" style="width:${img.w || 200}px" />
      <button class="img-del" title="${t('delete_image')}">✕</button>
      <div class="img-resize"></div>
    </div>`).join('')}</div>`;
}

function buildNoteEl(n) {
  const el = document.createElement('div');
  el.className = 'note' + (n.pinned ? ' pinned' : '');
  el.dataset.id = n.id;
  el.style.left = n.x + 'px';
  el.style.top = n.y + 'px';
  el.style.width = (n.w || 240) + 'px';
  el.style.height = (n.h || 180) + 'px';
  el.style.background = n.color;
  el.style.zIndex = n.z || (++zCounter);

  let textColor = n.textColor || state.settings.noteTextColor;
  if (!textColor) textColor = autoTextColor(n.color);
  el.style.color = textColor;
  if (n.fontFamily && n.fontFamily !== 'system') el.style.fontFamily = FONTS[n.fontFamily] || n.fontFamily;

  const group = state.groups.find((g) => g.id === n.groupId);
  const isTodo = n.type === 'todo';
  const items = n.items || [];
  const reminder = n.reminder && n.reminder.enabled && n.reminder.time;
  const overdue = reminder && !n.reminder.fired && new Date(n.reminder.time).getTime() < Date.now();

  let bodyHtml = '';
  if (isTodo) {
    bodyHtml = `<ul class="todo-list">${items.map((it, idx) => `
      <li class="todo-item ${it.done ? 'done' : ''}" data-idx="${idx}">
        <input type="checkbox" ${it.done ? 'checked' : ''} />
        <input class="todo-text" value="${escapeHtml(it.text)}" placeholder="${t('todo_ph')}" />
        <button class="todo-del" title="${t('delete')}">✕</button>
      </li>`).join('')}</ul>
      <button class="todo-add">${t('add_todo')}</button>`;
  } else {
    bodyHtml = `<div class="note-content" contenteditable="true" spellcheck="false" data-placeholder="${t('note_content')}">${linkifyText(n.content || '')}</div>`;
  }

  el.innerHTML = `
    <div class="note-head">
      <span class="note-grip">⠿</span>
      <input class="note-title" value="${escapeHtml(n.title || '')}" placeholder="${t('note_title')}" />
      <div class="note-tools">
        <button class="t-pin ${n.pinned ? 'active' : ''}" title="${t('pin')}">📌</button>
        <button class="t-todo ${isTodo ? 'active' : ''}" title="${t('todo_mode')}">☑</button>
        <button class="t-group ${n.groupId ? 'active' : ''}" title="${n.groupId ? t('remove_from_group') : t('add_to_group')}">🏷</button>
        <button class="t-desktop" title="${t('desktop')}">🖥️</button>
        <button class="t-image" title="${t('insert_image')}">🖼️</button>
        <button class="t-remind" title="${t('todo_remind')}">⏰</button>
        <button class="t-color" title="${t('color')}">🎨</button>
        <button class="t-del" title="${t('delete')}">🗑</button>
      </div>
    </div>
    <div class="note-body">${imagesHtml(n)}${bodyHtml}</div>
    <div class="note-foot">
      <span class="group-tag" title="${t('set_group')}"><span class="dot" style="background:${group ? group.color : '#999'}"></span>${group ? escapeHtml(group.name) : t('ungrouped')}</span>
      ${reminder ? `<span class="reminder-chip ${overdue ? 'overdue' : ''}" title="${formatDate(n.reminder.time)}">⏰ ${formatDate(n.reminder.time)}</span>` : ''}
      <span class="date">${formatDate(n.updatedAt || n.createdAt)}</span>
    </div>
    <div class="resize-handle"></div>`;

  wireNoteEvents(el, n);
  return el;
}

function buildMemoEl(n) {
  const el = document.createElement('div');
  el.className = 'memo-row' + (n.pinned ? ' pinned' : '');
  el.dataset.id = n.id;
  el.style.setProperty('--note-color', n.color);

  let textColor = n.textColor || state.settings.noteTextColor;
  if (!textColor) textColor = autoTextColor(n.color);
  el.style.color = textColor;
  if (n.fontFamily && n.fontFamily !== 'system') el.style.fontFamily = FONTS[n.fontFamily] || n.fontFamily;

  const group = state.groups.find((g) => g.id === n.groupId);
  const isTodo = n.type === 'todo';
  const items = n.items || [];
  const reminder = n.reminder && n.reminder.enabled && n.reminder.time;
  const overdue = reminder && !n.reminder.fired && new Date(n.reminder.time).getTime() < Date.now();

  let bodyHtml = '';
  if (isTodo) {
    bodyHtml = `<ul class="todo-list">${items.map((it, idx) => `
      <li class="todo-item ${it.done ? 'done' : ''}" data-idx="${idx}">
        <input type="checkbox" ${it.done ? 'checked' : ''} />
        <input class="todo-text" value="${escapeHtml(it.text)}" placeholder="${t('todo_ph')}" />
        <button class="todo-del" title="${t('delete')}">✕</button>
      </li>`).join('')}</ul>
      <button class="todo-add">${t('add_todo')}</button>`;
  } else {
    bodyHtml = `<div class="note-content" contenteditable="true" spellcheck="false" data-placeholder="${t('note_content')}">${linkifyText(n.content || '')}</div>`;
  }

  el.innerHTML = `
    <div class="memo-content">
      <div class="memo-head">
        <span class="memo-grip" draggable="true" title="${t('drag_sort')}">⠿</span>
        <input class="note-title" value="${escapeHtml(n.title || '')}" placeholder="${t('note_title')}" />
        <div class="memo-tools">
          <button class="t-pin ${n.pinned ? 'active' : ''}" title="${t('pin')}">📌</button>
          <button class="t-todo ${isTodo ? 'active' : ''}" title="${t('todo_mode')}">☑</button>
          <button class="t-group ${n.groupId ? 'active' : ''}" title="${n.groupId ? t('remove_from_group') : t('add_to_group')}">🏷</button>
          <button class="t-desktop" title="${t('desktop')}">🖥️</button>
          <button class="t-image" title="${t('insert_image')}">🖼️</button>
          <button class="t-remind" title="${t('todo_remind')}">⏰</button>
          <button class="t-color" title="${t('color')}">🎨</button>
          <button class="t-del" title="${t('delete')}">🗑</button>
        </div>
      </div>
      <div class="memo-body">${imagesHtml(n)}${bodyHtml}</div>
      <div class="memo-foot">
        <span class="group-tag" title="${t('set_group')}"><span class="dot" style="background:${group ? group.color : '#999'}"></span>${group ? escapeHtml(group.name) : t('ungrouped')}</span>
        ${reminder ? `<span class="reminder-chip ${overdue ? 'overdue' : ''}" title="${formatDate(n.reminder.time)}">⏰ ${formatDate(n.reminder.time)}</span>` : ''}
        <span class="date">${formatDate(n.updatedAt || n.createdAt)}</span>
      </div>
    </div>`;

  wireMemoEvents(el, n);
  return el;
}

function wireCommon(el, n) {
  const titleInput = $('.note-title', el);
  const content = $('.note-content', el);
  const todoTexts = $$('.todo-text', el);

  el.addEventListener('contextmenu', (e) => {
    if (e.target.closest('button')) return;
    showNoteContextMenu(e, n);
  });
  const checkboxes = $$('.todo-item input[type=checkbox]', el);

  titleInput.addEventListener('input', () => { n.title = titleInput.value; n.updatedAt = Date.now(); save(); refreshFoot(el, n); });
  if (content) {
    content.addEventListener('click', (e) => {
      const link = e.target.closest('a.note-link');
      if (link) {
        const url = link.getAttribute('data-url');
        if (url) window.api.openExternal(url);
      }
    });
    content.addEventListener('input', () => { n.content = content.innerText; n.updatedAt = Date.now(); save(); });
    content.addEventListener('paste', (e) => {
      const cd = e.clipboardData || window.clipboardData;
      const items = (cd && cd.items) ? Array.from(cd.items) : [];
      const hasImage = items.some((it) => it.type && it.type.indexOf('image') === 0);
      if (hasImage) {
        e.preventDefault();
        handleImagePaste(cd, n);
        return;
      }
      e.preventDefault();
      const text = cd ? cd.getData('text/plain') : '';
      document.execCommand('insertText', false, text);
    });
    content.addEventListener('blur', () => {
      n.content = content.innerText;
      n.updatedAt = Date.now();
      content.innerHTML = linkifyText(n.content);
      save();
    });
  }
  todoTexts.forEach((inp) => {
    inp.addEventListener('input', () => {
      const idx = Number(inp.closest('.todo-item').dataset.idx);
      n.items[idx].text = inp.value;
      n.updatedAt = Date.now();
      save();
    });
  });
  checkboxes.forEach((cb) => {
    cb.addEventListener('change', () => {
      const idx = Number(cb.closest('.todo-item').dataset.idx);
      n.items[idx].done = cb.checked;
      cb.closest('.todo-item').classList.toggle('done', cb.checked);
      n.updatedAt = Date.now();
      save();
    });
  });

  $('.t-pin', el).onclick = () => { n.pinned = !n.pinned; n.updatedAt = Date.now(); save(); renderAll(); };
  $('.t-del', el).onclick = () => deleteNote(n.id);
  $('.t-color', el).onclick = (e) => { e.stopPropagation(); openColorPop(el, n); };
  $('.t-remind', el).onclick = () => openReminder(n);
  $('.t-group', el).onclick = (e) => {
    e.stopPropagation();
    if (n.groupId) {
      const gname = (state.groups.find((g) => g.id === n.groupId) || {}).name;
      n.groupId = null;
      n.updatedAt = Date.now();
      save();
      renderAll();
      toast(t('toast_unpin') + (gname ? '「' + gname + '」' : ''));
    } else {
      openGroupPop(el, n);
    }
  };
  $('.t-desktop', el).onclick = (e) => {
    e.stopPropagation();
    n.desktopPin = true;
    n.updatedAt = Date.now();
    saveNow();
    window.api.pinToDesktop(n.id);
    renderAll();
    toast(t('toast_pinned'));
  };
  $('.t-image', el).onclick = async (e) => {
    e.stopPropagation();
    const r = await window.api.pickNoteImage();
    if (r.ok) {
      n.images = n.images || [];
      n.images.push({ id: uid(), src: r.url, w: 200 });
      n.updatedAt = Date.now();
      save();
      renderAll();
    } else if (!r.canceled) {
      toast(t('toast_img_saved_fail') + r.error);
    }
  };
  $('.t-todo', el).onclick = () => {
    if (n.type !== 'todo') {
      n.type = 'todo';
      n.items = n.items || [];
      if (n.content) { n.items.push({ id: uid(), text: n.content, done: false }); n.content = ''; }
    } else {
      n.type = 'note';
    }
    n.updatedAt = Date.now();
    save();
    renderAll();
  };

  const addBtn = $('.todo-add', el);
  if (addBtn) {
    addBtn.onclick = () => {
      n.items = n.items || [];
      n.items.push({ id: uid(), text: '', done: false });
      n.updatedAt = Date.now();
      save();
      renderAll();
      const last = $$('[data-id="' + n.id + '"] .todo-text').pop();
      if (last) last.focus();
    };
  }

  $$('.todo-del', el).forEach((b) => {
    b.onclick = () => {
      const idx = Number(b.closest('.todo-item').dataset.idx);
      n.items.splice(idx, 1);
      n.updatedAt = Date.now();
      save();
      renderAll();
    };
  });

  const groupTag = $('.group-tag', el);
  if (groupTag) groupTag.onclick = (e) => { e.stopPropagation(); openGroupPop(el, n); };

  wireImages(el, n);
}

async function addNoteImageFromDataUrl(dataUrl, n) {
  const r = await window.api.saveNoteImage(dataUrl);
  if (r.ok) {
    n.images = n.images || [];
    n.images.push({ id: uid(), src: r.url, w: 200 });
    n.updatedAt = Date.now();
    save();
    renderAll();
    toast(t('toast_img_pasted'));
  } else {
    toast(t('toast_img_saved_fail') + r.error);
  }
}

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

async function readClipboardImageAsDataUrl() {
  try {
    const fromMain = await window.api.readClipboardImage();
    if (fromMain) return fromMain;
  } catch (e) { /* ignore */ }
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = (item.types || []).find((t) => t.indexOf('image/') === 0);
        if (imgType) {
          const blob = await item.getType(imgType);
          return await blobToDataUrl(blob);
        }
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function handleImagePaste(cd, n) {
  const items = Array.from(cd.items || []);
  for (const it of items) {
    if (it.type && it.type.indexOf('image') === 0) {
      const blob = it.getAsFile();
      if (!blob) continue;
      const dataUrl = await new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.readAsDataURL(blob);
      });
      await addNoteImageFromDataUrl(dataUrl, n);
      return;
    }
  }
}

function wireImages(el, n) {
  $$('.note-img-item', el).forEach((item) => {
    const id = item.dataset.imgId;
    const img = $('img', item);
    const del = $('.img-del', item);
    const handle = $('.img-resize', item);

    const removeImage = () => {
      n.images = (n.images || []).filter((x) => x.id !== id);
      n.updatedAt = Date.now();
      save();
      renderAll();
    };

    if (del) del.onclick = (e) => {
      e.stopPropagation();
      removeImage();
    };

    item.setAttribute('tabindex', '0');
    item.addEventListener('click', (e) => {
      if (e.target.closest('.img-resize') || e.target.closest('.img-del')) return;
      e.stopPropagation();
      $$('.note-img-item', el).forEach((x) => x.classList.remove('selected'));
      item.classList.add('selected');
      item.focus();
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        e.stopPropagation();
        removeImage();
      }
    });

    if (handle) handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const imgObj = (n.images || []).find((x) => x.id === id);
      if (!imgObj) return;
      const startX = e.clientX;
      const startW = imgObj.w || 200;
      const onMove = (ev) => {
        const w = Math.max(60, Math.round(startW + (ev.clientX - startX)));
        imgObj.w = w;
        img.style.width = w + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        n.updatedAt = Date.now();
        save();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

function wireNoteEvents(el, n) {
  wireCommon(el, n);

  const head = $('.note-head', el);
  head.addEventListener('mousedown', (e) => {
    if (e.target.closest('button, input, .note-tools')) return;
    e.preventDefault();
    startDrag(el, n, e);
  });

  const handle = $('.resize-handle', el);
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startResize(el, n, e);
  });

  el.addEventListener('mousedown', () => {
    el.style.zIndex = ++zCounter;
    n.z = el.style.zIndex;
    bringToFront(el);
  });
}

function wireMemoEvents(el, n) {
  wireCommon(el, n);

  const grip = $('.memo-grip', el);
  if (grip) {
    grip.addEventListener('dragstart', (e) => {
      dragMemoId = n.id;
      e.dataTransfer.effectAllowed = 'move';
    });
    grip.addEventListener('dragend', () => {
      dragMemoId = null;
      $$('.memo-row').forEach((x) => x.classList.remove('drag-over'));
    });
  }
  el.addEventListener('dragover', (e) => {
    if (!dragMemoId || dragMemoId === n.id) return;
    e.preventDefault();
    el.classList.add('drag-over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
  el.addEventListener('drop', (e) => {
    if (!dragMemoId || dragMemoId === n.id) return;
    e.preventDefault();
    el.classList.remove('drag-over');
    memoReorder(dragMemoId, n.id);
  });
}

function bringToFront(el) {
  $$('.note').forEach((x) => x.classList.remove('selected'));
  el.classList.add('selected');
}

function refreshFoot(el, n) {
  const date = $('.date', el);
  if (date) date.textContent = formatDate(n.updatedAt || n.createdAt);
}

function startDrag(el, n, e) {
  const board = $('#board');
  const rect = board.getBoundingClientRect();
  const startX = e.clientX;
  const startY = e.clientY;
  const origX = n.x;
  const origY = n.y;
  const offsetX = e.clientX - rect.left - n.x;
  const offsetY = e.clientY - rect.top - n.y;

  el.classList.add('dragging');

  const onMove = (ev) => {
    const nx = ev.clientX - rect.left - offsetX;
    const ny = ev.clientY - rect.top - offsetY;
    n.x = Math.max(0, Math.round(nx));
    n.y = Math.max(0, Math.round(ny));
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    el.classList.remove('dragging');
    n.updatedAt = Date.now();
    save();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function startResize(el, n, e) {
  const startX = e.clientX;
  const startY = e.clientY;
  const origW = n.w || 240;
  const origH = n.h || 180;
  const onMove = (ev) => {
    n.w = Math.max(180, origW + (ev.clientX - startX));
    n.h = Math.max(140, origH + (ev.clientY - startY));
    el.style.width = n.w + 'px';
    el.style.height = n.h + 'px';
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    n.updatedAt = Date.now();
    save();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

/* ============ 待办区 ============ */
function createTodoNote(text) {
  const n = {
    id: uid(),
    title: '待办',
    content: '',
    type: 'todo',
    items: [{ id: uid(), text, done: false }],
    color: '#000000',
    textColor: null,
    fontFamily: null,
    images: [],
    groupId: null,
    pinned: false,
    desktopPin: false,
    reminder: null,
    x: 40 + Math.random() * 60,
    y: 40 + Math.random() * 60,
    w: 240,
    h: 200,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  state.notes.push(n);
  ensureOrder();
  save();
  return n;
}

function createEmptyTodoNote() {
  const pos = nextGridPosition();
  const n = {
    id: uid(),
    title: '待办',
    content: '',
    type: 'todo',
    items: [],
    color: '#000000',
    textColor: null,
    fontFamily: null,
    images: [],
    groupId: null,
    pinned: false,
    desktopPin: false,
    reminder: null,
    x: pos.x,
    y: pos.y,
    w: 240,
    h: 200,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  state.notes.push(n);
  ensureOrder();
  save();
  renderAll();
  return n;
}

function renderTodoView() {
  const list = $('#todoList');
  if (!list) return;

  const visible = state.notes.filter((n) => {
    if (n.desktopPin) return false;
    if (filter.group === 'ungrouped' && n.groupId) return false;
    if (filter.group !== 'all' && filter.group !== 'ungrouped' && n.groupId !== filter.group) return false;
    return true;
  });

  const todoEntries = [];
  visible.forEach((n) => {
    if (n.type === 'todo') {
      (n.items || []).forEach((it) => todoEntries.push({ note: n, item: it }));
    }
  });
  const openCount = todoEntries.filter((e) => !e.item.done).length;

  const remindEntries = visible
    .filter((n) => n.reminder && n.reminder.enabled && n.reminder.time)
    .sort((a, b) => new Date(a.reminder.time) - new Date(b.reminder.time));

  let html = '';
  html += `<div class="todo-panel-head"><h3>${t('todo_items')}</h3><span class="count">${openCount}</span></div>
    <div class="todo-add-box"><input id="todoQuickInput" type="text" placeholder="${t('add_todo_ph')}" /><button class="sp-btn" id="btnQuickAdd" style="width:auto;padding:0 18px">${t('add')}</button></div>`;

  html += `<div class="todo-section items"><h4>${t('todo_items')}（${todoEntries.length}）</h4>`;
  if (todoEntries.length === 0) {
    html += `<div class="todo-empty">${t('no_todos')}</div>`;
  } else {
    todoEntries.forEach(({ note, item }) => {
      const group = state.groups.find((g) => g.id === note.groupId);
      const reminder = note.reminder && note.reminder.enabled && note.reminder.time;
      const overdue = reminder && !note.reminder.fired && new Date(note.reminder.time).getTime() < Date.now();
      html += `<div class="todo-line ${item.done ? 'done' : ''}" data-note="${note.id}" data-item="${item.id}">
        <input type="checkbox" ${item.done ? 'checked' : ''} />
        <div class="tl-body">
          <div class="tl-text">${escapeHtml(item.text || t('empty_item'))}</div>
          <div class="tl-meta">
            ${group ? `<span class="dot" style="background:${group.color}"></span>` : ''}
            <span class="link" data-goto="${note.id}">${escapeHtml(note.title || t('untitled'))}</span>
          </div>
        </div>
        ${reminder ? `<span class="tl-flag ${overdue ? 'overdue' : ''}">${overdue ? t('overdue') : ''} ${formatDate(note.reminder.time)}</span>` : ''}
        <button class="tl-del" title="${t('delete_todo')}">✕</button>
      </div>`;
    });
  }
  html += '</div>';

  html += `<div class="todo-section remind"><h4>${t('time_todos')}（${remindEntries.length}）</h4>`;
  if (remindEntries.length === 0) {
    html += `<div class="todo-empty">${t('no_reminders')}</div>`;
  } else {
    remindEntries.forEach((note) => {
      const overdue = !note.reminder.fired && new Date(note.reminder.time).getTime() < Date.now();
      const group = state.groups.find((g) => g.id === note.groupId);
      html += `<div class="todo-line" data-note="${note.id}">
        <div class="tl-body">
          <div class="tl-text">${escapeHtml(note.title || t('untitled'))}</div>
          <div class="tl-meta">
            ${group ? `<span class="dot" style="background:${group.color}"></span>` : ''}
            <span class="link" data-goto="${note.id}">${t('open_note')}</span>
          </div>
        </div>
        <span class="tl-flag ${overdue ? 'overdue' : ''}">${overdue ? t('overdue') + ' · ' : ''}${formatDate(note.reminder.time)}</span>
        <button class="tl-del" data-remind-clear="${note.id}" title="${t('clear_time')}">✕</button>
      </div>`;
    });
  }
  html += '</div>';

  list.innerHTML = html;
  wireTodoView();
}

function wireTodoView() {
  const qinput = $('#todoQuickInput');
  const addBtn = $('#btnQuickAdd');
  const addTodo = () => {
    const text = qinput ? qinput.value.trim() : '';
    if (!text) return;
    createTodoNote(text);
    qinput.value = '';
    renderAll();
    toast(t('toast_todo_added'));
  };
  if (addBtn) addBtn.onclick = addTodo;
  if (qinput) qinput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTodo(); });

  $$('#todoList .todo-line').forEach((line) => {
    const noteId = line.dataset.note;
    const cb = $('input[type=checkbox]', line);
    if (cb) {
      cb.addEventListener('change', () => {
        const n = state.notes.find((x) => x.id === noteId);
        if (!n) return;
        const item = (n.items || []).find((i) => i.id === line.dataset.item);
        if (item) { item.done = cb.checked; n.updatedAt = Date.now(); save(); }
        renderAll();
      });
    }
    const del = $('.tl-del', line);
    if (del) {
      if (del.dataset.remindClear) {
        del.onclick = () => {
          const n = state.notes.find((x) => x.id === noteId);
          if (n) { n.reminder = null; n.updatedAt = Date.now(); save(); renderAll(); }
        };
      } else {
        del.onclick = () => {
          const n = state.notes.find((x) => x.id === noteId);
          if (n) { n.items = (n.items || []).filter((i) => i.id !== line.dataset.item); n.updatedAt = Date.now(); save(); renderAll(); }
        };
      }
    }
    $$('.link[data-goto]', line).forEach((link) => {
      link.onclick = () => openNoteById(link.dataset.goto);
    });
  });
}

function openNoteById(id) {
  setViewMode('board');
  filter.group = 'all';
  filter.query = '';
  const si = $('#searchInput');
  if (si) si.value = '';
  const sc = $('#searchClear');
  if (sc) sc.classList.add('hidden');
  renderGroupChips();
  renderAll();
  const el = document.querySelector('[data-id="' + id + '"]');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    bringToFront(el);
    const target = $('.note-title', el) || $('.note-content', el);
    if (target) target.focus();
  }
}

/* ============ 主渲染 ============ */
function renderAll() {
  const board = $('#board');
  const memoList = $('#memoList');
  const todoList = $('#todoList');
  const query = filter.query.trim().toLowerCase();

  const visible = state.notes.filter((n) => {
    if (n.desktopPin) return false;
    if (filter.group === 'ungrouped' && n.groupId) return false;
    if (filter.group !== 'all' && filter.group !== 'ungrouped' && n.groupId !== filter.group) return false;
    if (query) {
      const g = state.groups.find((x) => x.id === n.groupId);
      const hay = ((n.title || '') + ' ' + noteText(n) + ' ' + (g ? g.name : '')).toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  if (state.settings.viewMode === 'todo') {
    board.classList.add('hidden');
    memoList.classList.add('hidden');
    todoList.classList.remove('hidden');
    board.innerHTML = '';
    memoList.innerHTML = '';
    renderTodoView();
  } else if (state.settings.viewMode === 'memo') {
    board.classList.add('hidden');
    memoList.classList.remove('hidden');
    todoList.classList.add('hidden');
    board.innerHTML = '';
    memoList.innerHTML = '';
    getSortedNotes(visible).forEach((n) => memoList.appendChild(buildMemoEl(n)));
  } else {
    board.classList.remove('hidden');
    memoList.classList.add('hidden');
    todoList.classList.add('hidden');
    memoList.innerHTML = '';
    todoList.innerHTML = '';
    board.innerHTML = '';
    visible.forEach((n) => board.appendChild(buildNoteEl(n)));
  }

  $('#noteCount').textContent = state.notes.length;
  const empty = state.notes.length === 0;
  $('#emptyHint').classList.toggle('hidden', !empty || state.settings.viewMode === 'todo');
}

function setViewMode(mode) {
  state.settings.viewMode = mode;
  $('#viewBoard').classList.toggle('active', mode === 'board');
  $('#viewMemo').classList.toggle('active', mode === 'memo');
  $('#viewTodo').classList.toggle('active', mode === 'todo');
  save();
  renderAll();
}

function nextGridPosition() {
  const cols = Math.max(1, Math.floor((($('#canvas').clientWidth - 40) / 260)));
  const occupied = new Set();
  state.notes.filter((n) => !n.desktopPin).forEach((n) => {
    const col = Math.round((n.x - 20) / 260);
    const row = Math.round((n.y - 20) / 230);
    occupied.add(row * 1000 + col);
  });
  for (let i = 0; i < 5000; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    if (!occupied.has(row * 1000 + col)) return { x: 20 + col * 260, y: 20 + row * 230 };
  }
  return { x: 20, y: 20 };
}

function createNote(x, y) {
  const pos = (x != null && y != null) ? { x, y } : nextGridPosition();
  const n = {
    id: uid(),
    title: '',
    content: '',
    type: 'note',
    items: [],
    color: '#000000',
    textColor: null,
    fontFamily: null,
    images: [],
    groupId: (filter.group && filter.group !== 'all' && filter.group !== 'ungrouped') ? filter.group : null,
    pinned: false,
    desktopPin: false,
    reminder: null,
    x: pos.x,
    y: pos.y,
    w: 240,
    h: 200,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  state.notes.push(n);
  ensureOrder();
  save();
  renderAll();
  focusNewNote(n.id);
  return n;
}

function focusNewNote(id) {
  const el = document.querySelector('[data-id="' + id + '"]');
  if (el) {
    const target = $('.note-content', el) || $('.note-title', el);
    if (target) target.focus();
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/* ============ 回收站 ============ */
function deleteNote(id) {
  const n = state.notes.find((x) => x.id === id);
  if (!n) return;
  if (n.desktopPin) window.api.unpinFromDesktop(id);
  n.desktopPin = false;
  state.notes = state.notes.filter((x) => x.id !== id);
  state.trash.push({ note: n, deletedAt: Date.now() });
  closePops();
  save();
  renderAll();
  toast(t('toast_removed'));
}

function purgeTrash() {
  const days = Number(state.settings.recycleBinDays != null ? state.settings.recycleBinDays : 7);
  if (!days) return;
  const cutoff = Date.now() - days * 86400000;
  const before = state.trash.length;
  state.trash = state.trash.filter((t) => t.deletedAt >= cutoff);
  if (state.trash.length !== before) save();
}

function restoreTrashItem(id) {
  const idx = state.trash.findIndex((t) => t.note.id === id);
  if (idx < 0) return;
  const { note } = state.trash[idx];
  state.trash.splice(idx, 1);
  state.notes.push(note);
  ensureOrder();
  save();
  renderAll();
  renderTrashPanel();
  toast(t('toast_restored'));
}

function deleteTrashItem(id) {
  state.trash = state.trash.filter((t) => t.note.id !== id);
  save();
  renderTrashPanel();
}

function emptyTrash() {
  state.trash = [];
  save();
  renderTrashPanel();
  toast(t('toast_trash_empty'));
}

function renderTrashPanel() {
  const wrap = $('#trashList');
  if (!wrap) return;
  purgeTrash();
  if (state.trash.length === 0) {
    wrap.innerHTML = `<div class="trash-empty">${t('trash_empty')}</div>`;
    return;
  }
  wrap.innerHTML = '';
  state.trash.slice().sort((a, b) => b.deletedAt - a.deletedAt).forEach((tr) => {
    const n = tr.note;
    const el = document.createElement('div');
    el.className = 'trash-item';
    const title = (n.title || noteText(n) || t('untitled')).slice(0, 40);
    el.innerHTML = `
      <span class="trash-color" style="background:${n.color}"></span>
      <div class="trash-info">
        <div class="trash-title">${escapeHtml(title)}</div>
        <div class="trash-date">${t('deleted_at')}${formatDate(tr.deletedAt)}</div>
      </div>
      <button class="restore" title="${t('restore_note')}">${t('restore_note')}</button>
      <button class="del" title="${t('delete_forever')}">${t('delete')}</button>`;
    $('.restore', el).onclick = () => restoreTrashItem(n.id);
    $('.del', el).onclick = () => deleteTrashItem(n.id);
    wrap.appendChild(el);
  });
}

/* ============ 颜色 / 分组弹窗 ============ */
function closePops() {
  if (activeColorPop) { activeColorPop.remove(); activeColorPop = null; }
  if (activeGroupPop) { activeGroupPop.remove(); activeGroupPop = null; }
}

function showNoteContextMenu(e, n) {
  e.preventDefault();
  e.stopPropagation();
  closePops();
  const pop = document.createElement('div');
  pop.className = 'color-pop ctx-menu';
  pop.style.gridTemplateColumns = '1fr';
  pop.style.minWidth = '150px';
  pop.style.padding = '6px';

  const addItem = (icon, label, onClick) => {
    const b = document.createElement('button');
    b.style.cssText = 'background:transparent;border:none;color:var(--fg);padding:8px 10px;border-radius:7px;cursor:pointer;text-align:left;font-size:13px;font-family:inherit;width:100%;display:flex;align-items:center;gap:8px;';
    b.innerHTML = `<span>${icon}</span><span>${label}</span>`;
    b.onmouseenter = () => (b.style.background = 'var(--accent-soft)');
    b.onmouseleave = () => (b.style.background = 'transparent');
    b.onclick = () => { closePops(); onClick(); };
    pop.appendChild(b);
  };

  addItem('💾', t('save'), () => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    n.updatedAt = Date.now();
    save();
    renderAll();
    toast(t('toast_saved'));
  });
  addItem('📋', t('copy'), () => {
    const sel = window.getSelection().toString();
    if (sel) document.execCommand('copy');
    else window.api.writeClipboard(noteText(n));
  });
  addItem('✂️', t('cut'), () => { document.execCommand('cut'); });
  addItem('📥', t('paste'), async () => {
    const imgDataUrl = await readClipboardImageAsDataUrl();
    if (imgDataUrl) {
      await addNoteImageFromDataUrl(imgDataUrl, n);
      return;
    }
    const text = await window.api.readClipboard();
    if (text) document.execCommand('insertText', false, text);
  });
  addItem('▤', t('select_all'), () => {
    const ae = document.activeElement;
    if (ae && ae.select) ae.select();
    else document.execCommand('selectAll');
  });

  document.body.appendChild(pop);
  const x = Math.max(8, Math.min(e.clientX, window.innerWidth - pop.offsetWidth - 8));
  const y = Math.max(8, Math.min(e.clientY, window.innerHeight - pop.offsetHeight - 8));
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
  activeColorPop = pop;
  setTimeout(() => document.addEventListener('mousedown', closePopsOnce), 0);
}

function openColorPop(el, n) {
  closePops();
  const pop = document.createElement('div');
  pop.className = 'color-pop';

  const addSwatch = (color, active, onClick) => {
    const s = document.createElement('button');
    s.className = 'swatch' + (active ? ' active' : '');
    s.style.background = color;
    s.onclick = (e) => { e.stopPropagation(); onClick(); };
    pop.appendChild(s);
  };

  NOTE_COLORS.forEach((c) => {
    addSwatch(c, n.color === c, () => { n.color = c; n.updatedAt = Date.now(); save(); renderAll(); });
  });

  const bgLabel = document.createElement('div');
  bgLabel.className = 'color-pop-label';
  bgLabel.textContent = t('custom_bg');
  pop.appendChild(bgLabel);

  const customInput = document.createElement('input');
  customInput.type = 'color';
  customInput.value = n.color || '#000000';
  customInput.title = t('custom_bg');
  customInput.style.cssText = 'grid-column:1/-1;width:100%;height:30px;border:1px solid var(--border);border-radius:7px;background:transparent;cursor:pointer;padding:2px;';
  customInput.addEventListener('input', (e) => {
    n.color = e.target.value;
    n.updatedAt = Date.now();
    const liveEl = document.querySelector('[data-id="' + n.id + '"]');
    if (liveEl) {
      liveEl.style.background = n.color;
      liveEl.style.setProperty('--note-color', n.color);
      const tc = n.textColor || state.settings.noteTextColor || autoTextColor(n.color);
      liveEl.style.color = tc;
    }
  });
  customInput.addEventListener('change', () => save());
  pop.appendChild(customInput);

  const label = document.createElement('div');
  label.className = 'color-pop-label';
  label.textContent = t('text_color');
  pop.appendChild(label);

  TEXT_COLORS.forEach((c) => {
    addSwatch(c, (n.textColor || state.settings.noteTextColor) === c, () => { n.textColor = c; n.updatedAt = Date.now(); save(); renderAll(); });
  });

  const fontLabel = document.createElement('div');
  fontLabel.className = 'color-pop-label';
  fontLabel.textContent = t('font');
  pop.appendChild(fontLabel);

  const fontSelect = document.createElement('select');
  fontSelect.style.cssText = 'grid-column:1/-1;width:100%;background:var(--bg-soft);color:var(--fg);border:1px solid var(--border);border-radius:7px;padding:5px 8px;font-family:inherit;font-size:12px;cursor:pointer;';
  const defFontOpt = document.createElement('option');
  defFontOpt.value = '';
  defFontOpt.textContent = t('follow_global');
  fontSelect.appendChild(defFontOpt);
  FONT_OPTIONS.forEach((f) => {
    const o = document.createElement('option');
    o.value = f.v;
    o.textContent = f.label;
    fontSelect.appendChild(o);
  });
  (state.settings.customFonts || []).forEach((f) => {
    const o = document.createElement('option');
    o.value = f.family;
    o.textContent = f.name;
    fontSelect.appendChild(o);
  });
  fontSelect.value = n.fontFamily || '';
  fontSelect.addEventListener('change', () => {
    n.fontFamily = fontSelect.value || null;
    n.updatedAt = Date.now();
    save();
    renderAll();
  });
  pop.appendChild(fontSelect);

  const def = document.createElement('button');
  def.className = 'color-pop-def';
  def.textContent = t('default_color');
  def.onclick = (e) => { e.stopPropagation(); n.textColor = null; n.updatedAt = Date.now(); save(); renderAll(); };
  pop.appendChild(def);

  document.body.appendChild(pop);
  const r = el.getBoundingClientRect();
  pop.style.left = Math.min(r.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8) + 'px';
  pop.style.top = Math.max(8, Math.min(r.top + 28, window.innerHeight - pop.offsetHeight - 8)) + 'px';
  activeColorPop = pop;
  setTimeout(() => document.addEventListener('mousedown', closePopsOnce), 0);
}

function openGroupPop(el, n) {
  closePops();
  const pop = document.createElement('div');
  pop.className = 'color-pop';
  pop.style.gridTemplateColumns = '1fr';
  pop.style.minWidth = '140px';
  pop.style.padding = '6px';

  const items = [
    { label: t('ungrouped'), id: null },
    ...state.groups.map((g) => ({ label: g.name, id: g.id }))
  ];
  items.forEach((it) => {
    const b = document.createElement('button');
    b.style.cssText = 'background:transparent;border:none;color:var(--fg);padding:7px 10px;border-radius:7px;cursor:pointer;text-align:left;font-size:13px;font-family:inherit;';
    b.innerHTML = `${it.id ? `<span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${(state.groups.find(g=>g.id===it.id)||{}).color};margin-right:6px"></span>` : ''}${escapeHtml(it.label)}${n.groupId === it.id ? ' ✓' : ''}`;
    b.onmouseenter = () => (b.style.background = 'var(--accent-soft)');
    b.onmouseleave = () => (b.style.background = 'transparent');
    b.onclick = (e) => { e.stopPropagation(); n.groupId = it.id; n.updatedAt = Date.now(); save(); renderAll(); };
    pop.appendChild(b);
  });

  const newBtn = document.createElement('button');
  newBtn.style.cssText = 'background:transparent;border:1px dashed var(--border);color:var(--fg-dim);padding:7px 10px;border-radius:7px;cursor:pointer;text-align:left;font-size:13px;font-family:inherit;margin-top:4px;';
  newBtn.textContent = t('add_group');
  newBtn.onclick = (e) => {
    e.stopPropagation();
    closePops();
    promptModal(t('new_group'), t('group_name'), '').then((name) => {
      if (name) {
        const g = createGroup(name.trim());
        n.groupId = g.id;
        n.updatedAt = Date.now();
        save();
        renderAll();
      }
    });
  };
  pop.appendChild(newBtn);

  document.body.appendChild(pop);
  const r = el.getBoundingClientRect();
  pop.style.left = r.left + 'px';
  pop.style.top = Math.min(r.bottom + 4, window.innerHeight - pop.offsetHeight - 8) + 'px';
  activeGroupPop = pop;
  setTimeout(() => document.addEventListener('mousedown', closePopsOnce), 0);
}

function closePopsOnce(e) {
  if (activeColorPop && !activeColorPop.contains(e.target)) { activeColorPop.remove(); activeColorPop = null; document.removeEventListener('mousedown', closePopsOnce); }
  if (activeGroupPop && !activeGroupPop.contains(e.target)) { activeGroupPop.remove(); activeGroupPop = null; document.removeEventListener('mousedown', closePopsOnce); }
}

function openGroupEditPop(anchorEl, g) {
  closePops();
  const pop = document.createElement('div');
  pop.className = 'color-pop';
  pop.style.gridTemplateColumns = '1fr';
  pop.style.minWidth = '170px';
  pop.style.padding = '6px';

  const addBtn = (html, onClick) => {
    const b = document.createElement('button');
    b.style.cssText = 'background:transparent;border:none;color:var(--fg);padding:8px 10px;border-radius:7px;cursor:pointer;text-align:left;font-size:13px;font-family:inherit;width:100%;';
    b.innerHTML = html;
    b.onmouseenter = () => (b.style.background = 'var(--accent-soft)');
    b.onmouseleave = () => (b.style.background = 'transparent');
    b.onclick = (e) => { e.stopPropagation(); closePops(); onClick(); };
    pop.appendChild(b);
  };

  addBtn(`✏ ${t('rename_group')}`, () => {
    promptModal(t('rename_group'), t('group_name'), g.name).then((name) => {
      if (name && name.trim()) {
        g.name = name.trim();
        save();
        renderGroupChips();
      }
    });
  });

  const colorLabel = document.createElement('div');
  colorLabel.style.cssText = 'font-size:11px;color:var(--fg-dim);padding:8px 10px 2px;';
  colorLabel.textContent = t('change_color');
  pop.appendChild(colorLabel);

  const colorRow = document.createElement('div');
  colorRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;padding:4px 10px 8px;';
  ACCENTS.forEach((c) => {
    const s = document.createElement('button');
    s.className = 'swatch' + (g.color === c ? ' active' : '');
    s.style.background = c;
    s.onclick = (e) => {
      e.stopPropagation();
      g.color = c;
      save();
      renderGroupChips();
      closePops();
    };
    colorRow.appendChild(s);
  });
  pop.appendChild(colorRow);

  addBtn(`<span style="color:#e5484d">🗑 ${t('delete_group')}</span>`, () => {
    confirmModal(t('delete_group'), `${t('confirm_delete_group_msg')}（${g.name}）`).then((ok) => {
      if (ok) {
        state.groups = state.groups.filter((x) => x.id !== g.id);
        state.notes.forEach((n) => { if (n.groupId === g.id) n.groupId = null; });
        if (filter.group === g.id) filter.group = 'all';
        save();
        renderGroupChips();
        renderAll();
        toast(t('toast_group_deleted'));
      }
    });
  });

  document.body.appendChild(pop);
  const r = anchorEl.getBoundingClientRect();
  pop.style.left = r.left + 'px';
  pop.style.top = Math.min(r.bottom + 4, window.innerHeight - pop.offsetHeight - 8) + 'px';
  activeColorPop = pop;
  setTimeout(() => document.addEventListener('mousedown', closePopsOnce), 0);
}

/* ============ 待办提醒 ============ */
let reminderNoteId = null;

function openReminder(n) {
  reminderNoteId = n.id;
  $('#reminderTitle').textContent = n.title || t('set_todo_time');
  const input = $('#reminderInput');
  if (n.reminder && n.reminder.time) {
    const d = new Date(n.reminder.time);
    const pad = (x) => String(x).padStart(2, '0');
    input.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } else {
    const d = new Date(Date.now() + 3600000);
    const pad = (x) => String(x).padStart(2, '0');
    input.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  $('#reminderOverlay').classList.remove('hidden');
}

function closeReminder() {
  $('#reminderOverlay').classList.add('hidden');
  reminderNoteId = null;
}

/* ============ 通用弹窗 ============ */
function promptModal(title, placeholder, def) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;border-radius:14px;';
    const modal = document.createElement('div');
    modal.style.cssText = 'width:280px;background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;';
    modal.innerHTML = `
      <header style="padding:14px 16px;font-weight:700;border-bottom:1px solid var(--border)">${escapeHtml(title)}</header>
      <div style="padding:16px"><input id="pmInput" style="width:100%;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:9px 10px;font-family:inherit;font-size:14px" value="${escapeHtml(def || '')}" /></div>
      <footer style="padding:12px 16px;display:flex;gap:10px;justify-content:flex-end">
        <button id="pmCancel" class="sp-btn ghost" style="width:auto;padding:8px 18px">${t('cancel')}</button>
        <button id="pmOk" class="sp-btn primary" style="width:auto;padding:8px 18px">${t('ok')}</button>
      </footer>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const input = $('#pmInput', modal);
    const done = (val) => { overlay.remove(); resolve(val); };
    $('#pmOk', modal).onclick = () => done(input.value);
    $('#pmCancel', modal).onclick = () => done(null);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value); });
    input.focus();
    input.select();
  });
}

function confirmModal(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;border-radius:14px;';
    const modal = document.createElement('div');
    modal.style.cssText = 'width:300px;background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;';
    modal.innerHTML = `
      <header style="padding:14px 16px;font-weight:700;border-bottom:1px solid var(--border)">${escapeHtml(title)}</header>
      <div style="padding:16px;font-size:13.5px;color:var(--fg-dim);line-height:1.6">${escapeHtml(message)}</div>
      <footer style="padding:12px 16px;display:flex;gap:10px;justify-content:flex-end">
        <button id="cmCancel" class="sp-btn ghost" style="width:auto;padding:8px 18px">${t('cancel')}</button>
        <button id="cmOk" class="sp-btn" style="width:auto;padding:8px 18px;background:#e5484d">${t('ok')}</button>
      </footer>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    $('#cmOk', modal).onclick = () => { overlay.remove(); resolve(true); };
    $('#cmCancel', modal).onclick = () => { overlay.remove(); resolve(false); };
  });
}

/* ============ 整理排列 ============ */
function arrangeNotes() {
  const cols = Math.max(1, Math.floor(($('#canvas').clientWidth - 40) / 260));
  const sorted = getSortedNotes(state.notes.filter((n) => !n.desktopPin));
  sorted.forEach((n, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    n.x = 20 + col * 260;
    n.y = 20 + row * 230;
  });
  save();
  renderAll();
}

/* ============ 备份 ============ */
async function chooseBackupDir() {
  const r = await window.api.chooseDirectory();
  if (r.ok) {
    state.settings.backupDir = r.path;
    const el = $('#backupDir');
    if (el) el.value = r.path;
    save();
  }
}

async function backupNow() {
  const r = await window.api.backupExport(
    { settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash },
    state.settings.backupDir || null
  );
  if (r.ok) toast(t('toast_backup_ok') + r.path);
  else toast(t('toast_backup_fail') + r.error);
}

async function openBackupDir() {
  await window.api.openPath(state.settings.backupDir || null);
}

function switchTab(name) {
  $$('.sp-nav-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.sp-tab').forEach((s) => s.classList.toggle('hidden', s.dataset.tab !== name));
  if (name === 'appearance') { syncSettingsInputs(); renderThemePanel(); }
  if (name === 'font') { renderFontSelect(); renderFontList(); syncSettingsInputs(); }
  if (name === 'sort') renderSortPanel();
  if (name === 'backup') { const el = $('#backupDir'); if (el) el.value = state.settings.backupDir || ''; }
  if (name === 'trash') renderTrashPanel();
}

/* ============ 事件绑定 ============ */
function bindUI() {
  $('#btnAdd').onclick = () => {
    if (state.settings.viewMode === 'todo') {
      const n = createEmptyTodoNote();
      openReminder(n);
      toast(t('toast_todo_created'));
    } else {
      createNote();
    }
  };
  $('#btnQuickArrange').onclick = () => {
    arrangeNotes();
    toast(t('toast_arranged'));
  };

  $('#viewBoard').onclick = () => setViewMode('board');
  $('#viewMemo').onclick = () => setViewMode('memo');
  $('#viewTodo').onclick = () => setViewMode('todo');

  $('#btnMin').onclick = () => window.api.minimize();
  $('#btnMax').onclick = () => window.api.maximize();
  $('#btnClose').onclick = () => window.api.hide();
  $('#btnPin').onclick = () => {
    state.settings.alwaysOnTop = !state.settings.alwaysOnTop;
    applyTheme();
    save();
  };

  $('#btnSettings').onclick = () => {
    switchTab('appearance');
    $('#settingsOverlay').classList.remove('hidden');
  };
  $('#btnCloseSettings').onclick = () => $('#settingsOverlay').classList.add('hidden');
  $('#settingsOverlay').onclick = (e) => { if (e.target.id === 'settingsOverlay') $('#settingsOverlay').classList.add('hidden'); };

  $('#btnChangelog').onclick = openChangelog;
  $('#btnChangelogClose').onclick = closeChangelog;
  $('#changelogOverlay').onclick = (e) => { if (e.target.id === 'changelogOverlay') closeChangelog(); };

  $$('.sp-nav-item').forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });

  $$('#modeSeg .seg').forEach((b) => {
    b.onclick = () => {
      state.settings.appearanceMode = b.dataset.mode;
      applyTheme();
      syncModeSeg();
      save();
    };
  });

  $('#btnAddFont').onclick = addCustomFont;
  $('#btnResetFontColor').onclick = () => {
    state.settings.noteTextColor = null;
    syncSettingsInputs();
    applyTheme();
    renderAll();
    save();
    toast(t('font_color_follow'));
  };
  $('#languageSelect').addEventListener('change', (e) => {
    state.settings.language = e.target.value;
    save();
    applyLanguage();
    applyTheme();
    toast(state.settings.language === 'en' ? 'Language switched' : '已切换语言');
  });

  $('#sortMode').addEventListener('change', (e) => {
    state.settings.sortMode = e.target.value;
    save();
    renderSortPanel();
    renderAll();
  });
  $('#trashDays').addEventListener('change', (e) => {
    state.settings.recycleBinDays = Number(e.target.value);
    save();
    renderTrashPanel();
  });
  $('#btnEmptyTrash').onclick = async () => {
    const ok = await confirmModal(t('confirm_empty_trash_title'), t('confirm_empty_trash_msg'));
    if (ok) emptyTrash();
  };

  $('#btnChooseDir').onclick = chooseBackupDir;
  $('#btnOpenDir').onclick = openBackupDir;
  $('#btnBackupNow').onclick = backupNow;

  $('#backupDir').addEventListener('change', (e) => {
    state.settings.backupDir = e.target.value.trim() || null;
    save();
  });

  $('#btnExport').onclick = async () => {
    const r = await window.api.exportData({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash });
    if (r.ok) toast(t('toast_exported') + r.path);
    else if (!r.canceled) toast(t('toast_export_fail') + r.error);
  };
  $('#btnImport').onclick = async () => {
    const r = await window.api.importData();
    if (r.ok) {
      const ok = await confirmModal(t('confirm_import_title'), t('confirm_import_msg'));
      if (ok) {
        state.settings = { ...DEFAULT_SETTINGS, ...(r.data.settings || {}) };
        state.groups = r.data.groups || [];
        state.notes = r.data.notes || [];
        state.trash = r.data.trash || [];
        state.notes.forEach((n) => { if (!n.id) n.id = uid(); if (!n.items) n.items = []; });
        ensureOrder();
        save();
        applyTheme();
        applyCustomFonts();
        syncSettingsInputs();
        renderThemePanel();
        renderGroupChips();
        renderAll();
        applyLanguage();
        switchTab('appearance');
        toast(t('toast_imported'));
      }
    } else if (!r.canceled) toast(t('toast_import_fail') + r.error);
  };

  $('#btnArrange').onclick = () => { arrangeNotes(); toast(t('toast_arranged_menu')); };
  $('#btnClearAll').onclick = async () => {
    const ok = await confirmModal(t('confirm_clear_all_title'), t('confirm_clear_all_msg'));
    if (ok) {
      state.notes.forEach((n) => { if (n.desktopPin) window.api.unpinFromDesktop(n.id); n.desktopPin = false; });
      state.trash.push(...state.notes.map((n) => ({ note: n, deletedAt: Date.now() })));
      state.notes = [];
      save();
      renderAll();
      renderTrashPanel();
      toast(t('toast_moved_trash'));
    }
  };

  $('#btnAddGroup').onclick = () => {
    promptModal(t('new_group'), t('group_name'), '').then((name) => {
      if (name && name.trim()) {
        createGroup(name.trim());
        toast(t('toast_group_created'));
      }
    });
  };

  $$('#filterbar .chip[data-group]').forEach((c) => {
    c.onclick = () => setFilter('group', c.dataset.group);
  });

  const search = $('#searchInput');
  search.addEventListener('input', () => {
    filter.query = search.value;
    $('#searchClear').classList.toggle('hidden', !search.value);
    renderAll();
  });
  $('#searchClear').onclick = () => { search.value = ''; filter.query = ''; $('#searchClear').classList.add('hidden'); renderAll(); };

  const canvas = $('#canvas');
  canvas.addEventListener('dblclick', (e) => {
    if (state.settings.viewMode === 'todo') return;
    if (state.settings.viewMode === 'memo') {
      const memoList = $('#memoList');
      if (e.target === memoList || e.target === canvas) {
        createNote();
      }
    } else {
      const board = $('#board');
      if (e.target === board || e.target === canvas) {
        const rect = board.getBoundingClientRect();
        createNote(Math.round(e.clientX - rect.left), Math.round(e.clientY - rect.top));
      }
    }
  });

  // 外观输入
  $('#noteOpacity').addEventListener('input', (e) => { state.settings.noteOpacity = Number(e.target.value); applyTheme(); });
  $('#noteOpacity').addEventListener('change', save);
  $('#winOpacity').addEventListener('input', (e) => { state.settings.winOpacity = Number(e.target.value); applyTheme(); });
  $('#winOpacity').addEventListener('change', save);
  $('#fontSize').addEventListener('input', (e) => { state.settings.fontSize = Number(e.target.value); applyTheme(); });
  $('#fontSize').addEventListener('change', save);
  $('#fontFamily').addEventListener('change', (e) => { state.settings.fontFamily = e.target.value; applyTheme(); save(); });
  $('#noteTextColor').addEventListener('input', (e) => { state.settings.noteTextColor = e.target.value; applyTheme(); renderAll(); });
  $('#noteTextColor').addEventListener('change', save);
  $('#customAccent').addEventListener('input', (e) => { state.settings.accent = e.target.value; applyTheme(); renderThemePanel(); });
  $('#customAccent').addEventListener('change', save);
  $('#canvasColor').addEventListener('input', (e) => { state.settings.canvasColor = e.target.value; applyTheme(); });
  $('#canvasColor').addEventListener('change', save);
  $('#backgroundMode').addEventListener('change', (e) => { state.settings.backgroundMode = e.target.value; applyBackground(); save(); });
  $('#bgOpacity').addEventListener('input', (e) => { state.settings.bgOpacity = Number(e.target.value); applyBackground(); });
  $('#bgOpacity').addEventListener('change', save);
  $('#topBarOpacity').addEventListener('input', (e) => { state.settings.topBarOpacity = Number(e.target.value); applyBackground(); });
  $('#topBarOpacity').addEventListener('change', save);
  $('#topBarColor').addEventListener('input', (e) => { state.settings.topBarColor = e.target.value; applyBackground(); });
  $('#topBarColor').addEventListener('change', save);

  $('#todoSearchColor').addEventListener('input', (e) => { state.settings.todoSearchColor = e.target.value; applyTodoStyle(); });
  $('#todoSearchColor').addEventListener('change', save);
  $('#todoSearchOpacity').addEventListener('input', (e) => { state.settings.todoSearchOpacity = Number(e.target.value); applyTodoStyle(); });
  $('#todoSearchOpacity').addEventListener('change', save);
  $('#todoItemsColor').addEventListener('input', (e) => { state.settings.todoItemsColor = e.target.value; applyTodoStyle(); });
  $('#todoItemsColor').addEventListener('change', save);
  $('#todoItemsOpacity').addEventListener('input', (e) => { state.settings.todoItemsOpacity = Number(e.target.value); applyTodoStyle(); });
  $('#todoItemsOpacity').addEventListener('change', save);
  $('#todoRemindColor').addEventListener('input', (e) => { state.settings.todoRemindColor = e.target.value; applyTodoStyle(); });
  $('#todoRemindColor').addEventListener('change', save);
  $('#todoRemindOpacity').addEventListener('input', (e) => { state.settings.todoRemindOpacity = Number(e.target.value); applyTodoStyle(); });
  $('#todoRemindOpacity').addEventListener('change', save);
  $('#btnResetTodoArea').onclick = () => {
    state.settings.todoSearchColor = null;
    state.settings.todoItemsColor = null;
    state.settings.todoRemindColor = null;
    state.settings.todoSearchOpacity = 100;
    state.settings.todoItemsOpacity = 100;
    state.settings.todoRemindOpacity = 100;
    syncSettingsInputs();
    applyTodoStyle();
    save();
    toast(t('toast_todo_reset'));
  };

  $('#btnPickImage').onclick = async () => {
    const r = await window.api.pickImage();
    if (r.ok) {
      state.settings.backgroundImage = r.url;
      applyBackground();
      save();
      toast(t('toast_bg_set'));
    } else if (!r.canceled) {
      toast(t('toast_set_fail') + r.error);
    }
  };
  $('#btnClearImage').onclick = () => {
    state.settings.backgroundImage = null;
    applyBackground();
    save();
    toast(t('toast_bg_cleared'));
  };
  $('#btnResetTheme').onclick = () => {
    state.settings = { ...DEFAULT_SETTINGS };
    syncSettingsInputs();
    renderThemePanel();
    applyTheme();
    save();
    toast(t('toast_reset'));
  };

  // 待办提醒弹窗
  $('#btnReminderCancel').onclick = closeReminder;
  $('#reminderOverlay').onclick = (e) => { if (e.target.id === 'reminderOverlay') closeReminder(); };
  $('#btnReminderSave').onclick = () => {
    const val = $('#reminderInput').value;
    const n = state.notes.find((x) => x.id === reminderNoteId);
    if (n && val) {
      n.reminder = { enabled: true, time: new Date(val).toISOString(), fired: false };
      n.updatedAt = Date.now();
      save();
      renderAll();
      toast(t('toast_todo_set'));
    }
    closeReminder();
  };
}

/* ============ 提示气泡 ============ */
let activeTipEl = null;
let tipTimer = null;
let tipEl = null;

function initTooltips() {
  tipEl = document.createElement('div');
  tipEl.id = 'tooltip';
  document.body.appendChild(tipEl);

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[title]');
    if (el && el !== activeTipEl) {
      restoreTipEl();
      const text = el.getAttribute('title');
      if (text && text.trim()) {
        activeTipEl = el;
        el.setAttribute('data-tip-text', text);
        el.removeAttribute('title');
        showTooltip(el, text);
      }
    }
  });

  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest('[title], [data-tip-text]');
    if (el && el === activeTipEl) {
      if (e.relatedTarget && el.contains(e.relatedTarget)) return;
      restoreTipEl();
      hideTooltip();
    }
  });

  document.addEventListener('mousedown', hideTooltip);
  $('#canvas').addEventListener('scroll', hideTooltip);
  window.addEventListener('blur', hideTooltip);
}

function showTooltip(el, text) {
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => {
    if (!activeTipEl) return;
    tipEl.textContent = text;
    tipEl.classList.add('visible');
    positionTooltip(el);
  }, 350);
}

function positionTooltip(el) {
  const r = el.getBoundingClientRect();
  const tw = tipEl.offsetWidth;
  const th = tipEl.offsetHeight;
  let left = r.left + r.width / 2;
  let top = r.bottom + 8;
  if (top + th > window.innerHeight - 4) top = r.top - th - 8;
  if (left - tw / 2 < 4) left = tw / 2 + 4;
  if (left + tw / 2 > window.innerWidth - 4) left = window.innerWidth - tw / 2 - 4;
  tipEl.style.left = left + 'px';
  tipEl.style.top = top + 'px';
}

function hideTooltip() {
  clearTimeout(tipTimer);
  if (tipEl) tipEl.classList.remove('visible');
}

function restoreTipEl() {
  if (activeTipEl) {
    if (activeTipEl.hasAttribute('data-tip-text')) {
      activeTipEl.setAttribute('title', activeTipEl.getAttribute('data-tip-text'));
      activeTipEl.removeAttribute('data-tip-text');
    }
    activeTipEl = null;
  }
}

/* ============ 初始化 ============ */
async function init() {
  bindUI();
  initTooltips();

  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.note-img-item')) {
      $$('.note-img-item.selected').forEach((x) => x.classList.remove('selected'));
    }
  });

  const data = await window.api.loadData();
  if (data) {
    state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    state.groups = data.groups || [];
    state.notes = data.notes || [];
    state.trash = data.trash || [];
    state.notes.forEach((n) => {
      if (!n.id) n.id = uid();
      if (!n.items) n.items = [];
      if (!n.images) n.images = [];
    });
    state.trash.forEach((t) => { if (t.note && !t.note.id) t.note.id = uid(); });
  }

  ensureOrder();
  purgeTrash();
  applyCustomFonts();
  applyTheme();
  applyLanguage();

  if (!state.settings.lastSeenVersion || state.settings.lastSeenVersion !== APP_VERSION) {
    state.settings.lastSeenVersion = APP_VERSION;
    save();
    openChangelog();
  }

  syncSettingsInputs();
  renderThemePanel();
  renderGroupChips();
  renderAll();
  $('#viewBoard').classList.toggle('active', state.settings.viewMode !== 'memo' && state.settings.viewMode !== 'todo');
  $('#viewMemo').classList.toggle('active', state.settings.viewMode === 'memo');
  $('#viewTodo').classList.toggle('active', state.settings.viewMode === 'todo');

  setInterval(() => purgeTrash(), 60 * 60 * 1000);

  window.api.onCreateNote(() => {
    if (state.settings.viewMode === 'todo') {
      const n = createEmptyTodoNote();
      openReminder(n);
    } else {
      createNote();
    }
  });

  window.api.onAlwaysOnTop((flag) => {
    state.settings.alwaysOnTop = flag;
    const pinBtn = $('#btnPin');
    if (pinBtn) pinBtn.classList.toggle('active', !!flag);
  });

  window.api.onMaximized((flag) => {
    const btn = $('#btnMax');
    if (btn) btn.title = flag ? t('restore') : t('maximize');
    document.body.classList.toggle('maximized', !!flag);
  });

  window.api.onReminderFired((id) => {
    const n = state.notes.find((x) => x.id === id);
    if (n && n.reminder) {
      n.reminder.fired = true;
      save();
      renderAll();
      toast(t('toast_reminder') + (n.title || t('app_name')));
      const el = document.querySelector('[data-id="' + id + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  window.api.onNoteChanged((note) => {
    state.notes = state.notes.map((n) => (n.id === note.id ? note : n));
  });

  window.api.onNoteUnpinned((id) => {
    const n = state.notes.find((x) => x.id === id);
    if (n) {
      n.desktopPin = false;
      save();
      renderAll();
    }
  });

  window.addEventListener('beforeunload', () => {
    window.api.saveData({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash });
  });
}

init();
