// api/_task-mail.js
// Email for the task board. Phase 1 stopgap until web push (Phase 2).
//
// NOT a Vercel function — the `_` prefix keeps it out of the function count.
//
// Reuses the existing digest transport: same Gmail credentials, same nodemailer
// setup and the same email chrome as api/reminders.js. No new provider.
//
// Only `assigned` and `mentioned` are sent immediately. Everything else waits
// for the daily digest, so a busy board does not turn into a mailbox.

import nodemailer from 'nodemailer'

const IMMEDIATE_TYPES = new Set(['assigned', 'mentioned'])

export const appBaseUrl = () => process.env.VITE_APP_URL || 'https://slate.wearepeny.com'

// Returns null when mail is not configured, so callers degrade to "no email"
// rather than throwing — a task must still be created if Gmail is down.
export function taskMailer() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  })
  const from = process.env.GMAIL_USER
  return (to, subject, html) => transporter.sendMail({ from, to, subject, html })
}

// Mirrors emailWrap() in api/reminders.js so task mail looks like every other
// Slate email.
export function taskEmailWrap(title, subtitle, greeting, bodyHtml) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:32px 0">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08)">
    <div style="background:#111;padding:20px 28px">
      <h1 style="margin:0;font-size:18px;color:#fff;font-weight:600">${title}</h1>
      <p style="margin:4px 0 0;font-size:13px;color:#999">${subtitle}</p>
    </div>
    <div style="padding:24px 28px">
      <p style="margin:0 0 18px;font-size:14px;color:#444;line-height:1.5">${greeting}</p>
      ${bodyHtml}
      <p style="margin:22px 0 0;font-size:12px;color:#999">
        <a href="${appBaseUrl()}/#tasks" style="color:#3b82f6;text-decoration:none">Open the task board →</a>
      </p>
    </div>
  </div>
</body>
</html>`
}

export function taskCardHtml(task) {
  const due = task.due_at
    ? new Date(task.due_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null
  return `
    <div style="border:1px solid #eee;border-left:3px solid #E5484D;border-radius:0 6px 6px 0;padding:12px 14px;margin:0 0 10px">
      <div style="font-size:15px;font-weight:600;color:#1a1a1a">${escapeHtml(task.title)}</div>
      ${due ? `<div style="font-size:12px;color:#999;margin-top:4px">Due ${due}</div>` : ''}
    </div>`
}

export const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Send the immediate emails for one event's notifications. Never throws: a
// failed send must not fail the mutation that caused it.
export async function sendImmediateTaskEmails(sql, { task, actorName, notifications }) {
  const targets = (notifications || []).filter(n => IMMEDIATE_TYPES.has(n.type))
  if (!targets.length) return { sent: 0 }

  const send = taskMailer()
  if (!send) return { sent: 0, skipped: 'mail not configured' }

  const ids = targets.map(t => t.recipient_id)
  const users = await sql`SELECT id, name, email FROM app_users WHERE id = ANY(${ids}::uuid[])`
  const byId = Object.fromEntries(users.map(u => [u.id, u]))

  let sent = 0
  for (const target of targets) {
    const user = byId[target.recipient_id]
    if (!user?.email) continue

    const assigned = target.type === 'assigned'
    const subject = assigned
      ? `New task: ${task.title}`
      : `${actorName} mentioned you: ${task.title}`
    const greeting = assigned
      ? `Hi ${user.name || user.email.split('@')[0]}, ${actorName} has assigned you a task. Open it and hit "Got it" so they know you've seen it.`
      : `Hi ${user.name || user.email.split('@')[0]}, ${actorName} mentioned you in a comment.`

    try {
      await send(user.email, subject, taskEmailWrap(
        assigned ? 'A task for you' : 'You were mentioned',
        new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        greeting, taskCardHtml(task),
      ))
      sent++
    } catch (err) {
      console.error('[task-mail] send failed:', err.message)
    }
  }
  return { sent }
}
