import './style.css'
import { initAuth, getCurrentUserId, signOut } from './auth/clerk.js'
import {
  getContacts, getProjects, getBudgets, getSettings,
  getOrCreateAppUser, getOrCreateWorkspace, resolvePermissions, getAllAppUsers,
  getSocialPosts, getMarketingCards, runMigrations, getTeamCalendarEntries,
} from './db/client.js'

async function bootstrap() {
  document.body.innerHTML = '<div class="loading">Loading…</div>'
  document.body.innerHTML = `
    <div id="auth">
      <div id="auth-inner">
        <img src="/slate-logo.png" alt="Slate" id="auth-logo" />
        <div id="sign-in"></div>
      </div>
    </div>
    <div id="app" style="display:none"></div>
  `

  const user = await initAuth()
  if (!user) return

  const clerkUserId = getCurrentUserId()

  // 1. Get/create app user record (handles role, first-user = admin)
  const appUser = await getOrCreateAppUser(user)
  const permissions = resolvePermissions(appUser)

  // 2. Get/create workspace — returns the shared owner ID used for all data
  //    First admin to ever sign in becomes the workspace owner automatically
  const workspaceId = await getOrCreateWorkspace(clerkUserId)

  // 3. Ensure schema is up to date (idempotent, safe to run every startup)
  await runMigrations()

  // 4. Load all shared workspace data in parallel
  const [contactsData, projectsData, budgetsData, settingsData, allUsersData, socialPostsData, marketingCardsData, teamCalendarData] = await Promise.all([
    getContacts(workspaceId),
    getProjects(workspaceId),
    getBudgets(workspaceId),
    getSettings(workspaceId),
    getAllAppUsers(),
    getSocialPosts(workspaceId).catch(() => []),
    getMarketingCards(workspaceId).catch(() => []),
    getTeamCalendarEntries(workspaceId).catch(() => []),
  ])

  const { App } = await import('./app.js')
  const app = new App({
    userId: workspaceId,
    clerkUserId,
    user,
    appUser,
    permissions,
    contacts:              contactsData,
    projects:              projectsData,
    budgets:               budgetsData,
    settings:              settingsData,
    allUsers:              allUsersData,
    socialPosts:           socialPostsData,
    marketingCards:        marketingCardsData,
    teamCalendarEntries:   teamCalendarData,
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
