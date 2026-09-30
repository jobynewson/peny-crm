// src/views/requests.js
// Requests (its own tab in the header, with a count of new ones): where a client's request gets its owner and its date.
// #requests is the inbox; #requests/<id> is one request on one screen: read
// it, then accept it (pick or make the workstream, set an owner and a date) or
// decline it (a note the client will read).
//
// Deliberately not a second to-do list. Accepting creates the deliverable and
// the request is history from then on; the work lives on the task board and in
// What's due, and this page never holds any of it.
//
// Data travels only through /api/retainers/requests (src/api/requests.js); the
// server decides everything, this page draws it.

import * as api from '../api/requests.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LONDON_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
const dayMonth = iso => { const [, m, d] = LONDON_DAY.format(new Date(iso)).split('-').map(Number); return `${d} ${MONTHS[m - 1]}` }

// The client's text with its http(s) links clickable; escaped first.
const linkify = text => esc(text).replace(/https?:\/\/[^\s<]+/g, match => {
  const url = match.replace(/(?:[.,;:!?)]|&amp;)+$/, '')
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${match.slice(url.length)}`
})

const TABS = [['new', 'New'], ['accepted', 'Accepted'], ['declined', 'Declined']]

export class RequestsView {
  constructor(app) {
    this.app = app
    this.currentId = null      // the request on show, or null for the inbox
    this.status = 'new'        // the inbox's tab
    this.list = null
    this.detail = null
    this._seq = 0              // drops responses for a page no longer on show
  }

  get canEdit() { return this.app.permissions?.projects_edit === true }

  toolbar() { return { filters: '', actions: '' } }

  render(mc) {
    if (this.currentId) this._renderRequest(mc)
    else this._renderInbox(mc)
  }

  open(id) { this.app.openLink(id ? `#requests/${id}` : '#requests') }

  _bindLinks(mc) {
    mc.querySelectorAll('a[data-rq-open]').forEach(a => a.addEventListener('click', e => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      this.open(a.dataset.rqOpen)
    }))
    mc.querySelectorAll('a[data-rq-link]').forEach(a => a.addEventListener('click', e => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      this.app.openLink(a.dataset.rqLink)
    }))
  }

  // ── The inbox ──────────────────────────────────────────────────────────────

  async _renderInbox(mc) {
    const seq = ++this._seq
    if (this.list?.status === this.status) this._paintInbox(mc)
    else mc.innerHTML = '<div class="rt-empty">Loading…</div>'
    let list
    try {
      list = await api.listRequests(this.status)
    } catch (err) {
      if (seq === this._seq && mc.isConnected) mc.innerHTML = `<div class="rt-empty rt-error">Couldn't load requests. ${esc(err.message)}</div>`
      return
    }
    if (seq !== this._seq || !mc.isConnected) return
    this.list = list
    this._paintInbox(mc)
  }

  _paintInbox(mc) {
    const { requests, counts } = this.list
    this.app.requestCount = counts.new
    this.app.header?.refreshRequests()
    const tabs = TABS.map(([key, label]) => `
      <button type="button" class="seg-btn" data-rq-tab="${key}"${key === this.status ? ' aria-current="page"' : ''}>${label}${counts[key] ? ` <span class="rq-count">${counts[key]}</span>` : ''}</button>`).join('')
    const empty = {
      new: `Nothing waiting. A new request from a client shows here, and reaches ${this.app.settings?.show_leads ? 'the company’s lead' : 'the superadmins'} by email.`,
      accepted: 'No accepted requests yet.',
      declined: 'No declined requests.',
    }[this.status]
    mc.innerHTML = `
      <div class="rq-tabs"><nav class="seg" aria-label="Requests">${tabs}</nav></div>
      ${requests.length
        ? `<div class="rt-cos">${requests.map(r => this._rowHtml(r)).join('')}</div>`
        : `<div class="rt-empty"><p>${empty}</p></div>`}`
    mc.querySelectorAll('[data-rq-tab]').forEach(b => b.addEventListener('click', () => {
      this.status = b.dataset.rqTab
      this._renderInbox(mc)
    }))
    this._bindLinks(mc)
  }

  _rowHtml(r) {
    const meta = [
      `Sent ${dayMonth(r.sent_at)}${r.sent_by ? ` by ${esc(r.sent_by)}` : ''}`,
      r.wanted_by_display ? `wanted by ${esc(r.wanted_by_display)}` : null,
      r.status === 'declined' && r.decided_at ? `declined ${dayMonth(r.decided_at)}` : null,
      r.status === 'accepted' && r.decided_at ? `accepted ${dayMonth(r.decided_at)}${r.decided_by ? ` by ${esc(r.decided_by)}` : ''}` : null,
    ].filter(Boolean).join(' · ')
    const where = r.project && r.project !== r.company ? `${esc(r.company)} · ${esc(r.project)}` : esc(r.company)
    return `
      <a class="rt-co" href="#requests/${r.id}" data-rq-open="${r.id}">
        <span class="rt-co-main">
          <span class="rt-co-name">${esc(r.title)}</span>
          <span class="rt-co-meta">${where} · ${meta}</span>
        </span>
        <span class="rt-co-pills">${r.source === 'link' ? `<span class="rt-pill rt-pill--waiting">${esc(r.source_label)}</span>` : ''}<span class="rt-pill">${esc(r.status_label)}</span></span>
      </a>`
  }

  // ── One request ────────────────────────────────────────────────────────────

  async _renderRequest(mc) {
    const seq = ++this._seq
    const id = this.currentId
    if (this.detail?.request.id === id) this._paintRequest(mc)
    else mc.innerHTML = '<div class="rt-empty">Loading…</div>'
    let detail
    try {
      detail = await api.getRequest(id)
    } catch (err) {
      if (seq !== this._seq || !mc.isConnected) return
      mc.innerHTML = err.status === 404
        ? `<div class="rt-empty"><p>This request isn't in Slate any more.</p><a class="btn-cancel" href="#requests" data-rq-open="">← Requests</a></div>`
        : `<div class="rt-empty rt-error">Couldn't load this request. ${esc(err.message)}</div>`
      this._bindLinks(mc)
      return
    }
    if (seq !== this._seq || !mc.isConnected) return
    this.detail = detail
    this._paintRequest(mc)
  }

  _paintRequest(mc) {
    const { request: r } = this.detail
    mc.innerHTML = `
      <div class="rt-head">
        <a class="btn-cancel rt-back" id="rq-back" href="#requests" data-rq-open="">← Requests</a>
        <div class="rt-head-main">
          <h1 class="rt-title">${esc(r.title)}</h1>
          <div class="rt-summary">
            ${r.project_id
              ? `<a href="#projects/${r.project_id}/worklist" data-rq-link="#projects/${r.project_id}/worklist">${esc(r.project)}</a>${r.company && r.company !== r.project ? ` · ${esc(r.company)}` : ''}`
              : esc(r.company)}
            · sent ${dayMonth(r.sent_at)}${r.sent_by ? ` by ${esc(r.sent_by)}` : ''}
            ${r.wanted_by_display ? ` · wanted by ${esc(r.wanted_by_display)}` : ''}
            · <span class="rt-chip">${esc(r.status_label)}</span>
          </div>
        </div>
      </div>
      <div class="rq-screen">
        <section class="rq-card" aria-label="The request">
          ${r.source === 'link' ? '<p class="rt-muted"><strong>Sent via the project link.</strong> Whoever opened the link typed the name, and it is not checked.</p>' : ''}
          ${r.detail ? `<p class="rq-detail">${linkify(r.detail)}</p>` : '<p class="rt-muted">No more detail than the title.</p>'}
        </section>
        ${r.status === 'new' ? (this.canEdit ? this._decideHtml() : '<p class="rt-muted">You can read requests, but only editors can answer them.</p>') : this._decidedHtml(r)}
      </div>`
    this._bindLinks(mc)
    if (r.status === 'new' && this.canEdit) this._bindDecide(mc)
  }

  _decidedHtml(r) {
    const when = r.decided_at ? ` on ${dayMonth(r.decided_at)}` : ''
    const who = r.decided_by ? ` by ${esc(r.decided_by)}` : ''
    if (r.status === 'accepted') {
      return `<section class="rq-card"><p><strong>Accepted</strong>${when}${who}. It is now a deliverable on the client's worklist, and on the owner's task board.</p>
        ${r.worklist_link ? `<p><a class="btn-primary" href="${esc(r.worklist_link)}" data-rq-link="${esc(r.worklist_link)}">Open it on the project</a></p>` : ''}</section>`
    }
    return `<section class="rq-card"><p><strong>Declined</strong>${when}${who}. The client sees this note:</p>
      <p class="rq-detail">${linkify(r.decline_note || '')}</p></section>`
  }

  _decideHtml() {
    const { request: r, projects } = this.detail
    const workstreams = (projects[0]?.workstreams) ?? []
    const users = this.app.allUsers || []
    const lead = this.app.settings?.show_leads && r.lead_id && users.some(u => u.id === r.lead_id) ? r.lead_id : ''
    return `
      <section class="rq-card" aria-labelledby="rq-accept-h">
        <h2 class="rq-h" id="rq-accept-h">Accept</h2>
        <p class="tl-hint">Accepting adds it to the client's worklist and puts it on the owner's task board, owned and dated. Nothing is left waiting here.</p>
        ${projects.length ? '' : '<p class="tl-msg" data-tone="error">There is no project for this client yet. Make one in Projects, then come back to accept this.</p>'}
        <form class="tl-form" id="rq-accept" novalidate>
          <div class="tl-field"${projects.length === 1 ? ' hidden' : ''}><label for="rq-project">Project</label>
            <select id="rq-project">${projects.map(p => `<option value="${p.id}">${esc(p.name)}${p.is_retainer ? ' (retainer)' : ''}</option>`).join('')}</select></div>
          <div class="tl-field"><label for="rq-ws">Workstream</label>
            <select id="rq-ws">
              ${workstreams.map(w => `<option value="${w.id}">${esc(w.title)}</option>`).join('')}
              <option value="__new"${workstreams.length ? '' : ' selected'}>+ A new workstream…</option>
            </select></div>
          <div class="tl-field" id="rq-newws-field" ${workstreams.length ? 'hidden' : ''}><label for="rq-newws">New workstream</label>
            <input id="rq-newws" maxlength="300" placeholder="e.g. Launch extras" /></div>
          <div class="tl-field"><label for="rq-owner">Owner</label>
            <select id="rq-owner"><option value="">Choose who will do it</option>${users.map(u => `<option value="${u.id}"${u.id === lead ? ' selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}</select></div>
          <div class="tl-field"><label for="rq-due">Date</label>
            <input id="rq-due" type="date" value="${esc(r.wanted_by || '')}" />
            ${r.wanted_by_display ? `<span class="tl-hint">They asked for ${esc(r.wanted_by_display)}. The date you set is the one they will see.</span>` : ''}</div>
          <div class="tl-field"><label for="rq-title">Title on the worklist</label>
            <input id="rq-title" maxlength="300" value="${esc(r.title)}" /></div>
          <div class="tl-msg" id="rq-accept-msg" role="alert"></div>
          <button type="submit" class="btn-primary tl-submit"${projects.length ? '' : ' disabled'}>Accept and add to their worklist</button>
        </form>
      </section>
      <section class="rq-card" aria-labelledby="rq-decline-h">
        <h2 class="rq-h" id="rq-decline-h">Decline</h2>
        <p class="tl-hint">A line or two. The client will read it in their portal.</p>
        <form class="tl-form" id="rq-decline" novalidate>
          <div class="tl-field"><label for="rq-note">Note to the client</label>
            <textarea id="rq-note" rows="3" maxlength="1000"></textarea></div>
          <div class="tl-msg" id="rq-decline-msg" role="alert"></div>
          <button type="submit" class="btn-secondary tl-submit">Decline</button>
        </form>
      </section>`
  }

  _bindDecide(mc) {
    const { request: r, projects } = this.detail
    const wsSelect = mc.querySelector('#rq-ws')
    const newField = mc.querySelector('#rq-newws-field')
    const projectSelect = mc.querySelector('#rq-project')
    // The workstreams offered are the chosen project's.
    const fillWorkstreams = () => {
      const list = projects.find(p => p.id === projectSelect?.value)?.workstreams ?? []
      wsSelect.innerHTML = `${list.map(w => `<option value="${w.id}">${esc(w.title)}</option>`).join('')}<option value="__new"${list.length ? '' : ' selected'}>+ A new workstream…</option>`
      newField.hidden = wsSelect.value !== '__new'
    }
    projectSelect?.addEventListener('change', fillWorkstreams)
    wsSelect.addEventListener('change', () => {
      newField.hidden = wsSelect.value !== '__new'
      if (!newField.hidden) mc.querySelector('#rq-newws').focus()
    })
    const message = (el, text) => { el.dataset.tone = 'error'; el.textContent = text }

    const accept = mc.querySelector('#rq-accept')
    accept.addEventListener('submit', async e => {
      e.preventDefault()
      const msg = accept.querySelector('#rq-accept-msg')
      const creating = wsSelect.value === '__new'
      const body = {
        project_id: projectSelect?.value || null,
        owner_id: accept.querySelector('#rq-owner').value || null,
        due_date: accept.querySelector('#rq-due').value || null,
        title: accept.querySelector('#rq-title').value.trim() || null,
        ...(creating ? { new_workstream_title: accept.querySelector('#rq-newws').value.trim() } : { workstream_id: wsSelect.value }),
      }
      if (!body.project_id) { message(msg, 'Choose the project'); return }
      if (creating && !body.new_workstream_title) { message(msg, 'Name the new workstream'); accept.querySelector('#rq-newws').focus(); return }
      if (!body.owner_id) { message(msg, 'Choose who will do it'); accept.querySelector('#rq-owner').focus(); return }
      if (!body.due_date) { message(msg, 'Give it a date'); accept.querySelector('#rq-due').focus(); return }
      const submit = accept.querySelector('[type="submit"]')
      submit.disabled = true
      try {
        const result = await api.acceptRequest(r.id, body)
        this.list = null
        this.detail = null
        this.app.toast('Accepted — it’s on their worklist and the owner’s board')
        this.app.refreshRequestCount()
        this.app.openLink(`#projects/${result.project_id}/worklist/${result.deliverable_id}`)
      } catch (err) {
        submit.disabled = false
        message(msg, err.message || 'Could not accept')
        if (err.status === 409) this._renderRequest(mc)
      }
    })

    const decline = mc.querySelector('#rq-decline')
    decline.addEventListener('submit', async e => {
      e.preventDefault()
      const msg = decline.querySelector('#rq-decline-msg')
      const note = decline.querySelector('#rq-note').value.trim()
      if (!note) { message(msg, 'Say why, in a line or two — the client will see this'); decline.querySelector('#rq-note').focus(); return }
      const submit = decline.querySelector('[type="submit"]')
      submit.disabled = true
      try {
        await api.declineRequest(r.id, note)
        this.list = null
        this.detail = null
        this.app.toast('Declined — the client can see your note')
        this.app.refreshRequestCount()
        this.open(null)
      } catch (err) {
        submit.disabled = false
        message(msg, err.message || 'Could not decline')
        if (err.status === 409) this._renderRequest(mc)
      }
    })
  }
}
