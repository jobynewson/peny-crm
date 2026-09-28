// scripts/_worklist-sheet.js
// Turns a client's worklist spreadsheet into an import plan: workstreams, their
// deliverables, and a list of every assumption made along the way. Pure — no
// file or database — so it's unit-tested (_worklist-sheet.test.js) and the
// dry run can print exactly what an --apply would write.
//
// The sheet has four columns, Products · Brief · Deliverables · Deadlines, and
// a product's rows run from its name to the next name (merged cells leave the
// rest blank). Within a product:
//   - Deadlines written "Name – 7th October" are one deliverable each, all
//     sharing the product's deliverable lines as their format (the ice axes).
//   - A numbered list in the brief column ("1. Fidus 6.5 mm Retrieval Loop")
//     is one deliverable per product listed, duplicates once (Pro Shoot
//     November).
//   - "1 video per week" is one recurring deliverable.
//   - Otherwise each deliverable line is a deliverable, due on the product's
//     deadline; a product with none gets one named from its brief.
//   - A short phrase in the brief column on a later row, with a note beside
//     it, is a deliverable of its own ("video with engineer").
//   - Deliverable lines ending in "?" are the client's notes, not
//     deliverables: they go into the workstream's brief.
// Dates have no year in the sheet; `year` supplies it.

import { lastDayOfMonth } from '../api/_dates.js'

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
}
const CADENCES = { week: 'weekly', fortnight: 'fortnightly', month: 'monthly', quarter: 'quarterly' }
const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const clean = v => (v == null ? '' : String(v).replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim())
const lines = v => clean(v).split(/\n+/).map(clean).filter(Boolean)
const pad = n => String(n).padStart(2, '0')
const month = word => MONTHS[String(word || '').toLowerCase().replace(/[^a-z]/g, '')] ?? null
const readable = ymd => `${Number(ymd.slice(8))} ${MONTH_NAMES[Number(ymd.slice(5, 7))]} ${ymd.slice(0, 4)}`

// "17th September" → exact; "September" → month; "1st week October /Nov" →
// a window ending on that week's last day, in the LAST month named, keeping
// the words. Anything else keeps its words with no date. → { due, assumption? }
export function parseWhen(text, year) {
  const t = clean(text)
  let m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?$/i.exec(t)
  if (m && month(m[2])) {
    const date = `${year}-${pad(month(m[2]))}-${pad(Number(m[1]))}`
    return { due: { due_kind: 'exact', due_date: date } }
  }
  m = /^([a-z]+)$/i.exec(t)
  if (m && month(m[1])) return { due: { due_kind: 'month', due_month: `${year}-${pad(month(m[1]))}` } }
  m = /^(\d)(?:st|nd|rd|th)?\s+week\s+(?:of\s+)?([a-z]+)(?:\s*\/\s*([a-z]+))?$/i.exec(t)
  if (m && month(m[2]) && (!m[3] || month(m[3]))) {
    const mm = month(m[3] || m[2])
    const end = Math.min(Number(m[1]) * 7, Number(lastDayOfMonth(`${year}-${pad(mm)}`).slice(8)))
    const date = `${year}-${pad(mm)}-${pad(end)}`
    return {
      due: { due_kind: 'window', due_date: date, due_label: t },
      assumption: m[3] ? `“${t}” read as a window ending ${readable(date)} (the later month named)` : null,
    }
  }
  return { due: { due_kind: 'exact', due_date: null, due_label: t || null }, assumption: t ? `“${t}” isn't a date I can read — kept as words, no date` : null }
}

// "Cortex – 7th October" → { name, when }
const named = text => {
  const m = /^(.+?)\s*[–—-]\s*(\d.*)$/.exec(clean(text))
  return m ? { name: clean(m[1]), when: m[2] } : null
}
const numbered = text => /^\d+\s*\.\s*\S/.test(clean(text))
const unnumber = text => clean(text).replace(/^\d+\s*\.\s*/, '')
const isNote = text => /\?$/.test(clean(text))
const recurring = text => {
  const m = /\b(?:\d+|one|a|an)\s+(?:[a-z]+\s+)?per\s+(week|fortnight|month|quarter)\b/i.exec(clean(text))
  return m ? CADENCES[m[1].toLowerCase()] : null
}
// A short phrase, not a sentence: "video with engineer".
const phrase = text => clean(text).length <= 40 && !/[.!?]$/.test(clean(text))
// The first clause of a brief, as a title: "Product shoot indoor- Brief to be
// finalised…" → "Product shoot indoor".
const titleFrom = brief => clean(clean(brief).split(/\s*-\s+|\.\s|;\s/)[0]).replace(/[.\s-]+$/, '')

// rows: [{ n, A, B, C, D, boldB }] in sheet order, header included.
// → [{ product, rows: [...] }]
export function productBlocks(rows) {
  const header = rows.findIndex(r => clean(r.A).toLowerCase() === 'products')
  const blocks = []
  for (const r of rows.slice(header + 1)) {
    if (clean(r.A)) blocks.push({ product: clean(r.A), rows: [r] })
    else if (blocks.length && (clean(r.B) || clean(r.C) || clean(r.D))) blocks[blocks.length - 1].rows.push(r)
  }
  return blocks
}

// → { workstreams: [{ title, brief, status, deliverables: [{ title, format, due, status, client_visible, internal_notes }] }], assumptions: [] }
export function planImport(rows, { year, visible = false, approved = [], today = null } = {}) {
  const assumptions = []
  const done = new Set(approved.map(a => clean(a).toLowerCase()))
  const workstreams = []

  for (const block of productBlocks(rows)) {
    const briefs = []
    const notes = []
    const content = []
    const extras = []
    const products = []
    const bold = []
    const dated = []
    let when = null

    block.rows.forEach((r, i) => {
      for (const c of lines(r.C)) (isNote(c) ? notes : content).push({ text: c, row: r })
      for (const d of lines(r.D)) {
        const n = named(d)
        if (n) dated.push(n)
        else when ??= d
      }
      const b = clean(r.B)
      if (!b) return
      if (numbered(b)) {
        products.push(unnumber(b))
        if (r.boldB) bold.push(b.match(/^\d+/)[0])
      } else if (i === 0) briefs.push(b)
      else if (phrase(b) && clean(r.C)) extras.push({ title: b, note: clean(r.C), row: r })
      else briefs.push(b)
    })
    // A note beside a separate deliverable belongs to it, not to the list.
    const extraRows = new Set(extras.map(e => e.row))
    const lineItems = content.filter(c => !extraRows.has(c.row)).map(c => c.text)

    const status = done.has(block.product.toLowerCase()) ? 'approved' : 'planned'
    const shared = when ? parseWhen(when, year) : null
    if (shared?.assumption) assumptions.push(`${block.product}: ${shared.assumption}`)
    const item = (title, due, extra = {}) => ({
      title, format: null, due: due ?? { due_kind: 'exact', due_date: null }, status, client_visible: !!visible, internal_notes: null, ...extra,
    })
    const deliverables = []

    if (dated.length) {
      // One per named deadline, each carrying the product's deliverable lines.
      const format = lineItems.join('; ') || null
      for (const d of dated) {
        const parsed = parseWhen(d.when, year)
        if (parsed.assumption) assumptions.push(`${block.product} – ${d.name}: ${parsed.assumption}`)
        deliverables.push(item(d.name, parsed.due, { format }))
      }
    } else if (products.length) {
      const seen = new Set()
      for (const p of products) {
        if (seen.has(p.toLowerCase())) { assumptions.push(`${block.product}: “${p}” is listed twice — imported once`); continue }
        seen.add(p.toLowerCase())
        deliverables.push(item(p, shared?.due, { format: lineItems.join('; ') || null }))
      }
      if (bold.length) assumptions.push(`${block.product}: bold on items ${bold.join(', ')} is ignored`)
    } else if (lineItems.length) {
      for (const text of lineItems) {
        const cadence = recurring(text)
        deliverables.push(cadence
          ? item(text, { due_kind: 'recurring', cadence, due_date: null })
          : item(text, shared?.due))
      }
    } else {
      const title = titleFrom(briefs[0] || block.product)
      deliverables.push(item(title, shared?.due))
      assumptions.push(`${block.product}: no deliverables listed — one named from its brief, “${title}”`)
    }
    for (const e of extras) deliverables.push(item(e.title.charAt(0).toUpperCase() + e.title.slice(1), null, { internal_notes: `From the worklist: ${e.note}` }))

    if (today && status !== 'approved') {
      const late = deliverables.filter(d => d.due.due_date && d.due.due_date < today)
      if (late.length) {
        assumptions.push(`${block.product}: ${late.length === 1 ? '1 item was' : `${late.length} items were`} due before today and will show as overdue — pass --approved "${block.product}" if they're done`)
      }
    }

    const brief = [...briefs, ...(notes.length ? [`From the client: ${notes.map(n => n.text).join(' ')}`] : [])].join('\n') || null
    workstreams.push({ title: block.product, brief, status: status === 'approved' ? 'complete' : 'active', deliverables })
  }

  for (const a of approved) {
    if (!workstreams.some(w => w.title.toLowerCase() === clean(a).toLowerCase())) assumptions.push(`--approved "${a}" matches no product in the sheet`)
  }
  assumptions.push(visible ? 'Everything imported is shown to the client (--visible)' : 'Everything imported is hidden from the client — pass --visible to show it')
  return { workstreams, assumptions }
}
