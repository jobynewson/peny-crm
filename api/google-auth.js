// Google Calendar OAuth callback and disconnect handler.
// GET  (no action)          — OAuth callback from Google: exchange code → store tokens → redirect
// POST ?action=disconnect   — Remove stored tokens (Clerk auth required)

import { neon } from '@neondatabase/serverless'
import { createClerkClient } from '@clerk/backend'

export default async function handler(req, res) {
  const sql = neon(process.env.VITE_DATABASE_URL)
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const base  = `${proto}://${req.headers.host}`

  // ── POST ?action=disconnect ───────────────────────────────────────────────
  if (req.method === 'POST' && req.query.action === 'disconnect') {
    const raw = req.headers.authorization?.replace('Bearer ', '').trim()
    if (!raw) return res.status(401).json({ error: 'Unauthorised' })
    try {
      const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
      await clerk.verifyToken(raw)
    } catch {
      return res.status(401).json({ error: 'Invalid token' })
    }
    const { appUserId } = req.body ?? {}
    if (!appUserId) return res.status(400).json({ error: 'appUserId required' })
    await sql`UPDATE app_users SET google_tokens = NULL, updated_at = NOW() WHERE id = ${appUserId}`
    return res.status(200).json({ ok: true })
  }

  // ── GET — OAuth callback ──────────────────────────────────────────────────
  const { code, state, error } = req.query
  if (error || !code || !state) {
    return res.redirect(`${base}/?gc_error=${encodeURIComponent(error || 'missing_params')}#settings`)
  }

  let appUserId
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString())
    appUserId = parsed.appUserId
    if (!appUserId) throw new Error('no appUserId in state')
  } catch {
    return res.redirect(`${base}/?gc_error=bad_state#settings`)
  }

  // Exchange authorisation code for tokens
  let tokens
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  `${base}/api/google-auth`,
        grant_type:    'authorization_code',
      }),
    })
    tokens = await tokenRes.json()
    if (tokens.error) throw new Error(tokens.error_description || tokens.error)
  } catch (err) {
    return res.redirect(`${base}/?gc_error=${encodeURIComponent(err.message)}#settings`)
  }

  // Persist tokens (never expose refresh_token to the browser)
  try {
    await sql`
      UPDATE app_users
      SET google_tokens = ${JSON.stringify({
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date:   Date.now() + (tokens.expires_in || 3600) * 1000,
      })}::jsonb,
          updated_at = NOW()
      WHERE id = ${appUserId}
    `
  } catch {
    return res.redirect(`${base}/?gc_error=db_error#settings`)
  }

  return res.redirect(`${base}/?gc_connected=1#settings`)
}
