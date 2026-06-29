// src/utils/canvas-math.js
// Pure coordinate maths for the planning canvas. Item positions are stored in
// CANVAS space; the viewport applies a single CSS transform:
//   translate(panX, panY) scale(zoom)
// so a canvas point c appears on screen at  s = c * zoom + pan.
// Everything here is a pure function — unit-tested in canvas-math.test.js.

export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 3

export function clampZoom(z) {
  if (!isFinite(z)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

// Screen px (relative to the viewport element's top-left) → canvas coords.
export function screenToCanvas(point, viewport) {
  return {
    x: (point.x - viewport.panX) / viewport.zoom,
    y: (point.y - viewport.panY) / viewport.zoom,
  }
}

// Canvas coords → screen px (relative to the viewport element's top-left).
export function canvasToScreen(point, viewport) {
  return {
    x: point.x * viewport.zoom + viewport.panX,
    y: point.y * viewport.zoom + viewport.panY,
  }
}

// New viewport that changes zoom while keeping the canvas point under
// `screenPoint` exactly where it is (zoom-at-cursor).
export function zoomAtPoint(viewport, screenPoint, newZoom) {
  const z = clampZoom(newZoom)
  const scale = z / viewport.zoom
  return {
    zoom: z,
    panX: screenPoint.x - (screenPoint.x - viewport.panX) * scale,
    panY: screenPoint.y - (screenPoint.y - viewport.panY) * scale,
  }
}

// A screen-pixel drag delta converted to canvas units at the current zoom —
// this is what makes dragging track the cursor 1:1 at any zoom level.
export function dragDeltaToCanvas(deltaScreen, viewport) {
  return { x: deltaScreen.x / viewport.zoom, y: deltaScreen.y / viewport.zoom }
}

// Viewport that fits a set of item rects ({x,y,w,h} in canvas space) inside a
// viewport of size {width,height} with some padding, centred.
export function fitToItems(items, size, padding = 60) {
  if (!items.length) return { zoom: 1, panX: 0, panY: 0 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const it of items) {
    minX = Math.min(minX, it.x)
    minY = Math.min(minY, it.y)
    maxX = Math.max(maxX, it.x + it.w)
    maxY = Math.max(maxY, it.y + it.h)
  }
  const contentW = Math.max(1, maxX - minX)
  const contentH = Math.max(1, maxY - minY)
  const zoom = clampZoom(Math.min(
    (size.width - padding * 2) / contentW,
    (size.height - padding * 2) / contentH,
    1.5,
  ))
  return {
    zoom,
    panX: (size.width - contentW * zoom) / 2 - minX * zoom,
    panY: (size.height - contentH * zoom) / 2 - minY * zoom,
  }
}

// Centre of an item rect in canvas space.
export function rectCenter(item) {
  return { x: item.x + item.w / 2, y: item.y + item.h / 2 }
}

// Where the segment from a rect's centre towards an outside point crosses the
// rect's border. Arrows are drawn border-to-border so they stay attached as
// items move and resize.
export function rectEdgePoint(item, towards) {
  const c = rectCenter(item)
  const dx = towards.x - c.x
  const dy = towards.y - c.y
  if (dx === 0 && dy === 0) return c
  const hw = item.w / 2
  const hh = item.h / 2
  // Scale factor to reach the nearest vertical/horizontal border
  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity
  const s = Math.min(sx, sy)
  return { x: c.x + dx * s, y: c.y + dy * s }
}

// Endpoints (canvas space) for an arrow between two item rects.
export function arrowEndpoints(fromItem, toItem) {
  const fromC = rectCenter(fromItem)
  const toC = rectCenter(toItem)
  return {
    from: rectEdgePoint(fromItem, toC),
    to:   rectEdgePoint(toItem, fromC),
  }
}
