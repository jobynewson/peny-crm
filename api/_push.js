// api/_push.js
// Web push for Slate staff: sends an alert to every phone and browser a person
// has switched on (Settings › Notifications › This device). Called from
// notify() in _notify.js, which decides who wants what; this file only
// delivers. Every send ends in a recorded outcome on the device's row
// (last_ok_at / last_error), so a missing alert can be traced from Settings.
//
// Needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT in the
// environment (generate the pair with `node scripts/generate-vapid-keys.js`).
// Without them nothing is sent and nothing breaks: email carries on alone.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import webpush from 'web-push'

export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY || null

// A subscription that has failed this many sends in a row for a reason other
// than "gone" (an expired or revoked device is removed at once) is dropped, so
// a dead device does not slow every alert.
export const MAX_FAILURES = 8

let vapidSet = false
function ready() {
  if (!pushConfigured()) return false
  if (!vapidSet) {
    const subject = process.env.VAPID_SUBJECT || `mailto:${process.env.GMAIL_USER || 'slate@wearepeny.com'}`
    webpush.setVapidDetails(subject, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)
    vapidSet = true
  }
  return true
}

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

// A tap opens a page on this app, never anywhere else.
export function safeUrl(url) {
  const u = typeof url === 'string' ? url.trim() : ''
  return u.startsWith('/') && !u.startsWith('//') ? u : '/'
}

// The JSON the service worker (public/sw.js) shows. No tag: two tasks in a row
// must be two notifications, not the second replacing the first.
export const payloadFor = ({ title, body, url }) => JSON.stringify({
  title: clip(title, 80) || 'Slate',
  body: clip(body, 160),
  url: safeUrl(url),
})

// One line in the person's own recent-notifications list (Settings ›
// Notifications), so "why didn't I get that?" has an answer. Newest 30 kept.
//   outcome: 'sent' | 'failed' | 'skipped' | 'error'; detail says why.
export async function logPush(sql, { clerkId, kind, title, outcome, detail = null }) {
  try {
    await sql`
      INSERT INTO push_log (clerk_user_id, kind, title, outcome, detail)
      VALUES (${clerkId}, ${kind ?? null}, ${clip(title, 120)}, ${outcome}, ${detail ? clip(detail, 200) : null})
    `
    await sql`
      DELETE FROM push_log WHERE clerk_user_id = ${clerkId}
        AND id NOT IN (SELECT id FROM push_log WHERE clerk_user_id = ${clerkId} ORDER BY created_at DESC, id DESC LIMIT 30)
    `
  } catch (err) { console.warn('[push] could not write the log:', err.message) }
}

// Sends to one person's devices.
//   → { skipped: 'not_configured' | 'no_devices' }
//   | { sent, failed, removed, devices: [{ id, ok, status?, error? }] }
// Never throws.
export async function sendPush(sql, { clerkId, kind, title, body, url }) {
  const out = await deliverPush(sql, { clerkId, kind, title, body, url })
  const detail = out.skipped ?? out.error
    ?? (out.failed || out.removed ? [out.failed && `${out.failed} failed`, out.removed && `${out.removed} removed`].filter(Boolean).join(', ') : null)
  await logPush(sql, {
    clerkId, kind, title,
    outcome: out.error ? 'error' : out.skipped ? 'skipped' : out.sent ? 'sent' : 'failed',
    detail: out.devices?.find(d => d.error)?.error ?? detail,
  })
  return out
}

async function deliverPush(sql, { clerkId, kind, title, body, url }) {
  try {
    if (!ready()) return { skipped: 'not_configured' }
    const subs = await sql`
      SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE clerk_user_id = ${clerkId}
    `
    if (!subs.length) return { skipped: 'no_devices' }

    const payload = payloadFor({ title, body, url })
    const devices = await Promise.all(subs.map(sub => sendOne(sql, sub, payload)))
    return {
      sent: devices.filter(d => d.ok).length,
      failed: devices.filter(d => !d.ok && !d.removed).length,
      removed: devices.filter(d => d.removed).length,
      devices,
    }
  } catch (err) {
    console.error(`[push] ${kind ?? 'push'} to ${clerkId} failed:`, err.message)
    return { error: err.message }
  }
}

// A bookkeeping write must never turn a delivered push into a failure.
const quiet = q => Promise.resolve(q).catch(() => {})

async function sendOne(sql, sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { TTL: 60 * 60 * 24, urgency: 'high', timeout: 8000 },
    )
    await quiet(sql`
      UPDATE push_subscriptions
      SET last_ok_at = NOW(), failures = 0, last_error = NULL, last_error_at = NULL
      WHERE id = ${sub.id}
    `)
    return { id: sub.id, ok: true }
  } catch (err) {
    const status = err?.statusCode ?? null
    // 404 / 410: the browser says this device is gone (app removed, permission
    // revoked, subscription expired). It will never work again.
    if (status === 404 || status === 410) {
      await quiet(sql`DELETE FROM push_subscriptions WHERE id = ${sub.id}`)
      return { id: sub.id, ok: false, removed: true, status }
    }
    const message = clip(err?.body || err?.message || 'send failed', 200)
    console.error(`[push] device ${sub.id} failed (${status ?? 'no status'}): ${message}`)
    await quiet(sql`
      UPDATE push_subscriptions
      SET failures = failures + 1, last_error = ${message}, last_error_at = NOW()
      WHERE id = ${sub.id}
    `)
    await quiet(sql`DELETE FROM push_subscriptions WHERE id = ${sub.id} AND failures >= ${MAX_FAILURES}`)
    return { id: sub.id, ok: false, status, error: message }
  }
}
