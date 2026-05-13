// api/reminders.js
// Vercel Cron Job — runs daily at 09:00 UTC
// Sends email digests to assignees with overdue or upcoming deliverables

import { neon } from '@neondatabase/serverless'
import nodemailer from 'nodemailer'

export default async function handler(req, res) {
  // Protect the endpoint — Vercel cron sends this header automatically,
  // but we also support a manual CRON_SECRET for testing
  const authHeader = req.headers['authorization']
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorised' })
  }

  const sql = neon(process.env.VITE_DATABASE_URL)
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })
  const fromAddress = process.env.GMAIL_USER

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const in3Days = new Date(today)
  in3Days.setDate(today.getDate() + 3)

  // Fetch all projects that have deliverables with due dates and assignees
  const projects = await sql`
    SELECT id, name, user_id, deliverables, monthly_deliverables
    FROM projects
    WHERE
      (deliverables IS NOT NULL AND jsonb_array_length(deliverables) > 0)
      OR (monthly_deliverables IS NOT NULL AND jsonb_array_length(monthly_deliverables) > 0)
  `

  // Fetch all app users so we can look up emails by id
  const users = await sql`SELECT id, name, email FROM app_users`
  const userById = Object.fromEntries(users.map(u => [u.id, u]))

  // Collect reminders grouped by assignee id
  // Map: assigneeId -> [{ projectName, delivText, due, daysUntil, status }]
  const byAssignee = {}

  const checkDelivs = (delivs, projectName) => {
    for (const d of delivs) {
      if (!d.text || d.done || !d.due || !d.assignee_id) continue
      const dueDate = new Date(d.due)
      dueDate.setHours(0, 0, 0, 0)
      const daysUntil = Math.round((dueDate - today) / 86400000)
      // Only remind for overdue or due within the next 3 days
      if (daysUntil > 3) continue
      if (!byAssignee[d.assignee_id]) byAssignee[d.assignee_id] = []
      byAssignee[d.assignee_id].push({
        projectName,
        text: d.text,
        due: d.due,
        daysUntil,
      })
    }
  }

  for (const p of projects) {
    if (Array.isArray(p.deliverables)) checkDelivs(p.deliverables, p.name)
    if (Array.isArray(p.monthly_deliverables)) checkDelivs(p.monthly_deliverables, p.name)
  }

  const results = []

  for (const [assigneeId, items] of Object.entries(byAssignee)) {
    const user = userById[assigneeId]
    if (!user?.email) continue

    const overdue = items.filter(i => i.daysUntil < 0)
    const today0  = items.filter(i => i.daysUntil === 0)
    const upcoming = items.filter(i => i.daysUntil > 0)

    const formatDueLabel = (daysUntil) => {
      if (daysUntil < 0) return `${Math.abs(daysUntil)}d overdue`
      if (daysUntil === 0) return 'due today'
      return `${daysUntil}d left`
    }

    const itemRows = (list, colour) => list.map(i => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#1a1a1a">${i.text}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555">${i.projectName}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:${colour};white-space:nowrap;font-weight:500">${formatDueLabel(i.daysUntil)}</td>
      </tr>`).join('')

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:32px 0">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08)">
    <div style="background:#111;padding:20px 28px">
      <h1 style="margin:0;font-size:18px;color:#fff;font-weight:600">Deliverable Reminders</h1>
      <p style="margin:4px 0 0;font-size:13px;color:#999">${new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p>
    </div>
    <div style="padding:24px 28px">
      <p style="margin:0 0 20px;font-size:14px;color:#444">Hi ${user.name || user.email.split('@')[0]}, here's a summary of your deliverables that need attention:</p>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#999;border-bottom:2px solid #f0f0f0">Deliverable</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#999;border-bottom:2px solid #f0f0f0">Project</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#999;border-bottom:2px solid #f0f0f0">Status</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows(overdue, '#ef4444')}
          ${itemRows(today0, '#f59e0b')}
          ${itemRows(upcoming, '#3b82f6')}
        </tbody>
      </table>
    </div>
    <div style="padding:16px 28px;border-top:1px solid #f0f0f0;font-size:12px;color:#aaa">
      You're receiving this because you are assigned to deliverables in the CRM. Log in to mark items complete.
    </div>
  </div>
</body>
</html>`

    const overdueCount  = overdue.length
    const totalCount    = items.length
    const subject       = overdueCount > 0
      ? `⚠ ${overdueCount} overdue deliverable${overdueCount > 1 ? 's' : ''} — ${totalCount} total need attention`
      : `⏰ ${totalCount} deliverable${totalCount > 1 ? 's' : ''} due soon`

    try {
      await transporter.sendMail({
        from: fromAddress,
        to: user.email,
        subject,
        html,
      })
      results.push({ assignee: user.email, sent: totalCount })
    } catch (err) {
      results.push({ assignee: user.email, error: err.message })
    }
  }

  return res.status(200).json({ ok: true, results })
}
