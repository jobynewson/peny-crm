// api/_auth.js
// Shared Clerk session verification for authenticated API handlers.
//
// NOT a Vercel function — the `_` prefix keeps it out of Vercel's function
// detection. We are at the Hobby plan's 12-function cap (see claude.md).
//
// Existing handlers each inline their own verifyToken call (api/blob.js,
// api/invite.js, api/google.js, api/generate-ra.js, api/reminders.js). New code
// should use this helper instead. It resolves the caller all the way to their
// `app_users` row, because every assignee / author / actor FK in the app points
// at `app_users.id` (a uuid) — NOT at the Clerk ID.

import { verifyToken } from '@clerk/backend'

// Returns { user } on success, or { error: { status, code, message } }.
// Callers render the error themselves so the response shape stays owned by the
// route that failed.
export async function verifyClerkUser(req, sql) {
  const raw = req.headers.authorization?.replace('Bearer ', '').trim()
  if (!raw) {
    return { error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }
  }

  let clerkId
  try {
    const payload = await verifyToken(raw, { secretKey: process.env.CLERK_SECRET_KEY })
    clerkId = payload.sub
  } catch {
    return { error: { status: 401, code: 'unauthorised', message: 'Invalid session token' } }
  }

  const rows = await sql`
    SELECT id, clerk_id, email, name, role
    FROM app_users
    WHERE clerk_id = ${clerkId}
    LIMIT 1
  `
  // Authenticated with Clerk but never provisioned in the workspace. The SPA
  // creates this row at boot (getOrCreateAppUser), so in practice this only
  // fires for a token minted before that ran.
  if (!rows[0]) {
    return { error: { status: 403, code: 'not_provisioned', message: 'No workspace user for this account' } }
  }

  return { user: rows[0] }
}
