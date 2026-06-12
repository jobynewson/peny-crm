import { describe, it, expect } from 'vitest'
import {
  clampZoom, MIN_ZOOM, MAX_ZOOM,
  screenToCanvas, canvasToScreen, zoomAtPoint, dragDeltaToCanvas,
  fitToItems, rectCenter, rectEdgePoint, arrowEndpoints,
} from './canvas-math.js'

const vp = (panX, panY, zoom) => ({ panX, panY, zoom })

describe('clampZoom', () => {
  it('clamps to the min/max range', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM)
    expect(clampZoom(99)).toBe(MAX_ZOOM)
    expect(clampZoom(1.4)).toBe(1.4)
  })
  it('falls back to 1 for garbage input', () => {
    expect(clampZoom(NaN)).toBe(1)
    expect(clampZoom(Infinity)).toBe(1)
  })
})

describe('screenToCanvas / canvasToScreen', () => {
  it('are identity with no pan and zoom 1', () => {
    expect(screenToCanvas({ x: 50, y: 80 }, vp(0, 0, 1))).toEqual({ x: 50, y: 80 })
    expect(canvasToScreen({ x: 50, y: 80 }, vp(0, 0, 1))).toEqual({ x: 50, y: 80 })
  })

  it('applies pan then zoom correctly', () => {
    // canvas (10,20) at zoom 2 with pan (100,50) → screen (120, 90)
    expect(canvasToScreen({ x: 10, y: 20 }, vp(100, 50, 2))).toEqual({ x: 120, y: 90 })
    expect(screenToCanvas({ x: 120, y: 90 }, vp(100, 50, 2))).toEqual({ x: 10, y: 20 })
  })

  it('round-trip at arbitrary viewports', () => {
    const viewports = [vp(0, 0, 1), vp(-340.5, 122, 0.35), vp(80, -990, 2.75)]
    const points = [{ x: 0, y: 0 }, { x: 123.4, y: -567.8 }, { x: -2000, y: 4000 }]
    for (const v of viewports) for (const p of points) {
      const back = screenToCanvas(canvasToScreen(p, v), v)
      expect(back.x).toBeCloseTo(p.x, 9)
      expect(back.y).toBeCloseTo(p.y, 9)
    }
  })
})

describe('zoomAtPoint', () => {
  it('keeps the canvas point under the cursor fixed on screen', () => {
    const v = vp(-120, 60, 0.8)
    const cursor = { x: 400, y: 300 }
    const before = screenToCanvas(cursor, v)
    const v2 = zoomAtPoint(v, cursor, 1.6)
    const after = screenToCanvas(cursor, v2)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
    expect(v2.zoom).toBe(1.6)
  })

  it('clamps the requested zoom', () => {
    const v2 = zoomAtPoint(vp(0, 0, 1), { x: 0, y: 0 }, 100)
    expect(v2.zoom).toBe(MAX_ZOOM)
  })

  it('zooming at origin with zero pan only changes zoom', () => {
    const v2 = zoomAtPoint(vp(0, 0, 1), { x: 0, y: 0 }, 2)
    expect(v2).toEqual({ zoom: 2, panX: 0, panY: 0 })
  })
})

describe('dragDeltaToCanvas', () => {
  it('divides screen deltas by zoom so drags track the cursor 1:1', () => {
    expect(dragDeltaToCanvas({ x: 30, y: -12 }, vp(999, -999, 2))).toEqual({ x: 15, y: -6 })
    expect(dragDeltaToCanvas({ x: 10, y: 10 }, vp(0, 0, 0.5))).toEqual({ x: 20, y: 20 })
  })

  it('moving an item by a converted delta keeps it under the cursor', () => {
    const v = vp(-50, 75, 1.7)
    const item = { x: 100, y: 200, w: 160, h: 90 }
    const screenBefore = canvasToScreen(item, v)
    const deltaScreen = { x: 37, y: -22 }
    const d = dragDeltaToCanvas(deltaScreen, v)
    const screenAfter = canvasToScreen({ x: item.x + d.x, y: item.y + d.y }, v)
    expect(screenAfter.x).toBeCloseTo(screenBefore.x + deltaScreen.x, 9)
    expect(screenAfter.y).toBeCloseTo(screenBefore.y + deltaScreen.y, 9)
  })
})

describe('fitToItems', () => {
  it('returns the default viewport for no items', () => {
    expect(fitToItems([], { width: 800, height: 600 })).toEqual({ zoom: 1, panX: 0, panY: 0 })
  })

  it('fits all items inside the viewport with padding', () => {
    const items = [
      { x: 0, y: 0, w: 200, h: 150 },
      { x: 900, y: 700, w: 200, h: 150 },
    ]
    const size = { width: 800, height: 600 }
    const v = fitToItems(items, size, 60)
    for (const it of items) {
      for (const corner of [
        { x: it.x, y: it.y },
        { x: it.x + it.w, y: it.y + it.h },
      ]) {
        const s = canvasToScreen(corner, v)
        expect(s.x).toBeGreaterThanOrEqual(0)
        expect(s.y).toBeGreaterThanOrEqual(0)
        expect(s.x).toBeLessThanOrEqual(size.width)
        expect(s.y).toBeLessThanOrEqual(size.height)
      }
    }
  })

  it('never zooms in past 1.5 for a tiny item', () => {
    const v = fitToItems([{ x: 0, y: 0, w: 10, h: 10 }], { width: 1000, height: 1000 })
    expect(v.zoom).toBeLessThanOrEqual(1.5)
  })
})

describe('rect geometry / arrows', () => {
  const a = { x: 0, y: 0, w: 100, h: 60 }     // centre (50,30)
  const b = { x: 300, y: 0, w: 100, h: 60 }   // centre (350,30)

  it('rectCenter', () => {
    expect(rectCenter(a)).toEqual({ x: 50, y: 30 })
  })

  it('edge point towards a horizontal neighbour sits on the right border', () => {
    const p = rectEdgePoint(a, rectCenter(b))
    expect(p).toEqual({ x: 100, y: 30 })
  })

  it('edge point towards a point directly below sits on the bottom border', () => {
    const p = rectEdgePoint(a, { x: 50, y: 500 })
    expect(p).toEqual({ x: 50, y: 60 })
  })

  it('degenerate case: target at centre returns the centre', () => {
    expect(rectEdgePoint(a, rectCenter(a))).toEqual({ x: 50, y: 30 })
  })

  it('arrowEndpoints connects facing borders and stays attached after a move', () => {
    const e1 = arrowEndpoints(a, b)
    expect(e1.from).toEqual({ x: 100, y: 30 })
    expect(e1.to).toEqual({ x: 300, y: 30 })

    // Move b below a — endpoints must follow to the vertical borders
    const b2 = { ...b, x: 0, y: 300 }
    const e2 = arrowEndpoints(a, b2)
    expect(e2.from).toEqual({ x: 50, y: 60 })
    expect(e2.to).toEqual({ x: 50, y: 300 })
  })

  it('diagonal arrow endpoints lie on the rect borders', () => {
    const c = { x: 400, y: 400, w: 80, h: 80 }
    const { from, to } = arrowEndpoints(a, c)
    const onBorder = (p, r) =>
      (Math.abs(p.x - r.x) < 1e-9 || Math.abs(p.x - (r.x + r.w)) < 1e-9) && p.y >= r.y - 1e-9 && p.y <= r.y + r.h + 1e-9 ||
      (Math.abs(p.y - r.y) < 1e-9 || Math.abs(p.y - (r.y + r.h)) < 1e-9) && p.x >= r.x - 1e-9 && p.x <= r.x + r.w + 1e-9
    expect(onBorder(from, a)).toBe(true)
    expect(onBorder(to, c)).toBe(true)
  })
})
