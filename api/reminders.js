// api/reminders.js
// Vercel Cron Jobs call this endpoint via ?type=:
//   deliverables  — 09:00 UTC daily  — the What's due email: overdue / due ≤3 days
//   notes         — 21:00 UTC daily  — note reminders due in ~36h
//   expense-digest — 09:00 UTC daily  — monthly expense summary (2nd-to-last working day only)
//   task-nudge    — 14:00 UTC daily  — unacknowledged task nudge, then archives
//                                      tasks done for ARCHIVE_AFTER_DAYS
//   alerts        — hourly, every day — deliverables due within 48 hours and not
//                                      in review, and client input overdue; once
//                                      per item, 07:00-20:00 London only
//                                      (api/_alerts.js)
// POST ?type=leave-notify — triggered by frontend on leave request/decision
// POST ?type=expense-submit — triggered by frontend when a user submits their
//   expenses early ("Submit expenses now"); emails the configured recipients
// GET ?type=leave-approve&token=xxx&action=approve|decline — email-based leave approval

import { neon } from '@neondatabase/serverless'
import { verifyClerkUser } from './_auth.js'
import { notify, mailConfigured } from './_notify.js'
import { syncLeaveRequestGoogle } from './google.js'
import { dueFeed, dueMeta } from './_due-feed.js'
import { workspaceId } from './_api.js'
import { taskEmailWrap, taskCardHtml, escapeHtml, appBaseUrl } from './_task-mail.js'
import { runTimedAlerts, digestApprovalWindow, loadApprovals, routeApprovals, approvalsSectionHtml } from './_alerts.js'
import { ARCHIVE_AFTER_DAYS } from './_task-rules.js'

export default async function handler(req, res) {
  // ── Leave approval (GET, token-based) ──────────────────────────────────────
  if (req.method === 'GET' && req.query.type === 'leave-approve') {
    return handleLeaveApprove(req, res)
  }

  // ── Leave notification (POST, Clerk auth) ─────────────────────────────────
  if (req.method === 'POST' && req.query.type === 'leave-notify') {
    return handleLeaveNotify(req, res)
  }

  // ── Expense submission notice (POST, Clerk auth) ──────────────────────────
  if (req.method === 'POST' && req.query.type === 'expense-submit') {
    return handleExpenseSubmit(req, res)
  }

  const authHeader = req.headers['authorization']
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorised' })
  }

  // ── Urgent alerts (hourly) ────────────────────────────────────────────────
  // Before the weekend guard below: a deliverable due on Monday is worth an
  // email on Saturday. Refuses to run at all without CRON_SECRET, unlike the
  // other jobs here, so it can't be started by anyone who finds the URL.
  if (req.query.type === 'alerts') {
    if (!process.env.CRON_SECRET) {
      console.error('[alerts] CRON_SECRET is not set, so the alerts job will not run')
      return res.status(503).json({ error: 'CRON_SECRET is not set' })
    }
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorised' })
    if (!mailConfigured()) return res.status(200).json({ ok: true, skipped: 'email not configured' })
    try {
      const result = await runTimedAlerts(neon(process.env.DATABASE_URL))
      return res.status(200).json({ ok: true, ...result })
    } catch (err) {
      console.error('[alerts] run failed:', err)
      return res.status(500).json({ ok: false, error: 'alerts run failed' })
    }
  }

  // ── Unacknowledged task nudge (daily, 14:00 UTC) ──────────────────────────
  // Dispatched BEFORE the weekend guard below, so a Friday assignment is still
  // chased at the weekend rather than waiting until Monday.
  //
  // This WANTS to run hourly — the rule is "4 hours after assignment" — but
  // Vercel's Hobby plan caps crons at one run per day, and a more frequent
  // expression fails the deployment outright. 14:00 UTC catches work raised in
  // the morning; the 09:00 digest carries anything still outstanding the next
  // day. Restoring true 4-hour behaviour needs the Pro plan, or a sweep
  // triggered from somewhere other than a cron.
  //
  // The same daily run archives finished tasks, rather than taking a cron of
  // its own. A failure there is logged and never stops the nudges.
  if (req.query.type === 'task-nudge') {
    const sql = neon(process.env.DATABASE_URL)
    try {
      const archived = await archiveDoneTasks(sql)
      if (archived) console.log(`[tasks] archived ${archived} done task(s)`)
    } catch (err) {
      console.error('[tasks] auto-archive failed:', err.message)
    }
    return handleTaskNudge(req, res, sql)
  }

  // No reminder emails on weekends (Saturday=6, Sunday=0, UTC)
  const dowUTC = new Date().getUTCDay()
  if (dowUTC === 0 || dowUTC === 6) {
    return res.status(200).json({ ok: true, skipped: 'weekend', results: [] })
  }

  const type = req.query.type || 'deliverables'
  const sql = neon(process.env.DATABASE_URL)

  const todayLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  if (type === 'expense-digest') {
    return handleExpenseDigest(req, res, sql, todayLabel)
  }

  const dateStr = (d) => {
    if (!d) return 'Invalid date'
    const dateObj = typeof d === 'string' ? new Date(d + 'T00:00:00') : (d instanceof Date ? d : new Date(d))
    if (isNaN(dateObj.getTime())) return 'Invalid date'
    return dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  const baseUrl = process.env.VITE_APP_URL || 'https://peny-slate.app'

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
      <a href="${baseUrl}" style="color:#3b82f6;text-decoration:none">Log in to Slate</a> to update or dismiss these items.
    </div>
  </div>
</body>
</html>`

  // Every email goes through notify() (api/_notify.js), which applies each
  // person's settings. `record` keeps this run's results in the shape the
  // roundup and the cron response have always used.
  const results = []
  const record = (outcome, extra) => {
    if (outcome?.sent) results.push({ ...extra, to: outcome.to })
    else if (outcome?.error) results.push({ ...extra, to: outcome.to, error: outcome.error })
    else if (outcome) results.push({ ...extra, to: outcome.to, skipped: outcome.skipped })
  }

  // ── What's due (09:00 run) ───────────────────────────────────────────────
  // One email per person, read from the what's-due feed (api/_due-feed.js) —
  // the same list as the Dashboard: their overdue work and whatever is due in
  // the next 3 days, of every kind (worklist and project deliverables,
  // marketing, checklists, board cards, edit deadlines, tasks). Work with no
  // owner isn't emailed. Outstanding unacknowledged tasks ride at the top, and
  // anyone with some is included even with nothing due — otherwise the
  // section would miss exactly the people it is for.
  if (type === 'deliverables') {
    const ws = await workspaceId(sql)
    const { items } = await dueFeed(sql, { ws, days: 3 })
    const users = await sql`SELECT id, clerk_id, name, email, role FROM app_users`
    const userById = Object.fromEntries(users.map(u => [u.id, u]))

    const byOwner = {}
    for (const item of items) if (item.owner) (byOwner[item.owner.id] ||= []).push(item)
    const unackByAssignee = await unacknowledgedByAssignee(sql)
    // Approvals since the last digest ride along (a Monday covers the weekend).
    // Someone whose only news is an approval still gets the email.
    const approvalWindow = digestApprovalWindow()
    const approvalsByPerson = routeApprovals(await loadApprovals(sql, { ws, ...approvalWindow }), users)
    const recipients = new Set([...Object.keys(byOwner), ...Object.keys(unackByAssignee), ...Object.keys(approvalsByPerson)])

    const when = n => n < 0 ? `${Math.abs(n)}d overdue` : n === 0 ? 'due today' : `${n}d left`
    const colour = n => n < 0 ? '#ef4444' : n === 0 ? '#f59e0b' : '#3b82f6'
    const th = label => `<th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#999;border-bottom:2px solid #f0f0f0">${label}</th>`
    const dueTable = mine => `
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>${th('What')}${th('When')}</tr></thead>
        <tbody>${mine.map(i => `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:14px">
              <a href="${baseUrl}/${i.link}" style="color:#1a1a1a;text-decoration:none">${escapeHtml(i.title)}</a>
              <div style="font-size:11px;color:#999;margin-top:2px">${escapeHtml(dueMeta(i))}</div>
            </td>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:${colour(i.days)};white-space:nowrap;font-weight:500;vertical-align:top">${when(i.days)}</td>
          </tr>`).join('')}</tbody>
      </table>`

    for (const ownerId of recipients) {
      const mine = byOwner[ownerId] ?? []
      const unack = unackByAssignee[ownerId] ?? []
      const approved = approvalsByPerson[ownerId] ?? []
      const user = userById[ownerId]
      if (!user?.email) continue
      const overdueCount = mine.filter(i => i.overdue).length
      const plural = n => (n === 1 ? '' : 's')
      const subject = !mine.length && !unack.length
        ? `✅ ${approved.length} approved since your last digest`
        : !mine.length
        ? `👀 ${unack.length} task${plural(unack.length)} waiting on you`
        : overdueCount > 0
        ? `⚠ ${overdueCount} overdue — ${mine.length} thing${plural(mine.length)} need attention`
        : `⏰ ${mine.length} thing${plural(mine.length)} due soon`
      const name = user.name || user.email.split('@')[0]
      const greeting = mine.length
        ? `Hi ${escapeHtml(name)}, here's what's due for you:`
        : unack.length
        ? `Hi ${escapeHtml(name)}, nothing is due — but some tasks are still waiting for you to acknowledge them:`
        : `Hi ${escapeHtml(name)}, nothing is due. Here's what clients have approved:`
      const html = emailWrap("What's due", greeting, unacknowledgedSectionHtml(unack) + (mine.length ? dueTable(mine) : '') + approvalsSectionHtml(approved, baseUrl))
      const [outcome] = await notify(sql, { kind: 'due_digest', to: { email: user.email, clerk_id: user.clerk_id, name: user.name }, subject, html })
      record(outcome, { type: 'due', sent: mine.length, unacknowledged: unack.length })
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
        </div>
        <a href="${baseUrl}/#dashboard" style="display:inline-block;background:#111;color:#fff;padding:9px 18px;border-radius:6px;text-decoration:none;font-weight:500;font-size:13px">Open note in Slate</a>`
      const html = emailWrap('Note Reminder', `Hi ${name}, this note is due in approximately 36 hours:`, body)
      const [outcome] = await notify(sql, { kind: 'note_reminder', to: { email: note.email, clerk_id: note.clerk_id, name: note.name }, subject, html })
      record(outcome, { type: 'note', noteId: note.id })
    }
  }

  // ── Reminder roundup ─────────────────────────────────────────────────────
  // A summary of the emails this run actually sent, for each superadmin who
  // has turned the roundup on in Settings › Notifications (notify() skips the
  // rest). It used to go to whoever the single settings row belonged to — the
  // workspace owner — and that choice was carried over.
  const sent = results.filter(r => !r.error && !r.skipped)
  if (sent.length > 0) {
    const roundupRecipients = await sql`
      SELECT email, name, clerk_id FROM app_users
      WHERE role = 'superadmin' AND email IS NOT NULL
    `

    for (const admin of roundupRecipients) {
      const typeLabel = type === 'notes' ? 'Note reminders' : "What's due"
      const subject = `📋 ${typeLabel} roundup — ${sent.length} sent today`

      const groupedRows = sent.map(r => {
        const typeTag = r.type === 'note' ? 'Note' : "What's due"
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
      const [outcome] = await notify(sql, { kind: 'reminder_roundup', to: admin, subject, html })
      record(outcome, { type: 'roundup', sent: sent.length })
    }
  }

  return res.status(200).json({ ok: true, results })
}

// ── Expense digest (called as ?type=expense-digest) ───────────────────────────
async function handleExpenseDigest(req, res, sql, todayLabel) {
  const today = new Date()
  if (!isSecondToLastWorkingDay(today)) {
    return res.status(200).json({ ok: true, skipped: 'not second-to-last working day' })
  }

  const monthKey = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`

  let settingsRows = []
  try { settingsRows = await sql`SELECT expense_recipients, mileage_rate, per_diem_rate FROM settings LIMIT 1` } catch (_) {}
  const settings = settingsRows[0] ?? {}
  const recipientClerkIds = settings.expense_recipients ?? []
  if (!recipientClerkIds.length) return res.status(200).json({ ok: true, skipped: 'no recipients configured' })

  const mileageRate = parseFloat(settings.mileage_rate ?? 45) / 100
  const perDiemRate = parseFloat(settings.per_diem_rate ?? 0)

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
  const monthLabel = new Date(monthKey + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  let grandMiles = 0, grandDays = 0, grandComm = 0, grandExpenses = 0, grandTotal = 0
  const summaryRows = Object.entries(byUser).map(([clerkId, { name, entries: ents }]) => {
    let miles = 0, amt = 0, days = 0, comm = 0
    for (const e of ents) {
      if (e.type === 'mileage') miles += parseFloat(e.miles ?? 0)
      if (e.type === 'expense') amt += parseFloat(e.amount ?? 0)
      if (e.type === 'overnight') days += parseInt(e.overnights ?? 0)
      if (e.type === 'commission') comm += parseFloat(e.amount ?? 0)
    }
    // "Expenses" is everything paid via the expenses route: mileage + per diem + misc expenses.
    // Commission is paid separately, so it's kept out of this figure.
    const expensesTotal = (miles * mileageRate) + amt + (days * perDiemRate)
    const total = expensesTotal + comm
    grandMiles += miles; grandDays += days; grandComm += comm; grandExpenses += expensesTotal; grandTotal += total
    const submitted = submittedUsers.has(clerkId)
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#1a1a1a;font-weight:500">${name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555;text-align:right">${miles > 0 ? `${miles}mi` : '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555;text-align:right">${days > 0 ? days : '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555;text-align:right">£${fmt2(expensesTotal)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555;text-align:right">${comm > 0 ? `£${fmt2(comm)}` : '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;font-weight:600;color:#1a1a1a;text-align:right">£${fmt2(total)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;text-align:center">${submitted ? `<span style="padding:2px 7px;background:#d1fae5;color:#065f46;border-radius:10px">✓</span>` : ''}</td>
    </tr>`
  }).join('')

  const totalsRow = `<tr style="background:#f9f9f9">
    <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#1a1a1a">Total</td>
    <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#1a1a1a;text-align:right">${grandMiles > 0 ? `${grandMiles}mi` : '—'}</td>
    <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#1a1a1a;text-align:right">${grandDays > 0 ? grandDays : '—'}</td>
    <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#1a1a1a;text-align:right">£${fmt2(grandExpenses)}</td>
    <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#1a1a1a;text-align:right">£${fmt2(grandComm)}</td>
    <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#1a1a1a;text-align:right">£${fmt2(grandTotal)}</td>
    <td></td>
  </tr>`

  const breakdownSections = Object.entries(byUser).map(([clerkId, { name, entries: ents }]) =>
    buildExpenseBreakdownSection(name, ents, mileageRate, submittedUsers.has(clerkId), perDiemRate)
  ).join('')

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:14px;color:#444">Monthly expense summary for <strong>${monthLabel}</strong>. Rate: ${settings.mileage_rate ?? 45}p/mile, £${fmt2(perDiemRate)}/per diem day.</p>
    <div style="display:flex;gap:12px;margin-bottom:20px">
      <div style="flex:1;padding:12px 16px;background:#f9f9f9;border-radius:8px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#999;margin-bottom:4px">Expenses total</div>
        <div style="font-size:18px;font-weight:700;color:#1a1a1a">£${fmt2(grandExpenses)}</div>
      </div>
      <div style="flex:1;padding:12px 16px;background:#f9f9f9;border-radius:8px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#999;margin-bottom:4px">Commission total</div>
        <div style="font-size:18px;font-weight:700;color:#1a1a1a">£${fmt2(grandComm)}</div>
      </div>
    </div>
    <h3 style="font-size:13px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 10px">Summary</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:28px">
      <thead><tr style="background:#f9f9f9">
        <th style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#999;text-align:left;border-bottom:2px solid #f0f0f0">Name</th>
        <th style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#999;text-align:right;border-bottom:2px solid #f0f0f0">Miles</th>
        <th style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#999;text-align:right;border-bottom:2px solid #f0f0f0">Per Diem Days</th>
        <th style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#999;text-align:right;border-bottom:2px solid #f0f0f0">Expenses</th>
        <th style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#999;text-align:right;border-bottom:2px solid #f0f0f0">Commission</th>
        <th style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#999;text-align:right;border-bottom:2px solid #f0f0f0">Total £</th>
        <th style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#999;text-align:center;border-bottom:2px solid #f0f0f0">Submitted</th>
      </tr></thead>
      <tbody>${summaryRows}</tbody>
      <tfoot>${totalsRow}</tfoot>
    </table>
    <h3 style="font-size:13px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 16px">Breakdown</h3>
    ${breakdownSections}`

  const recipientUsers = await sql`SELECT email, clerk_id, name FROM app_users WHERE clerk_id = ANY(${recipientClerkIds})`
  const html = wrapExpenseEmail(`Expense Summary — ${monthLabel}`, todayLabel, bodyHtml)
  const outcomes = await notify(sql, { kind: 'expense_digest', to: recipientUsers, subject: `💷 Expense summary — ${monthLabel}`, html })
  const results = outcomes.filter(o => o.to).map(o => (o.sent ? { to: o.to, ok: true } : o.error ? { to: o.to, error: o.error } : { to: o.to, skipped: o.skipped }))
  return res.status(200).json({ ok: true, month: monthKey, results })
}

// ── Leave notifications (POST ?type=leave-notify) ─────────────────────────────
async function handleLeaveNotify(req, res) {
  // Slate staff only (client portal accounts have Clerk sessions too).
  const sql = neon(process.env.DATABASE_URL)
  const { error } = await verifyClerkUser(req, sql)
  if (error) return res.status(error.status).json({ error: error.message })

  const { action, requestId } = req.body ?? {}
  if (!action || !requestId) return res.status(400).json({ error: 'action and requestId required' })

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

  if (!mailConfigured()) {
    return res.status(200).json({ ok: true, skipped: 'email not configured' })
  }

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
    const [o] = await notify(sql, { kind: 'leave', to: { email: to }, subject, html })
    results.push(o.sent ? { to, ok: true, messageId: o.messageId } : { to, error: o.error || o.skipped })
  }

  if (action === 'submitted') {
    const recipients = approver ? [approver] : superadmins
    const baseUrl = process.env.VITE_APP_URL || 'https://peny-slate.app'
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

  const sql = neon(process.env.DATABASE_URL)

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

      // Sync to Google Calendar before responding. A server-side relative
      // fetch('/api/google') can't be resolved (no origin), so call the shared
      // helper directly. Best-effort: a sync failure must not fail approval.
      try {
        await syncLeaveRequestGoogle(sql, { action: 'create', requestId: request.id })
      } catch (e) {
        console.warn('Google Calendar sync failed (non-fatal):', e)
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

// ── Shared expense email helpers ──────────────────────────────────────────────
// Used by both the monthly digest (?type=expense-digest) and the per-user
// "submitted early" notice (?type=expense-submit) so the two emails stay in
// sync — the same black-header shell and the same per-person breakdown table.
const expFmt2 = n => Number(n || 0).toFixed(2)
const expFmtDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

function wrapExpenseEmail(title, todayLabel, bodyHtml) {
  return `
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
}

function buildExpenseBreakdownSection(name, ents, mileageRate, submitted, perDiemRate = 0) {
  let miles = 0, amt = 0, days = 0, comm = 0
  for (const e of ents) {
    if (e.type === 'mileage') miles += parseFloat(e.miles ?? 0)
    if (e.type === 'expense') amt += parseFloat(e.amount ?? 0)
    if (e.type === 'overnight') days += parseInt(e.overnights ?? 0)
    if (e.type === 'commission') comm += parseFloat(e.amount ?? 0)
  }
  // "Expenses" is everything paid via the expenses route: mileage + per diem + misc expenses.
  // Commission is paid separately, so it's kept out of this figure.
  const expensesTotal = (miles * mileageRate) + amt + (days * perDiemRate)
  const totalCash = expensesTotal + comm
  const badge = submitted ? `<span style="padding:1px 7px;background:#d1fae5;color:#065f46;border-radius:10px;font-size:11px;font-weight:500;margin-left:8px">Submitted</span>` : ''
  const rows = ents.map(e => {
    const typeLabel = e.type === 'mileage' ? 'Mileage' : e.type === 'expense' ? 'Expense' : e.type === 'commission' ? 'Commission' : 'Per Diem Days'
    const detail = e.type === 'mileage' ? `${e.miles} miles (£${expFmt2(parseFloat(e.miles ?? 0) * mileageRate)})`
      : e.type === 'expense' || e.type === 'commission' ? `£${expFmt2(parseFloat(e.amount ?? 0))}`
      : `${e.overnights} day${parseInt(e.overnights) !== 1 ? 's' : ''}`
    return `<tr>
      <td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555">${expFmtDate(e.entry_date)}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555">${typeLabel}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#1a1a1a">${e.description || '—'}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;text-align:right;white-space:nowrap">${detail}</td>
    </tr>`
  }).join('')
  const expensesParts = [
    miles ? `${miles}mi = £${expFmt2(miles * mileageRate)}` : null,
    days  ? `${days} per diem day${days !== 1 ? 's' : ''}${perDiemRate ? ` = £${expFmt2(days * perDiemRate)}` : ''}` : null,
    amt   ? `£${expFmt2(amt)} expenses` : null,
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
      <div style="display:flex;gap:10px;margin-bottom:8px">
        <div style="flex:1;padding:8px 12px;background:#f9f9f9;border-radius:6px">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:#999;margin-bottom:2px">Expenses total</div>
          <div style="font-size:15px;font-weight:700;color:#1a1a1a">£${expFmt2(expensesTotal)}</div>
        </div>
        <div style="flex:1;padding:8px 12px;background:#f9f9f9;border-radius:6px">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:#999;margin-bottom:2px">Commission total</div>
          <div style="font-size:15px;font-weight:700;color:#1a1a1a">£${expFmt2(comm)}</div>
        </div>
      </div>
      ${expensesParts.length ? `<div style="text-align:right;font-size:12px;color:#777;padding:0 12px 4px">Includes: ${expensesParts.join(' + ')}</div>` : ''}
      <div style="text-align:right;font-size:13px;font-weight:600;color:#1a1a1a;padding:0 12px">
        Total to pay: £${expFmt2(totalCash)}
      </div>
    </div>`
}

// ── Expense submission notice (POST ?type=expense-submit) ─────────────────────
// Fired by the Expenses view when a user clicks "Submit expenses now" to send
// their month ahead of the automated run. Emails the configured recipients
// that user's breakdown for the month. Mirrors handleLeaveNotify: Clerk-authed,
// per-recipient outcomes collected, all-failures surfaced as 502.
async function handleExpenseSubmit(req, res) {
  // Slate staff only (client portal accounts have Clerk sessions too).
  const sql = neon(process.env.DATABASE_URL)
  const { user, error } = await verifyClerkUser(req, sql)
  if (error) return res.status(error.status).json({ error: error.message })
  const clerkUserId = user.clerk_id

  const { monthKey } = req.body ?? {}
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
    return res.status(400).json({ error: 'monthKey (YYYY-MM) required' })
  }

  let settingsRows = []
  try { settingsRows = await sql`SELECT expense_recipients, mileage_rate, per_diem_rate FROM settings LIMIT 1` } catch (_) {}
  const settings = settingsRows[0] ?? {}
  const recipientClerkIds = settings.expense_recipients ?? []
  if (!recipientClerkIds.length) return res.status(200).json({ ok: true, skipped: 'no recipients configured' })

  const mileageRate = parseFloat(settings.mileage_rate ?? 45) / 100
  const perDiemRate = parseFloat(settings.per_diem_rate ?? 0)

  let submitter = {}
  try {
    const rows = await sql`SELECT name, email FROM app_users WHERE clerk_id = ${clerkUserId} LIMIT 1`
    submitter = rows[0] ?? {}
  } catch (_) {}
  const submitterName = submitter.name || submitter.email || 'A team member'

  let entries = []
  try {
    entries = await sql`
      SELECT * FROM expense_entries
      WHERE clerk_user_id = ${clerkUserId}
        AND to_char(entry_date, 'YYYY-MM') = ${monthKey}
      ORDER BY entry_date`
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
  if (!entries.length) return res.status(200).json({ ok: true, skipped: 'no entries this month' })

  if (!mailConfigured()) {
    return res.status(200).json({ ok: true, skipped: 'email not configured' })
  }

  const todayLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const monthLabel = new Date(monthKey + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  const bodyHtml = `
    <p style="margin:0 0 20px;font-size:14px;color:#444"><strong>${submitterName}</strong> has submitted their expenses for <strong>${monthLabel}</strong> ahead of the monthly run. Rate: ${settings.mileage_rate ?? 45}p/mile.</p>
    ${buildExpenseBreakdownSection(submitterName, entries, mileageRate, true, perDiemRate)}`
  const html = wrapExpenseEmail(`Expenses submitted — ${monthLabel}`, todayLabel, bodyHtml)
  const subject = `💷 ${submitterName} submitted expenses — ${monthLabel}`

  const recipientUsers = await sql`SELECT email, clerk_id, name FROM app_users WHERE clerk_id = ANY(${recipientClerkIds})`
  const outcomes = await notify(sql, { kind: 'expense_submitted', to: recipientUsers, subject, html })
  const results = outcomes.filter(o => o.to).map(o => (o.sent ? { to: o.to, ok: true, messageId: o.messageId } : { to: o.to, error: o.error || o.skipped }))

  const failures = results.filter(r => r.error)
  if (failures.length && failures.length === results.length) {
    return res.status(502).json({ ok: false, error: 'All expense emails failed to send', results })
  }
  return res.status(200).json({ ok: true, month: monthKey, results })
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

// ── Unacknowledged task nudge ────────────────────────────────────────────────
// Finds tasks assigned more than 4 hours ago that the assignee has not
// acknowledged, nudges once, and records that it did. Correct at any cadence —
// the nudged_at claim below means one nudge per assignment however often this
// runs — so it needs no change if the schedule ever gets tightened.
//
// "Assigned more than 4 hours ago" is read from the last `assigned` event, not
// from updated_at — editing a task's title must not restart its clock.
export async function handleTaskNudge(req, res, sql) {
  const results = []

  const due = await sql`
    SELECT t.id, t.title, t.due_at, t.assignee_id, t.created_by,
           u.email, u.name
    FROM tasks t
    JOIN app_users u ON u.id = t.assignee_id
    WHERE t.assignee_id IS NOT NULL
      AND t.acknowledged_at IS NULL
      AND t.archived_at IS NULL
      AND t.nudged_at IS NULL
      AND t.status <> 'done'
      AND COALESCE(
            (SELECT MAX(e.created_at) FROM task_events e
              WHERE e.task_id = t.id AND e.type = 'assigned'),
            t.created_at
          ) < NOW() - INTERVAL '4 hours'
  `

  const todayLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  for (const task of due) {
    // Claim the task atomically before doing anything else. Two overlapping
    // cron runs cannot both win this UPDATE, so a task is nudged exactly once
    // per assignment — the same trick as the board_recurrences next_due advance.
    const claimed = await sql`
      UPDATE tasks SET nudged_at = NOW()
      WHERE id = ${task.id} AND nudged_at IS NULL
      RETURNING id
    `
    if (!claimed[0]) continue

    // Notifications come from events, never straight from a handler — so the
    // nudge writes one too, with no actor because nobody did this.
    const [event] = await sql`
      INSERT INTO task_events (task_id, actor_id, type, payload)
      VALUES (${task.id}, NULL, 'nudged', '{}'::jsonb)
      RETURNING id
    `
    await sql`
      INSERT INTO notifications (recipient_id, task_id, event_id, type)
      VALUES (${task.assignee_id}, ${task.id}, ${event.id}, 'unacknowledged_nudge')
      ON CONFLICT (recipient_id, event_id) DO NOTHING
    `

    if (task.email) {
      const name = task.name || task.email.split('@')[0]
      const [o] = await notify(sql, {
        kind: 'task_nudge',
        to: { email: task.email, name: task.name },
        subject: `Still waiting on you: ${task.title}`,
        html: taskEmailWrap(
          'A task is waiting',
          todayLabel,
          `Hi ${name}, this was assigned to you a few hours ago and hasn't been acknowledged. Open it and hit "Got it" so the person who raised it knows you've seen it.`,
          taskCardHtml(task),
        ),
      })
      results.push(o.sent ? { type: 'task-nudge', to: task.email, task: task.title }
        : o.error ? { type: 'task-nudge', to: task.email, error: o.error }
        : { type: 'task-nudge', task: task.title, skipped: o.skipped === 'not_configured' ? 'no mail configured' : o.skipped })
    } else {
      results.push({ type: 'task-nudge', task: task.title, skipped: 'no email address' })
    }
  }

  return res.status(200).json({ ok: true, nudged: results.length, results })
}

// ── Auto-archive ─────────────────────────────────────────────────────────────
// A task that has sat untouched in Done for ARCHIVE_AFTER_DAYS leaves the
// board. Archived, not deleted: the row, its comments and its activity stay
// (GET /api/tasks/:id still reads it); it just drops out of every list, and
// clients drop it via archived_ids because updated_at moves. "Untouched" is
// updated_at, so editing a finished task restarts its month.
//
// Like the nudge, each archive writes an actor-less event (every mutation
// writes one) and notifies nobody. Correct at any cadence and safe to overlap:
// the UPDATE only claims rows that are not archived yet.
export async function archiveDoneTasks(sql) {
  const archived = await sql`
    UPDATE tasks SET archived_at = NOW(), updated_at = NOW()
    WHERE status = 'done'
      AND archived_at IS NULL
      AND updated_at < NOW() - make_interval(days => ${ARCHIVE_AFTER_DAYS})
    RETURNING id
  `
  if (archived.length) {
    await sql`
      INSERT INTO task_events (task_id, actor_id, type, payload)
      SELECT a.id, NULL, 'archived', ${JSON.stringify({ auto: true, after_days: ARCHIVE_AFTER_DAYS })}::jsonb
      FROM unnest(${archived.map(r => r.id)}::uuid[]) AS a(id)
    `
  }
  return archived.length
}

// Outstanding unacknowledged tasks per assignee, for the top of the daily
// digest. Unlike the nudge this repeats daily until acknowledged — the nudge is
// the one-shot, the digest is the standing reminder.
export async function unacknowledgedByAssignee(sql) {
  const rows = await sql`
    SELECT t.id, t.title, t.due_at, t.assignee_id, u.email, u.name
    FROM tasks t
    JOIN app_users u ON u.id = t.assignee_id
    WHERE t.assignee_id IS NOT NULL
      AND t.acknowledged_at IS NULL
      AND t.archived_at IS NULL
      AND t.status <> 'done'
    ORDER BY t.created_at
  `
  const byAssignee = {}
  for (const row of rows) (byAssignee[row.assignee_id] ||= []).push(row)
  return byAssignee
}

// The section itself — rendered at the TOP of the digest body.
export function unacknowledgedSectionHtml(tasks) {
  if (!tasks?.length) return ''
  return `
    <div style="margin:0 0 22px">
      <h2 style="margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;color:#E5484D">
        Waiting on you — ${tasks.length} unacknowledged
      </h2>
      ${tasks.map(t => taskCardHtml(t)).join('')}
      <p style="margin:8px 0 0;font-size:12px;color:#999">
        Open each one and hit &ldquo;Got it&rdquo; so the person who raised it knows you&rsquo;ve seen it.
      </p>
    </div>`
}
