// api/_notification-settings.js
// Routes behind /api/notification-settings: each Slate user reads and changes
// their OWN email settings. The kinds, their labels and defaults are KINDS in
// _notify.js; only switchable kinds are offered, and superadmin-only kinds
// only to superadmins.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { invalid, readBody } from './_api.js'
import { KINDS, switchableKinds, wantsEmail } from './_notify.js'

export const ROUTES = [
  { method: 'GET', pattern: /^notification-settings$/, handler: getSettings },
  { method: 'PUT', pattern: /^notification-settings$/, handler: putSetting },
]

async function listFor(sql, user) {
  const kinds = switchableKinds({ superadmin: user.role === 'superadmin' })
  const rows = await sql`
    SELECT kind, email FROM notification_settings
    WHERE clerk_user_id = ${user.clerk_id}
  `
  const stored = new Map(rows.map(r => [r.kind, r.email]))
  return kinds.map(kind => ({
    kind,
    label: KINDS[kind].label,
    description: KINDS[kind].description,
    email: wantsEmail(kind, stored.get(kind)),
  }))
}

// ── GET /api/notification-settings ───────────────────────────────────────────
async function getSettings(req, res, { sql, user }) {
  return res.status(200).json({ settings: await listFor(sql, user) })
}

// ── PUT /api/notification-settings ───────────────────────────────────────────
// { kind, email: boolean } for the caller only — there is no way to change
// someone else's settings.
async function putSetting(req, res, { sql, user }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  if (!switchableKinds({ superadmin: user.role === 'superadmin' }).includes(body.kind)) {
    return invalid(res, 'kind', 'That email cannot be changed here')
  }
  if (typeof body.email !== 'boolean') return invalid(res, 'email', 'email must be true or false')

  await sql`
    INSERT INTO notification_settings (clerk_user_id, kind, email)
    VALUES (${user.clerk_id}, ${body.kind}, ${body.email})
    ON CONFLICT (clerk_user_id, kind) DO UPDATE SET email = EXCLUDED.email, updated_at = NOW()
  `
  return res.status(200).json({ settings: await listFor(sql, user) })
}
