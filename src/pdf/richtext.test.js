import { describe, it, expect } from 'vitest'
import { htmlToMarkup, markupToHtml } from './richtext.js'
import { inline } from './onepager.js'

// Plain objects stand in for DOM nodes: htmlToMarkup only reads these fields.
const t = data => ({ nodeType: 3, data })
const el = (nodeName, ...childNodes) => ({ nodeType: 1, nodeName, childNodes, style: {} })
const styled = (style, ...childNodes) => ({ nodeType: 1, nodeName: 'SPAN', childNodes, style })
const box = (...childNodes) => el('DIV', ...childNodes)
const br = () => el('BR')

describe('htmlToMarkup', () => {
  it('plain text and line breaks', () => {
    expect(htmlToMarkup(box(t('one'), br(), t('two')))).toBe('one\ntwo')
    expect(htmlToMarkup(box())).toBe('')
  })
  it('drops the placeholder break at the end, keeps a real blank line', () => {
    expect(htmlToMarkup(box(t('a'), br(), br()))).toBe('a\n')
    expect(htmlToMarkup(box(t('a'), br(), br(), t('b')))).toBe('a\n\nb')
  })
  it('bold and italic, from tags or styles', () => {
    expect(htmlToMarkup(box(t('a '), el('B', t('bold')), t(' b')))).toBe('a **bold** b')
    expect(htmlToMarkup(box(el('STRONG', t('x'))))).toBe('**x**')
    expect(htmlToMarkup(box(t('a '), el('I', t('it')), t(' b')))).toBe('a _it_ b')
    expect(htmlToMarkup(box(styled({ fontWeight: '700' }, t('x'))))).toBe('**x**')
    expect(htmlToMarkup(box(styled({ fontStyle: 'italic' }, t('x'))))).toBe('_x_')
  })
  it('bold and italic together, either way round', () => {
    expect(htmlToMarkup(box(el('B', el('I', t('x')))))).toBe('**_x_**')
    expect(htmlToMarkup(box(el('I', el('B', t('x')))))).toBe('**_x_**')
  })
  it('partly overlapping styles become separate pieces', () => {
    expect(htmlToMarkup(box(el('B', t('a '), el('I', t('b'))), el('I', t(' c'))))).toBe('**a** **_b_** _c_')
  })
  it('keeps spaces outside the marks', () => {
    expect(htmlToMarkup(box(el('B', t(' word '))))).toBe(' **word** ')
    expect(htmlToMarkup(box(el('B', t('  '))))).toBe('  ')
  })
  it('italic inside a word uses * so it still reads back', () => {
    expect(htmlToMarkup(box(t('it'), el('I', t('al')), t('ic')))).toBe('it*al*ic')
    expect(htmlToMarkup(box(el('I', t('it')), t('alic')))).toBe('*it*alic')
  })
  it('escapes a typed * _ or backslash, and turns non-breaking spaces into spaces', () => {
    expect(htmlToMarkup(box(t('5 * 3_x\\y')))).toBe('5 \\* 3\\_x\\\\y')
    expect(htmlToMarkup(box(t('a  b')))).toBe('a  b')
  })
  it('a block element (Enter in some browsers) is a new line', () => {
    expect(htmlToMarkup(box(t('a'), el('DIV', t('b')), el('DIV', t('c'))))).toBe('a\nb\nc')
  })
})

describe('markup <-> html', () => {
  const cases = [
    'plain', 'a **bold** and _italic_ text', '**_both_**', 'line one\nline two', '**a**_b_', 'it*al*ic', '5 \\* 3 and \\_x\\_ and a\\\\b', '',
  ]
  it('markupToHtml only ever produces strong, em, br and escaped text', () => {
    for (const m of cases) {
      const html = markupToHtml(m)
      expect(html.replace(/<\/?(strong|em)>|<br>/g, '')).not.toMatch(/[<>]/)
    }
    expect(markupToHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;')
  })
  it('a line break becomes <br>', () => expect(markupToHtml('a\nb')).toBe('a<br>b'))
  it('is the same html the page prints, apart from line breaks', () => {
    for (const m of cases) expect(markupToHtml(m).replace(/<br>/g, '\n')).toBe(inline(m))
  })
})
