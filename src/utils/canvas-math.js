// @ts-check
// src/utils/canvas-math.js
// Pure coordinate maths for the planning canvas. Item positions are stored in
// CANVAS space; the viewport applies a single CSS transform:
//   translate(panX, panY) scale(zoom)
// so a canvas point c appears on screen at  s = c * zoom + pan.
// Everything here is a pure function — unit-tested in canvas-math.test.js.

/** @typedef {{ x: number, y: number }} Point */
/** @typedef {{ x: number, y: number, w: number, h: number }} Rect */
/** @typedef {{ panX: number, panY: number, zoom: number }} Viewport */
/** @typedef {'top' | 'right' | 'bottom' | 'left'} Side */

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4

/** @param {number} z */
export function clampZoom(z) {
  if (!isFinite(z)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

// Screen px (relative to the viewport element's top-left) → canvas coords.
/** @param {Point} point @param {Viewport} viewport @returns {Point} */
export function screenToCanvas(point, viewport) {
  return {
    x: (point.x - viewport.panX) / viewport.zoom,
    y: (point.y - viewport.panY) / viewport.zoom,
  }
}

// Canvas coords → screen px (relative to the viewport element's top-left).
/** @param {Point} point @param {Viewport} viewport @returns {Point} */
export function canvasToScreen(point, viewport) {
  return {
    x: point.x * viewport.zoom + viewport.panX,
    y: point.y * viewport.zoom + viewport.panY,
  }
}

// New viewport that changes zoom while keeping the canvas point under
// `screenPoint` exactly where it is (zoom-at-cursor).
/** @param {Viewport} viewport @param {Point} screenPoint @param {number} newZoom @returns {Viewport} */
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
/** @param {Point} deltaScreen @param {Viewport} viewport @returns {Point} */
export function dragDeltaToCanvas(deltaScreen, viewport) {
  return { x: deltaScreen.x / viewport.zoom, y: deltaScreen.y / viewport.zoom }
}

// Viewport that fits a set of item rects ({x,y,w,h} in canvas space) inside a
// viewport of size {width,height} with some padding, centred.
/** @param {Rect[]} items @param {{ width: number, height: number }} size @returns {Viewport} */
export function fitToItems(items, size, padding = 60) {
  if (!items.length) return { zoom: 1, panX: 0, panY: 0 }
  const b = boundsOf(items)
  const contentW = Math.max(1, b.w)
  const contentH = Math.max(1, b.h)
  const zoom = clampZoom(Math.min(
    (size.width - padding * 2) / contentW,
    (size.height - padding * 2) / contentH,
    1.5,
  ))
  return {
    zoom,
    panX: (size.width - contentW * zoom) / 2 - b.x * zoom,
    panY: (size.height - contentH * zoom) / 2 - b.y * zoom,
  }
}

// ── Wheel / trackpad input ─────────────────────────────────────────────────────
// Browsers report wheel deltas in pixels, lines or pages (deltaMode 0/1/2).
// Normalise everything to pixels so the maths below is device-independent.
/** @param {{ deltaX: number, deltaY: number, deltaMode: number }} e @returns {Point} */
export function normalizeWheel(e) {
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 800 : 1
  return { x: e.deltaX * k, y: e.deltaY * k }
}

// Decide what a wheel event means:
//   • pinch-to-zoom (trackpad) and Ctrl/Cmd+wheel arrive with ctrlKey/metaKey → zoom
//   • a physical mouse wheel (line-mode deltas, or large whole-number notches
//     on a single axis) → zoom at the cursor
//   • anything else is a two-finger trackpad scroll → pan
// `inTrackpadStream` keeps a scroll gesture that has already been identified
// as a trackpad from flipping to zoom halfway through its momentum tail.
/**
 * @param {{ deltaX: number, deltaY: number, deltaMode: number, ctrlKey?: boolean, metaKey?: boolean }} e
 * @param {boolean} [inTrackpadStream]
 * @returns {'zoom' | 'pan'}
 */
export function wheelIntent(e, inTrackpadStream = false) {
  if (e.ctrlKey || e.metaKey) return 'zoom'
  if (inTrackpadStream) return 'pan'
  if (e.deltaMode !== 0) return 'zoom'
  if (e.deltaX !== 0) return 'pan'
  const dy = Math.abs(e.deltaY)
  if (dy >= 50 && Math.abs(dy - Math.round(dy)) < 0.01) return 'zoom'
  return 'pan'
}

// Multiplicative zoom factor for a (normalised) wheel delta. Exponential, so a
// run of small trackpad-pinch deltas and one big mouse notch of the same total
// land on the same zoom, and zooming in then out by the same amount returns
// exactly to where it started. Per-event deltas are capped so a single fast
// flick can't jump several zoom levels at once.
/** @param {number} deltaY @param {boolean} [pinch] */
export function wheelZoomFactor(deltaY, pinch = false) {
  const capped = Math.max(-120, Math.min(120, deltaY))
  return Math.exp(-capped * (pinch ? 0.01 : 0.0022))
}

/** @param {Viewport} viewport @param {number} dx @param {number} dy @returns {Viewport} */
export function panBy(viewport, dx, dy) {
  return { zoom: viewport.zoom, panX: viewport.panX - dx, panY: viewport.panY - dy }
}

// Grid spacing on screen for a given zoom: the world grid is `base` px, but it
// doubles whenever it would get denser than `minPx` on screen so a zoomed-out
// canvas never turns into a solid wash of dots.
/** @param {number} zoom */
export function gridSpacing(zoom, base = 24, minPx = 12) {
  let s = base * zoom
  if (!(s > 0) || !isFinite(s)) return base
  while (s < minPx) s *= 2
  return s
}

// ── Rect helpers ──────────────────────────────────────────────────────────────

// Centre of an item rect in canvas space.
/** @param {Rect} item @returns {Point} */
export function rectCenter(item) {
  return { x: item.x + item.w / 2, y: item.y + item.h / 2 }
}

/** @param {Rect[]} rects @returns {Rect} */
export function boundsOf(rects) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// Rectangle spanned by two arbitrary corner points (e.g. a marquee drag).
/** @param {Point} a @param {Point} b @returns {Rect} */
export function rectFromPoints(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  }
}

// Strict overlap — rects that merely touch along an edge don't intersect.
/** @param {Rect} a @param {Rect} b */
export function rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/** @param {Rect} r @param {Point} p */
export function rectContains(r, p) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

// Distance from a point to the nearest point of a rect (0 when inside).
/** @param {Rect} r @param {Point} p */
export function distanceToRect(r, p) {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w))
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h))
  return Math.hypot(dx, dy)
}

// Ids of every item a marquee rect touches (canvas space).
/** @template {Rect & { id: string }} T @param {Rect} marquee @param {T[]} items @returns {string[]} */
export function marqueeHits(marquee, items) {
  const out = []
  for (const it of items) if (rectsIntersect(marquee, it)) out.push(it.id)
  return out
}

// ── Connectors ────────────────────────────────────────────────────────────────
// Connectors are drawn as cubic Béziers between the mid-points of two facing
// sides. The sides are re-picked from the rects on every frame, so a line
// re-routes itself (right→left becomes bottom→top, etc.) as items move past
// each other, and it can never detach because both ends are derived from the
// live rects.

/** @type {Record<Side, Point>} */
const NORMALS = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
}

/** @param {Rect} r @param {Side} side @returns {Point} */
export function sideAnchor(r, side) {
  if (side === 'top') return { x: r.x + r.w / 2, y: r.y }
  if (side === 'bottom') return { x: r.x + r.w / 2, y: r.y + r.h }
  if (side === 'left') return { x: r.x, y: r.y + r.h / 2 }
  return { x: r.x + r.w, y: r.y + r.h / 2 }
}

// Which pair of sides two rects should connect through. The axis with the
// larger clear gap wins; when the rects overlap on both axes the dominant
// centre-to-centre direction (relative to their size) decides.
/** @param {Rect} a @param {Rect} b @returns {[Side, Side]} */
export function pickSides(a, b) {
  const ac = rectCenter(a), bc = rectCenter(b)
  const dx = bc.x - ac.x, dy = bc.y - ac.y
  const gapX = dx >= 0 ? b.x - (a.x + a.w) : a.x - (b.x + b.w)
  const gapY = dy >= 0 ? b.y - (a.y + a.h) : a.y - (b.y + b.h)
  let horizontal
  if (gapX > 0 || gapY > 0) horizontal = gapX >= gapY
  else {
    const nx = Math.abs(dx) / Math.max(1, (a.w + b.w) / 2)
    const ny = Math.abs(dy) / Math.max(1, (a.h + b.h) / 2)
    horizontal = nx >= ny
  }
  if (horizontal) return dx >= 0 ? ['right', 'left'] : ['left', 'right']
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

// The side of `r` that faces a free point (used while a connector is being
// dragged out and has no target yet).
/** @param {Rect} r @param {Point} p @returns {Side} */
export function sideFacing(r, p) {
  return pickSides(r, { x: p.x, y: p.y, w: 0, h: 0 })[0]
}

/**
 * @typedef {{ start: Point, c1: Point, c2: Point, end: Point, startSide: Side, endSide: Side | null }} Connector
 */

/** @param {Point} a @param {Point} b */
function controlOffset(a, b) {
  return Math.max(24, Math.min(160, Math.hypot(b.x - a.x, b.y - a.y) * 0.45))
}

/** @param {Rect} from @param {Rect} to @returns {Connector} */
export function connectorBetween(from, to) {
  const [startSide, endSide] = pickSides(from, to)
  const start = sideAnchor(from, startSide)
  const end = sideAnchor(to, endSide)
  const off = controlOffset(start, end)
  const n1 = NORMALS[startSide], n2 = NORMALS[endSide]
  return {
    start, end, startSide, endSide,
    c1: { x: start.x + n1.x * off, y: start.y + n1.y * off },
    c2: { x: end.x + n2.x * off, y: end.y + n2.y * off },
  }
}

// A connector from a rect out to a loose point (the cursor mid-drag).
/** @param {Rect} from @param {Point} p @returns {Connector} */
export function connectorToPoint(from, p) {
  const startSide = sideFacing(from, p)
  const start = sideAnchor(from, startSide)
  const off = controlOffset(start, p)
  const n = NORMALS[startSide]
  return {
    start, end: { x: p.x, y: p.y }, startSide, endSide: null,
    c1: { x: start.x + n.x * off, y: start.y + n.y * off },
    c2: { x: p.x, y: p.y },
  }
}

/** @param {Connector} c @param {number} t @returns {Point} */
export function bezierPoint(c, t) {
  const u = 1 - t
  const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t
  return {
    x: a * c.start.x + b * c.c1.x + d * c.c2.x + e * c.end.x,
    y: a * c.start.y + b * c.c1.y + d * c.c2.y + e * c.end.y,
  }
}

/** @param {number} n */
const r2 = n => Math.round(n * 100) / 100

// SVG path data for a connector.
/** @param {Connector} c */
export function connectorPath(c) {
  return `M${r2(c.start.x)},${r2(c.start.y)} C${r2(c.c1.x)},${r2(c.c1.y)} ${r2(c.c2.x)},${r2(c.c2.y)} ${r2(c.end.x)},${r2(c.end.y)}`
}

// Magnetic target for a connector end: the topmost item whose rect, grown by
// `radius`, contains the point. An item the point is actually inside always
// beats one it is merely near; among near misses the closest wins.
/**
 * @template {Rect & { id: string, z?: number }} T
 * @param {Point} p @param {T[]} items @param {number} radius @param {string | null} [excludeId]
 * @returns {T | null}
 */
export function magnetTarget(p, items, radius, excludeId = null) {
  /** @type {T | null} */ let inside = null
  /** @type {T | null} */ let near = null
  let nearDist = Infinity
  for (const it of items) {
    if (it.id === excludeId) continue
    const d = distanceToRect(it, p)
    if (d === 0) {
      if (!inside || (it.z || 0) >= (inside.z || 0)) inside = it
    } else if (d <= radius && d < nearDist) {
      near = it
      nearDist = d
    }
  }
  return inside || near
}

// ── Alignment snapping ────────────────────────────────────────────────────────
// While a selection is dragged its bounding box snaps to the left/centre/right
// and top/middle/bottom lines of other items within `threshold` canvas units.
// Returns the correction to apply plus guide segments to draw.

/** @typedef {{ axis: 'x', x: number, y1: number, y2: number } | { axis: 'y', y: number, x1: number, x2: number }} Guide */

/**
 * @param {Rect} box @param {Rect[]} others @param {number} threshold
 * @returns {{ dx: number, dy: number, guides: Guide[] }}
 */
export function computeSnap(box, others, threshold) {
  const xs = [box.x, box.x + box.w / 2, box.x + box.w]
  const ys = [box.y, box.y + box.h / 2, box.y + box.h]
  let bestX = { d: threshold + 1, delta: 0, line: 0 }
  let bestY = { d: threshold + 1, delta: 0, line: 0 }
  for (const o of others) {
    const oxs = [o.x, o.x + o.w / 2, o.x + o.w]
    const oys = [o.y, o.y + o.h / 2, o.y + o.h]
    for (const a of xs) for (const b of oxs) {
      const d = Math.abs(b - a)
      if (d < bestX.d) bestX = { d, delta: b - a, line: b }
    }
    for (const a of ys) for (const b of oys) {
      const d = Math.abs(b - a)
      if (d < bestY.d) bestY = { d, delta: b - a, line: b }
    }
  }
  const dx = bestX.d <= threshold ? bestX.delta : 0
  const dy = bestY.d <= threshold ? bestY.delta : 0
  const snapped = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h }

  /** @type {Guide[]} */
  const guides = []
  const eps = 0.5
  if (bestX.d <= threshold) {
    let y1 = snapped.y, y2 = snapped.y + snapped.h
    for (const o of others) {
      if ([o.x, o.x + o.w / 2, o.x + o.w].some(v => Math.abs(v - bestX.line) < eps)) {
        y1 = Math.min(y1, o.y); y2 = Math.max(y2, o.y + o.h)
      }
    }
    guides.push({ axis: 'x', x: bestX.line, y1, y2 })
  }
  if (bestY.d <= threshold) {
    let x1 = snapped.x, x2 = snapped.x + snapped.w
    for (const o of others) {
      if ([o.y, o.y + o.h / 2, o.y + o.h].some(v => Math.abs(v - bestY.line) < eps)) {
        x1 = Math.min(x1, o.x); x2 = Math.max(x2, o.x + o.w)
      }
    }
    guides.push({ axis: 'y', y: bestY.line, x1, x2 })
  }
  return { dx, dy, guides }
}

// ── Colour helpers (swatch cards) ─────────────────────────────────────────────

// Normalise user input to a #RRGGBB hex, or null when it isn't a colour.
/** @param {string | null | undefined} input */
export function normalizeHex(input) {
  const s = String(input ?? '').trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(s)) return `#${s.split('').map(c => c + c).join('')}`.toUpperCase()
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s}`.toUpperCase()
  return null
}

// Black or white — whichever reads better on the given background (WCAG
// relative luminance).
/** @param {string} hex */
export function readableOn(hex) {
  const h = normalizeHex(hex)
  if (!h) return '#1A1D23'
  /** @param {number} i */
  const ch = i => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5)
  return L > 0.4 ? '#1A1D23' : '#FFFFFF'
}

/** @param {string} hex */
export function hexToRgb(hex) {
  const h = normalizeHex(hex)
  if (!h) return null
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) }
}
