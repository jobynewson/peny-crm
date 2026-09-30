// src/views/worklist.js
// The Worklist tab on a project's page: the project's workstreams, the
// deliverables in each and the rounds sent for review. Any project can have
// one. A project is the parent of its worklist; the company (if it has one) is
// read from the project. Opened at #projects/<id>/worklist, and
// #projects/<id>/worklist/<deliverableId> opens that deliverable's sheet.
//
// Built for a phone first: one column, 44px tap targets, and every form opens
// through views/popover.js (a popover on desktop, a bottom sheet on phones).
//   - A status is one tap: tap the chip, pick one, it's saved.
//   - Sending is one action: paste the link, Send. The server makes it the
//     next round and puts the deliverable in review.
//   - The eye shows or hides a deliverable from the client. New ones start
//     hidden.
//
// Data travels only through /api/retainers (src/api/retainers.js). The page
// holds no copy of the rules: status names and what the client sees, due
// kinds, cadences, due text and day counts all arrive in the payload, worked
// out by api/_retainer-rules.js — the module the portal uses too.

import * as api from '../api/retainers.js'
import { openFloating } from './popover.js'
import { icon } from './icons.js'
import { setCompanyLead, getPortalAccess, setUpPortal, inviteToPortal, revokePortalInvitation, removePortalMember } from '../api/companies.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LONDON_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
// "28 Sep", the day in London (the same style as the rest of the page).
const dayMonth = iso => { const [, m, d] = LONDON_DAY.format(new Date(iso)).split('-').map(Number); return `${d} ${MONTHS[m - 1]}` }

const DUE_KIND_LABELS = { exact: 'On a date', month: 'During a month', window: 'By the end of a window', recurring: 'Repeats' }
const DATE_LABELS = { exact: 'Date', window: 'Last day', recurring: 'Next one' }

// A popover taller than the space below its button is moved up to fit. (On
// phones it's a bottom sheet, which scrolls by itself.)
function fitInViewport(el) {
  if (el.classList.contains('sheet')) return
  const top = parseFloat(el.style.top) || 0
  const room = window.innerHeight - 16
  if (top + el.offsetHeight > room) el.style.top = `${Math.max(16, room - el.offsetHeight)}px`
}

export class Worklist {
  constructor(app) {
    this.app = app
    this.el = null           // the tab's container
    this.projectId = null
    this.page = null         // GET /projects/:id payload
    this._seq = 0            // drops responses for a project no longer on show
    this._openComplete = new Set()   // complete workstreams someone has opened
  }

  get canEdit() { return this.app.permissions?.projects_edit === true }
  get isSuperadmin() { return this.app.appUser?.role === 'superadmin' }

  // Show the project's worklist in `el`. `openId` (from the address) opens that
  // deliverable's sheet once it has loaded.
  async mount(el, projectId, { openId = null } = {}) {
    const seq = ++this._seq
    this.el = el
    this.projectId = projectId
    if (this.page?.project.id === projectId) this._paint()
    else el.innerHTML = '<div class="rt-empty">Loading…</div>'
    let page
    try {
      page = await api.getProjectPage(projectId)
    } catch (err) {
      if (seq !== this._seq || !el.isConnected) return
      el.innerHTML = err.status === 404
        ? '<div class="rt-empty"><p>This project isn’t in Slate any more.</p></div>'
        : `<div class="rt-empty rt-error">Couldn't load the worklist. ${esc(err.message)}</div>`
      return
    }
    if (seq !== this._seq || !el.isConnected) return
    this.page = page
    this._paint()
    this._refreshCount()
    if (openId) {
      const button = el.querySelector(`[data-rt-open="${CSS.escape(openId)}"]`)
      if (button) { button.scrollIntoView({ block: 'center' }); this._deliverableSheet(button, openId) }
    }
  }

  // The number on the tab (open items), and the dashboard's, kept current.
  _refreshCount() {
    const open = this.page.workstreams.filter(w => w.status === 'active').flatMap(w => w.deliverables).filter(d => d.status !== 'approved').length
    this.app.projectsView?.setWorklistCount?.(this.projectId, open)
  }

  // Repaint from this.page, keeping focus on the same control if it's still
  // there (a repaint replaces every element).
  _repaint() {
    if (!this.el?.isConnected || !this.page) return
    const focusKey = document.activeElement?.closest?.('[data-focus-key]')?.dataset.focusKey
    this._paint()
    if (focusKey) this.el.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus()
  }

  _paint() {
    const { company, project, workstreams, unattached } = this.page
    const all = workstreams.flatMap(w => (w.status === 'active' ? w.deliverables : []))
    const open = all.filter(d => d.status !== 'approved')
    const summary = [
      count(open.length, 'open item'),
      open.filter(d => d.overdue).length && `<span class="rt-late">${open.filter(d => d.overdue).length} overdue</span>`,
      open.filter(d => d.status === 'waiting_on_client').length && `${open.filter(d => d.status === 'waiting_on_client').length} waiting on client`,
      open.filter(d => d.status === 'in_review').length && `${open.filter(d => d.status === 'in_review').length} in review`,
    ].filter(Boolean).join(' · ')
    // Active first, then paused, then complete; each in its own order.
    const rank = { active: 0, paused: 1, complete: 2 }
    const ordered = [...workstreams].sort((a, b) => rank[a.status] - rank[b.status])

    this.el.innerHTML = `
      <div class="rt-head">
        <div class="rt-head-main">
          <div class="rt-summary">${summary}${company?.portal ? ' · <span class="rt-chip">Login on</span>' : ''}${project.has_link ? ' · <span class="rt-chip">Link on</span>' : ''}</div>
          ${company ? this._leadHtml(company) : ''}
        </div>
        <div class="rt-head-actions">
          ${this.canEdit ? '<button class="btn-secondary" data-rt-link-panel data-focus-key="link">Client link</button>' : ''}
          ${this.isSuperadmin && company ? '<button class="btn-secondary" data-rt-portal data-focus-key="portal">Portal access</button>' : ''}
          ${this.canEdit ? '<button class="btn-primary" data-rt-add-ws data-focus-key="add-ws">+ Workstream</button>' : ''}
        </div>
      </div>
      ${this.canEdit && unattached.length ? `
        <div class="rt-attach" role="status">
          <span>${esc(company?.name || 'This company')} has ${count(unattached.length, 'older workstream')} not attached to a project: ${unattached.map(w => esc(w.title)).join(', ')}.</span>
          <button type="button" class="btn-secondary" data-rt-attach data-focus-key="attach">Attach ${unattached.length === 1 ? 'it' : 'them'} to this project</button>
        </div>` : ''}
      ${ordered.length
        ? ordered.map(w => this._workstreamHtml(w)).join('')
        : `<div class="rt-empty"><p>No workstreams yet. A workstream groups the deliverables for one piece of work.</p>
            ${this.canEdit ? '<button class="btn-primary" data-rt-add-ws>+ Add a workstream</button>' : ''}</div>`}`
    this._bind()
  }

  // Who hears about this company's work when a deliverable has no owner. A
  // company without one is flagged: its alerts fall back to every superadmin.
  _leadHtml(company) {
    if (!this.app.settings?.show_leads) return ''   // hidden unless a superadmin turns leads on
    const label = company.lead_id
      ? `Lead: <strong>${esc(company.lead_name || 'Unknown')}</strong>`
      : '<span class="rt-late">No lead set — alerts for this client go to every superadmin.</span> Choose one'
    return this.canEdit
      ? `<button type="button" class="rt-link-btn rt-lead" data-rt-lead data-focus-key="lead" aria-haspopup="dialog">${label}</button>`
      : `<div class="rt-summary rt-lead">${company.lead_id ? label : '<span class="rt-late">No lead set</span>'}</div>`
  }

  _leadForm(anchor) {
    const { company } = this.page
    const users = this.app.allUsers || []
    const html = `
      <div class="lt-head"><h2 class="lt-title" id="rt-lead-title">Who leads ${esc(company.name)}?</h2></div>
      <form class="tl-form" id="rt-lead-form" novalidate>
        <p class="tl-hint">They hear about this client's work — a new request, changes asked for, a reply — when a deliverable has no owner.</p>
        <div class="tl-field"><label for="rt-lead-pick">Lead</label>
          <select id="rt-lead-pick"><option value="">Choose someone</option>${users.map(u => `<option value="${u.id}"${u.id === company.lead_id ? ' selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}</select></div>
        <div class="tl-msg" id="rt-lead-msg" role="alert"></div>
        <button type="submit" class="btn-primary tl-submit">Save</button>
      </form>`
    openFloating({
      anchor, id: 'rt-lead', role: 'dialog', className: 'lt-pop rt-pop', html,
      onReady: (el, close) => {
        el.setAttribute('aria-labelledby', 'rt-lead-title')
        const form = el.querySelector('#rt-lead-form')
        form.addEventListener('submit', async e => {
          e.preventDefault()
          const pick = form.querySelector('#rt-lead-pick').value
          const msg = form.querySelector('#rt-lead-msg')
          if (!pick) { msg.dataset.tone = 'error'; msg.textContent = 'Choose someone'; return }
          const submit = form.querySelector('[type="submit"]')
          submit.disabled = true
          try {
            await setCompanyLead(company.id, pick)
            const user = users.find(u => u.id === pick)
            company.lead_id = pick
            company.lead_name = user?.name || user?.email || null
            const known = (this.app.companies || []).find(c => c.id === company.id)
            if (known) known.lead_id = pick
            close({ restoreFocus: false })
            this._repaint()
            this.app.toast('Lead saved')
          } catch (err) {
            submit.disabled = false
            msg.dataset.tone = 'error'; msg.textContent = err.message || 'Could not save'
          }
        })
      },
    })
  }

  _workstreamHtml(w) {
    const collapsed = w.status === 'complete' && !this._openComplete.has(w.id)
    const statusChip = this.canEdit
      ? `<button type="button" class="rt-ws-status rt-ws-status--${w.status}" data-rt-ws-status="${w.id}" data-focus-key="ws-status-${w.id}" aria-haspopup="menu" aria-label="Workstream status: ${esc(w.status_label)}">${esc(w.status_label)}</button>`
      : `<span class="rt-ws-status rt-ws-status--${w.status}">${esc(w.status_label)}</span>`
    const openCount = w.deliverables.filter(d => d.status !== 'approved').length
    return `
      <section class="rt-ws${w.status !== 'active' ? ` rt-ws--${w.status}` : ''}" data-ws="${w.id}" aria-labelledby="rt-ws-${w.id}">
        <header class="rt-ws-head">
          <div class="rt-ws-head-main">
            <h2 class="rt-ws-title" id="rt-ws-${w.id}">${esc(w.title)}</h2>
            ${statusChip}
            <span class="rt-ws-count">${count(w.deliverables.length, 'item')}${openCount && openCount !== w.deliverables.length ? `, ${openCount} open` : ''}</span>
            ${w.status === 'complete' ? `<button type="button" class="rt-link-btn" data-rt-toggle-ws="${w.id}" aria-expanded="${!collapsed}">${collapsed ? 'Show' : 'Hide'}</button>` : ''}
          </div>
          ${this.canEdit ? `<button type="button" class="icon-btn rt-more" data-rt-ws-edit="${w.id}" data-focus-key="ws-edit-${w.id}" aria-label="Edit workstream ${esc(w.title)}">${icon('more', 18)}</button>` : ''}
        </header>
        ${collapsed ? '' : `
          ${w.brief ? `<p class="rt-ws-brief">${esc(w.brief)}</p>` : ''}
          <div class="rt-list">
            ${w.deliverables.length
              ? w.deliverables.map(d => this._deliverableHtml(d)).join('')
              : '<div class="rt-list-empty">No deliverables yet.</div>'}
          </div>
          ${this.canEdit ? `<button type="button" class="rt-add" data-rt-add-d="${w.id}" data-focus-key="add-d-${w.id}">+ Deliverable</button>` : ''}`}
      </section>`
  }

  _deliverableHtml(d) {
    const latest = d.deliveries[d.deliveries.length - 1]
    const meta = [d.format && esc(d.format), d.owner_name ? esc(d.owner_name) : '<span class="rt-muted">Unassigned</span>',
      `<span class="rt-due${d.overdue ? ' rt-due--late' : ''}">${esc(d.due_display)}${d.overdue ? ` · ${d.days_late}d late` : ''}</span>`]
      .filter(Boolean).join(' · ')
    const round = latest ? this._roundLineHtml(latest) : ''
    const waiting = d.status === 'waiting_on_client'
      ? `<div class="rt-d-waiting">${d.waiting_note ? `Waiting for: ${esc(d.waiting_note)}` : 'Waiting on the client'}${d.waiting_days != null ? ` · ${d.waiting_days ? `for ${count(d.waiting_days, 'day')}` : 'since today'}` : ''}</div>`
      : ''
    const eyeLabel = d.client_visible ? 'Shown to the client' : 'Hidden from the client'
    const eye = this.canEdit
      ? `<button type="button" class="icon-btn rt-eye${d.client_visible ? ' rt-eye--on' : ''}" data-rt-visible="${d.id}" data-focus-key="eye-${d.id}" aria-pressed="${d.client_visible}" aria-label="${esc(`${eyeLabel}: ${d.title}`)}" title="${eyeLabel}">${icon(d.client_visible ? 'eye' : 'eyeOff', 18)}</button>`
      : `<span class="rt-eye${d.client_visible ? ' rt-eye--on' : ''}" title="${eyeLabel}" aria-label="${eyeLabel}" role="img">${icon(d.client_visible ? 'eye' : 'eyeOff', 18)}</span>`
    const status = this.canEdit
      ? `<button type="button" class="rt-status rt-status--${d.status}" data-rt-status="${d.id}" data-focus-key="status-${d.id}" aria-haspopup="menu" aria-label="${esc(`Status: ${d.status_label}. Change status of ${d.title}`)}">${esc(d.status_label)}</button>`
      : `<span class="rt-status rt-status--${d.status}">${esc(d.status_label)}</span>`
    return `
      <div class="rt-d${d.status === 'approved' ? ' rt-d--done' : ''}" data-d="${d.id}">
        ${eye}
        <div class="rt-d-main">
          <button type="button" class="rt-d-title" data-rt-open="${d.id}" data-focus-key="open-${d.id}">${esc(d.title)}</button>
          <div class="rt-d-meta">${meta}</div>
          ${round}${waiting}
        </div>
        ${status}
        ${this.canEdit && d.status !== 'approved' ? `<button type="button" class="btn-secondary rt-send" data-rt-send="${d.id}" data-focus-key="send-${d.id}">${icon('send', 15)}<span>Send</span></button>` : ''}
      </div>`
  }

  _roundLineHtml(r) {
    const link = `<a class="rt-round-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Round ${r.round}</a>`
    if (r.client_response === 'approved') return `<div class="rt-d-round rt-d-round--ok">${link} approved ${dayMonth(r.responded_at)}${r.responded_by_staff ? ' (recorded)' : ''}</div>`
    if (r.client_response === 'changes_requested') {
      return `<div class="rt-d-round rt-d-round--changes">${link}: changes requested${r.client_comment ? ` — “${esc(r.client_comment)}”` : ''}</div>`
    }
    return `<div class="rt-d-round">${link} sent ${dayMonth(r.sent_at)} · awaiting response</div>`
  }

  _bind() {
    const mc = this.el
    mc.querySelectorAll('[data-rt-add-ws]').forEach(b => b.addEventListener('click', () => this._workstreamForm(b, null)))
    mc.querySelector('[data-rt-link-panel]')?.addEventListener('click', e => this.openLinkPanel(e.currentTarget, this.projectId))
    mc.querySelector('[data-rt-portal]')?.addEventListener('click', e => this._portalPanel(e.currentTarget))
    mc.querySelector('[data-rt-lead]')?.addEventListener('click', e => this._leadForm(e.currentTarget))
    mc.querySelector('[data-rt-attach]')?.addEventListener('click', async e => {
      const button = e.currentTarget
      button.disabled = true
      try {
        const { attached } = await api.attachWorkstreams(this.projectId)
        this.app.toast(`Attached ${count(attached, 'workstream')}`)
        this._reload()
      } catch (err) { button.disabled = false; this.app.toast(err.message || 'Could not attach them') }
    })
    mc.querySelectorAll('[data-rt-ws-edit]').forEach(b => b.addEventListener('click', () => this._workstreamForm(b, this._workstream(b.dataset.rtWsEdit))))
    mc.querySelectorAll('[data-rt-ws-status]').forEach(b => b.addEventListener('click', () => this._workstreamStatusMenu(b, this._workstream(b.dataset.rtWsStatus))))
    mc.querySelectorAll('[data-rt-toggle-ws]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.rtToggleWs
      if (this._openComplete.has(id)) this._openComplete.delete(id); else this._openComplete.add(id)
      this._repaint()
    }))
    mc.querySelectorAll('[data-rt-add-d]').forEach(b => b.addEventListener('click', () => this._deliverableForm(b, { workstream: this._workstream(b.dataset.rtAddD) })))
    mc.querySelectorAll('[data-rt-open]').forEach(b => b.addEventListener('click', () => this._deliverableSheet(b, b.dataset.rtOpen)))
    mc.querySelectorAll('[data-rt-status]').forEach(b => b.addEventListener('click', () => this._statusMenu(b, this._deliverable(b.dataset.rtStatus))))
    mc.querySelectorAll('[data-rt-send]').forEach(b => b.addEventListener('click', () => this._sendForm(b, this._deliverable(b.dataset.rtSend))))
    mc.querySelectorAll('[data-rt-visible]').forEach(b => b.addEventListener('click', async () => {
      const d = this._deliverable(b.dataset.rtVisible)
      b.disabled = true
      await this._save(() => api.updateDeliverable(d.id, { client_visible: !d.client_visible }),
        d.client_visible ? 'Hidden from the client' : 'Shown to the client')
      b.disabled = false
    }))
  }

  // ── State ──────────────────────────────────────────────────────────────────

  _workstream(id) { return this.page?.workstreams.find(w => w.id === id) ?? null }
  _deliverable(id) {
    for (const w of this.page?.workstreams ?? []) {
      const d = w.deliverables.find(x => x.id === id)
      if (d) return d
    }
    return null
  }

  // Put a deliverable the server returned into the page (moving it if its
  // workstream changed).
  _putDeliverable(d) {
    for (const w of this.page.workstreams) w.deliverables = w.deliverables.filter(x => x.id !== d.id || w.id === d.workstream_id)
    const w = this._workstream(d.workstream_id)
    if (!w) return
    const i = w.deliverables.findIndex(x => x.id === d.id)
    if (i >= 0) w.deliverables[i] = d
    else w.deliverables.push(d)
    w.deliverables.sort((a, b) => a.sort_order - b.sort_order || String(a.created_at).localeCompare(String(b.created_at)))
  }

  // Run a change that returns the updated deliverable, then repaint. A 409
  // means someone else changed it first: reload the page so what's on screen
  // is true. Returns the deliverable, or null if it failed (after a toast).
  async _save(run, message) {
    try {
      const d = await run()
      if (d) this._putDeliverable(d)
      this._repaint()
      if (message) this.app.toast(message)
      return d ?? true
    } catch (err) {
      this.app.toast(err.message || 'Could not save')
      if (err.status === 409 || err.status === 404) this._reload()
      return null
    }
  }

  async _reload() {
    if (!this.projectId) return
    try { this.page = await api.getProjectPage(this.projectId); this._repaint() } catch { /* the toast already said */ }
  }

  // ── One-tap status ─────────────────────────────────────────────────────────

  _statusMenu(anchor, d) {
    const statuses = this.page.vocab.statuses
    const html = statuses.map(s => `
      <button type="button" class="dd-item rt-menu-item" role="menuitemradio" aria-checked="${s.key === d.status}" data-pick="${s.key}">
        <span class="rt-dot rt-dot--${s.key}" aria-hidden="true"></span>
        <span class="rt-menu-label">${esc(s.label)}</span>
        ${d.client_visible ? `<span class="rt-menu-hint">Client sees “${esc(s.client_label)}”</span>` : ''}
      </button>`).join('')
    openFloating({
      anchor, id: 'rt-status-menu', role: 'menu', label: `Status of ${d.title}`, className: 'dd rt-menu', html,
      onReady: (el, close) => el.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
        const to = b.dataset.pick
        close()
        if (to !== d.status) this._save(() => api.updateDeliverable(d.id, { status: to }), `${d.title}: ${statuses.find(s => s.key === to).label}`)
      })),
    })
  }

  _workstreamStatusMenu(anchor, w) {
    const html = this.page.vocab.workstream_statuses.map(s => `
      <button type="button" class="dd-item rt-menu-item" role="menuitemradio" aria-checked="${s.key === w.status}" data-pick="${s.key}">
        <span class="rt-dot rt-dot--ws-${s.key}" aria-hidden="true"></span><span class="rt-menu-label">${esc(s.label)}</span>
      </button>`).join('')
    openFloating({
      anchor, id: 'rt-ws-status-menu', role: 'menu', label: `Status of ${w.title}`, className: 'dd rt-menu', html,
      onReady: (el, close) => el.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', async () => {
        const to = b.dataset.pick
        close()
        if (to === w.status) return
        try {
          Object.assign(w, await api.updateWorkstream(w.id, { status: to }))
          this._repaint()
        } catch (err) { this.app.toast(err.message || 'Could not save') }
      })),
    })
  }

  // ── Paste and send ─────────────────────────────────────────────────────────

  _sendForm(anchor, d) {
    const next = (d.deliveries[d.deliveries.length - 1]?.round ?? 0) + 1
    const html = `
      <div class="lt-head"><h2 class="lt-title" id="rt-send-title">Send round ${next}</h2></div>
      <form class="tl-form" id="rt-send-form" novalidate>
        <p class="tl-hint rt-send-what">${esc(d.title)}</p>
        <div class="tl-field">
          <label for="rt-send-url">Link</label>
          <input type="url" id="rt-send-url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="Paste the Frame.io link" data-autofocus />
        </div>
        <div class="tl-field">
          <label for="rt-send-note">Note <span class="tl-optional">(optional — the client sees it)</span></label>
          <textarea id="rt-send-note" rows="2"></textarea>
        </div>
        ${d.client_visible ? '' : `<label class="rt-check"><input type="checkbox" id="rt-send-show" checked /> Show this deliverable to the client (it's hidden now)</label>`}
        <p class="tl-hint">It goes to the client as round ${next} and the deliverable moves to In review.</p>
        <div class="tl-msg" id="rt-send-msg" role="alert"></div>
        <button type="submit" class="btn-primary tl-submit">Send round ${next}</button>
      </form>`
    openFloating({
      anchor, id: 'rt-send', role: 'dialog', className: 'lt-pop rt-pop', html,
      onReady: (el, close) => {
        el.setAttribute('aria-labelledby', 'rt-send-title')
        fitInViewport(el)
        const form = el.querySelector('#rt-send-form')
        const msg = el.querySelector('#rt-send-msg')
        form.addEventListener('submit', async e => {
          e.preventDefault()
          const url = el.querySelector('#rt-send-url').value.trim()
          if (!url) { msg.dataset.tone = 'error'; msg.textContent = 'Paste the link to send'; el.querySelector('#rt-send-url').focus(); return }
          const submit = form.querySelector('[type="submit"]')
          submit.disabled = true
          msg.textContent = ''
          try {
            // Show it first: if sending then fails, a visible deliverable with no
            // new round is harmless; a new round the client can't see is not.
            if (el.querySelector('#rt-send-show')?.checked) this._putDeliverable(await api.updateDeliverable(d.id, { client_visible: true }))
            const { delivery, deliverable, notified } = await api.sendDelivery(d.id, { url, note: el.querySelector('#rt-send-note').value })
            this._putDeliverable(deliverable)
            close({ restoreFocus: false })
            this._repaint()
            this.el?.querySelector(`[data-focus-key="open-${d.id}"]`)?.focus()
            this.app.toast(`Round ${delivery.round} sent${notified?.message ? ` — ${notified.message}` : ''}`)
            this._fillPreview(delivery.id, d.id)
          } catch (err) {
            submit.disabled = false
            msg.dataset.tone = 'error'
            msg.textContent = err.message || 'Could not send'
            if (err.field === 'url') el.querySelector('#rt-send-url').focus()
            if (err.status === 409) this._reload()
          }
        })
      },
    })
  }

  // The preview is fetched after sending, so a slow link never holds it up.
  async _fillPreview(deliveryId, deliverableId) {
    try {
      const { preview } = await api.fillPreview(deliveryId)
      const r = this._deliverable(deliverableId)?.deliveries.find(x => x.id === deliveryId)
      if (preview && r) { r.preview_title = preview.title; r.preview_image = preview.image }
    } catch { /* the round is sent; a preview is a nicety */ }
  }

  // ── A deliverable's sheet: rounds, then details ────────────────────────────

  _deliverableSheet(anchor, id) {
    const d = this._deliverable(id)
    if (!d) return
    openFloating({
      anchor, id: 'rt-deliverable', role: 'dialog', className: 'lt-pop rt-pop rt-pop--wide', html: this._sheetHtml(d),
      onReady: (el, close) => {
        el.setAttribute('aria-labelledby', 'rt-sheet-title')
        this._bindSheet(el, close, d.id)
        fitInViewport(el)
      },
    })
  }

  _sheetHtml(d) {
    const rounds = [...d.deliveries].reverse()
    const latest = d.deliveries[d.deliveries.length - 1]
    return `
      <div class="lt-head rt-sheet-head">
        <h2 class="lt-title" id="rt-sheet-title">${esc(d.title)}</h2>
        <span class="rt-status rt-status--${d.status}">${esc(d.status_label)}</span>
      </div>
      <p class="tl-hint">${d.client_visible ? `Shown to the client as “${esc(d.client_status)}”.` : 'Hidden from the client.'}</p>
      <h3 class="rt-sheet-label section-label">Rounds</h3>
      ${rounds.length ? `<ol class="rt-rounds">${rounds.map(r => this._roundHtml(r, r === latest)).join('')}</ol>` : '<p class="tl-hint">Nothing sent yet.</p>'}
      ${this.canEdit && latest?.client_response === 'pending' ? this._answerFormHtml(latest) : ''}
      <h3 class="rt-sheet-label section-label">Details</h3>
      ${this.canEdit ? this._detailsFormHtml(d) : this._detailsReadHtml(d)}`
  }

  _roundHtml(r, isLatest) {
    const answer = r.client_response === 'pending'
      ? (isLatest ? 'Awaiting response' : 'Superseded')
      : `${r.response_label} ${r.responded_at ? dayMonth(r.responded_at) : ''}${r.responded_by_name ? ` by ${esc(r.responded_by_name)}` : ''}${r.responded_by_staff ? ' (recorded by Peny)' : ''}`
    return `
      <li class="rt-round rt-round--${r.client_response}${isLatest ? '' : ' rt-round--old'}">
        <div class="rt-round-top">
          <a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" class="rt-round-link">Round ${r.round}</a>
          <span class="rt-muted">sent ${dayMonth(r.sent_at)}${r.sent_by_name ? ` by ${esc(r.sent_by_name)}` : ''}</span>
        </div>
        ${r.note ? `<div class="rt-round-note">${esc(r.note)}</div>` : ''}
        <div class="rt-round-answer">${answer}</div>
        ${r.client_comment ? `<div class="rt-round-comment">“${esc(r.client_comment)}”</div>` : ''}
        ${this.canEdit && isLatest && r.client_response === 'pending' ? `<button type="button" class="rt-link-btn rt-danger" data-rt-unsend="${r.id}">Take back round ${r.round}</button>` : ''}
      </li>`
  }

  _answerFormHtml(latest) {
    return `
      <form class="tl-form rt-answer" id="rt-answer-form" data-delivery="${latest.id}" novalidate>
        <div class="tl-field">
          <span class="rt-field-label" id="rt-answer-label">Record the client's answer to round ${latest.round} <span class="tl-optional">(if it came by email or on a call)</span></span>
          <div class="seg" role="radiogroup" aria-labelledby="rt-answer-label">
            <button type="button" class="seg-btn" role="radio" aria-checked="false" data-answer="approved">Approved</button>
            <button type="button" class="seg-btn" role="radio" aria-checked="false" data-answer="changes_requested">Changes requested</button>
          </div>
        </div>
        <div class="tl-field" hidden data-answer-comment>
          <label for="rt-answer-comment">What they said</label>
          <textarea id="rt-answer-comment" rows="2"></textarea>
        </div>
        <div class="tl-msg" id="rt-answer-msg" role="alert"></div>
        <button type="submit" class="btn-secondary tl-submit" hidden>Save answer</button>
      </form>`
  }

  _detailsFormHtml(d) {
    const users = this.app.allUsers || []
    return `
      <form class="tl-form" id="rt-details-form" novalidate>
        <div class="tl-field"><label for="rt-f-title">Title</label><input id="rt-f-title" value="${esc(d.title)}" maxlength="300" /></div>
        <div class="tl-row">
          <div class="tl-field"><label for="rt-f-format">Format <span class="tl-optional">(optional)</span></label><input id="rt-f-format" value="${esc(d.format || '')}" placeholder="e.g. 16:9, 30s" /></div>
          <div class="tl-field"><label for="rt-f-owner">Owner</label>
            <select id="rt-f-owner"><option value="">Unassigned</option>${users.map(u => `<option value="${u.id}"${u.id === d.owner_id ? ' selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}</select></div>
        </div>
        ${dueFieldsHtml('rt-f', d, this.page.vocab)}
        <label class="rt-check"><input type="checkbox" id="rt-f-visible"${d.client_visible ? ' checked' : ''} /> Show to the client</label>
        ${d.status === 'waiting_on_client' ? `
          <div class="tl-field"><label for="rt-f-waiting">What we need from them <span class="tl-optional">(the client sees this)</span></label>
            <textarea id="rt-f-waiting" rows="2">${esc(d.waiting_note || '')}</textarea></div>` : ''}
        <div class="tl-field"><label for="rt-f-notes">Internal notes <span class="tl-optional">(never shown to the client)</span></label>
          <textarea id="rt-f-notes" rows="3">${esc(d.internal_notes || '')}</textarea></div>
        <div class="tl-msg" id="rt-details-msg" role="alert"></div>
        <button type="submit" class="btn-primary tl-submit">Save</button>
        ${d.deliveries.length ? '' : '<button type="button" class="rt-link-btn rt-danger" data-rt-delete-d>Delete this deliverable</button>'}
      </form>`
  }

  _detailsReadHtml(d) {
    const rows = [
      ['Format', d.format], ['Owner', d.owner_name || 'Unassigned'], ['Due', d.due_display],
      d.status === 'waiting_on_client' && ['Waiting for', d.waiting_note], ['Internal notes', d.internal_notes],
    ].filter(r => r && r[1])
    return `<dl class="rt-read">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`
  }

  _bindSheet(el, close, id) {
    const d = () => this._deliverable(id)
    const refresh = () => {
      const current = d()
      if (!current) { close(); return }
      // Keep the sheet's chrome (grab handle, close button); replace the content.
      const body = el.classList.contains('sheet') ? el.querySelector('.sheet-body') : el
      body.innerHTML = this._sheetHtml(current)
      this._bindSheet(el, close, id)
    }
    bindDueFields(el, 'rt-f')

    // Take back the latest round.
    el.querySelector('[data-rt-unsend]')?.addEventListener('click', async e => {
      const r = d().deliveries.find(x => x.id === e.currentTarget.dataset.rtUnsend)
      if (!confirm(`Take back round ${r.round}? The client won't see it any more.`)) return
      if (await this._save(() => api.unsendDelivery(r.id), `Round ${r.round} taken back`)) refresh()
    })

    // Record an answer that came another way.
    const answer = el.querySelector('#rt-answer-form')
    if (answer) {
      let picked = null
      const comment = answer.querySelector('[data-answer-comment]')
      const submit = answer.querySelector('[type="submit"]')
      answer.querySelectorAll('[data-answer]').forEach(b => b.addEventListener('click', () => {
        picked = b.dataset.answer
        answer.querySelectorAll('[data-answer]').forEach(x => x.setAttribute('aria-checked', String(x === b)))
        comment.hidden = false
        comment.querySelector('label').textContent = picked === 'approved' ? 'What they said (optional)' : 'What needs to change'
        submit.hidden = false
      }))
      answer.addEventListener('submit', async e => {
        e.preventDefault()
        if (!picked) return
        submit.disabled = true
        const msg = answer.querySelector('#rt-answer-msg')
        try {
          this._putDeliverable(await api.recordResponse(answer.dataset.delivery, { response: picked, comment: answer.querySelector('#rt-answer-comment').value }))
          this._repaint()
          this.app.toast(picked === 'approved' ? 'Recorded: approved' : 'Recorded: changes requested')
          refresh()
        } catch (err) {
          submit.disabled = false
          msg.dataset.tone = 'error'
          msg.textContent = err.message || 'Could not save'
          if (err.status === 409) this._reload().then(refresh)
        }
      })
    }

    // Details.
    const form = el.querySelector('#rt-details-form')
    if (!form) return
    form.addEventListener('submit', async e => {
      e.preventDefault()
      const current = d()
      const msg = form.querySelector('#rt-details-msg')
      const changes = {}
      const title = form.querySelector('#rt-f-title').value.trim()
      if (title !== current.title) changes.title = title
      const format = form.querySelector('#rt-f-format').value.trim() || null
      if (format !== (current.format || null)) changes.format = format
      const owner = form.querySelector('#rt-f-owner').value || null
      if (owner !== (current.owner_id || null)) changes.owner_id = owner
      const due = readDueFields(form, 'rt-f')
      if (dueChanged(due, current)) Object.assign(changes, due)
      const visible = form.querySelector('#rt-f-visible').checked
      if (visible !== current.client_visible) changes.client_visible = visible
      const waiting = form.querySelector('#rt-f-waiting')
      if (waiting && (waiting.value.trim() || null) !== (current.waiting_note || null)) changes.waiting_note = waiting.value
      const notes = form.querySelector('#rt-f-notes').value.trim() || null
      if (notes !== (current.internal_notes || null)) changes.internal_notes = notes
      if (!Object.keys(changes).length) { close(); return }

      const submit = form.querySelector('[type="submit"]')
      submit.disabled = true
      msg.textContent = ''
      try {
        this._putDeliverable(await api.updateDeliverable(current.id, changes))
        close({ restoreFocus: false })
        this._repaint()
        this.el?.querySelector(`[data-focus-key="open-${current.id}"]`)?.focus()
        this.app.toast('Saved')
      } catch (err) {
        submit.disabled = false
        msg.dataset.tone = 'error'
        msg.textContent = err.message || 'Could not save'
        if (err.field) form.querySelector(`#rt-f-${FIELD_INPUTS[err.field] || err.field}`)?.focus()
        if (err.status === 409) this._reload().then(refresh)
      }
    })

    form.querySelector('[data-rt-delete-d]')?.addEventListener('click', async () => {
      const current = d()
      if (!confirm(`Delete “${current.title}”?`)) return
      try {
        await api.deleteDeliverable(current.id)
        for (const w of this.page.workstreams) w.deliverables = w.deliverables.filter(x => x.id !== current.id)
        close({ restoreFocus: false })
        this._repaint()
        this.app.toast('Deleted')
      } catch (err) {
        this.app.toast(err.message || 'Could not delete')
        if (err.status === 409) this._reload().then(refresh)
      }
    })
  }

  // ── New deliverable ────────────────────────────────────────────────────────

  _deliverableForm(anchor, { workstream }) {
    const users = this.app.allUsers || []
    const html = `
      <div class="lt-head"><h2 class="lt-title" id="rt-new-d-title">New deliverable</h2></div>
      <form class="tl-form" id="rt-new-d-form" novalidate>
        <p class="tl-hint rt-send-what">In ${esc(workstream.title)}</p>
        <div class="tl-field"><label for="rt-n-title">Title</label><input id="rt-n-title" maxlength="300" data-autofocus /></div>
        <div class="tl-row">
          <div class="tl-field"><label for="rt-n-format">Format <span class="tl-optional">(optional)</span></label><input id="rt-n-format" placeholder="e.g. 16:9, 30s" /></div>
          <div class="tl-field"><label for="rt-n-owner">Owner</label>
            <select id="rt-n-owner"><option value="">Unassigned</option>${users.map(u => `<option value="${u.id}"${u.id === this.app.appUser?.id ? ' selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}</select></div>
        </div>
        ${dueFieldsHtml('rt-n', {}, this.page.vocab)}
        <label class="rt-check"><input type="checkbox" id="rt-n-visible" /> Show to the client</label>
        <p class="tl-hint">Hidden from the client until you show it.</p>
        <div class="tl-msg" id="rt-new-d-msg" role="alert"></div>
        <button type="submit" class="btn-primary tl-submit">Add deliverable</button>
      </form>`
    openFloating({
      anchor, id: 'rt-new-d', role: 'dialog', className: 'lt-pop rt-pop', html,
      onReady: (el, close) => {
        el.setAttribute('aria-labelledby', 'rt-new-d-title')
        bindDueFields(el, 'rt-n')
        fitInViewport(el)
        const form = el.querySelector('#rt-new-d-form')
        form.addEventListener('submit', async e => {
          e.preventDefault()
          const msg = form.querySelector('#rt-new-d-msg')
          const submit = form.querySelector('[type="submit"]')
          submit.disabled = true
          msg.textContent = ''
          try {
            const d = await api.createDeliverable({
              workstream_id: workstream.id,
              title: form.querySelector('#rt-n-title').value,
              format: form.querySelector('#rt-n-format').value,
              owner_id: form.querySelector('#rt-n-owner').value || null,
              client_visible: form.querySelector('#rt-n-visible').checked,
              ...readDueFields(form, 'rt-n'),
            })
            this._putDeliverable(d)
            close({ restoreFocus: false })
            this._repaint()
            this.el?.querySelector(`[data-focus-key="add-d-${workstream.id}"]`)?.focus()
            this.app.toast(`Added ${d.title}`)
          } catch (err) {
            submit.disabled = false
            msg.dataset.tone = 'error'
            msg.textContent = err.message || 'Could not add it'
            if (err.field) form.querySelector(`#rt-n-${FIELD_INPUTS[err.field] || err.field}`)?.focus()
          }
        })
      },
    })
  }

  // ── Workstreams ────────────────────────────────────────────────────────────

  _workstreamForm(anchor, w) {
    const html = `
      <div class="lt-head"><h2 class="lt-title" id="rt-ws-form-title">${w ? 'Edit workstream' : 'New workstream'}</h2></div>
      <form class="tl-form" id="rt-ws-form" novalidate>
        <div class="tl-field"><label for="rt-w-title">Title</label><input id="rt-w-title" maxlength="300" value="${esc(w?.title || '')}" placeholder="e.g. Edit days" data-autofocus /></div>
        <div class="tl-field"><label for="rt-w-brief">Brief <span class="tl-optional">(optional — the client sees it)</span></label><textarea id="rt-w-brief" rows="3">${esc(w?.brief || '')}</textarea></div>
        <div class="tl-msg" id="rt-ws-msg" role="alert"></div>
        <button type="submit" class="btn-primary tl-submit">${w ? 'Save' : 'Add workstream'}</button>
        ${w && !w.deliverables.some(d => d.deliveries.length) ? '<button type="button" class="rt-link-btn rt-danger" data-rt-delete-ws>Delete this workstream</button>' : ''}
      </form>`
    openFloating({
      anchor, id: 'rt-ws-form-pop', role: 'dialog', className: 'lt-pop rt-pop', html,
      onReady: (el, close) => {
        el.setAttribute('aria-labelledby', 'rt-ws-form-title')
        fitInViewport(el)
        const form = el.querySelector('#rt-ws-form')
        form.addEventListener('submit', async e => {
          e.preventDefault()
          const msg = form.querySelector('#rt-ws-msg')
          const submit = form.querySelector('[type="submit"]')
          const body = { title: form.querySelector('#rt-w-title').value, brief: form.querySelector('#rt-w-brief').value }
          submit.disabled = true
          msg.textContent = ''
          try {
            if (w) {
              Object.assign(w, await api.updateWorkstream(w.id, body))
            } else {
              this.page.workstreams.push(await api.createWorkstream({ ...body, project_id: this.projectId }))
            }
            close({ restoreFocus: false })
            this._repaint()
            this._refreshCount()
            this.app.toast(w ? 'Saved' : 'Workstream added')
          } catch (err) {
            submit.disabled = false
            msg.dataset.tone = 'error'
            msg.textContent = err.message || 'Could not save'
          }
        })
        form.querySelector('[data-rt-delete-ws]')?.addEventListener('click', async () => {
          if (!confirm(`Delete “${w.title}”${w.deliverables.length ? ` and its ${count(w.deliverables.length, 'deliverable')}` : ''}?`)) return
          try {
            await api.deleteWorkstream(w.id)
            this.page.workstreams = this.page.workstreams.filter(x => x.id !== w.id)
            close({ restoreFocus: false })
            this._repaint()
            this._refreshCount()
            this.app.toast('Deleted')
          } catch (err) { this.app.toast(err.message || 'Could not delete') }
        })
      },
    })
  }

  // ── The project's client link (editors) ────────────────────────────────────
  // /portal/<token>: anyone holding it sees what is shown to the client on this
  // project and can send requests (with a name, marked as sent via the link,
  // capped, and only until the project is Delivered). It can't approve or
  // reply; approvals go by the emailed one-time link or a login. Forwardable,
  // so it can be replaced (the old one stops working) or switched off.

  // `projectId` is passed because the project page's header button opens this
  // too, whether or not the Worklist tab is showing. `onChange(hasLink)` lets
  // the opener update its own label.
  openLinkPanel(anchor, projectId, { onChange } = {}) {
    const known = () => (this.app.projects || []).find(p => p.id === projectId)
    const render = () => {
      const token = known()?.portal_token || null
      const url = token ? `${location.origin}/portal/${token}` : ''
      return `
        <div class="lt-head"><h2 class="lt-title" id="rt-link-title">Client link</h2></div>
        <div class="tl-form">
          <p class="tl-hint">Anyone with the link can see what you’ve shown the client on this project, and send a request (they give their name; it isn’t checked, and requests land in triage). They can’t approve anything.</p>
          ${token ? `
            <div class="tl-field"><label for="rt-link-url">Link</label><input id="rt-link-url" readonly value="${esc(url)}" /></div>
            <div class="tl-msg" id="rt-link-msg" role="alert"></div>
            <button type="button" class="btn-primary tl-submit" data-link-copy>Copy link</button>
            <button type="button" class="rt-link-btn" data-link-act="replace">Replace it — the old link stops working</button>
            <button type="button" class="rt-link-btn rt-danger" data-link-act="off">Turn the link off</button>`
          : `
            <p class="tl-hint">There is no link for this project.</p>
            <div class="tl-msg" id="rt-link-msg" role="alert"></div>
            <button type="button" class="btn-primary tl-submit" data-link-act="create">Create a link</button>`}
        </div>`
    }
    openFloating({
      anchor, id: 'rt-link', role: 'dialog', className: 'lt-pop rt-pop rt-pop--wide', html: render(),
      onReady: el => {
        el.setAttribute('aria-labelledby', 'rt-link-title')
        const bind = () => {
          el.querySelector('[data-link-copy]')?.addEventListener('click', async e => {
            try { await navigator.clipboard.writeText(el.querySelector('#rt-link-url').value); e.currentTarget.textContent = '✓ Copied' }
            catch { el.querySelector('#rt-link-url').select() }
          })
          el.querySelectorAll('[data-link-act]').forEach(b => b.addEventListener('click', async () => {
            const act = b.dataset.linkAct
            if (act === 'replace' && !confirm('Replace the link? Anyone using the old one loses access straight away.')) return
            if (act === 'off' && !confirm('Turn the link off? Anyone using it loses access straight away.')) return
            b.disabled = true
            try {
              const { token } = await api.setProjectLink(projectId, act)
              if (known()) known().portal_token = token
              if (this.page?.project.id === projectId) { this.page.project.has_link = !!token; this._repaint() }
              onChange?.(!!token)
              const body = el.classList.contains('sheet') ? el.querySelector('.sheet-body') : el
              body.innerHTML = render()
              bind()
              this.app.toast({ create: 'Link created', replace: 'New link made — the old one no longer works', off: 'Link turned off' }[act])
            } catch (err) {
              b.disabled = false
              const msg = el.querySelector('#rt-link-msg')
              if (msg) { msg.dataset.tone = 'error'; msg.textContent = err.message || 'Could not do that' }
            }
          }))
        }
        bind()
      },
    })
  }

  // ── Portal access (superadmins) ────────────────────────────────────────────
  // Who from this company can sign in to the client portal. Backed by the
  // company's Clerk organisation (api/_portal-access.js).

  _portalPanel(anchor) {
    const company = this.page.company
    openFloating({
      anchor, id: 'rt-portal', role: 'dialog', className: 'lt-pop rt-pop rt-pop--wide',
      html: `<div class="lt-head"><h2 class="lt-title" id="rt-portal-title">Portal access · ${esc(company.name)}</h2></div>
        <div data-portal-body><p class="tl-hint">Loading…</p></div>`,
      onReady: el => {
        el.setAttribute('aria-labelledby', 'rt-portal-title')
        this._loadPortal(el, company)
      },
    })
  }

  async _loadPortal(el, company) {
    const body = el.querySelector('[data-portal-body]')
    try {
      const state = await getPortalAccess(company.id)
      if (el.isConnected) this._paintPortal(el, company, state)
    } catch (err) {
      if (el.isConnected) body.innerHTML = `<p class="tl-msg" data-tone="error">${esc(err.message || 'Could not load portal access')}</p>`
    }
  }

  _paintPortal(el, company, { portal, invites_enabled }) {
    const body = el.querySelector('[data-portal-body]')
    if (!portal) {
      body.innerHTML = `
        <p class="tl-hint">${esc(company.name)} has no client portal yet. Setting it up makes a Clerk organisation for them; nobody is in it until you invite someone.</p>
        <div class="tl-msg" id="rt-portal-msg" role="alert"></div>
        <button type="button" class="btn-primary tl-submit" data-portal-setup>Set up the portal</button>`
      body.querySelector('[data-portal-setup]').addEventListener('click', async e => {
        e.currentTarget.disabled = true
        try {
          const state = await setUpPortal(company.id)
          company.portal = true
          this._repaint()
          if (el.isConnected) this._paintPortal(el, company, state)
        } catch (err) {
          e.currentTarget.disabled = false
          const msg = body.querySelector('#rt-portal-msg')
          msg.dataset.tone = 'error'
          msg.textContent = err.message || 'Could not set it up'
        }
      })
      return
    }

    const person = (main, sub, action) => `
      <li class="rt-person"><span class="rt-person-main"><span class="rt-person-name">${main}</span>${sub ? `<span class="rt-muted">${sub}</span>` : ''}</span>${action}</li>`
    body.innerHTML = `
      <p class="tl-hint">People here sign in with a code sent to their email. They see the deliverables you show to ${esc(company.name)}, and can approve rounds.</p>
      <h3 class="rt-sheet-label section-label">People</h3>
      ${portal.members.length
        ? `<ul class="rt-people">${portal.members.map(m => person(esc(m.name || m.email), m.name ? esc(m.email) : '',
            `<button type="button" class="rt-link-btn rt-danger" data-remove="${esc(m.user_id)}" data-who="${esc(m.name || m.email)}">Remove</button>`)).join('')}</ul>`
        : '<p class="tl-hint">Nobody yet.</p>'}
      ${portal.invitations.length ? `
        <h3 class="rt-sheet-label section-label">Invited</h3>
        <ul class="rt-people">${portal.invitations.map(i => person(esc(i.email), i.sent_at ? `Invited ${dayMonth(i.sent_at)}` : '',
          `<button type="button" class="rt-link-btn rt-danger" data-revoke="${esc(i.id)}" data-who="${esc(i.email)}">Revoke</button>`)).join('')}</ul>` : ''}
      <form class="tl-form rt-invite" id="rt-invite-form" novalidate>
        <div class="tl-field"><label for="rt-invite-email">Invite someone from ${esc(company.name)}</label>
          <input type="email" id="rt-invite-email" autocomplete="off" spellcheck="false" placeholder="name@example.com"${invites_enabled ? '' : ' disabled'} /></div>
        ${invites_enabled ? '' : '<p class="tl-hint rt-warn">Client logins stay switched off until the database access fix is live. Turning them on is a setting: PORTAL_INVITES_ENABLED.</p>'}
        <div class="tl-msg" id="rt-invite-msg" role="alert"></div>
        <button type="submit" class="btn-primary tl-submit"${invites_enabled ? '' : ' disabled'}>Send invitation</button>
      </form>`

    const reload = () => this._loadPortal(el, company)
    body.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm(`Remove ${b.dataset.who} from the portal? They lose access straight away.`)) return
      b.disabled = true
      try { await removePortalMember(company.id, b.dataset.remove); this.app.toast('Removed'); reload() }
      catch (err) { b.disabled = false; this.app.toast(err.message || 'Could not remove them') }
    }))
    body.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm(`Revoke the invitation to ${b.dataset.who}?`)) return
      b.disabled = true
      try { await revokePortalInvitation(company.id, b.dataset.revoke); this.app.toast('Invitation revoked'); reload() }
      catch (err) { b.disabled = false; this.app.toast(err.message || 'Could not revoke it') }
    }))
    const form = body.querySelector('#rt-invite-form')
    form.addEventListener('submit', async e => {
      e.preventDefault()
      const input = form.querySelector('#rt-invite-email')
      const msg = form.querySelector('#rt-invite-msg')
      const submit = form.querySelector('[type="submit"]')
      if (!input.value.trim()) { msg.dataset.tone = 'error'; msg.textContent = 'Enter their email address'; input.focus(); return }
      submit.disabled = true
      msg.textContent = ''
      try {
        const inv = await inviteToPortal(company.id, input.value)
        this.app.toast(`Invitation sent to ${inv.email}`)
        reload()
      } catch (err) {
        submit.disabled = false
        msg.dataset.tone = 'error'
        msg.textContent = err.message || 'Could not send it'
        input.focus()
      }
    })
  }

}

// ── Due fields (shared by the new and edit forms) ────────────────────────────

// Errors from the server name the field; this maps them to the input.
const FIELD_INPUTS = { title: 'title', format: 'format', owner_id: 'owner', due_kind: 'kind', due_date: 'date', due_month: 'month', due_label: 'words', cadence: 'cadence', waiting_note: 'waiting', internal_notes: 'notes' }

function dueFieldsHtml(prefix, d, vocab) {
  const kind = d.due_kind || 'exact'
  return `
    <div class="tl-row">
      <div class="tl-field"><label for="${prefix}-kind">Due</label>
        <select id="${prefix}-kind">${vocab.due_kinds.map(k => `<option value="${k}"${k === kind ? ' selected' : ''}>${DUE_KIND_LABELS[k] || k}</option>`).join('')}</select></div>
      <div class="tl-field" data-due-show="exact window recurring"><label for="${prefix}-date">${DATE_LABELS[kind] || 'Date'}</label><input type="date" id="${prefix}-date" value="${esc(kind === 'month' ? '' : d.due_date || '')}" /></div>
      <div class="tl-field" data-due-show="month"><label for="${prefix}-month">Month</label><input type="month" id="${prefix}-month" value="${esc(kind === 'month' ? (d.due_date || '').slice(0, 7) : '')}" /></div>
    </div>
    <div class="tl-row">
      <div class="tl-field" data-due-show="recurring"><label for="${prefix}-cadence">How often</label>
        <select id="${prefix}-cadence">${vocab.cadences.map(c => `<option value="${c.key}"${c.key === (d.cadence || 'monthly') ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
      <div class="tl-field"><label for="${prefix}-words">In words <span class="tl-optional">(optional)</span></label><input id="${prefix}-words" value="${esc(d.due_label || '')}" placeholder="e.g. 1st week of November" /></div>
    </div>`
}

function bindDueFields(root, prefix) {
  const kind = root.querySelector(`#${prefix}-kind`)
  if (!kind) return
  const sync = () => {
    root.querySelectorAll('[data-due-show]').forEach(f => { f.hidden = !f.dataset.dueShow.split(' ').includes(kind.value) })
    const label = root.querySelector(`label[for="${prefix}-date"]`)
    if (label) label.textContent = DATE_LABELS[kind.value] || 'Date'
  }
  kind.addEventListener('change', sync)
  sync()
}

function readDueFields(root, prefix) {
  const kind = root.querySelector(`#${prefix}-kind`).value
  const words = root.querySelector(`#${prefix}-words`).value.trim() || null
  if (kind === 'month') return { due_kind: kind, due_month: root.querySelector(`#${prefix}-month`).value || null, due_label: words }
  return {
    due_kind: kind,
    due_date: root.querySelector(`#${prefix}-date`).value || null,
    due_label: words,
    cadence: kind === 'recurring' ? root.querySelector(`#${prefix}-cadence`).value : null,
  }
}

function dueChanged(due, d) {
  if (due.due_kind !== d.due_kind || (due.due_label || null) !== (d.due_label || null)) return true
  if (due.due_kind === 'month') return due.due_month !== (d.due_date || '').slice(0, 7)
  return (due.due_date || null) !== (d.due_date || null) || (due.cadence || null) !== (d.cadence || null)
}
