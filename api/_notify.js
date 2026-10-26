// api/_notify.js
// The one way Slate sends email. Reminders, digests, task mail, leave,
// expenses — and stage 2's alerts — all go through notify(), which checks each
// recipient's notification settings and sends through the one transport here.
// _notify.test.js fails if any other file imports nodemailer.
//
// Web push rides along: a caller that passes `push` (title, body, url) also
// sends that alert to the recipient's phones and browsers (api/_push.js), for
// kinds marked `push: true` below. Email and push are independent; a failure in
// one never stops the other.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import nodemailer from 'nodemailer'
import { sendPush, logPush } from './_push.js'

// Every kind of email Slate sends. A `switchable` kind is listed in Settings ›
// Notifications and each person can turn it off (or on, if it defaults off);
// the rest are part of a workflow someone is waiting on and always send.
// `superadmin` kinds are only offered to superadmins. A `push` kind also goes
// to people's devices (Settings › Notifications › This device) and is
// switched on its own. A `paused` kind is not sent at all and not offered in
// Settings; drop the flag to bring it back.
export const KINDS = {
  due_digest: {
    label: "What's due",
    description: 'Weekday email at 09:00 with your work that is overdue or due soon.',
    switchable: true, default: true, testable: true, paused: true,
  },
  task_assigned: {
    label: 'Tasks assigned to you',
    description: 'An email as soon as someone gives you a task, deliverable or board card.',
    switchable: true, default: true, push: true, testable: true,
  },
  task_mentioned: {
    label: 'Mentions',
    description: 'An email when someone mentions you in a task comment.',
    switchable: true, default: true, push: true,
  },
  note_reminder: {
    label: 'Note reminders',
    description: 'An email the evening before a note you set a reminder on is due.',
    switchable: true, default: true,
  },
  reminder_roundup: {
    label: 'Reminder roundup',
    description: 'A summary of the reminder emails Slate sent the team that day.',
    switchable: true, default: false, superadmin: true,
  },
  // Urgent alerts (api/_alerts.js): sent as they happen, or on the next
  // hourly run, whatever anyone's digest setting is. Each can be muted on its
  // own. They reach the deliverable's owner, or else the company's lead (when
  // leads are switched on) or the superadmins.
  alert_new_request: {
    label: 'New client requests',
    description: 'An email as soon as a client raises a request.',
    switchable: true, default: true, push: true, testable: true,
  },
  alert_approved: {
    label: 'Client approvals',
    description: 'An email as soon as a client approves a delivery.',
    switchable: true, default: true, testable: true, push: true,
  },
  alert_changes_requested: {
    label: 'Changes requested',
    description: 'An email when a client asks for changes to a delivery.',
    switchable: true, default: true, push: true, testable: true,
  },
  alert_comments_in: {
    label: 'Comments are in',
    description: 'An email when a client says their feedback on a delivery is complete (and if they take it back).',
    switchable: true, default: true, push: true, testable: true,
  },
  alert_client_reply: {
    label: 'Client replies',
    description: 'An email when a client replies on an item that is waiting on them.',
    switchable: true, default: true, push: true, testable: true,
  },
  alert_due_soon: {
    label: 'Due within 48 hours',
    description: 'An email, once, when a deliverable is due within 48 hours and is not in review yet, or a board card of yours is.',
    switchable: true, default: true, push: true, testable: true,
  },
  alert_input_overdue: {
    label: 'Client input overdue',
    description: 'An email, once, when an item has been waiting on a client for over a week.',
    switchable: true, default: true, push: true, testable: true,
  },
  // To whoever looks after unassigned work (Settings › Unassigned work), else
  // the superadmins.
  alert_unassigned: {
    label: 'Unassigned work',
    description: 'An email, once, when a task or deliverable has had no owner for two working days. Only sent to whoever looks after unassigned work.',
    switchable: true, default: true, push: true, testable: true,
  },
  task_nudge:        { label: 'Unacknowledged task nudge', switchable: false },
  // To the client, each with their own Approve link. Clients have no settings
  // page, so it always sends.
  delivery_ready:    { label: 'A delivery is ready for review', switchable: false, testable: true },
  // To the client who sent a request: that we have it, and what we decided.
  // Clients have no settings page, so these always send.
  request_received:  { label: 'A client request was received', switchable: false, testable: true },
  request_accepted:  { label: 'A client request was accepted', switchable: false, testable: true },
  request_declined:  { label: 'A client request was declined', switchable: false, testable: true },
  leave:             { label: 'Leave requests and decisions', switchable: false },
  expense_digest:    { label: 'Monthly expense summary', switchable: false },
  expense_submitted: { label: 'Expenses submitted early', switchable: false },
}

// The emails Testing mode redirects: the ones about the worklist and portal work.
export const TESTABLE_KINDS = Object.entries(KINDS).filter(([, k]) => k.testable).map(([kind]) => kind)

// The kinds a person can change, in Settings order.
export const switchableKinds = ({ superadmin = false } = {}) =>
  Object.entries(KINDS)
    .filter(([, k]) => k.switchable && !k.paused && (!k.superadmin || superadmin))
    .map(([kind]) => kind)

// Whether someone gets this kind of email, given their stored setting (or
// undefined when they have never changed it).
export function wantsEmail(kind, stored) {
  const def = KINDS[kind]
  if (!def) throw new Error(`Unknown notification kind: ${kind}`)
  if (!def.switchable) return true
  return stored ?? def.default
}

// Whether someone gets this kind of push, given their stored setting (or
// undefined when they have never changed it). Only `push` kinds are ever sent.
export function wantsPush(kind, stored) {
  const def = KINDS[kind]
  if (!def) throw new Error(`Unknown notification kind: ${kind}`)
  if (!def.push) return false
  return stored ?? true
}

export const mailConfigured = () => !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)

let transport = null
function mailer() {
  transport ??= nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  })
  return transport
}

// Stored settings for these people, as Map<clerk_id, { email, push }>. Either
// is null/undefined when they have never changed it.
async function storedSettings(sql, kind, clerkIds) {
  if (!clerkIds.length) return new Map()
  const rows = await sql`
    SELECT clerk_user_id, email, push FROM notification_settings
    WHERE kind = ${kind} AND clerk_user_id = ANY(${clerkIds}::text[])
  `
  return new Map(rows.map(r => [r.clerk_user_id, { email: r.email ?? undefined, push: r.push ?? undefined }]))
}

// ── Testing mode ─────────────────────────────────────────────────────────────
// While Settings › Testing is on, the emails above go to the chosen test
// addresses instead of the people they are for: one copy per intended recipient,
// the subject says who it would have gone to, and a banner at the top says so.
// Their own notification switches still apply (a muted email is not sent to the
// tester either). If testing is on with nobody chosen, they are held back, not
// sent: a switch that is on must never fall through to real people.

// The routing in force: { emails } while testing is on, else null. A database
// that has not had migration 0043 yet simply reads as off.
export async function testRouting(sql) {
  try {
    const [row] = await sql`SELECT test_mode, test_emails FROM settings WHERE test_mode = true LIMIT 1`
    if (!row?.test_mode) return null
    const emails = Array.isArray(row.test_emails) ? row.test_emails : []
    return { emails: [...new Set(emails.filter(e => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())).map(e => e.trim()))] }
  } catch { return null }
}

export const testSubject = (subject, intendedFor) => `[TEST → ${intendedFor}] ${subject}`

// The banner goes just inside <body> when there is one, else at the very top.
export function testBanner(html, intendedFor) {
  const banner = `<div style="background:#fff7d6;border:1px solid #e6c84a;color:#6b5600;padding:10px 14px;margin:0 0 12px;font:13px/1.4 -apple-system,Segoe UI,sans-serif">Testing mode: this email would have gone to <strong>${String(intendedFor).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</strong>.</div>`
  const at = /<body[^>]*>/i.exec(html ?? '')
  return at ? html.slice(0, at.index + at[0].length) + banner + html.slice(at.index + at[0].length) : banner + (html ?? '')
}

// Sends one email to each recipient that wants it, and, when `push` is given
// and the kind is a push kind, the same alert to their devices.
//   to: a recipient or a list — { email, clerk_id?, name? }. clerk_id is what
//       their settings are keyed by; without it only the kind's default applies
//       and there is no push (devices belong to a person).
//   push: { title, body, url } — what the notification says and where a tap
//       goes (a path on this app, e.g. '/#tasks').
// Never throws for a failed send: returns one result per recipient —
//   { to, sent: true, messageId } | { to, skipped: 'setting' | 'not_configured' | 'no_email' | 'paused' } | { to, error }
// each with a `push` outcome added when push was asked for (see sendPush).
export async function notify(sql, { kind, to, subject, html, push }) {
  if (!KINDS[kind]) throw new Error(`Unknown notification kind: ${kind}`)
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean)

  if (KINDS[kind].paused) {
    return recipients.map(r => ({ to: r.email ?? null, skipped: 'paused' }))
  }

  const wantPush = !!push && !!KINDS[kind].push
  const stored = (KINDS[kind].switchable || wantPush)
    ? await storedSettings(sql, kind, recipients.map(r => r.clerk_id).filter(Boolean))
    : new Map()
  const routing = KINDS[kind].testable ? await testRouting(sql) : null

  const results = []
  for (const r of recipients) {
    const mine = r.clerk_id ? stored.get(r.clerk_id) : undefined
    // Together, so a slow mail server never holds the phone alert back.
    const [result, pushed] = await Promise.all([
      emailOne(kind, r, { subject, html, routing, setting: mine?.email }),
      wantPush ? pushOne(sql, kind, r, { push, routing, setting: mine?.push }) : null,
    ])
    if (wantPush) result.push = pushed
    results.push(result)
  }
  return results
}

async function emailOne(kind, r, { subject, html, routing, setting }) {
  // No mail set up (e.g. a preview deployment): nothing to send.
  if (!mailConfigured()) return r.email ? { to: r.email, skipped: 'not_configured' } : { to: null, skipped: 'no_email' }
  if (!r.email) return { to: null, skipped: 'no_email' }
  if (!wantsEmail(kind, setting)) return { to: r.email, skipped: 'setting' }
  if (routing && !routing.emails.length) return { to: r.email, skipped: 'test_mode_no_recipients' }
  // In testing mode the same email goes to the testers, saying who it was for.
  const targets = routing ? routing.emails : [r.email]
  try {
    let last = null
    for (const target of targets) {
      last = await mailer().sendMail({
        from: process.env.GMAIL_USER, to: target,
        subject: routing ? testSubject(subject, r.email) : subject,
        html: routing ? testBanner(html, r.email) : html,
      })
    }
    return { to: r.email, sent: true, messageId: last?.messageId ?? null, ...(routing ? { redirected_to: targets } : {}) }
  } catch (err) {
    console.error(`[notify] ${kind} to ${r.email} failed:`, err.message)
    return { to: r.email, error: err.message }
  }
}

// → { skipped: 'no_account' | 'setting' | 'test_mode_no_recipients' } | sendPush()'s outcome.
// In testing mode the real person's phone stays quiet and the testers' phones
// get it instead, titled with who it was for (the email does the same).
async function pushOne(sql, kind, r, { push, routing, setting }) {
  if (!r.clerk_id) return { skipped: 'no_account' }
  if (!wantsPush(kind, setting)) {
    await logPush(sql, { clerkId: r.clerk_id, kind, title: push.title, outcome: 'skipped', detail: 'setting' })
    return { skipped: 'setting' }
  }
  if (!routing) return sendPush(sql, { clerkId: r.clerk_id, kind, ...push })

  const testers = routing.emails.length
    ? await sql`SELECT clerk_id FROM app_users WHERE lower(email) = ANY(${routing.emails.map(e => e.toLowerCase())}::text[]) AND clerk_id IS NOT NULL`
    : []
  if (!testers.length) {
    await logPush(sql, { clerkId: r.clerk_id, kind, title: push.title, outcome: 'skipped', detail: 'test_mode_no_recipients' })
    return { skipped: 'test_mode_no_recipients' }
  }
  const sent = await Promise.all(testers.map(t =>
    sendPush(sql, { clerkId: t.clerk_id, kind, ...push, title: testSubject(push.title, r.email ?? 'someone') })))
  // The real person is told nothing; their log says why.
  await logPush(sql, { clerkId: r.clerk_id, kind, title: push.title, outcome: 'skipped', detail: 'test_mode' })
  return { redirected_to: testers.length, sent: sent.reduce((n, o) => n + (o.sent ?? 0), 0) }
}
