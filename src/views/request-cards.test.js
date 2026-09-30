import { describe, it, expect, vi } from 'vitest'
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }
vi.mock('../api/http.js', () => ({ request: async () => ({}) }))
const { requestCardHtml, requestRowHtml, linkify } = await import('./request-cards.js')

const r = over => ({
  id: 'q1', title: 'Cut-down', detail: null, company: 'DMM', source: 'login', source_label: 'Signed in', sent_by: 'Dana',
  wanted_by: '2026-10-30', wanted_by_display: 'Fri 30 Oct', project: null, ...over,
})

describe('a request card', () => {
  it('says what, who and by when, and carries Accept on the card itself', () => {
    const html = requestCardHtml(r())
    expect(html).toContain('Cut-down')
    expect(html).toContain('DMM · from Dana')
    expect(html).toContain('Wanted by Fri 30 Oct')
    expect(html).toContain('data-request-accept="q1"')
    expect(html).toContain('>Request<')
  })
  it('names the project the client chose, but not when it is just the company again', () => {
    expect(requestCardHtml(r({ project: 'Riverside shoot' }))).toContain('DMM · Riverside shoot · from Dana')
    expect(requestCardHtml(r({ project: 'DMM' }))).toContain('DMM · from Dana')
  })
  it('marks one sent through a project link, and says when no date was asked', () => {
    const link = requestCardHtml(r({ source: 'link', source_label: 'Sent via project link', wanted_by: null, wanted_by_display: null }))
    expect(link).toContain('Sent via project link')
    expect(link).toContain('No date asked')
    expect(requestCardHtml(r())).not.toContain('Sent via project link')
  })
  it('offers no Accept to someone who cannot edit, and escapes what a client typed', () => {
    expect(requestCardHtml(r(), { canEdit: false })).not.toContain('data-request-accept')
    const evil = requestCardHtml(r({ title: '<img src=x onerror=1>', sent_by: '<b>Sam</b>' }))
    expect(evil).not.toContain('<img')
    expect(evil).toContain('&lt;b&gt;Sam&lt;/b&gt;')
  })
  it('has a phone row with Accept right there', () => {
    const html = requestRowHtml(r({ source: 'link', source_label: 'Sent via project link' }))
    expect(html).toContain('data-request-accept="q1"')
    expect(html).toContain('Sent via project link')
    expect(requestRowHtml(r(), { canEdit: false })).not.toContain('data-request-accept')
  })
  it('makes links in the client\'s words clickable, safely', () => {
    expect(linkify('See https://x.test/brief.')).toContain('<a href="https://x.test/brief" target="_blank" rel="noopener noreferrer">https://x.test/brief</a>.')
    expect(linkify('<script>alert(1)</script>')).not.toContain('<script>')
  })
})
