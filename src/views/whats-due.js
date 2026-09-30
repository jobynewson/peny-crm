// src/views/whats-due.js
// The Dashboard's What's due list: everything dated across Slate, read from
// GET /api/due (api/_due-feed.js) — the same feed as the 09:00 email and the
// office screen, so nothing here works out what's due on its own.
//
// Overdue plus the next 7, 14 (default), 30 or 60 days, grouped by day. Everyone's or just yours
// (remembered per browser in `slate-due-owner`). Rows open the item where it
// lives; nothing is ticked off from here.

import { request } from '../api/http.js'
import { readWindow, saveWindow, windowToggleHtml } from '../utils/window-days.js'

const OWNER_KEY = 'slate-due-owner'
const WINDOW_KEY = 'slate-due-window'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function dayHeading(date, days) {
  if (days < 0) return 'Overdue'
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  const [y, m, d] = date.split('-').map(Number)
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`
}

function rowHtml(item) {
  // Same line as dueMeta() in api/_due-feed.js.
  const meta = [item.type_label, item.context, item.due_label].filter(Boolean).map(esc).join(' · ')
  return `
    <a class="due-row" href="${esc(item.link)}" data-due-link="${esc(item.link)}">
      ${item.overdue ? `<span class="db-due-pill db-due-pill--overdue">${-item.days}d late</span>` : ''}
      <span class="due-main">
        <span class="due-title">${esc(item.title)}</span>
        <span class="due-meta">${meta}</span>
      </span>
      ${item.owner ? `<span class="due-owner">${esc(item.owner.name)}</span>` : '<span class="due-owner due-owner--none">Unassigned</span>'}
    </a>`
}

function listHtml(items, mine, days) {
  if (!items.length) {
    return `<div class="due-empty">${mine ? 'Nothing due for you' : 'Nothing due'} in the next ${days} days.</div>`
  }
  const groups = []
  for (const item of items) {
    const heading = dayHeading(item.date, item.days)
    const last = groups[groups.length - 1]
    if (last?.heading === heading) last.items.push(item)
    else groups.push({ heading, items: [item] })
  }
  return `<div class="db-proj-list due-list">${groups.map(g => `
    <div class="due-group">
      <div class="due-group-label${g.heading === 'Overdue' ? ' due-group-label--late' : ''}">${esc(g.heading)}</div>
      ${g.items.map(rowHtml).join('')}
    </div>`).join('')}</div>`
}

export async function mountWhatsDue(app, el) {
  if (!el) return
  let owner = 'all'
  let days = readWindow(WINDOW_KEY, 14)
  try { if (localStorage.getItem(OWNER_KEY) === 'me') owner = 'me' } catch {}

  el.innerHTML = `
    <div class="db-section-head" style="justify-content:space-between">
      <div style="display:flex;align-items:center;gap:6px">
        <span class="db-section-dot" style="background:var(--cat-red)"></span>
        What's due
        <span class="db-section-count" data-due-count hidden></span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${windowToggleHtml(days, 'due-window', 'Look ahead')}
        <div class="seg" role="group" aria-label="Whose work">
          <button type="button" class="seg-btn" data-due-owner="all">Everyone</button>
          <button type="button" class="seg-btn" data-due-owner="me">Mine</button>
        </div>
      </div>
    </div>
    <div data-due-body><div class="due-empty">Loading…</div></div>`

  let items = null   // null until loaded
  const body = el.querySelector('[data-due-body]')
  const count = el.querySelector('[data-due-count]')
  const paint = () => {
    el.querySelectorAll('[data-due-owner]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.dueOwner === owner)))
    if (!items) return
    const shown = owner === 'me' ? items.filter(i => i.owner?.id === app.appUser?.id) : items
    count.hidden = !shown.length
    count.textContent = shown.length
    body.innerHTML = listHtml(shown, owner === 'me', days)
  }

  let seq = 0   // a slow answer for an earlier window must not overwrite a later one
  const load = async () => {
    const mine = ++seq
    try {
      const feed = await request(`/api/due?days=${days}`)
      if (mine !== seq) return
      items = feed.items
    } catch (err) {
      if (mine !== seq) return
      console.error('What\'s due failed to load:', err)
      if (el.isConnected) body.innerHTML = `<div class="due-empty" style="color:var(--danger)">Couldn't load what's due.</div>`
      return
    }
    if (el.isConnected) paint()
  }

  el.addEventListener('click', e => {
    const win = e.target.closest('[data-due-window]')
    if (win) {
      days = Number(win.dataset.dueWindow)
      saveWindow(WINDOW_KEY, days)
      el.querySelectorAll('[data-due-window]').forEach(b => b.setAttribute('aria-pressed', String(b === win)))
      items = null
      body.innerHTML = '<div class="due-empty">Loading…</div>'
      load()
      return
    }
    const toggle = e.target.closest('[data-due-owner]')
    if (toggle) {
      owner = toggle.dataset.dueOwner
      try { localStorage.setItem(OWNER_KEY, owner) } catch {}
      paint()
      return
    }
    // Rows are real links (they open in a new tab with a modifier key); a plain
    // click moves within the app.
    const row = e.target.closest('[data-due-link]')
    if (!row || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    app.openLink(row.dataset.dueLink)
  })

  paint()
  await load()
}
