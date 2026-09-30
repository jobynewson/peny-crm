// src/views/company-panels.js
// Two small panels that belong to a company, not to a page: who can sign in to
// its client portal (superadmins; api/_portal-access.js), and who leads it
// (only while a superadmin has leads switched on). They open from the company on
// the Contacts page and from a project's Worklist tab.

import { openFloating } from './popover.js'
import { setCompanyLead, getPortalAccess, setUpPortal, inviteToPortal, revokePortalInvitation, removePortalMember } from '../api/companies.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LONDON_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
const dayMonth = iso => { const [, m, d] = LONDON_DAY.format(new Date(iso)).split('-').map(Number); return `${d} ${MONTHS[m - 1]}` }


// Who hears about a company's work when a deliverable has no owner. Shown only
// while a superadmin has leads switched on (Settings › Company).
export function leadLine(app, company, { canEdit }) {
  if (!app.settings?.show_leads) return ''
  const label = company.lead_id
    ? `Lead: <strong>${esc(company.lead_name || 'Unknown')}</strong>`
    : '<span class="rt-late">No lead set — alerts for this client go to every superadmin.</span> Choose one'
  return canEdit
    ? `<button type="button" class="rt-link-btn rt-lead" data-co-lead aria-haspopup="dialog">${label}</button>`
    : `<div class="rt-summary rt-lead">${company.lead_id ? label : '<span class="rt-late">No lead set</span>'}</div>`
}

export function openLeadForm(app, anchor, company, { onSaved } = {}) {
  const users = app.allUsers || []
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
          const known = (app.companies || []).find(c => c.id === company.id)
          if (known) { known.lead_id = pick; known.lead_name = company.lead_name }
          close({ restoreFocus: false })
          onSaved?.()
          app.toast('Lead saved')
        } catch (err) {
          submit.disabled = false
          msg.dataset.tone = 'error'; msg.textContent = err.message || 'Could not save'
        }
      })
    },
  })
}

// ── Portal access (superadmins) ──────────────────────────────────────────────
// Who from this company can sign in to the client portal. Backed by the
// company's Clerk organisation (api/_portal-access.js).

export function openPortalPanel(app, anchor, company, { onChange } = {}) {
  openFloating({
    anchor, id: 'rt-portal', role: 'dialog', className: 'lt-pop rt-pop rt-pop--wide',
    html: `<div class="lt-head"><h2 class="lt-title" id="rt-portal-title">Portal access · ${esc(company.name)}</h2></div>
      <div data-portal-body><p class="tl-hint">Loading…</p></div>`,
    onReady: el => {
      el.setAttribute('aria-labelledby', 'rt-portal-title')
      loadPortal(app, el, company, onChange)
    },
  })
}

async function loadPortal(app, el, company, onChange) {
  const body = el.querySelector('[data-portal-body]')
  try {
    const state = await getPortalAccess(company.id)
    if (el.isConnected) paintPortal(app, el, company, state, onChange)
  } catch (err) {
    if (el.isConnected) body.innerHTML = `<p class="tl-msg" data-tone="error">${esc(err.message || 'Could not load portal access')}</p>`
  }
}

function paintPortal(app, el, company, { portal, invites_enabled }, onChange) {
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
        onChange?.()
        if (el.isConnected) paintPortal(app, el, company, state, onChange)
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

  const reload = () => loadPortal(app, el, company, onChange)
  body.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(`Remove ${b.dataset.who} from the portal? They lose access straight away.`)) return
    b.disabled = true
    try { await removePortalMember(company.id, b.dataset.remove); app.toast('Removed'); reload() }
    catch (err) { b.disabled = false; app.toast(err.message || 'Could not remove them') }
  }))
  body.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(`Revoke the invitation to ${b.dataset.who}?`)) return
    b.disabled = true
    try { await revokePortalInvitation(company.id, b.dataset.revoke); app.toast('Invitation revoked'); reload() }
    catch (err) { b.disabled = false; app.toast(err.message || 'Could not revoke it') }
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
      app.toast(`Invitation sent to ${inv.email}`)
      reload()
    } catch (err) {
      submit.disabled = false
      msg.dataset.tone = 'error'
      msg.textContent = err.message || 'Could not send it'
      input.focus()
    }
  })
}


