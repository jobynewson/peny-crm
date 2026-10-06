import { describe, it, expect } from 'vitest'
import { LIMITS, blankDocument, blocksFromEditor, blocksToEditor, renderOnePager } from './onepager.js'
import { LIMITS as API_LIMITS, cleanDocument } from '../../api/_pdf-documents.js'

describe('limits', () => {
  it('match the API', () => { const { bytes, ...rest } = API_LIMITS; expect(LIMITS).toEqual(rest) })
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

describe('renderOnePager', () => {
  const doc = { title: 'A <b>title</b>', theme: 'light', content: { label: 'Proposal', subtitle: 'Sub', date: '6 October 2026', blocks: [
    { type: 'heading', text: 'H' }, { type: 'text', text: 'Body & more' }, { type: 'bullets', items: ['x'] }, { type: 'table', rows: [['k', 'v']] }, { type: 'text', text: '  ' },
  ] } }
  it('escapes everything the user typed', () => {
    const html = renderOnePager(doc, { address: '1 <script>', email: 'a@b.c' })
    expect(html).not.toContain('<b>title')
    expect(html).not.toContain('<script>')
    expect(html).toContain('A &lt;b&gt;title&lt;/b&gt;')
    expect(html).toContain('Body &amp; more')
  })
  it('uses the black logo on light and the white one on dark', () => {
    expect(renderOnePager(doc)).toContain('/peny-logo.png')
    expect(renderOnePager({ ...doc, theme: 'dark' })).toContain('/peny-logo-white.png')
    expect(renderOnePager({ ...doc, theme: 'dark' })).toContain('pdf-one-dark')
  })
  it('draws the settings footer and skips empty blocks', () => {
    const html = renderOnePager(doc, { vat_number: 'GB1', prepared_by: 'Joby' })
    expect(html).toContain('VAT: GB1')
    expect(html).toContain('Prepared by Joby')
    expect(html.match(/pdf-one-p"/g)).toHaveLength(1)
  })
})
