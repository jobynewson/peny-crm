// src/pdf/onepager.js
// The document behind Tools › PDF Generator, as HTML. It is drawn in the quote
// PDF's look (the dark cover, or the light detail pages), with the Peny logo
// and the studio details from Settings, so a document reads as part of the same
// set as a quote. Used for both the live preview and the print.
//
// This file is the pure part: the model and the markup of one page. Laying the
// content across pages needs the browser's layout, so that is paginate.js.
// The classes are the .pdf-one-* block in style.css, next to the quote's.

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Keep in step with LIMITS and FLAGS in api/_pdf-documents.js (its test checks).
export const LIMITS = { title: 200, label: 60, subtitle: 300, date: 60, preparedBy: 120, emails: 300, scaleMin: 40, scaleMax: 120, blocks: 60, text: 5000, items: 40, rows: 30, cell: 300 }
export const FLAGS = ['condensedHeader', 'condensedFooter', 'condensedPage']

// A new document's footer email; "prepared by" starts blank.
export const DEFAULT_EMAIL = 'hello@wearepeny.com'

export const BLOCK_LABELS = { heading: 'Heading', text: 'Text', bullets: 'List', table: 'Table' }

export function todayLong(d = new Date()) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function blankDocument() {
  return { title: '', theme: 'dark', content: { label: '', subtitle: '', date: todayLong(), preparedBy: '', emails: DEFAULT_EMAIL, scale: 100, condensedHeader: false, condensedFooter: false, condensedPage: false, blocks: [{ type: 'text', text: '' }] } }
}

// Typed text: **bold** and *italic*, with line breaks kept as typed. Escaped
// first, so nothing but these two tags can come out.
export function inline(s) {
  return esc(s)
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![*\w])/g, '$1<em>$2</em>')
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
  if (b.type === 'text') return b.text.trim() ? `<p class="pdf-one-p">${inline(b.text)}</p>` : ''
  if (b.type === 'bullets') return b.items.length ? `<ul class="pdf-one-ul">${b.items.map(i => `<li>${inline(i)}</li>`).join('')}</ul>` : ''
  if (b.type === 'table') {
    return b.rows.length
      ? `<div class="pdf-one-table">${b.rows.map(([k, v]) => `<div class="pdf-one-row"><span class="pdf-one-k">${inline(k)}</span><span class="pdf-one-v">${inline(v)}</span></div>`).join('')}</div>`
      : ''
  }
  return ''
}

// The body as groups: a heading starts a group and takes what follows it up to
// the next heading, so a page break can fall between groups, not under a heading.
export function groupBlocks(blocks) {
  const groups = []
  for (const b of blocks ?? []) {
    const html = blockHtml(b)
    if (!html) continue
    if (b.type === 'heading' || !groups.length) groups.push([])
    groups.at(-1).push(html)
  }
  return groups
}

const list = s => String(s ?? '').split(/[,;\n]/).map(x => x.trim()).filter(Boolean)

/**
 * Everything a page needs, worked out once.
 * @param {{ title: string, theme: 'dark'|'light', content: object }} doc
 * @param {object} settings  the workspace settings (address, website, vat_number)
 */
export function buildModel(doc, settings = {}) {
  const c = doc.content ?? {}
  const page = !!c.condensedPage
  return {
    dark: doc.theme !== 'light',
    tight: page,
    headerCondensed: page || !!c.condensedHeader,
    footerCondensed: page || !!c.condensedFooter,
    title: doc.title || 'Untitled',
    label: c.label || '',
    subtitle: c.subtitle || '',
    groups: groupBlocks(c.blocks),
    facts: [c.date, String(settings.address ?? '').replace(/\s*\n\s*/g, ', '), settings.website, settings.vat_number ? `VAT: ${settings.vat_number}` : '']
      .map(x => String(x ?? '').trim()).filter(Boolean),
    emails: list(c.emails),
    preparedBy: (c.preparedBy || '').trim(),
    scale: Number.isInteger(c.scale) ? Math.min(LIMITS.scaleMax, Math.max(LIMITS.scaleMin, c.scale)) : 100,
  }
}

function headerHtml(m, first) {
  const logo = m.dark ? '/peny-logo-white.png' : '/peny-logo.png'
  if (!first) {
    return `<div class="pdf-one-run"><img src="${logo}" alt="Peny" /><span>${esc(m.title)}</span></div>`
  }
  const head = `<div class="pdf-one-head">
      ${m.label && !m.headerCondensed ? `<div class="pdf-one-label">${esc(m.label)}</div>` : ''}
      <div class="pdf-one-title">${esc(m.title)}</div>
      ${m.subtitle ? `<div class="pdf-one-sub">${esc(m.subtitle)}</div>` : ''}
    </div>`
  if (m.headerCondensed) {
    return `<div class="pdf-one-top"><img src="${logo}" alt="Peny" />${m.label ? `<span class="pdf-one-label">${esc(m.label)}</span>` : ''}</div>${head}<hr class="pdf-one-divider" />`
  }
  return `<div class="pdf-one-logo"><img src="${logo}" alt="Peny" /></div>${head}<hr class="pdf-one-divider" />`
}

function footerHtml(m, { last, num, total }) {
  const pn = total > 1 ? `<div class="pdf-one-pn">Page ${num} of ${total}</div>` : ''
  if (!last) return `<div class="pdf-one-footer"><div></div><div class="pdf-one-right">${pn}</div></div>`
  const meta = m.footerCondensed
    ? `<div class="pdf-one-meta">${[...m.facts, ...m.emails].map(esc).join(' · ')}</div>`
    : `<div class="pdf-one-meta">${m.facts.length ? `<div>${m.facts.map(esc).join(' · ')}</div>` : ''}${m.emails.length ? `<div>${m.emails.map(esc).join(' · ')}</div>` : ''}</div>`
  const by = m.preparedBy ? `<div class="pdf-one-by">Prepared by ${esc(m.preparedBy)}</div>` : ''
  return `<div class="pdf-one-footer">${meta}<div class="pdf-one-right">${by}${pn}</div></div>`
}

/** One page: `bodyHtml` is the blocks that sit on it. */
export function pageHtml(m, { first, last, num = 1, total = 1, bodyHtml = '' }) {
  const cls = ['pdf-one', m.dark ? 'pdf-one-dark' : 'pdf-one-light', m.tight && 'pdf-one-tight', m.headerCondensed && 'pdf-one-hc', m.footerCondensed && 'pdf-one-fc'].filter(Boolean).join(' ')
  return `<div class="${cls}" style="--pdf-s:${m.scale / 100}">${headerHtml(m, first)}<div class="pdf-one-body">${bodyHtml}</div>${footerHtml(m, { last, num, total })}</div>`
}
