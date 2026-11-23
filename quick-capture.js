const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { BrowserWindow, screen } = require('electron');

function createQuickCapture({ getMainContents }) {
  const page = path.join(__dirname, 'renderer', 'quick-capture.html');
  let win = null;
  let draftId = null;
  let saving = false;

  function callWorkspace(method, payload = null) {
    const contents = getMainContents();
    if (!contents) return null;
    return contents.mainFrame.executeJavaScript(
      'window.quickCaptureWorkspace?.' + method + '(' + JSON.stringify(payload) + ') ?? null'
    );
  }

  function show() {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return;
    }
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const width = Math.min(454, workArea.width);
    const height = Math.min(365, workArea.height);
    win = new BrowserWindow({
      width, height,
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + (workArea.height - height) / 2),
      show: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      autoHideMenuBar: true,
      title: 'Note-Memo',
      icon: path.join(__dirname, 'assets', 'icon.ico'),
      webPreferences: {
        preload: path.join(__dirname, 'quick-capture-preload.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    const window = win;
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const event of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
      window.webContents.on(event, (request) => request.preventDefault());
    }
    window.on('close', (event) => {
      event.preventDefault();
      if (!saving) window.hide();
    });
    window.once('closed', () => {
      win = null;
      draftId = null;
    });
    window.once('ready-to-show', () => window.show());
    window.loadFile(page).catch((error) => {
      console.error('[quick-capture] 加载失败：', error);
      if (!window.isDestroyed()) window.destroy();
    });
  }

  function registerIpc(guardedHandle, guardedOn) {
    guardedOn('quick:show', show, { role: 'main' });
    guardedOn('quick:hide', () => {
      if (!saving) win?.hide();
    }, { role: 'quick' });
    guardedHandle('quick:config', () => callWorkspace('config'), { role: 'quick' });
    guardedHandle('quick:save', async (event, input) => {
      if (saving || !input || typeof input.title !== 'string' || typeof input.content !== 'string') return 'failed';
      const title = input.title.slice(0, 160).trim();
      const content = input.content.slice(0, 50000);
      if (!title && !content.trim()) return 'empty';
      const groupId = typeof input.groupId === 'string' ? input.groupId : null;
      saving = true;
      draftId ||= 'quick-' + randomUUID();
      try {
        const result = await callWorkspace('save', { id: draftId, title, content, groupId, pin: input.pin === true });
        if (result === 'saved' || result === 'unpinned') {
          draftId = null;
          if (result === 'saved') win?.hide();
        }
        return result || 'failed';
      } finally {
        saving = false;
      }
    }, { role: 'quick' });
  }

  return {
    page, show, registerIpc,
    owns: (contents) => !!win && !win.isDestroyed() && win.webContents === contents,
    dispose: () => win?.destroy()
  };
}

module.exports = { createQuickCapture };
