// src/pdf/onepager.js
// The one-page document behind Tools › PDF Generator, as HTML. It is drawn in
// the quote PDF's look (the dark cover, or the light detail pages), with the
// Peny logo and the studio details from Settings, so a one-pager reads as part
// of the same set. Used for both the live preview and the print.
//
// The classes are the .pdf-one-* block in style.css, next to the quote's.

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Keep in step with LIMITS in api/_pdf-documents.js (api/_pdf-documents.test.js checks).
export const LIMITS = { title: 200, label: 60, subtitle: 300, date: 60, blocks: 60, text: 5000, items: 40, rows: 30, cell: 300 }

export const BLOCK_LABELS = { heading: 'Heading', text: 'Text', bullets: 'List', table: 'Table' }

export function todayLong(d = new Date()) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function blankDocument() {
  return { title: '', theme: 'dark', content: { label: '', subtitle: '', date: todayLong(), blocks: [{ type: 'text', text: '' }] } }
}

// Lists and tables are typed as lines in a textarea ("Label | Value" for a
// table); the editor holds them as that text and the saved shape is rebuilt on
// every change.
export function blocksToEditor(blocks) {
  return (blocks ?? []).map(b =>
    b.type === 'bullets' ? { type: 'bullets', text: b.items.join('\n') }
    : b.type === 'table' ? { type: 'table', text: b.rows.map(r => r.join(' | ')).join('\n') }
    : { type: b.type, text: b.text ?? '' })
}

const cell = s => s.trim().slice(0, LIMITS.cell)

export function blocksFromEditor(blocks) {
  return blocks.map(b => {
    if (b.type === 'bullets') return { type: 'bullets', items: b.text.split('\n').map(cell).filter(Boolean) }
    if (b.type === 'table') {
      const rows = b.text.split('\n').filter(l => l.trim()).map(l => {
        const i = l.indexOf('|')
        return i < 0 ? [cell(l), ''] : [cell(l.slice(0, i)), cell(l.slice(i + 1))]
      })
      return { type: 'table', rows }
    }
    return { type: b.type, text: b.text }
  })
}

function blockHtml(b) {
  if (b.type === 'heading') return b.text.trim() ? `<h2 class="pdf-one-h">${esc(b.text)}</h2>` : ''
  if (b.type === 'text') return b.text.trim() ? `<p class="pdf-one-p">${esc(b.text)}</p>` : ''
  if (b.type === 'bullets') return b.items.length ? `<ul class="pdf-one-ul">${b.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''
  if (b.type === 'table') {
    return b.rows.length
      ? `<div class="pdf-one-table">${b.rows.map(([k, v]) => `<div class="pdf-one-row"><span class="pdf-one-k">${esc(k)}</span><span class="pdf-one-v">${esc(v)}</span></div>`).join('')}</div>`
      : ''
  }
  return ''
}

/**
 * @param {{ title: string, theme: 'dark'|'light', content: { label, subtitle, date, blocks } }} doc
 * @param {object} settings  the workspace settings (address, email, website, vat_number, prepared_by)
 */
export function renderOnePager(doc, settings = {}) {
  const c = doc.content ?? {}
  const dark = doc.theme !== 'light'
  const logo = dark ? '/peny-logo-white.png' : '/peny-logo.png'
  const meta = [
    c.date ? esc(c.date) : '',
    settings.address ? esc(settings.address) : '',
    settings.email ? esc(settings.email) : '',
    settings.website ? esc(settings.website) : '',
    settings.vat_number ? `VAT: ${esc(settings.vat_number)}` : '',
  ].filter(Boolean).join('<br>')
  return `
    <div class="pdf-one ${dark ? 'pdf-one-dark' : 'pdf-one-light'}">
      <div class="pdf-one-logo"><img src="${logo}" alt="Peny" /></div>
      <div class="pdf-one-head">
        ${c.label ? `<div class="pdf-one-label">${esc(c.label)}</div>` : ''}
        <div class="pdf-one-title">${esc(doc.title || 'Untitled')}</div>
        ${c.subtitle ? `<div class="pdf-one-sub">${esc(c.subtitle)}</div>` : ''}
      </div>
      <hr class="pdf-one-divider" />
      <div class="pdf-one-body">${(c.blocks ?? []).map(blockHtml).join('')}</div>
      <div class="pdf-one-footer">
        <div class="pdf-one-meta">${meta}</div>
        ${settings.prepared_by ? `<div class="pdf-one-by">Prepared by ${esc(settings.prepared_by)}</div>` : ''}
      </div>
    </div>`
}
