/* Canvas annotations use board units. A stroke that starts on a card lives in that card's local coordinates. */
(() => {
  const svgNS = 'http://www.w3.org/2000/svg';
  const colors = {
    auto: 'auto', blue: '#2858b9', red: '#b73735',
    gold: '#dfa31a', teal: '#00796d', white: '#ffffff'
  };
  let active = false;
  let tool = 'pen';
  const widths = { pen: 3, marker: 10 };
  let color = colors.auto;
  let gesture = null;
  let scope = null;
  const paths = new WeakMap();

  const getScope = () => layoutScopeKey();
  const canvasBackgroundInk = () => {
    if (filter.archive) return [];
    const allInk = state.settings.boardInk;
    const key = getScope();
    return allInk && Object.hasOwn(allInk, key) ? allInk[key] : [];
  };
  const isBoard = () => state.settings.viewMode === 'board' && !docPickerReturn;
  const canDraw = () => isBoard() && $('#settingsPanel').classList.contains('hidden') &&
    !filter.archive && !multiSelect && !dataReadonly;
  const svg = tag => document.createElementNS(svgNS, tag);

  function createLayer(host) {
    const layer = svg('svg');
    layer.classList.add('canvas-ink');
    layer.setAttribute('aria-hidden', 'true');
    if (host.id === 'board') host.prepend(layer);
    else host.append(layer);
    return layer;
  }

  function appendStroke(layer, stroke, noteId) {
    const path = svg('path');
    path.setAttribute('stroke', stroke.color === 'auto' ? 'currentColor' : stroke.color);
    path.setAttribute('stroke-width', stroke.width);
    if (stroke.tool === 'marker') path.classList.add('ink-marker');
    const [x, y] = stroke.points[0];
    path.setAttribute('d', 'M ' + x + ' ' + y + ' l .01 0');
    if (stroke.points.length > 1) {
      path.setAttribute('d', 'M ' + stroke.points.map(point => point.join(' ')).join(' L '));
    }
    layer.append(path);
    paths.set(path, { stroke, noteId });
    return path;
  }

  function renderInk() {
    const board = $('#board');
    board.querySelectorAll('.canvas-ink').forEach(layer => layer.remove());
    if (!isBoard()) return;
    const background = canvasBackgroundInk();
    if (background.length) {
      const layer = createLayer(board);
      for (const stroke of background) appendStroke(layer, stroke, null);
    }
    for (const note of state.notes) {
      const card = boardEls.get(note.id);
      if (!card || !note.ink?.length) continue;
      const layer = createLayer(card);
      for (const stroke of note.ink) appendStroke(layer, stroke, note.id);
    }
  }

  function setBackgroundInk(strokes) {
    state.settings.boardInk = { ...state.settings.boardInk, [scope]: strokes };
  }

  function releaseGesture(event, commit) {
    if (!gesture || (event && event.pointerId !== gesture.pointerId)) return;
    const { pointerId, path, stroke, noteId, layer } = gesture;
    gesture = null;
    const canvas = $('#canvas');
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    const note = noteId ? state.notes.find(item => item.id === noteId) : null;
    if (!commit || (noteId && !note)) {
      path.remove();
      if (!layer.childElementCount) layer.remove();
      return;
    }
    pushUndo();
    if (note) (note.ink ||= []).push(stroke);
    else {
      setBackgroundInk([...canvasBackgroundInk(), stroke]);
      syncBoardSize();
    }
    save();
  }

  function updateTools() {
    $('#btnCanvasDraw').setAttribute('aria-pressed', String(active));
    const tools = $('#canvasInkTools');
    tools.classList.toggle('hidden', !active);
    const canvas = $('#canvas');
    canvas.classList.toggle('canvas-drawing', active);
    canvas.classList.toggle('canvas-erasing', active && tool === 'eraser');
    for (const button of tools.querySelectorAll('[data-ink-tool]')) {
      button.setAttribute('aria-pressed', String(tool === button.dataset.inkTool));
    }
    for (const button of tools.querySelectorAll('[data-ink-color]')) {
      button.setAttribute('aria-pressed', String(color === button.dataset.inkColor));
      button.disabled = tool === 'eraser';
    }
    const width = $('#canvasInkWidth');
    width.disabled = tool === 'eraser';
    if (!width.disabled) width.value = String(widths[tool]);
    $('#canvasInkWidthValue').value = width.value;
    width.style.setProperty('--ink-width-fill', ((Number(width.value) - 1) / 19) * 100 + '%');
  }

  function stopCanvasInk(restoreFocus = false) {
    if (!active) return;
    releaseGesture(null, false);
    active = false;
    updateTools();
    if (restoreFocus) {
      const button = $('#btnCanvasDraw');
      (button.offsetWidth ? button : $('#btnWorkspaceNav')).focus({ preventScroll: true });
    }
  }

  function syncCanvasInk() {
    const nextScope = getScope();
    if (!canDraw() || nextScope !== scope) stopCanvasInk();
    releaseGesture(null, false);
    scope = nextScope;
    $('#canvasShortcuts').classList.toggle('hidden', !isBoard() || filter.archive || dataReadonly);
    $('#btnCanvasDraw').disabled = !canDraw();
    renderInk();
  }

  function sample(event, host) {
    const rect = host.getBoundingClientRect();
    const zoom = boardZoom();
    const x = (event.clientX - rect.left) / zoom - host.clientLeft;
    const y = (event.clientY - rect.top) / zoom - host.clientTop;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  }

  function addPoint(event) {
    const { host, path, stroke } = gesture;
    const point = sample(event, host);
    const last = stroke.points.at(-1);
    if (stroke.points.length >= 4096 || Math.hypot(point[0] - last[0], point[1] - last[1]) < 1) return;
    const prefix = stroke.points.length === 1 ? 'M ' + last.join(' ') : path.getAttribute('d');
    stroke.points.push(point);
    path.setAttribute('d', prefix + ' L ' + point.join(' '));
  }

  function bindCanvasInk() {
    const canvas = $('#canvas');
    const board = $('#board');
    const tools = $('#canvasInkTools');
    const width = $('#canvasInkWidth');
    const palette = $('#canvasInkColors');
    for (const [name, value] of Object.entries(colors)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ink-swatch';
      button.dataset.inkColor = value;
      button.dataset.i18nAriaLabel = button.dataset.i18nTitle = 'canvas_ink_' + name;
      button.style.setProperty('--ink-swatch', value === 'auto' ? 'var(--fg)' : value);
      button.onclick = () => { color = value; updateTools(); };
      palette.append(button);
    }
    for (const button of tools.querySelectorAll('[data-ink-tool]')) {
      button.onclick = () => { tool = button.dataset.inkTool; updateTools(); };
    }
    width.oninput = () => {
      widths[tool] = Number(width.value);
      updateTools();
    };
    $('#btnCanvasDraw').onclick = () => {
      if (active) return stopCanvasInk(true);
      if (!canDraw()) return;
      closePops();
      stopCanvasLink();
      active = true;
      updateTools();
      tools.querySelector('[aria-pressed="true"]').focus({ preventScroll: true });
    };
    $('#btnCanvasDrawExit').onclick = () => stopCanvasInk(true);
    document.addEventListener('keydown', event => {
      if (!active || event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      stopCanvasInk(true);
    }, true);
    canvas.addEventListener('pointerdown', event => {
      if (!active || event.button !== 0 || !event.isPrimary || spaceDown) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (document.activeElement === width) width.blur();
      if (tool === 'eraser') {
        const hit = paths.get(event.target);
        if (!hit) return;
        const note = hit.noteId ? state.notes.find(item => item.id === hit.noteId) : null;
        if (hit.noteId && !note) return;
        pushUndo();
        if (note) note.ink = note.ink.filter(stroke => stroke !== hit.stroke);
        else setBackgroundInk(canvasBackgroundInk().filter(stroke => stroke !== hit.stroke));
        renderInk();
        syncBoardSize();
        save();
        return;
      }
      const host = event.target.closest('#board .note') || board;
      const noteId = host === board ? null : host.dataset.id;
      const stroke = { tool, color, width: Number(width.value), points: [sample(event, host)] };
      const layer = host.querySelector(':scope > .canvas-ink') || createLayer(host);
      const path = appendStroke(layer, stroke, noteId);
      gesture = { pointerId: event.pointerId, host, stroke, noteId, path, layer };
      canvas.setPointerCapture(event.pointerId);
    }, true);
    canvas.addEventListener('pointermove', event => {
      if (gesture?.pointerId === event.pointerId) addPoint(event);
    });
    canvas.addEventListener('pointerup', event => {
      if (gesture?.pointerId !== event.pointerId) return;
      addPoint(event);
      releaseGesture(event, true);
    });
    canvas.addEventListener('lostpointercapture', event => releaseGesture(event, false));
    canvas.addEventListener('pointercancel', event => releaseGesture(event, false));
    for (const name of ['click', 'dblclick', 'contextmenu']) {
      canvas.addEventListener(name, event => {
        if (!active) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }
  }

  Object.assign(window, { bindCanvasInk, canvasBackgroundInk, syncCanvasInk, stopCanvasInk });
})();
