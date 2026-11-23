'use strict';
const { release } = require('node:os');

function loadWindowsCorners() {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  const setWindowRgn = user32.func('int __stdcall SetWindowRgn(void *window, void *region, bool redraw)');
  const setWindowAttribute = dwmapi.func('int32_t __stdcall DwmSetWindowAttribute(void *window, uint32_t attribute, void *value, uint32_t length)');
  return (window, preference) => {
    const buffer = window.getNativeWindowHandle();
    const handle = buffer.length === 8 ? buffer.readBigUInt64LE() : BigInt(buffer.readUInt32LE());
    if (!setWindowRgn(handle, null, true)) throw new Error('Clear custom window region failed');
    const value = Buffer.alloc(4);
    value.writeUInt32LE(preference);
    if (setWindowAttribute(handle, 33, value, value.length) < 0) throw new Error('Native window corners unavailable');
    // The note already draws its own border.
    value.writeUInt32LE(0xFFFFFFFE);
    if (setWindowAttribute(handle, 34, value, value.length) < 0) throw new Error('Native border color unavailable');
  };
}

function createDesktopWindowAppearance({ platform = process.platform, systemRelease = release(),
  loadCorners = loadWindowsCorners, onError = console.warn } = {}) {
  const build = Number(systemRelease.split('.')[2]);
  const supportsCorners = platform === 'win32' && build >= 22000;
  // Windows system backdrops require Windows 11 22H2.
  const supportsMaterial = platform === 'win32' && build >= 22621;
  let applyCorners;
  const cornerSignatures = new WeakMap();
  const failedCorners = new WeakSet();
  return {
    setMaterial(window, acrylic) {
      if (!supportsMaterial || window.isDestroyed() || typeof window.setBackgroundMaterial !== 'function') return false;
      try {
        window.setBackgroundMaterial(acrylic ? 'acrylic' : 'none');
        return !!acrylic;
      } catch (error) {
        onError('[note-appearance] Could not update window material:', error);
        return false;
      }
    },
    updateCorners(window, radius) {
      if (!supportsCorners || window.isDestroyed() || failedCorners.has(window)) return;
      try {
        const { width, height } = window.getBounds();
        const preference = radius === 0 ? 1 : 2; // DWMWCP_DONOTROUND / DWMWCP_ROUND
        const signature = [width, height, preference].join(':');
        if (cornerSignatures.get(window) === signature) return;
        applyCorners ??= loadCorners();
        applyCorners(window, preference);
        cornerSignatures.set(window, signature);
      } catch (error) {
        failedCorners.add(window);
        onError('[note-appearance] Could not update window corners:', error);
      }
    }
  };
}

module.exports = { createDesktopWindowAppearance, desktopWindowAppearance: createDesktopWindowAppearance() };
