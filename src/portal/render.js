// src/portal/render.js
// Draws GET /api/client/view. The server decides what the view holds — a
// company's worklist (signed in) or a project's page (a portal link) — and
// whether rounds can be answered; this file only draws what it's given.

import { scheduleHtml, bindSchedule } from './schedule.js'
import { esc, count, dayMonth, fullDate } from './util.js'

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
      ${live.map(w => workstreamHtml(w)).join('') || (done.length ? '' : '<p class="pt-muted">There’s nothing to show yet.</p>')}
      ${done.map(w => `
        <details class="pt-ws pt-ws--done">
          <summary><span class="pt-ws-title">${esc(w.title)}</span> <span class="pt-muted">Complete · ${count(w.deliverables.length, 'item')}</span></summary>
          ${workstreamBody(w)}
        </details>`).join('')}
    </main>
    ${footerHtml(view)}`
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
      ${d.waiting_for ? `<div class="pt-waiting"><strong>What we need from you:</strong> ${esc(d.waiting_for)}</div>` : ''}
      ${latest ? roundHtml(latest, d) : ''}
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
  const legacy = view.deliverables
  return `
    ${headerHtml(view, { sub, chip: p.status ? `<span class="pt-chip">${esc(p.status)}</span>` : '' })}
    <main class="pt-main pt-main--project">
      <div class="pt-col">
        ${p.brief || dates ? `<section class="pt-card">${p.brief ? `<p class="pt-brief">${esc(p.brief)}</p>` : ''}${dates}</section>` : ''}
        ${p.frame_io_link ? `<a class="pt-btn pt-btn--secondary pt-open" href="${esc(p.frame_io_link)}" target="_blank" rel="noopener noreferrer">Open in Frame.io <span aria-hidden="true">↗</span></a>` : ''}
        <section>
          <h2 class="pt-section-title">Deliverables</h2>
          ${legacy
            ? (legacy.length ? `<ul class="pt-simple">${legacy.map(d => legacyHtml(d, today)).join('')}</ul>` : '<p class="pt-muted">No deliverables listed.</p>')
            : (view.workstreams.length ? view.workstreams.map(workstreamHtml).join('') : '<p class="pt-muted">No deliverables listed.</p>')}
        </section>
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

function legacyHtml(d, today) {
  let meta = ''
  let tone = ''
  if (d.due) {
    const days = Math.round((Date.parse(d.due) - Date.parse(today)) / 86400000)
    if (d.done) meta = fullDate(d.due)
    else if (days < 0) { meta = `${-days}d overdue · ${fullDate(d.due)}`; tone = ' pt-late' }
    else if (days <= 3) { meta = `${days === 0 ? 'Due today' : `${days}d left`} · ${fullDate(d.due)}`; tone = ' pt-soon' }
    else meta = fullDate(d.due)
  }
  return `
    <li class="pt-simple-row${d.done ? ' pt-simple-row--done' : ''}">
      <span class="pt-dot" aria-hidden="true"></span>
      <span class="pt-simple-main">
        <span class="pt-simple-text">${esc(d.text)}${d.done ? '<span class="visually-hidden"> (done)</span>' : ''}</span>
        ${meta ? `<span class="pt-simple-meta${tone}">${meta}</span>` : ''}
      </span>
      ${d.link ? `<a class="pt-link" href="${esc(d.link)}" target="_blank" rel="noopener noreferrer">Open ↗</a>` : ''}
    </li>`
}

// ── Behaviour ────────────────────────────────────────────────────────────────

export function bindView(root, view, { respond, rerender, signOut, switchCompany }) {
  root.querySelector('[data-sign-out]')?.addEventListener('click', signOut)
  root.querySelector('[data-switch]')?.addEventListener('click', switchCompany)
  if (view.schedule) bindSchedule(root, view.schedule)

  const part = (attr, id) => root.querySelector(`[${attr}="${CSS.escape(id)}"]`)
  const reset = id => {
    part('data-actions', id).hidden = false
    part('data-confirm', id).hidden = true
    part('data-changes-form', id).hidden = true
  }
  const send = async (id, body, button, msgEl) => {
    button.disabled = true
    try {
      const fresh = await respond(id, body)
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
    send(b.dataset.confirmYes, { response: 'approved' }, b, null)))
  root.querySelectorAll('[data-changes-form]').forEach(form => form.addEventListener('submit', e => {
    e.preventDefault()
    const comment = form.querySelector('textarea').value.trim()
    const msg = form.querySelector('.pt-form-msg')
    if (!comment) { msg.textContent = 'Say what needs to change'; form.querySelector('textarea').focus(); return }
    send(form.dataset.changesForm, { response: 'changes_requested', comment }, form.querySelector('[type="submit"]'), msg)
  }))
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
