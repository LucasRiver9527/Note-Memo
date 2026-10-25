const { test } = require('node:test');
const assert = require('node:assert/strict');
const { snapCandidate: candidate, releaseTarget, sameBounds } = require('../desktop-snap.js');
const display = { id: 1, scaleFactor: 1.25, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1032 } };
const bounds = { x: 700, y: 400, width: 320, height: 280 };

for (const [edge, b, result] of [
  ['left', { ...bounds, x: 19 }, { ...bounds, x: 8 }],
  ['right', { ...bounds, x: 1583 }, { ...bounds, x: 1592 }],
  ['top', { ...bounds, y: 17 }, { ...bounds, y: 8 }],
  ['bottom', { ...bounds, y: 735 }, { ...bounds, y: 744 }]
]) test('candidate: ' + edge + ' targets the work area and preserves size', () => {
  assert.deepEqual(candidate(b, display).bounds, result);
});

test('work-area offsets and side/top taskbars are respected', () => {
  const d = { id: 2, workArea: { x: 48, y: 40, width: 1872, height: 1040 } };
  const c = candidate({ ...bounds, x: 60, y: 49 }, d);
  assert.deepEqual(c.bounds, { ...bounds, x: 56, y: 48 });
});
test('negative monitor coordinates stay in DIP without extra scale multiplication', () => {
  const d = { id: 3, scaleFactor: 1.5, workArea: { x: -1920, y: -500, width: 1920, height: 1040 } };
  assert.deepEqual(candidate({ ...bounds, x: -1905, y: -485 }, d).bounds, { ...bounds, x: -1912, y: -492 });
});
test('threshold is inclusive; moving away removes the candidate', () => {
  assert.ok(candidate({ ...bounds, x: 20 }, display));
  assert.equal(candidate({ ...bounds, x: 21 }, display), null);
  assert.equal(candidate(bounds, display), null);
});
test('20-DIP hysteresis keeps a live edge stable, then clears', () => {
  const previous = candidate({ ...bounds, x: 17 }, display);
  assert.ok(candidate({ ...bounds, x: 28 }, display, previous));
  assert.equal(candidate({ ...bounds, x: 29 }, display, previous), null);
  assert.equal(candidate({ ...bounds, x: 28 }, display), null);
});
test('switching monitors drops hysteresis from the previous display', () => {
  const previous = candidate({ ...bounds, x: 17 }, display);
  assert.equal(candidate({ ...bounds, x: 28 }, { ...display, id: 99 }, previous), null);
});
test('corners combine axes; inset 0 is truly flush', () => {
  const c = candidate({ ...bounds, x: 7, y: 6 }, display, null, { inset: 0 });
  assert.equal(c.xEdge, 'left'); assert.equal(c.yEdge, 'top');
  assert.deepEqual(c.bounds, { ...bounds, x: 0, y: 0 });
});
test('oversized notes are never silently resized', () => {
  const b = { x: 10, y: 10, width: 2200, height: 280 };
  const c = candidate(b, display);
  assert.equal(c.xEdge, null); assert.equal(c.yEdge, 'top');
  assert.deepEqual(c.bounds, { ...b, y: 8 });
  assert.equal(candidate({ ...b, height: 1400 }, display), null);
});
test('the unsnapped axis is brought inside only when needed', () => {
  assert.deepEqual(candidate({ ...bounds, x: 9, y: -100 }, display).bounds, { ...bounds, x: 8, y: 8 });
});

const start = { ...bounds, x: 40 };
const actual = { ...bounds, x: 17 };
const pending = candidate(actual, display);
test('native release returns exactly the previously previewed destination', () => {
  assert.deepEqual(releaseTarget({ start, actual, pending, display }), pending.bounds);
});
test('Escape restoration near an edge is not mistaken for a new snap', () => {
  const nearStart = { ...bounds, x: 17 };
  assert.equal(releaseTarget({ start: nearStart, actual: nearStart, pending, display }), null);
});
test('native Snap/resize and system edge gestures keep priority', () => {
  assert.equal(releaseTarget({ start, actual: { ...actual, width: 960 }, pending, display }), null);
  assert.equal(releaseTarget({ start, actual, pending, display, systemGesture: true }), null);
});
test('no preview or a changed work area does not cause an unadvertised move', () => {
  assert.equal(releaseTarget({ start, actual, pending: null, display }), null);
  assert.equal(releaseTarget({ start, actual, pending, display: { id: 1, workArea: { x: 40, y: 0, width: 1880, height: 1032 } } }), null);
});
test('bounds equality compares size as well as location', () => {
  assert.ok(sameBounds(bounds, { ...bounds }));
  assert.ok(!sameBounds(bounds, { ...bounds, width: 321 }));
});

const { EventEmitter } = require('node:events');
const { createDesktopSnap } = require('../desktop-snap.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness({ deferLoad = false, broken = false } = {}) {
  const previews = [], moves = [], errors = [];
  const display = { id: 1, scaleFactor: 1.25, bounds: { x: 0, y: 0, width: 2048, height: 1152 }, workArea: { x: 0, y: 0, width: 2048, height: 1104 } };
  const screen = Object.assign(new EventEmitter(), { getAllDisplays: () => [display], getCursorScreenPoint: () => ({ x: 120, y: 200 }), getDisplayNearestPoint: () => display });
  class Window extends EventEmitter {
    constructor(options = {}) {
      super(); this.visible = options.show !== false; this.destroyed = false; this.maximized = false; this.hooks = new Map(); this.options = options;
      this.bounds = { x: 100, y: 80, width: 320, height: 280 }; this.physical = { x: 125, y: 100, width: 400, height: 350 };
      this.webContents = { executeJavaScript: () => Promise.resolve() };
      if (options.webPreferences) previews.push(this);
    }
    isDestroyed() { return this.destroyed; } isVisible() { return this.visible; } isMaximized() { return this.maximized; }
    hookWindowMessage(id, fn) { this.hooks.set(id, fn); } unhookWindowMessage(id) { this.hooks.delete(id); }
    setIgnoreMouseEvents(v) { this.ignore = v; } setAlwaysOnTop() {} moveTop() {}
    loadFile() { return deferLoad ? new Promise(resolve => { this.resolveLoad = resolve; }) : Promise.resolve(); }
    hide() { this.visible = false; } showInactive() { this.visible = true; }
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
  }
  const native = {
    logicalBounds: w => ({ ...w.bounds }), physicalBounds: w => ({ ...w.physical }),
    targetPhysicalBounds: (w, candidate) => ({ x: Math.round(candidate.bounds.x * 1.25), y: Math.round(candidate.bounds.y * 1.25), width: w.physical.width, height: w.physical.height }),
    placePreview: (p, pixels) => { p.physical = { ...pixels }; },
    moveToPhysical: (w, p) => { if (broken) throw new Error('native unavailable'); moves.push(p); w.physical = { ...p }; }
  };
  const manager = createDesktopSnap({ BrowserWindow: Window, screen, platform: 'win32', loadNative: () => native, onError: (...e) => errors.push(e) });
  const window = new Window(); manager.attach(window);
  const begin = () => window.hooks.get(0x0231)();
  const move = (x = 17) => { window.emit('will-move'); window.bounds.x = x; window.physical.x = Math.round(x * 1.25); window.emit('move'); };
  const end = () => window.hooks.get(0x0232)();
  return { manager, window, native, screen, display, previews, moves, errors, begin, move, end, Window };
}
test('desktop snap lifecycle: only an advertised destination commits, without activating the preview', async () => {
  const h = harness(); h.begin(); h.move(); await tick();
  const preview = h.previews[0]; assert.equal(preview.visible, true); assert.equal(preview.ignore, true);
  assert.equal(preview.options.focusable, false); assert.equal(preview.options.webPreferences.nodeIntegration, false);
  const target = { ...preview.physical }; h.end(); await tick();
  assert.deepEqual(h.moves, [target]); assert.equal(preview.visible, false); h.manager.dispose();
  assert.equal(h.screen.listenerCount('display-metrics-changed'), 0); assert.equal(h.window.hooks.size, 0); assert.equal(preview.destroyed, true);
});
for (const reason of ['escape', 'resize', 'hide', 'close', 'disabled', 'display-change', 'maximized', 'physical-size-change']) {
  test('desktop snap lifecycle: ' + reason + ' cancels without moving', async () => {
    const h = harness(); h.begin(); h.move(); await tick();
    if (reason === 'escape') { h.window.bounds.x = 100; h.window.physical.x = 125; }
    if (reason === 'resize') h.window.emit('will-resize');
    if (reason === 'hide') { h.window.visible = false; h.window.emit('hide'); }
    if (reason === 'close') h.window.emit('close');
    if (reason === 'disabled') h.manager.setEnabled(false);
    if (reason === 'display-change') h.screen.emit('display-metrics-changed');
    if (reason === 'maximized') h.window.maximized = true;
    if (reason === 'physical-size-change') h.window.physical.width++;
    h.end(); await tick(); assert.equal(h.moves.length, 0); assert.equal(h.previews[0].visible, false); h.manager.dispose();
  });
}
test('desktop snap lifecycle: releasing before preview loads never causes an invisible snap', async () => {
  const h = harness({ deferLoad: true }); h.begin(); h.move(); await tick(); h.end();
  h.previews[0].resolveLoad(); await tick(); assert.equal(h.moves.length, 0); assert.equal(h.previews[0].visible, false); h.manager.dispose();
});
test('desktop snap lifecycle: turning off after release invalidates the queued commit', async () => {
  const h = harness(); h.begin(); h.move(); await tick(); h.end(); h.manager.setEnabled(false); await tick();
  assert.equal(h.moves.length, 0); h.manager.dispose();
});
test('desktop snap lifecycle: native failure keeps ordinary dragging available and does not retry unsafe fallback', async () => {
  const h = harness({ broken: true }); h.begin(); h.move(); await tick(); h.end(); await tick();
  assert.equal(h.errors.length, 1); assert.equal(h.moves.length, 0); assert.equal(h.previews[0].visible, false);
  h.begin(); h.move(16); h.end(); await tick(); assert.equal(h.errors.length, 1); h.manager.dispose();
});
test('desktop snap lifecycle: native system edge gesture takes priority', async () => {
  const h = harness(); h.screen.getCursorScreenPoint = () => ({ x: 0, y: 200 }); h.begin(); h.move(); h.end(); await tick();
  assert.equal(h.previews.length, 0); assert.equal(h.moves.length, 0); h.manager.dispose();
});
test('desktop snap lifecycle: last note closing destroys preview; a new note can create another', async () => {
  const h = harness(); h.begin(); h.move(); await tick(); h.window.destroy(); assert.equal(h.previews[0].destroyed, true);
  const another = new h.Window(); h.manager.attach(another); another.hooks.get(0x0231)(); another.emit('will-move'); another.bounds.x = 17; another.physical.x = 21; another.emit('move'); await tick();
  assert.equal(h.previews.length, 2); assert.equal(h.previews[1].visible, true); h.manager.dispose();
});

test('desktop snap lifecycle: a quick release before the queued update creates no preview or snap', async () => {
  const h = harness(); h.begin(); h.move();
  assert.equal(h.previews.length, 0);
  h.end(); await tick();
  assert.equal(h.previews.length, 0); assert.equal(h.moves.length, 0); h.manager.dispose();
});
