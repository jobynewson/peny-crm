import { describe, it, expect } from 'vitest'
import {
  clampZoom, MIN_ZOOM, MAX_ZOOM,
  screenToCanvas, canvasToScreen, zoomAtPoint, dragDeltaToCanvas,
  fitToItems, rectCenter, normalizeWheel, wheelIntent, wheelZoomFactor, panBy, gridSpacing,
  boundsOf, rectFromPoints, rectsIntersect, distanceToRect, marqueeHits,
  sideAnchor, pickSides, sideFacing, connectorBetween, connectorToPoint, bezierPoint, connectorPath,
  magnetTarget, computeSnap, normalizeHex, readableOn,
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

describe('wheel input', () => {
  it('normalises line and page deltas to pixels', () => {
    expect(normalizeWheel({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toEqual({ x: 0, y: 48 })
    expect(normalizeWheel({ deltaX: 1, deltaY: 0, deltaMode: 2 })).toEqual({ x: 800, y: 0 })
    expect(normalizeWheel({ deltaX: 2.5, deltaY: -4, deltaMode: 0 })).toEqual({ x: 2.5, y: -4 })
  })

  it('pinch and ctrl/cmd+wheel always zoom', () => {
    expect(wheelIntent({ deltaX: 0, deltaY: 1.3, deltaMode: 0, ctrlKey: true })).toBe('zoom')
    expect(wheelIntent({ deltaX: 3, deltaY: 1, deltaMode: 0, metaKey: true }, true)).toBe('zoom')
  })

  it('a mouse wheel notch zooms, a trackpad scroll pans', () => {
    expect(wheelIntent({ deltaX: 0, deltaY: 100, deltaMode: 0 })).toBe('zoom')
    expect(wheelIntent({ deltaX: 0, deltaY: -120, deltaMode: 0 })).toBe('zoom')
    expect(wheelIntent({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toBe('zoom')
    expect(wheelIntent({ deltaX: 0, deltaY: 4.5, deltaMode: 0 })).toBe('pan')
    expect(wheelIntent({ deltaX: 6, deltaY: 100, deltaMode: 0 })).toBe('pan')
    expect(wheelIntent({ deltaX: 0, deltaY: 12, deltaMode: 0 })).toBe('pan')
  })

  it('a trackpad stream stays a pan through its momentum tail', () => {
    expect(wheelIntent({ deltaX: 0, deltaY: 100, deltaMode: 0 }, true)).toBe('pan')
  })

  it('zoom factor is symmetric and capped', () => {
    expect(wheelZoomFactor(40) * wheelZoomFactor(-40)).toBeCloseTo(1, 12)
    expect(wheelZoomFactor(100)).toBeLessThan(1)
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1)
    expect(wheelZoomFactor(10000)).toBe(wheelZoomFactor(120))
    // Many small pinch steps ≈ one large step of the same total
    let f = 1
    for (let i = 0; i < 10; i++) f *= wheelZoomFactor(2, true)
    expect(f).toBeCloseTo(wheelZoomFactor(20, true), 12)
  })

  it('panBy moves the content opposite to the scroll delta', () => {
    expect(panBy(vp(10, 20, 2), 5, -8)).toEqual({ zoom: 2, panX: 5, panY: 28 })
  })

  it('grid spacing never gets denser than the minimum', () => {
    expect(gridSpacing(1)).toBe(24)
    expect(gridSpacing(2)).toBe(48)
    for (const z of [0.1, 0.2, 0.33, 0.5]) {
      const s = gridSpacing(z)
      expect(s).toBeGreaterThanOrEqual(12)
      expect(s).toBeLessThan(24 * 2)
    }
  })
})

describe('rect helpers', () => {
  const a = { x: 0, y: 0, w: 100, h: 60 }

  it('rectCenter', () => {
    expect(rectCenter(a)).toEqual({ x: 50, y: 30 })
  })

  it('boundsOf spans all rects', () => {
    expect(boundsOf([a, { x: -20, y: 100, w: 10, h: 10 }])).toEqual({ x: -20, y: 0, w: 120, h: 110 })
    expect(boundsOf([])).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })

  it('rectFromPoints normalises any drag direction', () => {
    expect(rectFromPoints({ x: 50, y: 10 }, { x: 10, y: 40 })).toEqual({ x: 10, y: 10, w: 40, h: 30 })
  })

  it('rectsIntersect ignores edge contact', () => {
    expect(rectsIntersect(a, { x: 50, y: 50, w: 100, h: 100 })).toBe(true)
    expect(rectsIntersect(a, { x: 100, y: 0, w: 10, h: 10 })).toBe(false)
  })

  it('distanceToRect is zero inside and euclidean outside', () => {
    expect(distanceToRect(a, { x: 10, y: 10 })).toBe(0)
    expect(distanceToRect(a, { x: 103, y: 64 })).toBe(5)
    expect(distanceToRect(a, { x: -7, y: 30 })).toBe(7)
  })

  it('marqueeHits returns every touched item', () => {
    const items = [
      { id: 'a', x: 0, y: 0, w: 50, h: 50 },
      { id: 'b', x: 200, y: 200, w: 50, h: 50 },
      { id: 'c', x: 40, y: 40, w: 50, h: 50 },
    ]
    expect(marqueeHits({ x: 30, y: 30, w: 20, h: 20 }, items)).toEqual(['a', 'c'])
    expect(marqueeHits({ x: 500, y: 500, w: 5, h: 5 }, items)).toEqual([])
  })
})

describe('connectors', () => {
  const a = { x: 0, y: 0, w: 100, h: 60 }

  it('picks facing sides on the axis with the larger gap', () => {
    expect(pickSides(a, { x: 300, y: 0, w: 100, h: 60 })).toEqual(['right', 'left'])
    expect(pickSides(a, { x: -300, y: 10, w: 100, h: 60 })).toEqual(['left', 'right'])
    expect(pickSides(a, { x: 0, y: 200, w: 100, h: 60 })).toEqual(['bottom', 'top'])
    expect(pickSides(a, { x: 20, y: -200, w: 100, h: 60 })).toEqual(['top', 'bottom'])
    // Diagonal, but further apart vertically than horizontally
    expect(pickSides(a, { x: 150, y: 400, w: 100, h: 60 })).toEqual(['bottom', 'top'])
  })

  it('overlapping rects still get a sensible pair of sides', () => {
    expect(pickSides(a, { x: 60, y: 5, w: 100, h: 60 })).toEqual(['right', 'left'])
    expect(pickSides(a, { x: 5, y: 40, w: 100, h: 60 })).toEqual(['bottom', 'top'])
  })

  it('anchors sit on the side midpoints', () => {
    expect(sideAnchor(a, 'top')).toEqual({ x: 50, y: 0 })
    expect(sideAnchor(a, 'right')).toEqual({ x: 100, y: 30 })
    expect(sideAnchor(a, 'bottom')).toEqual({ x: 50, y: 60 })
    expect(sideAnchor(a, 'left')).toEqual({ x: 0, y: 30 })
  })

  it('re-routes when the target moves — ends always stay on the live rects', () => {
    const b = { x: 300, y: 0, w: 100, h: 60 }
    const c1 = connectorBetween(a, b)
    expect(c1.start).toEqual({ x: 100, y: 30 })
    expect(c1.end).toEqual({ x: 300, y: 30 })

    const b2 = { ...b, x: 0, y: 300 }
    const c2 = connectorBetween(a, b2)
    expect(c2.startSide).toBe('bottom')
    expect(c2.endSide).toBe('top')
    expect(c2.start).toEqual({ x: 50, y: 60 })
    expect(c2.end).toEqual({ x: 50, y: 300 })
  })

  it('control points leave each rect along the side normal', () => {
    const c = connectorBetween(a, { x: 300, y: 200, w: 100, h: 60 })
    expect(c.startSide).toBe('right')
    expect(c.c1.y).toBe(c.start.y)
    expect(c.c1.x).toBeGreaterThan(c.start.x)
    expect(c.c2.y).toBe(c.end.y)
    expect(c.c2.x).toBeLessThan(c.end.x)
  })

  it('bezier endpoints match start/end and path data is well-formed', () => {
    const c = connectorBetween(a, { x: 300, y: 50, w: 80, h: 80 })
    expect(bezierPoint(c, 0)).toEqual(c.start)
    const e = bezierPoint(c, 1)
    expect(e.x).toBeCloseTo(c.end.x, 9)
    expect(e.y).toBeCloseTo(c.end.y, 9)
    expect(connectorPath(c)).toMatch(/^M-?[\d.]+,-?[\d.]+ C(-?[\d.]+,-?[\d.]+ ){2}-?[\d.]+,-?[\d.]+$/)
  })

  it('a dragged-out connector leaves from the side facing the cursor', () => {
    expect(sideFacing(a, { x: 500, y: 30 })).toBe('right')
    expect(sideFacing(a, { x: 50, y: -400 })).toBe('top')
    const c = connectorToPoint(a, { x: 50, y: 400 })
    expect(c.start).toEqual({ x: 50, y: 60 })
    expect(c.end).toEqual({ x: 50, y: 400 })
    expect(c.endSide).toBeNull()
  })

  it('magnetTarget prefers containment, then proximity, and honours exclusion', () => {
    const items = [
      { id: 'low', x: 0, y: 0, w: 100, h: 100, z: 1 },
      { id: 'high', x: 50, y: 50, w: 100, h: 100, z: 5 },
      { id: 'far', x: 400, y: 0, w: 100, h: 100, z: 9 },
    ]
    expect(magnetTarget({ x: 75, y: 75 }, items, 20)?.id).toBe('high')
    expect(magnetTarget({ x: 10, y: 10 }, items, 20)?.id).toBe('low')
    expect(magnetTarget({ x: 390, y: 50 }, items, 20)?.id).toBe('far')
    expect(magnetTarget({ x: 300, y: 50 }, items, 20)).toBeNull()
    expect(magnetTarget({ x: 75, y: 75 }, items, 20, 'high')?.id).toBe('low')
  })
})

describe('computeSnap', () => {
  const others = [{ x: 0, y: 0, w: 100, h: 100 }]

  it('snaps left edges together and reports a vertical guide', () => {
    const s = computeSnap({ x: 4, y: 300, w: 50, h: 50 }, others, 8)
    expect(s.dx).toBe(-4)
    expect(s.dy).toBe(0)
    expect(s.guides).toEqual([{ axis: 'x', x: 0, y1: 0, y2: 350 }])
  })

  it('snaps centres and both axes at once', () => {
    const s = computeSnap({ x: 23, y: 27, w: 50, h: 50 }, others, 8)
    // centre x 48 → 50, centre y 52 → 50
    expect(s.dx).toBe(2)
    expect(s.dy).toBe(-2)
    expect(s.guides.map(g => g.axis).sort()).toEqual(['x', 'y'])
  })

  it('does nothing outside the threshold', () => {
    expect(computeSnap({ x: 130, y: 330, w: 50, h: 50 }, others, 8)).toEqual({ dx: 0, dy: 0, guides: [] })
  })
})

describe('colour helpers', () => {
  it('normalizeHex accepts 3/6 digit hex with or without #', () => {
    expect(normalizeHex('#abc')).toBe('#AABBCC')
    expect(normalizeHex('4f46e5')).toBe('#4F46E5')
    expect(normalizeHex(' #FFF8C5 ')).toBe('#FFF8C5')
    expect(normalizeHex('blue')).toBeNull()
    expect(normalizeHex('')).toBeNull()
    expect(normalizeHex(null)).toBeNull()
  })

  it('readableOn picks dark text on light colours and white on dark', () => {
    expect(readableOn('#FFFFFF')).toBe('#1A1D23')
    expect(readableOn('#FFF8C5')).toBe('#1A1D23')
    expect(readableOn('#000000')).toBe('#FFFFFF')
    expect(readableOn('#4F46E5')).toBe('#FFFFFF')
  })
})
