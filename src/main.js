import './style.css'
import { initAuth, getCurrentUserId, signOut } from './auth/clerk.js'
import {
  getContacts, getProjects, getBudgets, getSettings,
  getOrCreateWorkspace, resolvePermissions, getAllAppUsers,
  getSocialPosts, getMarketingCards, runMigrations, getTeamCalendarEntries,
  getLeaveRequests, getPublicHolidays, seedDemoBoard, seedDemoCanvas,
} from './db/client.js'
import { listCompanies } from './api/companies.js'
import { getSlateUser } from './api/me.js'

async function bootstrap() {
  document.body.innerHTML = '<div class="loading">Loading…</div>'
  document.body.innerHTML = `
    <div id="auth">
      <div id="auth-inner">
        <div id="auth-brand">
          <img src="/slate-logo.png" alt="Slate" id="auth-logo" />
          <div id="auth-product">Slate</div>
        </div>
        <div id="sign-in"></div>
      </div>
    </div>
    <div id="app" style="display:none"></div>
  `

  const user = await initAuth()
  if (!user) return

  const clerkUserId = getCurrentUserId()

  // 0. Your Slate user, from the server (api/me.js), which creates it on your
  //    first sign-in (first user = superadmin). A client — a member of their
  //    company's Clerk org — never gets one and belongs on the portal. Asked
  //    before migrations or any workspace data.
  let appUser
  try {
    appUser = await getSlateUser()
  } catch (err) {
    if (err.code === 'portal_account') { goToPortal(); return }
    throw err
  }
  const permissions = resolvePermissions(appUser)

  // 1. Ensure schema is up to date (idempotent, safe to run every startup).
  await runMigrations()

  // 2. Get/create workspace — returns the shared owner ID used for all data
  //    First user to ever sign in becomes the workspace owner automatically
  const workspaceId = await getOrCreateWorkspace(clerkUserId)

  // First-ever run: drop in a demo planning board + canvas so the features aren't empty
  await seedDemoBoard(workspaceId).catch(e => console.warn('Demo board seed failed:', e))
  await seedDemoCanvas(workspaceId).catch(e => console.warn('Demo canvas seed failed:', e))

  // 3. Load all shared workspace data in parallel
  //    Companies come through /api (new data never goes through db/client.js).
  const [contactsData, projectsData, budgetsData, settingsData, allUsersData, socialPostsData, marketingCardsData, teamCalendarData, leaveRequestsData, publicHolidaysData, companiesData] = await Promise.all([
    getContacts(workspaceId),
    getProjects(workspaceId),
    getBudgets(workspaceId),
    getSettings(workspaceId),
    getAllAppUsers(),
    getSocialPosts(workspaceId).catch(() => []),
    getMarketingCards(workspaceId).catch(() => []),
    getTeamCalendarEntries(workspaceId).catch(() => []),
    getLeaveRequests(workspaceId).catch(() => []),
    getPublicHolidays(workspaceId).catch(() => []),
    listCompanies().catch(e => { console.warn('Companies failed to load:', e); return [] }),
  ])

  const { App } = await import('./app.js')
  const app = new App({
    userId: workspaceId,
    clerkUserId,
    user,
    appUser,
    permissions,
    contacts:              contactsData,
    companies:             companiesData,
    projects:              projectsData,
    budgets:               budgetsData,
    settings:              settingsData,
    allUsers:              allUsersData,
    socialPosts:           socialPostsData,
    marketingCards:        marketingCardsData,
    teamCalendarEntries:   teamCalendarData,
    leaveRequests:         leaveRequestsData,
    publicHolidays:        publicHolidaysData,
    onSignOut: signOut,
  })

  app.mount(document.getElementById('app'))
}

// /portal is its own page (portal.html), so this never loops.
function goToPortal() {
  location.replace('/portal')
}

bootstrap().catch(err => {
  console.error('Bootstrap failed:', err)
  document.body.innerHTML = `
    <div class="loading" style="flex-direction:column;gap:12px;">
      <div>Something went wrong loading the app.</div>
      <div style="font-size:11px;color:var(--text-subtle);">${err.message}</div>
      <button onclick="location.reload()" style="margin-top:8px;padding:6px 14px;cursor:pointer;">Retry</button>
    </div>
  `
})
