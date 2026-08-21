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
    parts.push(`<a class="note-link" contenteditable="false" data-url="${escapeHtml(href)}" title="${tr('open_link')}">${escapeHtml(url)}</a>`);
    last = m.index + url.length;
  }
  parts.push(escapeHtml(text.slice(last)));
  return parts.join('');
}

const noteId = new URLSearchParams(location.search).get('id');
let note = null;
let saveTimer = null;
let lang = 'zh';

function tr(key) {
  const D = {
    zh: { note_title: '标题', note_content: '写点什么…', todo_ph: '待办…', add_todo: '＋ 添加待办', notfound: '便签不存在', unpin: '取消钉住（回到列表）', delete: '删除', delete_image: '删除图片', resize_image: '拖动调整大小', open_link: '打开链接' },
    en: { note_title: 'Title', note_content: 'Write something…', todo_ph: 'Todo…', add_todo: '＋ Add todo', notfound: 'Note not found', unpin: 'Unpin (back to list)', delete: 'Delete', delete_image: 'Delete image', resize_image: 'Drag to resize', open_link: 'Open link' }
  };
  const d = D[lang] || D.zh;
  return d[key] || key;
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (note) window.api.noteUpdate(note);
  }, 300);
}

function imagesHtml() {
  const imgs = note.images || [];
  if (!imgs.length) return '';
  return `<div class="note-images">${imgs.map((img) => `
    <div class="note-img-item" data-img-id="${img.id}">
      <img src="${escapeHtml(img.src)}" style="width:${img.w || 200}px" />
      <button class="img-del" title="${tr('delete_image')}">✕</button>
      <div class="img-resize"></div>
    </div>`).join('')}</div>`;
}

function wireImages() {
  $$('.note-img-item').forEach((item) => {
    const id = item.dataset.imgId;
    const img = $('img', item);
    const del = $('.img-del', item);
    const handle = $('.img-resize', item);

    const removeImage = () => {
      note.images = (note.images || []).filter((x) => x.id !== id);
      save();
      renderBody();
    };

    if (del) del.onclick = (e) => {
      e.stopPropagation();
      removeImage();
    };

    item.setAttribute('tabindex', '0');
    item.addEventListener('click', (e) => {
      if (e.target.closest('.img-resize') || e.target.closest('.img-del')) return;
      e.stopPropagation();
      $$('.note-img-item').forEach((x) => x.classList.remove('selected'));
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
      const imgObj = (note.images || []).find((x) => x.id === id);
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
        save();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

function renderBody() {
  const body = $('#dnBody');
  const imgs = imagesHtml();
  if (note.type === 'todo') {
    const items = note.items || [];
    body.innerHTML = `${imgs}<ul class="todo-list">${items.map((it, idx) => `
      <li class="todo-item ${it.done ? 'done' : ''}" data-idx="${idx}">
        <input type="checkbox" ${it.done ? 'checked' : ''} />
        <input class="todo-text" value="${escapeHtml(it.text)}" placeholder="${tr('todo_ph')}" />
        <button class="todo-del" title="${tr('delete')}">✕</button>
      </li>`).join('')}</ul>
      <button class="todo-add">${tr('add_todo')}</button>`;
    wireTodo();
    wireImages();
  } else {
    body.innerHTML = `${imgs}<div id="dnText" class="dn-content" contenteditable="true" spellcheck="false" data-placeholder="${tr('note_content')}">${linkifyText(note.content || '')}</div>`;
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
      const cd = e.clipboardData || window.clipboardData;
      const items = (cd && cd.items) ? Array.from(cd.items) : [];
      const hasImage = items.some((it) => it.type && it.type.indexOf('image') === 0);
      if (hasImage) {
        e.preventDefault();
        handleImagePaste(cd);
        return;
      }
      e.preventDefault();
      const text = cd ? cd.getData('text/plain') : '';
      document.execCommand('insertText', false, text);
    });
    content.addEventListener('blur', () => {
      note.content = content.innerText;
      content.innerHTML = linkifyText(note.content);
      save();
    });
    wireImages();
  }
}

async function handleImagePaste(cd) {
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
      const r = await window.api.saveNoteImage(dataUrl);
      if (r.ok) {
        note.images = note.images || [];
        note.images.push({ id: uid(), src: r.url, w: 200 });
        save();
        renderBody();
      }
      return;
    }
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

  if (!note) { document.body.textContent = tr('notfound'); return; }

  lang = (settings.language === 'en') ? 'en' : 'zh';
  const tc = note.textColor || settings.noteTextColor || (isDark(note.color) ? '#ffffff' : '#2d2f38');
  const wrap = $('#note');
  wrap.style.background = note.color;
  wrap.style.color = tc;

  document.documentElement.style.setProperty('--font-size', (settings.fontSize || 14) + 'px');
  let fam;
  if (note.fontFamily && note.fontFamily !== 'system') fam = note.fontFamily;
  else if (settings.fontFamily && settings.fontFamily !== 'system') fam = settings.fontFamily;
  else fam = '-apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
  document.documentElement.style.setProperty('--font', fam);
  document.documentElement.style.setProperty('--accent', settings.accent || '#6c5ce7');

  const title = $('#dnTitle');
  title.value = note.title || '';
  title.placeholder = tr('note_title');
  title.addEventListener('input', () => { note.title = title.value; save(); });

  renderBody();

  const unpinBtn = $('#dnUnpin');
  unpinBtn.title = tr('unpin');
  unpinBtn.onclick = () => window.api.unpinFromDesktop(noteId);

  window.addEventListener('beforeunload', () => { if (note) window.api.noteUpdate(note); });
}

init();
