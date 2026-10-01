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
  //    first sign-in if a superadmin invited you (first user = superadmin).
  //    A client — a member of their company's Clerk org — never gets one and
  //    belongs on the portal. Asked before migrations or any workspace data.
  let appUser
  try {
    appUser = await getSlateUser()
  } catch (err) {
    if (err.code === 'portal_account') { goToPortal(); return }
    if (err.code === 'not_invited') { showNotInvited(err.message); return }
    throw err
  }
  const permissions = resolvePermissions(appUser)

  // Start fetching the app's code now: it's the biggest file on the page and
  // doesn't depend on any of the data below, so it downloads while that loads.
  // The catch only keeps an early failure from being reported as unhandled;
  // the await further down still throws it.
  const appModule = import('./app.js')
  appModule.catch(() => {})

  // 1 + 2. Bring the schema up to date (a single read when it already is; see
  //    runMigrations) and find the workspace — the shared owner ID used for all
  //    data; the first user to sign in becomes the owner. `workspace` is an
  //    original table that migrations never create, so the two don't depend on
  //    each other.
  const [, workspaceId] = await Promise.all([
    runMigrations(),
    getOrCreateWorkspace(clerkUserId),
  ])

  // 3. Load all shared workspace data in parallel
  //    Companies come through /api (new data never goes through db/client.js).
  //    The demo seeds ride along: first-ever run only, to drop in a demo
  //    planning board + canvas so the features aren't empty. They run after the
  //    migrations (a new table may be needed) and cost no extra wait.
  const seeds = Promise.all([
    seedDemoBoard(workspaceId).catch(e => console.warn('Demo board seed failed:', e)),
    seedDemoCanvas(workspaceId).catch(e => console.warn('Demo canvas seed failed:', e)),
  ])
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

  await seeds
  const { App } = await appModule
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

// Signed in, but nobody has invited this account to Slate (api/_me.js).
function showNotInvited(message) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  document.body.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;height:100vh;padding:0 16px;text-align:center;font-size:13px;color:var(--text-tertiary);">
      <div>${esc(message)}</div>
      <button id="not-invited-sign-out" style="margin-top:8px;padding:6px 14px;cursor:pointer;">Sign out</button>
    </div>
  `
  document.getElementById('not-invited-sign-out').addEventListener('click', () => signOut())
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
