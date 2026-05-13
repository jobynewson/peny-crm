// api/reminders.js
// Two Vercel Cron Jobs call this endpoint:
//   09:00 UTC daily  → deliverable digest (overdue / due ≤3 days)
//   21:00 UTC daily  → note reminders (due in ~36h, i.e. the day after tomorrow)
// The ?type= query param distinguishes them.

import { neon } from '@neondatabase/serverless'
import nodemailer from 'nodemailer'

export default async function handler(req, res) {
  const authHeader = req.headers['authorization']
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorised' })
  }

  const type = req.query.type || 'deliverables'
  const sql = neon(process.env.VITE_DATABASE_URL)
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })
  const from = process.env.GMAIL_USER

  const sendMail = async (to, subject, html) => transporter.sendMail({ from, to, subject, html })

  const dateStr = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const todayLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const emailWrap = (title, greeting, bodyHtml) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:32px 0">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08)">
    <div style="background:#111;padding:20px 28px">
      <h1 style="margin:0;font-size:18px;color:#fff;font-weight:600">${title}</h1>
      <p style="margin:4px 0 0;font-size:13px;color:#999">${todayLabel}</p>
    </div>
    <div style="padding:24px 28px">
      <p style="margin:0 0 20px;font-size:14px;color:#444">${greeting}</p>
      ${bodyHtml}
    </div>
    <div style="padding:16px 28px;border-top:1px solid #f0f0f0;font-size:12px;color:#aaa">
      Log in to the CRM to update or dismiss these items.
    </div>
  </div>
</body>
</html>`

  const results = []

  // ── Deliverable digest (09:00 run) ────────────────────────────────────────
  if (type === 'deliverables') {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const projects = await sql`
      SELECT id, name, deliverables, monthly_deliverables FROM projects
      WHERE
        (deliverables IS NOT NULL AND jsonb_array_length(deliverables) > 0)
        OR (monthly_deliverables IS NOT NULL AND jsonb_array_length(monthly_deliverables) > 0)
    `
    const users = await sql`SELECT id, name, email FROM app_users`
    const userById = Object.fromEntries(users.map(u => [u.id, u]))

    const byAssignee = {}
    const checkDelivs = (delivs, projectName) => {
      for (const d of delivs) {
        if (!d.text || d.done || !d.due || !d.assignee_id) continue
        const dueDate = new Date(d.due); dueDate.setHours(0, 0, 0, 0)
        const daysUntil = Math.round((dueDate - today) / 86400000)
        if (daysUntil > 3) continue
        if (!byAssignee[d.assignee_id]) byAssignee[d.assignee_id] = []
        byAssignee[d.assignee_id].push({ projectName, text: d.text, daysUntil })
      }
    }
    for (const p of projects) {
      if (Array.isArray(p.deliverables)) checkDelivs(p.deliverables, p.name)
      if (Array.isArray(p.monthly_deliverables)) checkDelivs(p.monthly_deliverables, p.name)
    }

    const label = (n) => n < 0 ? `${Math.abs(n)}d overdue` : n === 0 ? 'due today' : `${n}d left`
    const colour = (n) => n < 0 ? '#ef4444' : n === 0 ? '#f59e0b' : '#3b82f6'
    const tableRows = (items) => items.map(i => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#1a1a1a">${i.text}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555">${i.projectName}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:${colour(i.daysUntil)};white-space:nowrap;font-weight:500">${label(i.daysUntil)}</td>
      </tr>`).join('')

    for (const [assigneeId, items] of Object.entries(byAssignee)) {
      const user = userById[assigneeId]
      if (!user?.email) continue
      const overdueCount = items.filter(i => i.daysUntil < 0).length
      const subject = overdueCount > 0
        ? `⚠ ${overdueCount} overdue deliverable${overdueCount > 1 ? 's' : ''} — ${items.length} total need attention`
        : `⏰ ${items.length} deliverable${items.length > 1 ? 's' : ''} due soon`
      const body = `
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#999;border-bottom:2px solid #f0f0f0">Deliverable</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#999;border-bottom:2px solid #f0f0f0">Project</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#999;border-bottom:2px solid #f0f0f0">Status</th>
          </tr></thead>
          <tbody>${tableRows(items)}</tbody>
        </table>`
      const name = user.name || user.email.split('@')[0]
      const html = emailWrap('Deliverable Reminders', `Hi ${name}, here's a summary of your deliverables that need attention:`, body)
      try {
        await sendMail(user.email, subject, html)
        results.push({ type: 'deliverable', to: user.email, sent: items.length })
      } catch (err) {
        results.push({ type: 'deliverable', to: user.email, error: err.message })
      }
    }
  }

  // ── Note reminders (21:00 run — fires ~36h before due date) ──────────────
  if (type === 'notes') {
    // At 21:00 UTC, "day after tomorrow" = due_date ~27–51h away, centred on 36h
    const dayAfterTomorrow = new Date()
    dayAfterTomorrow.setUTCHours(0, 0, 0, 0)
    dayAfterTomorrow.setUTCDate(dayAfterTomorrow.getUTCDate() + 2)
    const targetDate = dayAfterTomorrow.toISOString().slice(0, 10)

    const notes = await sql`
      SELECT n.id, n.clerk_id, n.title, n.content, n.due_date,
             u.name, u.email
      FROM user_notes n
      JOIN app_users u ON u.clerk_id = n.clerk_id
      WHERE n.reminder = true
        AND n.due_date = ${targetDate}
    `

    for (const note of notes) {
      if (!note.email) continue
      const name = note.name || note.email.split('@')[0]
      const noteTitle = note.title || 'Untitled note'
      const subject = `⏰ Reminder: "${noteTitle}" is due on ${dateStr(note.due_date)}`
      const body = `
        <div style="background:#f9f9f9;border-radius:8px;padding:16px 20px;margin-bottom:16px">
          <div style="font-size:15px;font-weight:600;color:#1a1a1a;margin-bottom:8px">${noteTitle}</div>
          ${note.content ? `<div style="font-size:13px;color:#555;line-height:1.6;white-space:pre-wrap">${note.content}</div>` : ''}
          <div style="margin-top:12px;font-size:12px;color:#999">Due: ${dateStr(note.due_date)}</div>
        </div>`
      const html = emailWrap('Note Reminder', `Hi ${name}, this note is due in approximately 36 hours:`, body)
      try {
        await sendMail(note.email, subject, html)
        results.push({ type: 'note', to: note.email, noteId: note.id })
      } catch (err) {
        results.push({ type: 'note', to: note.email, error: err.message })
      }
    }
  }

  return res.status(200).json({ ok: true, results })
}
