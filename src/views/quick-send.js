// src/views/quick-send.js
// Quick send: paste a Frame.io link, press Send. From the project's header, so
// it is one click from any tab, and a bottom sheet on a phone.
//
// "What is it?" starts on the deliverable sent most recently (most sends are
// the next revision of it). Type another of the project's deliverables to send
// that one; type a new name and it is made on the spot, on the worklist, and
// round 1 goes out. Either way it is the same round, email and buttons as the
// send form on the Worklist tab. The server (POST retainers/projects/:id/quick-send)
// decides everything; this only asks for it.

import { openFloating } from './popover.js'
import * as api from '../api/retainers.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// What the typed words mean: one of the project's deliverables (the next round
// of it), a new one, or nothing yet. Matching ignores case and spacing.
export function readTarget(targets, text) {
  const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  const typed = norm(text)
  if (!typed) return { kind: 'empty' }
  const hit = (targets.deliverables || []).find(d => norm(d.title) === typed)
  if (hit) return { kind: 'existing', deliverable: hit, round: (hit.round || 0) + 1 }
  return { kind: 'new', title: String(text).replace(/\s+/g, ' ').trim() }
}

// The line under the field: what pressing Send will do.
export function targetLine(target) {
  if (target.kind === 'existing') return `Sends round ${target.round} of “${esc(target.deliverable.title)}”.`
  if (target.kind === 'new') return `Makes “${esc(target.title)}” on the worklist and sends round 1.`
  return 'Choose a deliverable, or type a new name.'
}

export function quickSendHtml(targets) {
  const first = (targets.deliverables || []).find(d => d.round > 0) ?? targets.deliverables?.[0] ?? null
  const workstreams = targets.workstreams || []
  return {
    first,
    html: `
      <div class="lt-head"><h2 class="lt-title" id="qs-title">Quick send</h2></div>
      <form class="tl-form" id="qs-form" novalidate>
        <div class="tl-field">
          <label for="qs-url">Link</label>
          <input type="url" id="qs-url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="Paste the Frame.io link" data-autofocus />
        </div>
        <div class="tl-field">
          <label for="qs-what">What is it?</label>
          <input id="qs-what" list="qs-options" autocomplete="off" maxlength="300" value="${esc(first?.title ?? '')}" placeholder="Name it, or pick one" />
          <datalist id="qs-options">${(targets.deliverables || []).map(d => `<option value="${esc(d.title)}"></option>`).join('')}</datalist>
          <p class="tl-hint" id="qs-line" aria-live="polite"></p>
        </div>
        ${workstreams.length > 1 ? `
        <div class="tl-field" id="qs-ws-field" hidden>
          <label for="qs-ws">In workstream</label>
          <select id="qs-ws">${workstreams.map(w => `<option value="${esc(w.id)}"${w.id === targets.default_workstream_id ? ' selected' : ''}>${esc(w.title)}</option>`).join('')}</select>
        </div>` : ''}
        <div class="tl-field">
          <label for="qs-note">Note <span class="tl-optional">(optional — the client sees it)</span></label>
          <textarea id="qs-note" rows="2"></textarea>
        </div>
        <div class="tl-msg" id="qs-msg" role="alert"></div>
        <button type="submit" class="btn-primary tl-submit" id="qs-send">Send</button>
      </form>`,
  }
}

// Opens Quick send for a project. `onSent()` runs after a round has gone, so
// the screen behind can refresh.
export async function openQuickSend(app, anchor, project, { onSent } = {}) {
  let targets
  try { targets = await api.getSendTargets(project.id) } catch (err) { app.toast(err.message || 'Could not open Quick send'); return }
  const { html } = quickSendHtml(targets)
  openFloating({
    anchor, id: 'qs', role: 'dialog', className: 'lt-pop rt-pop', html,
    onReady: (el, close) => {
      el.setAttribute('aria-labelledby', 'qs-title')
      const form = el.querySelector('#qs-form')
      const what = el.querySelector('#qs-what')
      const line = el.querySelector('#qs-line')
      const wsField = el.querySelector('#qs-ws-field')
      const msg = el.querySelector('#qs-msg')
      const update = () => {
        const t = readTarget(targets, what.value)
        line.innerHTML = targetLine(t)
        if (wsField) wsField.hidden = t.kind !== 'new'
      }
      what.addEventListener('input', update)
      what.addEventListener('focus', () => what.select())
      update()
      form.addEventListener('submit', async e => {
        e.preventDefault()
        const url = el.querySelector('#qs-url').value.trim()
        const target = readTarget(targets, what.value)
        if (!url) { msg.dataset.tone = 'error'; msg.textContent = 'Paste the link to send'; el.querySelector('#qs-url').focus(); return }
        if (target.kind === 'empty') { msg.dataset.tone = 'error'; msg.textContent = 'Choose what this is, or name it'; what.focus(); return }
        const submit = form.querySelector('[type="submit"]')
        submit.disabled = true
        msg.textContent = ''
        const body = { url, note: el.querySelector('#qs-note').value }
        if (target.kind === 'existing') body.deliverable_id = target.deliverable.id
        else {
          body.title = target.title
          const ws = el.querySelector('#qs-ws')
          if (ws) body.workstream_id = ws.value
        }
        try {
          const { delivery, notified, created } = await api.quickSend(project.id, body)
          close({ restoreFocus: false })
          app.toast(`${created ? 'Made it and sent' : 'Sent'} round ${delivery.round}${notified?.message ? ` — ${notified.message}` : ''}`)
          api.fillPreview(delivery.id).catch(() => {})   // a nicety; the round is sent
          onSent?.()
        } catch (err) {
          submit.disabled = false
          msg.dataset.tone = 'error'
          msg.textContent = err.message || 'Could not send'
          if (err.field === 'url') el.querySelector('#qs-url').focus()
        }
      })
    },
  })
}
