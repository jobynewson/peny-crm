// Shared Google Calendar plumbing — token refresh, date maths and the
// per-user "Slate" calendar. Underscore-prefixed so Vercel does not count it
// as a Serverless Function (we are at the Hobby plan's 12-function limit).
//
// Used by `api/google.js` (leave sync + HTTP endpoints) and
// `api/_gcal-entries.js` (one-way push of Team Calendar entries).

// The secondary calendar we create in each user's Google account. Slate only
// ever writes to this calendar, so nothing we do can touch their own events.
export const SLATE_CALENDAR_NAME = 'Slate'
export const SLATE_CALENDAR_DESCRIPTION =
  'Team Calendar entries pushed from Slate. One-way — changes made here are overwritten on the next sync.'

// Thrown when Google rejects us for lack of permission, which for an account
// connected before the Slate-calendar feature means the stored grant only
// covers `calendar.events` and the user has to reconnect to widen it.
export function reconnectRequired(message) {
  return Object.assign(new Error(message || 'Google Calendar needs reconnecting'), {
    status: 403,
    code:   'reconnect_required',
  })
}

export async function ensureFreshToken(sql, tokens, requesterId) {
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
export function toDateOnly(value) {
  if (value == null) return value
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

// Add whole days to a 'YYYY-MM-DD' string using UTC math so there is no
// local-timezone drift. Google Calendar all-day events use an *exclusive* end
// date, so a request's end date on the calendar is its last day + 1.
export function addUtcDays(dateOnly, days) {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

// Create the user's "Slate" calendar on first use and remember its id.
// `user` is an app_users row (needs id + gcal_calendar_id).
export async function ensureSlateCalendar(sql, user, accessToken) {
  if (user.gcal_calendar_id) return user.gcal_calendar_id

  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars', {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ summary: SLATE_CALENDAR_NAME, description: SLATE_CALENDAR_DESCRIPTION }),
  })
  if (res.status === 401 || res.status === 403) {
    throw reconnectRequired('Reconnect Google Calendar to let Slate create its own calendar')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw Object.assign(new Error(err.error?.message || `Google returned ${res.status}`), { status: 502 })
  }
  const cal = await res.json()
  await sql`UPDATE app_users SET gcal_calendar_id = ${cal.id}, updated_at = NOW() WHERE id = ${user.id}`
  user.gcal_calendar_id = cal.id
  return cal.id
}

// Forget the stored calendar so the next sync makes a fresh one — used when
// Google says the calendar is gone (the user deleted it by hand).
export async function forgetSlateCalendar(sql, user) {
  await sql`UPDATE app_users SET gcal_calendar_id = NULL, updated_at = NOW() WHERE id = ${user.id}`
  user.gcal_calendar_id = null
}

export function eventsUrl(calendarId, eventId) {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
  return eventId ? `${base}/${encodeURIComponent(eventId)}` : base
}
