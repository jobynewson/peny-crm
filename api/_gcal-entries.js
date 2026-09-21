// One-way push of Team Calendar entries → the assignee's Google Calendar.
//
// Slate is always the source of truth: nothing is ever read back from Google,
// and every event we write lives on the user's own "Slate" calendar (created
// on connect) so we can never touch an event they made themselves.
//
// Underscore-prefixed so Vercel does not count it as a Serverless Function —
// `api/google.js` delegates to it (Hobby plan: hard limit of 12 functions).

import {
  ensureFreshToken, toDateOnly, addUtcDays,
  ensureSlateCalendar, forgetSlateCalendar, eventsUrl,
} from './_gcal.js'

// `leave` entries are deliberately NOT pushed from here: approved leave
// already reaches the requester's primary Google calendar via
// syncLeaveRequestGoogle() in api/google.js, and pushing the mirrored Team
// Calendar row as well would double it up.
const PUSHABLE_TYPES = new Set(['shoot', 'post_production', 'other'])

const TYPE_LABELS = { shoot: 'Shoot', post_production: 'Post Production', other: 'Entry' }

// Google's fixed event palette. Chosen to sit near the Team Calendar's own
// type colours (green shoot / amber post / purple other / red deadline).
const COLOR_IDS = { shoot: '10', post_production: '6', other: '3', deadline: '11' }

// How far back a full resync reaches. Entries older than this are left alone —
// a backfill is about the work ahead, not a user's whole history.
const BACKFILL_DAYS_BACK = 30

// ── Event body ────────────────────────────────────────────────────────────────

// Pure: an entry row (optionally carrying `project_name`) → a Google Calendar
// event resource. All-day events only — Team Calendar entries hold dates, not
// times. Exported for unit tests.
export function buildEntryEvent(entry) {
  const isDeadline = !!entry.is_deadline
  const start = toDateOnly(entry.entry_date)
  const last  = toDateOnly(entry.end_date) || start
  // A deadline is a marker on its final day, not a block of booked time.
  const from  = isDeadline ? last : start
  const to    = last < from ? from : last

  const lines = []
  if (entry.project_name) lines.push(`Project: ${entry.project_name}`)
  lines.push(`Type: ${TYPE_LABELS[entry.entry_type] || TYPE_LABELS.other}${isDeadline ? ' (deadline)' : ''}`)
  if (entry.notes) lines.push('', String(entry.notes))
  lines.push('', 'Synced from Slate — changes made here are overwritten.')

  return {
    summary:      isDeadline ? `⚑ ${entry.label}` : entry.label,
    description:  lines.join('\n'),
    start:        { date: from },
    end:          { date: addUtcDays(to, 1) },   // Google's end date is exclusive
    transparency: isDeadline ? 'transparent' : 'opaque',
    colorId:      isDeadline ? COLOR_IDS.deadline : (COLOR_IDS[entry.entry_type] || COLOR_IDS.other),
    extendedProperties: { private: { slateEntryId: String(entry.id) } },
  }
}

// Pure: is this entry one we push at all? Exported for unit tests.
export function isPushableEntry(entry) {
  return !!entry && PUSHABLE_TYPES.has(entry.entry_type)
}

// ── Google calls ──────────────────────────────────────────────────────────────

async function googleJson(res) {
  const err = await res.json().catch(() => ({}))
  return err.error?.message || `Google returned ${res.status}`
}

// Write the event, creating the Slate calendar (and re-creating it if the user
// deleted it) as needed. Returns the event id.
async function writeEvent(sql, user, accessToken, body, existingEventId, retried = false) {
  const calendarId = await ensureSlateCalendar(sql, user, accessToken)
  const url    = existingEventId ? eventsUrl(calendarId, existingEventId) : eventsUrl(calendarId)
  const method = existingEventId ? 'PATCH' : 'POST'

  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })

  if (res.ok) return (await res.json()).id

  // The event vanished (deleted in Google) — make a new one instead.
  if (existingEventId && (res.status === 404 || res.status === 410)) {
    return writeEvent(sql, user, accessToken, body, null, retried)
  }
  // The whole calendar vanished — forget it and make a fresh one, once.
  if (!retried && res.status === 404) {
    await forgetSlateCalendar(sql, user)
    return writeEvent(sql, user, accessToken, body, null, true)
  }
  throw Object.assign(new Error(await googleJson(res)), { status: 502 })
}

async function removeEvent(accessToken, calendarId, eventId) {
  const res = await fetch(eventsUrl(calendarId, eventId), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  // Already gone is a success as far as we're concerned.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw Object.assign(new Error(await googleJson(res)), { status: 502 })
  }
}

// ── Row loading ───────────────────────────────────────────────────────────────

function userFromRow(row, prefix = 'u_') {
  if (!row?.[`${prefix}id`]) return null
  return {
    id:                row[`${prefix}id`],
    google_tokens:     row[`${prefix}google_tokens`],
    gcal_calendar_id:  row[`${prefix}gcal_calendar_id`],
    gcal_push_entries: row[`${prefix}gcal_push_entries`],
  }
}

function canPush(user) {
  return !!user?.google_tokens?.refresh_token && user.gcal_push_entries !== false
}

async function loadUser(sql, appUserId) {
  const rows = await sql`
    SELECT id, google_tokens, gcal_calendar_id, gcal_push_entries
    FROM app_users WHERE id = ${appUserId} LIMIT 1
  `
  return rows[0] || null
}

// ── Public API ────────────────────────────────────────────────────────────────

// Create/update the Google event for one entry. Handles reassignment (the
// event moves from the old assignee's calendar to the new one) and an entry
// that has stopped being pushable (the event is removed).
export async function syncCalendarEntryGoogle(sql, { entryId }) {
  if (!entryId) throw Object.assign(new Error('entryId required'), { status: 400 })

  const rows = await sql`
    SELECT e.*, p.name AS project_name,
           u.id AS u_id, u.google_tokens AS u_google_tokens,
           u.gcal_calendar_id AS u_gcal_calendar_id,
           u.gcal_push_entries AS u_gcal_push_entries
    FROM team_calendar_entries e
    JOIN app_users u ON u.id = e.assignee_id
    LEFT JOIN projects p ON p.id = e.project_id
    WHERE e.id = ${entryId}
    LIMIT 1
  `
  if (!rows[0]) throw Object.assign(new Error('Calendar entry not found'), { status: 404 })
  const entry    = rows[0]
  const assignee = userFromRow(entry)

  // An event already sitting on someone else's calendar (reassignment), or on
  // this user's calendar for an entry we no longer push, has to come off first.
  const staleOwner = entry.gcal_event_id && entry.gcal_user_id && entry.gcal_user_id !== assignee.id
  if (staleOwner) {
    await deleteCalendarEntryGoogle(sql, { eventId: entry.gcal_event_id, appUserId: entry.gcal_user_id })
    await sql`UPDATE team_calendar_entries SET gcal_event_id = NULL, gcal_user_id = NULL WHERE id = ${entryId}`
    entry.gcal_event_id = null
    entry.gcal_user_id  = null
  }

  if (!isPushableEntry(entry) || !canPush(assignee)) {
    if (entry.gcal_event_id) {
      await deleteCalendarEntryGoogle(sql, { eventId: entry.gcal_event_id, appUserId: entry.gcal_user_id || assignee.id })
      await sql`UPDATE team_calendar_entries SET gcal_event_id = NULL, gcal_user_id = NULL WHERE id = ${entryId}`
    }
    return {
      ok: true,
      skipped: isPushableEntry(entry) ? 'assignee is not pushing entries to Google' : `entry type ${entry.entry_type} is not pushed`,
    }
  }

  const accessToken = await ensureFreshToken(sql, assignee.google_tokens, assignee.id)
  const eventId = await writeEvent(sql, assignee, accessToken, buildEntryEvent(entry), entry.gcal_event_id || null)

  await sql`
    UPDATE team_calendar_entries
    SET gcal_event_id = ${eventId}, gcal_user_id = ${assignee.id}
    WHERE id = ${entryId}
  `
  return { ok: true, eventId, appUserId: assignee.id }
}

// Remove one event. Takes the ids directly because the entry row is usually
// already deleted by the time this runs; `entryId` is accepted as a fallback
// for the case where it isn't.
export async function deleteCalendarEntryGoogle(sql, { eventId, appUserId, entryId }) {
  let targetEvent = eventId
  let targetUser  = appUserId

  if ((!targetEvent || !targetUser) && entryId) {
    const rows = await sql`
      SELECT gcal_event_id, gcal_user_id, assignee_id
      FROM team_calendar_entries WHERE id = ${entryId} LIMIT 1
    `
    targetEvent = targetEvent || rows[0]?.gcal_event_id
    targetUser  = targetUser  || rows[0]?.gcal_user_id || rows[0]?.assignee_id
  }
  if (!targetEvent) return { ok: true, skipped: 'no Google Calendar event to delete' }
  if (!targetUser)  throw Object.assign(new Error('appUserId required'), { status: 400 })

  const user = await loadUser(sql, targetUser)
  if (!user?.google_tokens?.refresh_token || !user.gcal_calendar_id) {
    return { ok: true, skipped: 'user has no connected Slate calendar' }
  }

  const accessToken = await ensureFreshToken(sql, user.google_tokens, user.id)
  await removeEvent(accessToken, user.gcal_calendar_id, targetEvent)

  if (entryId) {
    await sql`UPDATE team_calendar_entries SET gcal_event_id = NULL, gcal_user_id = NULL WHERE id = ${entryId}`
  }
  return { ok: true }
}

// Push every current entry for one user — used after connecting, after turning
// the push back on, and by the "Sync now" button. Entries already carrying an
// event id are patched, so running it twice is harmless.
export async function syncAllCalendarEntriesGoogle(sql, { appUserId }) {
  if (!appUserId) throw Object.assign(new Error('appUserId required'), { status: 400 })

  const user = await loadUser(sql, appUserId)
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 })
  if (!canPush(user)) {
    return { ok: true, synced: 0, skipped: 'Google Calendar is not connected, or entry push is off' }
  }

  const since = addUtcDays(new Date().toISOString().slice(0, 10), -BACKFILL_DAYS_BACK)
  const rows = await sql`
    SELECT e.*, p.name AS project_name
    FROM team_calendar_entries e
    LEFT JOIN projects p ON p.id = e.project_id
    WHERE e.assignee_id = ${appUserId}
      AND COALESCE(e.end_date, e.entry_date) >= ${since}
    ORDER BY e.entry_date
  `
  const pushable = rows.filter(isPushableEntry)
  if (!pushable.length) return { ok: true, synced: 0 }

  const accessToken = await ensureFreshToken(sql, user.google_tokens, user.id)
  let synced = 0
  const failures = []

  for (const entry of pushable) {
    try {
      // Only reuse the stored event id when it is on *this* user's calendar.
      const existing = entry.gcal_user_id === appUserId ? entry.gcal_event_id : null
      if (entry.gcal_event_id && !existing) {
        await deleteCalendarEntryGoogle(sql, { eventId: entry.gcal_event_id, appUserId: entry.gcal_user_id })
      }
      const eventId = await writeEvent(sql, user, accessToken, buildEntryEvent(entry), existing)
      await sql`
        UPDATE team_calendar_entries
        SET gcal_event_id = ${eventId}, gcal_user_id = ${appUserId}
        WHERE id = ${entry.id}
      `
      synced++
    } catch (err) {
      // A scope problem affects every entry — stop rather than hammer Google.
      if (err.code === 'reconnect_required') throw err
      failures.push(err.message)
    }
  }
  return { ok: true, synced, failed: failures.length, errors: failures.slice(0, 3) }
}

// Take every pushed event back off a user's Slate calendar — used when they
// turn the push off or disconnect. The calendar itself is left in place.
export async function purgeCalendarEntriesGoogle(sql, { appUserId }) {
  if (!appUserId) throw Object.assign(new Error('appUserId required'), { status: 400 })

  const user = await loadUser(sql, appUserId)
  const rows = await sql`
    SELECT id, gcal_event_id FROM team_calendar_entries
    WHERE gcal_user_id = ${appUserId} AND gcal_event_id IS NOT NULL
  `
  if (!rows.length) return { ok: true, removed: 0 }

  // Without a live connection we can only forget the ids — the events stay in
  // Google, which matches what disconnecting already promises.
  if (!user?.google_tokens?.refresh_token || !user.gcal_calendar_id) {
    await sql`
      UPDATE team_calendar_entries SET gcal_event_id = NULL, gcal_user_id = NULL
      WHERE gcal_user_id = ${appUserId}
    `
    return { ok: true, removed: 0, skipped: 'no live Google connection — event ids cleared only' }
  }

  const accessToken = await ensureFreshToken(sql, user.google_tokens, user.id)
  let removed = 0
  for (const row of rows) {
    try {
      await removeEvent(accessToken, user.gcal_calendar_id, row.gcal_event_id)
      removed++
    } catch (err) {
      console.warn('Slate calendar purge failed for entry', row.id, err.message)
    }
  }
  await sql`
    UPDATE team_calendar_entries SET gcal_event_id = NULL, gcal_user_id = NULL
    WHERE gcal_user_id = ${appUserId}
  `
  return { ok: true, removed }
}
