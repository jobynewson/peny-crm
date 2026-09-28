// src/portal/schedule.js
// The post-production schedule on a project's portal page: a day-by-day grid
// with a column per phase, then the key dates (deadlines). Ported from the
// old portal page; phase and block colours are the ones people picked in
// Slate, so they stay literal (see claude.md "Deliberate exceptions").

import { esc, fullDate } from './util.js'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MAX_DAYS = 400
const FALLBACK = '#C47E3A'

function hexRgba(hex, a) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''))
  if (!m) return `rgba(196,126,58,${a})`
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`
}
const safeColour = c => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : FALLBACK)

// 'YYYY-MM-DD' days from start to end, inclusive (UTC, so no DST surprises).
function daysBetween(start, end) {
  const out = []
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

export function scheduleHtml(schedule, today) {
  const phases = schedule.phases || []
  if (!phases.length) return '<p class="pt-muted">No post-production schedule yet.</p>'
  const blocks = phases.flatMap(ph => ph.blocks.map(b => ({ ...b, phase: ph })))
  const ends = blocks.flatMap(b => [b.start_date, b.end_date]).filter(Boolean).sort()
  const start = schedule.start_date || ends[0]
  const end = schedule.end_date || ends[ends.length - 1]

  let grid
  if (!start || !end) {
    grid = `<div class="pt-phase-chips">${phases.map(ph => `<span class="pt-phase-chip"><span class="pt-dot" style="background:${safeColour(ph.color)}"></span>${esc(ph.name)}</span>`).join('')}</div>`
  } else {
    const days = daysBetween(start, end)
    if (days.length > MAX_DAYS) {
      grid = '<p class="pt-muted">The schedule spans too many days to show as a grid.</p>'
    } else {
      // For each phase, which block covers each day, and each block's first
      // and last day on the grid.
      const cover = phases.map(ph => {
        const byDay = {}
        for (const b of ph.blocks) for (const d of daysBetween(b.start_date, b.end_date)) byDay[d] ??= b
        const first = {}, last = {}
        for (const d of days) { const b = byDay[d]; if (b) { first[b.id] ??= d; last[b.id] = d } }
        return { byDay, first, last }
      })
      let lastMonth = ''
      const rows = days.map(d => {
        const dow = new Date(`${d}T00:00:00Z`).getUTCDay()
        const month = d.slice(0, 7)
        const monthLabel = month !== lastMonth ? `<div class="pt-grid-month">${MONTH_NAMES[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}</div>` : ''
        lastMonth = month
        const cells = phases.map((ph, i) => {
          const b = cover[i].byDay[d]
          if (!b) return '<td class="pt-grid-empty"></td>'
          const colour = safeColour(b.color || ph.color)
          const first = cover[i].first[b.id] === d
          const edge = hexRgba(colour, 0.55)
          return `<td class="pt-grid-block" data-block="${esc(ph.id)}:${esc(b.id)}" tabindex="${first ? 0 : -1}" role="button" aria-label="${esc(`${b.title || ph.name}, ${fullDate(b.start_date)} to ${fullDate(b.end_date)}`)}"
            style="background:${hexRgba(colour, 0.2)};border-left-color:${edge};${first ? `border-top:2px solid ${edge};` : ''}${cover[i].last[b.id] === d ? `border-bottom:2px solid ${edge};` : ''}">
            ${first && b.title ? `<div class="pt-grid-label" style="color:${colour}">${esc(b.title)}</div>` : ''}</td>`
        }).join('')
        const classes = ['pt-grid-row', dow === 0 || dow === 6 ? 'pt-grid-row--weekend' : '', d === today ? 'pt-grid-row--today' : ''].filter(Boolean).join(' ')
        return `<tr class="${classes}"><td class="pt-grid-date"><span class="pt-grid-dow">${DOW[dow]}</span> <span class="pt-grid-day">${Number(d.slice(8))}</span>${monthLabel}</td>${cells}</tr>`
      }).join('')
      grid = `
        <div class="pt-grid-wrap">
          <table class="pt-grid">
            <thead><tr><th class="pt-grid-date">Date</th>${phases.map(ph => `
              <th class="pt-grid-phase"><span class="pt-dot" style="background:${safeColour(ph.color)}"></span><span>${esc(ph.name)}</span></th>`).join('')}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`
    }
  }

  const deadlines = blocks.filter(b => b.is_deadline && b.start_date).sort((a, b) => a.start_date.localeCompare(b.start_date))
  const keyDates = deadlines.length ? `
    <section>
    <h2 class="pt-section-title">Key dates</h2>
    <ul class="pt-key-dates">${deadlines.map(b => {
      const away = Math.round((Date.parse(b.start_date) - Date.parse(today)) / 86400000)
      const badge = away === 0 ? '<span class="pt-badge pt-badge--today">Today</span>'
        : away < 0 ? '<span class="pt-badge">Passed</span>'
        : away <= 7 ? `<span class="pt-badge pt-badge--soon">${away}d away</span>` : ''
      return `<li class="${away < 0 ? 'pt-past' : ''}"><span class="pt-dot" style="background:${safeColour(b.color || b.phase.color)}"></span>
        <span class="pt-key-name">${esc(b.title || b.phase.name)}</span><span class="pt-muted">${fullDate(b.start_date)}</span>${badge}</li>`
    }).join('')}</ul>
    </section>` : ''

  return `<section><h2 class="pt-section-title">Post-production schedule</h2>${grid}</section>${keyDates}`
}

// Tapping a block opens its details.
export function bindSchedule(root, schedule) {
  const find = key => {
    const [phaseId, blockId] = key.split(':')
    const phase = schedule.phases.find(p => p.id === phaseId)
    return phase && { phase, block: phase.blocks.find(b => b.id === blockId) }
  }
  const open = cell => {
    const hit = find(cell.dataset.block)
    if (!hit?.block) return
    const { phase, block } = hit
    const days = daysBetween(block.start_date, block.end_date).length
    const dialog = document.createElement('dialog')
    dialog.className = 'pt-dialog'
    dialog.innerHTML = `
      <div class="pt-dialog-head">
        <span class="pt-dot" style="background:${safeColour(block.color || phase.color)}"></span>
        <div><h2 class="pt-dialog-title">${esc(block.title || phase.name)}</h2><div class="pt-muted">${esc(phase.name)}</div></div>
        <button type="button" class="pt-link" data-close aria-label="Close">✕</button>
      </div>
      <p>${fullDate(block.start_date)}${block.end_date !== block.start_date ? ` → ${fullDate(block.end_date)}` : ''}${days > 1 ? ` <span class="pt-muted">(${days} days)</span>` : ''}</p>
      ${block.notes ? `<p class="pt-dialog-notes">${esc(block.notes)}</p>` : ''}
      ${block.is_deadline ? '<p><span class="pt-badge pt-badge--late">Deadline</span></p>' : ''}`
    document.body.appendChild(dialog)
    dialog.addEventListener('close', () => { dialog.remove(); cell.focus() })
    dialog.addEventListener('click', e => { if (e.target === dialog || e.target.closest('[data-close]')) dialog.close() })
    dialog.showModal()
  }
  root.querySelectorAll('[data-block]').forEach(cell => {
    cell.addEventListener('click', () => open(cell))
    cell.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(cell) } })
  })
}
