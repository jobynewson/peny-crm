// src/portal/main.js
// The client portal: one page for both ways in, and one data source.
//   /portal/<token>  a project's portal link → that project, read-only
//   /portal          a client signed in with Clerk → their company's worklist
//   /portal/approve#<token>  the Approve button in a delivery email → a confirm
//                    page for that one round (no sign-in). The
//                    token rides in the fragment, so it never reaches a server
//                    log or a Referer header; opening the page changes nothing.
// The page only decides which credential to send. What to show comes from
// GET /api/client/view, which scopes everything on the server
// (api/_client.js); the page renders whatever view comes back.
//
// Its own bundle (portal.html): no db/client.js, no Slate app code. Clerk is
// only loaded for the signed-in way in.

import './portal.css'
import { renderView, bindView, approveHtml, message, esc } from './render.js'

const root = document.getElementById('portal')
const approving = /^\/portal\/approve\/?$/.test(location.pathname)
const token = approving ? null : location.pathname.match(/^\/portal\/([A-Za-z0-9_-]+)\/?$/)?.[1] ?? null
let clerk = null

// ── The API ──────────────────────────────────────────────────────────────────

async function headers() {
  if (token) return { 'X-Portal-Token': token }
  if (approving) return { 'X-Action-Token': location.hash.slice(1) }
  const jwt = await clerk?.session?.getToken()
  return jwt ? { Authorization: `Bearer ${jwt}` } : {}
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(await headers()) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw Object.assign(new Error(data?.error?.message || `Something went wrong (${res.status})`),
      { status: res.status, code: data?.error?.code, field: data?.error?.field })
  }
  return data
}

// ── Signing in (the /portal way in) ──────────────────────────────────────────

async function signIn() {
  const { Clerk } = await import('@clerk/clerk-js')
  clerk = new Clerk(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY)
  await clerk.load()

  if (!clerk.user) {
    root.innerHTML = `
      <div class="pt-signin">
        <img class="pt-logo" src="/peny-logo.png" alt="Peny" />
        <h1 class="pt-signin-title">Client portal</h1>
        <p class="pt-muted">Sign in with the email address we invited. We'll send you a code.</p>
        <div id="pt-clerk"></div>
      </div>`
    const el = root.querySelector('#pt-clerk')
    // An invitation link arrives with a ticket; a new person signs up with it.
    const signingUp = new URLSearchParams(location.search).get('__clerk_status') === 'sign_up'
    // A link from an email can name the item (/portal#d-<id>): keep it through signing in.
    const back = /^#d-[0-9a-fA-F-]{36}$/.test(location.hash) ? `/portal${location.hash}` : '/portal'
    const stay = { routing: 'virtual', forceRedirectUrl: back, signUpForceRedirectUrl: back, signInForceRedirectUrl: back }
    if (signingUp) clerk.mountSignUp(el, stay)
    else clerk.mountSignIn(el, stay)
    return false
  }

  // The session must name which company this is: the portal scopes by the
  // active organisation.
  const memberships = clerk.user.organizationMemberships ?? []
  if (!memberships.length) {
    showMessage('This account isn’t linked to a client portal', 'If you were expecting access, ask your contact at Peny to invite you.', { signOut: true })
    return false
  }
  const active = clerk.organization?.id
  if (!memberships.some(m => m.organization.id === active)) {
    if (memberships.length === 1) await clerk.setActive({ organization: memberships[0].organization.id })
    else { chooseCompany(memberships); return false }
  }
  return true
}

function chooseCompany(memberships) {
  root.innerHTML = `
    <div class="pt-signin">
      <img class="pt-logo" src="/peny-logo.png" alt="Peny" />
      <h1 class="pt-signin-title">Which company?</h1>
      <div class="pt-choices">${memberships.map(m =>
        `<button type="button" class="pt-btn pt-choice" data-org="${esc(m.organization.id)}">${esc(m.organization.name)}</button>`).join('')}</div>
      <button type="button" class="pt-link" data-sign-out>Sign out</button>
    </div>`
  root.querySelectorAll('[data-org]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true
    await clerk.setActive({ organization: b.dataset.org })
    show()
  }))
  root.querySelector('[data-sign-out]').addEventListener('click', signOut)
}

async function signOut() {
  await clerk?.signOut()
  location.href = '/portal'
}

// ── The view ─────────────────────────────────────────────────────────────────

function showMessage(title, detail, { signOut: withSignOut = false, retry = false, link = null } = {}) {
  root.innerHTML = message(title, detail, { signOut: withSignOut, retry, link })
  root.querySelector('[data-sign-out]')?.addEventListener('click', signOut)
  root.querySelector('[data-retry]')?.addEventListener('click', () => show())
}

async function show(view = null) {
  if (!view) {
    try {
      view = await api('/api/client/view')
    } catch (err) {
      if (token) return showMessage('This link isn’t working', 'It may have expired. Ask your contact at Peny for a new one.')
      if (err.code === 'staff') {
        return showMessage('You’re signed in as Peny', 'The client portal is for clients. Your work is in Slate.', { signOut: true, link: { href: '/', label: 'Open Slate' } })
      }
      if (err.code === 'no_portal' || err.code === 'no_organisation') {
        return showMessage('There’s no portal here yet', 'Ask your contact at Peny to check your invitation.', { signOut: true })
      }
      if (err.status === 401) return showMessage('Please sign in again', 'Your session has ended.', { signOut: true })
      return showMessage('Something went wrong', err.message, { retry: true })
    }
  }
  document.title = `${view.title} — ${view.studio?.name || 'Client portal'}`
  const canSwitch = (clerk?.user?.organizationMemberships?.length ?? 0) > 1
  root.innerHTML = renderView(view, { signedIn: !token, canSwitch })
  bindView(root, view, {
    respond: async (deliveryId, body) => {
      const result = await api(`/api/client/deliveries/${deliveryId}/response`, { method: 'POST', body })
      return result.view
    },
    respondDelivered: async (deliverableId, body) => (await api(`/api/client/deliverables/${deliverableId}/response`, { method: 'POST', body })).view,
    reply: async (deliverableId, body) => (await api(`/api/client/deliverables/${deliverableId}/reply`, { method: 'POST', body })).view,
    submitRequest: async body => (await api('/api/client/requests', { method: 'POST', body })).view,
    rerender: fresh => show(fresh),
    signOut,
    switchCompany: () => chooseCompany(clerk.user.organizationMemberships),
  })
}

// ── The Approve link's confirm page ──────────────────────────────────────────

const LINK_PROBLEMS = {
  link_used:    ['This link has already been used', 'It approves once. If you need to see the delivery again, open the portal.'],
  link_expired: ['This link has expired', 'Links stop working after two weeks. You can still approve or ask for changes in the portal.'],
  not_found:    ['This link isn’t working', 'It may have been copied incompletely. You can still respond in the portal.'],
}
const linkFailure = err => {
  const [title, detail] = LINK_PROBLEMS[err.code] ?? ['Something went wrong', err.message]
  return { title, detail }
}

async function showApprove() {
  let link
  try {
    link = await api('/api/client/link')
  } catch (err) {
    root.innerHTML = approveHtml(null, { failure: linkFailure(err) })
    return
  }
  document.title = `Approve ${link.title} — ${link.studio?.name || 'Client portal'}`
  // "Request changes" in an email for someone with no login opens the same page
  // with the box for changes already open.
  const wantsChanges = new URLSearchParams(location.search).get('changes') === '1'
  root.innerHTML = approveHtml(link, { openChanges: wantsChanges })
  bindApprove(link)
}

// Either answer can meet a 409/410 (someone answered, or the link was used,
// while the page was open): show how things stand instead.
async function showCurrent(link, err) {
  try { root.innerHTML = approveHtml(await api('/api/client/link')); return } catch { /* used up: say so below */ }
  root.innerHTML = approveHtml(link, { failure: linkFailure(err) })
}

function bindApprove(link) {
  const button = root.querySelector('[data-approve-now]')
  button?.addEventListener('click', async () => {
    button.disabled = true
    try {
      const result = await api('/api/client/link/approve', { method: 'POST', body: {} })
      root.innerHTML = approveHtml(result.link, { done: true })
    } catch (err) {
      if (err.status === 409 || err.status === 410) return showCurrent(link, err)
      button.disabled = false
      root.querySelector('[data-approve-msg]').textContent = err.message
    }
  })

  const actions = root.querySelector('[data-approve-actions]')
  const form = root.querySelector('[data-changes-now]')
  root.querySelector('[data-open-changes]')?.addEventListener('click', () => { actions.hidden = true; form.hidden = false; form.querySelector('#ap-comment').focus() })
  root.querySelector('[data-cancel-changes]')?.addEventListener('click', () => { form.hidden = true; actions.hidden = false; root.querySelector('[data-open-changes]').focus() })
  form?.addEventListener('submit', async e => {
    e.preventDefault()
    const msg = form.querySelector('[data-changes-msg]')
    const comment = form.querySelector('#ap-comment').value.trim()
    if (!comment) { msg.textContent = 'Say what needs to change'; form.querySelector('#ap-comment').focus(); return }
    const submit = form.querySelector('[type="submit"]')
    submit.disabled = true
    try {
      const result = await api('/api/client/link/changes', { method: 'POST', body: { comment } })
      root.innerHTML = approveHtml(result.link, { changed: true })
    } catch (err) {
      if (err.status === 409 || err.status === 410) return showCurrent(link, err)
      submit.disabled = false
      msg.textContent = err.message
    }
  })
}

// An email can point at one item (/portal#d-<id>): scroll to it once it's drawn.
function scrollToItem() {
  const id = /^#(d-[0-9a-fA-F-]{36})$/.exec(location.hash)?.[1]
  const el = id && document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ block: 'start' })
  el.classList.add('pt-d--flash')
}

async function boot() {
  if (approving) return showApprove()
  if (!token && !(await signIn())) return
  await show()
  scrollToItem()
}

boot().catch(err => {
  console.error('Portal failed to start:', err)
  root.innerHTML = message('Something went wrong', 'Please try again in a moment.', { retry: true })
  root.querySelector('[data-retry]')?.addEventListener('click', () => location.reload())
})
