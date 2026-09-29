// src/portal/main.js
// The client portal: one page for both ways in, and one data source.
//   /portal/<token>  a project's portal link → that project, read-only
//   /portal          a client signed in with Clerk → their company's worklist
// The page only decides which credential to send. What to show comes from
// GET /api/client/view, which scopes everything on the server
// (api/_client.js); the page renders whatever view comes back.
//
// Its own bundle (portal.html): no db/client.js, no Slate app code. Clerk is
// only loaded for the signed-in way in.

import './portal.css'
import { renderView, bindView, message, esc } from './render.js'

const root = document.getElementById('portal')
const token = location.pathname.match(/^\/portal\/([A-Za-z0-9_-]+)\/?$/)?.[1] ?? null
let clerk = null

// ── The API ──────────────────────────────────────────────────────────────────

async function headers() {
  if (token) return { 'X-Portal-Token': token }
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
    const stay = { routing: 'virtual', forceRedirectUrl: '/portal', signUpForceRedirectUrl: '/portal', signInForceRedirectUrl: '/portal' }
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
    reply: async (deliverableId, body) => (await api(`/api/client/deliverables/${deliverableId}/reply`, { method: 'POST', body })).view,
    submitRequest: async body => (await api('/api/client/requests', { method: 'POST', body })).view,
    rerender: fresh => show(fresh),
    signOut,
    switchCompany: () => chooseCompany(clerk.user.organizationMemberships),
  })
}

async function boot() {
  if (!token && !(await signIn())) return
  await show()
}

boot().catch(err => {
  console.error('Portal failed to start:', err)
  root.innerHTML = message('Something went wrong', 'Please try again in a moment.', { retry: true })
  root.querySelector('[data-retry]')?.addEventListener('click', () => location.reload())
})
