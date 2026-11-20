/* Canvas widgets share the board's card layout, history, and persistence. */
(() => {
  const dragType = 'application/x-note-memo-widget';
  const entries = () => $('#canvasGadgetEntries');
  const canAdd = () => state.settings.viewMode === 'board' && !docPickerReturn &&
    !filter.archive && !multiSelect && !dataReadonly && $('#settingsPanel').classList.contains('hidden');
  const icon = name => '<svg class="ui-icon" aria-hidden="true"><use href="#ui-' + name + '"/></svg>';
  const calendarDates = new WeakMap();
  const dateKey = date => String(date.getFullYear()).padStart(4, '0') + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');

  function addGadget(kind, x, y) {
    if (!canAdd() || !['timer', 'calendar'].includes(kind)) return;
    stopCanvasInk();
    stopCanvasLink();
    const gadget = kind === 'timer' ? { kind, minutes: 25, remaining: 1500000, endAt: 0 } : { kind };
    createNote(x, y, gadget);
  }

  function bindCanvasGadgets() {
    const canvas = $('#canvas');
    for (const button of entries().querySelectorAll('button')) {
      button.onclick = () => addGadget(button.dataset.gadget);
      button.addEventListener('dragstart', event => {
        if (!canAdd()) return event.preventDefault();
        event.dataTransfer.setData(dragType, button.dataset.gadget);
        event.dataTransfer.effectAllowed = 'copy';
      });
    }
    canvas.addEventListener('dragover', event => {
      if (!canAdd() || !event.dataTransfer.types.includes(dragType)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }, true);
    canvas.addEventListener('drop', event => {
      if (!canAdd() || !event.dataTransfer.types.includes(dragType)) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = $('#board').getBoundingClientRect();
      const zoom = boardZoom();
      addGadget(event.dataTransfer.getData(dragType),
        Math.max(0, Math.round((event.clientX - rect.left) / zoom)),
        Math.max(0, Math.round((event.clientY - rect.top) / zoom)));
    }, true);
    setInterval(() => {
      for (const card of document.querySelectorAll('#board .gadget-timer[data-running]')) card.__refreshGadget();
    }, 250);
    setInterval(() => {
      for (const card of document.querySelectorAll("#board .gadget-calendar")) card.__refreshGadget();
    }, 60000);
  }

  function syncCanvasGadgets() {
    const available = canAdd();
    entries().classList.toggle('hidden', !available);
    for (const card of document.querySelectorAll('#board .canvas-gadget')) card.__refreshGadget();
  }

  function buildCanvasGadget(card, note, tools, groupName, groupColor) {
    const kind = note.gadget.kind;
    card.classList.add('canvas-gadget', 'gadget-' + kind);
    card.__gadgetNote = note;
    card.innerHTML = '<div class="note-head"><span class="note-grip" aria-hidden="true">⠿</span>' +
      icon(kind === 'timer' ? 'clock' : 'calendar') + '<span class="gadget-title"></span>' +
      '<div class="note-tools compact-tools">' + tools + '</div></div><div class="gadget-body"></div>' +
      '<div class="note-foot"><span class="group-tag"><span class="dot"></span><span class="note-foot-label">' +
      groupName + '</span></span></div><div class="resize-handle"></div>';
    $('.gadget-title', card).textContent = t('gadget_' + kind);
    $('.group-tag .dot', card).style.background = groupColor || '#999';
    mountGadgetContent(card, $('.gadget-body', card), note, {
      canEdit: () => !multiSelect && !dataReadonly,
      dispatch: action => {
        if (note.desktopPin) return sendGadgetAction(note.id, action);
        if (action.type === 'mark') pushUndo();
        if (applyGadgetAction(note.gadget, action)) save();
        card.__refreshGadget();
      },
      notes: () => state.notes,
      language: state.settings.language,
      openNote: openNoteDetail
    });
  }

  async function sendGadgetAction(id, action) {
    const ok = await window.api.noteUpdate({ id }, { gadgetAction: action }).catch(() => false);
    if (!ok) {
      const warning = $('#noteSaveWarning');
      if (warning) {
        const retry = $('button', warning);
        retry.onclick = () => sendGadgetAction(id, action);
        warning.classList.remove('hidden');
      } else toast(t('toast_save_failed'));
    } else $('#noteSaveWarning')?.classList.add('hidden');
  }

  function mountGadgetContent(card, body, note, controls) {
    body.classList.add('gadget-body');
    card.classList.add('gadget-' + note.gadget.kind);
    card.__refreshGadget = note.gadget.kind === 'timer' ?
      buildTimer(card, body, note.gadget, controls) : buildCalendar(body, note, controls);
    card.__refreshGadget();
  }

  function buildTimer(card, body, timer, controls) {
    body.innerHTML =
      '<span class="gadget-time" role="timer"></span><span class="gadget-timer-status" role="status"></span>' +
      '<div class="gadget-progress" aria-hidden="true"><progress></progress></div>' +
      '<div class="gadget-controls"><button type="button" class="ct-btn gadget-reset">' + icon('reset') + '</button>' +
      '<button type="button" class="ct-btn gadget-start"></button>' +
      '<button type="button" class="ct-btn gadget-duration-toggle"></button></div>' +
      '<form class="gadget-duration-editor hidden"><label class="gadget-duration-value">' +
      '<input type="number" min="1" max="180" step="1" required><span></span></label>' +
      '<div class="gadget-duration-actions"><button type="button" class="ct-btn gadget-duration-cancel"></button>' +
      '<button type="submit" class="ct-btn gadget-duration-save"></button></div></form>' +
      '<textarea class="gadget-focus-text" rows="2" maxlength="2000" spellcheck="false"></textarea>';

    const output = $('.gadget-time', body);
    const status = $('.gadget-timer-status', body);
    const toggle = $('.gadget-duration-toggle', body);
    const progress = $('progress', body);
    const actionRow = $('.gadget-controls', body);
    const start = $('.gadget-start', body);
    const reset = $('.gadget-reset', body);
    const editor = $('.gadget-duration-editor', body);
    const duration = $('input', editor);
    const cancel = $('.gadget-duration-cancel', editor);
    const apply = $('.gadget-duration-save', editor);
    const focusText = $('.gadget-focus-text', body);
    focusText.setAttribute('aria-label', t('gadget_focus_text'));
    focusText.placeholder = t('gadget_focus_placeholder');
    focusText.value = timer.text || '';
    let editing = false;
    $('.gadget-duration-value span', editor).textContent = t('gadget_minutes');
    cancel.textContent = t('cancel');
    apply.textContent = t('save');
    reset.title = t('gadget_reset');
    const resetLabel = document.createElement('span');
    resetLabel.textContent = reset.title;
    reset.append(resetLabel);

    const pad = value => String(value).padStart(2, '0');
    function clock(seconds, hoursMode) {
      const minutes = Math.floor(seconds / 60);
      return hoursMode ? Math.floor(minutes / 60) + ':' + pad(minutes % 60) + ':' + pad(seconds % 60)
        : pad(minutes) + ':' + pad(seconds % 60);
    }

    function durationLabel(minutes) {
      const hours = Math.floor(minutes / 60);
      const remainder = minutes % 60;
      const parts = [];
      if (hours) parts.push(hours + ' ' + t('gadget_hour_unit'));
      if (remainder) parts.push(remainder + ' ' + t('gadget_minute_unit'));
      return parts.join(' ');
    }

    function update() {
      const total = timer.minutes * 60;
      const millis = timer.endAt ? Math.max(0, Math.min(total * 1000, timer.endAt - Date.now())) : timer.remaining;
      const seconds = Math.ceil(millis / 1000);
      const running = !!timer.endAt && millis > 0;
      const paused = !running && millis > 0 && millis < total * 1000;
      const canEdit = controls.canEdit();
      const editable = canEdit && !running && !paused;
      focusText.readOnly = !canEdit;
      const savedText = timer.text || '';
      if (document.activeElement !== focusText && focusText.value !== savedText) focusText.value = savedText;
      const editorHadFocus = editor.contains(document.activeElement);
      if (!editable) editing = false;

      const validInput = duration.validity.valid;
      const preview = editing && validInput ? duration.valueAsNumber : timer.minutes;
      const display = editing ? clock(preview * 60, preview >= 60) : clock(seconds, timer.minutes >= 60);
      if (output.textContent !== display) output.textContent = display;
      const message = editing ? durationLabel(preview) : t(running ? 'gadget_running' :
        millis === 0 ? 'gadget_done' : paused ? 'gadget_paused' : 'gadget_idle');
      if (status.textContent !== message) status.textContent = message;
      card.toggleAttribute('data-running', running);

      const action = t(running ? 'gadget_pause' : paused ? 'gadget_continue' : 'gadget_start');
      if (start.title !== action) {
        start.title = action;
        start.innerHTML = icon(running ? 'pause' : 'play');
        const label = document.createElement('span');
        label.textContent = action;
        start.append(label);
      }
      progress.max = total;
      progress.value = total - seconds;
      progress.parentElement.classList.toggle('hidden', editing);
      actionRow.classList.toggle('hidden', editing);
      editor.classList.toggle('hidden', !editing);
      const label = durationLabel(timer.minutes);
      if (toggle.textContent !== label) toggle.textContent = label;
      toggle.disabled = !editable;
      start.disabled = reset.disabled = !canEdit;
      apply.disabled = !validInput;
      if (!editing && editorHadFocus && !start.disabled) start.focus({ preventScroll: true });
    }

    function closeEditor() {
      editing = false;
      update();
      if (!toggle.disabled) toggle.focus({ preventScroll: true });
    }

    toggle.onclick = () => {
      editing = true;
      duration.value = timer.minutes;
      update();
      duration.focus({ preventScroll: true });
      duration.select();
    };
    focusText.oninput = () => {
      if (controls.canEdit()) controls.dispatch({ type: 'text', text: focusText.value });
    };
    focusText.onblur = update;
    duration.oninput = update;
    cancel.onclick = closeEditor;
    editor.onkeydown = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeEditor();
    };
    editor.onsubmit = event => {
      event.preventDefault();
      if (!controls.canEdit() || !duration.validity.valid) return;
      const minutes = duration.valueAsNumber;
      closeEditor();
      controls.dispatch({ type: 'duration', minutes });
    };
    start.onclick = () => { if (controls.canEdit()) controls.dispatch({ type: 'toggle' }); };
    reset.onclick = () => { if (controls.canEdit()) controls.dispatch({ type: 'reset' }); };
    return update;
  }

  function buildCalendar(body, note, controls) {
    const initial = calendarDates.get(note) || new Date();
    let selectedDate = initial;
    let month = new Date(initial.getFullYear(), initial.getMonth(), 1);
    const records = () => note.gadget.entries || {};
    let previousSignature = '';
    const locale = controls.language === 'en' ? 'en' : 'zh-CN';
    const monthFormat = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' });
    const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    const dayFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'full' });
    const shortDate = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
    body.innerHTML = '<div class="gadget-calendar-nav"><button type="button" class="ct-btn gadget-prev">‹</button>' +
      '<span class="gadget-month"></span><button type="button" class="ct-btn gadget-next">›</button></div>' +
      '<div class="gadget-weekdays" aria-hidden="true"></div><div class="gadget-days"></div>' +
      '<div class="gadget-day-panel"><div class="gadget-day-header"><span class="gadget-day-date"></span>' +
      '<button type="button" class="ct-btn gadget-day-mark" aria-pressed="false">' + icon('flag') + '</button></div>' +
      '<textarea class="gadget-day-text" rows="2" maxlength="2000"></textarea></div><div class="gadget-reminders"></div>';
    const editor = $('.gadget-day-text', body), mark = $('.gadget-day-mark', body);
    const dayHeading = $('.gadget-day-date', body);
    editor.placeholder = t('gadget_day_placeholder');
    editor.setAttribute('aria-label', t('gadget_day_note'));
    mark.title = t('gadget_mark_day');
    mark.setAttribute('aria-label', mark.title);
    let editorKey;
    const prev = $('.gadget-prev', body), next = $('.gadget-next', body);
    prev.setAttribute('aria-label', t('gadget_prev'));
    next.setAttribute('aria-label', t('gadget_next'));
    for (let i = 0; i < 7; i++) {
      const day = document.createElement('span');
      day.textContent = weekdayFormat.format(new Date(2024, 0, i + 1));
      $('.gadget-weekdays', body).append(day);
    }

    function update() {
      const today = dateKey(new Date());
      const selectedKey = dateKey(selectedDate);
      const entry = records()[selectedKey];
      if (editorKey !== selectedKey || (document.activeElement !== editor && editor.value !== (entry?.text || ''))) {
        editorKey = selectedKey;
        editor.value = entry?.text || '';
        dayHeading.textContent = shortDate.format(selectedDate);
      }
      editor.readOnly = !controls.canEdit();
      mark.disabled = editor.readOnly;
      mark.setAttribute('aria-pressed', String(!!entry?.marked));
      const monthIndex = month.getMonth(), year = month.getFullYear();
      const rows = controls.notes().filter(note => !note.archived && !note.gadget && note.reminder?.enabled && note.reminder.time)
        .map(note => [note, new Date(note.reminder.time)])
        .filter(([, date]) => date.getFullYear() === year && date.getMonth() === monthIndex)
        .sort((a, b) => a[1] - b[1]);
      const prefix = selectedKey.slice(0, 7);
      const markedDates = Object.keys(records()).filter(key => key.startsWith(prefix) && records()[key].marked);
      const signature = JSON.stringify([today, selectedKey, markedDates, rows.map(([n, d]) => [n.id, n.title, +d])]);
      if (signature === previousSignature) return;
      previousSignature = signature;
      $('.gadget-month', body).textContent = monthFormat.format(month);
      const days = $('.gadget-days', body);
      days.replaceChildren();
      const offset = (month.getDay() + 6) % 7;
      const end = new Date(year, monthIndex + 1, 0).getDate();
      for (let i = 0; i < offset; i++) days.append(document.createElement('span'));
      const counts = new Map();
      for (const [, date] of rows) counts.set(dateKey(date), (counts.get(dateKey(date)) || 0) + 1);
      for (let i = 1; i <= end; i++) {
        const date = new Date(year, monthIndex, i), key = dateKey(date);
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.textContent = i;
        const marked = records()[key]?.marked;
        cell.setAttribute('aria-label', dayFormat.format(date) +
          (marked ? ' · ' + t('gadget_marked') : '') +
          (counts.has(key) ? ' · ' + t('gadget_reminders') + ' ' + counts.get(key) : ''));
        cell.classList.toggle('gadget-day-marked', !!marked);
        cell.setAttribute('aria-pressed', String(key === selectedKey));
        if (key === today) cell.setAttribute('aria-current', 'date');
        cell.classList.toggle('gadget-has-reminders', counts.has(key));
        cell.onclick = () => {
          if (!controls.canEdit()) return;
          selectedDate = date;
          calendarDates.set(note, selectedDate);
          update();
          days.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
        };
        days.append(cell);
      }
      const list = $('.gadget-reminders', body);
      list.replaceChildren();
      for (const [note, date] of rows) {
        if (dateKey(date) !== selectedKey) continue;
        const item = document.createElement('button');
        item.type = 'button';
        item.textContent = note.title || t('untitled');
        item.onclick = () => { if (controls.canEdit()) controls.openNote(note.id, item); };
        list.append(item);
      }
    }
    const moveMonth = delta => {
      if (!controls.canEdit()) return;
      month = new Date(month.getFullYear(), month.getMonth() + delta, 1);
      selectedDate = month;
      calendarDates.set(note, selectedDate);
      update();
    };
    editor.onblur = update;
    editor.oninput = () => {
      if (!editor.readOnly) controls.dispatch({ type: 'text', date: editorKey, text: editor.value });
    };
    mark.onclick = () => {
      if (!mark.disabled) controls.dispatch({ type: 'mark', date: editorKey, marked: !records()[editorKey]?.marked });
    };
    prev.onclick = () => moveMonth(-1);
    next.onclick = () => moveMonth(1);
    return update;
  }

  Object.assign(window, { bindCanvasGadgets, syncCanvasGadgets, buildCanvasGadget, mountGadgetContent, sendGadgetAction });
})();
