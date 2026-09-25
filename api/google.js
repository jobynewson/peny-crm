// All Google Calendar operations in one function (Vercel Hobby plan: 12-function limit).
//
// GET  (code + state params) — OAuth callback: exchange code → store tokens → redirect
// POST action=disconnect      — Remove stored tokens + the Slate calendar link
// POST action=create|delete   — Create/delete the leave event on the primary calendar
// POST action=entry-sync      — Push one Team Calendar entry to the assignee's Slate calendar
// POST action=entry-delete    — Remove one pushed Team Calendar event
// POST action=entry-sync-all  — Backfill every current entry for one user
// POST action=entry-purge     — Take every pushed entry back off a user's Slate calendar
// (all POSTs require Clerk auth, or the internal CRON_SECRET)

import { getSql } from './_db.js'
import { verifyToken } from '@clerk/backend'
import { ensureFreshToken, toDateOnly, addUtcDays, ensureSlateCalendar } from './_gcal.js'
import {
  syncCalendarEntryGoogle, deleteCalendarEntryGoogle,
  syncAllCalendarEntriesGoogle, purgeCalendarEntriesGoogle,
} from './_gcal-entries.js'

// Returns the verified Clerk payload so callers can check *who* is asking —
// `sub` is the Clerk user id, which maps to app_users.clerk_id.
async function verifyClerkToken(req) {
  const raw = req.headers.authorization?.replace('Bearer ', '').trim()
  if (!raw) throw Object.assign(new Error('Unauthorised'), { status: 401 })
  return verifyToken(raw, { secretKey: process.env.CLERK_SECRET_KEY })
}

// Connecting, disconnecting and bulk-syncing a calendar are personal actions:
// only the owner of that app_users row may run them (a CRON_SECRET caller is
// the server talking to itself, so it passes). Editing an individual entry is
// not covered here — the Team Calendar is shared, and anyone on the team can
// already move anyone else's entry.
async function assertOwnAccount(sql, clerkPayload, appUserId) {
  if (!clerkPayload) return
  const rows = await sql`SELECT clerk_id FROM app_users WHERE id = ${appUserId} LIMIT 1`
  if (!rows[0]) throw Object.assign(new Error('User not found'), { status: 404 })
  if (rows[0].clerk_id !== clerkPayload.sub) {
    throw Object.assign(new Error('You can only change your own calendar connection'), { status: 403 })
  }
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
  const sql = getSql()
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

    // Best effort: make the user's dedicated "Slate" calendar straight away so
    // a missing permission shows up now rather than on the first entry push.
    // A reconnect reuses the calendar they already have.
    try {
      const [user] = await sql`SELECT id, gcal_calendar_id FROM app_users WHERE id = ${appUserId} LIMIT 1`
      if (user) await ensureSlateCalendar(sql, user, tokens.access_token)
    } catch (err) {
      console.warn('Could not create the Slate calendar on connect:', err.message)
    }

    return res.redirect(`${base}/?gc_connected=1#settings`)
  }

  // ── POST — all write operations ───────────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).end()

  // Allow either Clerk auth or internal CRON_SECRET
  const authHeader = req.headers['authorization']
  const isCronSecret = process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`

  let clerkPayload = null
  if (!isCronSecret) {
    try {
      clerkPayload = await verifyClerkToken(req)
    } catch (err) {
      return res.status(err.status || 401).json({ error: err.message })
    }
  }

  const { action, requestId, appUserId, entryId, eventId } = req.body ?? {}

  // ── Disconnect ─────────────────────────────────────────────────────────────
  // Events already written are left in Google (that is what the UI promises) —
  // we just forget the tokens, the Slate calendar and every event id, so a
  // reconnect starts clean instead of trying to patch events it can't see.
  if (action === 'disconnect') {
    if (!appUserId) return res.status(400).json({ error: 'appUserId required' })
    try {
      await assertOwnAccount(sql, clerkPayload, appUserId)
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message })
    }
    await sql`
      UPDATE team_calendar_entries SET gcal_event_id = NULL, gcal_user_id = NULL
      WHERE gcal_user_id = ${appUserId}
    `
    await sql`
      UPDATE app_users
      SET google_tokens = NULL, gcal_calendar_id = NULL, updated_at = NOW()
      WHERE id = ${appUserId}
    `
    return res.status(200).json({ ok: true })
  }

  // ── Team Calendar entry push (one-way: Slate → the assignee's calendar) ────
  if (action?.startsWith('entry-')) {
    try {
      if (action === 'entry-sync')      return res.status(200).json(await syncCalendarEntryGoogle(sql, { entryId }))
      if (action === 'entry-delete')    return res.status(200).json(await deleteCalendarEntryGoogle(sql, { eventId, appUserId, entryId }))
      if (action === 'entry-sync-all' || action === 'entry-purge') {
        if (!appUserId) return res.status(400).json({ error: 'appUserId required' })
        await assertOwnAccount(sql, clerkPayload, appUserId)
        return res.status(200).json(action === 'entry-sync-all'
          ? await syncAllCalendarEntriesGoogle(sql, { appUserId })
          : await purgeCalendarEntriesGoogle(sql, { appUserId }))
      }
      return res.status(400).json({ error: `Unknown action: ${action}` })
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message, code: err.code })
    }
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
