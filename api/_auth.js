// api/_auth.js
// The only place Slate verifies a Clerk session token.
//
// Clients (portal users) and staff share one Clerk instance, so a valid Clerk
// session proves who someone is, not that they work at Peny. Every endpoint
// that acts for Slate staff uses verifyClerkUser, which also requires their
// `app_users` row — the row every assignee / author / actor FK in the app
// points at (a uuid, NOT the Clerk ID). Nothing else calls verifyToken:
// _staff-only.test.js fails if an endpoint does.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { verifyToken } from '@clerk/backend'

// Returns { claims } (the verified token's payload) or
// { error: { status, code, message } }.
export async function verifyClerkSession(req) {
  const raw = req.headers?.authorization?.replace('Bearer ', '').trim()
  if (!raw) {
    return { error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }
  }
  try {
    return { claims: await verifyToken(raw, { secretKey: process.env.CLERK_SECRET_KEY }) }
  } catch {
    return { error: { status: 401, code: 'unauthorised', message: 'Invalid session token' } }
  }
}

// Returns { user } — their app_users row — or { error: { status, code, message } }.
// Callers render the error themselves so the response shape stays owned by the
// route that failed.
export async function verifyClerkUser(req, sql) {
  const { claims, error } = await verifyClerkSession(req)
  if (error) return { error }

  const rows = await sql`
    SELECT id, clerk_id, email, name, role
    FROM app_users
    WHERE clerk_id = ${claims.sub}
    LIMIT 1
  `
  // Signed in with Clerk but not a Slate user: a client portal account (which
  // is never given a row), or a new starter whose token predates the row the
  // SPA creates at boot (getOrCreateAppUser).
  if (!rows[0]) {
    return { error: { status: 403, code: 'not_provisioned', message: 'This account is not a Slate user' } }
  }

  return { user: rows[0] }
}
