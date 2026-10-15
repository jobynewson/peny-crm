// api/_push-routes.js
// Routes behind /api/push: each Slate user manages their OWN devices for web
// push (the sending is api/_push.js; what gets pushed is KINDS in _notify.js).
//   GET    /api/push/status        { configured, publicKey, devices: [...] }
//   POST   /api/push/subscribe     { endpoint, keys: { p256dh, auth } } this device on
//   POST   /api/push/unsubscribe   { endpoint } this device off
//   DELETE /api/push/devices/:id   take one of your devices off the list
//   POST   /api/push/test          send a test to all your devices, with each result
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { createHash } from 'node:crypto'
import { invalid, readBody, UUID } from './_api.js'
import { pushConfigured, vapidPublicKey, sendPush } from './_push.js'

export const ROUTES = [
  { method: 'GET',    pattern: /^push\/status$/,                              handler: status },
  { method: 'POST',   pattern: /^push\/subscribe$/,                           handler: subscribe },
  { method: 'POST',   pattern: /^push\/unsubscribe$/,                         handler: unsubscribe },
  { method: 'DELETE', pattern: new RegExp(`^push/devices/(?<id>${UUID})$`),   handler: removeDevice },
  { method: 'POST',   pattern: /^push\/test$/,                                handler: sendTest },
]

// What the page can tell about a device without ever being sent its address:
// the same short hash is computed in the browser (src/push.js) to find "this
// device" in the list.
export const endpointHash = endpoint => createHash('sha256').update(endpoint).digest('hex').slice(0, 16)

async function devicesFor(sql, clerkId) {
  const rows = await sql`
    SELECT id, endpoint, user_agent, created_at, last_ok_at, last_error, last_error_at, failures
    FROM push_subscriptions WHERE clerk_user_id = ${clerkId}
    ORDER BY created_at
  `
  return rows.map(({ endpoint, ...d }) => ({ ...d, endpoint_hash: endpointHash(endpoint) }))
}

// What happened to your last few notifications: sent, failed, or skipped and why.
async function logFor(sql, clerkId) {
  return sql`
    SELECT kind, title, outcome, detail, created_at FROM push_log
    WHERE clerk_user_id = ${clerkId} ORDER BY created_at DESC, id DESC LIMIT 15
  `
}

async function status(req, res, { sql, user }) {
  return res.status(200).json({
    configured: pushConfigured(),
    publicKey: vapidPublicKey(),
    devices: await devicesFor(sql, user.clerk_id),
    log: await logFor(sql, user.clerk_id),
  })
}

const isHttps = s => { try { return new URL(s).protocol === 'https:' } catch { return false } }
const isKey = s => typeof s === 'string' && s.length >= 8 && s.length <= 256 && /^[A-Za-z0-9_\-+/=]+$/.test(s)

async function subscribe(req, res, { sql, user }) {
  if (!pushConfigured()) return invalid(res, 'push', 'Push is not set up on this Slate yet')
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  const { endpoint, keys } = body
  if (typeof endpoint !== 'string' || endpoint.length > 1000 || !isHttps(endpoint)) return invalid(res, 'endpoint', 'endpoint must be an https address')
  if (!isKey(keys?.p256dh) || !isKey(keys?.auth)) return invalid(res, 'keys', 'keys.p256dh and keys.auth are required')
  const agent = String(req.headers?.['user-agent'] ?? '').slice(0, 300) || null

  // Same device again (a refresh, or someone else signing in on a shared
  // phone) updates the one row and hands it to whoever is signed in now.
  await sql`
    INSERT INTO push_subscriptions (clerk_user_id, endpoint, p256dh, auth, user_agent)
    VALUES (${user.clerk_id}, ${endpoint}, ${keys.p256dh}, ${keys.auth}, ${agent})
    ON CONFLICT (endpoint) DO UPDATE SET
      clerk_user_id = EXCLUDED.clerk_user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
      user_agent = EXCLUDED.user_agent, failures = 0, last_error = NULL, last_error_at = NULL
  `
  return res.status(200).json({ devices: await devicesFor(sql, user.clerk_id) })
}

async function unsubscribe(req, res, { sql, user }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  if (typeof body.endpoint !== 'string' || !body.endpoint) return invalid(res, 'endpoint', 'endpoint is required')
  await sql`DELETE FROM push_subscriptions WHERE endpoint = ${body.endpoint} AND clerk_user_id = ${user.clerk_id}`
  return res.status(200).json({ devices: await devicesFor(sql, user.clerk_id) })
}

async function removeDevice(req, res, { sql, user, params }) {
  await sql`DELETE FROM push_subscriptions WHERE id = ${params.id} AND clerk_user_id = ${user.clerk_id}`
  return res.status(200).json({ devices: await devicesFor(sql, user.clerk_id) })
}

async function sendTest(req, res, { sql, user }) {
  const result = await sendPush(sql, {
    clerkId: user.clerk_id, kind: 'test',
    title: 'Slate test notification', body: 'If you can read this, push is working on this device.', url: '/#settings',
  })
  return res.status(200).json({ result, devices: await devicesFor(sql, user.clerk_id), log: await logFor(sql, user.clerk_id) })
}
