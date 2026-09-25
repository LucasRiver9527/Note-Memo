/* 便签媒体：文本/图片/文件插入与删除、图片粘贴。依赖顶层全局（rich-content/logic/app-state/core 等）。
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.noteMediaView + 顶层全局。
   —— 本模块的函数通过顶层全局访问其他模块（与 board-layout.js 等同构）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.noteMediaView = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

function insertTextAtCaret(n, text) {
  const contentEl = focusNoteContent(n);
  if (contentEl && (document.activeElement === contentEl || contentEl.contains(document.activeElement))) {
    contentEl.focus();
    document.execCommand('insertText', false, text);
    n.content = readRichContent(contentEl);
  } else if (contentEl && savedNoteId === n.id && savedRange) {
    contentEl.focus();
    restoreSelection();
    document.execCommand('insertText', false, text);
    n.content = readRichContent(contentEl);
  } else {
    n.content = ((n.content || '').trim() ? n.content + '\n' : '') + text;
  }
  clearSavedSelection();
}

function insertImageMarkerAtCursor(n, imgId) {
  insertTextAtCaret(n, '[[img:' + imgId + ']]');
}

function addImageToNote(n, img) {
  n.images = n.images || [];
  n.images.push(img);
  insertImageMarkerAtCursor(n, img.id);
  cleanupRefs(n);
  n.updatedAt = Date.now();
  save();
  renderAll();
}

function insertImageByUrl(n, url) {
  addImageToNote(n, { id: uid(), src: url, w: 200 });
}

function insertImageReferenceAtCursor(n, src, w) {
  addImageToNote(n, { id: uid(), src, w: w || 200 });
}

async function addNoteImageFromDataUrl(dataUrl, n) {
  const r = await window.api.saveNoteImage(dataUrl);
  if (r.ok) {
    insertImageByUrl(n, r.url);
    toast(t('toast_img_pasted'));
  } else {
    toast(t('toast_img_saved_fail') + r.error);
  }
}

function addFileToNote(n, filePath, isDir) {
  const id = uid();
  n.files = n.files || [];
  n.files.push({ id, path: filePath, isDir });
  insertTextAtCaret(n, '[[file:' + id + ']]');
  cleanupRefs(n);
  n.updatedAt = Date.now();
  save();
  renderAll();
}

async function insertPastedFilesAtCursor(n, paths) {
  for (const p of paths) {
    const lower = p.toLowerCase();
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
    if (imageExts.some((e) => lower.endsWith(e))) {
      const r = await window.api.addImageFile(p);
      if (r.ok) insertImageByUrl(n, r.url);
    } else {
      const st = await window.api.statPath(p);
      if (st && st.exists) addFileToNote(n, p, !!st.isDirectory);
    }
  }
}

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

async function readClipboardImageAsDataUrl() {
  try {
    const fromMain = await window.api.readClipboardImage();
    if (fromMain) return fromMain;
  } catch (e) { /* ignore */ }
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = (item.types || []).find((t) => t.indexOf('image/') === 0);
        if (imgType) {
          const blob = await item.getType(imgType);
          return await blobToDataUrl(blob);
        }
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function handleImagePaste(cd, n) {
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
      await addNoteImageFromDataUrl(dataUrl, n);
      return;
    }
  }
}

function removeImageById(n, id) {
  n.images = (n.images || []).filter((x) => x.id !== id);
  n.content = (n.content || '').replace(new RegExp('\\[\\[img:' + id + '\\]\\]', 'g'), '');
  n.updatedAt = Date.now();
  save();
  renderAll();
}

function wireImages(el, n) {
  $$('.inline-img', el).forEach((item) => {
    const id = item.dataset.imgId;
    const img = $('img', item);
    const del = $('.img-del', item);
    const handle = $('.img-resize', item);

    if (img) {
      const markMissing = () => {
        item.classList.add('img-missing');
        if (handle) handle.remove();
        const label = document.createElement('div');
        label.className = 'img-missing-label';
        label.textContent = t('img_missing');
        img.replaceWith(label);
      };
      img.addEventListener('error', markMissing);
      if (img.complete && img.naturalWidth === 0) markMissing();
    }

    if (del) del.onclick = (e) => {
      e.stopPropagation();
      removeImageById(n, id);
    };

    item.setAttribute('tabindex', '0');
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        e.stopPropagation();
        removeImageById(n, id);
      }
    });

    if (handle) handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const imgObj = (n.images || []).find((x) => x.id === id);
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
        n.updatedAt = Date.now();
        save();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

  return { insertTextAtCaret, insertImageMarkerAtCursor, addImageToNote, insertImageByUrl, insertImageReferenceAtCursor, addNoteImageFromDataUrl, addFileToNote, insertPastedFilesAtCursor, blobToDataUrl, readClipboardImageAsDataUrl, handleImagePaste, removeImageById, wireImages };
}));
