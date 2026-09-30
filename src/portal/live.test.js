import { describe, it, expect, vi } from 'vitest'
import { isBusy, snapshotUi, restoreUi, startLive } from './live.js'

// A root stand-in: which selectors match, and its textareas.
const root = ({ open = [], textareas = [], active = null, cols = {} } = {}) => ({
  contains: el => el === active,
  querySelector: sel => (open.some(o => sel.includes(o)) ? {} : (sel.startsWith('#') ? cols[sel.slice(1)] ?? null : null)),
  querySelectorAll: sel => (sel === 'textarea' ? textareas : sel === 'details' ? (root._details ?? []) : []),
})

describe('when the portal may redraw', () => {
  it('not while someone is typing in a field', () => {
    const field = { tagName: 'TEXTAREA' }
    expect(isBusy(root({ active: field }), field)).toBe(true)
    expect(isBusy(root({ active: field }), { tagName: 'BUTTON' })).toBe(false)
  })
  it('not while a form or a confirm is open, or a box has something in it', () => {
    expect(isBusy(root({ open: ['[data-request-form]'] }), null)).toBe(true)
    expect(isBusy(root({ open: ['[data-confirm]'] }), null)).toBe(true)
    expect(isBusy(root({ open: ['.pt-changes'] }), null)).toBe(true)
    expect(isBusy(root({ textareas: [{ value: '  ' }, { value: 'half a sentence' }] }), null)).toBe(true)
  })
  it('otherwise yes', () => {
    expect(isBusy(root({ textareas: [{ value: '' }] }), null)).toBe(false)
  })
})

describe('keeping your place across a redraw', () => {
  it('puts back the scroll, the folds and the left column\'s scroll', () => {
    const before = [{ open: true }, { open: false }]
    const col = { scrollTop: 240 }
    const r = { ...root({ cols: { 'pt-col-requests': col } }), querySelectorAll: sel => (sel === 'details' ? before : []) }
    const snap = snapshotUi(r, { scrollY: 500 })
    expect(snap).toEqual({ scrollY: 500, open: [true, false], columns: { 'pt-col-requests': 240 } })
    const after = [{ open: false }, { open: true }]
    const fresh = { scrollTop: 0 }
    const scrollTo = vi.fn()
    restoreUi({ ...root({ cols: { 'pt-col-requests': fresh } }), querySelectorAll: sel => (sel === 'details' ? after : []) }, snap, { scrollTo })
    expect(after.map(d => d.open)).toEqual([true, false])
    expect(fresh.scrollTop).toBe(240)
    expect(scrollTo).toHaveBeenCalledWith(0, 500)
  })
  it('leaves the folds alone when the page has a different number of them', () => {
    const after = [{ open: false }]
    restoreUi({ ...root(), querySelectorAll: sel => (sel === 'details' ? after : []) }, { scrollY: 0, open: [true, true], columns: {} }, { scrollTo() {} })
    expect(after[0].open).toBe(false)
  })
})

describe('the refresh loop', () => {
  const doc = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  const setup = (views, r = root()) => {
    let i = 0
    const apply = vi.fn()
    const live = startLive({ root: r, fetchView: async () => views[Math.min(i++, views.length - 1)], apply, interval: 1e9, doc, win: { scrollY: 0, scrollTo() {} } })
    return { live, apply }
  }
  it('redraws when something changed, and not when nothing did', async () => {
    const { live, apply } = setup([{ n: 1 }, { n: 2 }])
    live.seen({ n: 1 })
    await live.tick()
    expect(apply).not.toHaveBeenCalled()
    await live.tick()
    expect(apply).toHaveBeenCalledWith({ n: 2 })
    live.stop()
  })
  it('does not redraw over someone who is busy, nor while the page is hidden', async () => {
    const busy = setup([{ n: 2 }], root({ open: ['[data-request-form]'] }))
    busy.live.seen({ n: 1 })
    await busy.live.tick()
    expect(busy.apply).not.toHaveBeenCalled()
    busy.live.stop()
    const hiddenDoc = { ...doc, visibilityState: 'hidden' }
    const apply = vi.fn()
    const live = startLive({ root: root(), fetchView: async () => ({ n: 2 }), apply, interval: 1e9, doc: hiddenDoc, win: {} })
    live.seen({ n: 1 })
    await live.tick()
    expect(apply).not.toHaveBeenCalled()
    live.stop()
  })
  it('survives a failed fetch, and a redraw made by the page itself counts as seen', async () => {
    const apply = vi.fn()
    let fail = true
    const live = startLive({ root: root(), fetchView: async () => { if (fail) throw new Error('offline'); return { n: 5 } }, apply, interval: 1e9, doc, win: {} })
    live.seen({ n: 1 })
    await live.tick()
    expect(apply).not.toHaveBeenCalled()
    fail = false
    live.seen({ n: 5 })          // the page drew n: 5 itself (e.g. after an answer)
    await live.tick()
    expect(apply).not.toHaveBeenCalled()
    live.stop()
  })
})
