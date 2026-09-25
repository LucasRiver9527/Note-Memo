/* panels/popovers.js
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.popoversView + 顶层全局。
   —— 本模块的函数通过顶层全局访问其他模块（与 board-layout.js 等同构）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.popoversView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

/* ============ 颜色 / 分组弹窗 ============ */
function closePops() {
  if (activeColorPop) { activeColorPop.remove(); activeColorPop = null; }
  if (activeGroupPop) { activeGroupPop.remove(); activeGroupPop = null; }
}

function showNoteContextMenu(e, n) {
  e.preventDefault();
  e.stopPropagation();
  closePops();
  savedNoteId = n.id;
  captureSelection();
  savedImageSrc = getSelectedImageSrc(n);
  // 菜单锚点：切换模式/展开二级后需按同一锚点重新定位，避免菜单"跳走"
  const anchorX = e.clientX;
  const anchorY = e.clientY;
  const pop = document.createElement('div');
  pop.className = 'color-pop ctx-menu';
  pop.style.gridTemplateColumns = '1fr';
  pop.style.minWidth = '132px';
  pop.style.padding = '4px';
  pop.style.maxHeight = Math.min(window.innerHeight - 24, 440) + 'px';
  pop.style.overflowY = 'auto';

  // 菜单项：danger = 破坏性操作（红色）；accel = 右侧快捷键提示；host = 容器（默认 pop，二级用 childHost）
  const addItem = (icon, label, onClick, danger, accel, host) => {
    const b = document.createElement('button');
    b.style.cssText = 'background:transparent;border:none;color:' + (danger ? 'var(--danger, #e24b4a)' : 'var(--fg)') + ';padding:3.5px 8px;border-radius:6px;cursor:pointer;text-align:left;font-size:12px;line-height:1.3;font-family:inherit;width:100%;display:flex;align-items:center;gap:5px;';
    b.innerHTML = `<span>${icon}</span><span style="flex:1">${label}</span>` + (accel ? `<span style="opacity:.55;font-size:11px">${accel}</span>` : '');
    b.onmouseenter = () => (b.style.background = danger ? 'var(--danger-soft, rgba(226,75,74,.16))' : 'var(--accent-soft)');
    b.onmouseleave = () => (b.style.background = 'transparent');
    b.onclick = () => { closePops(); onClick(); };
    (host || pop).appendChild(b);
    return b;
  };

  // 分隔线
  const addSep = (host) => {
    const s = document.createElement('div');
    s.style.cssText = 'height:1px;background:var(--border);margin:4px 0;';
    (host || pop).appendChild(s);
  };

  // 定位：把菜单夹在可视区内。展开二级或切换模式后高度会变，需重复调用。
  const positionMenu = () => {
    const x = Math.max(8, Math.min(anchorX, window.innerWidth - pop.offsetWidth - 8));
    const y = Math.max(8, Math.min(anchorY, window.innerHeight - pop.offsetHeight - 8));
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';
  };

  // 二级子菜单（原地展开/收起，不关闭菜单、不影响已捕获的选区）
  // 返回 { wrap, childHost }：childHost 里放子项，展开时才可见
  const addSubmenu = (icon, label, expanded) => {
    const wrap = document.createElement('div');
    const btn = document.createElement('button');
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    btn.style.cssText = 'background:transparent;border:none;color:var(--fg);padding:3.5px 8px;border-radius:6px;cursor:pointer;text-align:left;font-size:12px;line-height:1.3;font-family:inherit;width:100%;display:flex;align-items:center;gap:5px;';
    btn.innerHTML = `<span>${icon}</span><span style="flex:1">${label}</span><span style="opacity:.6;font-size:10px">${expanded ? '▾' : '▸'}</span>`;
    btn.onmouseenter = () => (btn.style.background = 'var(--accent-soft)');
    btn.onmouseleave = () => (btn.style.background = 'transparent');
    const childHost = document.createElement('div');
    childHost.style.cssText = 'display:' + (expanded ? 'block' : 'none') + ';padding-left:14px;';
    btn.onclick = (ev) => {
      ev.stopPropagation();                       // 不冒泡到「点空白关闭菜单」
      const nowOpen = childHost.style.display === 'none';
      childHost.style.display = nowOpen ? 'block' : 'none';
      btn.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
      btn.lastElementChild.textContent = nowOpen ? '▾' : '▸';
      positionMenu();                             // 展开后高度变了，重新夹到可视区
    };
    wrap.appendChild(btn);
    wrap.appendChild(childHost);
    pop.appendChild(wrap);
    return { wrap, childHost, btn };
  };

  // 高亮色板行（可放一级或收进二级）
  const addHighlightRow = (host) => {
    const hlLabel = document.createElement('div');
    hlLabel.style.cssText = 'font-size:11px;color:var(--fg-dim);padding:8px 10px 2px;';
    hlLabel.textContent = t('highlight_color');
    host.appendChild(hlLabel);
    const hlRow = document.createElement('div');
    hlRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;padding:4px 10px 8px;';
    HIGHLIGHT_COLORS.forEach((c) => {
      const s = document.createElement('button');
      s.className = 'swatch' + (highlightColor() === c ? ' active' : '');
      s.style.background = c;
      s.title = c;
      s.onclick = (e) => { e.stopPropagation(); setHighlightColor(c); };
      hlRow.appendChild(s);
    });
    const hlCustom = document.createElement('input');
    hlCustom.type = 'color';
    hlCustom.value = highlightColor();
    hlCustom.title = t('custom');
    hlCustom.style.cssText = 'width:26px;height:26px;border:1px solid var(--border);border-radius:7px;background:transparent;cursor:pointer;padding:0;';
    hlCustom.oninput = (e) => setHighlightColor(e.target.value);
    hlCustom.onclick = (e) => e.stopPropagation();
    hlRow.appendChild(hlCustom);
    host.appendChild(hlRow);
  };

  // —— 各菜单项的动作（与显示模式无关，两种模式共用同一份回调） ——
  const fnCopy = () => {
    const imgSrc = savedImageSrc;
    if (imgSrc) {
      const imgObj = (n.images || []).find((im) => im.src === imgSrc);
      copiedImage = { src: imgSrc, w: (imgObj && imgObj.w) || 200 };
      window.api.copyImage(imgSrc);
      toast(t('toast_img_copied'));
    } else {
      copiedImage = null;
      if (savedSelText) window.api.writeClipboard(savedSelText);
      else window.api.writeClipboard(noteText(n));
    }
    clearSavedSelection();
  };
  const fnCut = () => {
    const c = focusNoteContent(n);
    if (c) c.focus();
    if (savedRange && savedNoteId === n.id) restoreSelection();
    document.execCommand('cut');
    copiedImage = null;
    clearSavedSelection();
  };
  const fnPaste = async () => {
    if (copiedImage) {
      insertImageReferenceAtCursor(n, copiedImage.src, copiedImage.w);
      clearSavedSelection();
      return;
    }
    const files = await window.api.readClipboardFiles();
    if (files && files.length) {
      await insertPastedFilesAtCursor(n, files);
      clearSavedSelection();
      return;
    }
    const imgDataUrl = await readClipboardImageAsDataUrl();
    if (imgDataUrl) {
      await addNoteImageFromDataUrl(imgDataUrl, n);
      clearSavedSelection();
      return;
    }
    const text = await window.api.readClipboard();
    if (text) {
      const c = focusNoteContent(n);
      if (c) {
        c.focus();
        if (savedRange && savedNoteId === n.id) restoreSelection();
        document.execCommand('insertText', false, text);
      }
    }
    clearSavedSelection();
  };
  const fnSelectAll = () => {
    const c = focusNoteContent(n);
    if (c) { c.focus(); document.execCommand('selectAll'); }
    else { const ae = document.activeElement; if (ae && ae.select) ae.select(); else document.execCommand('selectAll'); }
    clearSavedSelection();
  };

  const alignNote = (cmd) => {
    const c = focusNoteContent(n);
    if (c) {
      c.focus();
      if (savedRange && savedNoteId === n.id) restoreSelection();
      alignBlock(c, cmd);
      n.content = readRichContent(c);
      n.updatedAt = Date.now();
      save();
      renderAll();
    }
    clearSavedSelection();
  };
  const fnBold = () => {
    const c = focusNoteContent(n);
    if (c) {
      c.focus();
      if (savedRange && savedNoteId === n.id) restoreSelection();
      toggleBold(c);
    }
    clearSavedSelection();
  };
  const fnHighlight = () => {
    const c = focusNoteContent(n);
    if (c) {
      c.focus();
      if (savedRange && savedNoteId === n.id) restoreSelection();
      toggleHighlight(c);
    }
    clearSavedSelection();
  };
  const fnTable = () => openTableInsertDialog(n);
  const fnImage = async () => {
    const r = await window.api.pickNoteImage();
    if (r.ok) insertImageByUrl(n, r.url);
    else if (!r.canceled) toast(t('toast_img_saved_fail') + r.error);
  };
  const fnPin = () => { n.pinned = !n.pinned; n.updatedAt = Date.now(); save(); renderAll(); };
  const fnTodo = () => {
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
  const fnGroup = () => {
    if (n.groupId) { n.groupId = null; n.updatedAt = Date.now(); save(); renderAll(); }
    else openGroupPop(noteAnchor(n), n);
  };
  const fnDesktop = () => {
    n.desktopPin = true;
    n.updatedAt = Date.now();
    saveNow();
    window.api.pinToDesktop(n.id);
    renderAll();
    toast(t('toast_pinned'));
  };
  const fnRemind = () => openReminder(n);
  const fnColor = () => openColorPop(noteAnchor(n), n, anchorX, anchorY);
  const fnArchive = () => {
    n.archived = !n.archived;
    n.updatedAt = Date.now();
    save();
    renderAll();
    toast(t(n.archived ? 'toast_archived' : 'toast_unarchived'));
  };
  const fnPreview = () => {
    n.preview = !n.preview;
    n.updatedAt = Date.now();
    save();
    renderAll();
  };
  const fnExportMd = async () => {
    const fname = ((n.title || '').replace(/[\\/:*?"<>|]/g, '_').trim() || '便签') + '.md';
    const md = noteToMarkdown(n, { image: (src) => src });
    const r = await window.api.exportNoteMarkdown(md, fname);
    if (r.ok) toast(t('toast_exported') + r.path);
    else if (!r.canceled) toast(t('toast_export_fail') + r.error);
  };
  // ★ 删除：始终一级，保持原有调用链（deleteNote 内含存在性校验 / pushUndo / desktopPin 解绑 / 入回收站）
  const fnDelete = () => deleteNote(n.id);

  /* —— 菜单体构建：mode 变化时整块重建 ——
     ⚠️ 重建时不得调用 closePops()（会关闭菜单）或 clearSavedSelection()（会清空已捕获的选区），
        否则切换「精简/完整」后粘贴、加粗等依赖选区的操作会失效。 */
  const buildMenu = (mode) => {
    const compact = mode !== 'full';
    pop.innerHTML = '';
    state.settings.ctxMenuMode = compact ? 'compact' : 'full';

    // 顶部开关：切换即时生效
    const sw = document.createElement('button');
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', compact ? 'false' : 'true');
    sw.title = t('ctx_menu_switch_tip');
    sw.style.cssText = 'background:transparent;border:none;color:var(--fg);padding:4px 8px;border-radius:6px;cursor:pointer;text-align:left;font-size:12px;line-height:1.3;font-family:inherit;width:100%;display:flex;align-items:center;gap:5px;';
    sw.innerHTML = `<span>☰</span><span style="flex:1">${t('ctx_menu_compact')} / ${t('ctx_menu_full')}</span><span style="opacity:.6;font-size:11px">${compact ? t('ctx_menu_compact') : t('ctx_menu_full')}</span>`;
    sw.onmouseenter = () => (sw.style.background = 'var(--accent-soft)');
    sw.onmouseleave = () => (sw.style.background = 'transparent');
    sw.onclick = (ev) => {
      ev.stopPropagation();
      state.settings.ctxMenuMode = compact ? 'full' : 'compact';
      save();
      buildMenu(state.settings.ctxMenuMode);      // 原地重建：菜单不关闭、选区不清空
    };
    pop.appendChild(sw);
    addSep();

    // —— 文本编辑：两种模式都在一级（绝对高频，且带原生/全局快捷键） ——
    addItem('📋', t('copy'), fnCopy, false, 'Ctrl+C');
    addItem('✂️', t('cut'), fnCut, false, 'Ctrl+X');
    addItem('📥', t('paste'), fnPaste, false, 'Ctrl+V');
    addItem('▤', t('select_all'), fnSelectAll, false, 'Ctrl+A');
    addSep();
    const isBold = !!document.queryCommandState('bold');
    const isHl = selectionHasHighlight();
    addItem('𝗕', isBold ? t('unbold') : t('bold'), fnBold, false, 'Ctrl+B');
    addItem('🖍', isHl ? t('unhighlight') : t('highlight'), fnHighlight, false, 'Ctrl+H');

    // —— 格式：精简收进「格式 ▸」，完整平铺 ——
    const fmtHost = compact ? addSubmenu('⌗', t('ctx_menu_format'), false).childHost : pop;
    addItem('⇤', t('align_left'), () => alignNote('justifyLeft'), false, 'Ctrl+L', fmtHost);
    addItem('⇹', t('align_center'), () => alignNote('justifyCenter'), false, 'Ctrl+E', fmtHost);
    addItem('⇥', t('align_right'), () => alignNote('justifyRight'), false, 'Ctrl+R', fmtHost);
    addHighlightRow(fmtHost);
    addSep();

    // —— 便签操作：精简收进「便签 ▸」，完整平铺 ——
    const noteHost = compact ? addSubmenu('📄', t('ctx_menu_note'), false).childHost : pop;
    addItem('▦', t('insert_table'), fnTable, false, null, noteHost);
    addItem('🖼️', t('insert_image'), fnImage, false, null, noteHost);
    addItem('🔝', n.pinned ? t('unpin_note') : t('pin'), fnPin, false, null, noteHost);
    addItem('☑', t('todo_mode'), fnTodo, false, null, noteHost);
    addItem('🏷', n.groupId ? t('remove_from_group') : t('add_to_group'), fnGroup, false, null, noteHost);
    addItem('🖥️', t('desktop'), fnDesktop, false, null, noteHost);
    addItem('⏰', t('todo_remind'), fnRemind, false, null, noteHost);
    addItem('🎨', t('color'), fnColor, false, null, noteHost);
    if (n.type !== 'todo') addItem('👁', t(n.preview ? 'note_preview_off' : 'note_preview'), fnPreview, false, null, noteHost);
    addItem('📥', t(n.archived ? 'note_unarchive' : 'note_archive'), fnArchive, false, null, noteHost);
    addSep();

    // —— 导出：两种模式都在一级（工具栏没有该入口，且 e2e 用例依赖其可见） ——
    addItem('📝', t('export_markdown'), fnExportMd);
    addSep();

    // ★ 删除：固定一级（不折叠进二级），danger 样式 + 独立分隔线
    addItem('🗑', t('delete'), fnDelete, true);

    // 菜单外观（透明度/亚克力）已归位到「设置 → 外观」，不再挂在每个右键菜单底部
    positionMenu();
  };

  document.body.appendChild(pop);
  activeColorPop = pop;
  buildMenu(state.settings.ctxMenuMode === 'full' ? 'full' : 'compact');
  setTimeout(() => document.addEventListener('mousedown', closePopsOnce), 0);
}

function openColorPop(el, n, atX, atY) {
  closePops();
  const selRange = savedRange;
  const selNoteId = savedNoteId;
  const selText = savedSelText;
  clearSavedSelection();
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
  bgLabel.textContent = t('custom_bg');
  pop.appendChild(bgLabel);

  const customInput = document.createElement('input');
  customInput.type = 'color';
  customInput.value = n.color || '#000000';
  customInput.title = t('custom_bg');
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
  label.textContent = t('text_color');
  pop.appendChild(label);

  TEXT_COLORS.forEach((c) => {
    addSwatch(c, (n.textColor || state.settings.noteTextColor) === c, () => {
      if (selRange && selText && selNoteId === n.id) {
        applyInlineColor(n, selRange, c);
      } else {
        n.textColor = c;
        n.updatedAt = Date.now();
        save();
        renderAll();
      }
    });
  });

  const fontLabel = document.createElement('div');
  fontLabel.className = 'color-pop-label';
  fontLabel.textContent = t('font');
  pop.appendChild(fontLabel);

  const fontSelect = document.createElement('select');
  fontSelect.style.cssText = 'grid-column:1/-1;width:100%;background:var(--bg-soft);color:var(--fg);border:1px solid var(--border);border-radius:7px;padding:5px 8px;font-family:inherit;font-size:12px;cursor:pointer;';
  const defFontOpt = document.createElement('option');
  defFontOpt.value = '';
  defFontOpt.textContent = t('follow_global');
  fontSelect.appendChild(defFontOpt);
  FONT_OPTIONS.forEach((f) => {
    const o = document.createElement('option');
    o.value = f.v;
    o.textContent = f.label;
    fontSelect.appendChild(o);
  });
  (state.settings.customFonts || []).forEach((f) => {
    const o = document.createElement('option');
    o.value = f.family;
    o.textContent = f.name;
    fontSelect.appendChild(o);
  });
  fontSelect.value = n.fontFamily || '';
  fontSelect.addEventListener('change', () => {
    n.fontFamily = fontSelect.value || null;
    n.updatedAt = Date.now();
    save();
    renderAll();
  });
  pop.appendChild(fontSelect);

  const def = document.createElement('button');
  def.className = 'color-pop-def';
  def.textContent = t('default_color');
  def.onclick = (e) => { e.stopPropagation(); n.textColor = null; n.updatedAt = Date.now(); save(); renderAll(); };
  pop.appendChild(def);

  document.body.appendChild(pop);
  let left, top;
  if (atX != null && atY != null) {
    left = Math.max(8, Math.min(atX + 8, window.innerWidth - pop.offsetWidth - 8));
    top = Math.max(8, Math.min(atY - 6, window.innerHeight - pop.offsetHeight - 8));
  } else {
    const r = el.getBoundingClientRect();
    left = Math.min(r.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8);
    top = Math.max(8, Math.min(r.top + 28, window.innerHeight - pop.offsetHeight - 8));
  }
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  activeColorPop = pop;
  setTimeout(() => document.addEventListener('mousedown', closePopsOnce), 0);
}

function openGroupPop(el, n) {
  closePops();
  clearSavedSelection();
  const pop = document.createElement('div');
  pop.className = 'color-pop';
  pop.style.gridTemplateColumns = '1fr';
  pop.style.minWidth = '140px';
  pop.style.padding = '6px';

  const assignGroup = (id) => { pushUndo(); n.groupId = id; n.updatedAt = Date.now(); save(); renderAll(); };

  // 标签建议：按笔记文本 + 最近使用推荐最可能归属的分组（顶到最前面，便于快速选择）
  const suggestIds = (typeof BoardLayout !== 'undefined' && BoardLayout.suggestGroupIds)
    ? BoardLayout.suggestGroupIds(noteText(n), state.groups, state.settings.recentGroups)
    : [];
  if (suggestIds.length) {
    const lbl = document.createElement('div');
    lbl.className = 'color-pop-label';
    lbl.textContent = t('group_suggest');
    pop.appendChild(lbl);
    suggestIds.forEach((id) => {
      const g = state.groups.find((x) => x.id === id);
      if (!g) return;
      const b = document.createElement('button');
      b.style.cssText = 'background:var(--accent-soft);border:none;color:var(--fg);padding:7px 10px;border-radius:7px;cursor:pointer;text-align:left;font-size:13px;font-family:inherit;';
      b.innerHTML = `<span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${g.color};margin-right:6px"></span>${escapeHtml(g.name)}${n.groupId === g.id ? ' ✓' : ''}`;
      b.onmouseenter = () => (b.style.background = 'var(--accent)');
      b.onmouseleave = () => (b.style.background = 'var(--accent-soft)');
      b.onclick = (e) => { e.stopPropagation(); assignGroup(g.id); };
      pop.appendChild(b);
    });
    const sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:var(--border);margin:4px 0;';
    pop.appendChild(sep);
  }

  const items = [
    { label: t('ungrouped'), id: null },
    ...state.groups.map((g) => ({ label: g.name, id: g.id }))
  ];
  items.forEach((it) => {
    const b = document.createElement('button');
    b.style.cssText = 'background:transparent;border:none;color:var(--fg);padding:7px 10px;border-radius:7px;cursor:pointer;text-align:left;font-size:13px;font-family:inherit;';
    b.innerHTML = `${it.id ? `<span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${(state.groups.find(g=>g.id===it.id)||{}).color};margin-right:6px"></span>` : ''}${escapeHtml(it.label)}${n.groupId === it.id ? ' ✓' : ''}`;
    b.onmouseenter = () => (b.style.background = 'var(--accent-soft)');
    b.onmouseleave = () => (b.style.background = 'transparent');
    b.onclick = (e) => { e.stopPropagation(); assignGroup(it.id); };
    pop.appendChild(b);
  });

  const newBtn = document.createElement('button');
  newBtn.style.cssText = 'background:transparent;border:1px dashed var(--border);color:var(--fg-dim);padding:7px 10px;border-radius:7px;cursor:pointer;text-align:left;font-size:13px;font-family:inherit;margin-top:4px;';
  newBtn.textContent = t('add_group');
  newBtn.onclick = (e) => {
    e.stopPropagation();
    closePops();
    promptModal(t('new_group'), t('group_name'), '').then((name) => {
      if (name) {
        const g = createGroup(name.trim());
        pushUndo();
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
  if (activeColorPop && !activeColorPop.contains(e.target)) { activeColorPop.remove(); activeColorPop = null; document.removeEventListener('mousedown', closePopsOnce); clearSavedSelection(); }
  if (activeGroupPop && !activeGroupPop.contains(e.target)) { activeGroupPop.remove(); activeGroupPop = null; document.removeEventListener('mousedown', closePopsOnce); clearSavedSelection(); }
}

function openGroupEditPop(anchorEl, g) {
  closePops();
  clearSavedSelection();
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

  addBtn(`✏ ${t('rename_group')}`, () => {
    promptModal(t('rename_group'), t('group_name'), g.name).then((name) => {
      if (name && name.trim()) {
        g.name = name.trim();
        save();
        renderGroupChips();
      }
    });
  });

  addBtn(isGroupCollapsed(g.id) ? (t('group_expand') + (state.notes.some((n) => n.groupId === g.id) ? '（' + state.notes.filter((n) => n.groupId === g.id).length + '）' : '')) : `▾ ${t('group_collapse')}`, () => {
    toggleGroupCollapse(g.id);
  });


  const colorLabel = document.createElement('div');
  colorLabel.style.cssText = 'font-size:11px;color:var(--fg-dim);padding:8px 10px 2px;';
  colorLabel.textContent = t('change_color');
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

  addBtn(`<span style="color:#e5484d">🗑 ${t('delete_group')}</span>`, () => {
    confirmModal(t('delete_group'), `${t('confirm_delete_group_msg')}（${g.name}）`).then((ok) => {
      if (ok) {
        pushUndo();
        state.groups = state.groups.filter((x) => x.id !== g.id);
        state.notes.forEach((n) => { if (n.groupId === g.id) n.groupId = null; });
        if (filter.group === g.id) filter.group = 'all';
        save();
        renderGroupChips();
        renderAll();
        toast(t('toast_group_deleted'));
      }
    });
  });

  // 菜单外观（透明度/亚克力）已归位到「设置 → 外观」，不再挂在每个右键菜单底部
  document.body.appendChild(pop);
  const r = anchorEl.getBoundingClientRect();
  pop.style.left = r.left + 'px';
  pop.style.top = Math.min(r.bottom + 4, window.innerHeight - pop.offsetHeight - 8) + 'px';
  activeColorPop = pop;
  setTimeout(() => document.addEventListener('mousedown', closePopsOnce), 0);
}

/* 【预留 API，当前生产代码无调用点】
   原用于在右键菜单底部附加「外观」控制（亚克力开关 + 透明度滑杆）。
   2026-09-23 起该控件已归位到「设置 → 外观」（#menuOpacity / #menuAcrylicToggle，
   绑定见 bind/appearance-bind.js，初始同步见 settings-panel.js 的 syncSettingsInputs）。
   移出理由：菜单外观是与当前便签无关的**全局**设置，挂在每次右键里既是噪音，
   也易误触（拖动滑杆会立刻改全局并落盘）。
   暂保留本函数以备将来需要「就地快捷调节」时复用；确认不再需要可直接删除（同步改下方 return 导出）。 */
function appendMenuAppearanceFooter(pop) {
  if (typeof applyMenuAppearance !== 'function') return;
  const row = document.createElement('div');
  row.className = 'cm-opacity-row';
  const op = (state.settings.menuOpacity != null) ? state.settings.menuOpacity : 88;
  const acrylic = !!state.settings.menuAcrylic;
  row.innerHTML = `<span>${t('ctx_menu_opacity')}</span>
    <input type="range" class="cm-opacity" min="30" max="100" value="${op}" />
    <label><input type="checkbox" class="cm-acrylic" ${acrylic ? 'checked' : ''}/>${t('ctx_menu_acrylic')}</label>`;
  pop.appendChild(row);
  const range = row.querySelector('.cm-opacity');
  const cb = row.querySelector('.cm-acrylic');
  range.addEventListener('input', (e) => {
    e.stopPropagation();
    state.settings.menuOpacity = Number(range.value);
    applyMenuAppearance();
    save();
  });
  cb.addEventListener('change', (e) => {
    e.stopPropagation();
    state.settings.menuAcrylic = cb.checked;
    applyMenuAppearance();
    save();
  });
}

  return { closePops, showNoteContextMenu, openColorPop, openGroupPop, closePopsOnce, openGroupEditPop, appendMenuAppearanceFooter };
}));
