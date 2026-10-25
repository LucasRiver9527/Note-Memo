'use strict';
const path = require('path');
const OPTIONS = { enter: 12, leave: 20, inset: 8 };

function snapCandidate(bounds, display, previous = null, options = OPTIONS) {
  const opts = { ...OPTIONS, ...options }, area = display.workArea;
  const sameDisplay = previous && previous.displayId === display.id;
  const pick = (position, size, start, length, low, high, retained) => {
    if (size > length - opts.inset * 2) return null;
    const targets = [[low, start + opts.inset], [high, start + length - opts.inset - size]];
    const kept = targets.find(([edge, target]) => edge === retained && Math.abs(position - target) <= opts.leave);
    if (kept) return kept;
    return targets.filter(([, target]) => Math.abs(position - target) <= opts.enter)
      .sort((a, b) => Math.abs(position - a[1]) - Math.abs(position - b[1]))[0] || null;
  };
  const x = pick(bounds.x, bounds.width, area.x, area.width, 'left', 'right', sameDisplay && previous.xEdge);
  const y = pick(bounds.y, bounds.height, area.y, area.height, 'top', 'bottom', sameDisplay && previous.yEdge);
  if (!x && !y) return null;
  const clamp = (p, size, start, length) => size <= length - opts.inset * 2
    ? Math.max(start + opts.inset, Math.min(p, start + length - opts.inset - size)) : p;
  return { displayId: display.id, xEdge: x && x[0], yEdge: y && y[0], bounds: { ...bounds,
    x: x ? x[1] : clamp(bounds.x, bounds.width, area.x, area.width),
    y: y ? y[1] : clamp(bounds.y, bounds.height, area.y, area.height) } };
}
const sameBounds = (a, b) => ['x', 'y', 'width', 'height'].every(key => a[key] === b[key]);
function releaseTarget({ start, actual, pending, display, systemGesture, options }) {
  if (!pending || systemGesture || sameBounds(start, actual)) return null;
  if (actual.width !== start.width || actual.height !== start.height) return null;
  const fresh = snapCandidate(actual, display, pending, options);
  return fresh && sameBounds(fresh.bounds, pending.bounds) ? fresh.bounds : null;
}

// Main-process only. No renderer IPC accepts HWNDs, pointers or arbitrary moves.
function createDesktopSnap({ BrowserWindow, screen, platform = process.platform,
  loadNative = () => require('./desktop-snap-native.js')(), onError = console.warn }) {
  const attached = new Map();
  let enabled = true, faulted = false, disposed = false, native = null;
  let preview = null, ready = false, session = null, generation = 0;
  let appearance = { dark: false, radius: 12 };
  const hide = () => { if (preview && !preview.isDestroyed()) preview.hide(); };
  function cancel() { generation++; session = null; hide(); }
  function fail(error) { cancel(); faulted = true; onError('[desktop-snap] Disabled; native dragging remains available:', error); }
  function initNative() { if (!native) native = loadNative(); return native; }
  function ensurePreview() {
    if (preview && !preview.isDestroyed()) return;
    const p = new BrowserWindow({ width: 300, height: 240, show: false, frame: false, transparent: true,
      backgroundColor: '#00000000', focusable: false, skipTaskbar: true, resizable: false,
      thickFrame: false, hasShadow: false, alwaysOnTop: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    preview = p; ready = false;
    p.setIgnoreMouseEvents(true);
    p.setAlwaysOnTop(true, 'screen-saver');
    p.on('closed', () => { if (preview === p) { preview = null; ready = false; cancel(); } });
    p.loadFile(path.join(__dirname, 'renderer', 'snap-preview.html')).then(() => {
      if (disposed || preview !== p || p.isDestroyed()) return;
      ready = true;
      if (session && session.pending) renderCandidate(session, session.pending);
    }).catch(error => { if (!disposed && preview === p) fail(error); });
  }
  function renderCandidate(current, candidate) {
    current.pending = candidate;
    current.advertised = null;
    if (!candidate) { hide(); return; }
    ensurePreview();
    if (!ready) return;
    const display = screen.getAllDisplays().find(d => d.id === candidate.displayId);
    if (!display) { cancel(); return; }
    const pixels = native.targetPhysicalBounds(current.window, candidate, display, OPTIONS.inset, screen);
    native.placePreview(preview, pixels);
    const classes = [appearance.dark ? 'dark' : '', candidate.xEdge, candidate.yEdge].filter(Boolean).join(' ');
    preview.webContents.executeJavaScript('document.getElementById("outline").className=' + JSON.stringify(classes)
      + ';document.documentElement.style.setProperty("--radius",' + JSON.stringify(appearance.radius + 'px') + ')')
      .catch(error => { if (!disposed && preview && !preview.isDestroyed()) fail(error); });
    preview.showInactive();
    preview.moveTop();
    current.advertised = { candidate, pixels };
  }
  function attach(window) {
    if (disposed || platform !== 'win32' || attached.has(window)) return;
    const begin = () => {
      cancel();
      if (!enabled || faulted || !window.isVisible() || window.isMaximized()) return;
      try {
        initNative();
        session = { window, start: native.logicalBounds(window, screen), physicalStart: native.physicalBounds(window), moving: false, pending: null, advertised: null, systemGesture: false };
      } catch (error) { fail(error); }
    };
    const willMove = () => { if (session && session.window === window) session.moving = true; };
    const move = () => {
      const current = session;
      if (!current || current.window !== window || !current.moving || current.updateQueued) return;
      current.updateQueued = true;
      // Coalesce movement and avoid creating a window inside a native move callback.
      setImmediate(() => {
      current.updateQueued = false;
      if (session !== current) return;
      try {
        const actual = native.physicalBounds(window);
        if (actual.width !== current.physicalStart.width || actual.height !== current.physicalStart.height) { cancel(); return; }
        const cursor = screen.getCursorScreenPoint(), display = screen.getDisplayNearestPoint(cursor), b = display.bounds;
        current.systemGesture = cursor.x <= b.x + 2 || cursor.x >= b.x + b.width - 3 || cursor.y <= b.y + 2;
        renderCandidate(current, current.systemGesture ? null : snapCandidate(native.logicalBounds(window, screen), display, current.pending));
      } catch (error) { fail(error); }
      });
    };
    const end = () => {
      const ended = session;
      if (!ended || ended.window !== window) return;
      session = null; hide();
      const ticket = ++generation;
      // Windows must finish Escape restoration / native Snap before committing.
      setImmediate(() => {
        if (ticket !== generation || disposed || !enabled || faulted || window.isDestroyed() || !window.isVisible() || window.isMaximized()) return;
        if (!ended.moving || !ended.advertised) return;
        try {
          const physical = native.physicalBounds(window), advertised = ended.advertised;
          if (sameBounds(physical, ended.physicalStart) || physical.width !== ended.physicalStart.width || physical.height !== ended.physicalStart.height) return;
          const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
          const target = releaseTarget({ start: ended.start, actual: native.logicalBounds(window, screen), pending: advertised.candidate, display, systemGesture: ended.systemGesture });
          if (!target) return;
          const pixels = native.targetPhysicalBounds(window, advertised.candidate, display, OPTIONS.inset, screen);
          if (!sameBounds(pixels, advertised.pixels)) return;
          native.moveToPhysical(window, pixels);
        } catch (error) { fail(error); }
      });
    };
    const invalidate = () => { if (session && session.window === window) cancel(); else generation++; };
    const closed = () => {
      invalidate(); attached.delete(window);
      if (!attached.size && preview && !preview.isDestroyed()) preview.destroy();
    };
    window.hookWindowMessage(0x0231, begin);
    window.hookWindowMessage(0x0232, end);
    const events = { 'will-move': willMove, move, 'will-resize': invalidate, hide: invalidate, minimize: invalidate, blur: invalidate, close: invalidate, closed };
    Object.entries(events).forEach(([name, fn]) => window.on(name, fn));
    attached.set(window, () => {
      if (!window.isDestroyed()) { window.unhookWindowMessage(0x0231); window.unhookWindowMessage(0x0232); }
      Object.entries(events).forEach(([name, fn]) => window.removeListener(name, fn));
    });
  }
  const displayEvents = ['display-metrics-changed', 'display-removed', 'display-added'];
  displayEvents.forEach(name => screen.on(name, cancel));
  return {
    attach,
    setEnabled(value) { if (enabled !== value) { cancel(); if (value) faulted = false; } enabled = value; },
    setAppearance({ dark, radius }) {
      if (typeof dark === 'boolean') appearance.dark = dark;
      if (Number.isFinite(radius)) appearance.radius = Math.max(0, Math.min(28, radius));
      if (session && session.pending) { try { renderCandidate(session, session.pending); } catch (error) { fail(error); } }
    },
    dispose() {
      disposed = true; cancel();
      attached.forEach(cleanup => cleanup()); attached.clear();
      displayEvents.forEach(name => screen.removeListener(name, cancel));
      if (preview && !preview.isDestroyed()) preview.destroy();
    }
  };
}
module.exports = { snapCandidate, releaseTarget, sameBounds, createDesktopSnap };
