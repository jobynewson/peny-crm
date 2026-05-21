import { Clerk } from '@clerk/clerk-js'

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env.local')
}

export const clerk = new Clerk(clerkPubKey)

// Initialise Clerk and mount sign-in if not authenticated.
// Returns the signed-in user, or null if redirected to sign-in.
export async function initAuth() {
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
  return clerk.user?.id ?? null
}

// Returns a Bearer token string for authenticating API requests
export async function getAuthToken() {
  const token = await clerk.session?.getToken()
  if (!token) throw new Error('No active session')
  return token
}

// Sign out and reload
export async function signOut() {
  await clerk.signOut()
  window.location.reload()
}
