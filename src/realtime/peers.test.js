import { describe, it, expect, vi } from 'vitest'
import { peerColor, PEER_COLORS, initials, firstName, distinctPeers, throttle } from './peers.js'

describe('peerColor', () => {
  it('is stable per person and from the palette', () => {
    expect(peerColor('user_abc')).toBe(peerColor('user_abc'))
    expect(PEER_COLORS).toContain(peerColor('user_abc'))
    const spread = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(peerColor))
    expect(spread.size).toBeGreaterThan(3)
  })
})

describe('initials / firstName', () => {
  it('handles names, single words, emails and blanks', () => {
    expect(initials('Joby Newson')).toBe('JN')
    expect(initials('Ada Mary Lovelace')).toBe('AL')
    expect(initials('madonna')).toBe('MA')
    expect(initials('sam.jones@peny.com')).toBe('SJ')
    expect(initials('')).toBe('?')
    expect(firstName('Joby Newson')).toBe('Joby')
    expect(firstName('')).toBe('Someone')
  })
})

describe('distinctPeers', () => {
  it('drops yourself, merges one person\'s tabs, prefers the active one', () => {
    const peers = distinctPeers([
      { clientId: 'me', connectionId: '1', data: { name: 'Me' } },
      { clientId: 'b', connectionId: '2', data: { name: 'Bea' } },
      { clientId: 'b', connectionId: '3', data: { name: 'Bea', edit: 'card1' } },
      { clientId: 'a', connectionId: '4', data: { name: 'Al' } },
    ], 'me')
    expect(peers.map(p => p.connectionId)).toEqual(['4', '3'])
  })
})

describe('throttle', () => {
  it('runs the first call now and the last call of a burst later', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const t = throttle(fn, 100)
    t(1); t(2); t(3)
    expect(fn.mock.calls).toEqual([[1]])
    vi.advanceTimersByTime(100)
    expect(fn.mock.calls).toEqual([[1], [3]])
    vi.advanceTimersByTime(500)
    t(4)
    expect(fn.mock.calls).toEqual([[1], [3], [4]])
    t(5); t.cancel(); vi.advanceTimersByTime(200)
    expect(fn.mock.calls.length).toBe(3)
    vi.useRealTimers()
  })
})
