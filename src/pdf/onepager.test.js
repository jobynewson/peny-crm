import { describe, it, expect } from 'vitest'
import { DEFAULT_EMAIL, FLAGS, LIMITS, blankDocument, blocksFromEditor, blocksToEditor, buildModel, groupBlocks, inline, pageHtml } from './onepager.js'
import { FLAGS as API_FLAGS, LIMITS as API_LIMITS, cleanDocument } from '../../api/_pdf-documents.js'

describe('limits', () => {
  it('match the API', () => { const { bytes, ...rest } = API_LIMITS; expect(LIMITS).toEqual(rest); expect(FLAGS).toEqual(API_FLAGS) })
})

describe('inline formatting', () => {
  it('makes **bold** and *italic* and nothing else', () => {
    expect(inline('a **b** c *d* e')).toBe('a <strong>b</strong> c <em>d</em> e')
    expect(inline('**<script>**')).toBe('<strong>&lt;script&gt;</strong>')
    expect(inline('2 * 3 * 4')).toBe('2 * 3 * 4')
    expect(inline('stars ** alone')).toBe('stars ** alone')
  })
  it('leaves line breaks for the stylesheet to keep', () => expect(inline('one\ntwo')).toBe('one\ntwo'))
})

describe('editor <-> saved blocks', () => {
  const saved = [
    { type: 'heading', text: 'Rates' },
    { type: 'bullets', items: ['one', 'two'] },
    { type: 'table', rows: [['Camera', '£500'], ['Sound', '£200']] },
  ]
  it('round-trips', () => expect(blocksFromEditor(blocksToEditor(saved))).toEqual(saved))
  it('drops empty list items and rows, and a row with no bar has an empty value', () => {
    expect(blocksFromEditor([{ type: 'bullets', text: 'a\n\n  \nb' }])).toEqual([{ type: 'bullets', items: ['a', 'b'] }])
    expect(blocksFromEditor([{ type: 'table', text: 'Only label\n\nA | B | C' }])).toEqual([{ type: 'table', rows: [['Only label', ''], ['A', 'B | C']] }])
  })
  it('a blank document passes the API check once it has a title', () => {
    const b = blankDocument()
    const { value } = cleanDocument({ ...b, title: 'x', content: { ...b.content, blocks: blocksFromEditor(blocksToEditor(b.content.blocks)) } })
    expect(value).toBeTruthy()
  })
})

describe('groupBlocks', () => {
  it('starts a group at each heading and skips empty blocks', () => {
    const g = groupBlocks([
      { type: 'text', text: 'intro' }, { type: 'heading', text: 'A' }, { type: 'text', text: 'a1' }, { type: 'text', text: '  ' },
      { type: 'bullets', items: ['x'] }, { type: 'heading', text: 'B' }, { type: 'text', text: 'b1' },
    ])
    expect(g.map(x => x.length)).toEqual([1, 3, 2])
    expect(g[1][0]).toContain('<h2')
  })
})

describe('buildModel and pageHtml', () => {
  const doc = { title: 'A <b>title</b>', theme: 'light', content: { label: 'Proposal', subtitle: 'Sub', date: '6 October 2026', preparedBy: '', emails: '', blocks: [{ type: 'heading', text: 'H' }] } }
  const settings = { address: '1 <i>Lane</i>\nBristol', website: 'x.co', vat_number: 'GB1' }

  it('prepared by and emails are only what the document says, not Settings', () => {
    expect(buildModel(doc, { ...settings, prepared_by: 'Studio' })).toMatchObject({ preparedBy: '', emails: [] })
    const own = buildModel({ ...doc, content: { ...doc.content, preparedBy: 'Sam', emails: 'a@x.co, b@x.co;c@x.co' } }, settings)
    expect(own).toMatchObject({ preparedBy: 'Sam', emails: ['a@x.co', 'b@x.co', 'c@x.co'] })
  })
  it('a new document is blank for prepared by and has hello@wearepeny.com as the email', () => {
    expect(blankDocument().content).toMatchObject({ preparedBy: '', emails: DEFAULT_EMAIL, scale: 100 })
    expect(DEFAULT_EMAIL).toBe('hello@wearepeny.com')
  })
  it('scale is put on the page as a multiplier, and kept within bounds', () => {
    expect(pageHtml(buildModel({ ...doc, content: { ...doc.content, scale: 85 } }), { first: true, last: true })).toContain('--pdf-s:0.85')
    expect(buildModel({ ...doc, content: { ...doc.content, scale: 5 } }).scale).toBe(LIMITS.scaleMin)
    expect(buildModel({ ...doc, content: { ...doc.content, scale: 900 } }).scale).toBe(LIMITS.scaleMax)
    expect(buildModel(doc).scale).toBe(100)
  })
  it('condensing the page condenses the header and footer too', () => {
    expect(buildModel({ ...doc, content: { ...doc.content, condensedPage: true } })).toMatchObject({ tight: true, headerCondensed: true, footerCondensed: true })
    expect(buildModel({ ...doc, content: { ...doc.content, condensedHeader: true } })).toMatchObject({ tight: false, headerCondensed: true, footerCondensed: false })
  })
  it('escapes everything the user typed', () => {
    const html = pageHtml(buildModel(doc, settings), { first: true, last: true })
    expect(html).not.toContain('<b>title')
    expect(html).not.toContain('<i>Lane')
    expect(html).toContain('A &lt;b&gt;title&lt;/b&gt;')
    expect(html).toContain('1 &lt;i&gt;Lane&lt;/i&gt;, Bristol')
  })
  it('uses the black logo on light and the white one on dark', () => {
    expect(pageHtml(buildModel(doc), { first: true, last: true })).toContain('/peny-logo.png')
    expect(pageHtml(buildModel({ ...doc, theme: 'dark' }), { first: true, last: true })).toContain('/peny-logo-white.png')
  })
  it('shows the studio footer only on the last page, and page numbers only with several', () => {
    const m = buildModel({ ...doc, content: { ...doc.content, preparedBy: 'Joby' } }, settings)
    const one = pageHtml(m, { first: true, last: true, num: 1, total: 1 })
    expect(one).toContain('VAT: GB1'); expect(one).toContain('Prepared by Joby'); expect(one).not.toContain('Page 1')
    const first = pageHtml(m, { first: true, last: false, num: 1, total: 2 })
    expect(first).toContain('Page 1 of 2'); expect(first).not.toContain('VAT: GB1')
    const last = pageHtml(m, { first: false, last: true, num: 2, total: 2 })
    expect(last).toContain('Page 2 of 2'); expect(last).toContain('VAT: GB1'); expect(last).toContain('pdf-one-run')
  })
})
