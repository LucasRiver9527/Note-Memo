const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveWindowBounds } = require('../window-bounds.js');

const primary = {
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 40, width: 1920, height: 1040 }
};

test('window restore keeps reachable positions on each matched side of the primary display', () => {
  for (const [x, y] of [[-1280, 32], [1920, 32], [400, -900]]) {
    const secondary = { bounds: { x, y, width: 1280, height: 900 } };
    secondary.workArea = { ...secondary.bounds, height: 860 };
    const requested = { x: x + 50, y: y + 30, width: 920, height: 580 };
    const screen = {
      getPrimaryDisplay: () => primary,
      getDisplayMatching: (rect) => {
        assert.deepEqual(rect, requested);
        return secondary;
      }
    };
    assert.deepEqual(resolveWindowBounds(screen, requested), requested);
  }
});

test('window restore uses the matched work area origin and keeps a partially visible window accessible', () => {
  const secondary = {
    bounds: { x: -1440, y: -100, width: 1440, height: 900 },
    workArea: { x: -1390, y: -60, width: 1390, height: 860 }
  };
  const screen = { getPrimaryDisplay: () => primary, getDisplayMatching: () => secondary };
  assert.deepEqual(resolveWindowBounds(screen, { x: -1600, y: -300, width: 1300, height: 900 }),
    { x: -1390, y: -60, width: 1300, height: 860 });
});

test('window restore centers a disconnected window on the primary work area', () => {
  const screen = { getPrimaryDisplay: () => primary, getDisplayMatching: () => primary };
  assert.deepEqual(resolveWindowBounds(screen, { x: -1280, y: 100, width: 880, height: 580 }),
    { x: 520, y: 270, width: 880, height: 580 });
});

test('window restore handles missing or invalid saved coordinates without calling display matching', () => {
  const screen = { getPrimaryDisplay: () => primary, getDisplayMatching: () => assert.fail('invalid position') };
  assert.deepEqual(resolveWindowBounds(screen), { x: 420, y: 200, width: 1080, height: 720 });
  assert.deepEqual(resolveWindowBounds(screen, { x: NaN, y: 100, width: 700, height: 500 }),
    { x: 610, y: 310, width: 700, height: 500 });
});
