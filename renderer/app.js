/* ============ 便签 - 渲染进程逻辑 ============ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const NOTE_COLORS = ['#000000', '#1e1e28', '#2d2f38', '#24344d', '#3a2a4d', '#1f3d33', '#4d2a2a', '#f7d65a', '#ffb3c1', '#a8e6cf', '#a0d8ff', '#d0b3ff', '#ffd8a8', '#f5a97f', '#e6c9ff'];
const ACCENTS = ['#6c5ce7', '#e84393', '#00b894', '#0984e3', '#e17055', '#fdcb6e', '#00cec9', '#d63031', '#2ecc71', '#5b8cff'];

const PRESETS = [
  { id: 'dark', name: '深夜', light: false, bg: '#1e1f26', accent: '#6c5ce7', mini: ['#6c5ce7', '#f7d65a'] },
  { id: 'light', name: '纯净', light: true, bg: '#f4f5fa', accent: '#6c5ce7', mini: ['#6c5ce7', '#ffd8a8'] },
  { id: 'midnight', name: '午夜蓝', light: false, bg: '#131726', accent: '#5b8cff', mini: ['#5b8cff', '#00cec9'] },
  { id: 'forest', name: '森林', light: false, bg: '#152019', accent: '#2ecc71', mini: ['#2ecc71', '#a8e6cf'] },
  { id: 'sunset', name: '暮色', light: false, bg: '#241820', accent: '#e84393', mini: ['#e84393', '#ffb3c1'] },
  { id: 'paper', name: '羊皮纸', light: true, bg: '#f3ecd9', accent: '#b8860b', mini: ['#b8860b', '#f7d65a'] }
];

const FONTS = {
  system: '-apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
  "'Segoe UI', sans-serif": "'Segoe UI', sans-serif",
  "'Microsoft YaHei', sans-serif": "'Microsoft YaHei', sans-serif",
  "'KaiTi', 'STKaiti', serif": "'KaiTi', 'STKaiti', serif",
  "'FangSong', 'STFangsong', serif": "'FangSong', 'STFangsong', serif",
  "'Consolas', monospace": "'Consolas', monospace"
};

const TEXT_COLORS = ['#2d2f38', '#000000', '#444444', '#ffffff', '#c0392b', '#b8860b', '#1e5a8a', '#1e7d5a', '#5b2d8f', '#7f8c8d'];

const DEFAULT_SETTINGS = {
  themeId: 'dark',
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
  topBarOpacity: 100
};

let state = {
  settings: { ...DEFAULT_SETTINGS },
  groups: [],
  notes: []
};

let filter = { group: 'all', query: '' };
let zCounter = 10;
let saveTimer = null;
let activeColorPop = null;
let activeGroupPop = null;

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

function isLightTheme() {
  const preset = PRESETS.find((p) => p.id === state.settings.themeId) || PRESETS[0];
  return preset.light;
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
    parts.push(`<a class="note-link" contenteditable="false" data-url="${escapeHtml(href)}" title="打开链接">${escapeHtml(url)}</a>`);
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
  if (d.toDateString() === now.toDateString()) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
    window.api.saveData({ settings: state.settings, groups: state.groups, notes: state.notes });
  }, 300);
}

function saveNow() {
  clearTimeout(saveTimer);
  window.api.saveData({ settings: state.settings, groups: state.groups, notes: state.notes });
}

/* ============ 主题 ============ */
function applyTheme() {
  const s = state.settings;
  const preset = PRESETS.find((p) => p.id === s.themeId) || PRESETS[0];
  const light = preset.light;
  const bg = s.canvasColor || preset.bg;
  const accent = s.accent || preset.accent;
  const root = document.documentElement;

  root.style.setProperty('--bg', bg);
  root.style.setProperty('--bg-soft', light ? 'rgba(0,0,0,0.045)' : 'rgba(255,255,255,0.06)');
  root.style.setProperty('--border', light ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.09)');
  root.style.setProperty('--fg', light ? '#2d2f38' : '#ececf1');
  root.style.setProperty('--fg-dim', light ? '#7a7c86' : '#9a9ba6');
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-soft', hexToRgba(accent, light ? 0.14 : 0.2));
  root.style.setProperty('--note-opacity', (s.noteOpacity / 100).toFixed(2));
  root.style.setProperty('--font-size', s.fontSize + 'px');
  root.style.setProperty('--font-family', FONTS[s.fontFamily] || FONTS.system);
  root.style.setProperty('--titlebar-bg', light ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.18)');

  window.api.setOpacity(s.winOpacity / 100);
  window.api.setAlwaysOnTop(!!s.alwaysOnTop);

  const pinBtn = $('#btnPin');
  if (pinBtn) pinBtn.classList.toggle('active', !!s.alwaysOnTop);

  applyBackground();
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
  grid.innerHTML = '';
  PRESETS.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'theme-card' + (state.settings.themeId === p.id ? ' active' : '');
    card.innerHTML = `
      <div class="preview" style="background:${p.bg}">
        <div class="mini-note" style="background:${p.mini[0]}"></div>
        <div class="mini-note" style="background:${p.mini[1]}"></div>
      </div>
      <span class="tname">${p.name}</span>`;
    card.onclick = () => {
      state.settings.themeId = p.id;
      state.settings.canvasColor = null;
      state.settings.accent = p.accent;
      syncSettingsInputs();
      applyTheme();
      renderThemePanel();
      save();
    };
    grid.appendChild(card);
  });

  const sw = $('#accentSwatches');
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

  $('#customAccent').value = state.settings.accent;
}

function syncSettingsInputs() {
  $('#noteOpacity').value = state.settings.noteOpacity;
  $('#winOpacity').value = state.settings.winOpacity;
  $('#fontSize').value = state.settings.fontSize;
  $('#fontFamily').value = state.settings.fontFamily;
  $('#canvasColor').value = state.settings.canvasColor || (PRESETS.find((p) => p.id === state.settings.themeId) || PRESETS[0]).bg;
  $('#backgroundMode').value = state.settings.backgroundMode || 'cover';
  $('#noteTextColor').value = state.settings.noteTextColor || '#2d2f38';
  $('#bgOpacity').value = state.settings.bgOpacity != null ? state.settings.bgOpacity : 100;
  $('#topBarOpacity').value = state.settings.topBarOpacity != null ? state.settings.topBarOpacity : 100;
  $('#topBarColor').value = state.settings.topBarColor || (isLightTheme() ? '#ffffff' : '#000000');
}

/* ============ 分组 ============ */
function renderGroupChips() {
  const wrap = $('#groupChips');
  wrap.innerHTML = '';
  state.groups.forEach((g) => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (filter.group === g.id ? ' active' : '');
    chip.innerHTML = `<span class="dot" style="background:${g.color}"></span>${escapeHtml(g.name)}`;
    chip.title = '左键筛选 · 右键编辑分组';
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

/* ============ 便签渲染 ============ */
function noteText(n) {
  return n.type === 'todo'
    ? (n.items || []).map((i) => i.text).join(' ')
    : n.content || '';
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
        <input class="todo-text" value="${escapeHtml(it.text)}" placeholder="待办…" />
        <button class="todo-del" title="删除">✕</button>
      </li>`).join('')}</ul>
      <button class="todo-add">＋ 添加待办</button>`;
  } else {
    bodyHtml = `<div class="note-content" contenteditable="true" spellcheck="false" data-placeholder="写点什么…">${linkifyText(n.content || '')}</div>`;
  }

  el.innerHTML = `
    <div class="note-head">
      <span class="note-grip">⠿</span>
      <input class="note-title" value="${escapeHtml(n.title || '')}" placeholder="标题" />
      <div class="note-tools">
        <button class="t-pin ${n.pinned ? 'active' : ''}" title="置顶">📌</button>
        <button class="t-todo ${isTodo ? 'active' : ''}" title="待办模式">☑</button>
        <button class="t-group ${n.groupId ? 'active' : ''}" title="${n.groupId ? '退出分组' : '加入分组'}">🏷</button>
        <button class="t-desktop" title="钉在桌面">🖥️</button>
        <button class="t-remind" title="提醒">⏰</button>
        <button class="t-color" title="颜色">🎨</button>
        <button class="t-del" title="删除">🗑</button>
      </div>
    </div>
    <div class="note-body">${bodyHtml}</div>
    <div class="note-foot">
      <span class="group-tag" title="点击设置分组"><span class="dot" style="background:${group ? group.color : '#999'}"></span>${group ? escapeHtml(group.name) : '未分组'}</span>
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
        <input class="todo-text" value="${escapeHtml(it.text)}" placeholder="待办…" />
        <button class="todo-del" title="删除">✕</button>
      </li>`).join('')}</ul>
      <button class="todo-add">＋ 添加待办</button>`;
  } else {
    bodyHtml = `<div class="note-content" contenteditable="true" spellcheck="false" data-placeholder="写点什么…">${linkifyText(n.content || '')}</div>`;
  }

  el.innerHTML = `
    <div class="memo-content">
      <div class="memo-head">
        <input class="note-title" value="${escapeHtml(n.title || '')}" placeholder="标题" />
        <div class="memo-tools">
          <button class="t-pin ${n.pinned ? 'active' : ''}" title="置顶">📌</button>
          <button class="t-todo ${isTodo ? 'active' : ''}" title="待办模式">☑</button>
          <button class="t-group ${n.groupId ? 'active' : ''}" title="${n.groupId ? '退出分组' : '加入分组'}">🏷</button>
          <button class="t-desktop" title="钉在桌面">🖥️</button>
          <button class="t-remind" title="提醒">⏰</button>
          <button class="t-color" title="颜色">🎨</button>
          <button class="t-del" title="删除">🗑</button>
        </div>
      </div>
      <div class="memo-body">${bodyHtml}</div>
      <div class="memo-foot">
        <span class="group-tag" title="点击设置分组"><span class="dot" style="background:${group ? group.color : '#999'}"></span>${group ? escapeHtml(group.name) : '未分组'}</span>
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
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
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
      toast('已退出分组' + (gname ? '「' + gname + '」' : ''));
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
    toast('已钉在桌面');
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
}

function wireNoteEvents(el, n) {
  wireCommon(el, n);

  // 拖拽
  const head = $('.note-head', el);
  head.addEventListener('mousedown', (e) => {
    if (e.target.closest('button, input, .note-tools')) return;
    e.preventDefault();
    startDrag(el, n, e);
  });

  // 缩放
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

function renderAll() {
  const board = $('#board');
  const memoList = $('#memoList');
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

  if (state.settings.viewMode === 'memo') {
    board.classList.add('hidden');
    memoList.classList.remove('hidden');
    memoList.innerHTML = '';
    const sorted = [...visible].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
    sorted.forEach((n) => memoList.appendChild(buildMemoEl(n)));
  } else {
    board.classList.remove('hidden');
    memoList.classList.add('hidden');
    board.innerHTML = '';
    visible.forEach((n) => board.appendChild(buildNoteEl(n)));
  }

  $('#noteCount').textContent = state.notes.length;
  const empty = state.notes.length === 0;
  $('#emptyHint').classList.toggle('hidden', !empty);
}

function setViewMode(mode) {
  state.settings.viewMode = mode;
  $('#viewBoard').classList.toggle('active', mode === 'board');
  $('#viewMemo').classList.toggle('active', mode === 'memo');
  save();
  renderAll();
}

function createNote(x, y) {
  const n = {
    id: uid(),
    title: '',
    content: '',
    type: 'note',
    items: [],
    color: '#000000',
    textColor: null,
    groupId: (filter.group && filter.group !== 'all' && filter.group !== 'ungrouped') ? filter.group : null,
    pinned: false,
    desktopPin: false,
    reminder: null,
    x: x != null ? x : 60,
    y: y != null ? y : 60,
    w: 240,
    h: 200,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  state.notes.push(n);
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

function deleteNote(id) {
  state.notes = state.notes.filter((n) => n.id !== id);
  closePops();
  save();
  renderAll();
}

/* ============ 颜色 / 分组弹窗 ============ */
function closePops() {
  if (activeColorPop) { activeColorPop.remove(); activeColorPop = null; }
  if (activeGroupPop) { activeGroupPop.remove(); activeGroupPop = null; }
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
  bgLabel.textContent = '自定义底色';
  pop.appendChild(bgLabel);

  const customInput = document.createElement('input');
  customInput.type = 'color';
  customInput.value = n.color || '#000000';
  customInput.title = '自定义底色';
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
  label.textContent = '文字颜色';
  pop.appendChild(label);

  TEXT_COLORS.forEach((c) => {
    addSwatch(c, (n.textColor || state.settings.noteTextColor) === c, () => { n.textColor = c; n.updatedAt = Date.now(); save(); renderAll(); });
  });

  const def = document.createElement('button');
  def.className = 'color-pop-def';
  def.textContent = '默认颜色';
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
    { label: '未分组', id: null },
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
  newBtn.textContent = '＋ 新建分组';
  newBtn.onclick = (e) => {
    e.stopPropagation();
    closePops();
    promptModal('新建分组', '分组名称', '').then((name) => {
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

  addBtn('✏ 重命名分组', () => {
    promptModal('重命名分组', '分组名称', g.name).then((name) => {
      if (name && name.trim()) {
        g.name = name.trim();
        save();
        renderGroupChips();
      }
    });
  });

  const colorLabel = document.createElement('div');
  colorLabel.style.cssText = 'font-size:11px;color:var(--fg-dim);padding:8px 10px 2px;';
  colorLabel.textContent = '修改颜色';
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

  addBtn('<span style="color:#e5484d">🗑 删除分组</span>', () => {
    confirmModal('删除分组', `确定删除分组「${g.name}」？分组内的便签将变为未分组。`).then((ok) => {
      if (ok) {
        state.groups = state.groups.filter((x) => x.id !== g.id);
        state.notes.forEach((n) => { if (n.groupId === g.id) n.groupId = null; });
        if (filter.group === g.id) filter.group = 'all';
        save();
        renderGroupChips();
        renderAll();
        toast('分组已删除');
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

/* ============ 提醒 ============ */
let reminderNoteId = null;

function openReminder(n) {
  reminderNoteId = n.id;
  $('#reminderTitle').textContent = n.title || '设置提醒';
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
    overlay.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;';
    const modal = document.createElement('div');
    modal.style.cssText = 'width:280px;background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;';
    modal.innerHTML = `
      <header style="padding:14px 16px;font-weight:700;border-bottom:1px solid var(--border)">${escapeHtml(title)}</header>
      <div style="padding:16px"><input id="pmInput" style="width:100%;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:9px 10px;font-family:inherit;font-size:14px" value="${escapeHtml(def || '')}" /></div>
      <footer style="padding:12px 16px;display:flex;gap:10px;justify-content:flex-end">
        <button id="pmCancel" class="sp-btn ghost" style="width:auto;padding:8px 18px">取消</button>
        <button id="pmOk" class="sp-btn primary" style="width:auto;padding:8px 18px">确定</button>
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
    overlay.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;';
    const modal = document.createElement('div');
    modal.style.cssText = 'width:300px;background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;';
    modal.innerHTML = `
      <header style="padding:14px 16px;font-weight:700;border-bottom:1px solid var(--border)">${escapeHtml(title)}</header>
      <div style="padding:16px;font-size:13.5px;color:var(--fg-dim);line-height:1.6">${escapeHtml(message)}</div>
      <footer style="padding:12px 16px;display:flex;gap:10px;justify-content:flex-end">
        <button id="cmCancel" class="sp-btn ghost" style="width:auto;padding:8px 18px">取消</button>
        <button id="cmOk" class="sp-btn" style="width:auto;padding:8px 18px;background:#e5484d">确定</button>
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
  const sorted = [...state.notes].sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1));
  sorted.forEach((n, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    n.x = 20 + col * 260;
    n.y = 20 + row * 230;
  });
  save();
  renderAll();
}

/* ============ 事件绑定 ============ */
function bindUI() {
  $('#btnAdd').onclick = () => {
    if (state.settings.viewMode === 'memo') {
      createNote();
    } else {
      const canvas = $('#canvas');
      const x = canvas.scrollLeft + canvas.clientWidth / 2 - 120 + Math.random() * 40;
      const y = canvas.scrollTop + 40 + Math.random() * 40;
      createNote(Math.round(x), Math.round(y));
    }
  };

  $('#viewBoard').onclick = () => setViewMode('board');
  $('#viewMemo').onclick = () => setViewMode('memo');

  $('#btnMin').onclick = () => window.api.minimize();
  $('#btnClose').onclick = () => window.api.hide();
  $('#btnPin').onclick = () => {
    state.settings.alwaysOnTop = !state.settings.alwaysOnTop;
    applyTheme();
    save();
  };

  $('#btnTheme').onclick = () => {
    syncSettingsInputs();
    renderThemePanel();
    $('#settingsOverlay').classList.remove('hidden');
  };
  $('#btnCloseSettings').onclick = () => $('#settingsOverlay').classList.add('hidden');
  $('#settingsOverlay').onclick = (e) => { if (e.target.id === 'settingsOverlay') $('#settingsOverlay').classList.add('hidden'); };

  $('#btnMenu').onclick = (e) => {
    e.stopPropagation();
    $('#menuOverlay').classList.toggle('hidden');
  };
  $('#menuOverlay').onclick = (e) => { if (e.target.id === 'menuOverlay') $('#menuOverlay').classList.add('hidden'); };

  $('#btnExport').onclick = async () => {
    $('#menuOverlay').classList.add('hidden');
    const r = await window.api.exportData({ settings: state.settings, groups: state.groups, notes: state.notes });
    if (r.ok) toast('已导出：' + r.path);
    else if (!r.canceled) toast('导出失败：' + r.error);
  };
  $('#btnImport').onclick = async () => {
    $('#menuOverlay').classList.add('hidden');
    const r = await window.api.importData();
    if (r.ok) {
      const ok = await confirmModal('导入备份', '导入将覆盖当前全部便签，确定继续？');
      if (ok) {
        state.settings = { ...DEFAULT_SETTINGS, ...(r.data.settings || {}) };
        state.groups = r.data.groups || [];
        state.notes = r.data.notes || [];
        state.notes.forEach((n) => { if (!n.id) n.id = uid(); });
        save();
        applyTheme();
        renderGroupChips();
        renderAll();
        toast('导入成功');
      }
    } else if (!r.canceled) toast('导入失败：' + r.error);
  };
  $('#btnArrange').onclick = () => { $('#menuOverlay').classList.add('hidden'); arrangeNotes(); toast('已整理排列'); };
  $('#btnClearAll').onclick = async () => {
    $('#menuOverlay').classList.add('hidden');
    const ok = await confirmModal('清空全部', '确定删除所有便签？此操作不可撤销。');
    if (ok) {
      state.notes.forEach((n) => { if (n.desktopPin) window.api.unpinFromDesktop(n.id); });
      state.notes = [];
      save();
      renderAll();
      toast('已清空');
    }
  };

  $('#btnAddGroup').onclick = () => {
    promptModal('新建分组', '分组名称', '').then((name) => {
      if (name && name.trim()) {
        createGroup(name.trim());
        toast('分组已创建');
      }
    });
  };

  // 静态筛选（全部 / 未分组）
  $$('#filterbar .chip[data-group]').forEach((c) => {
    c.onclick = () => setFilter('group', c.dataset.group);
  });

  // 搜索
  const search = $('#searchInput');
  search.addEventListener('input', () => {
    filter.query = search.value;
    $('#searchClear').classList.toggle('hidden', !search.value);
    renderAll();
  });
  $('#searchClear').onclick = () => { search.value = ''; filter.query = ''; $('#searchClear').classList.add('hidden'); renderAll(); };

  // 画布双击新建
  const canvas = $('#canvas');
  canvas.addEventListener('dblclick', (e) => {
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

  // 设置面板输入
  $('#noteOpacity').addEventListener('input', (e) => { state.settings.noteOpacity = Number(e.target.value); applyTheme(); });
  $('#noteOpacity').addEventListener('change', save);
  $('#winOpacity').addEventListener('input', (e) => { state.settings.winOpacity = Number(e.target.value); applyTheme(); });
  $('#winOpacity').addEventListener('change', save);
  $('#fontSize').addEventListener('input', (e) => { state.settings.fontSize = Number(e.target.value); applyTheme(); });
  $('#fontSize').addEventListener('change', save);
  $('#fontFamily').addEventListener('change', (e) => { state.settings.fontFamily = e.target.value; applyTheme(); save(); });
  $('#noteTextColor').addEventListener('input', (e) => { state.settings.noteTextColor = e.target.value; renderAll(); });
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
  $('#btnPickImage').onclick = async () => {
    const r = await window.api.pickImage();
    if (r.ok) {
      state.settings.backgroundImage = r.url;
      applyBackground();
      save();
      toast('背景图片已设置');
    } else if (!r.canceled) {
      toast('设置失败：' + r.error);
    }
  };
  $('#btnClearImage').onclick = () => {
    state.settings.backgroundImage = null;
    applyBackground();
    save();
    toast('已清除背景图片');
  };
  $('#btnResetTheme').onclick = () => {
    state.settings = { ...DEFAULT_SETTINGS };
    syncSettingsInputs();
    renderThemePanel();
    applyTheme();
    save();
    toast('已恢复默认主题');
  };

  // 提醒弹窗
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
      toast('提醒已设置');
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

  const data = await window.api.loadData();
  if (data) {
    state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    state.groups = data.groups || [];
    state.notes = data.notes || [];
    state.notes.forEach((n) => {
      if (!n.id) n.id = uid();
      if (!n.items) n.items = [];
    });
  }

  applyTheme();
  syncSettingsInputs();
  renderThemePanel();
  renderGroupChips();
  renderAll();
  $('#viewBoard').classList.toggle('active', state.settings.viewMode !== 'memo');
  $('#viewMemo').classList.toggle('active', state.settings.viewMode === 'memo');

  window.api.onCreateNote(() => {
    if (state.settings.viewMode === 'memo') {
      createNote();
    } else {
      const canvas = $('#canvas');
      createNote(Math.round(canvas.scrollLeft + canvas.clientWidth / 2 - 120), Math.round(canvas.scrollTop + 40));
    }
  });

  window.api.onAlwaysOnTop((flag) => {
    state.settings.alwaysOnTop = flag;
    const pinBtn = $('#btnPin');
    if (pinBtn) pinBtn.classList.toggle('active', !!flag);
  });

  window.api.onReminderFired((id) => {
    const n = state.notes.find((x) => x.id === id);
    if (n && n.reminder) {
      n.reminder.fired = true;
      save();
      renderAll();
      toast('提醒：' + (n.title || '便签'));
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
    window.api.saveData({ settings: state.settings, groups: state.groups, notes: state.notes });
  });
}

init();
