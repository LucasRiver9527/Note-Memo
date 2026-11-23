const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 720;
const MIN_WIDTH = 640;
const MIN_HEIGHT = 420;

function isScreenInteger(value) {
  return Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff;
}

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y;
}

// BrowserWindow and Electron screen rectangles use DIP coordinates, including the work-area origin.
function resolveWindowBounds(screen, saved) {
  const primary = screen.getPrimaryDisplay();
  const width = isScreenInteger(saved?.width) && saved.width > 0 ? saved.width : DEFAULT_WIDTH;
  const height = isScreenInteger(saved?.height) && saved.height > 0 ? saved.height : DEFAULT_HEIGHT;
  const hasPosition = isScreenInteger(saved?.x) && isScreenInteger(saved?.y);
  const requested = hasPosition ? { x: saved.x, y: saved.y, width, height } : null;
  const matching = requested ? screen.getDisplayMatching(requested) : null;
  const visible = matching && overlaps(requested, matching.bounds);
  const area = visible ? matching.workArea : primary.workArea;
  const winWidth = Math.max(MIN_WIDTH, Math.min(width, area.width));
  const winHeight = Math.max(MIN_HEIGHT, Math.min(height, area.height));
  const left = Math.max(0, area.width - winWidth);
  const top = Math.max(0, area.height - winHeight);
  return {
    width: winWidth,
    height: winHeight,
    x: area.x + (visible ? Math.max(0, Math.min(left, requested.x - area.x)) : Math.round(left / 2)),
    y: area.y + (visible ? Math.max(0, Math.min(top, requested.y - area.y)) : Math.round(top / 2))
  };
}

module.exports = { resolveWindowBounds, MIN_WIDTH, MIN_HEIGHT };
