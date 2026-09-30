// src/portal/render.js
// Draws GET /api/client/view. The server decides what the view holds — a
// company's worklist (signed in) or a project's page (a portal link) — and
// whether rounds can be answered; this file only draws what it's given.

import { scheduleHtml, bindSchedule } from './schedule.js'
import { esc, count, dayMonth, fullDate, linkify } from './util.js'

export { esc }

export function message(title, detail, { signOut = false, retry = false, link = null } = {}) {
  return `
    <div class="pt-signin">
      <img class="pt-logo" src="/peny-logo.png" alt="Peny" />
      <h1 class="pt-signin-title">${esc(title)}</h1>
      ${detail ? `<p class="pt-muted">${esc(detail)}</p>` : ''}
      <div class="pt-message-actions">
        ${link ? `<a class="pt-btn pt-btn--primary" href="${esc(link.href)}">${esc(link.label)}</a>` : ''}
        ${retry ? '<button type="button" class="pt-btn" data-retry>Try again</button>' : ''}
        ${signOut ? '<button type="button" class="pt-link" data-sign-out>Sign out</button>' : ''}
      </div>
    </div>`
}

export function renderView(view, { signedIn, canSwitch }) {
  return view.scope.kind === 'company' ? companyHtml(view, { signedIn, canSwitch }) : projectHtml(view)
}

function headerHtml(view, { sub, chip = '', actions = '' }) {
  return `
    <header class="pt-header">
      <img class="pt-logo" src="/peny-logo.png" alt="${esc(view.studio?.name || 'Peny')}" />
      <div class="pt-head-main">
        <h1 class="pt-title">${esc(view.title)}</h1>
        ${sub ? `<div class="pt-sub">${sub}</div>` : ''}
      </div>
      ${chip}
      ${actions ? `<div class="pt-head-actions">${actions}</div>` : ''}
    </header>`
}

function footerHtml(view) {
  const studio = view.studio || {}
  return `<footer class="pt-footer">${esc(studio.name || 'Peny')}${studio.website ? ` · <a href="${esc(studio.website)}" target="_blank" rel="noopener noreferrer">${esc(studio.website.replace(/^https?:\/\//, ''))}</a>` : ''} · Powered by Slate</footer>`
}

// ── The Approve link: a confirm page ─────────────────────────────────────────
// Opening the link only ever shows this page; approving is a button that POSTs.
// (Mail scanners open every link in a message, so a link that acted on GET
// would approve things nobody looked at.)

export function approveHtml(link, { done = false, changed = false, failure = null, openChanges = false } = {}) {
  const portal = link ? `/portal#d-${encodeURIComponent(link.deliverable_id)}` : '/portal'
  // Someone with no login has no portal to open: the link is all they have.
  const portalButton = (primary = false) => link?.can_sign_in === false ? '' : `<a class="pt-btn${primary ? ' pt-btn--primary' : ''}" href="${esc(portal)}">Open the portal</a>`
  const shell = body => `
    <div class="pt-signin pt-approve">
      <img class="pt-logo" src="/peny-logo.png" alt="${esc(link?.studio?.name || 'Peny')}" />
      ${body}
    </div>`
  if (failure) {
    return shell(`
      <h1 class="pt-signin-title">${esc(failure.title)}</h1>
      <p class="pt-muted">${esc(failure.detail)}</p>
      <div class="pt-message-actions">${portalButton()}</div>`)
  }
  const what = `
      <div class="pt-approve-what">
        ${link.preview?.image ? `<img class="pt-approve-img" src="${esc(link.preview.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ''}
        <div class="pt-approve-title">${esc(link.title)}</div>
        <div class="pt-muted">Round ${link.round} · ${esc(link.company)}</div>
        ${link.note ? `<p class="pt-round-note">${esc(link.note)}</p>` : ''}
        ${link.url ? `<a class="pt-link" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${link.frame_io ? 'Watch it in Frame.io' : 'Watch it'} ↗</a>` : ''}
      </div>`
  if (changed) {
    return shell(`
      <h1 class="pt-signin-title">Thank you — we’ve got your changes</h1>
      <p class="pt-muted">We’ll make them and send you the next round.</p>
      ${what}
      <div class="pt-message-actions">${portalButton()}</div>`)
  }
  if (done || link.state === 'approved') {
    return shell(`
      <h1 class="pt-signin-title">${done ? 'Approved — thank you' : 'Already approved'}</h1>
      ${what}
      <div class="pt-message-actions">${portalButton()}</div>`)
  }
  if (link.state === 'superseded') {
    return shell(`
      <h1 class="pt-signin-title">There’s a newer round</h1>
      <p class="pt-muted">A newer round of this has been sent since the email, so this link can’t answer it. ${link.can_sign_in === false ? 'Look out for the email for the newer round.' : 'Sign in to see the latest.'}</p>
      ${what}
      <div class="pt-message-actions">${portalButton(true)}</div>`)
  }
  if (link.state === 'answered') {
    return shell(`
      <h1 class="pt-signin-title">Already answered</h1>
      <p class="pt-muted">Changes have already been requested on this round.</p>
      ${what}
      <div class="pt-message-actions">${portalButton()}</div>`)
  }
  return shell(`
      <h1 class="pt-signin-title">Approve this?</h1>
      ${what}
      <div class="pt-form-msg" role="alert" data-approve-msg></div>
      <div class="pt-message-actions" data-approve-actions${openChanges ? ' hidden' : ''}>
        <button type="button" class="pt-btn pt-btn--primary" data-approve-now>Yes, approve round ${link.round}</button>
        <button type="button" class="pt-btn" data-open-changes>Ask for changes instead</button>
      </div>
      <form class="pt-form pt-approve-changes" data-changes-now${openChanges ? '' : ' hidden'} novalidate>
        <label for="ap-comment">What needs to change?</label>
        <textarea id="ap-comment" rows="4"></textarea>
        <div class="pt-form-msg" role="alert" data-changes-msg></div>
        <div class="pt-actions">
          <button type="submit" class="pt-btn pt-btn--primary">Send to us</button>
          <button type="button" class="pt-btn" data-cancel-changes>Back</button>
        </div>
      </form>
      <p class="pt-muted pt-approve-note">Nothing is approved until you press the button. ${link.can_sign_in === false ? 'Asking for changes works from this page too — there is nothing to sign in to.' : 'You can also ask for changes here, or sign in to the portal.'}</p>`)
}

// ── Signed in: the company's worklist ────────────────────────────────────────

function companyHtml(view, { signedIn, canSwitch }) {
  const all = view.workstreams.flatMap(w => w.deliverables)
  const review = all.filter(d => d.rounds.some(r => r.can_respond)).length
  const waiting = all.filter(d => d.status === 'waiting_on_you').length
  const needs = [review && `${count(review, 'thing')} ready for your review`, waiting && `${waiting} waiting on you`].filter(Boolean)
  const live = view.workstreams.filter(w => w.status !== 'complete')
  const done = view.workstreams.filter(w => w.status === 'complete')
  const actions = signedIn
    ? `${canSwitch ? '<button type="button" class="pt-link" data-switch>Switch company</button>' : ''}<button type="button" class="pt-link" data-sign-out>Sign out</button>`
    : ''
  return `
    ${headerHtml(view, { sub: 'Client portal', actions })}
    <main class="pt-main">
      ${view.scope.can_respond ? '' : '<p class="pt-notice">You’re viewing this as the client. Answers can only be given by the client.</p>'}
      <p class="pt-summary">${needs.length ? needs.join(' · ') : 'Nothing needs you right now.'}</p>
      ${requestsHtml(view)}
      ${live.map(w => workstreamHtml(w)).join('') || (done.length ? '' : '<p class="pt-muted">There’s nothing to show yet.</p>')}
      ${done.map(w => `
        <details class="pt-ws pt-ws--done">
          <summary><span class="pt-ws-title">${esc(w.title)}</span> <span class="pt-muted">Complete · ${count(w.deliverables.length, 'item')}</span></summary>
          ${workstreamBody(w)}
        </details>`).join('')}
    </main>
    ${footerHtml(view)}`
}

// ── Requests: asking us for something ────────────────────────────────────────

const REQUESTS_SHOWN = 5

function requestsHtml(view) {
  const list = view.requests || []
  const canSend = view.scope.can_request ?? view.scope.can_respond
  const asksName = view.scope.kind === 'project'   // a link can't say who is holding it
  const shown = list.slice(0, REQUESTS_SHOWN)
  const earlier = list.slice(REQUESTS_SHOWN)
  return `
    <section class="pt-ws pt-requests" aria-labelledby="pt-req-h">
      <div class="pt-ws-head">
        <h2 class="pt-ws-title" id="pt-req-h">Requests</h2>
        ${canSend ? '<button type="button" class="pt-btn pt-btn--secondary pt-ws-action" data-new-request>Ask for something</button>' : ''}
      </div>
      ${canSend ? `
        <form class="pt-form" data-request-form hidden novalidate>
          ${asksName ? `<label for="rq-name">Your name <span class="pt-muted">— so we know who it’s from</span></label>
          <input id="rq-name" maxlength="100" autocomplete="name" />` : ''}
          <label for="rq-title">What do you need?</label>
          <input id="rq-title" maxlength="300" autocomplete="off" />
          <label for="rq-detail">More detail <span class="pt-muted">— a link to any files or references is fine</span></label>
          <textarea id="rq-detail" rows="4"></textarea>
          <label for="rq-by">When do you need it by? <span class="pt-muted">(optional)</span></label>
          <input id="rq-by" type="date" />
          <div class="pt-form-msg" role="alert"></div>
          <div class="pt-actions">
            <button type="submit" class="pt-btn pt-btn--primary">Send request</button>
            <button type="button" class="pt-btn" data-cancel-request>Cancel</button>
          </div>
        </form>` : ''}
      ${list.length
        ? `<ul class="pt-list">${shown.map(requestHtml).join('')}</ul>
           ${earlier.length ? `<details class="pt-earlier pt-earlier--requests"><summary>Earlier requests (${earlier.length})</summary><ul class="pt-list">${earlier.map(requestHtml).join('')}</ul></details>` : ''}`
        : `<p class="pt-muted pt-requests-empty">${canSend ? 'Need something from us? Ask here instead of emailing — you’ll see where it stands.' : (view.scope.kind === 'project' ? 'This project has been delivered, so it isn’t taking new requests here.' : 'No requests yet.')}</p>`}
    </section>`
}

function requestHtml(r) {
  const meta = [
    `Sent ${dayMonth(r.sent_at)}${r.sent_by ? ` by ${esc(r.sent_by)}` : ''}`,
    r.wanted_by ? `Wanted by ${esc(fullDate(r.wanted_by))}` : null,
  ].filter(Boolean).join(' · ')
  return `
    <li class="pt-d pt-request" id="rq-${esc(r.id)}">
      <div class="pt-d-head">
        <h3 class="pt-d-title">${esc(r.title)}</h3>
        <span class="pt-chip pt-chip--request-${esc(r.status)}">${esc(r.status_label)}</span>
      </div>
      <div class="pt-d-meta">${meta}</div>
      ${r.detail ? `<p class="pt-request-detail">${linkify(r.detail)}</p>` : ''}
      ${r.accepted ? `
        <div class="pt-request-accepted">
          We’ve taken this on${r.accepted.due && r.accepted.due !== 'No date' ? ` — due ${esc(r.accepted.due)}` : ''}.
          <a href="#d-${esc(r.accepted.deliverable_id)}">See it in your worklist ↓</a>
        </div>` : ''}
      ${r.status === 'declined' && r.note ? `<div class="pt-request-declined"><strong>Our note:</strong> ${linkify(r.note)}</div>` : ''}
    </li>`
}

function workstreamHtml(w) {
  return `
    <section class="pt-ws" aria-labelledby="ws-${esc(w.id)}">
      <div class="pt-ws-head">
        <h2 class="pt-ws-title" id="ws-${esc(w.id)}">${esc(w.title)}</h2>
        ${w.status === 'paused' ? '<span class="pt-chip">Paused</span>' : ''}
      </div>
      ${workstreamBody(w)}
    </section>`
}

function workstreamBody(w) {
  return `
    ${w.brief ? `<p class="pt-ws-brief">${esc(w.brief)}</p>` : ''}
    <ul class="pt-list">${w.deliverables.map(deliverableHtml).join('')}</ul>`
}

function deliverableHtml(d) {
  const latest = d.rounds[d.rounds.length - 1]
  const earlier = d.rounds.slice(0, -1).reverse()
  const meta = [d.format, d.due && d.due !== 'No date' ? `Due ${d.due}` : null].filter(Boolean).map(esc).join(' · ')
  return `
    <li class="pt-d" id="d-${esc(d.id)}">
      <div class="pt-d-head">
        <h3 class="pt-d-title">${esc(d.title)}</h3>
        <span class="pt-chip pt-chip--${esc(d.status)}">${esc(d.status_label)}</span>
      </div>
      ${meta ? `<div class="pt-d-meta">${meta}</div>` : ''}
      ${d.status === 'waiting_on_you' ? waitingHtml(d) : ''}
      ${latest ? roundHtml(latest, d) : ''}
      ${d.can_answer ? deliveredHtml(d) : ''}
      ${earlier.length ? `
        <details class="pt-earlier">
          <summary>Earlier ${earlier.length === 1 ? 'round' : 'rounds'} (${earlier.length})</summary>
          <ol class="pt-earlier-list">${earlier.map(r => `
            <li><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Round ${r.round}</a>
              <span class="pt-muted">sent ${dayMonth(r.sent_at)} · ${esc(r.response_label)}</span>
              ${r.comment ? `<div class="pt-quote">“${esc(r.comment)}”</div>` : ''}</li>`).join('')}</ol>
        </details>` : ''}
    </li>`
}

// An item that is waiting on the client: what we need, the note they last sent
// us, and a way to send another. A note, not a thread.
function waitingHtml(d) {
  const id = esc(d.id)
  return `
    <div class="pt-waiting">
      <h4 class="pt-waiting-h">What we need from you</h4>
      <p class="pt-waiting-what">${d.waiting_for ? esc(d.waiting_for) : 'We’re waiting on something from you. Reply below to tell us where it’s got to.'}</p>
      ${d.reply ? `<div class="pt-reply"><span class="pt-muted">Your note${d.reply.at ? `, ${dayMonth(d.reply.at)}` : ''}:</span> <span class="pt-quote">“${esc(d.reply.text)}”</span></div>` : ''}
      ${d.can_reply ? `
        <button type="button" class="pt-btn pt-btn--secondary pt-waiting-btn" data-reply-open="${id}">${d.reply ? 'Send another note' : 'Reply to us'}</button>
        <form class="pt-form pt-form--inline" data-reply-form="${id}" hidden novalidate>
          <label for="rp-${id}">Your note <span class="pt-muted">— for example, that it has shipped</span></label>
          <textarea id="rp-${id}" rows="3" maxlength="1000"></textarea>
          <div class="pt-form-msg" role="alert"></div>
          <div class="pt-actions">
            <button type="submit" class="pt-btn pt-btn--primary">Send</button>
            <button type="button" class="pt-btn" data-reply-cancel="${id}">Cancel</button>
          </div>
        </form>` : ''}
    </div>`
}

// A deliverable Peny have marked delivered, with no round to answer: the same
// Approve / Request changes, acting on the deliverable itself (data-kind).
function deliveredHtml(d) {
  const id = esc(d.id)
  return `
    <div class="pt-round">
      <div class="pt-round-body">
        <p class="pt-round-note">Peny have delivered this. Please approve it, or tell us what needs to change.</p>
        <div class="pt-actions" data-actions="${id}">
          <button type="button" class="pt-btn pt-btn--primary" data-approve="${id}">Approve</button>
          <button type="button" class="pt-btn" data-changes="${id}">Request changes</button>
        </div>
        <div class="pt-confirm" data-confirm="${id}" hidden>
          <p>Approve “${esc(d.title)}”?</p>
          <div class="pt-actions">
            <button type="button" class="pt-btn pt-btn--primary" data-confirm-yes="${id}" data-kind="deliverable">Yes, approve</button>
            <button type="button" class="pt-btn" data-cancel="${id}">Cancel</button>
          </div>
        </div>
        <form class="pt-changes" data-changes-form="${id}" data-kind="deliverable" hidden novalidate>
          <label for="c-${id}">What needs to change?</label>
          <textarea id="c-${id}" rows="3"></textarea>
          <div class="pt-form-msg" role="alert"></div>
          <div class="pt-actions">
            <button type="submit" class="pt-btn pt-btn--primary">Send</button>
            <button type="button" class="pt-btn" data-cancel="${id}">Cancel</button>
          </div>
        </form>
      </div>
    </div>`
}

function answerLine(r) {
  if (r.response === 'pending') return ''
  const who = r.answered_by ? ` by ${esc(r.answered_by)}` : r.recorded_by_studio ? ' (recorded by Peny)' : ''
  const when = r.answered_at ? ` ${dayMonth(r.answered_at)}` : ''
  return `
    <div class="pt-answer pt-answer--${esc(r.response)}">${esc(r.response_label)}${when}${who}</div>
    ${r.comment ? `<div class="pt-quote">“${esc(r.comment)}”</div>` : ''}`
}

function roundHtml(r, d) {
  const image = r.preview?.image
  return `
    <div class="pt-round${image ? ' pt-round--image' : ''}">
      ${image ? `<a class="pt-round-img" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true"><img src="${esc(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" /></a>` : ''}
      <div class="pt-round-body">
        <div class="pt-round-top"><span class="pt-round-n">Round ${r.round}</span> <span class="pt-muted">sent ${dayMonth(r.sent_at)}</span></div>
        ${r.preview?.title ? `<div class="pt-round-title">${esc(r.preview.title)}</div>` : ''}
        ${r.note ? `<p class="pt-round-note">${esc(r.note)}</p>` : ''}
        <a class="pt-btn pt-btn--secondary pt-open" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${r.frame_io ? 'Open in Frame.io' : 'Open the link'} <span aria-hidden="true">↗</span></a>
        ${answerLine(r)}
        ${r.can_respond ? `
          <div class="pt-actions" data-actions="${esc(r.id)}">
            <button type="button" class="pt-btn pt-btn--primary" data-approve="${esc(r.id)}">Approve</button>
            <button type="button" class="pt-btn" data-changes="${esc(r.id)}">Request changes</button>
          </div>
          <div class="pt-confirm" data-confirm="${esc(r.id)}" hidden>
            <p>Approve round ${r.round} of “${esc(d.title)}”?</p>
            <div class="pt-actions">
              <button type="button" class="pt-btn pt-btn--primary" data-confirm-yes="${esc(r.id)}">Yes, approve</button>
              <button type="button" class="pt-btn" data-cancel="${esc(r.id)}">Cancel</button>
            </div>
          </div>
          <form class="pt-changes" data-changes-form="${esc(r.id)}" hidden novalidate>
            <label for="c-${esc(r.id)}">What needs to change?</label>
            <textarea id="c-${esc(r.id)}" rows="3"></textarea>
            <div class="pt-form-msg" role="alert"></div>
            <div class="pt-actions">
              <button type="submit" class="pt-btn pt-btn--primary">Send</button>
              <button type="button" class="pt-btn" data-cancel="${esc(r.id)}">Cancel</button>
            </div>
          </form>` : ''}
      </div>
    </div>`
}

// ── A portal link: one project ───────────────────────────────────────────────

function projectHtml(view) {
  const p = view.project
  const sub = view.client ? esc(view.client.company || view.client.name) : ''
  const dates = p.shoot_start ? `
    <div class="pt-dates">
      <div><div class="pt-label">${p.shoot_end && p.shoot_end !== p.shoot_start ? 'Shoot start' : 'Shoot'}</div><div>${fullDate(p.shoot_start)}</div></div>
      ${p.shoot_end && p.shoot_end !== p.shoot_start ? `<div><div class="pt-label">Shoot end</div><div>${fullDate(p.shoot_end)}</div></div>` : ''}
    </div>` : ''
  const today = view.today
  return `
    ${headerHtml(view, { sub, chip: p.status ? `<span class="pt-chip">${esc(p.status)}</span>` : '' })}
    <main class="pt-main pt-main--project">
      <div class="pt-col">
        ${p.brief || dates ? `<section class="pt-card">${p.brief ? `<p class="pt-brief">${esc(p.brief)}</p>` : ''}${dates}</section>` : ''}
        ${p.frame_io_link ? `<a class="pt-btn pt-btn--secondary pt-open" href="${esc(p.frame_io_link)}" target="_blank" rel="noopener noreferrer">Open in Frame.io <span aria-hidden="true">↗</span></a>` : ''}
        <section>
          <h2 class="pt-section-title">Deliverables</h2>
          ${view.workstreams.length ? view.workstreams.map(workstreamHtml).join('') : '<p class="pt-muted">No deliverables listed.</p>'}
        </section>
        ${requestsHtml(view)}
        <section>
          <h2 class="pt-section-title">Work log</h2>
          ${view.work_log.length ? `<ul class="pt-log">${view.work_log.map(e => `
            <li><p>${esc(e.note)}</p><div class="pt-muted">${fullDate(e.date)}${e.by ? ` · ${esc(e.by)}` : ''}</div></li>`).join('')}</ul>` : '<p class="pt-muted">No updates yet.</p>'}
        </section>
      </div>
      <div class="pt-col pt-col--wide">
        ${view.schedule ? scheduleHtml(view.schedule, today) : '<p class="pt-muted">No post-production schedule yet.</p>'}
      </div>
    </main>
    ${footerHtml(view)}`
}

// ── Behaviour ────────────────────────────────────────────────────────────────

export function bindView(root, view, { respond, respondDelivered = respond, submitRequest, reply, rerender, signOut, switchCompany }) {
  root.querySelector('[data-sign-out]')?.addEventListener('click', signOut)
  root.querySelector('[data-switch]')?.addEventListener('click', switchCompany)
  if (view.schedule) bindSchedule(root, view.schedule)
  bindRequestForm(root, { submitRequest, rerender })
  bindReplyForms(root, { reply, rerender })

  const part = (attr, id) => root.querySelector(`[${attr}="${CSS.escape(id)}"]`)
  const reset = id => {
    part('data-actions', id).hidden = false
    part('data-confirm', id).hidden = true
    part('data-changes-form', id).hidden = true
  }
  const send = async (id, body, button, msgEl, kind) => {
    button.disabled = true
    try {
      const fresh = await (kind === 'deliverable' ? respondDelivered : respond)(id, body)
      toast(body.response === 'approved' ? 'Approved — thank you' : 'Sent — thank you')
      rerender(fresh)
    } catch (err) {
      button.disabled = false
      const text = err.status === 409 ? `${err.message}. Refreshing…` : err.message
      if (msgEl) msgEl.textContent = text
      else toast(text)
      if (err.status === 409) setTimeout(() => rerender(null), 1200)
    }
  }

  root.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.approve
    part('data-actions', id).hidden = true
    part('data-confirm', id).hidden = false
    part('data-confirm-yes', id).focus()
  }))
  root.querySelectorAll('[data-changes]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.changes
    part('data-actions', id).hidden = true
    const form = part('data-changes-form', id)
    form.hidden = false
    form.querySelector('textarea').focus()
  }))
  root.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.cancel
    reset(id)
    part('data-actions', id).querySelector('button')?.focus()
  }))
  root.querySelectorAll('[data-confirm-yes]').forEach(b => b.addEventListener('click', () =>
    send(b.dataset.confirmYes, { response: 'approved' }, b, null, b.dataset.kind)))
  root.querySelectorAll('[data-changes-form]').forEach(form => form.addEventListener('submit', e => {
    e.preventDefault()
    const comment = form.querySelector('textarea').value.trim()
    const msg = form.querySelector('.pt-form-msg')
    if (!comment) { msg.textContent = 'Say what needs to change'; form.querySelector('textarea').focus(); return }
    send(form.dataset.changesForm, { response: 'changes_requested', comment }, form.querySelector('[type="submit"]'), msg, form.dataset.kind)
  }))
}

function bindReplyForms(root, { reply, rerender }) {
  const form = id => root.querySelector(`[data-reply-form="${CSS.escape(id)}"]`)
  root.querySelectorAll('[data-reply-open]').forEach(b => b.addEventListener('click', () => {
    const f = form(b.dataset.replyOpen)
    b.hidden = true
    f.hidden = false
    f.querySelector('textarea').focus()
  }))
  root.querySelectorAll('[data-reply-cancel]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.replyCancel
    const f = form(id)
    f.hidden = true
    f.querySelector('.pt-form-msg').textContent = ''
    const open = root.querySelector(`[data-reply-open="${CSS.escape(id)}"]`)
    open.hidden = false
    open.focus()
  }))
  root.querySelectorAll('[data-reply-form]').forEach(f => f.addEventListener('submit', async e => {
    e.preventDefault()
    const text = f.querySelector('textarea').value.trim()
    const msg = f.querySelector('.pt-form-msg')
    if (!text) { msg.textContent = 'Write your note'; f.querySelector('textarea').focus(); return }
    const button = f.querySelector('[type="submit"]')
    button.disabled = true
    try {
      const fresh = await reply(f.dataset.replyForm, { reply: text })
      toast('Sent — thank you')
      rerender(fresh)
    } catch (err) {
      button.disabled = false
      msg.textContent = err.status === 409 ? `${err.message}. Refreshing…` : err.message
      if (err.status === 409) setTimeout(() => rerender(null), 1500)
    }
  }))
}

function bindRequestForm(root, { submitRequest, rerender }) {
  const form = root.querySelector('[data-request-form]')
  if (!form) return
  const msg = form.querySelector('.pt-form-msg')
  const open = () => { form.hidden = false; form.querySelector('#rq-title').focus() }
  const close = () => { form.hidden = true; msg.textContent = '' }
  root.querySelector('[data-new-request]')?.addEventListener('click', () => (form.hidden ? open() : close()))
  form.querySelector('[data-cancel-request]').addEventListener('click', () => {
    close()
    root.querySelector('[data-new-request]')?.focus()
  })
  form.addEventListener('submit', async e => {
    e.preventDefault()
    const nameField = form.querySelector('#rq-name')
    const name = nameField?.value.trim()
    if (nameField && !name) { msg.textContent = 'Tell us who you are'; nameField.focus(); return }
    const title = form.querySelector('#rq-title').value.trim()
    if (!title) { msg.textContent = 'Say what you need'; form.querySelector('#rq-title').focus(); return }
    const button = form.querySelector('[type="submit"]')
    button.disabled = true
    try {
      const fresh = await submitRequest({
        ...(nameField ? { name } : {}),
        title,
        detail: form.querySelector('#rq-detail').value.trim() || null,
        wanted_by: form.querySelector('#rq-by').value || null,
      })
      toast('Sent — we’ll be in touch')
      rerender(fresh)
    } catch (err) {
      button.disabled = false
      msg.textContent = err.message
      form.querySelector(err.field === 'wanted_by' ? '#rq-by' : err.field === 'name' && nameField ? '#rq-name' : '#rq-title').focus()
    }
  })
}

function toast(text) {
  document.querySelector('.pt-toast')?.remove()
  const el = document.createElement('div')
  el.className = 'pt-toast'
  el.setAttribute('role', 'status')
  el.textContent = text
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 3200)
}
