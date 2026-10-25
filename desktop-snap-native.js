'use strict';
// Windows main-process adapter; only operates on BrowserWindows owned by this app.
const koffi = require('koffi');
const user32 = koffi.load('user32.dll');
const dwmapi = koffi.load('dwmapi.dll');
const setWindowRgn = user32.func('int __stdcall SetWindowRgn(void *window, void *region, bool redraw)');
const setWindowAttribute = dwmapi.func('int32_t __stdcall DwmSetWindowAttribute(void *window, uint32_t attribute, void *value, uint32_t length)');
const cornerSignatures = new WeakMap();
const getWindowRect = user32.func('bool __stdcall GetWindowRect(void *window, void *rect)');
const setWindowPos = user32.func('bool __stdcall SetWindowPos(void *window, void *after, int x, int y, int width, int height, uint32_t flags)');
const hwnd = (window) => {
  const buffer = window.getNativeWindowHandle();
  return buffer.length === 8 ? buffer.readBigUInt64LE() : BigInt(buffer.readUInt32LE());
};
function physicalBounds(window) {
  const rect = Buffer.alloc(16);
  if (!getWindowRect(hwnd(window), rect)) throw new Error('GetWindowRect failed');
  const [x,y,right,bottom] = [0,4,8,12].map(i => rect.readInt32LE(i));
  return { x, y, width: right-x, height: bottom-y };
}
function moveToPhysical(window, p) {
  // SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER
  if (!setWindowPos(hwnd(window), null, p.x, p.y, 0, 0, 0x0215)) throw new Error('SetWindowPos failed');
}
function logicalBounds(window, screen) {
  const bounds = physicalBounds(window);
  const p = screen.screenToDipPoint({x:bounds.x,y:bounds.y});
  const scale = screen.getDisplayNearestPoint(p).scaleFactor;
  return {...p, width:Math.round(bounds.width/scale), height:Math.round(bounds.height/scale)};
}
function targetPhysicalBounds(window, candidate, display, inset, screen) {
  const current=physicalBounds(window);
  const point=screen.dipToScreenPoint({x:Math.round(candidate.bounds.x),y:Math.round(candidate.bounds.y)});
  const area=screen.dipToScreenRect(window,display.workArea);
  const margin=Math.round(inset*display.scaleFactor);
  if(candidate.xEdge==='left')point.x=area.x+margin;
  if(candidate.xEdge==='right')point.x=area.x+area.width-margin-current.width;
  if(candidate.yEdge==='top')point.y=area.y+margin;
  if(candidate.yEdge==='bottom')point.y=area.y+area.height-margin-current.height;
  return {...point,width:current.width,height:current.height};
}
function placePreview(window, rect) {
  // Preview alone is resized; the user's note always uses SWP_NOSIZE.
  if(!setWindowPos(hwnd(window),null,rect.x,rect.y,rect.width,rect.height,0x0214))throw new Error('Preview SetWindowPos failed');
}
// A native DWM backdrop is not clipped reliably by CSS/GDI custom corners.
// Let Windows clip the backdrop and full rectangular content together instead.
function applyRoundedCorners(window, radius) {
  const handle = hwnd(window), bounds = physicalBounds(window);
  const preference = radius === 0 ? 1 : 2; // DWMWCP_DONOTROUND / DWMWCP_ROUND
  const signature = [bounds.width, bounds.height, preference].join(':');
  if (cornerSignatures.get(window) === signature) return;
  cornerSignatures.set(window, signature);
  try {
    if (!setWindowRgn(handle, null, true)) throw new Error('Clear custom window region failed');
    const value = Buffer.alloc(4);
    value.writeUInt32LE(preference);
    if (setWindowAttribute(handle, 33, value, 4) < 0) throw new Error('Native window corners unavailable');
    // Hide the extra native frame line; the note keeps its own glass border.
    value.writeUInt32LE(0xFFFFFFFE);
    if (setWindowAttribute(handle, 34, value, 4) < 0) throw new Error('Native border color unavailable');
  } catch (error) {
    cornerSignatures.delete(window);
    throw error;
  }
}
module.exports = () => ({physicalBounds, moveToPhysical, logicalBounds, targetPhysicalBounds, placePreview, applyRoundedCorners});
