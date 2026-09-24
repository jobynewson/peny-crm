import { describe, it, expect } from 'vitest'
import { tabKey, orderTabs, moveTab, insertIndex, pickActive } from './planning-tabs.js'

const b = (id, t) => ({ id, name: `B${id}`, created_at: `2026-01-0${t}T00:00:00Z` })
const c = (id, t) => ({ id, name: `C${id}`, created_at: `2026-01-0${t}T00:00:00Z` })

describe('orderTabs', () => {
  it('mixes boards and canvases oldest-first when nothing is saved', () => {
    const tabs = orderTabs([b('1', 3), b('2', 1)], [c('9', 2)], [])
    expect(tabs.map(t => t.key)).toEqual(['board:2', 'canvas:9', 'board:1'])
    expect(tabs[1]).toMatchObject({ kind: 'canvas', id: '9', name: 'C9' })
  })

  it('honours the saved order, drops stale keys and appends new tabs', () => {
    const tabs = orderTabs([b('1', 1), b('2', 2)], [c('9', 3), c('8', 4)], ['canvas:9', 'board:gone', 'board:2', 'canvas:9'])
    expect(tabs.map(t => t.key)).toEqual(['canvas:9', 'board:2', 'board:1', 'canvas:8'])
  })

  it('tolerates a missing/garbage order', () => {
    expect(orderTabs([b('1', 1)], [], null).map(t => t.key)).toEqual(['board:1'])
    expect(orderTabs([], [], 'x')).toEqual([])
  })
})

describe('moveTab', () => {
  const keys = ['a', 'b', 'c', 'd']
  it('moves forward and backward', () => {
    expect(moveTab(keys, 'a', 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveTab(keys, 'd', 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveTab(keys, 'b', 1)).toEqual(keys)
  })
  it('clamps the index and ignores unknown keys', () => {
    expect(moveTab(keys, 'a', 99)).toEqual(['b', 'c', 'd', 'a'])
    expect(moveTab(keys, 'a', -5)).toEqual(keys)
    expect(moveTab(keys, 'zz', 1)).toEqual(keys)
  })
})

describe('insertIndex', () => {
  const boxes = [{ left: 0, width: 100 }, { left: 100, width: 60 }, { left: 160, width: 100 }]
  it('inserts before the first tab whose midpoint is right of the pointer', () => {
    expect(insertIndex(-10, boxes)).toBe(0)
    expect(insertIndex(49, boxes)).toBe(0)
    expect(insertIndex(51, boxes)).toBe(1)
    expect(insertIndex(131, boxes)).toBe(2)
    expect(insertIndex(500, boxes)).toBe(3)
    expect(insertIndex(5, [])).toBe(0)
  })
})

describe('pickActive', () => {
  const tabs = [{ key: tabKey('board', '1') }, { key: 'canvas:2' }]
  it('keeps a remembered tab that still exists, else falls back to the first', () => {
    expect(pickActive(tabs, 'canvas:2')).toBe('canvas:2')
    expect(pickActive(tabs, 'canvas:deleted')).toBe('board:1')
    expect(pickActive([], 'x')).toBeNull()
  })
})
