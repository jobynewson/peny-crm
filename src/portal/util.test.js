import { describe, it, expect } from 'vitest'
import { linkify } from './util.js'

describe('linkify', () => {
  it('makes http(s) links clickable and leaves the rest as text', () => {
    expect(linkify('See https://x.test/brief for it')).toBe('See <a href="https://x.test/brief" target="_blank" rel="noopener noreferrer">https://x.test/brief</a> for it')
  })
  it('keeps trailing punctuation outside the link', () => {
    expect(linkify('Brief: https://x.test/a.')).toContain('>https://x.test/a</a>.')
    expect(linkify('(https://x.test/a)')).toContain('>https://x.test/a</a>)')
  })
  it('escapes everything else, so a client cannot inject markup', () => {
    const out = linkify('<script>alert(1)</script> "hi" https://x.test/?a=1&b=2')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
    expect(out).toContain('href="https://x.test/?a=1&amp;b=2"')
  })
  it('never links javascript: or other schemes', () => {
    expect(linkify('javascript:alert(1) ftp://x.test data:text/html,hi')).not.toContain('<a')
  })
  it('a quote in a URL cannot break out of the attribute', () => {
    expect(linkify('https://x.test/"onmouseover="alert(1)')).not.toMatch(/href="[^"]*"onmouseover/)
  })
})
