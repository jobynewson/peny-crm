// api/_training.js
// Routes behind /api/training: Personal Tools › Training. Each person reads and
// writes ONLY their own profile and sessions: every query below is filtered by
// the verified session's Clerk id (user.clerk_id), never by anything the
// browser sends.
//
//   GET    /api/training                          → { profile, done }
//   PUT    /api/training/profile                  → { profile }
//   POST   /api/training/sessions                 → { ok, id }
//   DELETE /api/training/sessions/:sport/:week/:key → { ok }  ("Mark not done")
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { invalid, readBody } from './_api.js'

// Keep in step with SPORTS / AREAS / KIT in src/training/data.js
// (api/_training.test.js checks they match).
export const SPORT_IDS = ['mtb', 'road', 'climbing', 'snow', 'running', 'general']
export const AREA_IDS = ['ham', 'calf', 'hips', 'lback', 'shoulder', 'chest', 'forearm']
export const KIT_IDS = ['band', 'kb', 'db']
export const FOCUS_IDS = ['full', 'legs', 'upper', 'core', 'power']
const KEYS = ['A', 'B', 'C']
const MAX_ITEMS_BYTES = 40_000

export const ROUTES = [
  { method: 'GET',    pattern: /^training$/,                                            handler: getAll },
  { method: 'PUT',    pattern: /^training\/profile$/,                                   handler: putProfile },
  { method: 'POST',   pattern: /^training\/sessions$/,                                  handler: postSession },
  { method: 'DELETE', pattern: /^training\/sessions\/(?<sport>[a-z]+)\/(?<week>\d+)\/(?<key>[A-C])$/, handler: deleteProgram },
]

const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi

function cleanList(value, allowed) {
  if (!Array.isArray(value)) return null
  const out = [...new Set(value)]
  return out.every(v => allowed.includes(v)) ? out : null
}

// The Build-a-session settings: length, focus and rep scheme (phase).
function cleanGen(g) {
  if (!g || typeof g !== 'object' || Array.isArray(g)) return null
  const dur = g.dur ?? 30, focus = g.focus ?? 'full', phase = g.phase ?? null
  if (!isInt(dur, 15, 75) || !FOCUS_IDS.includes(focus)) return null
  if (phase !== null && !isInt(phase, 1, 3)) return null
  return { dur, focus, phase }
}

const profileOut = r => r && ({ sport: r.sport, areas: r.areas, kit: r.kit, gen: r.gen })

async function getAll(req, res, { sql, user }) {
  const [profile] = await sql`
    SELECT sport, areas, kit, gen FROM training_profiles WHERE clerk_user_id = ${user.clerk_id}
  `
  const done = await sql`
    SELECT sport, week, session_key, completed_at FROM training_sessions
    WHERE clerk_user_id = ${user.clerk_id} AND kind = 'program'
  `
  return res.status(200).json({ profile: profileOut(profile) ?? null, done })
}

async function putProfile(req, res, { sql, user }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  if (!SPORT_IDS.includes(body.sport)) return invalid(res, 'sport', 'Choose one of the listed sports')
  const areas = cleanList(body.areas, AREA_IDS)
  if (!areas) return invalid(res, 'areas', 'Unknown cool-down area')
  const kit = cleanList(body.kit, KIT_IDS)
  if (!kit) return invalid(res, 'kit', 'Unknown kit')
  const gen = cleanGen(body.gen)
  if (!gen) return invalid(res, 'gen', 'Invalid Build a session settings')

  const [row] = await sql`
    INSERT INTO training_profiles (clerk_user_id, sport, areas, kit, gen)
    VALUES (${user.clerk_id}, ${body.sport}, ${JSON.stringify(areas)}::jsonb, ${JSON.stringify(kit)}::jsonb, ${JSON.stringify(gen)}::jsonb)
    ON CONFLICT (clerk_user_id) DO UPDATE
      SET sport = EXCLUDED.sport, areas = EXCLUDED.areas, kit = EXCLUDED.kit,
          gen = EXCLUDED.gen, updated_at = NOW()
    RETURNING sport, areas, kit, gen
  `
  return res.status(200).json({ profile: profileOut(row) })
}

// A finished session. `id` is made by the browser so a queued completion that
// is sent twice (a flaky connection) lands once.
async function postSession(req, res, { sql, user }) {
  const b = readBody(req)
  if (!b) return invalid(res, 'body', 'Request body is not valid JSON')
  if (!SPORT_IDS.includes(b.sport)) return invalid(res, 'sport', 'Choose one of the listed sports')
  if (b.kind !== 'program' && b.kind !== 'custom') return invalid(res, 'kind', 'kind must be program or custom')
  if (!isUuid(b.id)) return invalid(res, 'id', 'id must be a uuid')

  let week = null, key = null
  if (b.kind === 'program') {
    if (!isInt(b.week, 1, 8)) return invalid(res, 'week', 'week must be 1 to 8')
    if (!KEYS.includes(b.session_key)) return invalid(res, 'session_key', 'session_key must be A, B or C')
    week = b.week; key = b.session_key
  }

  let items = null
  if (b.items != null) {
    if (!Array.isArray(b.items)) return invalid(res, 'items', 'items must be a list')
    items = JSON.stringify(b.items)
    if (items.length > MAX_ITEMS_BYTES) return invalid(res, 'items', 'items is too large')
  }

  const when = v => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null }
  const completed = when(b.completed_at) ?? new Date().toISOString()
  const started = when(b.started_at)
  const dur = b.duration_seconds == null ? null : b.duration_seconds
  if (dur !== null && !isInt(dur, 0, 86_400)) return invalid(res, 'duration_seconds', 'duration_seconds must be 0 to 86400')

  if (b.kind === 'program') {
    await sql`
      INSERT INTO training_sessions (id, clerk_user_id, sport, kind, week, session_key, items, started_at, completed_at, duration_seconds)
      VALUES (${b.id}, ${user.clerk_id}, ${b.sport}, 'program', ${week}, ${key}, ${items}::jsonb, ${started}, ${completed}, ${dur})
      ON CONFLICT (clerk_user_id, sport, week, session_key) WHERE kind = 'program' DO UPDATE
        SET items = COALESCE(EXCLUDED.items, training_sessions.items),
            started_at = COALESCE(EXCLUDED.started_at, training_sessions.started_at),
            completed_at = EXCLUDED.completed_at,
            duration_seconds = COALESCE(EXCLUDED.duration_seconds, training_sessions.duration_seconds)
    `
  } else {
    await sql`
      INSERT INTO training_sessions (id, clerk_user_id, sport, kind, items, started_at, completed_at, duration_seconds)
      VALUES (${b.id}, ${user.clerk_id}, ${b.sport}, 'custom', ${items}::jsonb, ${started}, ${completed}, ${dur})
      ON CONFLICT (id) DO NOTHING
    `
  }
  return res.status(200).json({ ok: true, id: b.id })
}

// "Mark not done": removes that person's program row for the sport, week and key.
async function deleteProgram(req, res, { sql, user, params }) {
  const week = Number(params.week)
  if (!SPORT_IDS.includes(params.sport) || !isInt(week, 1, 8)) return invalid(res, 'sport', 'Unknown sport or week')
  await sql`
    DELETE FROM training_sessions
    WHERE clerk_user_id = ${user.clerk_id} AND kind = 'program'
      AND sport = ${params.sport} AND week = ${week} AND session_key = ${params.key}
  `
  return res.status(200).json({ ok: true })
}
