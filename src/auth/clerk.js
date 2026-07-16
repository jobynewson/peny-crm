import { Clerk } from '@clerk/clerk-js'

// Demo deployments have no Clerk project — everyone is auto-signed-in as one
// fixed user, so no login screen shows and no real credentials are needed.
// Must match DEMO_USER_ID on the API side (see api/_auth.js) and the id
// scripts/seed-demo.js was run with, since all three key data by this id.
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'
const DEMO_USER_ID = import.meta.env.VITE_DEMO_USER_ID || 'demo-user'
const DEMO_USER = {
  id: DEMO_USER_ID,
  primaryEmailAddress: { emailAddress: 'demo@peny.example' },
  fullName: 'Demo User',
  username: 'demo',
}

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!DEMO_MODE && !clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env.local')
}

export const clerk = DEMO_MODE ? null : new Clerk(clerkPubKey)

// Initialise Clerk and mount sign-in if not authenticated.
// Returns the signed-in user, or null if redirected to sign-in.
export async function initAuth() {
  if (DEMO_MODE) {
    const authDiv = document.getElementById('auth')
    const appDiv  = document.getElementById('app')
    if (authDiv) authDiv.style.display = 'none'
    if (appDiv)  appDiv.style.display  = 'flex'
    return DEMO_USER
  }

  await clerk.load()

  if (!clerk.user) {
    // Not signed in — mount the Clerk sign-in component
    const authDiv = document.getElementById('auth')
    const appDiv  = document.getElementById('app')

    if (authDiv) authDiv.style.display = 'flex'
    if (appDiv)  appDiv.style.display  = 'none'

    clerk.mountSignIn(document.getElementById('sign-in'))
    return null
  }

  // Signed in — show app, hide auth screen
  const authDiv = document.getElementById('auth')
  const appDiv  = document.getElementById('app')
  if (authDiv) authDiv.style.display = 'none'
  if (appDiv)  appDiv.style.display  = 'flex'

  return clerk.user
}

// Call this anywhere you need the current user's ID for DB queries
export function getCurrentUserId() {
  if (DEMO_MODE) return DEMO_USER_ID
  return clerk.user?.id ?? null
}

// Returns a Bearer token string for authenticating API requests.
// In demo mode there's no real session, so a fixed sentinel is sent —
// api/_auth.js recognises it and skips Clerk verification server-side.
export async function getAuthToken() {
  if (DEMO_MODE) return 'demo-mode'
  const token = await clerk.session?.getToken()
  if (!token) throw new Error('No active session')
  return token
}

// Sign out and reload
export async function signOut() {
  if (DEMO_MODE) { window.location.reload(); return }
  await clerk.signOut()
  window.location.reload()
}
