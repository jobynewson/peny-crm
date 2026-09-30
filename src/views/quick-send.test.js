import { describe, it, expect, vi } from 'vitest'
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }
vi.mock('../api/http.js', () => ({ request: async () => ({}) }))
const { readTarget, targetLine, quickSendHtml } = await import('./quick-send.js')

const targets = {
  deliverables: [
    { id: 'd2', title: 'Hero film', round: 2, workstream: 'Edits', workstream_id: 'w1' },
    { id: 'd1', title: 'Teaser <cut>', round: 0, workstream: 'Edits', workstream_id: 'w1' },
  ],
  workstreams: [{ id: 'w1', title: 'Edits' }, { id: 'w2', title: 'Social' }],
  default_workstream_id: 'w1',
}

describe('Quick send', () => {
  it('reads what was typed: an existing deliverable (next round), a new name, or nothing', () => {
    expect(readTarget(targets, '  hero   FILM ')).toMatchObject({ kind: 'existing', round: 3, deliverable: { id: 'd2' } })
    expect(readTarget(targets, 'Brand new')).toEqual({ kind: 'new', title: 'Brand new' })
    expect(readTarget(targets, '   ')).toEqual({ kind: 'empty' })
    expect(readTarget({ deliverables: [] }, 'x')).toMatchObject({ kind: 'new' })
  })
  it('says what pressing Send will do, and escapes the title', () => {
    expect(targetLine(readTarget(targets, 'Hero film'))).toBe('Sends round 3 of “Hero film”.')
    expect(targetLine(readTarget(targets, 'Teaser <cut>'))).toContain('&lt;cut&gt;')
    expect(targetLine(readTarget(targets, 'Brand new'))).toBe('Makes “Brand new” on the worklist and sends round 1.')
  })
  it('starts on the deliverable sent most recently, with the link field first and the workstream only as a choice', () => {
    const { html, first } = quickSendHtml(targets)
    expect(first.id).toBe('d2')
    expect(html).toContain('value="Hero film"')
    expect(html.indexOf('qs-url')).toBeLessThan(html.indexOf('qs-what'))
    expect(html).toContain('data-autofocus')
    expect(html).toMatch(/id="qs-ws-field" hidden/)
    expect(html).toContain('&lt;cut&gt;')
    expect(quickSendHtml({ deliverables: [], workstreams: [{ id: 'w1', title: 'Edits' }] }).html).not.toContain('qs-ws-field')
    expect(quickSendHtml({ deliverables: [], workstreams: [] }).first).toBeNull()
  })
})
