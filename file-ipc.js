const { app, clipboard, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');

function registerFileIpc({ guardedHandle, getMainWindow, readData }) {
  function dialogText(zh, en) {
    return readData()?.settings?.language === 'en' ? en : zh;
  }

  guardedHandle('data:export', async (e, data) => {
    const result = await dialog.showSaveDialog(getMainWindow(), {
      title: dialogText('导出便签', 'Export notes'),
      defaultPath: `${dialogText('便签备份', 'Notes backup')}-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [
        { name: dialogText('JSON 备份', 'JSON backup'), extensions: ['json'] },
        { name: dialogText('文本文件', 'Text files'), extensions: ['txt'] }
      ]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      if (result.filePath.endsWith('.txt')) {
        const lines = data.notes.map((n) => {
          const body = n.type === 'todo'
            ? (n.items || []).map((i) => `${i.done ? '[x]' : '[ ]'} ${i.text}`).join('\n')
            : n.content;
          return `◆ ${n.title}\n${body}\n---`;
        }).join('\n\n');
        fs.writeFileSync(result.filePath, lines, 'utf-8');
      } else {
        fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
      }
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  guardedHandle('note:export-markdown', async (e, md, suggestName) => {
    const result = await dialog.showSaveDialog(getMainWindow(), {
      title: dialogText('导出为 Markdown', 'Export to Markdown'),
      defaultPath: suggestName || `${dialogText('便签', 'Note')}-${new Date().toISOString().slice(0, 10)}.md`,
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: dialogText('文本文件', 'Text files'), extensions: ['txt'] }
      ]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(result.filePath, md, 'utf-8');
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  guardedHandle('data:import', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: dialogText('导入便签', 'Import notes'),
      properties: ['openFile'],
      filters: [{ name: dialogText('JSON 备份', 'JSON backup'), extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    try {
      const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
      const data = JSON.parse(raw);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  guardedHandle('dialog:pick-image', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: dialogText('选择背景图片', 'Choose a background image'),
      properties: ['openFile'],
      filters: [{ name: dialogText('图片', 'Images'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    try {
      const src = result.filePaths[0];
      const ext = (path.extname(src) || '.png').toLowerCase();
      const bgDir = path.join(app.getPath('userData'), 'backgrounds');
      if (!fs.existsSync(bgDir)) fs.mkdirSync(bgDir, { recursive: true });
      const name = 'bg-' + Date.now() + ext;
      const dest = path.join(bgDir, name);
      fs.copyFileSync(src, dest);
      return { ok: true, url: 'note-bg://local/' + encodeURIComponent(name) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  guardedHandle('note:save-image', async (e, dataUrl) => {
    try {
      const m = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,(.+)$/.exec(String(dataUrl || ''));
      if (!m) return { ok: false, error: 'unsupported image' };
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
      const imgDir = path.join(app.getPath('userData'), 'images');
      if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
      const name = 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      fs.writeFileSync(path.join(imgDir, name), Buffer.from(m[2], 'base64'));
      return { ok: true, url: 'note-img://local/' + encodeURIComponent(name) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  guardedHandle('dialog:pick-note-image', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: dialogText('选择图片', 'Choose an image'),
      properties: ['openFile'],
      filters: [{ name: dialogText('图片', 'Images'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    try {
      const src = result.filePaths[0];
      const ext = (path.extname(src) || '.png').toLowerCase();
      const imgDir = path.join(app.getPath('userData'), 'images');
      if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
      const name = 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
      fs.copyFileSync(src, path.join(imgDir, name));
      return { ok: true, url: 'note-img://local/' + encodeURIComponent(name) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  guardedHandle('dialog:pick-font', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: dialogText('选择字体文件', 'Choose a font file'),
      properties: ['openFile'],
      filters: [{ name: dialogText('字体文件', 'Font files'), extensions: ['ttf', 'otf', 'woff', 'woff2'] }]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    try {
      const src = result.filePaths[0];
      const ext = (path.extname(src) || '.ttf').toLowerCase();
      const fontDir = path.join(app.getPath('userData'), 'fonts');
      if (!fs.existsSync(fontDir)) fs.mkdirSync(fontDir, { recursive: true });
      const id = 'cf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const family = 'CustomFont-' + id;
      const name = family + ext;
      fs.copyFileSync(src, path.join(fontDir, name));
      const baseName = path.basename(src, ext);
      return { ok: true, id, name: baseName, family, url: 'note-font://local/' + encodeURIComponent(name) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  let selectedBackupDir;
  function authorizedBackupDir(dir) {
    if (!dir) return path.join(app.getPath('userData'), 'backups');
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) return null;
    if (dir === selectedBackupDir || dir === readData()?.settings?.backupDir) return dir;
    return null;
  }

  guardedHandle('dialog:choose-directory', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: dialogText('选择备份目录', 'Choose a backup folder'),
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    selectedBackupDir = result.filePaths[0];
    return { ok: true, path: selectedBackupDir };
  });

  guardedHandle('dialog:pick-sound', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: dialogText('选择声音文件', 'Choose a sound file'),
      properties: ['openFile'],
      filters: [{ name: dialogText('音频', 'Audio files'), extensions: ['mp3', 'wav', 'ogg', 'm4a'] }]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    try {
      const src = result.filePaths[0];
      const ext = (path.extname(src) || '.mp3').toLowerCase();
      const sndDir = path.join(app.getPath('userData'), 'sounds');
      if (!fs.existsSync(sndDir)) fs.mkdirSync(sndDir, { recursive: true });
      const name = 'snd-' + Date.now() + ext;
      fs.copyFileSync(src, path.join(sndDir, name));
      return { ok: true, url: 'note-sound://local/' + encodeURIComponent(name), name: path.basename(src, ext) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  guardedHandle('backup:export', async (e, data, dir) => {
    try {
      const target = authorizedBackupDir(dir);
      if (!target) return { ok: false, error: 'Backup folder is not authorized' };
      if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
      const stamp = new Date();
      const pad = (x) => String(x).padStart(2, '0');
      const name = `便签备份-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.json`;
      const file = path.join(target, name);
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
      return { ok: true, path: file };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  guardedHandle('backup:open-dir', async (e, dir) => {
    try {
      const target = authorizedBackupDir(dir);
      if (!target) return { ok: false, error: 'Backup folder is not authorized' };
      if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
      const err = await shell.openPath(target);
      return { ok: !err, error: err || '' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  const allowedFiles = new WeakMap();

  function authorizeFile(sender, file) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) return false;
    let allowed = allowedFiles.get(sender);
    if (!allowed) {
      allowed = new Set();
      allowedFiles.set(sender, allowed);
    }
    allowed.add(file);
    return true;
  }

  // 只有 preload 从原生 File 获取的路径会走此通道。
  guardedHandle('file:authorize-drop', (e, file) => authorizeFile(e.sender, file));

  guardedHandle('clipboard:read-files', (e) => {
    const out = [];
    const readBuf = (format, encoding) => {
      try {
        const buf = clipboard.readBuffer(format);
        if (buf && buf.length) {
          const str = buf.toString(encoding);
          str.split('\0').forEach((p) => { if (p && p.length > 1 && !out.includes(p)) out.push(p); });
        }
      } catch (e) { /* ignore */ }
    };
    try {
      const buf = clipboard.readBuffer('CF_HDROP');
      if (buf && buf.length > 16) {
        const pFiles = buf.readUInt32LE(0);
        const fWide = buf.readUInt32LE(16) !== 0;
        const list = buf.slice(pFiles);
        const str = fWide ? list.toString('utf16le') : list.toString('latin1');
        str.split('\0').forEach((p) => { if (p && p.length > 1 && !out.includes(p)) out.push(p); });
      }
    } catch (e) { /* ignore */ }
    if (!out.length) readBuf('FileNameW', 'utf16le');
    return out.filter((file) => authorizeFile(e.sender, file));
  });

  guardedHandle('note:add-image-file', async (e, filePath) => {
    try {
      if (!allowedFiles.get(e.sender)?.has(filePath)) return { ok: false, error: 'File is not authorized' };
      const src = filePath;
      const ext = (path.extname(src) || '.png').toLowerCase();
      const imgDir = path.join(app.getPath('userData'), 'images');
      if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
      const name = 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
      fs.copyFileSync(src, path.join(imgDir, name));
      return { ok: true, url: 'note-img://local/' + encodeURIComponent(name) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  guardedHandle('path:stat', (e, p) => {
    try {
      if (!allowedFiles.get(e.sender)?.has(p)) return { exists: false };
      const st = fs.statSync(p);
      return { exists: true, isDirectory: st.isDirectory(), isFile: st.isFile() };
    } catch (e) {
      return { exists: false };
    }
  });

  guardedHandle('file:open', async (e, request) => {
    try {
      const { id, fileId } = request || {};
      if (typeof id !== 'string' || !id || typeof fileId !== 'string' || !fileId) {
        return { ok: false, error: 'Attachment is not available' };
      }
      const notes = readData()?.notes;
      const note = Array.isArray(notes) && notes.find((item) => item?.id === id);
      const file = Array.isArray(note?.files) && note.files.find((item) => item?.id === fileId);
      const target = file?.path;
      if (typeof target !== 'string' || !path.isAbsolute(target)) {
        return { ok: false, error: 'Attachment is not available' };
      }
      const err = await shell.openPath(target);
      return { ok: !err, error: err || '' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, { noteScoped: true });
}

module.exports = { registerFileIpc };
