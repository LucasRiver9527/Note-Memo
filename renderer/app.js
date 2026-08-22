/* ============ 便签 - 渲染进程逻辑 ============ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const NOTE_COLORS = ['#000000', '#1e1e28', '#2d2f38', '#24344d', '#3a2a4d', '#1f3d33', '#4d2a2a', '#f7d65a', '#ffb3c1', '#a8e6cf', '#a0d8ff', '#d0b3ff', '#ffd8a8', '#f5a97f', '#e6c9ff'];
const ACCENTS = ['#6c5ce7', '#e84393', '#00b894', '#0984e3', '#e17055', '#fdcb6e', '#00cec9', '#d63031', '#2ecc71', '#5b8cff'];
const HIGHLIGHT_COLORS = ['#fff59d', '#ffd54f', '#ffb3c1', '#a8e6cf', '#a0d8ff', '#d0b3ff', '#ffd8a8', '#ff8a80', '#b2ff59', '#80d8ff'];

const PRESETS = [
  { id: 'mint', name: '薄荷', en: 'Mint', light: true, bg: '#eafaf1', accent: '#00b894', mini: ['#00b894', '#a8e6cf'] },
  { id: 'dark', name: '深夜', en: 'Midnight', light: false, bg: '#1e1f26', accent: '#6c5ce7', mini: ['#6c5ce7', '#f7d65a'] },
  { id: 'light', name: '纯净', en: 'Clean', light: true, bg: '#f4f5fa', accent: '#6c5ce7', mini: ['#6c5ce7', '#ffd8a8'] },
  { id: 'midnight', name: '午夜蓝', en: 'Navy', light: false, bg: '#131726', accent: '#5b8cff', mini: ['#5b8cff', '#00cec9'] },
  { id: 'forest', name: '森林', en: 'Forest', light: false, bg: '#152019', accent: '#2ecc71', mini: ['#2ecc71', '#a8e6cf'] },
  { id: 'sunset', name: '暮色', en: 'Sunset', light: false, bg: '#241820', accent: '#e84393', mini: ['#e84393', '#ffb3c1'] },
  { id: 'paper', name: '羊皮纸', en: 'Paper', light: true, bg: '#f3ecd9', accent: '#b8860b', mini: ['#b8860b', '#f7d65a'] },
  { id: 'ocean', name: '海洋', en: 'Ocean', light: false, bg: '#0e1f2f', accent: '#00bcd4', mini: ['#00bcd4', '#a0d8ff'] },
  { id: 'sakura', name: '樱花', en: 'Sakura', light: true, bg: '#fff0f3', accent: '#ff6b9d', mini: ['#ff6b9d', '#ffd8e6'] },
  { id: 'graphite', name: '石墨', en: 'Graphite', light: false, bg: '#202124', accent: '#9aa0a6', mini: ['#9aa0a6', '#5f6368'] },
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

const DEFAULT_THEME_ID = 'mint';
const DEFAULT_NOTE_COLOR = '#93f1ce';

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
  noteTextColor: null,
  viewMode: 'board',
  bgOpacity: 100,
  topBarColor: null,
  topBarOpacity: 100,
  topBarAcrylic: false,
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

/* ============ 国际化 ============ */
const I18N = {
  zh: {
    app_name: '便签',
    settings_title: '⚙ 全局设置',
    tab_appearance: '🎨 外观', tab_font: '🔤 字体', tab_sort: '↕ 排序', tab_backup: '⬇ 备份', tab_trash: '🗑 回收站', tab_data: '📦 数据',
    mode: '模式', mode_auto: '跟随主题', mode_light: '普通（浅色）', mode_dark: '夜间（深色）',
    theme: '主题', accent: '强调色', custom: '自定义',
    note_appearance: '便签外观', note_opacity: '便签不透明度', win_opacity: '窗口不透明度', note_bg: '新建便签底色',
    canvas_bg: '画布背景', bg_color: '背景色', bg_image: '背景图片', bg_fill: '填充', bg_fit: '适应', bg_stretch: '拉伸', bg_tile: '平铺', bg_center: '居中',
    pick_image: '选择图片…', clear_image: '清除图片',
    topbar_bg: '顶栏与背景', topbar_color: '顶栏底色', topbar_opacity: '顶栏透明度', bg_opacity: '背景图片透明度', topbar_acrylic: '顶栏亚克力模糊',
    todo_area: '待办区', todo_area_hint: '待办区各区域底色默认跟随主题，可自定义颜色与透明度。',
    search_bg: '搜索框底色', search_opacity: '搜索框透明度', items_bg: '待办事项底色', items_opacity: '待办事项透明度', remind_bg: '时间待办底色', remind_opacity: '时间待办透明度',
    reset_todo: '恢复待办区默认（跟随主题）', reset_theme: '恢复默认外观', default_theme: '恢复默认主题', reset_note_bg: '恢复默认便签底色',
    effects: '效果', glass: '便签玻璃拟态', effects_hint: '开启后便签呈现半透明磨砂质感，默认关闭。',
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
    toast_theme_deleted: '主题已删除', toast_theme_updated: '主题已更新', toast_theme_created: '主题已创建', toast_note_bg_reset: '已恢复默认便签底色',
    toast_bg_set: '背景图片已设置', toast_bg_cleared: '已清除背景图片', toast_reset: '已恢复默认外观',
    toast_todo_set: '待办已设置', toast_todo_added: '已添加待办', toast_todo_created: '已新建待办，可设置待办时间',
    toast_reminder: '待办提醒：', toast_arranged: '已一键整理', toast_arranged_menu: '已整理排列', toast_moved_trash: '已移入回收站',
    toast_todo_reset: '待办区已恢复跟随主题', toast_img_pasted: '图片已粘贴', toast_img_copied: '图片已复制', toast_img_saved_fail: '图片保存失败：',
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
    about: '关于', changelog_title: '更新说明', changelog_open: '✨ 查看更新说明', got_it: '知道了',
    tab_reminder: '⏰ 提醒', tab_about: 'ℹ️ 关于',
    module_main: '主程序外观', module_note: '便签外观',
    desktop_mica: '桌面便签玻璃拟态', desktop_mica_hint: '钉在桌面的便签使用与应用内一致的半透明磨砂玻璃效果。',
    markdown_title: 'Markdown 格式', markdown_enable: '启用加粗 / 高亮', highlight_color: '高亮颜色',
    markdown_hint: '编辑时可用 Ctrl+B 加粗、Ctrl+H 高亮，或输入 **加粗** 与 ==高亮==。',
    doc_view: '文档模式', doc_pick_hint: '选择一个便签以文档方式查看/编辑', doc_back: '← 返回', doc_hint: '支持 Markdown 加粗/高亮、图片与文件链接',
    bold: '加粗', highlight: '高亮', unbold: '取消加粗', unhighlight: '取消高亮',
    insert_table: '插入表格', table_rows: '行数', table_cols: '列数',
    add_row: '添加行', add_col: '添加列', del_row: '删除行', del_col: '删除列',
    merge_cells: '合并单元格', split_cell: '拆分单元格', diag_line: '斜分线', del_table: '删除表格',
    table_settings: '表格设置', tbl_border_color: '边框颜色', tbl_border_width: '边框粗细',
    diag_tlbr: '左上→右下', diag_trbl: '右上→左下', diag_t1: '上文字', diag_t2: '下文字', diag_remove: '移除斜线', unpin_note: '取消置顶',
    diag_t_color: '文字颜色', diag_t_size: '文字大小', tbl_text_color: '文字颜色', tbl_text_size: '文字大小',
    reminder_sound_title: '闹铃声音', reminder_sound_enable: '开启闹铃声音',
    reminder_sound_hint: '默认关闭。开启后待办提醒到点将播放声音（到点前 15 分钟会阻止系统休眠以确保准时）。',
    reminder_volume: '闹铃音量', custom_sound: '自定义声音', pick_sound: '选择声音文件', clear_sound: '清除自定义',
    default_sound: '默认：系统提示音（内置）', test_sound: '▶ 试听',
    about_info: '软件信息', about_author: '作者', about_license: '协议',
    about_desc: '美观可定制的 Windows 桌面便签。',
    toast_sound_set: '已设置闹铃声音', toast_sound_cleared: '已恢复默认提示音', toast_about: '已保存',
    alarm_title: '闹铃提醒', alarm_dismiss: '关闭闹铃'
  },
  en: {
    app_name: 'Notes',
    settings_title: '⚙ Global Settings',
    tab_appearance: '🎨 Appearance', tab_font: '🔤 Font', tab_sort: '↕ Sort', tab_backup: '⬇ Backup', tab_trash: '🗑 Recycle Bin', tab_data: '📦 Data',
    mode: 'Mode', mode_auto: 'Follow theme', mode_light: 'Light', mode_dark: 'Dark',
    theme: 'Theme', accent: 'Accent', custom: 'Custom',
    note_appearance: 'Note appearance', note_opacity: 'Note opacity', win_opacity: 'Window opacity', note_bg: 'New note background',
    canvas_bg: 'Canvas background', bg_color: 'Background color', bg_image: 'Background image', bg_fill: 'Fill', bg_fit: 'Fit', bg_stretch: 'Stretch', bg_tile: 'Tile', bg_center: 'Center',
    pick_image: 'Choose image…', clear_image: 'Clear image',
    topbar_bg: 'Title bar & background', topbar_color: 'Title bar color', topbar_opacity: 'Title bar opacity', bg_opacity: 'Background image opacity', topbar_acrylic: 'Title bar acrylic blur',
    todo_area: 'Todo area', todo_area_hint: 'Todo area backgrounds follow the theme by default; you can customize color and opacity.',
    search_bg: 'Search box bg', search_opacity: 'Search box opacity', items_bg: 'Todo items bg', items_opacity: 'Todo items opacity', remind_bg: 'Reminders bg', remind_opacity: 'Reminders opacity',
    reset_todo: 'Reset todo area (follow theme)', reset_theme: 'Reset appearance', default_theme: 'Restore default theme', reset_note_bg: 'Restore default note background',
    effects: 'Effects', glass: 'Note glassmorphism', effects_hint: 'Makes notes semi-transparent frosted; off by default.',
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
    toast_theme_deleted: 'Theme deleted', toast_theme_updated: 'Theme updated', toast_theme_created: 'Theme created', toast_note_bg_reset: 'Default note background restored',
    toast_bg_set: 'Background image set', toast_bg_cleared: 'Background image cleared', toast_reset: 'Appearance reset',
    toast_todo_set: 'Todo set', toast_todo_added: 'Todo added', toast_todo_created: 'Todo created, set a time',
    toast_reminder: 'Reminder: ', toast_arranged: 'Arranged', toast_arranged_menu: 'Arranged', toast_moved_trash: 'Moved to recycle bin',
    toast_todo_reset: 'Todo area follows theme again', toast_img_pasted: 'Image pasted', toast_img_copied: 'Image copied', toast_img_saved_fail: 'Failed to save image: ',
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
    about: 'About', changelog_title: "What's New", changelog_open: '✨ View changelog', got_it: 'Got it',
    tab_reminder: '⏰ Reminders', tab_about: 'ℹ️ About',
    module_main: 'App appearance', module_note: 'Note appearance',
    desktop_mica: 'Desktop note glass', desktop_mica_hint: 'Use the same semi-transparent frosted glass effect for desktop-pinned notes.',
    markdown_title: 'Markdown', markdown_enable: 'Enable bold / highlight', highlight_color: 'Highlight color',
    markdown_hint: 'Use Ctrl+B for bold and Ctrl+H for highlight while editing, or type **bold** and ==highlight==.',
    doc_view: 'Document view', doc_pick_hint: 'Pick a note to view/edit as a document', doc_back: '← Back', doc_hint: 'Supports Markdown bold/highlight, images and file links',
    bold: 'Bold', highlight: 'Highlight', unbold: 'Unbold', unhighlight: 'Remove highlight',
    insert_table: 'Insert table', table_rows: 'Rows', table_cols: 'Cols',
    add_row: 'Add row', add_col: 'Add col', del_row: 'Delete row', del_col: 'Delete col',
    merge_cells: 'Merge cells', split_cell: 'Split cell', diag_line: 'Diagonal line', del_table: 'Delete table',
    table_settings: 'Table settings', tbl_border_color: 'Border color', tbl_border_width: 'Border width',
    diag_tlbr: 'TL→BR', diag_trbl: 'TR→BL', diag_t1: 'Top text', diag_t2: 'Bottom text', diag_remove: 'Remove', unpin_note: 'Unpin',
    diag_t_color: 'Text color', diag_t_size: 'Text size', tbl_text_color: 'Text color', tbl_text_size: 'Text size',
    reminder_sound_title: 'Alarm sound', reminder_sound_enable: 'Enable alarm sound',
    reminder_sound_hint: 'Off by default. When enabled, a sound plays when a reminder is due (the system is kept awake within 15 minutes before the due time).',
    reminder_volume: 'Alarm volume', custom_sound: 'Custom sound', pick_sound: 'Choose sound file', clear_sound: 'Clear custom',
    default_sound: 'Default: built-in beep', test_sound: '▶ Test',
    about_info: 'Information', about_author: 'Author', about_license: 'License',
    about_desc: 'A beautiful, customizable Windows desktop notes app.',
    toast_sound_set: 'Alarm sound set', toast_sound_cleared: 'Default beep restored', toast_about: 'Saved',
    alarm_title: 'Reminder', alarm_dismiss: 'Dismiss'
  }
};

function t(key) {
  const lang = (state && state.settings && state.settings.language) || 'zh';
  return (I18N[lang] && I18N[lang][key]) || I18N.zh[key] || key;
}

const CHANGELOG = [
  { zh: '「贴靠」：窗口拖到屏幕边缘自动调整大小（顶部最大化、左右半屏、四角四分屏）', en: 'Snap windows to screen edges (maximize / half / quarter)' },
  { zh: '便签钉桌面支持 Windows 亚克力玻璃模糊', en: 'Acrylic blur for desktop-pinned notes' },
  { zh: '顶栏亚克力模糊，可自定义顶栏底色与透明度', en: 'Title bar acrylic blur with custom color & opacity' },
  { zh: '右上角最小化 / 最大化 / 关闭按钮与顶栏样式统一', en: 'Window control buttons unified with the title bar' },
  { zh: '外观设置分模块（便签外观 / 主程序外观），12 套主题，薄荷默认置顶', en: 'Modular appearance settings, 12 themes, Mint by default' },
  { zh: '恢复默认外观与默认主题一致；图表按钮高对比优化', en: 'Reset appearance matches the default theme; high-contrast buttons' },
  { zh: '图片按光标插入位置放置，支持拖入文件 / 文件夹快捷打开', en: 'Insert images at the cursor; paste file/folder paths to open quickly' },
  { zh: '支持 Markdown 加粗 / 高亮（Ctrl+B / Ctrl+H）', en: 'Markdown bold / highlight (Ctrl+B / Ctrl+H)' },
  { zh: '编辑时 Ctrl+滚轮快捷调整字体大小', en: 'Ctrl+scroll to adjust font size while editing' },
  { zh: '新增「文档」视图，像文档一样查看与编辑便签', en: 'New Document view to read & edit notes like a document' },
  { zh: '备忘录可拖动调整顺序；待办区集中管理', en: 'Reorder memos by drag; centralized todo area' },
  { zh: '全新表格：插入 / 合并 / 拆分单元格，自定义边框、文字颜色与大小，斜线表头，双击编辑并可换行', en: 'New table: merge/split cells, borders & text styling, diagonal header, edit cells with line breaks' },
  { zh: '待办提醒闹铃声音，可自定义声音与音量，待机也保证提醒', en: 'Reminder alarm sound, custom file & volume, works in standby' },
  { zh: '新增「关于」页面：版本、作者、更新说明', en: 'New About page: version, author, changelog' }
];

const APP_VERSION = '1.2.0';

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
let docNoteId = null;
let savedRange = null;
let savedSelText = '';
let savedNoteId = null;
let savedImageSrc = null;
let copiedImage = null;

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

function defaultNoteColor() {
  return state.settings.noteColor || DEFAULT_NOTE_COLOR;
}

function getTheme() {
  const id = state.settings.themeId;
  return PRESETS.find((p) => p.id === id)
    || (state.settings.customThemes || []).find((t) => t.id === id)
    || PRESETS.find((p) => p.id === DEFAULT_THEME_ID) || PRESETS[0];
}

function isLightTheme() {
  const mode = state.settings.appearanceMode || 'auto';
  if (mode === 'light') return true;
  if (mode === 'dark') return false;
  return getTheme().light;
}

function currentBg() {
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
  return bg;
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

function highlightColor() {
  return state.settings.highlightColor || '#fff59d';
}

function formatInlineText(text) {
  const s = state.settings;
  const mdOn = s.markdown !== false;
  const urlRe = /^(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/i;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    let handled = false;
    const cm = rest.match(/^\[\[c:([^\]]+)\]\]/);
    if (cm) {
      const closeIdx = text.indexOf('[[/c]]', i + cm[0].length);
      if (closeIdx >= 0) {
        const inner = text.slice(i + cm[0].length, closeIdx);
        out += '<span style="color:' + cm[1] + '">' + formatInlineText(inner) + '</span>';
        i = closeIdx + 6;
        handled = true;
      }
    }
    if (!handled && mdOn) {
      let m = rest.match(/^==([^=\n]+)==/);
      if (m) {
        out += '<mark class="hl">' + escapeHtml(m[1]) + '</mark>';
        i += m[0].length; handled = true;
      } else {
        m = rest.match(/^\*\*([^*\n]+)\*\*/);
        if (m) {
          out += '<b>' + escapeHtml(m[1]) + '</b>';
          i += m[0].length; handled = true;
        }
      }
    }
    if (!handled) {
      const um = rest.match(urlRe);
      if (um) {
        const url = um[0];
        const href = /^www\./i.test(url) ? 'http://' + url : url;
        out += `<a class="note-link" contenteditable="false" data-url="${escapeHtml(href)}" title="${t('open_link')}">${escapeHtml(url)}</a>`;
        i += url.length;
      } else {
        out += escapeHtml(text[i]);
        i += 1;
      }
    }
  }
  return out;
}

function inlineImgHtml(img) {
  return `<span class="inline-img" data-img-id="${img.id}" contenteditable="false" tabindex="0"><img src="${escapeHtml(img.src)}" style="width:${img.w || 200}px" /><button class="img-del" title="${t('delete_image')}">✕</button><div class="img-resize" title="${t('resize_image')}"></div></span>`;
}

function fileLinkHtml(f) {
  const name = (f.path || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  const icon = f.isDir ? '📁' : '📄';
  return `<span class="file-link" contenteditable="false" data-file-id="${f.id}" data-path="${escapeHtml(f.path)}" data-is-dir="${f.isDir ? '1' : '0'}" title="${escapeHtml(f.path)}">${icon} ${escapeHtml(name || f.path)}</span>`;
}

function tableBlockHtml(tbl) {
  const rows = tbl.rows, cols = tbl.cols;
  const cells = tbl.cells || [];
  const merges = tbl.merges || [];
  const diagonals = tbl.diagonals || [];
  const occupied = [];
  for (let r = 0; r < rows; r++) occupied.push(new Array(cols).fill(false));
  let html = '';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) {
      if (occupied[r][c]) continue;
      const mg = merges.find((m) => m.r === r && m.c === c);
      const diag = diagonals.find((d) => d.r === r && d.c === c);
      const text = (cells[r] && cells[r][c]) || '';
      let attrs = '';
      let inner = formatInlineText(text).replace(/\n/g, '<br>');
      if (mg) {
        attrs = ` rowspan="${mg.rowspan}" colspan="${mg.colspan}"`;
        for (let rr = r; rr < r + mg.rowspan; rr++)
          for (let cc = c; cc < c + mg.colspan; cc++)
            if (rr < rows && cc < cols) occupied[rr][cc] = true;
      }
      let diagCls = '';
      if (diag) {
        const isTrbl = diag.dir === 'trbl';
        diagCls = ' diag diag-' + (isTrbl ? 'trbl' : 'tlbr');
        const line = isTrbl ? '<line x1="0" y1="100" x2="100" y2="0"/>' : '<line x1="0" y1="0" x2="100" y2="100"/>';
        const ds = (diag.tColor ? 'color:' + diag.tColor + ';' : '') + (diag.tSize ? 'font-size:' + diag.tSize + 'px;' : '');
        inner = `<svg class="diag-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${line}</svg><span class="tbl-t1"${ds ? ' style="' + ds + '"' : ''}>${formatInlineText(diag.t1 || '').replace(/\n/g, '<br>')}</span><span class="tbl-t2"${ds ? ' style="' + ds + '"' : ''}>${formatInlineText(diag.t2 || '').replace(/\n/g, '<br>')}</span>`;
      }
      html += `<td${attrs}${diagCls ? ' class="' + diagCls.trim() + '"' : ''} data-r="${r}" data-c="${c}">${inner}</td>`;
    }
    html += '</tr>';
  }
  const bw = tbl.borderWidth != null ? tbl.borderWidth : 3;
  const bc = tbl.borderColor || 'rgba(0,0,0,0.7)';
  const ts = (tbl.textColor ? 'color:' + tbl.textColor + ';' : '') + (tbl.fontSize ? 'font-size:' + tbl.fontSize + 'px;' : '');
  return `<div class="note-table-block" contenteditable="false" data-table-id="${tbl.id}" tabindex="0"><table class="note-table" style="--tbl-border-width:${bw}px;--tbl-border-color:${bc};${ts}">${html}</table></div>`;
}

function renderRichContent(text, n) {
  const imgMap = {};
  (n.images || []).forEach((im) => { imgMap[im.id] = im; });
  const fileMap = {};
  (n.files || []).forEach((f) => { fileMap[f.id] = f; });
  const tableMap = {};
  (n.tables || []).forEach((tb) => { tableMap[tb.id] = tb; });
  const re = /\[\[(img|file|table):([a-zA-Z0-9_-]+)\]\]/g;
  let out = '';
  let last = 0;
  let m;
  const s = String(text || '');
  while ((m = re.exec(s)) !== null) {
    out += formatInlineText(s.slice(last, m.index));
    if (m[1] === 'img') {
      const im = imgMap[m[2]];
      if (im) out += inlineImgHtml(im);
    } else if (m[1] === 'file') {
      const f = fileMap[m[2]];
      if (f) out += fileLinkHtml(f);
    } else {
      const tb = tableMap[m[2]];
      if (tb) out += tableBlockHtml(tb);
    }
    last = m.index + m[0].length;
  }
  out += formatInlineText(s.slice(last));
  return out;
}

function readRichContent(root) {
  let out = '';
  (root.childNodes || []).forEach((node) => {
    if (node.nodeType === 3) {
      out += node.textContent;
    } else if (node.nodeType === 1) {
      const tag = node.tagName;
      if (node.classList && node.classList.contains('inline-img')) {
        out += '[[img:' + node.getAttribute('data-img-id') + ']]';
      } else if (node.classList && node.classList.contains('file-link')) {
        out += '[[file:' + node.getAttribute('data-file-id') + ']]';
      } else if (node.classList && node.classList.contains('note-table-block')) {
        out += '[[table:' + node.getAttribute('data-table-id') + ']]';
      } else if (tag === 'BR') {
        out += '\n';
      } else if (tag === 'B' || tag === 'STRONG') {
        out += '**' + readRichContent(node) + '**';
      } else if (tag === 'MARK') {
        out += '==' + readRichContent(node) + '==';
      } else if (tag === 'FONT' && node.getAttribute('color')) {
        out += '[[c:' + node.getAttribute('color') + ']]' + readRichContent(node) + '[[/c]]';
      } else if (tag === 'SPAN' && node.style) {
        const bg = node.style.backgroundColor;
        const fw = node.style.fontWeight;
        const color = node.style.color;
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
          out += '==' + readRichContent(node) + '==';
        } else if (color && color !== '' && color !== 'inherit') {
          out += '[[c:' + color + ']]' + readRichContent(node) + '[[/c]]';
        } else if (fw === 'bold' || Number(fw) >= 600) {
          out += '**' + readRichContent(node) + '**';
        } else {
          out += readRichContent(node);
        }
      } else {
        out += readRichContent(node);
      }
    }
  });
  return out;
}

function refIdsOf(n) {
  const ids = new Set();
  const re = /\[\[(?:img|file|table):([a-zA-Z0-9_-]+)\]\]/g;
  let m;
  const s = String(n.content || '');
  while ((m = re.exec(s)) !== null) ids.add(m[1]);
  return ids;
}

function cleanupRefs(n) {
  if (!n) return;
  const refs = refIdsOf(n);
  n.images = (n.images || []).filter((im) => refs.has(im.id));
  n.files = (n.files || []).filter((f) => refs.has(f.id));
  n.tables = (n.tables || []).filter((tb) => refs.has(tb.id));
}

function noteFontSize(n) {
  return n.fontSize || state.settings.fontSize || 14;
}

function adjustNoteFontSize(n, delta, apply) {
  const cur = noteFontSize(n);
  const next = Math.min(22, Math.max(11, cur + delta));
  if (next === cur) return;
  n.fontSize = next;
  n.updatedAt = Date.now();
  save();
  if (apply) apply(next);
}

/* ============ 选区捕获 / 恢复（右键菜单、图片插入用） ============ */
function captureSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    savedRange = sel.getRangeAt(0).cloneRange();
    savedSelText = sel.toString();
  } else {
    savedRange = null;
    savedSelText = '';
  }
}

function restoreSelection() {
  if (!savedRange) return false;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(savedRange);
  return true;
}

function clearSavedSelection() {
  savedRange = null;
  savedSelText = '';
  savedNoteId = null;
  savedImageSrc = null;
}

function focusNoteContent(n) {
  let c = document.querySelector('[data-id="' + n.id + '"] .note-content');
  if (!c && docNoteId === n.id) c = document.getElementById('docContent');
  return c;
}

function noteAnchor(n) {
  return document.querySelector('[data-id="' + n.id + '"]') || document.querySelector('.doc-editor') || document.body;
}

/* ============ 加粗 / 高亮 切换 ============ */
function selectionHasHighlight() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  const cn = range.commonAncestorContainer;
  const el = cn && (cn.nodeType === 1 ? cn : cn.parentElement);
  const scope = el && el.closest('.note-content, .dn-content, .doc-content');
  if (!scope) return false;
  const marks = scope.querySelectorAll('mark.hl, span[style*="background"], font[style*="background"]');
  for (const m of marks) {
    if (range.intersectsNode(m) || m.contains(range.startContainer) || m.contains(range.endContainer)) return true;
  }
  return false;
}

function removeHighlightFromSelection() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const cn = range.commonAncestorContainer;
  const el = cn && (cn.nodeType === 1 ? cn : cn.parentElement);
  const scope = el && el.closest('.note-content, .dn-content, .doc-content');
  if (!scope) return;
  const marks = Array.from(scope.querySelectorAll('mark.hl, span[style*="background"], font[style*="background"]'));
  marks.forEach((m) => {
    if (range.intersectsNode(m)) {
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    }
  });
}

function toggleBold(contentEl) {
  if (contentEl) contentEl.focus();
  document.execCommand('bold');
}

function toggleHighlight(contentEl) {
  if (contentEl) contentEl.focus();
  if (selectionHasHighlight()) {
    removeHighlightFromSelection();
    if (contentEl) contentEl.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    document.execCommand('hiliteColor', false, highlightColor());
  }
}

function setHighlightColor(color) {
  state.settings.highlightColor = color;
  const hc = $('#highlightColorInput');
  if (hc) hc.value = color;
  applyTheme();
  save();
}

function applyInlineColor(n, range, color) {
  const contentEl = focusNoteContent(n);
  if (!contentEl || !range) return;
  contentEl.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand('foreColor', false, color);
  n.content = readRichContent(contentEl);
  n.updatedAt = Date.now();
  save();
  renderAll();
}

function getSelectedImageSrc(n) {
  const sel = window.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed) {
    const frag = sel.getRangeAt(0).cloneContents();
    const img = frag.querySelector('.inline-img img');
    if (img) return img.getAttribute('src');
  }
  const el = document.querySelector('[data-id="' + n.id + '"] .inline-img.selected img');
  if (el) return el.getAttribute('src');
  return null;
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
    state.notes.forEach(cleanupRefs);
    window.api.saveData({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash });
  }, 300);
}

function saveNow() {
  clearTimeout(saveTimer);
  state.notes.forEach(cleanupRefs);
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
  const hl = s.highlightColor || '#fff59d';
  root.style.setProperty('--hl-color', hl);
  root.style.setProperty('--hl-fg', isDarkColor(hl) ? '#ffffff' : '#2d2f38');
  root.style.setProperty('--note-opacity', (s.noteOpacity / 100).toFixed(2));
  window.api.setNoteOpacity(s.noteOpacity);
  document.body.classList.toggle('glass', !!s.glass);
  window.api.setEffects({ glass: !!s.glass, highlightColor: hl, desktopMica: !!s.desktopMica });
  root.style.setProperty('--font-size', s.fontSize + 'px');
  root.style.setProperty('--font-family', resolveFontCss(s.fontFamily));
  root.style.setProperty('--titlebar-bg', bg);
  document.body.classList.toggle('topbar-acrylic', !!s.topBarAcrylic);
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

  const borderBase = s.topBarColor || currentBg();
  let borderAlpha = (s.topBarOpacity != null ? s.topBarOpacity : 100) / 100;
  if (s.topBarAcrylic) borderAlpha = 0.12 + borderAlpha * 0.88;
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
    const def = PRESETS.find((p) => p.id === DEFAULT_THEME_ID) || PRESETS[0];
    state.settings.themeId = def.id;
    state.settings.accent = def.accent;
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
  const nc = $('#noteColorInput'); if (nc) nc.value = state.settings.noteColor || DEFAULT_NOTE_COLOR;
  $('#fontSize').value = state.settings.fontSize;
  $('#fontFamily').value = state.settings.fontFamily;
  $('#canvasColor').value = state.settings.canvasColor || getTheme().bg;
  $('#backgroundMode').value = state.settings.backgroundMode || 'cover';
  $('#noteTextColor').value = state.settings.noteTextColor || (isLightTheme() ? '#2d2f38' : '#ececf1');
  $('#bgOpacity').value = state.settings.bgOpacity != null ? state.settings.bgOpacity : 100;
  $('#topBarOpacity').value = state.settings.topBarOpacity != null ? state.settings.topBarOpacity : 100;
  const ta = $('#topBarAcrylicToggle'); if (ta) ta.checked = !!state.settings.topBarAcrylic;
  $('#topBarColor').value = state.settings.topBarColor || (isLightTheme() ? '#ffffff' : '#000000');
  const soft = isLightTheme() ? '#e6e9f2' : '#2c2e3a';
  $('#todoSearchColor').value = state.settings.todoSearchColor || soft;
  $('#todoSearchOpacity').value = state.settings.todoSearchOpacity != null ? state.settings.todoSearchOpacity : 100;
  $('#todoItemsColor').value = state.settings.todoItemsColor || soft;
  $('#todoItemsOpacity').value = state.settings.todoItemsOpacity != null ? state.settings.todoItemsOpacity : 100;
  $('#todoRemindColor').value = state.settings.todoRemindColor || soft;
  $('#todoRemindOpacity').value = state.settings.todoRemindOpacity != null ? state.settings.todoRemindOpacity : 100;
  const gl = $('#glassToggle'); if (gl) gl.checked = !!state.settings.glass;
  const dm = $('#desktopMicaToggle'); if (dm) dm.checked = !!state.settings.desktopMica;
  const md = $('#markdownToggle'); if (md) md.checked = state.settings.markdown !== false;
  const hc = $('#highlightColorInput'); if (hc) hc.value = state.settings.highlightColor || '#fff59d';
  const rs = $('#reminderSoundToggle'); if (rs) rs.checked = !!state.settings.reminderSound;
  const rv = $('#reminderVolume'); if (rv) rv.value = state.settings.reminderVolume != null ? state.settings.reminderVolume : 70;
  const sn = $('#soundName'); if (sn) {
    if (state.settings.reminderSoundName) {
      sn.textContent = state.settings.reminderSoundName;
    } else {
      sn.textContent = t('default_sound');
    }
  }
  const av = $('#aboutVersion'); if (av) av.textContent = APP_VERSION;
  const cv = $('#clVersion'); if (cv) cv.textContent = 'v' + APP_VERSION;
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
    if (mode !== 'custom' && x.pinned !== y.pinned) return x.pinned ? -1 : 1;
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

function memoReorderAfter(fromId, afterId) {
  ensureOrder();
  state.settings.sortMode = 'custom';
  const order = state.settings.noteOrder;
  const fi = order.indexOf(fromId);
  if (fi < 0 || !afterId) return;
  const ai = order.indexOf(afterId);
  if (ai < 0) return;
  order.splice(fi, 1);
  const newAi = order.indexOf(afterId);
  order.splice(newAi + 1, 0, fromId);
  state.settings.noteOrder = order;
  save();
  renderAll();
}

function computeMemoGap(clientY) {
  const rows = $$('#memoList .memo-row');
  let g = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) { g = i; break; }
  }
  return g;
}

function clearMemoDropIndicator() {
  $$('#memoList .memo-row').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
}

function placeMemoAtGap(fromId, gap) {
  const ids = $$('#memoList .memo-row').map((r) => r.dataset.id);
  const fromPos = ids.indexOf(fromId);
  if (fromPos < 0) return;
  const rest = ids.filter((id) => id !== fromId);
  let g = gap;
  if (fromPos < gap) g -= 1;
  g = Math.max(0, Math.min(rest.length, g));
  if (g < rest.length) {
    memoReorder(fromId, rest[g]);
  } else if (rest.length > 0) {
    memoReorderAfter(fromId, rest[rest.length - 1]);
  }
}

function wireMemoListDnd() {
  const list = $('#memoList');
  if (!list) return;
  list.addEventListener('dragover', (e) => {
    if (!dragMemoId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const gap = computeMemoGap(e.clientY);
    const rows = $$('#memoList .memo-row');
    rows.forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    if (gap < rows.length) rows[gap].classList.add('drop-before');
    else if (rows.length) rows[rows.length - 1].classList.add('drop-after');
  });
  list.addEventListener('dragleave', (e) => {
    if (e.target === list) clearMemoDropIndicator();
  });
  list.addEventListener('drop', (e) => {
    if (!dragMemoId) return;
    e.preventDefault();
    const gap = computeMemoGap(e.clientY);
    clearMemoDropIndicator();
    placeMemoAtGap(dragMemoId, gap);
    dragMemoId = null;
  });
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
  const raw = n.type === 'todo'
    ? (n.items || []).map((i) => i.text).join(' ')
    : n.content || '';
  let txt = raw.replace(/\[\[(?:img|file|table):[a-zA-Z0-9_-]+\]\]/g, '').replace(/\[\[c:[^\]]+\]\]|\[\[\/c\]\]/g, '').trim();
  (n.tables || []).forEach((tb) => {
    (tb.cells || []).forEach((row) => {
      (row || []).forEach((c) => { if (c) txt += ' ' + c; });
    });
    (tb.diagonals || []).forEach((d) => { if (d.t1) txt += ' ' + d.t1; if (d.t2) txt += ' ' + d.t2; });
  });
  return txt;
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
  el.style.setProperty('--note-color', n.color);
  if (n.fontSize) el.style.setProperty('--note-font-size', n.fontSize + 'px');
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
    bodyHtml = `<div class="note-content" contenteditable="true" spellcheck="false" data-placeholder="${t('note_content')}">${renderRichContent(n.content, n)}</div>`;
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
        <button class="t-table" title="${t('insert_table')}">▦</button>
        <button class="t-remind" title="${t('todo_remind')}">⏰</button>
        <button class="t-color" title="${t('color')}">🎨</button>
        <button class="t-del" title="${t('delete')}">🗑</button>
      </div>
    </div>
    <div class="note-body">${bodyHtml}</div>
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
  if (n.fontSize) el.style.setProperty('--note-font-size', n.fontSize + 'px');

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
    bodyHtml = `<div class="note-content" contenteditable="true" spellcheck="false" data-placeholder="${t('note_content')}">${renderRichContent(n.content, n)}</div>`;
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
          <button class="t-table" title="${t('insert_table')}">▦</button>
          <button class="t-remind" title="${t('todo_remind')}">⏰</button>
          <button class="t-color" title="${t('color')}">🎨</button>
          <button class="t-del" title="${t('delete')}">🗑</button>
        </div>
      </div>
      <div class="memo-body">${bodyHtml}</div>
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
        return;
      }
      const fl = e.target.closest('.file-link');
      if (fl) {
        e.stopPropagation();
        window.api.openFilePath(fl.getAttribute('data-path'), fl.getAttribute('data-is-dir') === '1');
        return;
      }
      const ii = e.target.closest('.inline-img');
      if (ii && !e.target.closest('.img-resize') && !e.target.closest('.img-del')) {
        $$('.inline-img', el).forEach((x) => x.classList.remove('selected'));
        ii.classList.add('selected');
      }
    });
    content.addEventListener('input', () => { n.content = readRichContent(content); n.updatedAt = Date.now(); save(); });
    content.addEventListener('paste', async (e) => {
      e.preventDefault();
      if (copiedImage) {
        insertImageReferenceAtCursor(n, copiedImage.src, copiedImage.w);
        return;
      }
      const cd = e.clipboardData || window.clipboardData;
      const files = await window.api.readClipboardFiles();
      if (files && files.length) {
        await insertPastedFilesAtCursor(n, files);
        return;
      }
      const items = (cd && cd.items) ? Array.from(cd.items) : [];
      const hasImage = items.some((it) => it.type && it.type.indexOf('image') === 0);
      if (hasImage) {
        await handleImagePaste(cd, n);
        return;
      }
      const text = cd ? cd.getData('text/plain') : '';
      if (text) document.execCommand('insertText', false, text);
    });
    content.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      const paths = files.map((f) => window.api.getPathForFile(f)).filter((p) => p && p.length > 1);
      if (paths.length) {
        content.focus();
        await insertPastedFilesAtCursor(n, paths);
      }
    });
    content.addEventListener('blur', (e) => {
      n.content = readRichContent(content);
      n.updatedAt = Date.now();
      const rt = e.relatedTarget;
      const inTable = rt && rt.closest && rt.closest('.note-table-block');
      if (!savedRange && !inTable) content.innerHTML = renderRichContent(n.content, n);
      save();
    });
    content.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      adjustNoteFontSize(n, e.deltaY < 0 ? 1 : -1, (sz) => { el.style.setProperty('--note-font-size', sz + 'px'); });
    }, { passive: false });
    content.addEventListener('keydown', (e) => {
      if (e.ctrlKey && !e.shiftKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        toggleBold(content);
      } else if (e.ctrlKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        toggleHighlight(content);
      } else if (e.ctrlKey && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        const imgSrc = getSelectedImageSrc(n);
        if (imgSrc) {
          e.preventDefault();
          const imgObj = (n.images || []).find((im) => im.src === imgSrc);
          copiedImage = { src: imgSrc, w: (imgObj && imgObj.w) || 200 };
          window.api.copyImage(imgSrc);
          toast(t('toast_img_copied'));
        } else {
          copiedImage = null;
        }
      }
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
      insertImageByUrl(n, r.url);
    } else {
      clearSavedSelection();
      if (!r.canceled) toast(t('toast_img_saved_fail') + r.error);
    }
  };
  $('.t-table', el).onclick = (e) => {
    e.stopPropagation();
    openTableInsertDialog(n);
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
  wireTables(el, n);
}

function insertTextAtCaret(n, text) {
  const contentEl = focusNoteContent(n);
  if (contentEl && (document.activeElement === contentEl || contentEl.contains(document.activeElement))) {
    contentEl.focus();
    document.execCommand('insertText', false, text);
    n.content = readRichContent(contentEl);
  } else if (contentEl && savedNoteId === n.id && savedRange) {
    contentEl.focus();
    restoreSelection();
    document.execCommand('insertText', false, text);
    n.content = readRichContent(contentEl);
  } else {
    n.content = ((n.content || '').trim() ? n.content + '\n' : '') + text;
  }
  clearSavedSelection();
}

function insertImageMarkerAtCursor(n, imgId) {
  insertTextAtCaret(n, '[[img:' + imgId + ']]');
}

function addImageToNote(n, img) {
  n.images = n.images || [];
  n.images.push(img);
  insertImageMarkerAtCursor(n, img.id);
  cleanupRefs(n);
  n.updatedAt = Date.now();
  save();
  renderAll();
}

function insertImageByUrl(n, url) {
  addImageToNote(n, { id: uid(), src: url, w: 200 });
}

function insertImageReferenceAtCursor(n, src, w) {
  addImageToNote(n, { id: uid(), src, w: w || 200 });
}

async function addNoteImageFromDataUrl(dataUrl, n) {
  const r = await window.api.saveNoteImage(dataUrl);
  if (r.ok) {
    insertImageByUrl(n, r.url);
    toast(t('toast_img_pasted'));
  } else {
    toast(t('toast_img_saved_fail') + r.error);
  }
}

function addFileToNote(n, filePath, isDir) {
  const id = uid();
  n.files = n.files || [];
  n.files.push({ id, path: filePath, isDir });
  insertTextAtCaret(n, '[[file:' + id + ']]');
  cleanupRefs(n);
  n.updatedAt = Date.now();
  save();
  renderAll();
}

async function insertPastedFilesAtCursor(n, paths) {
  for (const p of paths) {
    const lower = p.toLowerCase();
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
    if (imageExts.some((e) => lower.endsWith(e))) {
      const r = await window.api.addImageFile(p);
      if (r.ok) insertImageByUrl(n, r.url);
    } else {
      const st = await window.api.statPath(p);
      if (st && st.exists) addFileToNote(n, p, !!st.isDirectory);
    }
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

function removeImageById(n, id) {
  n.images = (n.images || []).filter((x) => x.id !== id);
  n.content = (n.content || '').replace(new RegExp('\\[\\[img:' + id + '\\]\\]', 'g'), '');
  n.updatedAt = Date.now();
  save();
  renderAll();
}

function wireImages(el, n) {
  $$('.inline-img', el).forEach((item) => {
    const id = item.dataset.imgId;
    const img = $('img', item);
    const del = $('.img-del', item);
    const handle = $('.img-resize', item);

    if (del) del.onclick = (e) => {
      e.stopPropagation();
      removeImageById(n, id);
    };

    item.setAttribute('tabindex', '0');
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        e.stopPropagation();
        removeImageById(n, id);
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

/* ============ 表格 ============ */
let activeTableEl = null;
let activeTableNote = null;
let activeTableToolbar = null;
let activeTableSelCell = null;
let activeTableSelBox = null;
let lastTableBoxTime = 0;

function newTable(rows, cols) {
  const cells = [];
  for (let r = 0; r < rows; r++) cells.push(new Array(cols).fill(''));
  return { id: uid(), rows, cols, cells, merges: [], diagonals: [], borderWidth: 3, borderColor: null, fontSize: null, textColor: null };
}

function getTableById(n, id) {
  return (n.tables || []).find((x) => x.id === id);
}

function insertTableAtCursor(n, rows, cols) {
  const tbl = newTable(rows, cols);
  n.tables = n.tables || [];
  n.tables.push(tbl);
  insertTextAtCaret(n, '\n[[table:' + tbl.id + ']]\n');
  cleanupRefs(n);
  n.updatedAt = Date.now();
  save();
  renderAll();
}

function removeTableFromNote(n, id) {
  n.tables = (n.tables || []).filter((x) => x.id !== id);
  n.content = (n.content || '').replace(new RegExp('\\[\\[table:' + id + '\\]\\]', 'g'), '');
  n.updatedAt = Date.now();
  save();
}

function openTableInsertDialog(n) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:6500;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;';
  const modal = document.createElement('div');
  modal.style.cssText = 'width:280px;background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;';
  modal.innerHTML = `
    <header style="padding:14px 16px;font-weight:700;border-bottom:1px solid var(--border)">${t('insert_table')}</header>
    <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
      <label style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--fg-dim)"><span>${t('table_rows')}</span><input id="tbRows" type="number" min="1" max="20" value="3" style="width:80px;background:var(--bg-soft);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px" /></label>
      <label style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--fg-dim)"><span>${t('table_cols')}</span><input id="tbCols" type="number" min="1" max="20" value="3" style="width:80px;background:var(--bg-soft);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px" /></label>
    </div>
    <footer style="padding:12px 16px;display:flex;gap:10px;justify-content:flex-end">
      <button id="tbCancel" class="sp-btn ghost" style="width:auto;padding:8px 18px">${t('cancel')}</button>
      <button id="tbOk" class="sp-btn primary" style="width:auto;padding:8px 18px">${t('ok')}</button>
    </footer>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const done = (ok) => {
    overlay.remove();
    if (ok) {
      const rows = Math.min(20, Math.max(1, Number($('#tbRows', modal).value) || 3));
      const cols = Math.min(20, Math.max(1, Number($('#tbCols', modal).value) || 3));
      insertTableAtCursor(n, rows, cols);
    }
  };
  $('#tbOk', modal).onclick = () => done(true);
  $('#tbCancel', modal).onclick = () => done(false);
}

function tableAddRow(tbl) {
  tbl.rows++;
  tbl.cells.push(new Array(tbl.cols).fill(''));
}
function tableAddCol(tbl) {
  tbl.cols++;
  (tbl.cells || []).forEach((row) => row.push(''));
}
function tableRemoveRow(tbl, r) {
  if (tbl.rows <= 1) return;
  tbl.rows--;
  tbl.cells.splice(r, 1);
  tbl.merges = (tbl.merges || []).filter((m) => m.r !== r).map((m) => m.r > r ? { r: m.r - 1, c: m.c, rowspan: m.rowspan, colspan: m.colspan } : m);
  tbl.diagonals = (tbl.diagonals || []).filter((d) => d.r !== r).map((d) => d.r > r ? { r: d.r - 1, c: d.c, dir: d.dir, t1: d.t1, t2: d.t2 } : d);
}
function tableRemoveCol(tbl, c) {
  if (tbl.cols <= 1) return;
  tbl.cols--;
  (tbl.cells || []).forEach((row) => row.splice(c, 1));
  tbl.merges = (tbl.merges || []).filter((m) => m.c !== c).map((m) => m.c > c ? { r: m.r, c: m.c - 1, rowspan: m.rowspan, colspan: m.colspan } : m);
  tbl.diagonals = (tbl.diagonals || []).filter((d) => d.c !== c).map((d) => d.c > c ? { r: d.r, c: d.c - 1, dir: d.dir, t1: d.t1, t2: d.t2 } : d);
}
function tableMerge(tbl, r1, c1, r2, c2) {
  if (r1 === r2 && c1 === c2) return;
  tbl.merges = (tbl.merges || []).filter((m) => !(m.r >= r1 && m.r <= r2 && m.c >= c1 && m.c <= c2));
  tbl.diagonals = (tbl.diagonals || []).filter((d) => !(d.r >= r1 && d.r <= r2 && d.c >= c1 && d.c <= c2));
  const joined = [];
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) {
      const t = (tbl.cells[r] && tbl.cells[r][c]) || '';
      if (t) joined.push(t);
    }
  tbl.merges.push({ r: r1, c: c1, rowspan: r2 - r1 + 1, colspan: c2 - c1 + 1 });
  tbl.cells[r1][c1] = joined.join(' ');
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++)
      if (r !== r1 || c !== c1) tbl.cells[r][c] = '';
}
function tableSplit(tbl, r, c) {
  const idx = (tbl.merges || []).findIndex((m) => m.r === r && m.c === c);
  if (idx >= 0) tbl.merges.splice(idx, 1);
}

function refreshTableBlock(block, n) {
  const tbl = getTableById(n, block.dataset.tableId);
  if (!tbl) { block.remove(); return; }
  const tmp = document.createElement('div');
  tmp.innerHTML = tableBlockHtml(tbl);
  block.innerHTML = tmp.firstChild.innerHTML;
  n.updatedAt = Date.now();
  save();
}

function deselectTable() {
  if (activeTableEl) activeTableEl.classList.remove('tbl-selected');
  activeTableEl = null;
  activeTableNote = null;
  activeTableSelCell = null;
  activeTableSelBox = null;
  hideTableToolbar();
}

function hideTableToolbar() {
  if (activeTableToolbar) { activeTableToolbar.remove(); activeTableToolbar = null; }
}

function showTableToolbar(block) {
  hideTableToolbar();
  const tb = document.createElement('div');
  tb.className = 'table-toolbar';
  const btn = (html, title, fn) => {
    const b = document.createElement('button');
    b.innerHTML = html;
    b.title = title;
    b.onclick = (e) => { e.stopPropagation(); fn(); };
    tb.appendChild(b);
  };
  btn('＋行', t('add_row'), () => { const tbl = getTableById(activeTableNote, block.dataset.tableId); if (tbl) { tableAddRow(tbl); refreshTableBlock(block, activeTableNote); } });
  btn('＋列', t('add_col'), () => { const tbl = getTableById(activeTableNote, block.dataset.tableId); if (tbl) { tableAddCol(tbl); refreshTableBlock(block, activeTableNote); } });
  btn('−行', t('del_row'), () => { const tbl = getTableById(activeTableNote, block.dataset.tableId); if (tbl && activeTableSelCell) { tableRemoveRow(tbl, activeTableSelCell.r); activeTableSelCell = null; refreshTableBlock(block, activeTableNote); } });
  btn('−列', t('del_col'), () => { const tbl = getTableById(activeTableNote, block.dataset.tableId); if (tbl && activeTableSelCell) { tableRemoveCol(tbl, activeTableSelCell.c); activeTableSelCell = null; refreshTableBlock(block, activeTableNote); } });
  btn('合并', t('merge_cells'), () => {
    const tbl = getTableById(activeTableNote, block.dataset.tableId);
    if (tbl && activeTableSelBox) { tableMerge(tbl, activeTableSelBox.r1, activeTableSelBox.c1, activeTableSelBox.r2, activeTableSelBox.c2); activeTableSelBox = null; refreshTableBlock(block, activeTableNote); }
  });
  btn('拆分', t('split_cell'), () => {
    const tbl = getTableById(activeTableNote, block.dataset.tableId);
    if (tbl && activeTableSelCell) { tableSplit(tbl, activeTableSelCell.r, activeTableSelCell.c); refreshTableBlock(block, activeTableNote); }
  });
  btn('斜线', t('diag_line'), () => {
    const tbl = getTableById(activeTableNote, block.dataset.tableId);
    if (tbl && activeTableSelCell) {
      const r = activeTableSelCell.r, c = activeTableSelCell.c;
      const has = (tbl.diagonals || []).some((d) => d.r === r && d.c === c);
      if (has) {
        tbl.diagonals = (tbl.diagonals || []).filter((d) => !(d.r === r && d.c === c));
        refreshTableBlock(block, activeTableNote);
      } else {
        openDiagonalEditor(activeTableNote, tbl, r, c);
      }
    }
  });
  btn('⚙', t('table_settings'), () => {
    const tbl = getTableById(activeTableNote, block.dataset.tableId);
    if (tbl) openTableSettingsDialog(activeTableNote, tbl);
  });
  btn('✕', t('del_table'), () => { removeTableFromNote(activeTableNote, block.dataset.tableId); deselectTable(); renderAll(); });
  document.body.appendChild(tb);
  activeTableToolbar = tb;
  const rect = block.getBoundingClientRect();
  tb.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - tb.offsetWidth - 4)) + 'px';
  tb.style.top = Math.max(4, rect.top - tb.offsetHeight - 6) + 'px';
}

function openDiagonalEditor(n, tbl, r, c) {
  const block = activeTableEl;
  const existing = (tbl.diagonals || []).find((d) => d.r === r && d.c === c);
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:6500;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;';
  const modal = document.createElement('div');
  modal.style.cssText = 'width:300px;background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;';
  let dir = (existing && existing.dir === 'trbl') ? 'trbl' : 'tlbr';
  modal.innerHTML = `
    <header style="padding:14px 16px;font-weight:700;border-bottom:1px solid var(--border)">${t('diag_line')}</header>
    <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;gap:6px">
        <button id="diagDirTL" class="seg ${dir === 'tlbr' ? 'active' : ''}" style="flex:1">↘ ${t('diag_tlbr')}</button>
        <button id="diagDirTR" class="seg ${dir === 'trbl' ? 'active' : ''}" style="flex:1">↙ ${t('diag_trbl')}</button>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--fg-dim)"><span style="width:56px">${t('diag_t1')}</span><input id="diagT1" style="flex:1;background:var(--bg-soft);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px" value="${escapeHtml(existing ? existing.t1 : '')}" /></label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--fg-dim)"><span style="width:56px">${t('diag_t2')}</span><input id="diagT2" style="flex:1;background:var(--bg-soft);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px" value="${escapeHtml(existing ? existing.t2 : '')}" /></label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--fg-dim)"><span style="width:56px">${t('diag_t_color')}</span><input id="diagTColor" type="color" value="${(existing && existing.tColor) || '#808080'}" style="width:46px;height:28px;border:1px solid var(--border);border-radius:6px;background:transparent;cursor:pointer;padding:2px" /></label>
      <div style="display:flex;gap:5px;flex-wrap:wrap;padding-left:64px;margin-top:-8px">${TEXT_COLORS.map(c => `<button type="button" class="diag-tc-swatch" data-c="${c}" style="width:18px;height:18px;border-radius:5px;cursor:pointer;border:2px solid ${((existing && existing.tColor) || '#808080') === c ? 'var(--accent)' : 'var(--border)'};background:${c};padding:0"></button>`).join('')}</div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--fg-dim)"><span style="width:56px">${t('diag_t_size')}</span><input id="diagTSize" type="number" min="10" max="24" value="${existing && existing.tSize ? existing.tSize : ''}" placeholder="${t('follow_global')}" style="width:80px;background:var(--bg-soft);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px" /></label>
    </div>
    <footer style="padding:12px 16px;display:flex;gap:10px;justify-content:space-between">
      <button id="diagRemove" class="sp-btn ghost" style="width:auto;padding:8px 12px;color:#e5484d">${t('diag_remove')}</button>
      <div style="display:flex;gap:10px">
        <button id="diagCancel" class="sp-btn ghost" style="width:auto;padding:8px 18px">${t('cancel')}</button>
        <button id="diagOk" class="sp-btn primary" style="width:auto;padding:8px 18px">${t('ok')}</button>
      </div>
    </footer>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  $('#diagDirTL', modal).onclick = () => { dir = 'tlbr'; $('#diagDirTL', modal).classList.add('active'); $('#diagDirTR', modal).classList.remove('active'); };
  $('#diagDirTR', modal).onclick = () => { dir = 'trbl'; $('#diagDirTR', modal).classList.add('active'); $('#diagDirTL', modal).classList.remove('active'); };
  $$('.diag-tc-swatch', modal).forEach((sw) => { sw.onclick = () => { $('#diagTColor', modal).value = sw.dataset.c; }; });
  const apply = () => {
    const t1 = $('#diagT1', modal).value;
    const t2 = $('#diagT2', modal).value;
    const tColor = $('#diagTColor', modal).value;
    const tSizeVal = $('#diagTSize', modal).value;
    const tSize = tSizeVal ? Math.min(24, Math.max(10, Number(tSizeVal) || 0)) : null;
    tbl.diagonals = (tbl.diagonals || []).filter((d) => !(d.r === r && d.c === c));
    tbl.diagonals.push({ r, c, dir, t1, t2, tColor, tSize });
    overlay.remove();
    if (block) refreshTableBlock(block, n);
  };
  $('#diagOk', modal).onclick = apply;
  $('#diagCancel', modal).onclick = () => overlay.remove();
  $('#diagRemove', modal).onclick = () => {
    tbl.diagonals = (tbl.diagonals || []).filter((d) => !(d.r === r && d.c === c));
    overlay.remove();
    if (block) refreshTableBlock(block, n);
  };
}

function openTableSettingsDialog(n, tbl) {
  const block = activeTableEl;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:6500;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;';
  const modal = document.createElement('div');
  modal.style.cssText = 'width:280px;background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;';
  const curColor = tbl.borderColor || '#808080';
  const curWidth = tbl.borderWidth != null ? tbl.borderWidth : 2;
  modal.innerHTML = `
    <header style="padding:14px 16px;font-weight:700;border-bottom:1px solid var(--border)">${t('table_settings')}</header>
    <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
      <label style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--fg-dim)"><span>${t('tbl_border_color')}</span><input id="tblBColor" type="color" value="${curColor}" style="width:46px;height:28px;border:1px solid var(--border);border-radius:6px;background:transparent;cursor:pointer;padding:2px" /></label>
      <label style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--fg-dim)"><span>${t('tbl_border_width')}</span><input id="tblBWidth" type="range" min="1" max="6" value="${curWidth}" style="width:150px;accent-color:var(--accent)" /></label>
      <div id="tblBWidthVal" style="text-align:right;font-size:12px;color:var(--fg-dim)">${curWidth}px</div>
      <label style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--fg-dim)"><span>${t('tbl_text_color')}</span><input id="tblTColor" type="color" value="${tbl.textColor || '#808080'}" style="width:46px;height:28px;border:1px solid var(--border);border-radius:6px;background:transparent;cursor:pointer;padding:2px" /></label>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:-8px">${TEXT_COLORS.map(c => `<button type="button" class="tbl-tc-swatch" data-c="${c}" style="width:18px;height:18px;border-radius:5px;cursor:pointer;border:2px solid ${(tbl.textColor || '#808080') === c ? 'var(--accent)' : 'var(--border)'};background:${c};padding:0"></button>`).join('')}</div>
      <label style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--fg-dim)"><span>${t('tbl_text_size')}</span><input id="tblTSize" type="number" min="10" max="24" value="${tbl.fontSize ? tbl.fontSize : ''}" placeholder="${t('follow_global')}" style="width:80px;background:var(--bg-soft);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px" /></label>
    </div>
    <footer style="padding:12px 16px;display:flex;gap:10px;justify-content:flex-end">
      <button id="tblSetCancel" class="sp-btn ghost" style="width:auto;padding:8px 18px">${t('cancel')}</button>
      <button id="tblSetOk" class="sp-btn primary" style="width:auto;padding:8px 18px">${t('ok')}</button>
    </footer>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const wVal = $('#tblBWidthVal', modal);
  $('#tblBWidth', modal).addEventListener('input', (e) => { wVal.textContent = e.target.value + 'px'; });
  $$('.tbl-tc-swatch', modal).forEach((sw) => { sw.onclick = () => { $('#tblTColor', modal).value = sw.dataset.c; }; });
  const done = (ok) => {
    overlay.remove();
    if (ok) {
      tbl.borderColor = $('#tblBColor', modal).value || null;
      tbl.borderWidth = Number($('#tblBWidth', modal).value) || 2;
      tbl.textColor = $('#tblTColor', modal).value || null;
      const tSizeVal = $('#tblTSize', modal).value;
      tbl.fontSize = tSizeVal ? Math.min(24, Math.max(10, Number(tSizeVal) || 0)) : null;
      if (block) refreshTableBlock(block, n);
      else { n.updatedAt = Date.now(); save(); renderAll(); }
    }
  };
  $('#tblSetOk', modal).onclick = () => done(true);
  $('#tblSetCancel', modal).onclick = () => done(false);
}

function showTableContextMenu(e, n, block) {
  e.preventDefault();
  e.stopPropagation();
  setActiveTable(block, n, null);
  const pop = document.createElement('div');
  pop.className = 'color-pop ctx-menu';
  pop.style.gridTemplateColumns = '1fr';
  pop.style.minWidth = '140px';
  pop.style.padding = '6px';
  const addItem = (icon, label, onClick, danger) => {
    const b = document.createElement('button');
    b.style.cssText = 'background:transparent;border:none;color:var(--fg);padding:7px 10px;border-radius:7px;cursor:pointer;text-align:left;font-size:12px;font-family:inherit;width:100%;display:flex;align-items:center;gap:8px;';
    b.innerHTML = `<span>${icon}</span><span>${label}</span>`;
    b.onmouseenter = () => (b.style.background = 'var(--accent-soft)');
    b.onmouseleave = () => (b.style.background = 'transparent');
    b.onclick = () => { pop.remove(); onClick(); };
    pop.appendChild(b);
  };
  addItem('⚙', t('table_settings'), () => {
    const tbl = getTableById(n, block.dataset.tableId);
    if (tbl) openTableSettingsDialog(n, tbl);
  });
  addItem('🗑', t('del_table'), () => {
    removeTableFromNote(n, block.dataset.tableId);
    deselectTable();
    renderAll();
  }, true);
  document.body.appendChild(pop);
  const x = Math.max(8, Math.min(e.clientX, window.innerWidth - pop.offsetWidth - 8));
  const y = Math.max(8, Math.min(e.clientY, window.innerHeight - pop.offsetHeight - 8));
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
  setTimeout(() => document.addEventListener('mousedown', function h(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', h); } }), 0);
}

function setActiveTable(block, n, cell) {
  if (activeTableEl && activeTableEl !== block) activeTableEl.classList.remove('tbl-selected');
  activeTableEl = block;
  activeTableNote = n;
  activeTableSelCell = cell;
  activeTableSelBox = null;
  block.classList.add('tbl-selected');
  $$('td', block).forEach((td) => td.classList.remove('cell-selected'));
  if (cell) {
    const td = $(`td[data-r="${cell.r}"][data-c="${cell.c}"]`, block);
    if (td) td.classList.add('cell-selected');
  }
  showTableToolbar(block);
}

function highlightBox(block, box) {
  $$('td', block).forEach((td) => {
    const r = Number(td.dataset.r), c = Number(td.dataset.c);
    td.classList.toggle('box-selected', r >= box.r1 && r <= box.r2 && c >= box.c1 && c <= box.c2);
  });
}

function wireTables(el, n) {
  $$('.note-table-block', el).forEach((block) => {
    block.addEventListener('click', (e) => {
      e.stopPropagation();
      if (Date.now() - lastTableBoxTime < 150) return;
      const td = e.target.closest('td');
      if (td) setActiveTable(block, n, { r: Number(td.dataset.r), c: Number(td.dataset.c) });
      else setActiveTable(block, n, null);
    });

    block.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const td = e.target.closest('td');
      if (!td) return;
      e.preventDefault();
      const startR = Number(td.dataset.r), startC = Number(td.dataset.c);
      let box = { r1: startR, c1: startC, r2: startR, c2: startC };
      let moved = false;
      const onMove = (ev) => {
        const t = document.elementFromPoint(ev.clientX, ev.clientY);
        const tdd = t && t.closest ? t.closest('td') : null;
        if (tdd) {
          const rr = Number(tdd.dataset.r), cc = Number(tdd.dataset.c);
          box = { r1: Math.min(startR, rr), c1: Math.min(startC, cc), r2: Math.max(startR, rr), c2: Math.max(startC, cc) };
          if (box.r2 - box.r1 > 0 || box.c2 - box.c1 > 0) moved = true;
          highlightBox(block, box);
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (moved) {
          lastTableBoxTime = Date.now();
          setActiveTable(block, n, null);
          activeTableSelBox = box;
          highlightBox(block, box);
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    block.addEventListener('dblclick', (e) => {
      const td = e.target.closest('td');
      if (!td) return;
      const r = Number(td.dataset.r), c = Number(td.dataset.c);
      const tbl = getTableById(n, block.dataset.tableId);
      if (!tbl) return;
      const diag = (tbl.diagonals || []).find((d) => d.r === r && d.c === c);
      if (diag) openDiagonalEditor(n, tbl, r, c);
      else editCell(block, td, n, tbl, r, c);
    });

    block.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (block.querySelector('.cell-editing')) return;
        e.preventDefault();
        e.stopPropagation();
        removeTableFromNote(n, block.dataset.tableId);
        deselectTable();
        renderAll();
      }
    });
    block.addEventListener('contextmenu', (e) => showTableContextMenu(e, n, block));
  });
}

function editCell(block, td, n, tbl, r, c) {
  td.contentEditable = 'true';
  td.classList.add('cell-editing');
  td.focus();
  const done = (commit) => {
    document.removeEventListener('mousedown', onDocDown, true);
    td.onblur = null;
    td.onkeydown = null;
    td.contentEditable = 'false';
    td.classList.remove('cell-editing');
    if (commit) {
      tbl.cells[r][c] = readRichContent(td);
      refreshTableBlock(block, n);
    } else {
      const tmp = document.createElement('div');
      tmp.innerHTML = tableBlockHtml(tbl);
      block.innerHTML = tmp.firstChild.innerHTML;
    }
  };
  const onDocDown = (e) => { if (!td.contains(e.target)) done(true); };
  document.addEventListener('mousedown', onDocDown, true);
  td.onblur = () => done(true);
  td.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); }
    else if (e.key === 'Escape') { e.preventDefault(); done(false); }
    else if (e.ctrlKey && !e.shiftKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); toggleBold(td); }
    else if (e.ctrlKey && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); toggleHighlight(td); }
  };
}

function wireNoteEvents(el, n) {
  wireCommon(el, n);

  const head = $('.note-head', el);
  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, input, .note-tools')) return;
    e.preventDefault();
    head.setPointerCapture(e.pointerId);
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
      clearMemoDropIndicator();
    });
  }
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
  const canvas = $('#canvas');
  let rect = board.getBoundingClientRect();
  const offsetX = e.clientX - rect.left - n.x;
  const offsetY = e.clientY - rect.top - n.y;

  el.classList.add('dragging');
  el.style.transform = 'translate3d(0,0,0)';

  const updateRect = () => { rect = board.getBoundingClientRect(); };
  canvas.addEventListener('scroll', updateRect, { passive: true });

  let rafId = null;
  let lastEv = null;
  const applyMove = () => {
    rafId = null;
    if (!lastEv) return;
    const ev = lastEv;
    lastEv = null;
    const nx = Math.max(0, Math.round(ev.clientX - rect.left - offsetX));
    const ny = Math.max(0, Math.round(ev.clientY - rect.top - offsetY));
    el.style.transform = `translate3d(${nx - n.x}px, ${ny - n.y}px, 0)`;
  };
  const onMove = (ev) => {
    lastEv = ev;
    if (rafId == null) rafId = requestAnimationFrame(applyMove);
  };
  const onUp = () => {
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    if (lastEv) applyMove();
    const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(el.style.transform || '');
    if (m) {
      n.x = Math.max(0, Math.round(n.x + parseFloat(m[1])));
      n.y = Math.max(0, Math.round(n.y + parseFloat(m[2])));
    }
    el.style.transform = '';
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    canvas.removeEventListener('scroll', updateRect);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    el.classList.remove('dragging');
    n.updatedAt = Date.now();
    save();
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
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
  const pos = nextGridPosition();
  const n = {
    id: uid(),
    title: '待办',
    content: '',
    type: 'todo',
    items: [{ id: uid(), text, done: false }],
    color: defaultNoteColor(),
    textColor: null,
    fontFamily: null,
    images: [],
    files: [],
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
    color: defaultNoteColor(),
    textColor: null,
    fontFamily: null,
    images: [],
    files: [],
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
  deselectTable();
  const board = $('#board');
  const memoList = $('#memoList');
  const todoList = $('#todoList');
  const docList = $('#docList');
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
    docList.classList.add('hidden');
    board.innerHTML = '';
    memoList.innerHTML = '';
    docList.innerHTML = '';
    renderTodoView();
  } else if (state.settings.viewMode === 'memo') {
    board.classList.add('hidden');
    memoList.classList.remove('hidden');
    todoList.classList.add('hidden');
    docList.classList.add('hidden');
    board.innerHTML = '';
    memoList.innerHTML = '';
    docList.innerHTML = '';
    getSortedNotes(visible).forEach((n) => memoList.appendChild(buildMemoEl(n)));
  } else if (state.settings.viewMode === 'doc') {
    board.classList.add('hidden');
    memoList.classList.add('hidden');
    todoList.classList.add('hidden');
    docList.classList.remove('hidden');
    board.innerHTML = '';
    memoList.innerHTML = '';
    todoList.innerHTML = '';
    renderDocView(visible);
  } else {
    board.classList.remove('hidden');
    memoList.classList.add('hidden');
    todoList.classList.add('hidden');
    docList.classList.add('hidden');
    memoList.innerHTML = '';
    todoList.innerHTML = '';
    docList.innerHTML = '';
    board.innerHTML = '';
    visible.forEach((n) => board.appendChild(buildNoteEl(n)));
  }

  $('#noteCount').textContent = state.notes.length;
  const empty = state.notes.length === 0;
  $('#emptyHint').classList.toggle('hidden', !empty || state.settings.viewMode === 'todo' || state.settings.viewMode === 'doc');
}

function setViewMode(mode) {
  state.settings.viewMode = mode;
  if (mode !== 'doc') docNoteId = null;
  $('#viewBoard').classList.toggle('active', mode === 'board');
  $('#viewMemo').classList.toggle('active', mode === 'memo');
  $('#viewTodo').classList.toggle('active', mode === 'todo');
  $('#viewDoc').classList.toggle('active', mode === 'doc');
  save();
  renderAll();
}

function renderDocView(visible) {
  const list = $('#docList');
  if (!list) return;
  if (!docNoteId) {
    const items = getSortedNotes(visible).map((n) => {
      const tc = n.textColor || state.settings.noteTextColor || autoTextColor(n.color);
      return `
      <div class="doc-pick-item" data-id="${n.id}" style="background:${n.color};color:${tc}">
        <div class="dp-info">
          <div class="dp-title">${escapeHtml(n.title || t('untitled'))}</div>
          <div class="dp-sub">${escapeHtml((noteText(n) || '').slice(0, 80))}</div>
        </div>
        <span class="dp-arrow">→</span>
      </div>`;
    }).join('');
    list.innerHTML = `<div class="doc-picker-head"><h3>${t('doc_view')}</h3></div>
      <p class="sp-hint">${t('doc_pick_hint')}</p>
      <div class="doc-picker">${items}</div>`;
    $$('.doc-pick-item', list).forEach((it) => {
      it.onclick = () => { docNoteId = it.dataset.id; renderAll(); };
    });
    return;
  }
  const n = state.notes.find((x) => x.id === docNoteId);
  if (!n) { docNoteId = null; renderAll(); return; }
  const isTodo = n.type === 'todo';
  const textColor = n.textColor || state.settings.noteTextColor || autoTextColor(n.color);
  const todoHtml = isTodo
    ? `<ul class="todo-list" style="margin-top:12px">${(n.items || []).map((it) => `<li class="todo-item ${it.done ? 'done' : ''}"><span style="font-size:16px">${it.done ? '☑' : '☐'}</span><span style="margin-left:8px;${it.done ? 'text-decoration:line-through;opacity:.5' : ''}">${escapeHtml(it.text || t('empty_item'))}</span></li>`).join('')}</ul>`
    : '';
  list.innerHTML = `
    <div class="doc-toolbar">
      <button class="doc-back" id="btnDocBack">${t('doc_back')}</button>
      ${!isTodo ? `<button class="doc-fmt-btn" id="btnDocBold" title="${t('bold')}"><b>B</b></button>
      <button class="doc-fmt-btn" id="btnDocHighlight" title="${t('highlight')}">🖍</button>
      <input type="color" id="btnDocHlColor" class="doc-hl-color" title="${t('highlight_color')}" value="${highlightColor()}" />` : ''}
      <span class="doc-tb-sep"></span>
      <button class="doc-fmt-btn" id="btnDocPin" title="${t('pin')}">📌</button>
      <button class="doc-fmt-btn" id="btnDocTodo" title="${t('todo_mode')}">☑</button>
      <button class="doc-fmt-btn" id="btnDocGroup" title="${t('add_to_group')}">🏷</button>
      <button class="doc-fmt-btn" id="btnDocDesktop" title="${t('desktop')}">🖥️</button>
      <button class="doc-fmt-btn" id="btnDocImage" title="${t('insert_image')}">🖼️</button>
      <button class="doc-fmt-btn" id="btnDocTable" title="${t('insert_table')}">▦</button>
      <button class="doc-fmt-btn" id="btnDocRemind" title="${t('todo_remind')}">⏰</button>
      <button class="doc-fmt-btn" id="btnDocColor" title="${t('color')}">🎨</button>
      <button class="doc-fmt-btn" id="btnDocDel" title="${t('delete')}">🗑</button>
      <span class="doc-hint">${t('doc_hint')}</span>
    </div>
    <div class="doc-editor" style="--note-color:${n.color};${n.fontSize ? '--note-font-size:' + n.fontSize + 'px;' : ''}color:${textColor}">
      <input id="docTitle" class="doc-title-input" value="${escapeHtml(n.title || '')}" placeholder="${t('note_title')}" />
      ${isTodo ? todoHtml : `<div id="docContent" class="doc-content" contenteditable="true" spellcheck="false" data-placeholder="${t('note_content')}">${renderRichContent(n.content, n)}</div>`}
    </div>`;
  wireDocView(n, isTodo);
}

function wireDocView(n, isTodo) {
  const title = $('#docTitle');
  if (!title) return;
  title.addEventListener('input', () => { n.title = title.value; n.updatedAt = Date.now(); save(); });
  const back = $('#btnDocBack');
  if (back) back.onclick = () => { docNoteId = null; renderAll(); };

  // 便签右上角功能按钮（文档模式）
  const pinBtn = $('#btnDocPin');
  if (pinBtn) pinBtn.onclick = () => { n.pinned = !n.pinned; n.updatedAt = Date.now(); save(); renderAll(); };
  const todoBtn = $('#btnDocTodo');
  if (todoBtn) todoBtn.onclick = () => {
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
  const groupBtn = $('#btnDocGroup');
  if (groupBtn) groupBtn.onclick = () => {
    if (n.groupId) { n.groupId = null; n.updatedAt = Date.now(); save(); renderAll(); }
    else openGroupPop(noteAnchor(n), n);
  };
  const desktopBtn = $('#btnDocDesktop');
  if (desktopBtn) desktopBtn.onclick = () => { n.desktopPin = true; n.updatedAt = Date.now(); saveNow(); window.api.pinToDesktop(n.id); renderAll(); toast(t('toast_pinned')); };
  const imageBtn = $('#btnDocImage');
  if (imageBtn) imageBtn.onclick = async () => { const r = await window.api.pickNoteImage(); if (r.ok) insertImageByUrl(n, r.url); };
  const tableBtn = $('#btnDocTable');
  if (tableBtn) tableBtn.onclick = () => openTableInsertDialog(n);
  const remindBtn = $('#btnDocRemind');
  if (remindBtn) remindBtn.onclick = () => openReminder(n);
  const colorBtn = $('#btnDocColor');
  if (colorBtn) colorBtn.onclick = () => openColorPop(noteAnchor(n), n);
  const delBtn = $('#btnDocDel');
  if (delBtn) delBtn.onclick = () => deleteNote(n.id);

  if (isTodo) return;
  const content = $('#docContent');
  const boldBtn = $('#btnDocBold');
  const hlBtn = $('#btnDocHighlight');
  if (!content) return;
  if (boldBtn) boldBtn.onclick = () => { content.focus(); if (savedRange && savedNoteId === n.id) restoreSelection(); toggleBold(content); };
  if (hlBtn) hlBtn.onclick = () => { content.focus(); if (savedRange && savedNoteId === n.id) restoreSelection(); toggleHighlight(content); };
  const hlColor = $('#btnDocHlColor');
  if (hlColor) hlColor.addEventListener('input', (e) => setHighlightColor(e.target.value));

  content.addEventListener('contextmenu', (e) => {
    if (e.target.closest('button, input')) return;
    showNoteContextMenu(e, n);
  });

  content.addEventListener('click', (e) => {
    const link = e.target.closest('a.note-link');
    if (link) { const url = link.getAttribute('data-url'); if (url) window.api.openExternal(url); return; }
    const fl = e.target.closest('.file-link');
    if (fl) { e.stopPropagation(); window.api.openFilePath(fl.getAttribute('data-path'), fl.getAttribute('data-is-dir') === '1'); }
  });
  content.addEventListener('input', () => { n.content = readRichContent(content); n.updatedAt = Date.now(); save(); });
  content.addEventListener('paste', async (e) => {
    e.preventDefault();
    if (copiedImage) { insertImageReferenceAtCursor(n, copiedImage.src, copiedImage.w); return; }
    const cd = e.clipboardData || window.clipboardData;
    const files = await window.api.readClipboardFiles();
    if (files && files.length) { await insertPastedFilesAtCursor(n, files); return; }
    const items = (cd && cd.items) ? Array.from(cd.items) : [];
    const hasImage = items.some((it) => it.type && it.type.indexOf('image') === 0);
    if (hasImage) { await handleImagePaste(cd, n); return; }
    const text = cd ? cd.getData('text/plain') : '';
    if (text) document.execCommand('insertText', false, text);
  });
  content.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    const paths = files.map((f) => window.api.getPathForFile(f)).filter((p) => p && p.length > 1);
    if (paths.length) {
      content.focus();
      await insertPastedFilesAtCursor(n, paths);
    }
  });
  content.addEventListener('blur', (e) => {
    n.content = readRichContent(content);
    const rt = e.relatedTarget;
    const inTable = rt && rt.closest && rt.closest('.note-table-block');
    if (!savedRange && !inTable) content.innerHTML = renderRichContent(n.content, n);
    save();
  });
  content.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    adjustNoteFontSize(n, e.deltaY < 0 ? 1 : -1, (sz) => { const ed = content.closest('.doc-editor'); if (ed) ed.style.setProperty('--note-font-size', sz + 'px'); });
  }, { passive: false });
  content.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      toggleBold(content);
    } else if (e.ctrlKey && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      toggleHighlight(content);
    } else if (e.ctrlKey && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
      const imgSrc = getSelectedImageSrc(n);
      if (imgSrc) {
        e.preventDefault();
        const imgObj = (n.images || []).find((im) => im.src === imgSrc);
        copiedImage = { src: imgSrc, w: (imgObj && imgObj.w) || 200 };
        window.api.copyImage(imgSrc);
        toast(t('toast_img_copied'));
      } else {
        copiedImage = null;
      }
    }
  });
  wireImages(content, n);
  wireTables(content, n);
}

function nextGridPosition() {
  const canvasW = $('#canvas').clientWidth;
  const cols = Math.max(1, Math.floor((canvasW - 40) / 260));
  const newW = 240;
  const newH = 200;
  const gap = 18;
  const existing = state.notes.filter((n) => !n.desktopPin);
  const overlaps = (x, y) => existing.some((n) => {
    const nw = n.w || 240;
    const nh = n.h || 180;
    return (x < n.x + nw + gap) && (x + newW + gap > n.x) && (y < n.y + nh + gap) && (y + newH + gap > n.y);
  });
  for (let i = 0; i < 5000; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = 20 + col * 260;
    const y = 20 + row * 230;
    if (!overlaps(x, y)) return { x, y };
  }
  let maxBottom = 20;
  existing.forEach((n) => { maxBottom = Math.max(maxBottom, (n.y || 20) + (n.h || 180)); });
  return { x: 20, y: maxBottom + gap };
}

function createNote(x, y) {
  const pos = (x != null && y != null) ? { x, y } : nextGridPosition();
  const n = {
    id: uid(),
    title: '',
    content: '',
    type: 'note',
    items: [],
    color: defaultNoteColor(),
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
  savedNoteId = n.id;
  captureSelection();
  savedImageSrc = getSelectedImageSrc(n);
  const pop = document.createElement('div');
  pop.className = 'color-pop ctx-menu';
  pop.style.gridTemplateColumns = '1fr';
  pop.style.minWidth = '132px';
  pop.style.padding = '5px';
  pop.style.maxHeight = Math.max(120, window.innerHeight - 20) + 'px';
  pop.style.overflowY = 'auto';

  const addItem = (icon, label, onClick) => {
    const b = document.createElement('button');
    b.style.cssText = 'background:transparent;border:none;color:var(--fg);padding:5px 8px;border-radius:6px;cursor:pointer;text-align:left;font-size:12px;font-family:inherit;width:100%;display:flex;align-items:center;gap:6px;';
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
    clearSavedSelection();
    toast(t('toast_saved'));
  });
  addItem('📋', t('copy'), () => {
    const imgSrc = savedImageSrc;
    if (imgSrc) {
      const imgObj = (n.images || []).find((im) => im.src === imgSrc);
      copiedImage = { src: imgSrc, w: (imgObj && imgObj.w) || 200 };
      window.api.copyImage(imgSrc);
      toast(t('toast_img_copied'));
    } else {
      copiedImage = null;
      if (savedSelText) window.api.writeClipboard(savedSelText);
      else window.api.writeClipboard(noteText(n));
    }
    clearSavedSelection();
  });
  addItem('✂️', t('cut'), () => {
    const c = focusNoteContent(n);
    if (c) c.focus();
    if (savedRange && savedNoteId === n.id) restoreSelection();
    document.execCommand('cut');
    copiedImage = null;
    clearSavedSelection();
  });
  addItem('📥', t('paste'), async () => {
    if (copiedImage) {
      insertImageReferenceAtCursor(n, copiedImage.src, copiedImage.w);
      clearSavedSelection();
      return;
    }
    const files = await window.api.readClipboardFiles();
    if (files && files.length) {
      await insertPastedFilesAtCursor(n, files);
      clearSavedSelection();
      return;
    }
    const imgDataUrl = await readClipboardImageAsDataUrl();
    if (imgDataUrl) {
      await addNoteImageFromDataUrl(imgDataUrl, n);
      clearSavedSelection();
      return;
    }
    const text = await window.api.readClipboard();
    if (text) {
      const c = focusNoteContent(n);
      if (c) {
        c.focus();
        if (savedRange && savedNoteId === n.id) restoreSelection();
        document.execCommand('insertText', false, text);
      }
    }
    clearSavedSelection();
  });
  addItem('▤', t('select_all'), () => {
    const c = focusNoteContent(n);
    if (c) { c.focus(); document.execCommand('selectAll'); }
    else { const ae = document.activeElement; if (ae && ae.select) ae.select(); else document.execCommand('selectAll'); }
    clearSavedSelection();
  });
  const isBold = !!document.queryCommandState('bold');
  const isHl = selectionHasHighlight();
  addItem('𝗕', isBold ? t('unbold') : t('bold'), () => {
    const c = focusNoteContent(n);
    if (c) {
      c.focus();
      if (savedRange && savedNoteId === n.id) restoreSelection();
      toggleBold(c);
    }
    clearSavedSelection();
  });
  addItem('🖍', isHl ? t('unhighlight') : t('highlight'), () => {
    const c = focusNoteContent(n);
    if (c) {
      c.focus();
      if (savedRange && savedNoteId === n.id) restoreSelection();
      toggleHighlight(c);
    }
    clearSavedSelection();
  });

  const hlLabel = document.createElement('div');
  hlLabel.style.cssText = 'font-size:11px;color:var(--fg-dim);padding:8px 10px 2px;';
  hlLabel.textContent = t('highlight_color');
  pop.appendChild(hlLabel);
  const hlRow = document.createElement('div');
  hlRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;padding:4px 10px 8px;';
  HIGHLIGHT_COLORS.forEach((c) => {
    const s = document.createElement('button');
    s.className = 'swatch' + (highlightColor() === c ? ' active' : '');
    s.style.background = c;
    s.title = c;
    s.onclick = (e) => { e.stopPropagation(); setHighlightColor(c); };
    hlRow.appendChild(s);
  });
  const hlCustom = document.createElement('input');
  hlCustom.type = 'color';
  hlCustom.value = highlightColor();
  hlCustom.title = t('custom');
  hlCustom.style.cssText = 'width:26px;height:26px;border:1px solid var(--border);border-radius:7px;background:transparent;cursor:pointer;padding:0;';
  hlCustom.oninput = (e) => setHighlightColor(e.target.value);
  hlCustom.onclick = (e) => e.stopPropagation();
  hlRow.appendChild(hlCustom);
  pop.appendChild(hlRow);

  const sep2 = document.createElement('div');
  sep2.style.cssText = 'height:1px;background:var(--border);margin:4px 0;';
  pop.appendChild(sep2);
  addItem('▦', t('insert_table'), () => openTableInsertDialog(n));
  addItem('🖼️', t('insert_image'), async () => {
    const r = await window.api.pickNoteImage();
    if (r.ok) insertImageByUrl(n, r.url);
    else if (!r.canceled) toast(t('toast_img_saved_fail') + r.error);
  });
  addItem('📌', n.pinned ? t('unpin_note') : t('pin'), () => { n.pinned = !n.pinned; n.updatedAt = Date.now(); save(); renderAll(); });
  addItem('☑', t('todo_mode'), () => {
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
  });
  addItem('🏷', n.groupId ? t('remove_from_group') : t('add_to_group'), () => {
    if (n.groupId) { n.groupId = null; n.updatedAt = Date.now(); save(); renderAll(); }
    else openGroupPop(noteAnchor(n), n);
  });
  addItem('🖥️', t('desktop'), () => {
    n.desktopPin = true;
    n.updatedAt = Date.now();
    saveNow();
    window.api.pinToDesktop(n.id);
    renderAll();
    toast(t('toast_pinned'));
  });
  addItem('⏰', t('todo_remind'), () => openReminder(n));
  addItem('🎨', t('color'), () => openColorPop(noteAnchor(n), n, e.clientX, e.clientY));
  addItem('🗑', t('delete'), () => deleteNote(n.id), true);

  document.body.appendChild(pop);
  const x = Math.max(8, Math.min(e.clientX, window.innerWidth - pop.offsetWidth - 8));
  const y = Math.max(8, Math.min(e.clientY, window.innerHeight - pop.offsetHeight - 8));
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
  activeColorPop = pop;
  setTimeout(() => document.addEventListener('mousedown', closePopsOnce), 0);
}

function openColorPop(el, n, atX, atY) {
  closePops();
  const selRange = savedRange;
  const selNoteId = savedNoteId;
  const selText = savedSelText;
  clearSavedSelection();
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
    addSwatch(c, (n.textColor || state.settings.noteTextColor) === c, () => {
      if (selRange && selText && selNoteId === n.id) {
        applyInlineColor(n, selRange, c);
      } else {
        n.textColor = c;
        n.updatedAt = Date.now();
        save();
        renderAll();
      }
    });
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
  let left, top;
  if (atX != null && atY != null) {
    left = Math.max(8, Math.min(atX + 8, window.innerWidth - pop.offsetWidth - 8));
    top = Math.max(8, Math.min(atY - 6, window.innerHeight - pop.offsetHeight - 8));
  } else {
    const r = el.getBoundingClientRect();
    left = Math.min(r.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8);
    top = Math.max(8, Math.min(r.top + 28, window.innerHeight - pop.offsetHeight - 8));
  }
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  activeColorPop = pop;
  setTimeout(() => document.addEventListener('mousedown', closePopsOnce), 0);
}

function openGroupPop(el, n) {
  closePops();
  clearSavedSelection();
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
  if (activeColorPop && !activeColorPop.contains(e.target)) { activeColorPop.remove(); activeColorPop = null; document.removeEventListener('mousedown', closePopsOnce); clearSavedSelection(); }
  if (activeGroupPop && !activeGroupPop.contains(e.target)) { activeGroupPop.remove(); activeGroupPop = null; document.removeEventListener('mousedown', closePopsOnce); clearSavedSelection(); }
}

function openGroupEditPop(anchorEl, g) {
  closePops();
  clearSavedSelection();
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

/* ============ 闹铃声音 ============ */
let alarmAudio = null;    // 自定义声音 Audio（循环播放）
let alarmCtx = null;      // 默认提示音 WebAudio 上下文
let alarmTimer = null;    // 默认提示音循环定时器

function defaultAlarmVolume() {
  return (state.settings.reminderVolume != null ? state.settings.reminderVolume : 70) / 100;
}

function stopAlarm() {
  if (alarmTimer) { clearInterval(alarmTimer); alarmTimer = null; }
  if (alarmAudio) { try { alarmAudio.pause(); alarmAudio.currentTime = 0; } catch (e) { /* ignore */ } alarmAudio = null; }
  if (alarmCtx) { try { alarmCtx.close(); } catch (e) { /* ignore */ } alarmCtx = null; }
}

function playDefaultBeep(ctx, volume) {
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.01, volume), now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
  gain.connect(ctx.destination);
  const freqs = [880, 988, 880, 988];
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    osc.connect(gain);
    osc.start(now + i * 0.18);
    osc.stop(now + i * 0.18 + 0.16);
  });
}

function startDefaultAlarm(volume, loop) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  alarmCtx = ctx;
  if (ctx.state === 'suspended') ctx.resume();
  playDefaultBeep(ctx, volume);
  if (loop) {
    alarmTimer = setInterval(() => {
      if (!alarmCtx) return;
      playDefaultBeep(alarmCtx, volume);
    }, 1500);
  }
}

function playReminderSound(info) {
  stopAlarm();
  let url = null;
  let volume = defaultAlarmVolume();
  if (info) {
    url = info.url || null;
    volume = (info.volume != null ? info.volume : defaultAlarmVolume());
  } else {
    url = state.settings.reminderSoundPath || null;
  }

  if (url) {
    try {
      const a = new Audio(url);
      a.loop = true;
      a.volume = Math.max(0, Math.min(1, volume));
      a.play().catch(() => {});
      alarmAudio = a;
    } catch (e) { /* ignore */ }
    return;
  }
  startDefaultAlarm(volume, true);
}

function previewReminderSound() {
  stopAlarm();
  const url = state.settings.reminderSoundPath || null;
  const volume = defaultAlarmVolume();
  if (url) {
    try {
      const a = new Audio(url);
      a.loop = false;
      a.volume = Math.max(0, Math.min(1, volume));
      a.play().catch(() => {});
      alarmAudio = a;
    } catch (e) { /* ignore */ }
    return;
  }
  startDefaultAlarm(volume, false);
}

/* ============ 闹铃提醒弹窗 ============ */
function showAlarmModal(n) {
  const title = n.title || t('untitled');
  const body = n.type === 'todo'
    ? (n.items || []).filter((i) => !i.done).map((i) => i.text).join('\n')
    : (n.content || '').replace(/\[\[(?:img|file):[a-zA-Z0-9_-]+\]\]/g, '');
  $('#alarmTitle').textContent = '⏰ ' + title;
  $('#alarmBody').textContent = (body || '').slice(0, 400);
  $('#alarmOverlay').classList.remove('hidden');
}

function dismissAlarm() {
  stopAlarm();
  $('#alarmOverlay').classList.add('hidden');
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
  const margin = 20;
  const gap = 18;
  const colW = 260;
  const rowH = 230;
  const cols = Math.max(1, Math.floor(($('#canvas').clientWidth - margin * 2 + gap) / colW));
  const sorted = getSortedNotes(state.notes.filter((n) => !n.desktopPin));
  const placed = [];
  const overlaps = (x, y, w, h) => placed.some((p) => (x < p.x + p.w + gap) && (x + w + gap > p.x) && (y < p.y + p.h + gap) && (y + h + gap > p.y));
  sorted.forEach((n) => {
    const w = n.w || 240;
    const h = n.h || 180;
    let pos = null;
    outer:
    for (let i = 0; i < 10000; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = margin + col * colW;
      const y = margin + row * rowH;
      if (!overlaps(x, y, w, h)) { pos = { x, y }; break outer; }
    }
    if (!pos) {
      let maxBottom = margin;
      placed.forEach((p) => { maxBottom = Math.max(maxBottom, p.y + p.h); });
      pos = { x: margin, y: maxBottom + gap };
    }
    n.x = pos.x;
    n.y = pos.y;
    placed.push({ x: pos.x, y: pos.y, w, h });
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
  if (name === 'reminder') syncSettingsInputs();
  if (name === 'sort') renderSortPanel();
  if (name === 'backup') { const el = $('#backupDir'); if (el) el.value = state.settings.backupDir || ''; }
  if (name === 'trash') renderTrashPanel();
  if (name === 'about') syncSettingsInputs();
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
  $('#viewDoc').onclick = () => setViewMode('doc');

  $('#btnPin').onclick = () => {
    state.settings.alwaysOnTop = !state.settings.alwaysOnTop;
    applyTheme();
    save();
  };

  $('#btnMin').onclick = () => window.api.minimize();
  $('#btnMax').onclick = () => window.api.maximize();
  $('#btnClose').onclick = () => window.api.close();

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
        state.notes.forEach((n) => {
          if (!n.id) n.id = uid();
          if (!n.items) n.items = [];
          if (!n.images) n.images = [];
          if (!n.files) n.files = [];
          if (!n.tables) n.tables = [];
          const content = n.content || '';
          const missing = (n.images || []).filter((im) => content.indexOf('[[img:' + im.id + ']]') === -1);
          if (missing.length) n.content = content + (content ? '\n' : '') + missing.map((im) => '[[img:' + im.id + ']]').join('');
        });
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
  $('#noteColorInput').addEventListener('input', (e) => { state.settings.noteColor = e.target.value; });
  $('#noteColorInput').addEventListener('change', save);
  $('#btnResetNoteColor').onclick = () => {
    state.settings.noteColor = DEFAULT_NOTE_COLOR;
    syncSettingsInputs();
    save();
    toast(t('toast_note_bg_reset'));
  };
  $('#winOpacity').addEventListener('input', (e) => { state.settings.winOpacity = Number(e.target.value); applyTheme(); });
  $('#winOpacity').addEventListener('change', save);
  $('#fontSize').addEventListener('input', (e) => { state.settings.fontSize = Number(e.target.value); applyTheme(); });
  $('#fontSize').addEventListener('change', (e) => { state.settings.fontSize = Number(e.target.value); save(); window.api.setFontSize(Number(e.target.value)); });
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
  $('#topBarAcrylicToggle').addEventListener('change', (e) => {
    state.settings.topBarAcrylic = e.target.checked;
    if (e.target.checked && (state.settings.topBarOpacity == null || state.settings.topBarOpacity >= 100)) {
      state.settings.topBarOpacity = 25;
    } else if (!e.target.checked) {
      state.settings.topBarOpacity = 100;
    }
    syncSettingsInputs();
    applyTheme();
    save();
  });
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

  $('#btnDefaultTheme').onclick = () => {
    const def = PRESETS.find((p) => p.id === DEFAULT_THEME_ID) || PRESETS[0];
    state.settings.themeId = def.id;
    state.settings.canvasColor = null;
    state.settings.accent = def.accent;
    state.settings.appearanceMode = 'auto';
    syncSettingsInputs();
    renderThemePanel();
    applyTheme();
    save();
    toast(t('toast_theme_updated'));
  };

  $('#glassToggle').addEventListener('change', (e) => { state.settings.glass = e.target.checked; applyTheme(); save(); });
  $('#desktopMicaToggle').addEventListener('change', (e) => { state.settings.desktopMica = e.target.checked; applyTheme(); save(); });
  $('#markdownToggle').addEventListener('change', (e) => { state.settings.markdown = e.target.checked; renderAll(); save(); });
  $('#highlightColorInput').addEventListener('input', (e) => { state.settings.highlightColor = e.target.value; applyTheme(); });
  $('#highlightColorInput').addEventListener('change', save);

  // 外观模块切换
  $$('#appearanceModuleSeg .seg').forEach((b) => {
    b.onclick = () => {
      $$('#appearanceModuleSeg .seg').forEach((x) => x.classList.toggle('active', x === b));
      const isMain = b.dataset.appModule === 'main';
      const mainEl = $('#appModuleMain');
      const noteEl = $('#appModuleNote');
      if (mainEl) mainEl.classList.toggle('hidden', !isMain);
      if (noteEl) noteEl.classList.toggle('hidden', isMain);
    };
  });

  // 提醒设置
  $('#reminderSoundToggle').addEventListener('change', (e) => { state.settings.reminderSound = e.target.checked; save(); });
  $('#reminderVolume').addEventListener('input', (e) => { state.settings.reminderVolume = Number(e.target.value); });
  $('#reminderVolume').addEventListener('change', save);
  $('#btnPickSound').onclick = async () => {
    const r = await window.api.pickSound();
    if (r.ok) {
      state.settings.reminderSoundPath = r.url;
      state.settings.reminderSoundName = r.name;
      syncSettingsInputs();
      save();
      toast(t('toast_sound_set'));
    } else if (!r.canceled) {
      toast(t('toast_set_fail') + r.error);
    }
  };
  $('#btnClearSound').onclick = () => {
    state.settings.reminderSoundPath = null;
    state.settings.reminderSoundName = null;
    syncSettingsInputs();
    save();
    toast(t('toast_sound_cleared'));
  };
  $('#btnTestSound').onclick = () => {
    previewReminderSound();
  };

  // 待办提醒弹窗
  $('#btnReminderCancel').onclick = closeReminder;
  $('#reminderOverlay').onclick = (e) => { if (e.target.id === 'reminderOverlay') closeReminder(); };

  // 闹铃提醒弹窗
  $('#btnAlarmDismiss').onclick = dismissAlarm;
  $('#alarmOverlay').onclick = (e) => { if (e.target.id === 'alarmOverlay') dismissAlarm(); };
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
  wireMemoListDnd();

  // 阻止拖入文件/链接时浏览器默认导航（否则会打开空白窗口）
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('drop', (e) => { e.preventDefault(); });

  document.addEventListener('mousedown', (e) => {
    if (savedRange) return;
    const t = e.target;
    if (!(t && t.nodeType === 1 && t.closest('.t-image, .doc-fmt-btn, .t-color'))) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const node = sel.anchorNode;
    if (!node) return;
    const content = node.nodeType === 1
      ? node.closest('.note-content, .doc-content')
      : (node.parentElement && node.parentElement.closest('.note-content, .doc-content'));
    if (!content) return;
    savedRange = sel.getRangeAt(0).cloneRange();
    savedSelText = sel.toString();
    const noteEl = content.closest('[data-id]');
    savedNoteId = noteEl ? noteEl.dataset.id : (docNoteId || null);
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.inline-img')) {
      $$('.inline-img.selected').forEach((x) => x.classList.remove('selected'));
    }
    if (activeTableEl && !activeTableEl.contains(e.target) && !(activeTableToolbar && activeTableToolbar.contains(e.target))) {
      deselectTable();
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
      if (!n.files) n.files = [];
      if (!n.tables) n.tables = [];
      // 迁移：旧版便签图片未写入内容标记，补到内容末尾（保持可见）
      const content = n.content || '';
      const missing = (n.images || []).filter((im) => content.indexOf('[[img:' + im.id + ']]') === -1);
      if (missing.length) {
        n.content = content + (content ? '\n' : '') + missing.map((im) => '[[img:' + im.id + ']]').join('');
      }
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
  $('#viewBoard').classList.toggle('active', state.settings.viewMode !== 'memo' && state.settings.viewMode !== 'todo' && state.settings.viewMode !== 'doc');
  $('#viewMemo').classList.toggle('active', state.settings.viewMode === 'memo');
  $('#viewTodo').classList.toggle('active', state.settings.viewMode === 'todo');
  $('#viewDoc').classList.toggle('active', state.settings.viewMode === 'doc');

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
      showAlarmModal(n);
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

  window.api.onNoteDeleted((id) => {
    const idx = state.notes.findIndex((x) => x.id === id);
    if (idx >= 0) {
      const n = state.notes[idx];
      state.notes.splice(idx, 1);
      state.trash.push({ note: n, deletedAt: Date.now() });
      if (docNoteId === id) docNoteId = null;
      save();
      renderAll();
      renderTrashPanel();
      toast(t('toast_removed'));
    }
  });

  window.api.onReminderSound((info) => {
    playReminderSound(info);
  });

  window.api.onFontSize((v) => {
    if (v && v !== state.settings.fontSize) {
      state.settings.fontSize = v;
      const fs = $('#fontSize');
      if (fs) fs.value = v;
      applyTheme();
    }
  });

  window.addEventListener('beforeunload', () => {
    window.api.saveData({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash });
  });
}

init();
