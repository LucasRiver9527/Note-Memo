const fs = require('fs');
const path = require('path');
const DataIO = require('./data-io.js');
const { mergeDetachedEdits } = require('./renderer/logic.js');

function createNoteStore(getUserDataPath) {
  const dataPath = () => path.join(getUserDataPath(), 'notes-data.json');
  const recoveryPath = () => path.join(getUserDataPath(), 'notes-recovery.json');
  let recoveryState = null;
  let recoveryToken = 0;

  function readRecovery() {
    if (recoveryState) return recoveryState;
    try {
      const parsed = JSON.parse(fs.readFileSync(recoveryPath(), 'utf8'));
      if (parsed.version !== 1 || !parsed.notes || typeof parsed.notes !== 'object' || Array.isArray(parsed.notes)) throw new Error('invalid recovery shape');
      recoveryState = parsed;
      recoveryToken = Math.max(0, Number(parsed.main && parsed.main.token) || 0,
        ...Object.values(parsed.notes).map((item) => Number(item && item.token) || 0));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[recovery] 草稿读取失败，原文件已保留：', err);
        return null;
      }
      recoveryState = { version: 1, main: null, notes: {} };
    }
    return recoveryState;
  }

  function writeRecovery(next) {
    const file = recoveryPath();
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      if (!next.main && !Object.keys(next.notes).length) fs.rmSync(file, { force: true });
      else {
        fs.writeFileSync(tmp, JSON.stringify(next), 'utf8');
        fs.renameSync(tmp, file);
      }
      recoveryState = next;
      return true;
    } catch (err) {
      console.error('[recovery] 草稿写入失败：', err);
      try { fs.rmSync(tmp, { force: true }); } catch (_) {}
      return false;
    }
  }

  function captureRecovery(kind, value) {
    if (kind === 'main' ? !DataIO.isValidDataShape(value) : !value || typeof value.id !== 'string') return false;
    const current = readRecovery();
    if (!current) return false;
    const token = ++recoveryToken;
    const next = { version: 1, main: current.main, notes: { ...current.notes } };
    if (kind === 'main') next.main = { token, data: value };
    else next.notes[value.id] = { token, note: value };
    return writeRecovery(next) ? token : false;
  }

  function clearRecovery(kind, id, token, savedData) {
    if (!token) return;
    const current = readRecovery();
    if (!current) return;
    const entry = kind === 'main' ? current.main : current.notes[id];
    if (!entry || entry.token !== token) return;
    // 主窗口草稿仍可能包含旧版独立便签；此时保留独立草稿供恢复时覆盖。
    if (kind === 'note' && current.main) return;
    const next = { version: 1, main: current.main, notes: { ...current.notes } };
    if (kind === 'main') {
      next.main = null;
      for (const [noteId, item] of Object.entries(next.notes)) {
        const savedNote = (savedData.notes || []).find((note) => note.id === noteId);
        if (savedNote && item?.note &&
            JSON.stringify(savedNote) === JSON.stringify(mergeDetachedEdits(savedNote, item.note))) {
          delete next.notes[noteId];
        }
      }
    }
    else delete next.notes[id];
    writeRecovery(next);
  }

  function recoveryCandidate(base) {
    const current = readRecovery();
    if (!current) return null;
    const source = current.main && DataIO.isValidDataShape(current.main.data) ? current.main.data : base;
    if (!source || !DataIO.isValidDataShape(source)) return null;
    const entries = Object.values(current.notes).filter((item) => item && item.note && typeof item.note.id === 'string');
    if (!current.main && !entries.length) return null;
    const candidate = JSON.parse(JSON.stringify(source));
    candidate.notes = candidate.notes || [];
    for (const item of entries) {
      const index = candidate.notes.findIndex((n) => n.id === item.note.id);
      if (index >= 0) candidate.notes[index] = mergeDetachedEdits(candidate.notes[index], item.note);
      else if (!(candidate.trash || []).some((entry) => entry.note?.id === item.note.id)) candidate.notes.push(item.note);
    }
    return candidate;
  }

  // 数据健康状态：'ok' | 'first-run' | 'recovered' | 'corrupt'（null 表示尚未读取过）
  // 一旦判定为 corrupt 就锁定写入，直到成功落盘一次才解除（data:save 可带 force 主动解锁）。
  // 缓存状态同时避免了 readData 被 17 处反复调用时重复生成留证文件、重复打日志。
  let _dataStatus = null;
  let _corruptPath = null;

  function dataHealth() {
    return { status: _dataStatus || 'unknown', corruptPath: _corruptPath };
  }

  function isDataLocked() {
    return _dataStatus === 'corrupt';
  }

  function readData() {
    // 已判定损坏：直接返回 null，不再读盘，避免每次调用都新增一份留证
    if (_dataStatus === 'corrupt') return null;
    const r = DataIO.safeRead(dataPath());
    _dataStatus = r.status;
    _corruptPath = r.corruptPath || null;
    if (r.status === 'recovered') {
      console.warn('[data] 数据文件曾损坏，已从 .bak 自动恢复；损坏件留证于：', r.corruptPath);
    }
    return r.data;
  }

  // 返回 true 表示已落盘。data 损坏锁定时拒绝写入（force 可越过锁，供「导入备份」自救）。
  function writeData(data, opts) {
    const force = !!(opts && opts.force);
    if (_dataStatus === 'corrupt' && !force) {
      console.error('[data] 已锁定写入：数据文件损坏且无可用 .bak，拒绝覆盖以保护用户数据');
      return false;
    }
    const ok = DataIO.atomicWrite(dataPath(), data);
    if (ok) {
      // 成功落盘说明磁盘上已是合法 JSON，解除锁定
      _dataStatus = 'ok';
      _corruptPath = null;
    }
    return ok;
  }

  return { dataPath, dataHealth, isDataLocked, readData, writeData, captureRecovery, clearRecovery, writeRecovery, recoveryCandidate };
}

module.exports = { createNoteStore };
