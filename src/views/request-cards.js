// src/views/request-cards.js
// A client's new request on the task board: a card in the unassigned tray, with
// Accept on the card itself. Clicking the card opens what they wrote, with
// Accept and Decline.
//
// Accept is as light as it can be and leave nothing half-set. It asks for one
// thing, the date (filled in with the one they asked for, and optional), and
// assigns the work to whoever pressed it. The server supplies the rest: the
// project (asking only if the client has several and none is clearly it) and
// the project's "Requests" workstream. The deliverable can be moved or
// re-dated on the Worklist tab afterwards.
//
// The board owns the list and the refresh; this draws the card and its forms.

import { openFloating } from './popover.js'
import * as api from '../api/requests.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// The client's text with its http(s) links clickable; escaped first.
export const linkify = text => esc(text).replace(/https?:\/\/[^\s<]+/g, match => {
  const url = match.replace(/(?:[.,;:!?)]|&amp;)+$/, '')
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${match.slice(url.length)}`
})

const meta = r => [esc(r.company), r.sent_by ? `from ${esc(r.sent_by)}` : null].filter(Boolean).join(' · ')

// The card for the tray. Not draggable: a request isn't work yet. Accept is on it.
export function requestCardHtml(r, { canEdit = true } = {}) {
  return `
    <div class="tk-card tk-card--request" data-request-id="${esc(r.id)}" role="button" tabindex="0" title="Read the request">
      <div class="tk-card-title">${esc(r.title)}</div>
      <div class="tk-card-project">${meta(r)}</div>
      <div class="tk-card-meta">
        <span class="tk-pill tk-pill--request">Request</span>
        ${r.source === 'link' ? `<span class="tk-chip-status tk-chip-status--link">${esc(r.source_label)}</span>` : ''}
        ${r.wanted_by_display ? `<span class="tk-due">Wanted by ${esc(r.wanted_by_display)}</span>` : '<span class="tk-due tk-due--undated">No date asked</span>'}
        <div style="flex:1"></div>
        ${canEdit ? `<button type="button" class="btn-primary tk-accept" data-request-accept="${esc(r.id)}">Accept</button>` : ''}
      </div>
    </div>`
}

// The phone list's row for one: title, who, Accept right there.
export function requestRowHtml(r, { canEdit = true } = {}) {
  return `
    <div class="tk-m-row tk-m-row--request" data-request-id="${esc(r.id)}" role="button" tabindex="0">
      <div class="tk-m-row-main">
        <div class="tk-m-row-title">${esc(r.title)}</div>
        <div class="tk-m-row-meta">${[meta(r), r.wanted_by_display ? `wanted by ${esc(r.wanted_by_display)}` : null, r.source === 'link' ? esc(r.source_label) : null].filter(Boolean).join(' · ')}</div>
      </div>
      ${canEdit ? `<button type="button" class="tk-got-it" data-request-accept="${esc(r.id)}">Accept</button>` : ''}
    </div>`
}

// Wires the cards and rows inside `root`. `requests` is the board's list;
// `onChanged()` runs after one is accepted or declined so the board can reload.
export function bindRequestCards(app, root, requests, { canEdit = true, onChanged } = {}) {
  const find = id => requests.find(r => r.id === id)
  root.querySelectorAll('[data-request-id]').forEach(el => {
    const open = e => { if (!e.target.closest('button')) openRequestSheet(app, el, find(el.dataset.requestId), { canEdit, onChanged }) }
    el.addEventListener('click', open)
    el.addEventListener('keydown', e => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(e) } })
  })
  root.querySelectorAll('[data-request-accept]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation()
    const r = find(b.dataset.requestAccept)
    if (r) openAcceptForm(app, b, r, { onChanged })
  }))
}

// What they wrote, with the two answers.
export function openRequestSheet(app, anchor, r, { canEdit = true, onChanged } = {}) {
  if (!r) return
  openFloating({
    anchor, id: 'rq-sheet', role: 'dialog', className: 'lt-pop rt-pop rt-pop--wide',
    html: `
      <div class="lt-head"><h2 class="lt-title" id="rq-sheet-title">${esc(r.title)}</h2></div>
      <p class="tl-hint">${meta(r)}${r.source === 'link' ? ` · ${esc(r.source_label)} (name typed, not verified)` : ''}${r.project ? ` · ${esc(r.project)}` : ''}</p>
      <p class="rq-detail">${r.detail ? linkify(r.detail) : '<span class="tl-hint">No more detail.</span>'}</p>
      ${r.wanted_by_display ? `<p class="tl-hint">They asked for it by ${esc(r.wanted_by_display)}.</p>` : ''}
      ${canEdit ? `<div class="rq-actions"><button type="button" class="btn-primary" data-rq-accept>Accept</button><button type="button" class="btn-cancel" data-rq-decline>Decline…</button></div>` : ''}`,
    onReady: (el, close) => {
      el.setAttribute('aria-labelledby', 'rq-sheet-title')
      el.querySelector('[data-rq-accept]')?.addEventListener('click', e => { close({ restoreFocus: false }); openAcceptForm(app, anchor, r, { onChanged }) })
      el.querySelector('[data-rq-decline]')?.addEventListener('click', () => { close({ restoreFocus: false }); openDeclineForm(app, anchor, r, { onChanged }) })
    },
  })
}

// Accept: the date, and nothing else unless the client has several projects and
// none is clearly it (then one more question, in the same popover).
export function openAcceptForm(app, anchor, r, { onChanged } = {}) {
  openFloating({
    anchor, id: 'rq-accept', role: 'dialog', className: 'lt-pop rt-pop',
    html: `
      <div class="lt-head"><h2 class="lt-title" id="rq-accept-title">Accept “${esc(r.title)}”</h2></div>
      <form class="tl-form" id="rq-accept-form" novalidate>
        <p class="tl-hint">It becomes a deliverable for you, shown to ${esc(r.company)}. Fill in the rest on the worklist later.</p>
        <div class="tl-field">
          <label for="rq-due">Date <span class="tl-optional">(optional${r.wanted_by ? ' — they asked for this one' : ''})</span></label>
          <input type="date" id="rq-due" value="${esc(r.wanted_by || '')}" data-autofocus />
        </div>
        <div class="tl-field" id="rq-project-field" hidden>
          <label for="rq-project">Which project?</label>
          <select id="rq-project"></select>
        </div>
        <div class="tl-msg" id="rq-accept-msg" role="alert"></div>
        <button type="submit" class="btn-primary tl-submit">Accept</button>
      </form>`,
    onReady: (el, close) => {
      el.setAttribute('aria-labelledby', 'rq-accept-title')
      const form = el.querySelector('#rq-accept-form')
      const msg = el.querySelector('#rq-accept-msg')
      form.addEventListener('submit', async e => {
        e.preventDefault()
        const submit = form.querySelector('[type="submit"]')
        submit.disabled = true
        msg.textContent = ''
        const body = { due_date: el.querySelector('#rq-due').value || null }
        const project = el.querySelector('#rq-project-field').hidden ? null : el.querySelector('#rq-project').value
        if (project) body.project_id = project
        try {
          const done = await api.acceptRequest(r.id, body)
          close({ restoreFocus: false })
          app.toast(`Accepted. It’s yours, in ${done.link ? 'the project’s worklist' : 'the worklist'}`)
          onChanged?.(done)
        } catch (err) {
          submit.disabled = false
          if (err.code === 'needs_project' && err.details?.projects?.length) {
            const pick = el.querySelector('#rq-project')
            pick.innerHTML = err.details.projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')
            el.querySelector('#rq-project-field').hidden = false
            msg.dataset.tone = 'info'
            msg.textContent = 'This client has more than one project — pick the one.'
            pick.focus()
            return
          }
          msg.dataset.tone = 'error'
          msg.textContent = err.message || 'Could not accept it'
          if (err.status === 409) onChanged?.()        // someone else answered it
        }
      })
    },
  })
}

// Decline: a note, which the client reads in the portal.
export function openDeclineForm(app, anchor, r, { onChanged } = {}) {
  openFloating({
    anchor, id: 'rq-decline', role: 'dialog', className: 'lt-pop rt-pop',
    html: `
      <div class="lt-head"><h2 class="lt-title" id="rq-decline-title">Decline “${esc(r.title)}”</h2></div>
      <form class="tl-form" id="rq-decline-form" novalidate>
        <div class="tl-field">
          <label for="rq-note">A note for ${esc(r.company)} <span class="tl-optional">(they will read it)</span></label>
          <textarea id="rq-note" rows="3" maxlength="1000" data-autofocus></textarea>
        </div>
        <div class="tl-msg" id="rq-decline-msg" role="alert"></div>
        <button type="submit" class="btn-primary tl-submit">Decline</button>
      </form>`,
    onReady: (el, close) => {
      el.setAttribute('aria-labelledby', 'rq-decline-title')
      const form = el.querySelector('#rq-decline-form')
      const msg = el.querySelector('#rq-decline-msg')
      form.addEventListener('submit', async e => {
        e.preventDefault()
        const note = el.querySelector('#rq-note').value.trim()
        if (!note) { msg.dataset.tone = 'error'; msg.textContent = 'Write the note they will read'; el.querySelector('#rq-note').focus(); return }
        const submit = form.querySelector('[type="submit"]')
        submit.disabled = true
        try {
          await api.declineRequest(r.id, note)
          close({ restoreFocus: false })
          app.toast('Declined. They can see your note')
          onChanged?.()
        } catch (err) {
          submit.disabled = false
          msg.dataset.tone = 'error'
          msg.textContent = err.message || 'Could not decline it'
          if (err.status === 409) onChanged?.()
        }
      })
    },
  })
}
