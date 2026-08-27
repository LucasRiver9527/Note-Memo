/* 设置面板 / 主题 / 字体 / 语言 纯功能模块：单一来源，可由 Node 测，也可挂页面全局。
   - Node: module.exports
   - 浏览器: 挂 root.SettingsPanel + 顶层全局，app.js 可直接按名字调用 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.SettingsPanel = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

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
  // 便签外观自定义：圆角 / 阴影 / 边框 / 字距 / 背景图案（单一来源，实时作用于所有便签卡片）
  applyNoteAppearance(s);
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
  applyWindowControls();
  applyMenuAppearance();
}

function todoAreaBg(color, opacity) {
  const base = (color == null || color === '') ? (isLightTheme() ? '#e6e9f2' : '#2c2e3a') : color;
  return hexToRgba(base, (opacity != null ? opacity : 100) / 100);
}

// 便签外观自定义：把设置写入根 CSS 变量，让所有便签卡片（.note / 钉窗内容）实时跟随。
// 单一来源 = state.settings（defaults 在 state.js），这里只做「设置 → 变量」的映射。
function applyNoteAppearance(s) {
  const root = document.documentElement;
  const radius = (s.noteRadius != null ? s.noteRadius : 12);
  root.style.setProperty('--note-radius', radius + 'px');
  root.style.setProperty('--note-radius-sm', Math.max(4, Math.round(radius * 0.55)) + 'px');

  // 阴影强度：0=默认，1~3 逐级加深（纯逻辑在 logic.noteShadowCss）
  const shadow = (s.noteShadow != null ? s.noteShadow : 0);
  const sh = noteShadowCss(shadow);
  root.style.setProperty('--note-shadow', sh.base);
  root.style.setProperty('--note-shadow-hover', sh.hover);

  // 边框：完全跟随用户值（0 = 无边框）。玻璃态下同样尊重用户，不做「强制 1px 玻璃细边」，
  // 以满足「边框调 0 就无边框」的需求；玻璃态靠半透明底 + 磨砂本身区分边缘。
  const bw = (s.noteBorderWidth != null ? s.noteBorderWidth : 0);
  root.style.setProperty('--note-border-width', bw + 'px');
  root.style.setProperty('--note-border-color', s.noteBorderColor || 'rgba(0,0,0,0.12)');
  root.style.setProperty('--note-glass-border-width', bw + 'px');
  root.style.setProperty('--note-glass-border-color', s.noteBorderColor || 'rgba(255,255,255,0.22)');

  // 字体字距（作用于便签内容与全局文字）
  const ls = (s.noteLetterSpacing != null ? s.noteLetterSpacing : 0);
  root.style.setProperty('--font-letter-spacing', ls + 'px');
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
  // 供关闭确认等弹窗复用顶栏配色（颜色/透明度/亚克力），保持全局风格统一
  document.documentElement.style.setProperty('--topbar-bg', bc);
  const tb = $('#titlebar');
  if (tb) tb.style.backgroundColor = bc;
  const fb = $('#filterbar');
  if (fb) fb.style.backgroundColor = bc;
  const bb = $('#batchBar');
  if (bb) bb.style.backgroundColor = bc;

  // 明亮/复杂背景下的可读性增强（默认开启）：有背景图或自定义亮底色时自动压暗+提对比
  const brightByImage = !!s.backgroundImage;
  const brightByColor = !!s.canvasColor && luminance(s.canvasColor) > 0.65;
  document.body.classList.toggle('bright-bg', s.backgroundReadability !== false && (brightByImage || brightByColor));
  applyWindowControls();
}

// 自定义背景图/明暗变化时同步原生窗口控制按钮(─ □ ✕)符号颜色，保证始终清晰可辨
// 依据「顶栏/画布实际背景亮度」取反色符号：亮背景用深色，暗背景用浅色。
function applyWindowControls() {
  if (!window.api || typeof window.api.setWindowControls !== 'function') return;
  const bg = (typeof currentBg === 'function' ? currentBg() : '#f4f5fa');
  const light = (typeof luminance === 'function') ? luminance(bg) > 0.55 : true;
  // 明亮/复杂背景（bright-bg）也按背景亮度取反色
  const onBright = document.body.classList.contains('bright-bg');
  const symbolColor = (light || onBright) ? '#1f2430' : '#eef0f6';
  // 亮背景下再补一层对比背景不必要；窗口控制区域由顶部背景承担
  window.api.setWindowControls({ symbolColor });
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
  $('#noteRadius').value = state.settings.noteRadius != null ? state.settings.noteRadius : 12;
  $('#noteShadow').value = state.settings.noteShadow != null ? state.settings.noteShadow : 0;
  $('#noteBorderWidth').value = state.settings.noteBorderWidth != null ? state.settings.noteBorderWidth : 0;
  const nbc = $('#noteBorderColor'); if (nbc) nbc.value = state.settings.noteBorderColor || '#000000';
  $('#noteLetterSpacing').value = state.settings.noteLetterSpacing != null ? state.settings.noteLetterSpacing : 0;
  $('#winOpacity').value = state.settings.winOpacity;
  const nc = $('#noteColorInput'); if (nc) nc.value = state.settings.noteColor || DEFAULT_NOTE_COLOR;
  $('#fontSize').value = state.settings.fontSize;
  $('#fontFamily').value = state.settings.fontFamily;
  $('#canvasColor').value = state.settings.canvasColor || getTheme().bg;
  $('#backgroundMode').value = state.settings.backgroundMode || 'cover';
  $('#noteTextColor').value = state.settings.noteTextColor || (isLightTheme() ? '#2d2f38' : '#ececf1');
  $('#bgOpacity').value = state.settings.bgOpacity != null ? state.settings.bgOpacity : 100;
  const br = $('#bgReadabilityToggle'); if (br) br.checked = state.settings.backgroundReadability !== false;
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

// 右键菜单外观：亚克力（磨砂） + 透明度。单一来源 state.settings，实时作用于所有 .ctx-menu。
function applyMenuAppearance() {
  const root = document.documentElement;
  const op = (state.settings.menuOpacity != null) ? state.settings.menuOpacity : 88;
  root.style.setProperty('--ctx-opacity', op);
  document.body.classList.toggle('menu-acrylic', !!state.settings.menuAcrylic);
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
  // 开机自启动为系统级设置，读取实际注册表状态回填开关
  window.api.getAutoLaunch().then((r) => {
    const el = $('#autoStartToggle');
    if (el && r && r.ok) el.checked = !!r.enabled;
  }).catch(() => {});
  renderFontSelect();
  renderFontList();
  renderGroupChips();
  renderThemePanel();
  renderAll();
}
function renderGroupChips() {
  const wrap = $('#groupChips');
  wrap.innerHTML = '';
  // 「最近使用」的分组排到最前，其余保持原相对顺序（纯逻辑 orderGroupsByRecent，见 board-layout.js）
  const recent = (typeof BoardLayout !== 'undefined' && BoardLayout.orderGroupsByRecent)
    ? BoardLayout.orderGroupsByRecent(state.groups, state.settings.recentGroups)
    : state.groups;
  recent.forEach((g) => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (filter.group === g.id ? ' active' : '');
    chip.innerHTML = `<span class="dot" style="background:${g.color}"></span>${escapeHtml(g.name)}${isGroupCollapsed(g.id) ? '<span class="chip-collapsed">▸</span>' : ''}`;
    chip.title = t('left_click_filter');
    chip.onclick = () => setFilter('group', g.id);
    chip.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openGroupEditPop(chip, g);
    });
    wrap.appendChild(chip);
  });
  $$('#filterbar .chip[data-group]').forEach((c) => {
    c.classList.toggle('active', !filter.archive && c.dataset.group === filter.group);
  });
  const archiveChip = $('#btnArchiveFilter');
  if (archiveChip) archiveChip.classList.toggle('active', !!filter.archive);
  if (typeof refreshChipsScroll === 'function') refreshChipsScroll();
}

function setFilter(key, val) {
  filter[key] = val;
  if (key === 'group') {
    // 选分组/全部/未分组即退出归档视图（归档是独立的「只看归档」开关）
    if (filter.archive) filter.archive = false;
    // 让「排序面板」作用域跟随当前视图，保证在面板里调整的顺序与「一键整理」作用于同一分组/全部
    if (val === 'all' || val === 'ungrouped' || state.groups.some((g) => g.id === val)) {
      sortPanelGroupId = val;
    }
    // 记录「最近使用」分组（仅真实分组；全部/未分组不记）
    if (val !== 'all' && val !== 'ungrouped' && state.groups.some((g) => g.id === val)) {
      markGroupRecent(val);
    }
    renderGroupChips();
  }
  renderAll();
}

// 把分组 gid 记为「最近使用」：移到 recentGroups 最前、去重、限量，再重排分组芯片
function markGroupRecent(gid) {
  if (!gid) return;
  const limit = (typeof BoardLayout !== 'undefined' && BoardLayout.LAYOUT && BoardLayout.LAYOUT.recentGroupLimit) ? BoardLayout.LAYOUT.recentGroupLimit : 8;
  const arr = (state.settings.recentGroups || []).filter((x) => x !== gid);
  arr.unshift(gid);
  state.settings.recentGroups = arr.slice(0, limit);
  save();
}

function createGroup(name) {
  const g = { id: uid(), name, color: ACCENTS[state.groups.length % ACCENTS.length] };
  state.groups.push(g);
  save();
  renderGroupChips();
  return g;
}


  return { applyTheme, todoAreaBg, applyTodoStyle, applyBackground, renderThemePanel, deleteCustomTheme, openThemeEditor, syncModeSeg, syncSettingsInputs, applyCustomFonts, renderFontSelect, renderFontList, addCustomFont, deleteCustomFont, applyLanguage, renderGroupChips, setFilter, createGroup, applyMenuAppearance };
}));
