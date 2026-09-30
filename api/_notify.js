// api/_notify.js
// The one way Slate sends email. Reminders, digests, task mail, leave,
// expenses — and stage 2's alerts — all go through notify(), which checks each
// recipient's notification settings and sends through the one transport here.
// _notify.test.js fails if any other file imports nodemailer.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import nodemailer from 'nodemailer'

// Every kind of email Slate sends. A `switchable` kind is listed in Settings ›
// Notifications and each person can turn it off (or on, if it defaults off);
// the rest are part of a workflow someone is waiting on and always send.
// `superadmin` kinds are only offered to superadmins.
export const KINDS = {
  due_digest: {
    label: "What's due",
    description: 'Weekday email at 09:00 with your work that is overdue or due soon.',
    switchable: true, default: true,
  },
  task_assigned: {
    label: 'Tasks assigned to you',
    description: 'An email as soon as someone gives you a task.',
    switchable: true, default: true,
  },
  task_mentioned: {
    label: 'Mentions',
    description: 'An email when someone mentions you in a task comment.',
    switchable: true, default: true,
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
    switchable: true, default: true,
  },
  alert_changes_requested: {
    label: 'Changes requested',
    description: 'An email when a client asks for changes to a delivery.',
    switchable: true, default: true,
  },
  alert_comments_in: {
    label: 'Comments are in',
    description: 'An email when a client says their feedback on a delivery is complete (and if they take it back).',
    switchable: true, default: true,
  },
  alert_client_reply: {
    label: 'Client replies',
    description: 'An email when a client replies on an item that is waiting on them.',
    switchable: true, default: true,
  },
  alert_due_soon: {
    label: 'Due within 48 hours',
    description: 'An email, once, when a deliverable is due within 48 hours and is not in review yet.',
    switchable: true, default: true,
  },
  alert_input_overdue: {
    label: 'Client input overdue',
    description: 'An email, once, when an item has been waiting on a client for over a week.',
    switchable: true, default: true,
  },
  task_nudge:        { label: 'Unacknowledged task nudge', switchable: false },
  // To the client, each with their own Approve link. Clients have no settings
  // page, so it always sends.
  delivery_ready:    { label: 'A delivery is ready for review', switchable: false },
  leave:             { label: 'Leave requests and decisions', switchable: false },
  expense_digest:    { label: 'Monthly expense summary', switchable: false },
  expense_submitted: { label: 'Expenses submitted early', switchable: false },
}

// The kinds a person can change, in Settings order.
export const switchableKinds = ({ superadmin = false } = {}) =>
  Object.entries(KINDS)
    .filter(([, k]) => k.switchable && (!k.superadmin || superadmin))
    .map(([kind]) => kind)

// Whether someone gets this kind of email, given their stored setting (or
// undefined when they have never changed it).
export function wantsEmail(kind, stored) {
  const def = KINDS[kind]
  if (!def) throw new Error(`Unknown notification kind: ${kind}`)
  if (!def.switchable) return true
  return stored ?? def.default
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

// Stored settings for these people, as Map<clerk_id, boolean>.
async function storedSettings(sql, kind, clerkIds) {
  if (!clerkIds.length) return new Map()
  const rows = await sql`
    SELECT clerk_user_id, email FROM notification_settings
    WHERE kind = ${kind} AND clerk_user_id = ANY(${clerkIds}::text[])
  `
  return new Map(rows.map(r => [r.clerk_user_id, r.email]))
}

// Sends one email to each recipient that wants it.
//   to: a recipient or a list — { email, clerk_id?, name? }. clerk_id is what
//       their settings are keyed by; without it only the kind's default applies.
// Never throws for a failed send: returns one result per recipient —
//   { to, sent: true, messageId } | { to, skipped: 'setting' | 'not_configured' | 'no_email' } | { to, error }
export async function notify(sql, { kind, to, subject, html }) {
  if (!KINDS[kind]) throw new Error(`Unknown notification kind: ${kind}`)
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean)

  // No mail set up (e.g. a preview deployment): nothing to look up or send.
  if (!mailConfigured()) {
    return recipients.map(r => (r.email ? { to: r.email, skipped: 'not_configured' } : { to: null, skipped: 'no_email' }))
  }

  const stored = KINDS[kind].switchable
    ? await storedSettings(sql, kind, recipients.map(r => r.clerk_id).filter(Boolean))
    : new Map()

  const results = []
  for (const r of recipients) {
    if (!r.email) { results.push({ to: null, skipped: 'no_email' }); continue }
    if (!wantsEmail(kind, r.clerk_id ? stored.get(r.clerk_id) : undefined)) { results.push({ to: r.email, skipped: 'setting' }); continue }
    try {
      const info = await mailer().sendMail({ from: process.env.GMAIL_USER, to: r.email, subject, html })
      results.push({ to: r.email, sent: true, messageId: info?.messageId ?? null })
    } catch (err) {
      console.error(`[notify] ${kind} to ${r.email} failed:`, err.message)
      results.push({ to: r.email, error: err.message })
    }
  }
  return results
}
