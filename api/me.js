// api/me.js
// POST /api/me — the signed-in person's Slate user, created on their first
// sign-in (the rule is in _me.js). The app calls it once at boot, before
// anything else touches the database. 403 portal_account means a client: the
// app sends them to /portal.
import { neon } from '@neondatabase/serverless'
import { createClerkClient } from '@clerk/backend'
import { verifyClerkSession } from './_auth.js'
import { fail } from './_api.js'
import { slateUserFor } from './_me.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return fail(res, 405, 'method_not_allowed', `${req.method} is not allowed on this route`)
  }

  const { claims, error } = await verifyClerkSession(req)
  if (error) return fail(res, error.status, error.code, error.message)

  try {
    const result = await slateUserFor({
      sql: neon(process.env.VITE_DATABASE_URL),
      clerkUserId: claims.sub,
      clerk: createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }),
    })
    if (result.error) return fail(res, result.error.status, result.error.code, result.error.message)
    return res.status(200).json({ user: result.user })
  } catch (err) {
    console.error('[me] failed:', err)
    return fail(res, 500, 'internal_error', 'Something went wrong')
  }
}
