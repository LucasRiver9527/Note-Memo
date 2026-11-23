/* Shared text commands for workspace and detached contenteditable editors. */
(function (root) {
  'use strict';

  function selectionWithin(editor) {
    const selection = editor.ownerDocument.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return editor.contains(range.startContainer) && editor.contains(range.endContainer) ? range.cloneRange() : null;
  }

  function selectAll(editor) {
    if (typeof editor.select === 'function') {
      editor.select();
      return;
    }
    editor.focus();
    editor.ownerDocument.getSelection()?.selectAllChildren(editor);
  }

  function execute(editor, command, value, { range, focus, append = false }) {
    if (!editor?.isConnected || !editor.isContentEditable) return false;
    const doc = editor.ownerDocument;
    if (range && (!editor.contains(range.startContainer) || !editor.contains(range.endContainer))) return false;
    if (focus) editor.focus();
    if (!editor.contains(doc.activeElement)) return false;

    const selection = doc.getSelection();
    if (!selection) return false;
    if (range) {
      selection.removeAllRanges();
      selection.addRange(range);
    } else if (!selectionWithin(editor)) {
      if (!append) return false;
      selection.selectAllChildren(editor);
      selection.collapseToEnd();
    }
    // Keep these edits on Chromium's native undo stack.
    return doc.execCommand(command, false, value);
  }

  function insertText(editor, text, { range = null, focus = false } = {}) {
    return !!text && execute(editor, 'insertText', text, { range, focus, append: focus });
  }

  const highlightSelector = 'mark.hl, span[style*="background"], font[style*="background"]';

  function selectionHasHighlight(editor) {
    const range = selectionWithin(editor);
    return !!range && !range.collapsed && Array.from(editor.querySelectorAll(highlightSelector))
      .some(mark => range.intersectsNode(mark));
  }

  function format(editor, command, value, range) {
    return execute(editor, command, value, { range, focus: true });
  }

  function clearHighlight(mark) {
    if (mark.tagName !== 'MARK') {
      mark.style.removeProperty('background');
      mark.style.removeProperty('background-color');
      if (!mark.style.cssText) mark.removeAttribute('style');
      if (mark.hasAttributes()) return;
    }
    mark.replaceWith(...mark.childNodes);
  }

  function toggleHighlight(editor, color) {
    if (!editor?.isConnected || !editor.isContentEditable) return false;
    editor.focus();
    const range = selectionWithin(editor);
    if (!range) return false;
    if (range.collapsed || !selectionHasHighlight(editor)) return format(editor, 'hiliteColor', color);

    const marks = Array.from(editor.querySelectorAll(highlightSelector)).filter(mark => range.intersectsNode(mark));
    const topLevel = marks.filter(mark => !marks.some(other => other !== mark && other.contains(mark)));
    const replacement = editor.ownerDocument.createRange();
    replacement.setStartBefore(topLevel[0]);
    replacement.setEndAfter(topLevel.at(-1));

    const contents = editor.ownerDocument.createElement('div');
    contents.append(replacement.cloneContents());
    // Chromium may nest sibling paragraphs when replacing a selection that
    // spans block boundaries. Keep their original structure and live widgets.
    const protectedContent = contents.querySelector(
      '.inline-img, .file-link, [contenteditable="false"], div, p, ul, ol, blockquote, pre, table'
    );
    if (!protectedContent) {
      contents.querySelectorAll(highlightSelector).forEach(clearHighlight);
      return execute(editor, 'insertHTML', contents.innerHTML, { range: replacement, focus: false });
    }

    marks.forEach(clearHighlight);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function insertLineBreak(editor) {
    return execute(editor, 'insertLineBreak', undefined, { focus: false });
  }

  function cut(editor, range) {
    if (!range || range.collapsed) return false;
    return execute(editor, 'cut', undefined, { range, focus: true });
  }

  function cutInput(input, start, end, direction) {
    if (!input.isConnected || input.readOnly || input.disabled || start === end) return false;
    input.focus();
    if (input.ownerDocument.activeElement !== input) return false;
    input.setSelectionRange(start, end, direction);
    return input.ownerDocument.execCommand('cut');
  }

  root.TextEditing = { selectionWithin, selectAll, insertText, selectionHasHighlight, format, toggleHighlight, insertLineBreak, cut, cutInput };
}(window));
