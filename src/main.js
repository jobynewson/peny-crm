import './style.css'
import { initAuth, getCurrentUserId, signOut } from './auth/clerk.js'
import {
  getContacts, getProjects, getBudgets, getSettings,
  getOrCreateAppUser, getOrCreateWorkspace, resolvePermissions, getAllAppUsers,
  getSocialPosts, getMarketingCards, runMigrations, getTeamCalendarEntries,
  getLeaveRequests, getPublicHolidays, seedDemoBoard, seedDemoCanvas, isAppUser,
} from './db/client.js'
import { listCompanies } from './api/companies.js'
import { landingFor } from './utils/landing.js'

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

  // 0. A client (a member of their company's Clerk org) belongs on the portal.
  //    Checked before migrations or any workspace data, and they never get an
  //    app_users row. Only org members pay for the extra lookup.
  const orgCount = user.organizationMemberships?.length ?? 0
  if (orgCount && landingFor({ orgCount, isStaff: await isAppUser(clerkUserId) }) === 'portal') {
    goToPortal()
    return
  }

  // 1. Ensure schema is up to date (idempotent, safe to run every startup).
  //    Must run before creating the user row so role values match the current
  //    role CHECK constraint.
  await runMigrations()

  // 2. Get/create app user record (handles role, first-user = superadmin)
  const appUser = await getOrCreateAppUser(user)
  const permissions = resolvePermissions(appUser)

  // 3. Get/create workspace — returns the shared owner ID used for all data
  //    First user to ever sign in becomes the workspace owner automatically
  const workspaceId = await getOrCreateWorkspace(clerkUserId)

  // First-ever run: drop in a demo planning board + canvas so the features aren't empty
  await seedDemoBoard(workspaceId).catch(e => console.warn('Demo board seed failed:', e))
  await seedDemoCanvas(workspaceId).catch(e => console.warn('Demo canvas seed failed:', e))

  // 4. Load all shared workspace data in parallel
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

function goToPortal() {
  if (location.pathname !== '/portal') { location.replace('/portal'); return }
  // Only reachable until the portal page ships: /portal still falls through to
  // this app, so say where they are rather than redirect in a loop.
  document.body.innerHTML = `
    <div class="loading" style="flex-direction:column;gap:12px;text-align:center;padding:24px">
      <div>This account is for the Peny client portal, which isn't open yet.</div>
      <button id="portal-signout" style="margin-top:8px;padding:6px 14px;cursor:pointer;">Sign out</button>
    </div>
  `
  document.getElementById('portal-signout')?.addEventListener('click', signOut)
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
