/* 卡片搜索的可见文本匹配、定位与结果提示。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.cardSearchView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

/* Card search uses original fields only when the displayed target can be mapped exactly.
   BR contributes one newline; rich elements fall back to viewing the existing card. */
function cardPlainTextMap(content) {
  if (!content) return null;
  let text = '';
  const spans = [];
  for (const node of content.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      spans.push({ node, start: text.length, end: text.length + node.textContent.length });
      text += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
      spans.push({ node, start: text.length, end: text.length + 1 });
      text += '\n';
    } else return null;
  }
  return { text, spans };
}

// Search summaries consume rendered text, not rich-protocol offsets. Embedded sources
// are separate units; controls and metadata never become searchable summary text.
function cardVisibleText(node, separateEmbedded) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  if (node.hidden || node.matches('svg, button, input, .img-resize')) return '';
  if (separateEmbedded && node.matches('.inline-img, .file-link, .note-table-block')) return '\n';
  if (node.tagName === 'BR') return '\n';
  const text = Array.from(node.childNodes).map(child => cardVisibleText(child, separateEmbedded)).join('');
  return node.tagName === 'DIV' ? '\n' + text + '\n' : text;
}

function cardRenderedSearchSources(content) {
  if (!content) return [];
  const sources = [{ field: 'content', text: cardVisibleText(content, true).trim(), target: content }];
  $$('.note-table-block td, .note-table-block th', content).forEach(cell => {
    const diagonals = $$('.tbl-t1, .tbl-t2', cell);
    const parts = diagonals.length ? diagonals : [cell];
    parts.forEach(part => sources.push({ field: 'table', text: cardVisibleText(part, false).trim(), target: cell.closest('.note-table-block') }));
  });
  $$('.file-link', content).forEach(file => {
    sources.push({ field: 'file', text: cardVisibleText(file, false).trim(), target: file });
  });
  return sources;
}

/* V128-01E2: search-only rendered-text matcher. Visible units are matched independently
   (body, each table cell / diagonal half, filename) so no cross-unit or hidden text matches.
   Cached by note object + rendered HTML value; never caches DOM nodes or stale state. */
const __noteSearchUnitCache = new WeakMap();

function noteSearchUnits(n) {
  const html = renderRichCached(n);
  const cached = __noteSearchUnitCache.get(n);
  if (cached && cached.html === html) return cached.units;
  // Parse inertly in a <template> (no live DOM insertion, no remote image/file loads).
  const tpl = document.createElement('template');
  tpl.innerHTML = '<div class="note-content">' + html + '</div>';
  const contentEl = tpl.content.firstChild;
  const units = cardRenderedSearchSources(contentEl).map((src) => src.text).filter((t) => t);
  __noteSearchUnitCache.set(n, { html, units });
  return units;
}

// Search-only content matcher: literal, case-insensitive, per visible unit. Empty query => true with NO rendering.
function noteSearchContentMatches(n, query) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return true;
  if (!n) return false;
  if (n.type === 'todo') {
    // Each task is a separate literal unit; unused todo content/tables are not indexed.
    return (n.items || []).some((it) => ((it && it.text) || '').toLowerCase().includes(q));
  }
  return noteSearchUnits(n).some((t) => t.toLowerCase().includes(q));
}

function cardSearchTarget(el, n) {
  const query = filter.query.trim();
  if (!query) return null;
  const group = state.groups.find((g) => g.id === n.groupId);
  const hits = findNoteSearchMatches(n, group && group.name, query);
  const title = hits.find(hit => hit.field === 'title');
  if (title) return { hit: title, target: $('.note-title', el) };
  const content = $('.note-content', el);
  const map = cardPlainTextMap(content);
  const plain = hits.find(hit => hit.field === 'content');
  if (n.type !== 'todo' && plain && map && map.text === plain.text) {
    return { hit: plain, target: content, map };
  }
  if (n.type === 'todo') {
    for (const hit of hits.filter(hit => hit.field === 'todo')) {
      const target = $$('.todo-text', el)[hit.itemIndex];
      if (target && target.value === hit.text) return { hit, target };
    }
  } else {
    for (const source of cardRenderedSearchSources(content)) {
      const rendered = findNoteSearchMatches({ content: source.text }, null, query)[0];
      if (rendered) return { hit: { ...rendered, field: source.field }, target: source.field === 'content' ? el : source.target, viewOnly: true };
    }
  }
  const groupHit = hits.find(hit => hit.field === 'group');
  if (groupHit) return { hit: groupHit, target: $('.group-tag', el) };
  return { hit: null, target: el };
}

function locateCardSearch(el, n) {
  const result = cardSearchTarget(el, n); // Recompute after edits: never use stale offsets.
  if (!result) return;
  const { hit, target, map, viewOnly } = result;
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (!hit || hit.field === 'group' || viewOnly) {
    if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
    target.focus({ preventScroll: true });
  } else if (hit.field === 'title' || hit.field === 'todo') {
    target.focus({ preventScroll: true });
    target.setSelectionRange(hit.start, hit.end);
  } else {
    // Read-only preview remains read-only; selection is native DOM state, never markup.
    if (!target.isContentEditable) target.tabIndex = -1;
    target.focus({ preventScroll: true });
    const boundary = (offset) => {
      for (const span of map.spans) {
        if (offset <= span.end) {
          if (span.node.nodeType === Node.TEXT_NODE) return [span.node, Math.max(0, offset - span.start)];
          const index = Array.prototype.indexOf.call(target.childNodes, span.node);
          return [target, index + (offset > span.start ? 1 : 0)];
        }
      }
      return [target, target.childNodes.length];
    };
    const range = document.createRange();
    range.setStart(...boundary(hit.start));
    range.setEnd(...boundary(hit.end));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function refreshCardSearch(el, n) {
  const old = $('.memo-search', el);
  const result = cardSearchTarget(el, n);
  if (!result) { if (old) old.remove(); return; }
  const strip = document.createElement('div');
  strip.className = 'memo-search';
  const label = document.createElement('span');
  label.className = 'memo-search-source';
  const snippet = document.createElement('span');
  snippet.className = 'memo-search-snippet';
  const { hit } = result;
  if (hit) {
    label.textContent = t('search_hit_' + hit.field);
    const summary = buildSearchSnippet(hit.text, hit.start, hit.end);
    if (summary.truncatedBefore) snippet.appendChild(document.createTextNode('…'));
    summary.parts.forEach((part) => {
      const segment = document.createElement(part.matched ? 'mark' : 'span');
      segment.textContent = part.text; // Literal user text, never HTML.
      snippet.appendChild(segment);
    });
    if (summary.truncatedAfter) snippet.appendChild(document.createTextNode('…'));
  } else {
    label.textContent = t('search_hit_content');
    snippet.textContent = t('search_hit_fallback');
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'memo-search-locate';
  button.textContent = t(!hit ? 'search_view_note' : hit.field === 'group' ? 'search_view_group' : result.viewOnly ? (hit.field === 'table' ? 'search_view_table' : hit.field === 'file' ? 'search_view_file' : 'search_view_note') : 'search_locate');
  button.addEventListener('click', (e) => { e.stopPropagation(); locateCardSearch(el, n); });
  ['pointerdown', 'mousedown', 'contextmenu'].forEach((name) => strip.addEventListener(name, (e) => e.stopPropagation()));
  strip.append(label, snippet, button);
  if (old) old.replaceWith(strip);
  else $('.memo-body, .note-body', el).before(strip);
}

function bindCardSearch(el, n) {
  refreshCardSearch(el, n);
  // Existing input handlers update the note first; update only this non-editable strip.
  el.addEventListener('input', (e) => {
    if (e.target.closest('.note-title, .note-content, .todo-text')) refreshCardSearch(el, n);
  });
}

  return { cardPlainTextMap, cardRenderedSearchSources, noteSearchContentMatches, bindCardSearch, refreshCardSearch };
}));
