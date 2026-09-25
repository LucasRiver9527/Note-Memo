/* panels/trash-panel.js
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.trashPanelView + 顶层全局。
   —— 本模块的函数通过顶层全局访问其他模块（与 board-layout.js 等同构）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.trashPanelView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

/* ============ 回收站 ============ */
function deleteNote(id) {
  const n = state.notes.find((x) => x.id === id);
  if (!n) return;
  pushUndo();
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
  pushUndo();
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

  return { purgeTrash, restoreTrashItem, deleteTrashItem, emptyTrash, renderTrashPanel, deleteNote };
}));
