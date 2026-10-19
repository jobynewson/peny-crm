import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { audienceFor, shownTo, clientChip, clientCaption } from './client-facing.js'

describe('client-facing cue', () => {
  it('works out who sees it', () => {
    expect(audienceFor({})).toBeNull()
    expect(audienceFor({ companies: ['Acme', 'Acme', null] })).toBe('Acme')
    expect(audienceFor({ hasLink: true })).toBe('anyone with the client link')
    expect(audienceFor({ companies: ['Acme', 'Beta'], hasLink: true })).toBe('Acme, Beta and anyone with the client link')
  })

  it('names the company, or says "the client"', () => {
    expect(shownTo('Acme')).toBe('Shown to Acme')
    expect(shownTo(null)).toBe('Shown to the client')
  })

  it('draws an accessible chip and escapes the name', () => {
    const html = clientChip({ to: 'A <b>&co' })
    expect(html).toContain('aria-label="Shown to A &lt;b&gt;&amp;co"')
    expect(html).toContain('Client')
    expect(clientChip({ to: 'x', word: false })).not.toContain('cf-word')
  })

  it('captions a field', () => {
    expect(clientCaption('Client reads this')).toContain('Client reads this')
  })
})

// Every screen that puts words in front of a client keeps the cue. Adding a new
// client-facing screen means adding it here (and using the helper).
describe('surfaces keep the cue', () => {
  const dir = path.dirname(new URL(import.meta.url).pathname)
  for (const f of ['worklist', 'projects', 'boards', 'canvas', 'request-cards', 'contacts']) {
    it(`${f}.js uses client-facing.js`, () => {
      expect(fs.readFileSync(path.join(dir, `${f}.js`), 'utf8')).toContain("./client-facing.js")
    })
  }
})
