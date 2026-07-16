// Shared Clerk bearer-token verification for API routes.
//
// Demo deployments (DEMO_MODE=true, no real Clerk project configured) skip
// verification entirely and act as one fixed user — must match VITE_DEMO_USER_ID
// on the frontend (src/auth/clerk.js) and the id scripts/seed-demo.js was run
// with, since all three key data by this id.
import { verifyToken } from '@clerk/backend'

const DEMO_MODE = process.env.DEMO_MODE === 'true'
const DEMO_USER_ID = process.env.DEMO_USER_ID || 'demo-user'

// Verifies `Authorization: Bearer <token>` and returns the Clerk payload
// (at minimum `{ sub: <clerkUserId> }`). Throws on a missing/invalid token.
export async function verifyAuthHeader(req) {
  if (DEMO_MODE) return { sub: DEMO_USER_ID }

  const raw = req.headers.authorization?.replace('Bearer ', '').trim()
  if (!raw) throw Object.assign(new Error('Unauthorised'), { status: 401 })
  try {
    return await verifyToken(raw, { secretKey: process.env.CLERK_SECRET_KEY })
  } catch {
    throw Object.assign(new Error('Invalid session token'), { status: 401 })
  }
}
