const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function uid() { return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function isDark(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length < 6) return true;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55;
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

const noteId = new URLSearchParams(location.search).get('id');
let note = null;
let saveTimer = null;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (note) window.api.noteUpdate(note);
  }, 300);
}

function renderBody() {
  const body = $('#dnBody');
  if (note.type === 'todo') {
    const items = note.items || [];
    body.innerHTML = `<ul class="todo-list">${items.map((it, idx) => `
      <li class="todo-item ${it.done ? 'done' : ''}" data-idx="${idx}">
        <input type="checkbox" ${it.done ? 'checked' : ''} />
        <input class="todo-text" value="${escapeHtml(it.text)}" placeholder="待办…" />
        <button class="todo-del" title="删除">✕</button>
      </li>`).join('')}</ul>
      <button class="todo-add">＋ 添加待办</button>`;
    wireTodo();
  } else {
    body.innerHTML = `<div id="dnText" class="dn-content" contenteditable="true" spellcheck="false" data-placeholder="写点什么…">${linkifyText(note.content || '')}</div>`;
    const content = $('#dnText');
    content.addEventListener('click', (e) => {
      const link = e.target.closest('a.note-link');
      if (link) {
        const url = link.getAttribute('data-url');
        if (url) window.api.openExternal(url);
      }
    });
    content.addEventListener('input', () => { note.content = content.innerText; save(); });
    content.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });
    content.addEventListener('blur', () => {
      note.content = content.innerText;
      content.innerHTML = linkifyText(note.content);
      save();
    });
  }
}

function wireTodo() {
  $$('.todo-text').forEach((inp) => {
    inp.addEventListener('input', () => {
      const idx = Number(inp.closest('.todo-item').dataset.idx);
      note.items[idx].text = inp.value;
      save();
    });
  });
  $$('.todo-item input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const idx = Number(cb.closest('.todo-item').dataset.idx);
      note.items[idx].done = cb.checked;
      cb.closest('.todo-item').classList.toggle('done', cb.checked);
      save();
    });
  });
  $$('.todo-del').forEach((b) => {
    b.onclick = () => {
      const idx = Number(b.closest('.todo-item').dataset.idx);
      note.items.splice(idx, 1);
      save();
      renderBody();
    };
  });
  const addBtn = $('.todo-add');
  if (addBtn) {
    addBtn.onclick = () => {
      note.items = note.items || [];
      note.items.push({ id: uid(), text: '', done: false });
      save();
      renderBody();
      const last = $$('.todo-text').pop();
      if (last) last.focus();
    };
  }
}

async function init() {
  const r = await window.api.noteGet(noteId);
  note = r.note;
  const settings = r.settings || {};

  if (!note) { document.body.textContent = '便签不存在'; return; }

  const tc = note.textColor || settings.noteTextColor || (isDark(note.color) ? '#ffffff' : '#2d2f38');
  const wrap = $('#note');
  wrap.style.background = note.color;
  wrap.style.color = tc;

  document.documentElement.style.setProperty('--font-size', (settings.fontSize || 14) + 'px');
  const fam = (settings.fontFamily && settings.fontFamily !== 'system')
    ? settings.fontFamily
    : '-apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
  document.documentElement.style.setProperty('--font', fam);
  document.documentElement.style.setProperty('--accent', settings.accent || '#6c5ce7');

  const title = $('#dnTitle');
  title.value = note.title || '';
  title.addEventListener('input', () => { note.title = title.value; save(); });

  renderBody();

  $('#dnUnpin').onclick = () => window.api.unpinFromDesktop(noteId);

  window.addEventListener('beforeunload', () => { if (note) window.api.noteUpdate(note); });
}

init();
