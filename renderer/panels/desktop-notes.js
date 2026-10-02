/* panels/desktop-notes.js
   UX-20A：桌面便签摘要（只读标题列表 + 精确计数 + 安全唤起）。
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.desktopNotesView + 顶层全局。
   —— 通过顶层全局访问 state/t/$/toast/window.api（与其它 panels 同构）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.desktopNotesView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function desktopNotes() {
    return (state.notes || []).filter((n) => n && n.desktopPin);
  }

  // 只读标题列表；重建时保留折叠状态与仍存在行的键盘焦点（不抢焦点）。
  function renderDesktopNotes() {
    const box = $('#desktopNotes');
    const list = $('#desktopNotesList');
    if (!box || !list) return;
    wireOnce(box);

    const notes = desktopNotes();
    const count = $('#desktopNotesCount');
    if (count) count.textContent = String(notes.length);

    const active = document.activeElement;
    const focusedId = active && active.closest && active.closest('.dn-row') ? active.closest('.dn-row').dataset.id : null;

    list.textContent = '';
    notes.forEach((n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dn-row';
      b.dataset.id = n.id;
      const label = (n.title && String(n.title).trim()) || t('untitled');
      b.textContent = label; // textContent：标题按文本转义，不注入任何富文本/HTML
      b.title = label;
      b.addEventListener('click', () => { revealDesktopNote(n.id); });
      list.appendChild(b);
    });
    const emptyEl = $('#desktopNotesEmpty');
    if (emptyEl) emptyEl.classList.toggle('hidden', notes.length > 0);
    list.classList.toggle('hidden', notes.length === 0);

    if (focusedId) {
      const again = Array.from(list.children).find((el) => el.dataset.id === focusedId);
      if (again) again.focus();
    }
  }

  // 唤起（显示/恢复/聚焦）匹配的独立便签窗口；失败给出本地化提示，绝不改动数据。
  async function revealDesktopNote(id) {
    let ok = false;
    try { ok = (await window.api.showDesktopNote(id)) === true; } catch (e) { ok = false; }
    if (!ok) { try { toast(t('desktop_notes_stale')); } catch (e) { /* ignore */ } }
    return ok;
  }

  let wired = false;
  function wireOnce(box) {
    if (wired) return;
    wired = true;
    const close = $('#btnDesktopNotesClose');
    const focusSummary = () => { const s = $('#desktopNotesSummary'); if (s && typeof s.focus === 'function') s.focus(); };
    if (close) close.addEventListener('click', () => { box.open = false; focusSummary(); });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && box.open) { e.preventDefault(); box.open = false; focusSummary(); }
    });
  }

  return { renderDesktopNotes, revealDesktopNote };
}));
