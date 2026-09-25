// api/realtime.js
// GET /api/realtime — short-lived Ably token request for live collaboration
// on planning canvases/boards (presence, cursors, instant updates). Clerk-
// authenticated; see api/_realtime.js. Returns 503 when ABLY_API_KEY is unset,
// which the app treats as "realtime off" and keeps polling instead.
import { verifyToken } from '@clerk/backend'
import { getSql } from './_db.js'
import { issueRealtimeToken, RealtimeError } from './_realtime.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.ABLY_API_KEY) return res.status(503).json({ error: 'Realtime is not configured' })
  const raw = req.headers.authorization?.replace('Bearer ', '').trim()
  if (!raw) return res.status(401).json({ error: 'Unauthorised' })
  let clerkUserId
  try {
    clerkUserId = (await verifyToken(raw, { secretKey: process.env.CLERK_SECRET_KEY })).sub
  } catch {
    return res.status(401).json({ error: 'Invalid session token' })
  }
  try {
    const sql = getSql()
    const token = await issueRealtimeToken({ clerkUserId, sql, apiKey: process.env.ABLY_API_KEY })
    return res.status(200).json(token)
  } catch (err) {
    if (err instanceof RealtimeError) return res.status(err.status).json({ error: err.message })
    console.error('realtime token failed', err)
    return res.status(500).json({ error: 'Could not issue realtime token' })
  }
}
