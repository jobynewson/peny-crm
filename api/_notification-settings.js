// api/_notification-settings.js
// Routes behind /api/notification-settings: each Slate user reads and changes
// their OWN email and push settings. The kinds, their labels and defaults are KINDS in
// _notify.js; only switchable kinds are offered, and superadmin-only kinds
// only to superadmins.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { invalid, readBody } from './_api.js'
import { KINDS, switchableKinds, wantsEmail, wantsPush } from './_notify.js'

export const ROUTES = [
  { method: 'GET', pattern: /^notification-settings$/, handler: getSettings },
  { method: 'PUT', pattern: /^notification-settings$/, handler: putSetting },
]

async function listFor(sql, user) {
  const kinds = switchableKinds({ superadmin: user.role === 'superadmin' })
  const rows = await sql`
    SELECT kind, email, push FROM notification_settings
    WHERE clerk_user_id = ${user.clerk_id}
  `
  const stored = new Map(rows.map(r => [r.kind, r]))
  return kinds.map(kind => ({
    kind,
    label: KINDS[kind].label,
    description: KINDS[kind].description,
    email: wantsEmail(kind, stored.get(kind)?.email ?? undefined),
    // null when this kind never goes to devices, so the page shows no switch.
    push: KINDS[kind].push ? wantsPush(kind, stored.get(kind)?.push ?? undefined) : null,
  }))
}

// ── GET /api/notification-settings ───────────────────────────────────────────
async function getSettings(req, res, { sql, user }) {
  return res.status(200).json({ settings: await listFor(sql, user) })
}

// ── PUT /api/notification-settings ───────────────────────────────────────────
// { kind, email?: boolean, push?: boolean } for the caller only — there is no
// way to change someone else's settings. Send only what changed; the other
// stays as it was.
async function putSetting(req, res, { sql, user }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  if (!switchableKinds({ superadmin: user.role === 'superadmin' }).includes(body.kind)) {
    return invalid(res, 'kind', 'That email cannot be changed here')
  }
  const hasEmail = body.email !== undefined
  const hasPush = body.push !== undefined
  if (!hasEmail && !hasPush) return invalid(res, 'email', 'Send email or push')
  if (hasEmail && typeof body.email !== 'boolean') return invalid(res, 'email', 'email must be true or false')
  if (hasPush && typeof body.push !== 'boolean') return invalid(res, 'push', 'push must be true or false')
  if (hasPush && !KINDS[body.kind].push) return invalid(res, 'push', 'That one is email only')

  const email = hasEmail ? body.email : null
  const push = hasPush ? body.push : null
  await sql`
    INSERT INTO notification_settings (clerk_user_id, kind, email, push)
    VALUES (${user.clerk_id}, ${body.kind}, ${email}, ${push})
    ON CONFLICT (clerk_user_id, kind) DO UPDATE SET
      email = COALESCE(EXCLUDED.email, notification_settings.email),
      push = COALESCE(EXCLUDED.push, notification_settings.push),
      updated_at = NOW()
  `
  return res.status(200).json({ settings: await listFor(sql, user) })
}
