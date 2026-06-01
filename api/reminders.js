// api/reminders.js
// Vercel Cron Jobs call this endpoint via ?type=:
//   deliverables  — 09:00 UTC daily  — overdue / due ≤3 days
//   notes         — 21:00 UTC daily  — note reminders due in ~36h
//   expense-digest — 09:00 UTC daily  — monthly expense summary (2nd-to-last working day only)
// POST ?type=leave-notify — triggered by frontend on leave request/decision
// GET ?type=leave-approve&token=xxx&action=approve|decline — email-based leave approval

import { neon } from '@neondatabase/serverless'
import nodemailer from 'nodemailer'
import { verifyToken } from '@clerk/backend'

export default async function handler(req, res) {
  // ── Leave approval (GET, token-based) ──────────────────────────────────────
  if (req.method === 'GET' && req.query.type === 'leave-approve') {
    return handleLeaveApprove(req, res)
  }

  // ── Leave notification (POST, Clerk auth) ─────────────────────────────────
  if (req.method === 'POST' && req.query.type === 'leave-notify') {
    return handleLeaveNotify(req, res)
  }

  const authHeader = req.headers['authorization']
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorised' })
  }

  // No reminder emails on weekends (Saturday=6, Sunday=0, UTC)
  const dowUTC = new Date().getUTCDay()
  if (dowUTC === 0 || dowUTC === 6) {
    return res.status(200).json({ ok: true, skipped: 'weekend', results: [] })
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

  if (type === 'expense-digest') {
    return handleExpenseDigest(req, res, sql, transporter, todayLabel)
  }

  const dateStr = (d) => {
    if (!d) return 'Invalid date'
    const dateObj = typeof d === 'string' ? new Date(d + 'T00:00:00') : (d instanceof Date ? d : new Date(d))
    if (isNaN(dateObj.getTime())) return 'Invalid date'
    return dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }
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

  // ── Marketing sub-task digest (09:00 run, same as deliverables) ─────────────
  if (type === 'deliverables') {
    const today2 = new Date()
    today2.setHours(0, 0, 0, 0)

    let mktCards = []
    try {
      mktCards = await sql`
        SELECT id, title, sub_tasks FROM marketing_cards
        WHERE sub_tasks IS NOT NULL AND jsonb_array_length(sub_tasks) > 0
      `
    } catch (_) { /* table may not exist yet */ }

    const users2 = await sql`SELECT clerk_id, name, email FROM app_users`
    const userByClerkId = Object.fromEntries(users2.map(u => [u.clerk_id, u]))

    const mktByOwner = {}
    for (const card of mktCards) {
      for (const st of (card.sub_tasks || [])) {
        if (!st.text || st.done || !st.due_date || !st.owner_id) continue
        const dueDate = new Date(st.due_date); dueDate.setHours(0, 0, 0, 0)
        const daysUntil = Math.round((dueDate - today2) / 86400000)
        if (daysUntil > 3) continue
        if (!mktByOwner[st.owner_id]) mktByOwner[st.owner_id] = []
        mktByOwner[st.owner_id].push({ cardTitle: card.title, text: st.text, daysUntil })
      }
    }

    const label2 = (n) => n < 0 ? `${Math.abs(n)}d overdue` : n === 0 ? 'due today' : `${n}d left`
    const colour2 = (n) => n < 0 ? '#ef4444' : n === 0 ? '#f59e0b' : '#3b82f6'

    for (const [ownerId, items] of Object.entries(mktByOwner)) {
      const user = userByClerkId[ownerId]
      if (!user?.email) continue
      const overdueCount = items.filter(i => i.daysUntil < 0).length
      const subject = overdueCount > 0
        ? `⚠ ${overdueCount} overdue marketing task${overdueCount > 1 ? 's' : ''} — ${items.length} total`
        : `⏰ ${items.length} marketing task${items.length > 1 ? 's' : ''} due soon`
      const body = `
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#999;border-bottom:2px solid #f0f0f0">Task</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#999;border-bottom:2px solid #f0f0f0">Card</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#999;border-bottom:2px solid #f0f0f0">Status</th>
          </tr></thead>
          <tbody>${items.map(i => `
            <tr>
              <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#1a1a1a">${i.text}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555">${i.cardTitle}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:${colour2(i.daysUntil)};white-space:nowrap;font-weight:500">${label2(i.daysUntil)}</td>
            </tr>`).join('')}</tbody>
        </table>`
      const name = user.name || user.email.split('@')[0]
      const html = emailWrap('Marketing Task Reminders', `Hi ${name}, here are your marketing tasks that need attention:`, body)
      try {
        await sendMail(user.email, subject, html)
        results.push({ type: 'marketing-task', to: user.email, sent: items.length })
      } catch (err) {
        results.push({ type: 'marketing-task', to: user.email, error: err.message })
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

  // ── Reminder roundup ─────────────────────────────────────────────────────
  // Send a summary of all emails sent this run to any admin who opted in.
  const sent = results.filter(r => !r.error)
  if (sent.length > 0) {
    let roundupRecipients = []
    try {
      roundupRecipients = await sql`
        SELECT u.email, u.name
        FROM settings s
        JOIN app_users u ON u.clerk_id = s.user_id
        WHERE s.reminder_roundup = true
          AND u.email IS NOT NULL
      `
    } catch (_) { /* settings table may not have column yet */ }

    for (const admin of roundupRecipients) {
      const typeLabel = type === 'notes' ? 'Note reminders' : 'Deliverable reminders'
      const subject = `📋 ${typeLabel} roundup — ${sent.length} sent today`

      const groupedRows = sent.map(r => {
        const typeTag = r.type === 'note' ? 'Note' : r.type === 'marketing-task' ? 'Marketing' : 'Deliverable'
        const detail = r.type === 'note'
          ? `1 note reminder`
          : `${r.sent} item${r.sent !== 1 ? 's' : ''}`
        return `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#1a1a1a">${r.to}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555">${typeTag}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#3b82f6;font-weight:500">${detail}</td>
          </tr>`
      }).join('')

      const body = `
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#999;border-bottom:2px solid #f0f0f0">Recipient</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#999;border-bottom:2px solid #f0f0f0">Type</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#999;border-bottom:2px solid #f0f0f0">Items</th>
          </tr></thead>
          <tbody>${groupedRows}</tbody>
        </table>`
      const name = admin.name || admin.email.split('@')[0]
      const html = emailWrap(
        `${typeLabel} Roundup`,
        `Hi ${name}, here's a summary of reminder emails sent today (${sent.length} total):`,
        body,
      )
      try {
        await sendMail(admin.email, subject, html)
        results.push({ type: 'roundup', to: admin.email, sent: sent.length })
      } catch (err) {
        results.push({ type: 'roundup', to: admin.email, error: err.message })
      }
    }
  }

  return res.status(200).json({ ok: true, results })
}

// ── Expense digest (called as ?type=expense-digest) ───────────────────────────
async function handleExpenseDigest(req, res, sql, transporter, todayLabel) {
  const today = new Date()
  if (!isSecondToLastWorkingDay(today)) {
    return res.status(200).json({ ok: true, skipped: 'not second-to-last working day' })
  }

  const monthKey = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`
  const from = process.env.GMAIL_USER
  const sendMail = (to, subject, html) => transporter.sendMail({ from, to, subject, html })

  const emailWrap = (title, bodyHtml) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:32px 0">
  <div style="max-width:620px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08)">
    <div style="background:#111;padding:20px 28px">
      <h1 style="margin:0;font-size:18px;color:#fff;font-weight:600">${title}</h1>
      <p style="margin:4px 0 0;font-size:13px;color:#999">${todayLabel}</p>
    </div>
    <div style="padding:24px 28px">${bodyHtml}</div>
    <div style="padding:16px 28px;border-top:1px solid #f0f0f0;font-size:12px;color:#aaa">Log in to the CRM to review or submit expenses.</div>
  </div>
</body>
</html>`

  let settingsRows = []
  try { settingsRows = await sql`SELECT expense_recipients, mileage_rate FROM settings LIMIT 1` } catch (_) {}
  const settings = settingsRows[0] ?? {}
  const recipientClerkIds = settings.expense_recipients ?? []
  if (!recipientClerkIds.length) return res.status(200).json({ ok: true, skipped: 'no recipients configured' })

  const mileageRate = parseFloat(settings.mileage_rate ?? 45) / 100

  let entries = []
  try {
    entries = await sql`
      SELECT e.*, u.name AS user_name, u.email AS user_email
      FROM expense_entries e
      JOIN app_users u ON u.clerk_id = e.clerk_user_id
      WHERE to_char(e.entry_date, 'YYYY-MM') = ${monthKey}
      ORDER BY e.clerk_user_id, e.entry_date
    `
  } catch (_) {}

  if (!entries.length) return res.status(200).json({ ok: true, skipped: 'no entries this month' })

  let submissions = []
  try {
    submissions = await sql`SELECT clerk_user_id FROM expense_submissions WHERE month_key = ${monthKey}`
  } catch (_) {}
  const submittedUsers = new Set(submissions.map(s => s.clerk_user_id))

  const byUser = {}
  for (const e of entries) {
    if (!byUser[e.clerk_user_id]) byUser[e.clerk_user_id] = { name: e.user_name || e.user_email, entries: [] }
    byUser[e.clerk_user_id].entries.push(e)
  }

  const fmt2 = n => Number(n || 0).toFixed(2)
  const fmtDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const monthLabel = new Date(monthKey + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  const summaryRows = Object.entries(byUser).map(([clerkId, { name, entries: ents }]) => {
    let miles = 0, amt = 0, nights = 0
    for (const e of ents) {
      if (e.type === 'mileage') miles += parseFloat(e.miles ?? 0)
      if (e.type === 'expense') amt += parseFloat(e.amount ?? 0)
      if (e.type === 'overnight') nights += parseInt(e.overnights ?? 0)
    }
    const total = (miles * mileageRate) + amt
    const submitted = submittedUsers.has(clerkId)
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#1a1a1a;font-weight:500">${name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555;text-align:right">${miles > 0 ? `${miles}mi` : '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555;text-align:right">${nights > 0 ? nights : '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555;text-align:right">${amt > 0 ? `£${fmt2(amt)}` : '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;font-weight:600;color:#1a1a1a;text-align:right">£${fmt2(total)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;text-align:center">${submitted ? `<span style="padding:2px 7px;background:#d1fae5;color:#065f46;border-radius:10px">✓</span>` : ''}</td>
    </tr>`
  }).join('')

  const breakdownSections = Object.entries(byUser).map(([clerkId, { name, entries: ents }]) => {
    let miles = 0, amt = 0, nights = 0
    for (const e of ents) {
      if (e.type === 'mileage') miles += parseFloat(e.miles ?? 0)
      if (e.type === 'expense') amt += parseFloat(e.amount ?? 0)
      if (e.type === 'overnight') nights += parseInt(e.overnights ?? 0)
    }
    const totalCash = (miles * mileageRate) + amt
    const submitted = submittedUsers.has(clerkId)
    const badge = submitted ? `<span style="padding:1px 7px;background:#d1fae5;color:#065f46;border-radius:10px;font-size:11px;font-weight:500;margin-left:8px">Submitted</span>` : ''
    const rows = ents.map(e => {
      const typeLabel = e.type === 'mileage' ? 'Mileage' : e.type === 'expense' ? 'Expense' : 'Overnight'
      const detail = e.type === 'mileage' ? `${e.miles} miles (£${fmt2(parseFloat(e.miles ?? 0) * mileageRate)})`
        : e.type === 'expense' ? `£${fmt2(parseFloat(e.amount ?? 0))}`
        : `${e.overnights} night${parseInt(e.overnights) !== 1 ? 's' : ''}`
      return `<tr>
        <td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555">${fmtDate(e.entry_date)}</td>
        <td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555">${typeLabel}</td>
        <td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#1a1a1a">${e.description || '—'}</td>
        <td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;text-align:right;white-space:nowrap">${detail}</td>
      </tr>`
    }).join('')
    const totalParts = [
      miles  ? `${miles}mi = £${fmt2(miles * mileageRate)}` : null,
      amt    ? `£${fmt2(amt)} expenses` : null,
      nights ? `${nights} night${nights !== 1 ? 's' : ''}` : null,
    ].filter(Boolean)
    return `
      <div style="margin-bottom:24px">
        <div style="font-size:14px;font-weight:600;color:#1a1a1a;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #f0f0f0">${name}${badge}</div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
          <thead><tr style="background:#f9f9f9">
            <th style="padding:7px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#999;text-align:left;border-bottom:1px solid #f0f0f0">Date</th>
            <th style="padding:7px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#999;text-align:left;border-bottom:1px solid #f0f0f0">Type</th>
            <th style="padding:7px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#999;text-align:left;border-bottom:1px solid #f0f0f0">Description</th>
            <th style="padding:7px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#999;text-align:right;border-bottom:1px solid #f0f0f0">Amount</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="text-align:right;font-size:13px;font-weight:600;color:#1a1a1a;padding:4px 12px">
          Total: ${totalParts.join(' + ')}${totalCash > 0 ? ` = £${fmt2(totalCash)}` : ''}
        </div>
      </div>`
  }).join('')

  const bodyHtml = `
    <p style="margin:0 0 20px;font-size:14px;color:#444">Monthly expense summary for <strong>${monthLabel}</strong>. Rate: ${settings.mileage_rate ?? 45}p/mile.</p>
    <h3 style="font-size:13px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 10px">Summary</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:28px">
      <thead><tr style="background:#f9f9f9">
        <th style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#999;text-align:left;border-bottom:2px solid #f0f0f0">Name</th>
        <th style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#999;text-align:right;border-bottom:2px solid #f0f0f0">Miles</th>
        <th style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#999;text-align:right;border-bottom:2px solid #f0f0f0">Nights</th>
        <th style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#999;text-align:right;border-bottom:2px solid #f0f0f0">Expenses</th>
        <th style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#999;text-align:right;border-bottom:2px solid #f0f0f0">Total £</th>
        <th style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#999;text-align:center;border-bottom:2px solid #f0f0f0">Submitted</th>
      </tr></thead>
      <tbody>${summaryRows}</tbody>
    </table>
    <h3 style="font-size:13px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 16px">Breakdown</h3>
    ${breakdownSections}`

  const recipientUsers = await sql`SELECT email FROM app_users WHERE clerk_id = ANY(${recipientClerkIds})`
  const results = []
  for (const recipient of recipientUsers) {
    if (!recipient.email) continue
    const html = emailWrap(`Expense Summary — ${monthLabel}`, bodyHtml)
    try {
      await sendMail(recipient.email, `💷 Expense summary — ${monthLabel}`, html)
      results.push({ to: recipient.email, ok: true })
    } catch (err) {
      results.push({ to: recipient.email, error: err.message })
    }
  }
  return res.status(200).json({ ok: true, month: monthKey, results })
}

// ── Leave notifications (POST ?type=leave-notify) ─────────────────────────────
async function handleLeaveNotify(req, res) {
  const raw = req.headers.authorization?.replace('Bearer ', '').trim()
  if (!raw) return res.status(401).json({ error: 'Unauthorised' })

  try {
    await verifyToken(raw, { secretKey: process.env.CLERK_SECRET_KEY })
  } catch {
    return res.status(401).json({ error: 'Invalid session token' })
  }

  const { action, requestId } = req.body ?? {}
  if (!action || !requestId) return res.status(400).json({ error: 'action and requestId required' })

  const sql = neon(process.env.VITE_DATABASE_URL)

  let request, requester, approver, superadmins = []
  try {
    const rows = await sql`
      SELECT r.*,
        req.name  AS requester_name,  req.email  AS requester_email,
        app.name  AS approver_name,   app.email  AS approver_email
      FROM leave_requests r
      JOIN app_users req ON req.id = r.requester_id
      LEFT JOIN app_users app ON app.id = r.approver_id
      WHERE r.id = ${requestId}
      LIMIT 1`
    if (!rows[0]) return res.status(404).json({ error: 'Request not found' })
    request = rows[0]
    requester = { name: request.requester_name, email: request.requester_email }
    approver  = request.approver_email ? { name: request.approver_name, email: request.approver_email } : null

    if (!approver) {
      superadmins = await sql`SELECT name, email FROM app_users WHERE role = 'superadmin' AND email IS NOT NULL`
    }
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return res.status(200).json({ ok: true, skipped: 'email not configured' })
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  })
  const from = process.env.GMAIL_USER
  const sendMail = (to, subject, html) => transporter.sendMail({ from, to, subject, html })

  const fmtDate = d => {
    if (!d) return 'Invalid date'
    const dateStr = typeof d === 'string' ? d : (d instanceof Date ? d.toISOString().split('T')[0] : String(d))
    const parsed = new Date(dateStr + 'T00:00:00')
    if (isNaN(parsed.getTime())) return 'Invalid date'
    return parsed.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  }
  const typeLabel = { holiday: 'Annual leave', sick: 'Sickness', unpaid: 'Unpaid leave', other: 'Other' }[request.leave_type] ?? request.leave_type
  const dateRange = request.start_date === request.end_date
    ? fmtDate(request.start_date)
    : `${fmtDate(request.start_date)} → ${fmtDate(request.end_date)}`
  const days = `${Number(request.total_days)} day${Number(request.total_days) === 1 ? '' : 's'}`

  const wrap = (title, bodyHtml) => `
<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08)">
    <div style="background:#111;padding:20px 28px">
      <h1 style="margin:0;font-size:18px;color:#fff;font-weight:600">${title}</h1>
    </div>
    <div style="padding:24px 28px;font-size:14px;color:#444;line-height:1.7">${bodyHtml}</div>
    <div style="padding:14px 28px;border-top:1px solid #f0f0f0;font-size:12px;color:#aaa">Log in to Slate to review and action this request.</div>
  </div>
</body></html>`

  // Collect per-recipient outcomes so a swallowed failure (bad credentials,
  // Gmail rejection, etc.) is reported in the response instead of vanishing.
  const results = []
  const trySend = async (to, subject, html) => {
    try {
      const info = await sendMail(to, subject, html)
      results.push({ to, ok: true, messageId: info?.messageId ?? null })
    } catch (err) {
      console.error(`Leave email to ${to} failed:`, err)
      results.push({ to, error: err.message })
    }
  }

  if (action === 'submitted') {
    const recipients = approver ? [approver] : superadmins
    const baseUrl = process.env.VITE_APP_URL || 'https://slate.wearepeny.com'
    const body = `
      <p><strong>${requester.name || requester.email}</strong> has submitted a leave request:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
        <tr><td style="padding:6px 0;color:#777;width:120px">Type</td><td style="padding:6px 0"><strong>${typeLabel}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#777">Dates</td><td style="padding:6px 0">${dateRange}</td></tr>
        <tr><td style="padding:6px 0;color:#777">Duration</td><td style="padding:6px 0">${days}</td></tr>
        ${request.reason ? `<tr><td style="padding:6px 0;color:#777">Note</td><td style="padding:6px 0">${request.reason}</td></tr>` : ''}
      </table>
      <div style="display:flex;gap:12px;margin:20px 0">
        <a href="${baseUrl}/api/reminders?type=leave-approve&token=${request.approval_token}&action=approve" style="display:inline-block;background:#16a34a;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:500;font-size:14px">Approve</a>
        <a href="${baseUrl}/api/reminders?type=leave-approve&token=${request.approval_token}&action=decline" style="display:inline-block;background:#dc2626;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:500;font-size:14px">Decline</a>
      </div>
      <p style="font-size:12px;color:#666">Or log in to the CRM to approve or add a decline reason.</p>`
    for (const r of recipients) {
      if (r.email) await trySend(r.email, `Leave request from ${requester.name || requester.email}`, wrap('New leave request', body))
    }
    if (!results.length) return res.status(200).json({ ok: true, skipped: 'no recipient email', recipients: recipients.length })
  } else if (action === 'decided') {
    if (!requester.email) return res.status(200).json({ ok: true, skipped: 'no requester email' })
    const statusLabel = request.status === 'approved' ? 'approved ✓' : 'declined ✗'
    const accentColor = request.status === 'approved' ? '#16a34a' : '#dc2626'
    const body = `
      <p>Your leave request has been <strong style="color:${accentColor}">${statusLabel}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
        <tr><td style="padding:6px 0;color:#777;width:120px">Type</td><td style="padding:6px 0">${typeLabel}</td></tr>
        <tr><td style="padding:6px 0;color:#777">Dates</td><td style="padding:6px 0">${dateRange}</td></tr>
        <tr><td style="padding:6px 0;color:#777">Duration</td><td style="padding:6px 0">${days}</td></tr>
        ${request.decision_note ? `<tr><td style="padding:6px 0;color:#777">Note</td><td style="padding:6px 0">${request.decision_note}</td></tr>` : ''}
      </table>`
    await trySend(requester.email, `Your leave request has been ${request.status}`, wrap('Leave request update', body))
  }

  // Surface failures: if every attempted send errored, return 502 so the caller
  // (and any test) sees the real reason rather than a misleading success.
  const failures = results.filter(r => r.error)
  if (failures.length && failures.length === results.length) {
    return res.status(502).json({ ok: false, error: 'All leave emails failed to send', results })
  }
  return res.status(200).json({ ok: true, results })
}

// ── Leave approval (GET, token-based approval without login) ──────────────────
async function handleLeaveApprove(req, res) {
  const { token, action } = req.query

  if (!token) {
    return res.status(400).json({ error: 'Missing approval token' })
  }

  if (!action || !['approve', 'decline'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' })
  }

  const sql = neon(process.env.VITE_DATABASE_URL)

  try {
    // Find the leave request by token
    const requests = await sql`
      SELECT r.*, u.name AS requester_name
      FROM leave_requests r
      JOIN app_users u ON u.id = r.requester_id
      WHERE r.approval_token = ${token} AND r.status = 'pending'
      LIMIT 1
    `

    if (!requests.length) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Leave Request Not Found</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 32px 20px; }
            .container { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 10px; padding: 40px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); text-align: center; }
            h1 { margin: 0; color: #dc2626; }
            p { margin: 12px 0 0; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Request not found</h1>
            <p>This leave request has already been processed or the link is invalid.</p>
          </div>
        </body>
        </html>
      `)
    }

    const request = requests[0]

    if (action === 'approve') {
      // Update status to approved
      await sql`
        UPDATE leave_requests
        SET status = 'approved', decided_by = ${request.approver_id}, decided_at = NOW()
        WHERE id = ${request.id}
      `

      // Create calendar entry
      const LEAVE_TYPES = {
        holiday: { label: 'Annual leave', color: '#0891b2' },
        sick: { label: 'Sickness', color: '#dc2626' },
        unpaid: { label: 'Unpaid leave', color: '#6b7280' },
        other: { label: 'Other', color: '#7c3aed' },
      }
      const t = LEAVE_TYPES[request.leave_type] || LEAVE_TYPES.other

      const calEntries = await sql`
        INSERT INTO team_calendar_entries (user_id, assignee_id, entry_date, end_date, entry_type, label, color, notes)
        VALUES (
          ${request.user_id},
          ${request.requester_id},
          ${request.start_date},
          ${request.start_date === request.end_date ? null : request.end_date},
          'leave',
          ${t.label},
          ${t.color},
          ${request.reason || null}
        )
        RETURNING id
      `

      // Link calendar entry to leave request
      await sql`
        UPDATE leave_requests
        SET calendar_entry_id = ${calEntries[0].id}
        WHERE id = ${request.id}
      `

      // Sync to Google Calendar (fire-and-forget)
      try {
        const requesterUser = await sql`SELECT google_tokens FROM app_users WHERE id = ${request.requester_id} LIMIT 1`
        if (requesterUser[0]?.google_tokens) {
          fetch('/api/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'create', requestId: request.id }),
          }).catch(e => console.warn('Google Calendar sync failed (non-fatal):', e))
        }
      } catch (e) {
        console.warn('Google Calendar sync check failed (non-fatal):', e)
      }

      return res.status(200).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Leave Approved</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 32px 20px; }
            .container { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 10px; padding: 40px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); text-align: center; }
            h1 { margin: 0; color: #16a34a; }
            p { margin: 12px 0 0; color: #666; }
            .details { margin: 24px 0; padding: 16px; background: #f9f9f9; border-radius: 8px; text-align: left; font-size: 14px; }
            .details div { margin: 8px 0; }
            .label { color: #666; font-size: 13px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✓ Leave Approved</h1>
            <div class="details">
              <div><span class="label">Requester:</span> ${request.requester_name}</div>
              <div><span class="label">Dates:</span> ${new Date(request.start_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} to ${new Date(request.end_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
            </div>
            <p>The leave request has been approved.</p>
          </div>
        </body>
        </html>
      `)
    } else {
      // Decline
      await sql`
        UPDATE leave_requests
        SET status = 'declined', decided_by = ${request.approver_id}, decided_at = NOW()
        WHERE id = ${request.id}
      `

      return res.status(200).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Leave Declined</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 32px 20px; }
            .container { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 10px; padding: 40px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); text-align: center; }
            h1 { margin: 0; color: #dc2626; }
            p { margin: 12px 0 0; color: #666; }
            .details { margin: 24px 0; padding: 16px; background: #f9f9f9; border-radius: 8px; text-align: left; font-size: 14px; }
            .details div { margin: 8px 0; }
            .label { color: #666; font-size: 13px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✗ Leave Declined</h1>
            <div class="details">
              <div><span class="label">Requester:</span> ${request.requester_name}</div>
              <div><span class="label">Dates:</span> ${new Date(request.start_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} to ${new Date(request.end_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
            </div>
            <p>The leave request has been declined.</p>
          </div>
        </body>
        </html>
      `)
    }
  } catch (err) {
    console.error('Leave approval error:', err)
    return res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Error</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 32px 20px; }
          .container { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 10px; padding: 40px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); text-align: center; }
          h1 { margin: 0; color: #dc2626; }
          p { margin: 12px 0 0; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Error</h1>
          <p>An error occurred while processing your request. Please try again.</p>
        </div>
      </body>
      </html>
    `)
  }
}

function isSecondToLastWorkingDay(date) {
  const y = date.getUTCFullYear(), m = date.getUTCMonth()
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const workingDays = []
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(Date.UTC(y, m, d)).getUTCDay()
    if (dow !== 0 && dow !== 6) workingDays.push(d)
  }
  if (workingDays.length < 2) return false
  return date.getUTCDate() === workingDays[workingDays.length - 2]
}
