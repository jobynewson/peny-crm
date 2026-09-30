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

export function approveHtml(link, { done = false, changed = false, commentsSent = false, failure = null, openChanges = false, openComments = false } = {}) {
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
  if (commentsSent || link.state === 'comments_in') {
    return shell(`
      <h1 class="pt-signin-title">${commentsSent ? 'Thank you — we’ll take it from here' : 'We have your comments'}</h1>
      <p class="pt-muted">We’ve been told your feedback is complete, and will send the next round.</p>
      ${what}
      <div class="pt-form-msg" role="alert" data-approve-msg></div>
      ${link.can_undo ? '<div class="pt-message-actions"><button type="button" class="pt-btn" data-undo-comments>Undo — I’m still adding comments</button></div>' : ''}
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
      <h1 class="pt-signin-title">${openComments ? 'Are your comments in?' : 'Approve this?'}</h1>
      ${what}
      <div class="pt-form-msg" role="alert" data-approve-msg></div>
      <div class="pt-message-actions" data-approve-actions${openChanges || openComments ? ' hidden' : ''}>
        <button type="button" class="pt-btn pt-btn--primary" data-approve-now>Yes, approve round ${link.round}</button>
        <button type="button" class="pt-btn" data-open-comments>Comments are in</button>
        <button type="button" class="pt-btn" data-open-changes>Ask for changes instead</button>
      </div>
      <div class="pt-message-actions" data-comments-now${openComments ? '' : ' hidden'}>
        <p class="pt-muted">Leave your notes in ${link.frame_io ? 'Frame.io' : 'the link'} first. Press this once you’ve finished, so we know to act on them.</p>
        <button type="button" class="pt-btn pt-btn--primary" data-comments-yes>Yes, my comments are in</button>
        <button type="button" class="pt-btn" data-cancel-comments>Back</button>
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

// ── The board: Requests · In progress · Approved ─────────────────────────────
// One picture for a signed-in client and for a project link. Three columns you
// can read at a glance: what they've asked for (and what hasn't started) on the
// left, the work itself in the middle (the widest), and what is finished on the
// right, narrower and quieter. Anything that is the client's move (a round to
// review, something we are waiting on, something delivered to approve) sits at
// the top of the middle column, marked. On a phone it stacks with that first.
// The server says which status each item has; this only places it.

const CLIENTS_MOVE = {
  ready_for_review: 'Ready for your review',
  waiting_on_you: 'Waiting on you',
  delivered: 'Delivered — over to you',
}
const APPROVED_SHOWN = 6

// Pure, so it is tested without a page. `view.workstreams[].deliverables` and
// `view.requests` as the server sends them.
export function portalColumns(view) {
  const items = (view.workstreams || []).flatMap(w => w.deliverables.map(d => ({ ...d, workstream: w.title })))
  const needs = items.filter(d => d.status in CLIENTS_MOVE)
  const planned = items.filter(d => d.status === 'planned')
  const approved = items.filter(d => d.status === 'approved')
  const progress = items.filter(d => !(d.status in CLIENTS_MOVE) && d.status !== 'planned' && d.status !== 'approved')
  const requests = view.requests || []
  return {
    needs, progress, planned, approved,
    asked: requests.filter(r => r.status === 'submitted'),
    answered: requests.filter(r => r.status !== 'submitted'),
  }
}

function boardHtml(view) {
  const c = portalColumns(view)
  const canSend = view.scope.can_request ?? view.scope.can_respond
  const jump = [
    [c.needs.length, 'Needs you', 'pt-col-progress'],
    [c.progress.length, 'In progress', 'pt-col-progress'],
    [c.asked.length + c.planned.length, 'Requests', 'pt-col-requests'],
    [c.approved.length, 'Approved', 'pt-col-approved'],
  ]
  const summary = c.needs.length
    ? [c.needs.filter(d => d.status === 'ready_for_review').length && `${count(c.needs.filter(d => d.status === 'ready_for_review').length, 'thing')} ready for your review`,
       c.needs.filter(d => d.status === 'waiting_on_you').length && `${c.needs.filter(d => d.status === 'waiting_on_you').length} waiting on you`,
       c.needs.filter(d => d.status === 'delivered').length && `${c.needs.filter(d => d.status === 'delivered').length} delivered to approve`].filter(Boolean).join(' · ')
    : 'Nothing needs you right now.'
  return `
    ${view.scope.kind === 'company' && !view.scope.can_respond ? '<p class="pt-notice">You’re viewing this as the client. Answers can only be given by the client.</p>' : ''}
    <p class="pt-summary">${summary}</p>
    <nav class="pt-jump" aria-label="Jump to">${jump.map(([n, label, id]) => `<a href="#${id}" class="pt-jump-link${label === 'Needs you' && n ? ' pt-jump-link--alert' : ''}">${label}<span>${n}</span></a>`).join('')}</nav>
    <div class="pt-board">
      ${requestsColumnHtml(view, c, canSend)}
      <section class="pt-col pt-col--progress" id="pt-col-progress" aria-labelledby="pt-progress-h">
        <h2 class="pt-col-title" id="pt-progress-h">In progress</h2>
        ${c.needs.length ? `
          <div class="pt-needs">
            <h3 class="pt-needs-h">Needs you · ${c.needs.length}</h3>
            <ul class="pt-list">${c.needs.map(d => deliverableHtml(d, { needs: CLIENTS_MOVE[d.status] })).join('')}</ul>
          </div>` : ''}
        ${c.progress.length ? `<ul class="pt-list">${c.progress.map(d => deliverableHtml(d)).join('')}</ul>` : ''}
        ${!c.needs.length && !c.progress.length ? '<p class="pt-muted">Nothing in progress right now.</p>' : ''}
      </section>
      <details class="pt-col pt-col--approved" id="pt-col-approved" open data-collapse-mobile>
        <summary class="pt-col-title pt-col-summary">Approved <span class="pt-muted">${c.approved.length}</span></summary>
        ${c.approved.length
          ? `<ul class="pt-list pt-list--quiet">${c.approved.slice(0, APPROVED_SHOWN).map(approvedHtml).join('')}</ul>
             ${c.approved.length > APPROVED_SHOWN ? `<details class="pt-earlier"><summary>Earlier (${c.approved.length - APPROVED_SHOWN})</summary><ul class="pt-list pt-list--quiet">${c.approved.slice(APPROVED_SHOWN).map(approvedHtml).join('')}</ul></details>` : ''}`
          : '<p class="pt-muted">Approved work will collect here.</p>'}
      </details>
    </div>`
}

// A finished one, small and quiet: what it was, where, and when it was approved.
function approvedHtml(d) {
  const latest = d.rounds[d.rounds.length - 1]
  const when = latest?.response === 'approved' && latest.answered_at ? `Approved ${dayMonth(latest.answered_at)}` : 'Approved'
  return `
    <li class="pt-d pt-d--quiet" id="d-${esc(d.id)}">
      <div class="pt-d-title">${esc(d.title)}</div>
      <div class="pt-d-meta">${esc(d.workstream)} · ${when}</div>
    </li>`
}

// ── Signed in: the company's worklist ────────────────────────────────────────

function companyHtml(view, { signedIn, canSwitch }) {
  const actions = signedIn
    ? `${canSwitch ? '<button type="button" class="pt-link" data-switch>Switch company</button>' : ''}<button type="button" class="pt-link" data-sign-out>Sign out</button>`
    : ''
  return `
    ${headerHtml(view, { sub: 'Client portal', actions })}
    <main class="pt-main pt-main--board">
      ${boardHtml(view)}
    </main>
    ${footerHtml(view)}`
}

// ── Requests: asking us for something ────────────────────────────────────────
// The left column: what they've asked for and is still waiting, what has not
// started yet, and (folded) what we've answered.

function requestsColumnHtml(view, c, canSend) {
  const asksName = view.scope.kind === 'project'   // a link can't say who is holding it
  const nothing = !c.asked.length && !c.planned.length && !c.answered.length
  return `
    <section class="pt-col pt-col--requests pt-requests" id="pt-col-requests" aria-labelledby="pt-req-h">
      <div class="pt-ws-head">
        <h2 class="pt-col-title" id="pt-req-h">Requests</h2>
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
      ${c.asked.length ? `<ul class="pt-list">${c.asked.map(requestHtml).join('')}</ul>` : ''}
      ${c.planned.length ? `
        <h3 class="pt-sub-h">Up next</h3>
        <ul class="pt-list">${c.planned.map(d => deliverableHtml(d)).join('')}</ul>` : ''}
      ${c.answered.length ? `<details class="pt-earlier pt-earlier--requests"><summary>Answered requests (${c.answered.length})</summary><ul class="pt-list">${c.answered.map(requestHtml).join('')}</ul></details>` : ''}
      ${nothing ? `<p class="pt-muted pt-requests-empty">${canSend ? 'Need something from us? Ask here instead of emailing — you’ll see where it stands.' : (view.scope.kind === 'project' ? 'This project has been delivered, so it isn’t taking new requests here.' : 'No requests yet.')}</p>` : ''}
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
          <a href="#d-${esc(r.accepted.deliverable_id)}">See it on the board ↗</a>
        </div>` : ''}
      ${r.status === 'declined' && r.note ? `<div class="pt-request-declined"><strong>Our note:</strong> ${linkify(r.note)}</div>` : ''}
    </li>`
}

function deliverableHtml(d, { needs = null } = {}) {
  const latest = d.rounds[d.rounds.length - 1]
  const earlier = d.rounds.slice(0, -1).reverse()
  const meta = [d.format, d.due && d.due !== 'No date' ? `Due ${d.due}` : null].filter(Boolean).map(esc).join(' · ')
  return `
    <li class="pt-d${needs ? ' pt-d--needs' : ''}" id="d-${esc(d.id)}">
      ${needs ? `<div class="pt-needs-tag">${esc(needs)}</div>` : ''}
      ${d.workstream ? `<div class="pt-d-ws">${esc(d.workstream)}</div>` : ''}
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
    ${r.comment ? `<div class="pt-quote">“${esc(r.comment)}”</div>` : ''}
    ${r.response === 'comments_in' ? `<p class="pt-muted pt-answer-note">We’ve been told your feedback is complete, and will send the next round.</p>` : ''}
    ${r.can_undo ? `<button type="button" class="pt-link pt-undo" data-undo="${esc(r.id)}">Undo — I’m still adding comments</button>` : ''}`
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
            <button type="button" class="pt-btn" data-comments="${esc(r.id)}">Comments are in</button>
            <button type="button" class="pt-btn pt-btn--primary" data-approve="${esc(r.id)}">Approve</button>
            <button type="button" class="pt-btn" data-changes="${esc(r.id)}">Request changes</button>
          </div>
          <div class="pt-confirm" data-comments-confirm="${esc(r.id)}" hidden>
            <p>Have you finished leaving your comments in ${r.frame_io ? 'Frame.io' : 'the link'}? We’ll take it from here.</p>
            <div class="pt-actions">
              <button type="button" class="pt-btn pt-btn--primary" data-comments-yes="${esc(r.id)}">Yes, comments are in</button>
              <button type="button" class="pt-btn" data-cancel="${esc(r.id)}">Cancel</button>
            </div>
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
    <main class="pt-main pt-main--board">
      ${p.brief || dates ? `<section class="pt-card">${p.brief ? `<p class="pt-brief">${esc(p.brief)}</p>` : ''}${dates}</section>` : ''}
      ${p.frame_io_link ? `<a class="pt-btn pt-btn--secondary pt-open" href="${esc(p.frame_io_link)}" target="_blank" rel="noopener noreferrer">Open in Frame.io <span aria-hidden="true">↗</span></a>` : ''}
      ${boardHtml(view)}
      <div class="pt-below">
        <section class="pt-col">
          <h2 class="pt-section-title">Work log</h2>
          ${view.work_log.length ? `<ul class="pt-log">${view.work_log.map(e => `
            <li><p>${esc(e.note)}</p><div class="pt-muted">${fullDate(e.date)}${e.by ? ` · ${esc(e.by)}` : ''}</div></li>`).join('')}</ul>` : '<p class="pt-muted">No updates yet.</p>'}
        </section>
        <div class="pt-col pt-col--wide">
          ${view.schedule ? scheduleHtml(view.schedule, today) : '<p class="pt-muted">No post-production schedule yet.</p>'}
        </div>
      </div>
    </main>
    ${footerHtml(view)}`
}

// ── Behaviour ────────────────────────────────────────────────────────────────

export function bindView(root, view, { respond, respondDelivered = respond, undo, submitRequest, reply, rerender, signOut, switchCompany }) {
  root.querySelector('[data-sign-out]')?.addEventListener('click', signOut)
  root.querySelector('[data-switch]')?.addEventListener('click', switchCompany)
  if (view.schedule) bindSchedule(root, view.schedule)
  // On a phone the approved column is history: folded away until asked for.
  if (typeof matchMedia === 'function' && matchMedia('(max-width: 959px)').matches) {
    root.querySelectorAll('details[data-collapse-mobile]').forEach(d => { d.open = false })
  }
  bindRequestForm(root, { submitRequest, rerender })
  bindReplyForms(root, { reply, rerender })

  const part = (attr, id) => root.querySelector(`[${attr}="${CSS.escape(id)}"]`)
  const reset = id => {
    part('data-actions', id).hidden = false
    part('data-confirm', id).hidden = true
    part('data-changes-form', id).hidden = true
    const c = part('data-comments-confirm', id)
    if (c) c.hidden = true
  }
  const send = async (id, body, button, msgEl, kind) => {
    button.disabled = true
    try {
      const fresh = await (kind === 'deliverable' ? respondDelivered : respond)(id, body)
      toast(body.response === 'approved' ? 'Approved — thank you' : body.response === 'comments_in' ? 'Thanks — we’ll take it from here' : 'Sent — thank you')
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
  root.querySelectorAll('[data-comments]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.comments
    part('data-actions', id).hidden = true
    part('data-comments-confirm', id).hidden = false
    part('data-comments-yes', id).focus()
  }))
  root.querySelectorAll('[data-comments-yes]').forEach(b => b.addEventListener('click', () =>
    send(b.dataset.commentsYes, { response: 'comments_in' }, b, null)))
  root.querySelectorAll('[data-undo]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true
    try {
      const fresh = await undo(b.dataset.undo)
      toast('Taken back — add your comments, then press Comments are in')
      rerender(fresh)
    } catch (err) {
      b.disabled = false
      toast(err.message)
      if (err.status === 409) setTimeout(() => rerender(null), 1200)
    }
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
