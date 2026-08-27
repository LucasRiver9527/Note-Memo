/* 纯逻辑模块：颜色、转义、引用清理、排序。
   作为普通 <script> 在页面加载（挂到 window.NoteLogic / 顶层全局），
   也可被 Node 测试 require（module.exports）。单一来源，便于测试。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.NoteLogic = fns;
    // 挂到全局，等价于原来的顶层 function 声明，app.js 可直接按名字调用
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function hexToRgba(hex, alpha) {
    const h = String(hex || '').replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // 相对亮度（WCAG）0~1：颜色越亮越接近 1
  function luminance(hex) {
    const h = String(hex || '').replace('#', '');
    if (h.length < 6) return 0;
    const lin = (c) => {
      const v = parseInt(c, 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const r = lin(h.slice(0, 2)), g = lin(h.slice(2, 4)), b = lin(h.slice(4, 6));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // WCAG 对比度 1~21（两种颜色）
  function contrastRatio(a, b) {
    const l1 = luminance(a), l2 = luminance(b);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  // ---- 国际化单一来源（由脚本从 app.js/note.js 提取并合并，勿手改键值） ----
  const I18N = {
  "zh": {
    "app_name": "便签",
    "settings_title": "⚙ 全局设置",
    "tab_appearance": "🎨 外观",
    "tab_font": "🔤 字体",
    "tab_sort": "↕ 排序",
    "tab_backup": "⬇ 备份",
    "tab_trash": "🗑 回收站",
    "tab_data": "📦 数据",
    "mode": "模式",
    "mode_auto": "跟随主题",
    "mode_light": "普通（浅色）",
    "mode_dark": "夜间（深色）",
    "theme": "主题",
    "accent": "强调色",
    "custom": "自定义",
    "note_appearance": "便签外观",
    "note_opacity": "便签不透明度",
    "note_style": "便签样式",
    "note_radius": "圆角",
    "note_shadow": "阴影",
    "note_border_width": "边框粗细",
    "note_border_color": "边框颜色",
    "note_style_hint": "圆角、阴影、边框实时作用于所有便签卡片。",
    "font_letter_spacing": "字体字距",
    "win_opacity": "窗口不透明度",
    "note_bg": "新建便签底色",
    "canvas_bg": "画布背景",
    "bg_color": "背景色",
    "bg_image": "背景图片",
    "bg_readability": "背景可读性增强",
    "bg_readability_hint": "背景偏亮或较复杂时提升对比保证界面与便签文字清晰，尽量保留背景原色。",
    "bg_fill": "填充",
    "bg_fit": "适应",
    "bg_stretch": "拉伸",
    "bg_tile": "平铺",
    "bg_center": "居中",
    "pick_image": "选择图片…",
    "clear_image": "清除图片",
    "topbar_bg": "标题栏与操作栏",
    "topbar_color": "顶部区域底色",
    "topbar_opacity": "顶部区域透明度",
    "topbar_acrylic": "顶部区域亚克力模糊",
    "topbar_follow_hint": "标题栏、筛选栏、批量选中操作栏共用此配色（颜色 / 透明度 / 亚克力模糊）",
    "bg_win_opacity": "背景 / 窗口",
    "bg_opacity": "背景图片透明度",
    "todo_area": "待办区",
    "todo_area_hint": "待办区各区域底色默认跟随主题，可自定义颜色与透明度。",
    "search_bg": "搜索框底色",
    "search_opacity": "搜索框透明度",
    "items_bg": "待办事项底色",
    "items_opacity": "待办事项透明度",
    "remind_bg": "时间待办底色",
    "remind_opacity": "时间待办透明度",
    "reset_todo": "恢复待办区默认（跟随主题）",
    "reset_theme": "恢复默认外观",
    "default_theme": "恢复默认主题",
    "reset_note_bg": "恢复默认便签底色",
    "effects": "效果",
    "glass": "便签玻璃拟态",
    "effects_hint": "开启后便签呈现半透明磨砂质感，默认关闭。",
    "font_family": "字体",
    "font_size": "字体大小",
    "font_color": "字体颜色",
    "font_color_hint": "字体颜色应用到便签内容与界面文字；选择默认则跟随主题。",
    "font_color_follow": "跟随主题",
    "custom_fonts": "自定义字体",
    "custom_fonts_hint": "可导入你下载的字体文件（.ttf/.otf/.woff），内置字体不可删除。",
    "add_font": "添加字体",
    "sort_mode": "排序方式",
    "sort_custom": "自定义顺序",
    "sort_updated": "按更新时间",
    "sort_created": "按创建时间",
    "sort_title": "按标题",
    "sort_color": "按颜色",
    "sort_hint": "排序在「备忘录」和「待办」视图中生效；选择「自定义顺序」后可拖动下方便签调整顺序。",
    "custom_order": "自定义顺序",
    "sort_scope": "排序范围",
    "sort_scope_all": "全部（全局）",
    "sort_group_hint": "选择分组后可各自调整该分组的顺序；「全部」视图使用全局顺序。",
    "canvas_zoom_in": "放大",
    "canvas_zoom_out": "缩小",
    "canvas_zoom_reset": "重置缩放",
    "canvas_zoom_toggle": "画布缩放 / 平移",
    "canvas_zoom_toggle_close": "收起",
    "canvas_pan_hint": "按住空格拖动、或按住鼠标中键平移画布",
    "board_new_note": "新建便签",
    "board_new_todo": "新建待办",
    "board_paste_note": "粘贴文本为新便签",
    "board_arrange": "一键整理全部",
    "recent_groups": "最近使用",
    "group_collapse": "折叠分组",
    "group_expand": "展开分组",
    "group_collapsed": "已折叠",
    "tab_shortcuts": "⌨ 快捷键",
    "shortcuts_title": "快捷键",
    "shortcuts_hint": "点击下方的快捷键即可重新按键更改。全局快捷键在应用最小化/隐藏时也生效；编辑快捷键仅在编辑器内生效。若被系统或其它应用占用将无法保存。",
    "shortcut_toggle_window": "唤起 / 隐藏主窗口",
    "shortcut_create_note": "新建便签",
    "shortcut_bold": "加粗",
    "shortcut_highlight": "高亮",
    "shortcut_align_left": "左对齐",
    "shortcut_align_center": "居中",
    "shortcut_align_right": "右对齐",
    "shortcut_copy_image": "复制选中图片",
    "shortcut_scope_global": "全局（系统级）",
    "shortcut_scope_editor": "编辑器",
    "shortcut_scope_app": "应用",
    "shortcut_undo": "撤销",
    "shortcut_redo": "重做",
    "shortcut_press_keys": "请按键…",
    "shortcut_invalid": "需含修饰键",
    "shortcut_failed": "快捷键被占用，无法应用：{n}",
    "shortcut_unknown_error": "未知错误",
    "shortcuts_reset": "♻ 恢复默认快捷键",
    "shortcut_reset_done": "已恢复默认快捷键",
    "save_current_order": "💾 保存当前排序",
    "toast_sort_saved": "已保存为自定义排序",
    "backup_folder": "备份文件夹",
    "backup_hint": "设置一个专门的备份文件夹，「一键导出」会把备份文件保存到该文件夹内。",
    "backup_dir_placeholder": "默认：应用数据目录/backups",
    "choose": "选择…",
    "backup_now": "⬇ 一键导出",
    "open_folder": "打开文件夹",
    "more": "更多",
    "export_as": "导出到指定位置…",
    "import": "导入备份…",
    "cleanup_media": "🧹 清理未引用媒体",
    "recycle_bin": "回收站",
    "keep_days": "保留天数",
    "forever": "永久保留",
    "trash_hint": "删除的便签会先进入回收站，超过保留天数后自动彻底删除。",
    "empty_trash": "🗑 清空回收站",
    "language": "语言",
    "organize": "整理与清空",
    "system": "系统",
    "auto_start": "开机时自动启动便签",
    "auto_start_hint": "登录 Windows 后自动启动便签（默认关闭）。",
    "arrange": "▦ 整理排列便签",
    "clear_all": "🗑 清空全部便签",
    "clear_all_hint": "清空全部便签会将其移入回收站，可在回收站中恢复。",
    "new_note": "＋ 新建",
    "new_note_tip": "新建便签 (Ctrl+Shift+N)",
    "quick_arrange": "⚡ 一键整理",
    "batch_select": "☑ 批量选中",
    "batch_exit": "✕ 退出批量",
    "batch_delete": "🗑 批量删除",
    "batch_move": "🏷 移动到分组",
    "batch_select_all": "全选",
    "batch_clear_sel": "取消选择",
    "batch_selected_count": "已选 {n} 项",
    "toast_batch_deleted": "已删除 {n} 张便签",
    "toast_batch_moved": "已移动 {n} 张便签",
    "global_settings": "全局设置",
    "always_on_top": "窗口置顶",
    "minimize": "最小化",
    "maximize": "最大化",
    "restore": "还原",
    "close": "关闭到托盘",
    "close_title": "关闭便签",
    "close_ask": "彻底退出应用，还是最小化隐藏到任务栏（托盘）继续运行？",
    "close_hide": "隐藏到任务栏（托盘）",
    "close_quit": "退出应用",
    "search": "搜索便签…",
    "clear": "清除",
    "all": "全部",
    "ungrouped": "未分组",
    "archive_view": "归档",
    "ctx_menu_opacity": "菜单透明度",
    "ctx_menu_acrylic": "亚克力",
    "chips_scroll_left": "向左滚动分组",
    "chips_scroll_right": "向右滚动分组",
    "group_suggest": "建议分组",
    "add_group": "＋ 分组",
    "new_group": "新建分组",
    "board_view": "便签视图",
    "memo_view": "备忘录视图",
    "todo_view": "待办区",
    "no_notes": "还没有便签",
    "no_notes_sub": "双击空白处或点击右上角「＋ 新建」创建",
    "note_title": "标题",
    "note_content": "写点什么…",
    "todo_ph": "待办…",
    "add_todo": "＋ 添加待办",
    "pin": "置顶",
    "todo_mode": "待办模式",
    "add_to_group": "加入分组",
    "remove_from_group": "退出分组",
    "desktop": "钉在桌面",
    "todo_remind": "待办提醒",
    "color": "颜色",
    "delete": "删除",
    "undo": "撤销",
    "redo": "重做",
    "toast_save_failed": "保存失败，请检查磁盘/权限",
    "toast_load_failed": "读取数据失败，可能已回退到默认数据",
    "note_archive": "归档",
    "note_unarchive": "取消归档",
    "note_preview": "预览",
    "note_preview_off": "退出预览",
    "toast_archived": "已归档（归档视图可见）",
    "toast_unarchived": "已取消归档",
    "insert_image": "插入图片",
    "delete_image": "删除图片",
    "img_missing": "图片已丢失",
    "resize_image": "拖动调整大小",
    "set_group": "点击设置分组",
    "drag_sort": "拖动排序",
    "set_todo_time": "设置待办时间",
    "cancel": "取消",
    "ok": "确定",
    "todo_items": "待办事项",
    "time_todos": "时间待办",
    "add_todo_ph": "添加待办，回车确认…",
    "add": "添加",
    "untitled": "未命名便签",
    "open_note": "打开便签",
    "delete_todo": "删除待办",
    "clear_time": "清除时间待办",
    "overdue": "已逾期",
    "no_todos": "暂无待办事项，点击右上「＋ 新建」或在上方输入添加",
    "no_reminders": "暂无时间待办，在便签上点击 ⏰ 设置",
    "delete_group": "删除分组",
    "rename_group": "重命名分组",
    "group_name": "分组名称",
    "change_color": "修改颜色",
    "custom_bg": "自定义底色",
    "text_color": "文字颜色",
    "font": "字体",
    "default_color": "默认颜色",
    "follow_global": "跟随全局",
    "new_theme": "＋ 新建主题",
    "edit_theme": "编辑主题",
    "create_theme": "新建主题",
    "theme_name": "主题名称",
    "base_mode": "基础模式",
    "my_theme": "我的主题",
    "canvas_bg_color": "画布背景色",
    "note_color_1": "便签色 1",
    "note_color_2": "便签色 2",
    "save": "保存",
    "toast_pinned": "已钉在桌面",
    "toast_unpin": "已退出分组",
    "toast_group_created": "分组已创建",
    "toast_group_deleted": "分组已删除",
    "toast_removed": "已移入回收站",
    "toast_restored": "已恢复便签",
    "toast_trash_empty": "回收站已清空",
    "toast_theme_deleted": "主题已删除",
    "toast_theme_updated": "主题已更新",
    "toast_theme_created": "主题已创建",
    "toast_note_bg_reset": "已恢复默认便签底色",
    "toast_bg_set": "背景图片已设置",
    "toast_bg_cleared": "已清除背景图片",
    "toast_reset": "已恢复默认外观",
    "toast_todo_set": "待办已设置",
    "toast_todo_added": "已添加待办",
    "toast_todo_created": "已新建待办，可设置待办时间",
    "toast_paste_empty": "剪贴板没有可粘贴的文本",
    "toast_reminder": "待办提醒：",
    "toast_arranged": "已一键整理",
    "toast_arranged_menu": "已整理排列",
    "toast_moved_trash": "已移入回收站",
    "toast_todo_reset": "待办区已恢复跟随主题",
    "toast_img_pasted": "图片已粘贴",
    "toast_img_copied": "图片已复制",
    "toast_img_saved_fail": "图片保存失败：",
    "toast_exported": "已导出：",
    "toast_export_fail": "导出失败：",
    "export_markdown": "导出为 Markdown",
    "toast_backup_ok": "已备份：",
    "toast_backup_fail": "备份失败：",
    "toast_cleanup_ok": "已清理 {n} 个未引用文件，释放 {m} MB",
    "toast_cleanup_fail": "清理失败：",
    "toast_imported": "导入成功",
    "toast_import_fail": "导入失败：",
    "toast_font_added": "字体已添加",
    "toast_font_deleted": "字体已删除",
    "confirm_import_title": "导入备份",
    "confirm_import_msg": "导入将覆盖当前全部便签与设置，确定继续？",
    "confirm_cleanup_title": "清理未引用媒体",
    "confirm_cleanup_msg": "将删除不再被任何便签、回收站或设置引用的图片/字体/背景/音频文件。此操作不可撤销，确定吗？",
    "confirm_clear_all_title": "清空全部",
    "confirm_clear_all_msg": "确定将所有便签移入回收站？可在回收站中恢复。",
    "confirm_empty_trash_title": "清空回收站",
    "confirm_empty_trash_msg": "确定彻底删除回收站中的所有便签？此操作不可撤销。",
    "update_available_title": "发现新版本",
    "update_available_msg": "发现新版本 v{v}，是否下载更新？",
    "update_ready_title": "更新已就绪",
    "update_ready_msg": "新版本 v{v} 已下载完成，重启即可安装。现在就重启吗？",
    "check_update": "🔄 检查更新",
    "checking_update": "正在检查更新…",
    "up_to_date": "已是最新版本",
    "check_update_fail": "检查更新失败：",
    "confirm_delete_group_msg": "分组内的便签将变为未分组。",
    "drag_to_sort": "选择「自定义顺序」后可拖动排序",
    "built_in": "内置",
    "today": "今天",
    "open_link": "打开链接",
    "up": "上移",
    "down": "下移",
    "restore_note": "恢复",
    "delete_forever": "彻底删除",
    "deleted_at": "删除于 ",
    "empty_item": "（空）",
    "left_click_filter": "左键筛选 · 右键编辑分组",
    "delete_link": "打开链接",
    "trash_empty": "回收站是空的",
    "toast_set_fail": "设置失败：",
    "copy": "复制",
    "cut": "剪切",
    "paste": "粘贴",
    "select_all": "全选",
    "toast_saved": "已保存",
    "about": "关于",
    "changelog_title": "更新说明",
    "changelog_open": "✨ 查看更新说明",
    "got_it": "知道了",
    "tab_reminder": "⏰ 提醒",
    "tab_about": "ℹ️ 关于",
    "module_main": "主程序外观",
    "module_note": "便签外观",
    "desktop_mica": "桌面便签玻璃拟态",
    "desktop_mica_hint": "钉在桌面的便签使用与应用内一致的半透明磨砂玻璃效果。",
    "markdown_title": "Markdown 格式",
    "markdown_enable": "启用加粗 / 高亮",
    "highlight_color": "高亮颜色",
    "markdown_hint": "编辑时可用 Ctrl+B 加粗、Ctrl+H 高亮，或输入 **加粗** 与 ==高亮==。",
    "doc_view": "文档模式",
    "doc_pick_hint": "选择一个便签以文档方式查看/编辑",
    "doc_back": "← 返回",
    "doc_hint": "支持 Markdown 加粗/高亮、图片与文件链接",
    "bold": "加粗",
    "highlight": "高亮",
    "unbold": "取消加粗",
    "unhighlight": "取消高亮",
    "align_left": "左对齐",
    "align_center": "居中",
    "align_right": "右对齐",
    "insert_table": "插入表格",
    "table_rows": "行数",
    "table_cols": "列数",
    "add_row": "添加行",
    "add_col": "添加列",
    "del_row": "删除行",
    "del_col": "删除列",
    "merge_cells": "合并单元格",
    "split_cell": "拆分单元格",
    "diag_line": "斜分线",
    "del_table": "删除表格",
    "table_settings": "表格设置",
    "tbl_border_color": "边框颜色",
    "tbl_border_width": "边框粗细",
    "diag_tlbr": "左上→右下",
    "diag_trbl": "右上→左下",
    "diag_t1": "上文字",
    "diag_t2": "下文字",
    "diag_remove": "移除斜线",
    "unpin_note": "取消置顶",
    "diag_t_color": "文字颜色",
    "diag_t_size": "文字大小",
    "tbl_text_color": "文字颜色",
    "tbl_text_size": "文字大小",
    "reminder_sound_title": "闹铃声音",
    "reminder_sound_enable": "开启闹铃声音",
    "reminder_sound_hint": "默认关闭。开启后待办提醒到点将播放声音（到点前 15 分钟会阻止系统休眠以确保准时）。",
    "reminder_volume": "闹铃音量",
    "custom_sound": "自定义声音",
    "pick_sound": "选择声音文件",
    "clear_sound": "清除自定义",
    "default_sound": "默认：系统提示音（内置）",
    "test_sound": "▶ 试听",
    "about_info": "软件信息",
    "about_author": "作者",
    "about_license": "协议",
    "about_repo": "开源地址",
    "about_desc": "美观可定制的 Windows 桌面便签。",
    "toast_sound_set": "已设置闹铃声音",
    "toast_sound_cleared": "已恢复默认提示音",
    "toast_about": "已保存",
    "alarm_title": "闹铃提醒",
    "alarm_dismiss": "关闭闹铃",
    "alarm_snooze_5": "⏱ 5 分钟",
    "alarm_snooze_10": "⏱ 10 分钟",
    "alarm_snooze_30": "⏱ 30 分钟",
    "alarm_snoozed": "稍后再响，将在 {n} 分钟后提醒",
  },
  "en": {
    "app_name": "Notes",
    "settings_title": "⚙ Global Settings",
    "tab_appearance": "🎨 Appearance",
    "tab_font": "🔤 Font",
    "tab_sort": "↕ Sort",
    "tab_backup": "⬇ Backup",
    "tab_trash": "🗑 Recycle Bin",
    "tab_data": "📦 Data",
    "mode": "Mode",
    "mode_auto": "Follow theme",
    "mode_light": "Light",
    "mode_dark": "Dark",
    "theme": "Theme",
    "accent": "Accent",
    "custom": "Custom",
    "note_appearance": "Note appearance",
    "note_opacity": "Note opacity",
    "note_style": "Note style",
    "note_radius": "Corner radius",
    "note_shadow": "Shadow",
    "note_border_width": "Border width",
    "note_border_color": "Border color",
    "note_style_hint": "Corner radius, shadow and border apply to all note cards in real time.",
    "font_letter_spacing": "Letter spacing",
    "win_opacity": "Window opacity",
    "note_bg": "New note background",
    "canvas_bg": "Canvas background",
    "bg_color": "Background color",
    "bg_image": "Background image",
    "bg_readability": "Background readability",
    "bg_readability_hint": "Boosts contrast on bright or busy backgrounds to keep UI & note text readable while preserving the background colors.",
    "bg_fill": "Fill",
    "bg_fit": "Fit",
    "bg_stretch": "Stretch",
    "bg_tile": "Tile",
    "bg_center": "Center",
    "pick_image": "Choose image…",
    "clear_image": "Clear image",
    "topbar_bg": "Title bar & action bars",
    "topbar_color": "Top area color",
    "topbar_opacity": "Top area opacity",
    "topbar_acrylic": "Top area acrylic blur",
    "topbar_follow_hint": "Shared by the title bar, filter bar and batch-select bar (color / opacity / acrylic blur)",
    "bg_win_opacity": "Background / Window",
    "bg_opacity": "Background image opacity",
    "todo_area": "Todo area",
    "todo_area_hint": "Todo area backgrounds follow the theme by default; you can customize color and opacity.",
    "search_bg": "Search box bg",
    "search_opacity": "Search box opacity",
    "items_bg": "Todo items bg",
    "items_opacity": "Todo items opacity",
    "remind_bg": "Reminders bg",
    "remind_opacity": "Reminders opacity",
    "reset_todo": "Reset todo area (follow theme)",
    "reset_theme": "Reset appearance",
    "default_theme": "Restore default theme",
    "reset_note_bg": "Restore default note background",
    "effects": "Effects",
    "glass": "Note glassmorphism",
    "effects_hint": "Makes notes semi-transparent frosted; off by default.",
    "font_family": "Font",
    "font_size": "Font size",
    "font_color": "Font color",
    "font_color_hint": "Font color applies to note content and UI text; default follows the theme.",
    "font_color_follow": "Follow theme",
    "custom_fonts": "Custom fonts",
    "custom_fonts_hint": "Import your own font files (.ttf/.otf/.woff). Built-in fonts cannot be deleted.",
    "add_font": "Add font",
    "sort_mode": "Sort order",
    "sort_custom": "Custom order",
    "sort_updated": "By update time",
    "sort_created": "By create time",
    "sort_title": "By title",
    "sort_color": "By color",
    "sort_hint": "Sorting applies in List and Todo views; choose \"Custom order\" to drag notes below.",
    "custom_order": "Custom order",
    "sort_scope": "Sort scope",
    "sort_scope_all": "All (global)",
    "sort_group_hint": "Select a group to adjust its own order; the All view uses the global order.",
    "canvas_zoom_in": "Zoom in",
    "canvas_zoom_out": "Zoom out",
    "canvas_zoom_reset": "Reset zoom",
    "canvas_zoom_toggle": "Canvas zoom / pan",
    "canvas_zoom_toggle_close": "Collapse",
    "canvas_pan_hint": "Hold Space and drag, or drag with the middle mouse button to pan",
    "board_new_note": "New note",
    "board_new_todo": "New to-do",
    "board_paste_note": "Paste text as a new note",
    "board_arrange": "Arrange all",
    "recent_groups": "Recently used",
    "group_collapse": "Collapse group",
    "group_expand": "Expand group",
    "group_collapsed": "Collapsed",
    "tab_shortcuts": "⌨ Shortcuts",
    "shortcuts_title": "Shortcuts",
    "shortcuts_hint": "Click a shortcut then press new keys to rebind. Global shortcuts work even when the app is minimized/hidden; editor shortcuts only while editing. A shortcut already taken by the system or another app cannot be applied.",
    "shortcut_toggle_window": "Show / Hide main window",
    "shortcut_create_note": "New note",
    "shortcut_bold": "Bold",
    "shortcut_highlight": "Highlight",
    "shortcut_align_left": "Align left",
    "shortcut_align_center": "Align center",
    "shortcut_align_right": "Align right",
    "shortcut_copy_image": "Copy selected image",
    "shortcut_scope_global": "Global (system-wide)",
    "shortcut_scope_editor": "Editor",
    "shortcut_scope_app": "App",
    "shortcut_undo": "Undo",
    "shortcut_redo": "Redo",
    "shortcut_press_keys": "Press keys…",
    "shortcut_invalid": "Needs a modifier",
    "shortcut_failed": "Shortcut taken, could not apply: {n}",
    "shortcut_unknown_error": "Unknown error",
    "shortcuts_reset": "♻ Reset shortcuts",
    "shortcut_reset_done": "Shortcuts reset to defaults",
    "save_current_order": "💾 Save current order",
    "toast_sort_saved": "Saved as custom order",
    "backup_folder": "Backup folder",
    "backup_hint": "Set a dedicated backup folder; \"Export now\" saves backup files into it.",
    "backup_dir_placeholder": "Default: app data dir/backups",
    "choose": "Choose…",
    "backup_now": "⬇ Export now",
    "open_folder": "Open folder",
    "more": "More",
    "export_as": "Export to…",
    "import": "Import…",
    "cleanup_media": "🧹 Clean unused media",
    "recycle_bin": "Recycle Bin",
    "keep_days": "Retention days",
    "forever": "Forever",
    "trash_hint": "Deleted notes go to the recycle bin first, and are permanently removed after the retention period.",
    "empty_trash": "🗑 Empty recycle bin",
    "language": "Language",
    "organize": "Organize & clear",
    "system": "System",
    "auto_start": "Launch MyNotes at login",
    "auto_start_hint": "Start MyNotes automatically after you log in to Windows (off by default).",
    "arrange": "▦ Arrange notes",
    "clear_all": "🗑 Clear all notes",
    "clear_all_hint": "Clearing all notes moves them to the recycle bin, where they can be restored.",
    "new_note": "＋ New",
    "new_note_tip": "New note (Ctrl+Shift+N)",
    "quick_arrange": "⚡ Arrange",
    "batch_select": "☑ Batch select",
    "batch_exit": "✕ Exit batch",
    "batch_delete": "🗑 Delete selected",
    "batch_move": "🏷 Move to group",
    "batch_select_all": "Select all",
    "batch_clear_sel": "Clear selection",
    "batch_selected_count": "{n} selected",
    "toast_batch_deleted": "Deleted {n} notes",
    "toast_batch_moved": "Moved {n} notes",
    "global_settings": "Global Settings",
    "always_on_top": "Always on top",
    "minimize": "Minimize",
    "maximize": "Maximize",
    "restore": "Restore",
    "close": "Close to tray",
    "close_title": "Close Notes",
    "close_ask": "Quit the app completely, or keep it running in the taskbar / tray?",
    "close_hide": "Hide to tray",
    "close_quit": "Quit app",
    "search": "Search notes…",
    "clear": "Clear",
    "all": "All",
    "ungrouped": "Ungrouped",
    "archive_view": "Archive",
    "ctx_menu_opacity": "Menu opacity",
    "ctx_menu_acrylic": "Acrylic",
    "chips_scroll_left": "Scroll groups left",
    "chips_scroll_right": "Scroll groups right",
    "group_suggest": "Suggested groups",
    "add_group": "＋ Group",
    "new_group": "New group",
    "board_view": "Board view",
    "memo_view": "List view",
    "todo_view": "Todo view",
    "no_notes": "No notes yet",
    "no_notes_sub": "Double-click a blank area or click ＋ New",
    "note_title": "Title",
    "note_content": "Write something…",
    "todo_ph": "Todo…",
    "add_todo": "＋ Add todo",
    "pin": "Pin",
    "todo_mode": "Todo mode",
    "add_to_group": "Add to group",
    "remove_from_group": "Remove from group",
    "desktop": "Pin to desktop",
    "todo_remind": "Reminder",
    "color": "Color",
    "delete": "Delete",
    "undo": "Undo",
    "redo": "Redo",
    "toast_save_failed": "Save failed, check disk/permissions",
    "toast_load_failed": "Failed to load data, may have fallen back to defaults",
    "note_archive": "Archive",
    "note_unarchive": "Unarchive",
    "note_preview": "Preview",
    "note_preview_off": "Exit preview",
    "toast_archived": "Archived (visible in archive view)",
    "toast_unarchived": "Unarchived",
    "insert_image": "Insert image",
    "delete_image": "Delete image",
    "img_missing": "Image missing",
    "resize_image": "Drag to resize",
    "set_group": "Click to set group",
    "drag_sort": "Drag to sort",
    "set_todo_time": "Set todo time",
    "cancel": "Cancel",
    "ok": "OK",
    "todo_items": "Todo items",
    "time_todos": "Time todos",
    "add_todo_ph": "Add a todo, press Enter…",
    "add": "Add",
    "untitled": "Untitled note",
    "open_note": "Open note",
    "delete_todo": "Delete todo",
    "clear_time": "Clear time",
    "overdue": "Overdue",
    "no_todos": "No todos yet. Click ＋ New or type above to add.",
    "no_reminders": "No time todos yet. Click ⏰ on a note to set one.",
    "delete_group": "Delete group",
    "rename_group": "Rename group",
    "group_name": "Group name",
    "change_color": "Change color",
    "custom_bg": "Custom color",
    "text_color": "Text color",
    "font": "Font",
    "default_color": "Default color",
    "follow_global": "Follow global",
    "new_theme": "＋ New theme",
    "edit_theme": "Edit theme",
    "create_theme": "New theme",
    "theme_name": "Theme name",
    "base_mode": "Base mode",
    "my_theme": "My theme",
    "canvas_bg_color": "Canvas background",
    "note_color_1": "Note color 1",
    "note_color_2": "Note color 2",
    "save": "Save",
    "toast_pinned": "Pinned to desktop",
    "toast_unpin": "Removed from group",
    "toast_group_created": "Group created",
    "toast_group_deleted": "Group deleted",
    "toast_removed": "Moved to recycle bin",
    "toast_restored": "Note restored",
    "toast_trash_empty": "Recycle bin emptied",
    "toast_theme_deleted": "Theme deleted",
    "toast_theme_updated": "Theme updated",
    "toast_theme_created": "Theme created",
    "toast_note_bg_reset": "Default note background restored",
    "toast_bg_set": "Background image set",
    "toast_bg_cleared": "Background image cleared",
    "toast_reset": "Appearance reset",
    "toast_todo_set": "Todo set",
    "toast_todo_added": "Todo added",
    "toast_todo_created": "Todo created, set a time",
    "toast_paste_empty": "Clipboard has no text to paste",
    "toast_reminder": "Reminder: ",
    "toast_arranged": "Arranged",
    "toast_arranged_menu": "Arranged",
    "toast_moved_trash": "Moved to recycle bin",
    "toast_todo_reset": "Todo area follows theme again",
    "toast_img_pasted": "Image pasted",
    "toast_img_copied": "Image copied",
    "toast_img_saved_fail": "Failed to save image: ",
    "toast_exported": "Exported: ",
    "toast_export_fail": "Export failed: ",
    "export_markdown": "Export to Markdown",
    "toast_backup_ok": "Backed up: ",
    "toast_backup_fail": "Backup failed: ",
    "toast_cleanup_ok": "Cleaned {n} unused files, freed {m} MB",
    "toast_cleanup_fail": "Cleanup failed: ",
    "toast_imported": "Imported",
    "toast_import_fail": "Import failed: ",
    "toast_font_added": "Font added",
    "toast_font_deleted": "Font deleted",
    "confirm_import_title": "Import backup",
    "confirm_import_msg": "Importing will overwrite all current notes and settings. Continue?",
    "confirm_cleanup_title": "Clean unused media",
    "confirm_cleanup_msg": "This deletes images/fonts/backgrounds/sounds not referenced by any note, recycle bin, or setting. This cannot be undone. Continue?",
    "confirm_clear_all_title": "Clear all",
    "confirm_clear_all_msg": "Move all notes to the recycle bin? They can be restored there.",
    "confirm_empty_trash_title": "Empty recycle bin",
    "confirm_empty_trash_msg": "Permanently delete all notes in the recycle bin? This cannot be undone.",
    "update_available_title": "Update available",
    "update_available_msg": "A new version v{v} is available. Download now?",
    "update_ready_title": "Update ready",
    "update_ready_msg": "Version v{v} has been downloaded. Restart to install now?",
    "check_update": "🔄 Check for updates",
    "checking_update": "Checking for updates…",
    "up_to_date": "You are up to date",
    "check_update_fail": "Update check failed: ",
    "confirm_delete_group_msg": "Notes in this group will become ungrouped.",
    "drag_to_sort": "Choose \"Custom order\" to drag and sort",
    "built_in": "Built-in",
    "today": "Today",
    "open_link": "Open link",
    "up": "Move up",
    "down": "Move down",
    "restore_note": "Restore",
    "delete_forever": "Delete forever",
    "deleted_at": "Deleted ",
    "empty_item": "(empty)",
    "left_click_filter": "Left-click filter · Right-click edit",
    "delete_link": "Open link",
    "trash_empty": "Recycle bin is empty",
    "toast_set_fail": "Setting failed: ",
    "copy": "Copy",
    "cut": "Cut",
    "paste": "Paste",
    "select_all": "Select all",
    "toast_saved": "Saved",
    "about": "About",
    "changelog_title": "What's New",
    "changelog_open": "✨ View changelog",
    "got_it": "Got it",
    "tab_reminder": "⏰ Reminders",
    "tab_about": "ℹ️ About",
    "module_main": "App appearance",
    "module_note": "Note appearance",
    "desktop_mica": "Desktop note glass",
    "desktop_mica_hint": "Use the same semi-transparent frosted glass effect for desktop-pinned notes.",
    "markdown_title": "Markdown",
    "markdown_enable": "Enable bold / highlight",
    "highlight_color": "Highlight color",
    "markdown_hint": "Use Ctrl+B for bold and Ctrl+H for highlight while editing, or type **bold** and ==highlight==.",
    "doc_view": "Document view",
    "doc_pick_hint": "Pick a note to view/edit as a document",
    "doc_back": "← Back",
    "doc_hint": "Supports Markdown bold/highlight, images and file links",
    "bold": "Bold",
    "highlight": "Highlight",
    "unbold": "Unbold",
    "unhighlight": "Remove highlight",
    "align_left": "Align left",
    "align_center": "Center",
    "align_right": "Align right",
    "insert_table": "Insert table",
    "table_rows": "Rows",
    "table_cols": "Cols",
    "add_row": "Add row",
    "add_col": "Add col",
    "del_row": "Delete row",
    "del_col": "Delete col",
    "merge_cells": "Merge cells",
    "split_cell": "Split cell",
    "diag_line": "Diagonal line",
    "del_table": "Delete table",
    "table_settings": "Table settings",
    "tbl_border_color": "Border color",
    "tbl_border_width": "Border width",
    "diag_tlbr": "TL→BR",
    "diag_trbl": "TR→BL",
    "diag_t1": "Top text",
    "diag_t2": "Bottom text",
    "diag_remove": "Remove",
    "unpin_note": "Unpin",
    "diag_t_color": "Text color",
    "diag_t_size": "Text size",
    "tbl_text_color": "Text color",
    "tbl_text_size": "Text size",
    "reminder_sound_title": "Alarm sound",
    "reminder_sound_enable": "Enable alarm sound",
    "reminder_sound_hint": "Off by default. When enabled, a sound plays when a reminder is due (the system is kept awake within 15 minutes before the due time).",
    "reminder_volume": "Alarm volume",
    "custom_sound": "Custom sound",
    "pick_sound": "Choose sound file",
    "clear_sound": "Clear custom",
    "default_sound": "Default: built-in beep",
    "test_sound": "▶ Test",
    "about_info": "Information",
    "about_author": "Author",
    "about_license": "License",
    "about_repo": "Open-source repo",
    "about_desc": "A beautiful, customizable Windows desktop notes app.",
    "toast_sound_set": "Alarm sound set",
    "toast_sound_cleared": "Default beep restored",
    "toast_about": "Saved",
    "alarm_title": "Reminder",
    "alarm_dismiss": "Dismiss",
    "alarm_snooze_5": "⏱ 5 min",
    "alarm_snooze_10": "⏱ 10 min",
    "alarm_snooze_30": "⏱ 30 min",
    "alarm_snoozed": "Snoozed, reminder in {n} min"
  }
};

  const I18N_MERGED = {
  "zh": {
    "app_name": "便签",
    "settings_title": "⚙ 全局设置",
    "tab_appearance": "🎨 外观",
    "tab_font": "🔤 字体",
    "tab_sort": "↕ 排序",
    "tab_backup": "⬇ 备份",
    "tab_trash": "🗑 回收站",
    "tab_data": "📦 数据",
    "mode": "模式",
    "mode_auto": "跟随主题",
    "mode_light": "普通（浅色）",
    "mode_dark": "夜间（深色）",
    "theme": "主题",
    "accent": "强调色",
    "custom": "自定义",
    "note_appearance": "便签外观",
    "note_opacity": "便签不透明度",
    "note_style": "便签样式",
    "note_radius": "圆角",
    "note_shadow": "阴影",
    "note_border_width": "边框粗细",
    "note_border_color": "边框颜色",
    "note_style_hint": "圆角、阴影、边框实时作用于所有便签卡片。",
    "font_letter_spacing": "字体字距",
    "win_opacity": "窗口不透明度",
    "note_bg": "新建便签底色",
    "canvas_bg": "画布背景",
    "bg_color": "背景色",
    "bg_image": "背景图片",
    "bg_readability": "背景可读性增强",
    "bg_readability_hint": "背景偏亮或较复杂时提升对比保证界面与便签文字清晰，尽量保留背景原色。",
    "bg_fill": "填充",
    "bg_fit": "适应",
    "bg_stretch": "拉伸",
    "bg_tile": "平铺",
    "bg_center": "居中",
    "pick_image": "选择图片…",
    "clear_image": "清除图片",
    "topbar_bg": "标题栏与操作栏",
    "topbar_color": "顶部区域底色",
    "topbar_opacity": "顶部区域透明度",
    "topbar_acrylic": "顶部区域亚克力模糊",
    "topbar_follow_hint": "标题栏、筛选栏、批量选中操作栏共用此配色（颜色 / 透明度 / 亚克力模糊）",
    "bg_win_opacity": "背景 / 窗口",
    "bg_opacity": "背景图片透明度",
    "todo_area": "待办区",
    "todo_area_hint": "待办区各区域底色默认跟随主题，可自定义颜色与透明度。",
    "search_bg": "搜索框底色",
    "search_opacity": "搜索框透明度",
    "items_bg": "待办事项底色",
    "items_opacity": "待办事项透明度",
    "remind_bg": "时间待办底色",
    "remind_opacity": "时间待办透明度",
    "reset_todo": "恢复待办区默认（跟随主题）",
    "reset_theme": "恢复默认外观",
    "default_theme": "恢复默认主题",
    "reset_note_bg": "恢复默认便签底色",
    "effects": "效果",
    "glass": "便签玻璃拟态",
    "effects_hint": "开启后便签呈现半透明磨砂质感，默认关闭。",
    "font_family": "字体",
    "font_size": "字体大小",
    "font_color": "字体颜色",
    "font_color_hint": "字体颜色应用到便签内容与界面文字；选择默认则跟随主题。",
    "font_color_follow": "跟随主题",
    "custom_fonts": "自定义字体",
    "custom_fonts_hint": "可导入你下载的字体文件（.ttf/.otf/.woff），内置字体不可删除。",
    "add_font": "添加字体",
    "sort_mode": "排序方式",
    "sort_custom": "自定义顺序",
    "sort_updated": "按更新时间",
    "sort_created": "按创建时间",
    "sort_title": "按标题",
    "sort_color": "按颜色",
    "sort_hint": "排序在「备忘录」和「待办」视图中生效；选择「自定义顺序」后可拖动下方便签调整顺序。",
    "custom_order": "自定义顺序",
    "sort_scope": "排序范围",
    "sort_scope_all": "全部（全局）",
    "sort_group_hint": "选择分组后可各自调整该分组的顺序；「全部」视图使用全局顺序。",
    "canvas_zoom_in": "放大",
    "canvas_zoom_out": "缩小",
    "canvas_zoom_reset": "重置缩放",
    "canvas_zoom_toggle": "画布缩放 / 平移",
    "canvas_zoom_toggle_close": "收起",
    "canvas_pan_hint": "按住空格拖动、或按住鼠标中键平移画布",
    "board_new_note": "新建便签",
    "board_new_todo": "新建待办",
    "board_paste_note": "粘贴文本为新便签",
    "board_arrange": "一键整理全部",
    "recent_groups": "最近使用",
    "group_collapse": "折叠分组",
    "group_expand": "展开分组",
    "group_collapsed": "已折叠",
    "tab_shortcuts": "⌨ 快捷键",
    "shortcuts_title": "快捷键",
    "shortcuts_hint": "点击下方的快捷键即可重新按键更改。全局快捷键在应用最小化/隐藏时也生效；编辑快捷键仅在编辑器内生效。若被系统或其它应用占用将无法保存。",
    "shortcut_toggle_window": "唤起 / 隐藏主窗口",
    "shortcut_create_note": "新建便签",
    "shortcut_bold": "加粗",
    "shortcut_highlight": "高亮",
    "shortcut_align_left": "左对齐",
    "shortcut_align_center": "居中",
    "shortcut_align_right": "右对齐",
    "shortcut_copy_image": "复制选中图片",
    "shortcut_scope_global": "全局（系统级）",
    "shortcut_scope_editor": "编辑器",
    "shortcut_scope_app": "应用",
    "shortcut_undo": "撤销",
    "shortcut_redo": "重做",
    "shortcut_press_keys": "请按键…",
    "shortcut_invalid": "需含修饰键",
    "shortcut_failed": "快捷键被占用，无法应用：{n}",
    "shortcut_unknown_error": "未知错误",
    "shortcuts_reset": "♻ 恢复默认快捷键",
    "shortcut_reset_done": "已恢复默认快捷键",
    "save_current_order": "💾 保存当前排序",
    "toast_sort_saved": "已保存为自定义排序",
    "backup_folder": "备份文件夹",
    "backup_hint": "设置一个专门的备份文件夹，「一键导出」会把备份文件保存到该文件夹内。",
    "backup_dir_placeholder": "默认：应用数据目录/backups",
    "choose": "选择…",
    "backup_now": "⬇ 一键导出",
    "open_folder": "打开文件夹",
    "more": "更多",
    "export_as": "导出到指定位置…",
    "import": "导入备份…",
    "cleanup_media": "🧹 清理未引用媒体",
    "recycle_bin": "回收站",
    "keep_days": "保留天数",
    "forever": "永久保留",
    "trash_hint": "删除的便签会先进入回收站，超过保留天数后自动彻底删除。",
    "empty_trash": "🗑 清空回收站",
    "language": "语言",
    "organize": "整理与清空",
    "system": "系统",
    "auto_start": "开机时自动启动便签",
    "auto_start_hint": "登录 Windows 后自动启动便签（默认关闭）。",
    "arrange": "▦ 整理排列便签",
    "clear_all": "🗑 清空全部便签",
    "clear_all_hint": "清空全部便签会将其移入回收站，可在回收站中恢复。",
    "new_note": "＋ 新建",
    "new_note_tip": "新建便签 (Ctrl+Shift+N)",
    "quick_arrange": "⚡ 一键整理",
    "batch_select": "☑ 批量选中",
    "batch_exit": "✕ 退出批量",
    "batch_delete": "🗑 批量删除",
    "batch_move": "🏷 移动到分组",
    "batch_select_all": "全选",
    "batch_clear_sel": "取消选择",
    "batch_selected_count": "已选 {n} 项",
    "toast_batch_deleted": "已删除 {n} 张便签",
    "toast_batch_moved": "已移动 {n} 张便签",
    "global_settings": "全局设置",
    "always_on_top": "窗口置顶",
    "minimize": "最小化",
    "maximize": "最大化",
    "restore": "还原",
    "close": "关闭到托盘",
    "close_title": "关闭便签",
    "close_ask": "彻底退出应用，还是最小化隐藏到任务栏（托盘）继续运行？",
    "close_hide": "隐藏到任务栏（托盘）",
    "close_quit": "退出应用",
    "search": "搜索便签…",
    "clear": "清除",
    "all": "全部",
    "ungrouped": "未分组",
    "archive_view": "归档",
    "ctx_menu_opacity": "菜单透明度",
    "ctx_menu_acrylic": "亚克力",
    "chips_scroll_left": "向左滚动分组",
    "chips_scroll_right": "向右滚动分组",
    "group_suggest": "建议分组",
    "add_group": "＋ 分组",
    "new_group": "新建分组",
    "board_view": "便签视图",
    "memo_view": "备忘录视图",
    "todo_view": "待办区",
    "no_notes": "还没有便签",
    "no_notes_sub": "双击空白处或点击右上角「＋ 新建」创建",
    "note_title": "标题",
    "note_content": "写点什么…",
    "todo_ph": "待办…",
    "add_todo": "＋ 添加待办",
    "pin": "置顶",
    "todo_mode": "待办模式",
    "add_to_group": "加入分组",
    "remove_from_group": "退出分组",
    "desktop": "钉在桌面",
    "todo_remind": "待办提醒",
    "color": "改变颜色",
    "delete": "删除",
    "undo": "撤销",
    "redo": "重做",
    "toast_save_failed": "保存失败，请检查磁盘/权限",
    "toast_load_failed": "读取数据失败，可能已回退到默认数据",
    "note_archive": "归档",
    "note_unarchive": "取消归档",
    "note_preview": "预览",
    "note_preview_off": "退出预览",
    "toast_archived": "已归档（归档视图可见）",
    "toast_unarchived": "已取消归档",
    "insert_image": "插入图片",
    "delete_image": "删除图片",
    "img_missing": "图片已丢失",
    "resize_image": "拖动调整大小",
    "set_group": "点击设置分组",
    "drag_sort": "拖动排序",
    "set_todo_time": "设置待办时间",
    "cancel": "取消",
    "ok": "确定",
    "todo_items": "待办事项",
    "time_todos": "时间待办",
    "add_todo_ph": "添加待办，回车确认…",
    "add": "添加",
    "untitled": "未命名便签",
    "open_note": "打开便签",
    "delete_todo": "删除待办",
    "clear_time": "清除时间待办",
    "overdue": "已逾期",
    "no_todos": "暂无待办事项，点击右上「＋ 新建」或在上方输入添加",
    "no_reminders": "暂无时间待办，在便签上点击 ⏰ 设置",
    "delete_group": "删除分组",
    "rename_group": "重命名分组",
    "group_name": "分组名称",
    "change_color": "修改颜色",
    "custom_bg": "自定义底色",
    "text_color": "文字颜色",
    "font": "字体",
    "default_color": "默认颜色",
    "follow_global": "跟随全局",
    "new_theme": "＋ 新建主题",
    "edit_theme": "编辑主题",
    "create_theme": "新建主题",
    "theme_name": "主题名称",
    "base_mode": "基础模式",
    "my_theme": "我的主题",
    "canvas_bg_color": "画布背景色",
    "note_color_1": "便签色 1",
    "note_color_2": "便签色 2",
    "save": "保存",
    "toast_pinned": "已钉在桌面",
    "toast_unpin": "已退出分组",
    "toast_group_created": "分组已创建",
    "toast_group_deleted": "分组已删除",
    "toast_removed": "已移入回收站",
    "toast_restored": "已恢复便签",
    "toast_trash_empty": "回收站已清空",
    "toast_theme_deleted": "主题已删除",
    "toast_theme_updated": "主题已更新",
    "toast_theme_created": "主题已创建",
    "toast_note_bg_reset": "已恢复默认便签底色",
    "toast_bg_set": "背景图片已设置",
    "toast_bg_cleared": "已清除背景图片",
    "toast_reset": "已恢复默认外观",
    "toast_todo_set": "待办已设置",
    "toast_todo_added": "已添加待办",
    "toast_todo_created": "已新建待办，可设置待办时间",
    "toast_paste_empty": "剪贴板没有可粘贴的文本",
    "toast_reminder": "待办提醒：",
    "toast_arranged": "已一键整理",
    "toast_arranged_menu": "已整理排列",
    "toast_moved_trash": "已移入回收站",
    "toast_todo_reset": "待办区已恢复跟随主题",
    "toast_img_pasted": "图片已粘贴",
    "toast_img_copied": "图片已复制",
    "toast_img_saved_fail": "图片保存失败：",
    "toast_exported": "已导出：",
    "toast_export_fail": "导出失败：",
    "export_markdown": "导出为 Markdown",
    "toast_backup_ok": "已备份：",
    "toast_backup_fail": "备份失败：",
    "toast_cleanup_ok": "已清理 {n} 个未引用文件，释放 {m} MB",
    "toast_cleanup_fail": "清理失败：",
    "toast_imported": "导入成功",
    "toast_import_fail": "导入失败：",
    "toast_font_added": "字体已添加",
    "toast_font_deleted": "字体已删除",
    "confirm_import_title": "导入备份",
    "confirm_import_msg": "导入将覆盖当前全部便签与设置，确定继续？",
    "confirm_cleanup_title": "清理未引用媒体",
    "confirm_cleanup_msg": "将删除不再被任何便签、回收站或设置引用的图片/字体/背景/音频文件。此操作不可撤销，确定吗？",
    "confirm_clear_all_title": "清空全部",
    "confirm_clear_all_msg": "确定将所有便签移入回收站？可在回收站中恢复。",
    "confirm_empty_trash_title": "清空回收站",
    "confirm_empty_trash_msg": "确定彻底删除回收站中的所有便签？此操作不可撤销。",
    "update_available_title": "发现新版本",
    "update_available_msg": "发现新版本 v{v}，是否下载更新？",
    "update_ready_title": "更新已就绪",
    "update_ready_msg": "新版本 v{v} 已下载完成，重启即可安装。现在就重启吗？",
    "check_update": "🔄 检查更新",
    "checking_update": "正在检查更新…",
    "up_to_date": "已是最新版本",
    "check_update_fail": "检查更新失败：",
    "confirm_delete_group_msg": "分组内的便签将变为未分组。",
    "drag_to_sort": "选择「自定义顺序」后可拖动排序",
    "built_in": "内置",
    "today": "今天",
    "open_link": "打开链接",
    "up": "上移",
    "down": "下移",
    "restore_note": "恢复",
    "delete_forever": "彻底删除",
    "deleted_at": "删除于 ",
    "empty_item": "（空）",
    "left_click_filter": "左键筛选 · 右键编辑分组",
    "delete_link": "打开链接",
    "trash_empty": "回收站是空的",
    "toast_set_fail": "设置失败：",
    "copy": "复制",
    "cut": "剪切",
    "paste": "粘贴",
    "select_all": "全选",
    "toast_saved": "已保存",
    "about": "关于",
    "changelog_title": "更新说明",
    "changelog_open": "✨ 查看更新说明",
    "got_it": "知道了",
    "tab_reminder": "⏰ 提醒",
    "tab_about": "ℹ️ 关于",
    "module_main": "主程序外观",
    "module_note": "便签外观",
    "desktop_mica": "桌面便签玻璃拟态",
    "desktop_mica_hint": "钉在桌面的便签使用与应用内一致的半透明磨砂玻璃效果。",
    "markdown_title": "Markdown 格式",
    "markdown_enable": "启用加粗 / 高亮",
    "highlight_color": "高亮颜色",
    "markdown_hint": "编辑时可用 Ctrl+B 加粗、Ctrl+H 高亮，或输入 **加粗** 与 ==高亮==。",
    "doc_view": "文档模式",
    "doc_pick_hint": "选择一个便签以文档方式查看/编辑",
    "doc_back": "← 返回",
    "doc_hint": "支持 Markdown 加粗/高亮、图片与文件链接",
    "bold": "加粗",
    "highlight": "高亮",
    "unbold": "取消加粗",
    "unhighlight": "取消高亮",
    "align_left": "左对齐",
    "align_center": "居中",
    "align_right": "右对齐",
    "insert_table": "插入表格",
    "table_rows": "行数",
    "table_cols": "列数",
    "add_row": "添加行",
    "add_col": "添加列",
    "del_row": "删除行",
    "del_col": "删除列",
    "merge_cells": "合并单元格",
    "split_cell": "拆分单元格",
    "diag_line": "斜分线",
    "del_table": "删除表格",
    "table_settings": "表格设置",
    "tbl_border_color": "边框颜色",
    "tbl_border_width": "边框粗细",
    "diag_tlbr": "左上→右下",
    "diag_trbl": "右上→左下",
    "diag_t1": "上文字",
    "diag_t2": "下文字",
    "diag_remove": "移除斜线",
    "unpin_note": "取消置顶",
    "diag_t_color": "文字颜色",
    "diag_t_size": "文字大小",
    "tbl_text_color": "文字颜色",
    "tbl_text_size": "文字大小",
    "reminder_sound_title": "闹铃声音",
    "reminder_sound_enable": "开启闹铃声音",
    "reminder_sound_hint": "默认关闭。开启后待办提醒到点将播放声音（到点前 15 分钟会阻止系统休眠以确保准时）。",
    "reminder_volume": "闹铃音量",
    "custom_sound": "自定义声音",
    "pick_sound": "选择声音文件",
    "clear_sound": "清除自定义",
    "default_sound": "默认：系统提示音（内置）",
    "test_sound": "▶ 试听",
    "about_info": "软件信息",
    "about_author": "作者",
    "about_license": "协议",
    "about_repo": "开源地址",
    "about_desc": "美观可定制的 Windows 桌面便签。",
    "toast_sound_set": "已设置闹铃声音",
    "toast_sound_cleared": "已恢复默认提示音",
    "toast_about": "已保存",
    "alarm_title": "闹铃提醒",
    "alarm_dismiss": "关闭闹铃",
    "alarm_snooze_5": "⏱ 5 分钟",
    "alarm_snooze_10": "⏱ 10 分钟",
    "alarm_snooze_30": "⏱ 30 分钟",
    "alarm_snoozed": "稍后再响，将在 {n} 分钟后提醒",
    "notfound": "便签不存在",
    "unpin": "取消钉住（回到列表）",
    "opacity": "不透明度"
  },
  "en": {
    "app_name": "Notes",
    "settings_title": "⚙ Global Settings",
    "tab_appearance": "🎨 Appearance",
    "tab_font": "🔤 Font",
    "tab_sort": "↕ Sort",
    "tab_backup": "⬇ Backup",
    "tab_trash": "🗑 Recycle Bin",
    "tab_data": "📦 Data",
    "mode": "Mode",
    "mode_auto": "Follow theme",
    "mode_light": "Light",
    "mode_dark": "Dark",
    "theme": "Theme",
    "accent": "Accent",
    "custom": "Custom",
    "note_appearance": "Note appearance",
    "note_opacity": "Note opacity",
    "note_style": "Note style",
    "note_radius": "Corner radius",
    "note_shadow": "Shadow",
    "note_border_width": "Border width",
    "note_border_color": "Border color",
    "note_style_hint": "Corner radius, shadow and border apply to all note cards in real time.",
    "font_letter_spacing": "Letter spacing",
    "win_opacity": "Window opacity",
    "note_bg": "New note background",
    "canvas_bg": "Canvas background",
    "bg_color": "Background color",
    "bg_image": "Background image",
    "bg_readability": "Background readability",
    "bg_readability_hint": "Boosts contrast on bright or busy backgrounds to keep UI & note text readable while preserving the background colors.",
    "bg_fill": "Fill",
    "bg_fit": "Fit",
    "bg_stretch": "Stretch",
    "bg_tile": "Tile",
    "bg_center": "Center",
    "pick_image": "Choose image…",
    "clear_image": "Clear image",
    "topbar_bg": "Title bar & action bars",
    "topbar_color": "Top area color",
    "topbar_opacity": "Top area opacity",
    "topbar_acrylic": "Top area acrylic blur",
    "topbar_follow_hint": "Shared by the title bar, filter bar and batch-select bar (color / opacity / acrylic blur)",
    "bg_win_opacity": "Background / Window",
    "bg_opacity": "Background image opacity",
    "todo_area": "Todo area",
    "todo_area_hint": "Todo area backgrounds follow the theme by default; you can customize color and opacity.",
    "search_bg": "Search box bg",
    "search_opacity": "Search box opacity",
    "items_bg": "Todo items bg",
    "items_opacity": "Todo items opacity",
    "remind_bg": "Reminders bg",
    "remind_opacity": "Reminders opacity",
    "reset_todo": "Reset todo area (follow theme)",
    "reset_theme": "Reset appearance",
    "default_theme": "Restore default theme",
    "reset_note_bg": "Restore default note background",
    "effects": "Effects",
    "glass": "Note glassmorphism",
    "effects_hint": "Makes notes semi-transparent frosted; off by default.",
    "font_family": "Font",
    "font_size": "Font size",
    "font_color": "Font color",
    "font_color_hint": "Font color applies to note content and UI text; default follows the theme.",
    "font_color_follow": "Follow theme",
    "custom_fonts": "Custom fonts",
    "custom_fonts_hint": "Import your own font files (.ttf/.otf/.woff). Built-in fonts cannot be deleted.",
    "add_font": "Add font",
    "sort_mode": "Sort order",
    "sort_custom": "Custom order",
    "sort_updated": "By update time",
    "sort_created": "By create time",
    "sort_title": "By title",
    "sort_color": "By color",
    "sort_hint": "Sorting applies in List and Todo views; choose \"Custom order\" to drag notes below.",
    "custom_order": "Custom order",
    "sort_scope": "Sort scope",
    "sort_scope_all": "All (global)",
    "sort_group_hint": "Select a group to adjust its own order; the All view uses the global order.",
    "canvas_zoom_in": "Zoom in",
    "canvas_zoom_out": "Zoom out",
    "canvas_zoom_reset": "Reset zoom",
    "canvas_zoom_toggle": "Canvas zoom / pan",
    "canvas_zoom_toggle_close": "Collapse",
    "canvas_pan_hint": "Hold Space and drag, or drag with the middle mouse button to pan",
    "board_new_note": "New note",
    "board_new_todo": "New to-do",
    "board_paste_note": "Paste text as a new note",
    "board_arrange": "Arrange all",
    "recent_groups": "Recently used",
    "group_collapse": "Collapse group",
    "group_expand": "Expand group",
    "group_collapsed": "Collapsed",
    "tab_shortcuts": "⌨ Shortcuts",
    "shortcuts_title": "Shortcuts",
    "shortcuts_hint": "Click a shortcut then press new keys to rebind. Global shortcuts work even when the app is minimized/hidden; editor shortcuts only while editing. A shortcut already taken by the system or another app cannot be applied.",
    "shortcut_toggle_window": "Show / Hide main window",
    "shortcut_create_note": "New note",
    "shortcut_bold": "Bold",
    "shortcut_highlight": "Highlight",
    "shortcut_align_left": "Align left",
    "shortcut_align_center": "Align center",
    "shortcut_align_right": "Align right",
    "shortcut_copy_image": "Copy selected image",
    "shortcut_scope_global": "Global (system-wide)",
    "shortcut_scope_editor": "Editor",
    "shortcut_scope_app": "App",
    "shortcut_undo": "Undo",
    "shortcut_redo": "Redo",
    "shortcut_press_keys": "Press keys…",
    "shortcut_invalid": "Needs a modifier",
    "shortcut_failed": "Shortcut taken, could not apply: {n}",
    "shortcut_unknown_error": "Unknown error",
    "shortcuts_reset": "♻ Reset shortcuts",
    "shortcut_reset_done": "Shortcuts reset to defaults",
    "save_current_order": "💾 Save current order",
    "toast_sort_saved": "Saved as custom order",
    "backup_folder": "Backup folder",
    "backup_hint": "Set a dedicated backup folder; \"Export now\" saves backup files into it.",
    "backup_dir_placeholder": "Default: app data dir/backups",
    "choose": "Choose…",
    "backup_now": "⬇ Export now",
    "open_folder": "Open folder",
    "more": "More",
    "export_as": "Export to…",
    "import": "Import…",
    "cleanup_media": "🧹 Clean unused media",
    "recycle_bin": "Recycle Bin",
    "keep_days": "Retention days",
    "forever": "Forever",
    "trash_hint": "Deleted notes go to the recycle bin first, and are permanently removed after the retention period.",
    "empty_trash": "🗑 Empty recycle bin",
    "language": "Language",
    "organize": "Organize & clear",
    "system": "System",
    "auto_start": "Launch MyNotes at login",
    "auto_start_hint": "Start MyNotes automatically after you log in to Windows (off by default).",
    "arrange": "▦ Arrange notes",
    "clear_all": "🗑 Clear all notes",
    "clear_all_hint": "Clearing all notes moves them to the recycle bin, where they can be restored.",
    "new_note": "＋ New",
    "new_note_tip": "New note (Ctrl+Shift+N)",
    "quick_arrange": "⚡ Arrange",
    "batch_select": "☑ Batch select",
    "batch_exit": "✕ Exit batch",
    "batch_delete": "🗑 Delete selected",
    "batch_move": "🏷 Move to group",
    "batch_select_all": "Select all",
    "batch_clear_sel": "Clear selection",
    "batch_selected_count": "{n} selected",
    "toast_batch_deleted": "Deleted {n} notes",
    "toast_batch_moved": "Moved {n} notes",
    "global_settings": "Global Settings",
    "always_on_top": "Always on top",
    "minimize": "Minimize",
    "maximize": "Maximize",
    "restore": "Restore",
    "close": "Close to tray",
    "close_title": "Close Notes",
    "close_ask": "Quit the app completely, or keep it running in the taskbar / tray?",
    "close_hide": "Hide to tray",
    "close_quit": "Quit app",
    "search": "Search notes…",
    "clear": "Clear",
    "all": "All",
    "ungrouped": "Ungrouped",
    "archive_view": "Archive",
    "ctx_menu_opacity": "Menu opacity",
    "ctx_menu_acrylic": "Acrylic",
    "chips_scroll_left": "Scroll groups left",
    "chips_scroll_right": "Scroll groups right",
    "group_suggest": "Suggested groups",
    "add_group": "＋ Group",
    "new_group": "New group",
    "board_view": "Board view",
    "memo_view": "List view",
    "todo_view": "Todo view",
    "no_notes": "No notes yet",
    "no_notes_sub": "Double-click a blank area or click ＋ New",
    "note_title": "Title",
    "note_content": "Write something…",
    "todo_ph": "Todo…",
    "add_todo": "＋ Add todo",
    "pin": "Pin",
    "todo_mode": "Todo mode",
    "add_to_group": "Add to group",
    "remove_from_group": "Remove from group",
    "desktop": "Pin to desktop",
    "todo_remind": "Reminder",
    "color": "Change color",
    "delete": "Delete",
    "undo": "Undo",
    "redo": "Redo",
    "toast_save_failed": "Save failed, check disk/permissions",
    "toast_load_failed": "Failed to load data, may have fallen back to defaults",
    "note_archive": "Archive",
    "note_unarchive": "Unarchive",
    "note_preview": "Preview",
    "note_preview_off": "Exit preview",
    "toast_archived": "Archived (visible in archive view)",
    "toast_unarchived": "Unarchived",
    "insert_image": "Insert image",
    "delete_image": "Delete image",
    "img_missing": "Image missing",
    "resize_image": "Drag to resize",
    "set_group": "Click to set group",
    "drag_sort": "Drag to sort",
    "set_todo_time": "Set todo time",
    "cancel": "Cancel",
    "ok": "OK",
    "todo_items": "Todo items",
    "time_todos": "Time todos",
    "add_todo_ph": "Add a todo, press Enter…",
    "add": "Add",
    "untitled": "Untitled note",
    "open_note": "Open note",
    "delete_todo": "Delete todo",
    "clear_time": "Clear time",
    "overdue": "Overdue",
    "no_todos": "No todos yet. Click ＋ New or type above to add.",
    "no_reminders": "No time todos yet. Click ⏰ on a note to set one.",
    "delete_group": "Delete group",
    "rename_group": "Rename group",
    "group_name": "Group name",
    "change_color": "Change color",
    "custom_bg": "Custom color",
    "text_color": "Text color",
    "font": "Font",
    "default_color": "Default color",
    "follow_global": "Follow global",
    "new_theme": "＋ New theme",
    "edit_theme": "Edit theme",
    "create_theme": "New theme",
    "theme_name": "Theme name",
    "base_mode": "Base mode",
    "my_theme": "My theme",
    "canvas_bg_color": "Canvas background",
    "note_color_1": "Note color 1",
    "note_color_2": "Note color 2",
    "save": "Save",
    "toast_pinned": "Pinned to desktop",
    "toast_unpin": "Removed from group",
    "toast_group_created": "Group created",
    "toast_group_deleted": "Group deleted",
    "toast_removed": "Moved to recycle bin",
    "toast_restored": "Note restored",
    "toast_trash_empty": "Recycle bin emptied",
    "toast_theme_deleted": "Theme deleted",
    "toast_theme_updated": "Theme updated",
    "toast_theme_created": "Theme created",
    "toast_note_bg_reset": "Default note background restored",
    "toast_bg_set": "Background image set",
    "toast_bg_cleared": "Background image cleared",
    "toast_reset": "Appearance reset",
    "toast_todo_set": "Todo set",
    "toast_todo_added": "Todo added",
    "toast_todo_created": "Todo created, set a time",
    "toast_paste_empty": "Clipboard has no text to paste",
    "toast_reminder": "Reminder: ",
    "toast_arranged": "Arranged",
    "toast_arranged_menu": "Arranged",
    "toast_moved_trash": "Moved to recycle bin",
    "toast_todo_reset": "Todo area follows theme again",
    "toast_img_pasted": "Image pasted",
    "toast_img_copied": "Image copied",
    "toast_img_saved_fail": "Failed to save image: ",
    "toast_exported": "Exported: ",
    "toast_export_fail": "Export failed: ",
    "export_markdown": "Export to Markdown",
    "toast_backup_ok": "Backed up: ",
    "toast_backup_fail": "Backup failed: ",
    "toast_cleanup_ok": "Cleaned {n} unused files, freed {m} MB",
    "toast_cleanup_fail": "Cleanup failed: ",
    "toast_imported": "Imported",
    "toast_import_fail": "Import failed: ",
    "toast_font_added": "Font added",
    "toast_font_deleted": "Font deleted",
    "confirm_import_title": "Import backup",
    "confirm_import_msg": "Importing will overwrite all current notes and settings. Continue?",
    "confirm_cleanup_title": "Clean unused media",
    "confirm_cleanup_msg": "This deletes images/fonts/backgrounds/sounds not referenced by any note, recycle bin, or setting. This cannot be undone. Continue?",
    "confirm_clear_all_title": "Clear all",
    "confirm_clear_all_msg": "Move all notes to the recycle bin? They can be restored there.",
    "confirm_empty_trash_title": "Empty recycle bin",
    "confirm_empty_trash_msg": "Permanently delete all notes in the recycle bin? This cannot be undone.",
    "update_available_title": "Update available",
    "update_available_msg": "A new version v{v} is available. Download now?",
    "update_ready_title": "Update ready",
    "update_ready_msg": "Version v{v} has been downloaded. Restart to install now?",
    "check_update": "🔄 Check for updates",
    "checking_update": "Checking for updates…",
    "up_to_date": "You are up to date",
    "check_update_fail": "Update check failed: ",
    "confirm_delete_group_msg": "Notes in this group will become ungrouped.",
    "drag_to_sort": "Choose \"Custom order\" to drag and sort",
    "built_in": "Built-in",
    "today": "Today",
    "open_link": "Open link",
    "up": "Move up",
    "down": "Move down",
    "restore_note": "Restore",
    "delete_forever": "Delete forever",
    "deleted_at": "Deleted ",
    "empty_item": "(empty)",
    "left_click_filter": "Left-click filter · Right-click edit",
    "delete_link": "Open link",
    "trash_empty": "Recycle bin is empty",
    "toast_set_fail": "Setting failed: ",
    "copy": "Copy",
    "cut": "Cut",
    "paste": "Paste",
    "select_all": "Select all",
    "toast_saved": "Saved",
    "about": "About",
    "changelog_title": "What's New",
    "changelog_open": "✨ View changelog",
    "got_it": "Got it",
    "tab_reminder": "⏰ Reminders",
    "tab_about": "ℹ️ About",
    "module_main": "App appearance",
    "module_note": "Note appearance",
    "desktop_mica": "Desktop note glass",
    "desktop_mica_hint": "Use the same semi-transparent frosted glass effect for desktop-pinned notes.",
    "markdown_title": "Markdown",
    "markdown_enable": "Enable bold / highlight",
    "highlight_color": "Highlight color",
    "markdown_hint": "Use Ctrl+B for bold and Ctrl+H for highlight while editing, or type **bold** and ==highlight==.",
    "doc_view": "Document view",
    "doc_pick_hint": "Pick a note to view/edit as a document",
    "doc_back": "← Back",
    "doc_hint": "Supports Markdown bold/highlight, images and file links",
    "bold": "Bold",
    "highlight": "Highlight",
    "unbold": "Unbold",
    "unhighlight": "Remove highlight",
    "align_left": "Align left",
    "align_center": "Center",
    "align_right": "Align right",
    "insert_table": "Insert table",
    "table_rows": "Rows",
    "table_cols": "Cols",
    "add_row": "Add row",
    "add_col": "Add col",
    "del_row": "Delete row",
    "del_col": "Delete col",
    "merge_cells": "Merge cells",
    "split_cell": "Split cell",
    "diag_line": "Diagonal line",
    "del_table": "Delete table",
    "table_settings": "Table settings",
    "tbl_border_color": "Border color",
    "tbl_border_width": "Border width",
    "diag_tlbr": "TL→BR",
    "diag_trbl": "TR→BL",
    "diag_t1": "Top text",
    "diag_t2": "Bottom text",
    "diag_remove": "Remove",
    "unpin_note": "Unpin",
    "diag_t_color": "Text color",
    "diag_t_size": "Text size",
    "tbl_text_color": "Text color",
    "tbl_text_size": "Text size",
    "reminder_sound_title": "Alarm sound",
    "reminder_sound_enable": "Enable alarm sound",
    "reminder_sound_hint": "Off by default. When enabled, a sound plays when a reminder is due (the system is kept awake within 15 minutes before the due time).",
    "reminder_volume": "Alarm volume",
    "custom_sound": "Custom sound",
    "pick_sound": "Choose sound file",
    "clear_sound": "Clear custom",
    "default_sound": "Default: built-in beep",
    "test_sound": "▶ Test",
    "about_info": "Information",
    "about_author": "Author",
    "about_license": "License",
    "about_repo": "Open-source repo",
    "about_desc": "A beautiful, customizable Windows desktop notes app.",
    "toast_sound_set": "Alarm sound set",
    "toast_sound_cleared": "Default beep restored",
    "toast_about": "Saved",
    "alarm_title": "Reminder",
    "alarm_dismiss": "Dismiss",
    "alarm_snooze_5": "⏱ 5 min",
    "alarm_snooze_10": "⏱ 10 min",
    "alarm_snooze_30": "⏱ 30 min",
    "alarm_snoozed": "Snoozed, reminder in {n} min",
    "notfound": "Note not found",
    "unpin": "Unpin (back to list)",
    "opacity": "Opacity"
  }
};
  // 翻译查找：table 可缺省（默认 I18N），lang 缺省回退 zh
  function T(key, lang, table) {
    table = table || I18N;
    const d = table[lang] ? table[lang] : (table.zh || {});
    const z = table.zh || {};
    return d[key] || z[key] || key;
  }

  function mergeI18n(a, b) {
    const out = { zh: {}, en: {} };
    for (const lang of ["zh", "en"]) {
      for (const k of Object.keys((a && a[lang]) || {})) out[lang][k] = a[lang][k];
      for (const k of Object.keys((b && b[lang]) || {})) out[lang][k] = b[lang][k];
    }
    return out;
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

  // ---- 便签外观纯逻辑（可单测）：阴影强度映射为 CSS 值 ----
  // 阴影强度：0=默认，1~3 逐级加深 → 基础阴影与 hover 阴影
  function noteShadowCss(strength) {
    const s = Math.max(0, Math.min(3, strength || 0));
    const map = [
      '0 6px 20px rgba(0,0,0,0.22)',
      '0 8px 24px rgba(0,0,0,0.3)',
      '0 12px 34px rgba(0,0,0,0.4)',
      '0 16px 46px rgba(0,0,0,0.5)'
    ];
    return { base: map[s], hover: map[Math.min(s + 1, 3)] };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 收集内容里引用的图/文件/表格 id
  function refIdsOf(n) {
    const ids = new Set();
    const re = /\[\[(?:img|file|table):([a-zA-Z0-9_-]+)\]\]/g;
    let m;
    const s = String((n && n.content) || '');
    while ((m = re.exec(s)) !== null) ids.add(m[1]);
    return ids;
  }

  // 删除内容里已不引用的图/文件/表格
  function cleanupRefs(n) {
    if (!n) return;
    const refs = refIdsOf(n);
    n.images = (n.images || []).filter((im) => refs.has(im.id));
    n.files = (n.files || []).filter((f) => refs.has(f.id));
    n.tables = (n.tables || []).filter((tb) => refs.has(tb.id));
  }

  // 便签排序，settings 传 { sortMode, noteOrder, groupOrders }，groupId 用于按分组的自定义顺序（可选）
  function sortNotes(arr, settings, groupId) {
    const mode = (settings && settings.sortMode) || 'updated';
    let order = (settings && settings.noteOrder) || [];
    if (mode === 'custom' && groupId) {
      const go = (settings && settings.groupOrders) || {};
      order = go[groupId] || [];
    }
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

  // ---------- Markdown 导出（纯函数，主进程与测试均可 require） ----------
  function tableToMarkdown(tbl) {
    const rows = tbl.rows || 0, cols = tbl.cols || 0;
    const cells = tbl.cells || [];
    const merges = tbl.merges || [];
    const diagonals = tbl.diagonals || [];
    const grid = [];
    const occupied = [];
    for (let r = 0; r < rows; r++) { grid.push(new Array(cols).fill('')); occupied.push(new Array(cols).fill(false)); }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (occupied[r][c]) continue;
        const mg = merges.find((m) => m.r === r && m.c === c);
        const diag = diagonals.find((d) => d.r === r && d.c === c);
        let txt = (cells[r] && cells[r][c]) || '';
        if (diag) txt = [diag.t1, diag.t2].filter(Boolean).join(' ');
        grid[r][c] = txt.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
        if (mg) {
          for (let rr = r; rr < r + mg.rowspan; rr++)
            for (let cc = c; cc < c + mg.colspan; cc++)
              if (rr < rows && cc < cols) occupied[rr][cc] = true;
        }
      }
    }
    if (!rows || !cols) return '';
    const lines = [];
    const scr = (arr) => '| ' + arr.map((x) => x.replace(/\n/g, '<br>')).join(' | ') + ' |';
    lines.push(scr(grid[0]));
    lines.push('| ' + grid[0].map(() => '---').join(' | ') + ' |');
    for (let r = 1; r < rows; r++) lines.push(scr(grid[r]));
    return lines.join('\n');
  }

  // noteToMarkdown(note, { image(src)->md } )：把一条便签转成 Markdown 字符串
  function noteToMarkdown(note, opts) {
    opts = opts || {};
    const resolveImg = opts.image || ((src) => src);
    const out = [];
    const title = (note && note.title) || '';
    if (title) out.push('# ' + title);

    // 待办清单
    if (note && note.type === 'todo' && Array.isArray(note.items)) {
      const list = note.items.map((it) => '- [' + (it.done ? 'x' : ' ') + '] ' + (it.text || '')).join('\n');
      out.push(list);
      return out.join('\n\n');
    }

    const imgMap = {}; (note.images || []).forEach((im) => { imgMap[im.id] = im; });
    const fileMap = {}; (note.files || []).forEach((f) => { fileMap[f.id] = f; });
    const tableMap = {}; (note.tables || []).forEach((tb) => { tableMap[tb.id] = tb; });

    let text = String((note && note.content) || '');
    // 颜色 -> 内联 HTML
    text = text.replace(/\[\[c:([^\]]+)\]\]/g, (m, c) => '<span style="color:' + c + '">');
    text = text.replace(/\[\[\/c\]\]/g, '</span>');
    // 高亮 -> <mark>
    text = text.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
    // 图片 / 文件 / 表格引用
    text = text.replace(/\[\[img:([a-zA-Z0-9_-]+)\]\]/g, (m, id) => {
      const im = imgMap[id]; if (!im) return '';
      return '![' + (im.id || 'img') + '](' + resolveImg(im.src || '') + ')';
    });
    text = text.replace(/\[\[file:([a-zA-Z0-9_-]+)\]\]/g, (m, id) => {
      const f = fileMap[id]; if (!f) return '';
      const name = (f.path || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
      return '[' + (name || f.path || 'file') + '](<' + (f.path || '') + '>)';
    });
    text = text.replace(/\[\[table:([a-zA-Z0-9_-]+)\]\]/g, (m, id) => {
      const tb = tableMap[id]; if (!tb) return '';
      return '\n\n' + tableToMarkdown(tb) + '\n\n';
    });

    out.push(text);
    return out.join('\n\n');
  }

  // 收集被引用（仍在使用）的媒体文件名，按目录归类。含回收站，避免误删可恢复数据。
  function referencedMedia(data) {
    const byDir = { images: new Set(), backgrounds: new Set(), fonts: new Set(), sounds: new Set() };
    const add = (url) => {
      if (typeof url !== 'string') return;
      const m = /^note-(img|bg|font|sound):\/\/local\/(.+)$/.exec(url);
      if (!m) return;
      const kind = { img: 'images', bg: 'backgrounds', font: 'fonts', sound: 'sounds' }[m[1]];
      if (byDir[kind]) byDir[kind].add(decodeURIComponent(m[2]));
    };
    const addNote = (n) => { if (n) (n.images || []).forEach((im) => add(im.src)); };
    (data.notes || []).forEach(addNote);
    (data.trash || []).forEach((t) => addNote(t && t.note));
    const s = data.settings || {};
    add(s.backgroundImage);
    (s.customFonts || []).forEach((f) => add(f.url));
    add(s.reminderSoundPath);
    return byDir;
  }

  // 把 \0 分隔的字面文件路径去重收集进 into 数组
  function parseNullSeparated(str, into) {
    (str || '').split('\0').forEach((p) => { if (p && p.length > 1 && !into.includes(p)) into.push(p); });
    return into;
  }

  // 解析 CF_HDROP 缓冲区里的文件路径（视写入格式做 UTF-16 / Latin1 解码）
  function hdropString(buf) {
    if (!buf || buf.length <= 16) return '';
    const pFiles = buf.readUInt32LE(0);
    const fWide = buf.readUInt32LE(16) !== 0;
    return buf.slice(pFiles).toString(fWide ? 'utf16le' : 'latin1');
  }

  // ---------- 渲染层共享（单一来源） ----------
  // 主窗口(app.js)与钉窗(note.js)统一使用这些富文本/表格 HTML 构建函数，
  // 消除两窗口的重复实现。Node 测试亦可 require 验证。
  // 每个窗口在渲染前调用 setRenderLocale({ tr, mdOn }) 注入翻译器与 Markdown 开关；
  // mdOn 传入函数以实时读取当前设置，避免语言/Markdown 切换后失效。
  let _tr = (k) => k;
  let _mdOn = () => true;
  function setRenderLocale(opts) {
    if (opts && typeof opts.tr === 'function') _tr = opts.tr;
    if (opts && typeof opts.mdOn === 'function') _mdOn = opts.mdOn;
  }

  // 清洗拼进内联 style 的值：只保留合法字符，去掉 ; : " ' < > { } 等，防止数据注入样式/属性。
  function sanitizeCss(v) {
    return String(v == null ? '' : v).replace(/[^#\w\s.,%()+\-]/g, '');
  }

  // opts 可缺省；提供 { tr, mdOn } 时覆盖全局 _tr/_mdOn，实现按调用显式控制、无状态依赖。
  function formatInlineText(text, opts) {
    const tr = (opts && opts.tr) || _tr;
    const mdOn = (opts && typeof opts.mdOn === 'function') ? opts.mdOn() : _mdOn();
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
          out += '<span style="color:' + sanitizeCss(cm[1]) + '">' + formatInlineText(inner, opts) + '</span>';
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
          out += `<a class="note-link" contenteditable="false" data-url="${escapeHtml(href)}" title="${tr('open_link')}">${escapeHtml(url)}</a>`;
          i += url.length;
        } else {
          out += escapeHtml(text[i]);
          i += 1;
        }
      }
    }
    return out;
  }

  function inlineImgHtml(img, opts) {
    const tr = (opts && opts.tr) || _tr;
    return `<span class="inline-img" data-img-id="${img.id}" contenteditable="false" tabindex="0"><img src="${escapeHtml(img.src)}" style="width:${img.w || 200}px" /><button class="img-del" title="${tr('delete_image')}">✕</button><div class="img-resize" title="${tr('resize_image')}"></div></span>`;
  }

  function fileLinkHtml(f) {
    const name = (f.path || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    const icon = f.isDir ? '📁' : '📄';
    return `<span class="file-link" contenteditable="false" data-file-id="${f.id}" data-path="${escapeHtml(f.path)}" data-is-dir="${f.isDir ? '1' : '0'}" title="${escapeHtml(f.path)}">${icon} ${escapeHtml(name || f.path)}</span>`;
  }

  function tableBlockHtml(tbl, opts) {
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
        let inner = formatInlineText(text, opts).replace(/\n/g, '<br>');
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
          const ds = (diag.tColor ? 'color:' + sanitizeCss(diag.tColor) + ';' : '') + (diag.tSize ? 'font-size:' + sanitizeCss(diag.tSize) + 'px;' : '');
          inner = `<svg class="diag-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${line}</svg><span class="tbl-t1"${ds ? ' style="' + ds + '"' : ''}>${formatInlineText(diag.t1 || '', opts).replace(/\n/g, '<br>')}</span><span class="tbl-t2"${ds ? ' style="' + ds + '"' : ''}>${formatInlineText(diag.t2 || '', opts).replace(/\n/g, '<br>')}</span>`;
        }
        html += `<td${attrs}${diagCls ? ' class="' + diagCls.trim() + '"' : ''} data-r="${r}" data-c="${c}">${inner}</td>`;
      }
      html += '</tr>';
    }
    const bw = tbl.borderWidth != null ? tbl.borderWidth : 3;
    const bc = sanitizeCss(tbl.borderColor) || 'rgba(0,0,0,0.7)';
    const ts = (tbl.textColor ? 'color:' + sanitizeCss(tbl.textColor) + ';' : '') + (tbl.fontSize ? 'font-size:' + sanitizeCss(tbl.fontSize) + 'px;' : '');
    return `<div class="note-table-block" contenteditable="false" data-table-id="${tbl.id}" tabindex="0"><table class="note-table" style="--tbl-border-width:${bw}px;--tbl-border-color:${bc};${ts}">${html}</table></div>`;
  }

  function renderRichContent(text, n, opts) {
    n = n || {};
    const imgMap = {};
    (n.images || []).forEach((im) => { imgMap[im.id] = im; });
    const fileMap = {};
    (n.files || []).forEach((f) => { fileMap[f.id] = f; });
    const tableMap = {};
    (n.tables || []).forEach((tb) => { tableMap[tb.id] = tb; });
    const stripAlignMarkers = (s) => String(s || '')
      .replace(/\[\[alignimg:(left|center|right)\]\]/g, '')
      .replace(/\[\[\/alignimg\]\]/g, '')
      .replace(/\[\[align:(left|center|right)\]\]/g, '')
      .replace(/\[\[\/align\]\]/g, '');
    const renderSeg = (seg) => {
      const re = /\[\[(img|file|table):([a-zA-Z0-9_-]+)\]\]/g;
      let segOut = '';
      let segLast = 0;
      let sm;
      while ((sm = re.exec(seg)) !== null) {
        segOut += formatInlineText(stripAlignMarkers(seg.slice(segLast, sm.index)), opts);
        if (sm[1] === 'img') {
          const im = imgMap[sm[2]];
          if (im) segOut += inlineImgHtml(im, opts);
        } else if (sm[1] === 'file') {
          const f = fileMap[sm[2]];
          if (f) segOut += fileLinkHtml(f);
        } else {
          const tb = tableMap[sm[2]];
          if (tb) segOut += tableBlockHtml(tb, opts);
        }
        segLast = sm.index + sm[0].length;
      }
      segOut += formatInlineText(stripAlignMarkers(seg.slice(segLast)), opts);
      return segOut;
    };
    const s = String(text || '');
    const alignRe = /\[\[align:(left|center|right)\]\]/g;
    let out = '';
    let last = 0;
    let m;
    while ((m = alignRe.exec(s)) !== null) {
      const closeIdx = s.indexOf('[[/align]]', m.index + m[0].length);
      if (closeIdx < 0) break;
      out += renderSeg(s.slice(last, m.index));
      out += '<div class="note-align note-align-' + m[1] + '" style="text-align:' + m[1] + '">' + renderSeg(s.slice(m.index + m[0].length, closeIdx)) + '</div>';
      last = closeIdx + '[[/align]]'.length;
      alignRe.lastIndex = last;
    }
    out += renderSeg(s.slice(last));
    return out;
  }

  return { hexToRgba, luminance, contrastRatio, isDarkColor, autoTextColor, noteShadowCss, escapeHtml, refIdsOf, cleanupRefs, sortNotes, tableToMarkdown, noteToMarkdown, referencedMedia, parseNullSeparated, hdropString, setRenderLocale, formatInlineText, inlineImgHtml, fileLinkHtml, tableBlockHtml, renderRichContent, sanitizeCss, I18N, I18N_MERGED, T, mergeI18n };
});
