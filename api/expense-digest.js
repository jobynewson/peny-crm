// api/expense-digest.js
// Daily cron — fires every working day and sends the monthly expense summary
// on the second-to-last working day of the month.

import { neon } from '@neondatabase/serverless'
import nodemailer from 'nodemailer'

export default async function handler(req, res) {
  const authHeader = req.headers['authorization']
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorised' })
  }

  const sql = neon(process.env.VITE_DATABASE_URL)

  const today = new Date()
  // No expense emails on weekends
  const dow = today.getUTCDay()
  if (dow === 0 || dow === 6) {
    return res.status(200).json({ ok: true, skipped: 'weekend' })
  }

  if (!isSecondToLastWorkingDay(today)) {
    return res.status(200).json({ ok: true, skipped: 'not second-to-last working day' })
  }

  const monthKey = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })
  const from = process.env.GMAIL_USER
  const sendMail = (to, subject, html) => transporter.sendMail({ from, to, subject, html })

  const todayLabel = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

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
    <div style="padding:16px 28px;border-top:1px solid #f0f0f0;font-size:12px;color:#aaa">
      Log in to the CRM to review or submit expenses.
    </div>
  </div>
</body>
</html>`

  // Load workspace settings to get recipients and mileage rate
  let settingsRows = []
  try {
    settingsRows = await sql`SELECT user_id, expense_recipients, mileage_rate FROM settings LIMIT 1`
  } catch (_) {}

  const settings = settingsRows[0] ?? {}
  const recipientClerkIds = settings.expense_recipients ?? []
  if (!recipientClerkIds.length) {
    return res.status(200).json({ ok: true, skipped: 'no recipients configured' })
  }

  const mileageRate = parseFloat(settings.mileage_rate ?? 45) / 100  // pence → £

  // Load expense entries for this month
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

  // Load submissions for this month (manually submitted users)
  let submissions = []
  try {
    submissions = await sql`
      SELECT clerk_user_id FROM expense_submissions
      WHERE month_key = ${monthKey}
    `
  } catch (_) {}
  const submittedUsers = new Set(submissions.map(s => s.clerk_user_id))

  // Group entries by user
  const byUser = {}
  for (const e of entries) {
    if (!byUser[e.clerk_user_id]) byUser[e.clerk_user_id] = { name: e.user_name || e.user_email, email: e.user_email, entries: [] }
    byUser[e.clerk_user_id].entries.push(e)
  }

  if (!Object.keys(byUser).length) {
    return res.status(200).json({ ok: true, skipped: 'no entries this month' })
  }

  const fmt2 = n => Number(n || 0).toFixed(2)
  const fmtDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const monthLabel = new Date(monthKey + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  // Build totals row and breakdown for each user
  const userSections = Object.values(byUser).map(({ name, entries: ents, email }) => {
    let miles = 0, amt = 0, nights = 0
    for (const e of ents) {
      if (e.type === 'mileage') miles += parseFloat(e.miles ?? 0)
      if (e.type === 'expense') amt += parseFloat(e.amount ?? 0)
      if (e.type === 'overnight') nights += parseInt(e.overnights ?? 0)
    }
    const mileageValue = miles * mileageRate
    const totalCash = mileageValue + amt

    const submitted = submittedUsers.has(ents[0].clerk_user_id)
    const submittedBadge = submitted
      ? `<span style="display:inline-block;padding:1px 7px;background:#d1fae5;color:#065f46;border-radius:10px;font-size:11px;font-weight:500;margin-left:8px">Submitted</span>`
      : ''

    const rows = ents.map(e => {
      const typeLabel = e.type === 'mileage' ? 'Mileage' : e.type === 'expense' ? 'Expense' : 'Overnight'
      const detail = e.type === 'mileage'
        ? `${e.miles} miles (£${fmt2(parseFloat(e.miles ?? 0) * mileageRate)})`
        : e.type === 'expense'
        ? `£${fmt2(parseFloat(e.amount ?? 0))}`
        : `${e.overnights} night${parseInt(e.overnights) !== 1 ? 's' : ''}`
      return `
        <tr>
          <td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555">${fmtDate(e.entry_date)}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555">${typeLabel}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#1a1a1a">${e.description || '—'}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#1a1a1a;text-align:right;white-space:nowrap">${detail}</td>
        </tr>`
    }).join('')

    const totalParts = [
      miles  ? `${miles}mi = £${fmt2(mileageValue)}` : null,
      amt    ? `£${fmt2(amt)} expenses` : null,
      nights ? `${nights} night${nights !== 1 ? 's' : ''}` : null,
    ].filter(Boolean)

    return `
      <div style="margin-bottom:24px">
        <div style="font-size:14px;font-weight:600;color:#1a1a1a;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #f0f0f0">
          ${name}${submittedBadge}
        </div>
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
          Total: ${totalParts.join(' + ')} ${totalCash > 0 ? `= £${fmt2(totalCash)}` : ''}
        </div>
      </div>`
  }).join('')

  // Summary table (one row per user)
  const summaryRows = Object.values(byUser).map(({ name, entries: ents }) => {
    let miles = 0, amt = 0, nights = 0
    for (const e of ents) {
      if (e.type === 'mileage') miles += parseFloat(e.miles ?? 0)
      if (e.type === 'expense') amt += parseFloat(e.amount ?? 0)
      if (e.type === 'overnight') nights += parseInt(e.overnights ?? 0)
    }
    const total = (miles * mileageRate) + amt
    const submitted = submittedUsers.has(ents[0].clerk_user_id)
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#1a1a1a;font-weight:500">${name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555;text-align:right">${miles > 0 ? `${miles}mi` : '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555;text-align:right">${nights > 0 ? nights : '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555;text-align:right">${amt > 0 ? `£${fmt2(amt)}` : '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;font-weight:600;color:#1a1a1a;text-align:right">£${fmt2(total)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;text-align:center">${submitted ? `<span style="padding:2px 7px;background:#d1fae5;color:#065f46;border-radius:10px">✓</span>` : ''}</td>
      </tr>`
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
    ${userSections}`

  const subject = `💷 Expense summary — ${monthLabel}`
  const html = emailWrap(`Expense Summary — ${monthLabel}`, bodyHtml)

  // Get recipient emails
  const recipientUsers = await sql`
    SELECT email FROM app_users WHERE clerk_id = ANY(${recipientClerkIds})
  `

  const results = []
  for (const recipient of recipientUsers) {
    if (!recipient.email) continue
    try {
      await sendMail(recipient.email, subject, html)
      results.push({ to: recipient.email, ok: true })
    } catch (err) {
      results.push({ to: recipient.email, error: err.message })
    }
  }

  return res.status(200).json({ ok: true, month: monthKey, results })
}

function isSecondToLastWorkingDay(date) {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()

  // Find all working days in this month
  const workingDays = []
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(Date.UTC(y, m, d)).getUTCDay()
    if (dow !== 0 && dow !== 6) workingDays.push(d)
  }

  if (workingDays.length < 2) return false
  const secondToLast = workingDays[workingDays.length - 2]
  return date.getUTCDate() === secondToLast
}
