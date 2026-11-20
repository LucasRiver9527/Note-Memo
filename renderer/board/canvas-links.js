
/* Canvas link selection and its transient overlay. Coordinates are local to #board. */
(() => {
  const svgNS = 'http://www.w3.org/2000/svg';
  let active = false;
  let sourceId = null;
  let hoverId = null;
  let cursor = null;
  let frame = 0;

  const boardIsAvailable = () =>
    state.settings.viewMode === 'board' && !docPickerReturn &&
    $('#settingsPanel').classList.contains('hidden');

  function canLinkCanvasNotes() {
    return boardIsAvailable() && !multiSelect && !filter.archive && !dataReadonly && state.notes.filter(note => !note.gadget && boardEls.has(note.id)).length >= 2;
  }

  function stopLinking() {
    active = false;
    sourceId = null;
    cursor = null;
    syncCanvasLinks();
  }

  function syncCanvasLinks() {
    if (active && (!canLinkCanvasNotes() || (sourceId && !boardEls.has(sourceId)))) {
      stopLinking();
      return;
    }
    const button = $('#btnCanvasLink');
    button.setAttribute('aria-pressed', String(active));
    button.disabled = !canLinkCanvasNotes();
    button.title = t(button.disabled ? 'canvas_link_unavailable' : 'canvas_link');
    $('#canvasLinkPrompt').classList.toggle('hidden', !active);
    $('#board').classList.toggle('canvas-linking', active);
    for (const [id, el] of boardEls) {
      if (el.classList.contains("canvas-gadget")) continue;
      el.classList.toggle('link-source', active && id === sourceId);
      if (active) el.tabIndex = 0;
      else if (el.tabIndex === 0) el.removeAttribute('tabindex');
    }
    if (active) $('#canvasLinkStatus').textContent = t(sourceId ? 'canvas_link_target' : 'canvas_link_start');
    scheduleCanvasLinks();
  }

  function startCanvasLink(startId = null) {
    if (!canLinkCanvasNotes() || (startId && !boardEls.has(startId))) return;
    stopCanvasInk();
    active = true;
    sourceId = startId;
    cursor = null;
    syncCanvasLinks();
    const start = startId ? boardEls.get(startId) : [...boardEls.values()].find(el => !el.classList.contains("canvas-gadget"));
    start.focus({ preventScroll: true });
  }

  function pickNote(id) {
    if (!boardEls.has(id) || !canLinkCanvasNotes()) return;
    if (!sourceId) {
      sourceId = id;
      syncCanvasLinks();
      return;
    }
    if (id === sourceId) return;
    const source = state.notes.find(note => note.id === sourceId);
    if (!source) return stopLinking();
    if (source.links?.some(link => link.targetId === id)) {
      toast(t('canvas_link_duplicate'));
      return;
    }
    pushUndo();
    (source.links ||= []).push({ targetId: id, label: '' });
    hoverId = id;
    stopLinking();
    save();
    toast(t('canvas_link_added'));
  }

  function edge(rect, toward) {
    const dx = toward.x - rect.x, dy = toward.y - rect.y;
    const factor = Math.max(Math.abs(dx) / (rect.width / 2), Math.abs(dy) / (rect.height / 2));
    if (!factor) return { x: rect.x, y: rect.y, dx: 1, dy: 0 };
    const horizontal = Math.abs(dx) / rect.width >= Math.abs(dy) / rect.height;
    return { x: rect.x + dx / factor, y: rect.y + dy / factor,
      dx: horizontal ? Math.sign(dx) : 0, dy: horizontal ? 0 : Math.sign(dy) };
  }

  function drawLinks() {
    const board = $('#board');
    board.querySelector('#canvasLinks')?.remove();
    if (!boardIsAvailable()) return;
    const focusedId = document.activeElement?.closest('#board .note')?.dataset.id;
    const currentId = hoverId || focusedId;
    const always = state.settings.showCanvasLinks !== false;
    if (!active && !always && !currentId) return;
    const layer = document.createElementNS(svgNS, 'svg');
    layer.id = 'canvasLinks';
    layer.setAttribute('aria-hidden', 'true');
    const origin = board.getBoundingClientRect();
    const zoom = boardZoom();
    const local = (x, y) => ({ x: (x - origin.left) / zoom, y: (y - origin.top) / zoom });
    const bounds = new Map();
    const rect = id => {
      if (bounds.has(id)) return bounds.get(id);
      const el = boardEls.get(id);
      if (!el?.isConnected) return null;
      const b = el.getBoundingClientRect();
      const value = { ...local(b.left + b.width / 2, b.top + b.height / 2), width: b.width / zoom, height: b.height / zoom };
      bounds.set(id, value);
      return value;
    };
    function append(from, to, point, label, reciprocal = false) {
      const a = rect(from);
      const b = to ? rect(to) : null;
      if (!a || (!b && !point)) return;
      const start = edge(a, b || point);
      const end = b ? edge(b, a) : { ...point, dx: 0, dy: 0 };
      const dx = end.x - start.x, dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      if (length < 1) return;
      const bend = Math.min(70, length * 0.42);
      const path = document.createElementNS(svgNS, 'path');
      // Reversing the direction also reverses the normal, so each line bends to its own side.
      const separation = reciprocal ? Math.min(20 / zoom, length * 0.24) : 0;
      const offsetX = -dy / length * separation, offsetY = dx / length * separation;
      const c1 = { x: start.x + start.dx * bend + offsetX, y: start.y + start.dy * bend + offsetY };
      const c2 = { x: end.x + end.dx * bend + offsetX, y: end.y + end.dy * bend + offsetY };
      path.setAttribute('d', ['M', start.x, start.y, 'C', c1.x, c1.y, c2.x, c2.y, end.x, end.y].join(' '));
      path.classList.add(point ? 'link-preview' : 'note-link-line');
      layer.append(path);
      if (b && length * zoom >= 9) {
        const tangentX = end.x - c2.x, tangentY = end.y - c2.y;
        const tangent = Math.hypot(tangentX, tangentY);
        const ux = tangentX / (tangent || 1), uy = tangentY / (tangent || 1);
        const size = Math.min(7 / zoom, length * 0.32);
        const midX = end.x - ux * size, midY = end.y - uy * size;
        const wing = size * 0.53;
        const arrow = document.createElementNS(svgNS, 'path');
        arrow.classList.add('note-link-arrow');
        arrow.setAttribute('d', ['M', midX - uy * wing, midY + ux * wing,
          'L', end.x, end.y, 'L', midX + uy * wing, midY - ux * wing].join(' '));
        layer.append(arrow);
      }
      if (label) {
        const text = document.createElementNS(svgNS, 'text');
        const chars = Array.from(label);
        text.classList.add('note-link-label');
        const sideLabel = reciprocal && Math.abs(dy) > Math.abs(dx);
        const labelX = (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8;
        const labelY = (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8;
        text.setAttribute('x', labelX + (sideLabel ? Math.sign(offsetX) * 5 : 0));
        text.setAttribute('y', labelY + (sideLabel ? 4 : ((dx >= 0) === !reciprocal ? -7 : 14)));
        if (sideLabel) text.style.textAnchor = offsetX < 0 ? 'end' : 'start';
        text.textContent = chars.length > 24 ? chars.slice(0, 24).join('') + '…' : label;
        layer.append(text);
      }
    }
    if (active && sourceId && cursor) append(sourceId, hoverId !== sourceId ? hoverId : null, local(cursor.x, cursor.y));
    if (!active || always) {
      const visible = new Map(state.notes.filter(note => boardEls.has(note.id)).map(note => [note.id, note]));
      for (const note of visible.values()) {
        for (const link of note.links || []) {
          if (!always && note.id !== currentId && link.targetId !== currentId) continue;
          const target = visible.get(link.targetId);
          if (!target) continue;
          const reciprocal = target.links?.some(reverse => reverse.targetId === note.id);
          append(note.id, target.id, null, link.label, reciprocal);
        }
      }
    }
    if (layer.childElementCount) board.prepend(layer);
  }

  function scheduleCanvasLinks() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; drawLinks(); });
  }

  function bindCanvasLinks() {
    const board = $('#board');
    const canvas = $('#canvas');
    $('#btnCanvasLinkExit').onclick = stopLinking;
    $('#btnCanvasLink').onclick = () => { if (active) stopLinking(); else startCanvasLink(); };
    const noteId = event => event.target.closest?.('#board .note:not(.canvas-gadget)')?.dataset.id || null;
    canvas.addEventListener('pointerdown', event => {
      if (!active || event.button !== 0 || spaceDown) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    canvas.addEventListener('click', event => {
      if (!active || event.button !== 0 || spaceDown) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (noteId(event)) pickNote(noteId(event));
    }, true);
    canvas.addEventListener('dblclick', event => {
      if (active) event.stopImmediatePropagation();
    }, true);
    board.addEventListener('pointermove', event => {
      const id = noteId(event);
      if (!active && (id === hoverId || document.body.classList.contains('note-dragging'))) return;
      hoverId = id;
      cursor = { x: event.clientX, y: event.clientY };
      if (active || state.settings.showCanvasLinks === false) scheduleCanvasLinks();
    });
    board.addEventListener('pointerleave', () => {
      hoverId = null;
      cursor = null;
      if (active || state.settings.showCanvasLinks === false) scheduleCanvasLinks();
    });
    canvas.addEventListener('scroll', scheduleCanvasLinks, { passive: true });
    canvas.addEventListener('contextmenu', event => {
      if (!active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    board.addEventListener('focusin', scheduleCanvasLinks);
    board.addEventListener('focusout', scheduleCanvasLinks);
    document.addEventListener('keydown', event => {
      if (!active || !boardIsAvailable()) return;
      const id = noteId(event);
      if (event.key === 'Escape' || (event.target.matches?.('#board .note') && (event.key === 'Enter' || event.key === ' '))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === 'Escape') stopLinking();
        else pickNote(id);
      }
    }, true);
  }

  function canvasRelationsFor(id) {
    const notes = new Map(state.notes.map(note => [note.id, note]));
    const result = [];
    for (const source of notes.values()) {
      for (const link of source.links || []) {
        if (source.id !== id && link.targetId !== id) continue;
        const target = notes.get(link.targetId);
        if (target) result.push({ source, target, link });
      }
    }
    return result;
  }

  function openCanvasRelations(id, trigger) {
    const relations = canvasRelationsFor(id);
    if (!relations.length || dataReadonly || $('#noteRelations')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'noteRelations';
    dialog.setAttribute('data-modal-overlay', '');
    dialog.setAttribute('aria-labelledby', 'noteRelationsTitle');
    dialog.innerHTML = '<form><h2 id="noteRelationsTitle"></h2><div class="relation-list"></div>' +
      '<footer><button type="button" class="sp-btn ghost"></button><button type="submit" class="sp-btn primary"></button></footer></form>';
    $('#noteRelationsTitle', dialog).textContent = t('canvas_link_manage');
    const cancel = $('footer button[type="button"]', dialog);
    cancel.textContent = t('cancel');
    cancel.onclick = () => dialog.close();
    $('footer button[type="submit"]', dialog).textContent = t('canvas_link_save');
    const displayName = note => note.title?.trim() || t('untitled');
    const drafts = relations.map(({ source, target, link }) => {
      const row = document.createElement('div');
      row.className = 'relation-row';
      const label = document.createElement('label');
      const pair = document.createElement('span');
      pair.className = 'relation-pair';
      pair.textContent = displayName(source) + ' → ' + displayName(target);
      const input = document.createElement('input');
      input.maxLength = 80;
      input.value = link.label;
      input.placeholder = t('canvas_link_label');
      input.setAttribute('aria-label', t('canvas_link_label') + ' · ' + pair.textContent);
      label.append(pair, input);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'sp-btn danger';
      remove.textContent = t('canvas_link_remove');
      remove.setAttribute('aria-pressed', 'false');
      const draft = { sourceId: source.id, targetId: target.id, input, removed: false };
      remove.onclick = () => {
        draft.removed = !draft.removed;
        input.disabled = draft.removed;
        remove.setAttribute('aria-pressed', String(draft.removed));
        remove.textContent = t(draft.removed ? 'undo' : 'canvas_link_remove');
      };
      row.append(label, remove);
      $('.relation-list', dialog).append(row);
      return draft;
    });
    $('form', dialog).onsubmit = event => {
      event.preventDefault();
      if (dataReadonly) return dialog.close();
      const fresh = canvasRelationsFor(id);
      const changes = [];
      for (const draft of drafts) {
        const relation = fresh.find(item => item.source.id === draft.sourceId && item.target.id === draft.targetId);
        const label = draft.input.value.trim();
        if (relation && (draft.removed || label !== relation.link.label)) changes.push({ ...relation, label, removed: draft.removed });
      }
      if (changes.length) {
        pushUndo();
        for (const { source, link, label, removed } of changes) {
          if (removed) {
            source.links = source.links.filter(item => item !== link);
            if (!source.links.length) delete source.links;
          } else link.label = label;
        }
        save();
        scheduleCanvasLinks();
      }
      dialog.close();
    };
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        const focusTarget = trigger.matches('button, input, [contenteditable]') ? trigger :
          trigger.closest('.note, .memo-row')?.querySelector('.t-more');
        focusTarget?.focus();
      }
      scheduleCanvasLinks();
    });
    document.body.append(dialog);
    dialog.showModal();
    drafts[0].input.focus();
  }

  Object.assign(window, { bindCanvasLinks, canLinkCanvasNotes, startCanvasLink, stopCanvasLink: stopLinking, syncCanvasLinks, scheduleCanvasLinks, canvasRelationsFor, openCanvasRelations });
})();

