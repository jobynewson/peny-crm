import './style.css'
import { initAuth, getCurrentUserId, signOut } from './auth/clerk.js'
import { getContacts, getProjects, getBudgets, getSettings } from './db/client.js'

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap() {
  // Show a loading state while Clerk initialises
  document.body.innerHTML = '<div class="loading">Loading…</div>'

  // Restore the HTML structure (initAuth needs the auth/app divs)
  document.body.innerHTML = `
    <div id="auth">
      <div id="auth-inner">
        <img src="/peny-logo.png" alt="Peny" id="auth-logo" />
        <div id="sign-in"></div>
      </div>
    </div>
    <div id="app" style="display:none"></div>
  `

  const user = await initAuth()
  if (!user) return // Not signed in — Clerk sign-in component is now mounted

  // Signed in — load all data in parallel
  const userId = getCurrentUserId()
  const [contactsData, projectsData, budgetsData, settingsData] = await Promise.all([
    getContacts(userId),
    getProjects(userId),
    getBudgets(userId),
    getSettings(userId),
  ])

  // Kick off the app
  const { App } = await import('./app.js')
  const app = new App({
    userId,
    user,
    contacts:  contactsData,
    projects:  projectsData,
    budgets:   budgetsData,
    settings:  settingsData,
    onSignOut: signOut,
  })

  app.mount(document.getElementById('app'))
}

bootstrap().catch(err => {
  console.error('Bootstrap failed:', err)
  document.body.innerHTML = `
    <div class="loading" style="flex-direction:column;gap:12px;">
      <div>Something went wrong loading the app.</div>
      <div style="font-size:11px;color:#a8a8a0;">${err.message}</div>
      <button onclick="location.reload()" style="margin-top:8px;padding:6px 14px;cursor:pointer;">Retry</button>
    </div>
  `
})
