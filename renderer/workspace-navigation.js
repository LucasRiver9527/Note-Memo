'use strict';

// 工作区视图切换、详情导航及来源视图的位置和焦点恢复。
function openNoteDetail(id, trigger) {
  if (!state.notes.some((note) => note.id === id && !note.gadget)) return;
  const canvas = $('#canvas');
  const source = trigger?.closest('.note, .memo-row, .todo-line, .doc-pick-item');
  docPickerReturn = {
    id, mode: state.settings.viewMode, top: canvas.scrollTop, left: canvas.scrollLeft,
    rowId: source?.dataset.item,
    more: !!trigger?.closest('.t-more'),
    fromRecent: !!trigger?.closest('#recentNotes'),
  };
  docNoteId = id;
  renderAll();
  canvas.scrollTo(0, 0);
  $('#btnDocBack')?.focus({ preventScroll: true });
}

function returnFromNoteDetail(restoreFocus = true) {
  const origin = docPickerReturn;
  docPickerReturn = null;
  docNoteId = null;
  renderAll();
  if (!origin) return;
  $('#canvas').scrollTo(origin.left, origin.top);
  if (!restoreFocus) return;
  if (origin.fromRecent) {
    $('#searchInput').focus({ preventScroll: true });
    return;
  }
  const rows = { board: '#board .note', memo: '#memoList .memo-row',
    todo: '#todoList .todo-line', doc: '#docList .doc-pick-item' };
  const row = $$(rows[origin.mode]).find((item) =>
    (item.dataset.id || item.dataset.note) === origin.id && item.dataset.item === origin.rowId);
  const target = origin.mode === 'doc' ? row : row?.querySelector(
    origin.mode === 'todo' ? '[data-goto]' : origin.more ? '.t-more' : '.note-title'
  );
  (target || $('#searchInput'))?.focus({ preventScroll: true });
}

function syncViewToggles(mode) {
  mode = (mode === 'memo' || mode === 'todo' || mode === 'doc') ? mode : 'board';
  ['board', 'memo', 'todo', 'doc'].forEach((m) => {
    const btn = $('#view' + m.charAt(0).toUpperCase() + m.slice(1));
    if (!btn) return;
    btn.classList.toggle('active', mode === m);
    btn.setAttribute('aria-pressed', mode === m ? 'true' : 'false');
  });
}

function setViewMode(mode) {
  state.settings.viewMode = mode;
  if (mode !== 'doc' || docPickerReturn) { docNoteId = null; docPickerReturn = null; }
  syncViewToggles(mode);
  save();
  renderAll();
}
