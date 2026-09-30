import { describe, it, expect, beforeEach } from 'vitest'
import { WINDOW_DAYS, readWindow, saveWindow, windowToggleHtml } from './window-days.js'
import { WINDOW_DAYS as SERVER, parseWindowDays } from '../../api/_retainer-rules.js'

describe('window days', () => {
  beforeEach(() => { globalThis.localStorage = (() => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) } })() })
  it('matches the server list', () => { expect(WINDOW_DAYS).toEqual(SERVER) })
  it('remembers a choice per key and ignores junk', () => {
    expect(readWindow('a', 14)).toBe(14)
    saveWindow('a', 60)
    expect(readWindow('a', 14)).toBe(60)
    expect(readWindow('b', 30)).toBe(30)
    localStorage.setItem('c', '9')
    expect(readWindow('c', 7)).toBe(7)
  })
  it('presses exactly the current one', () => {
    const html = windowToggleHtml(30, 'w')
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html).toContain('data-w="30" aria-pressed="true"')
  })
  it('the server takes only the four', () => {
    expect(parseWindowDays('7', 30)).toBe(7)
    expect(parseWindowDays('8', 30)).toBe(30)
    expect(parseWindowDays(undefined, 30)).toBe(30)
  })
})
