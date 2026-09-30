// src/views/owed.js
// "Owed" on a project's Overview: what we still owe on this project, without
// opening the Worklist. The five most urgent open deliverables (overdue first,
// undated last) with status and due date; waiting-on-client ones stay in,
// muted. "See all" goes to the Worklist tab, which stays the place to edit.
// The list is read from GET retainers/projects/:id/owed (the rules live in
// api/_retainer-rules.js owedList); this only draws it.

import { getProjectOwed } from '../api/retainers.js'
import { readWindow, saveWindow, windowToggleHtml } from '../utils/window-days.js'

const WINDOW_KEY = 'slate-owed-window'
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function owedSummary(o) {
  if (!o.total) return 'Nothing owed.'
  return [`${o.total} open`, o.overdue ? `${o.overdue} overdue` : '', o.waiting ? `${o.waiting} waiting on the client` : ''].filter(Boolean).join(' · ')
}

function rowHtml(d) {
  const due = d.undated ? 'No date' : d.overdue ? `${d.days_late}d overdue` : d.due_display
  return `
    <a class="due-row owed-row${d.muted ? ' owed-row--muted' : ''}" href="${esc(d.link)}" data-owed-link="${esc(d.link)}">
      <span class="due-main">
        <span class="due-title">${esc(d.title)}</span>
        <span class="due-meta">${[d.workstream, d.owner_name || 'Unowned'].map(esc).join(' · ')}</span>
      </span>
      <span class="owed-status">${esc(d.chip ? d.chip.label : d.status_label)}</span>
      <span class="owed-due${d.overdue ? ' owed-due--late' : ''}">${esc(due)}</span>
    </a>`
}

export function owedHtml(o, days) {
  const more = o.total - o.items.length
  return `
    <div class="owed-head">
      <span class="owed-summary">${esc(owedSummary(o))}</span>
      ${windowToggleHtml(days, 'owed-window', 'Show work due within')}
    </div>
    ${o.items.length
      ? `<div class="due-list">${o.items.map(rowHtml).join('')}</div>`
      : `<div class="due-empty">${o.total ? `Nothing due in the next ${days} days.` : 'Nothing open on this project.'}</div>`}
    <div class="owed-foot">
      ${o.later ? `<span class="owed-later">${o.later} more due later than ${days} days</span>` : '<span></span>'}
      <button type="button" class="btn-secondary owed-all" data-owed-all style="font-size:12px">${more > 0 ? `See all ${o.total} in the Worklist` : 'Open the Worklist'}</button>
    </div>`
}

export async function mountOwed(app, el, projectId, { openWorklist }) {
  if (!el) return
  let days = readWindow(WINDOW_KEY, 30)
  let seq = 0
  const load = async () => {
    const mine = ++seq
    let data
    try { data = await getProjectOwed(projectId, days) } catch (err) {
      if (mine === seq && el.isConnected) el.innerHTML = '<div class="due-empty" style="color:var(--danger)">Couldn\'t load what\'s owed.</div>'
      return
    }
    if (mine !== seq || !el.isConnected) return
    el.innerHTML = owedHtml(data, days)
  }
  el.addEventListener('click', e => {
    const win = e.target.closest('[data-owed-window]')
    if (win) {
      days = Number(win.dataset.owedWindow)
      saveWindow(WINDOW_KEY, days)
      load()
      return
    }
    if (e.target.closest('[data-owed-all]')) { openWorklist(); return }
    const row = e.target.closest('[data-owed-link]')
    if (!row || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    app.openLink(row.dataset.owedLink)
  })
  el.innerHTML = '<div class="due-empty">Loading…</div>'
  await load()
}
