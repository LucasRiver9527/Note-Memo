const { app, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { atomicWrite } = require('./data-io.js');
const { exportBundle, prepareBundle, commitBundle, discardBundle } = require('./backup-bundle.js');

function createBackupIpc({ readData, queueDataWrite, getMainWindow, flushDetachedNotes }) {
  let staged = null;
  let busy = false;
  let quitting = false;
  const userDir = () => app.getPath('userData');
  const metadataPath = () => path.join(userDir(), 'full-backup-meta.json');
  let lastExportAt = null;
  function backupDialogLabels() {
    const english = readData()?.settings?.language === 'en';
    const text = (zh, en) => english ? en : zh;
    return { text, filters: [{ name: text('Note-Memo 完整备份', 'Note-Memo full backup'), extensions: ['notememo'] }] };
  }

  function discard() {
    if (!staged) return;
    const { bundle } = staged;
    staged = null;
    discardBundle(bundle);
  }

  function registerIpc(guardedHandle) {
    guardedHandle('backup:last-full-export', () => {
      if (lastExportAt !== null) return lastExportAt;
      try {
        const value = JSON.parse(fs.readFileSync(metadataPath(), 'utf-8'))?.lastExportAt;
        return Number.isSafeInteger(value) && value > 0 && value <= 8640000000000000 ? value : null;
      } catch {
        return null;
      }
    }, { role: 'main' });

    guardedHandle('backup:export-full', async () => {
      if (busy) return { ok: false, canceled: true };
      busy = true;
      try {
        const { text, filters } = backupDialogLabels();
        const result = await dialog.showSaveDialog(getMainWindow(), {
          title: text('导出完整备份', 'Export full backup'),
          defaultPath: 'Note-Memo-' + new Date().toISOString().slice(0, 10) + '.notememo',
          filters
        });
        if (result.canceled || !result.filePath) return { ok: false, canceled: true };
        if (!(await flushDetachedNotes())) throw new Error(text('请先保存桌面便签', 'Save desktop notes first'));
        const filePath = result.filePath;
        if (!/\.notememo$/i.test(filePath)) throw new Error(text('请选择 .notememo 文件名', 'Use a .notememo filename'));
        await exportBundle(filePath, userDir(), await queueDataWrite(readData));
        lastExportAt = Date.now();
        atomicWrite(metadataPath(), { lastExportAt });
        return { ok: true, path: filePath, exportedAt: lastExportAt };
      } catch (err) {
        return { ok: false, error: err.message };
      } finally {
        busy = false;
      }
    }, { role: 'main' });

    guardedHandle('backup:open-full', async (event) => {
      if (busy) return { ok: false, canceled: true };
      discard();
      busy = true;
      try {
        const { text, filters } = backupDialogLabels();
        const result = await dialog.showOpenDialog(getMainWindow(), {
          title: text('从完整备份恢复', 'Restore from a full backup'),
          properties: ['openFile'],
          filters
        });
        if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
        const bundle = await prepareBundle(result.filePaths[0], userDir());
        if (quitting || event.sender.isDestroyed()) {
          discardBundle(bundle);
          return { ok: false, canceled: true };
        }
        staged = { bundle, sender: event.sender };
        return { ok: true, data: bundle.data, token: bundle.id };
      } catch (err) {
        return { ok: false, error: err.message };
      } finally {
        busy = false;
      }
    }, { role: 'main' });

    guardedHandle('backup:discard-full', (event, token) => {
      if (staged?.sender === event.sender && staged.bundle.id === token) discard();
    }, { role: 'main' });
  }

  function commit(sender, token, writeNotes) {
    if (!staged || staged.sender !== sender || staged.bundle.id !== token) throw new Error('Backup no longer available');
    const { bundle } = staged;
    staged = null;
    return commitBundle(bundle, userDir(), writeNotes);
  }

  return {
    registerIpc,
    commit,
    dispose: () => { quitting = true; discard(); }
  };
}

module.exports = { createBackupIpc };
