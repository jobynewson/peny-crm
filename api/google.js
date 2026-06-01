// All Google Calendar operations in one function (Vercel Hobby plan: 12-function limit).
//
// GET  (code + state params) — OAuth callback: exchange code → store tokens → redirect
// POST ?action=disconnect    — Remove stored tokens          (Clerk auth required)
// POST ?action=create        — Create a calendar event       (Clerk auth required)
// POST ?action=delete        — Delete a calendar event       (Clerk auth required)

import { neon } from '@neondatabase/serverless'
import { createClerkClient } from '@clerk/backend'

async function verifyClerkToken(req) {
  const raw = req.headers.authorization?.replace('Bearer ', '').trim()
  if (!raw) throw Object.assign(new Error('Unauthorised'), { status: 401 })
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  await clerk.verifyToken(raw)
}

async function ensureFreshToken(sql, tokens, requesterId) {
  if (tokens.access_token && Date.now() < tokens.expiry_date - 60_000) {
    return tokens.access_token
  }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type:    'refresh_token',
    }),
  })
  const refreshed = await r.json()
  if (refreshed.error) throw new Error(refreshed.error_description || refreshed.error)
  const newTokens = { ...tokens, access_token: refreshed.access_token, expiry_date: Date.now() + (refreshed.expires_in || 3600) * 1000 }
  await sql`UPDATE app_users SET google_tokens = ${JSON.stringify(newTokens)}::jsonb WHERE id = ${requesterId}`
  return refreshed.access_token
}

export default async function handler(req, res) {
  const sql = neon(process.env.VITE_DATABASE_URL)
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const base  = `${proto}://${req.headers.host}`

  // ── GET — OAuth callback from Google ──────────────────────────────────────
  if (req.method === 'GET') {
    const { code, state, error } = req.query
    if (error || !code || !state) {
      return res.redirect(`${base}/?gc_error=${encodeURIComponent(error || 'missing_params')}#settings`)
    }

    let appUserId
    try {
      const parsed = JSON.parse(Buffer.from(state, 'base64url').toString())
      appUserId = parsed.appUserId
      if (!appUserId) throw new Error('no appUserId')
    } catch {
      return res.redirect(`${base}/?gc_error=bad_state#settings`)
    }

    let tokens
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id:     process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri:  `${base}/api/google`,
          grant_type:    'authorization_code',
        }),
      })
      tokens = await tokenRes.json()
      if (tokens.error) throw new Error(tokens.error_description || tokens.error)
    } catch (err) {
      return res.redirect(`${base}/?gc_error=${encodeURIComponent(err.message)}#settings`)
    }

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

  // ── POST — all write operations ───────────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).end()

  try {
    await verifyClerkToken(req)
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message })
  }

  const { action, requestId, appUserId } = req.body ?? {}

  // ── Disconnect ─────────────────────────────────────────────────────────────
  if (action === 'disconnect') {
    if (!appUserId) return res.status(400).json({ error: 'appUserId required' })
    await sql`UPDATE app_users SET google_tokens = NULL, updated_at = NOW() WHERE id = ${appUserId}`
    return res.status(200).json({ ok: true })
  }

  // ── Calendar event create / delete ─────────────────────────────────────────
  if (action !== 'create' && action !== 'delete') {
    return res.status(400).json({ error: `Unknown action: ${action}` })
  }
  if (!requestId) return res.status(400).json({ error: 'requestId required' })

  const rows = await sql`
    SELECT lr.*, u.google_tokens
    FROM leave_requests lr
    JOIN app_users u ON u.id = lr.requester_id
    WHERE lr.id = ${requestId}
    LIMIT 1
  `
  if (!rows[0]) return res.status(404).json({ error: 'Leave request not found' })
  const leaveReq = rows[0]

  if (!leaveReq.google_tokens?.refresh_token) {
    return res.status(200).json({ ok: true, skipped: 'user has not connected Google Calendar' })
  }

  try {
    const accessToken = await ensureFreshToken(sql, leaveReq.google_tokens, leaveReq.requester_id)

    if (action === 'create') {
      const typeLabels = { holiday: 'Annual Leave', sick: 'Sick Leave', unpaid: 'Unpaid Leave', other: 'Leave' }
      const endExclusive = new Date(leaveReq.end_date + 'T00:00:00')
      endExclusive.setDate(endExclusive.getDate() + 1)

      const gcalRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary:      typeLabels[leaveReq.leave_type] || 'Leave',
          description:  leaveReq.reason || '',
          start:        { date: leaveReq.start_date },
          end:          { date: endExclusive.toISOString().slice(0, 10) },
          transparency: 'opaque',
        }),
      })
      if (!gcalRes.ok) {
        const err = await gcalRes.json().catch(() => ({}))
        return res.status(500).json({ error: err.error?.message || `Google returned ${gcalRes.status}` })
      }
      const event = await gcalRes.json()
      await sql`UPDATE leave_requests SET gcal_event_id = ${event.id}, updated_at = NOW() WHERE id = ${requestId}`
      return res.status(200).json({ ok: true, eventId: event.id })
    }

    if (action === 'delete') {
      const eventId = leaveReq.gcal_event_id
      if (!eventId) return res.status(200).json({ ok: true, skipped: 'no Google Calendar event to delete' })
      const gcalRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
      )
      if (!gcalRes.ok && gcalRes.status !== 404 && gcalRes.status !== 410) {
        return res.status(500).json({ error: `Google returned ${gcalRes.status}` })
      }
      await sql`UPDATE leave_requests SET gcal_event_id = NULL, updated_at = NOW() WHERE id = ${requestId}`
      return res.status(200).json({ ok: true })
    }
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
