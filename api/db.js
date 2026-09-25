// api/db.js
// POST /api/db { op, args } — the browser's route to the database for the
// operations listed in api/_db-ops.js, which also decides who may run each
// one. Clerk-authenticated. The browser side is src/db/api.js.
import { verifyToken } from '@clerk/backend'
import { getSql } from './_db.js'
import { runOp, DbOpError } from './_db-ops.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const raw = req.headers.authorization?.replace('Bearer ', '').trim()
  if (!raw) return res.status(401).json({ error: 'Unauthorised' })
  let clerkUserId
  try {
    clerkUserId = (await verifyToken(raw, { secretKey: process.env.CLERK_SECRET_KEY })).sub
  } catch {
    return res.status(401).json({ error: 'Invalid session token' })
  }
  const { op, args } = req.body ?? {}
  try {
    const result = await runOp({ op, args, clerkUserId, sql: getSql() })
    return res.status(200).json({ result })
  } catch (err) {
    if (err instanceof DbOpError) return res.status(err.status).json({ error: err.message })
    console.error('db op failed:', op, err)
    return res.status(500).json({ error: 'Database request failed' })
  }
}
