// All Google Calendar operations in one function (Vercel Hobby plan: 12-function limit).
//
// GET  (code + state params) — OAuth callback: exchange code → store tokens → redirect
// POST ?action=disconnect    — Remove stored tokens          (Clerk auth required)
// POST ?action=create        — Create a calendar event       (Clerk auth required)
// POST ?action=delete        — Delete a calendar event       (Clerk auth required)

import { neon } from '@neondatabase/serverless'
import { verifyToken } from '@clerk/backend'

async function verifyClerkToken(req) {
  const raw = req.headers.authorization?.replace('Bearer ', '').trim()
  if (!raw) throw Object.assign(new Error('Unauthorised'), { status: 401 })
  await verifyToken(raw, { secretKey: process.env.CLERK_SECRET_KEY })
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

// Normalise a Postgres DATE value — which Neon may return as a string
// ('2026-06-01' or '2026-06-01T00:00:00.000Z') or as a JS Date — to a plain
// 'YYYY-MM-DD' string suitable for an all-day Google Calendar event.
function toDateOnly(value) {
  if (value == null) return value
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

// Add whole days to a 'YYYY-MM-DD' string using UTC math so there is no
// local-timezone drift. Google Calendar all-day events use an *exclusive* end
// date, so a request's end date on the calendar is its last day + 1.
function addUtcDays(dateOnly, days) {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

// Shared create/delete implementation used by both the POST endpoint below and
// the server-side email-approval flow in reminders.js. Returns a
// JSON-serialisable result on success; on failure throws an Error carrying a
// `status` property so HTTP callers can surface a meaningful status code.
export async function syncLeaveRequestGoogle(sql, { action, requestId }) {
  if (action !== 'create' && action !== 'delete') {
    throw Object.assign(new Error(`Unknown action: ${action}`), { status: 400 })
  }
  if (!requestId) {
    throw Object.assign(new Error('requestId required'), { status: 400 })
  }

  const rows = await sql`
    SELECT lr.*, u.google_tokens
    FROM leave_requests lr
    JOIN app_users u ON u.id = lr.requester_id
    WHERE lr.id = ${requestId}
    LIMIT 1
  `
  if (!rows[0]) throw Object.assign(new Error('Leave request not found'), { status: 404 })
  const leaveReq = rows[0]

  if (!leaveReq.google_tokens?.refresh_token) {
    return { ok: true, skipped: 'user has not connected Google Calendar' }
  }

  const accessToken = await ensureFreshToken(sql, leaveReq.google_tokens, leaveReq.requester_id)

  if (action === 'create') {
    // Idempotent: if an event already exists, return it instead of creating a
    // duplicate when the sync is retried.
    if (leaveReq.gcal_event_id) {
      return { ok: true, eventId: leaveReq.gcal_event_id, deduped: true }
    }

    const typeLabels = { holiday: 'Annual Leave', sick: 'Sick Leave', unpaid: 'Unpaid Leave', other: 'Leave' }
    const startDate    = toDateOnly(leaveReq.start_date)
    const endExclusive = addUtcDays(toDateOnly(leaveReq.end_date), 1)

    const gcalRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary:      typeLabels[leaveReq.leave_type] || 'Leave',
        description:  leaveReq.reason || '',
        start:        { date: startDate },
        end:          { date: endExclusive },
        transparency: 'opaque',
      }),
    })
    if (!gcalRes.ok) {
      const err = await gcalRes.json().catch(() => ({}))
      throw Object.assign(new Error(err.error?.message || `Google returned ${gcalRes.status}`), { status: 502 })
    }
    const event = await gcalRes.json()
    await sql`UPDATE leave_requests SET gcal_event_id = ${event.id}, updated_at = NOW() WHERE id = ${requestId}`
    return { ok: true, eventId: event.id }
  }

  // action === 'delete'
  const eventId = leaveReq.gcal_event_id
  if (!eventId) return { ok: true, skipped: 'no Google Calendar event to delete' }
  const gcalRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!gcalRes.ok && gcalRes.status !== 404 && gcalRes.status !== 410) {
    throw Object.assign(new Error(`Google returned ${gcalRes.status}`), { status: 502 })
  }
  await sql`UPDATE leave_requests SET gcal_event_id = NULL, updated_at = NOW() WHERE id = ${requestId}`
  return { ok: true }
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

  // Allow either Clerk auth or internal CRON_SECRET
  const authHeader = req.headers['authorization']
  const isCronSecret = process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`

  if (!isCronSecret) {
    try {
      await verifyClerkToken(req)
    } catch (err) {
      return res.status(err.status || 401).json({ error: err.message })
    }
  }

  const { action, requestId, appUserId } = req.body ?? {}

  // ── Disconnect ─────────────────────────────────────────────────────────────
  if (action === 'disconnect') {
    if (!appUserId) return res.status(400).json({ error: 'appUserId required' })
    await sql`UPDATE app_users SET google_tokens = NULL, updated_at = NOW() WHERE id = ${appUserId}`
    return res.status(200).json({ ok: true })
  }

  // ── Calendar event create / delete ─────────────────────────────────────────
  // Delegate to the shared helper so this endpoint and the email-approval flow
  // behave identically. Errors carry a `status` so we can preserve meaningful
  // HTTP codes (400 bad input, 404 not found, 502 upstream Google failure).
  try {
    const result = await syncLeaveRequestGoogle(sql, { action, requestId })
    return res.status(200).json(result)
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message })
  }
}
