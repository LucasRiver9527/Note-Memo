const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDesktopWindowAppearance } = require('../desktop-window-appearance');

function setup(platform, systemRelease, { failCorners = false, failMaterial = false } = {}) {
  const materials = [], corners = [], errors = [];
  let loads = 0;
  const window = {
    isDestroyed: () => false,
    getBounds: () => ({ width: 300, height: 240 }),
    setBackgroundMaterial(material) {
      if (failMaterial) throw new Error('Backdrop unavailable');
      materials.push(material);
    }
  };
  const appearance = createDesktopWindowAppearance({
    platform, systemRelease,
    loadCorners() {
      loads++;
      return (target, preference) => {
        assert.equal(target, window);
        corners.push(preference);
        if (failCorners) throw new Error('Corners unavailable');
      };
    },
    onError: (...message) => errors.push(message)
  });
  return { appearance, window, materials, corners, errors, get loads() { return loads; } };
}

test('Windows 10 and other platforms use the solid fallback without loading Windows corner APIs', () => {
  for (const args of [['win32', '10.0.19045'], ['linux', '6.8.24000']]) {
    const h = setup(...args);
    assert.equal(h.appearance.setMaterial(h.window, true), false);
    h.appearance.updateCorners(h.window, 12);
    assert.deepEqual(h.materials, []);
    assert.equal(h.loads, 0);
    assert.deepEqual(h.errors, []);
  }
});

test('Windows 11 21H2 supports native corners without the acrylic backdrop', () => {
  const h = setup('win32', '10.0.22000');
  assert.equal(h.appearance.setMaterial(h.window, true), false);
  h.appearance.updateCorners(h.window, 12);
  assert.deepEqual(h.corners, [2]);
});

test('Windows 11 22H2 and later preserve acrylic, square corners, and resize handling', () => {
  const h = setup('win32', '10.0.22621');
  assert.equal(h.appearance.setMaterial(h.window, true), true);
  assert.equal(h.appearance.setMaterial(h.window, false), false);
  assert.deepEqual(h.materials, ['acrylic', 'none']);
  h.appearance.updateCorners(h.window, 12);
  h.appearance.updateCorners(h.window, 12);
  h.appearance.updateCorners(h.window, 0);
  h.window.getBounds = () => ({ width: 340, height: 240 });
  h.appearance.updateCorners(h.window, 0);
  assert.equal(h.loads, 1);
  assert.deepEqual(h.corners, [2, 1, 1]);
});

test('a Windows appearance failure falls back without repeatedly applying failed corners on resize', () => {
  const h = setup('win32', '10.0.22621', { failCorners: true, failMaterial: true });
  assert.equal(h.appearance.setMaterial(h.window, true), false);
  h.appearance.updateCorners(h.window, 12);
  h.appearance.updateCorners(h.window, 0);
  assert.deepEqual(h.corners, [2]);
  assert.equal(h.errors.length, 2);
});
