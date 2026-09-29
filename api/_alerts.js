// api/_alerts.js
// The urgent alerts: emails that go out as the thing happens (a new client
// request, changes requested, a client's reply) or on the hourly run (due
// within 48 hours and not in review, client input overdue). Everything else
// waits for the daily digest, approvals included.
//
// All of it goes through notify() in _notify.js, so each person's own settings
// apply and there is one sender. The kinds are the alert_* entries in KINDS;
// each can be muted, and none depends on the digest setting.
//
// Who hears: the deliverable's owner. If it has none, the company's lead. If
// the company has no lead either (a gap the Retainers page flags), every
// superadmin — and the log says so. Nothing is ever sent to no one.
//
// The timed alerts are once per item: alert_log has one row per (kind, item,
// cycle). The cycle re-arms an item that changes — a new due date, or going
// back to waiting on the client. They only send between 07:00 and 20:00
// London; what falls due overnight goes out at 07:00.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { notify } from './_notify.js'
import { escapeHtml, appBaseUrl } from './_task-mail.js'
import { workspaceId } from './_api.js'
import { TIME_ZONE, londonDate, addDays, formatDay } from './_dates.js'

// ── Who, and when ────────────────────────────────────────────────────────────

// { via, to } — owner, else lead, else the superadmins. Someone without an
// email address can't be told anything, so they don't count.
export function resolveRecipients({ owner = null, lead = null, superadmins = [] }) {
  const usable = u => !!u?.email
  if (usable(owner)) return { via: 'owner', to: [owner] }
  if (usable(lead)) return { via: 'lead', to: [lead] }
  return { via: 'superadmins', to: superadmins.filter(usable) }
}

export async function loadRecipients(sql, { ownerId = null, companyId = null }) {
  const [owner] = ownerId ? await sql`SELECT id, clerk_id, name, email FROM app_users WHERE id = ${ownerId}` : []
  const [lead] = companyId
    ? await sql`
        SELECT u.id, u.clerk_id, u.name, u.email
        FROM companies c JOIN app_users u ON u.id = c.lead_id
        WHERE c.id = ${companyId}`
    : []
  const first = resolveRecipients({ owner, lead })
  if (first.via !== 'superadmins') return first
  const superadmins = await sql`SELECT id, clerk_id, name, email FROM app_users WHERE role = 'superadmin' AND email IS NOT NULL`
  const out = resolveRecipients({ owner, lead, superadmins })
  console.warn(`[alerts] no owner or lead with an email for company ${companyId ?? '?'}; sending to ${out.to.length} superadmin(s)`)
  return out
}

// The hours cron alerts may send: 07:00 up to 20:00, London.
export const ALERT_FROM_HOUR = 7
export const ALERT_TO_HOUR = 20
export function inAlertWindow(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23' }).format(now))
  return hour >= ALERT_FROM_HOUR && hour < ALERT_TO_HOUR
}

// Days a client can sit on "waiting on you" before we say so. An environment
// variable, not a setting.
export const DEFAULT_INPUT_DAYS = 7
export function inputAlertDays(env = process.env) {
  const n = Number(env.CLIENT_INPUT_ALERT_DAYS)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_INPUT_DAYS
}

// ── The emails ───────────────────────────────────────────────────────────────

function wrap({ title, subtitle, greeting, bodyHtml, href, linkLabel }) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:32px 0">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08)">
    <div style="background:#111;padding:20px 28px">
      <h1 style="margin:0;font-size:18px;color:#fff;font-weight:600">${escapeHtml(title)}</h1>
      <p style="margin:4px 0 0;font-size:13px;color:#999">${escapeHtml(subtitle)}</p>
    </div>
    <div style="padding:24px 28px">
      <p style="margin:0 0 18px;font-size:14px;color:#444;line-height:1.5">${greeting}</p>
      ${bodyHtml}
      <p style="margin:22px 0 0;font-size:12px">
        <a href="${escapeHtml(href)}" style="color:#3b82f6;text-decoration:none">${escapeHtml(linkLabel)} →</a>
      </p>
    </div>
  </div>
</body>
</html>`
}

const card = (heading, lines = [], quote = null) => `
    <div style="border:1px solid #eee;border-left:3px solid #E5484D;border-radius:0 6px 6px 0;padding:12px 14px;margin:0 0 10px">
      <div style="font-size:15px;font-weight:600;color:#1a1a1a">${escapeHtml(heading)}</div>
      ${lines.filter(Boolean).map(l => `<div style="font-size:12px;color:#999;margin-top:4px">${escapeHtml(l)}</div>`).join('')}
      ${quote ? `<div style="font-size:14px;color:#333;margin-top:10px;white-space:pre-wrap">${escapeHtml(quote)}</div>` : ''}
    </div>`

const retainersLink = companyId => `${appBaseUrl()}/#retainers/${companyId}`
const hello = person => `Hi ${escapeHtml(person.name || (person.email || '').split('@')[0])}, `
const today = () => londonDate()

// Each returns { subject, title, subtitle, sentence, body, href, linkLabel };
// send() puts the greeting on it. Pure, so the wording is testable.

export function newRequestEmail({ request, company }) {
  return {
    subject: `New request from ${company}: ${request.title}`,
    title: 'A new client request',
    subtitle: company,
    sentence: `${escapeHtml(request.submitted_by_name || 'Someone')} at ${escapeHtml(company)} has sent a request. It needs an owner and a date.`,
    body: card(request.title, [request.wanted_by && `They'd like it by ${formatDay(request.wanted_by, today())}`], request.detail),
    href: `${appBaseUrl()}/#requests/${request.id}`,
    linkLabel: 'Open the request',
  }
}

export function changesRequestedEmail({ d, comment, by }) {
  return {
    subject: `${d.company} asked for changes: ${d.title}`,
    title: 'Changes requested',
    subtitle: `${d.company} · ${d.workstream}`,
    sentence: `${escapeHtml(by || 'The client')} has asked for changes to a delivery.`,
    body: card(d.title, [d.due_date && `Due ${formatDay(d.due_date, today())}`], comment),
    href: retainersLink(d.company_id),
    linkLabel: 'Open the deliverable',
  }
}

export function clientReplyEmail({ d, reply, by }) {
  return {
    subject: `${d.company} replied: ${d.title}`,
    title: 'A client replied',
    subtitle: `${d.company} · ${d.workstream}`,
    sentence: `${escapeHtml(by || 'The client')} has replied on an item that was waiting on them.`,
    body: card(d.title, [d.waiting_note && `We asked for: ${d.waiting_note}`], reply),
    href: retainersLink(d.company_id),
    linkLabel: 'Open the deliverable',
  }
}

export function dueSoonEmail({ d, now = today() }) {
  return {
    subject: `Due ${formatDay(d.due_date, now)}: ${d.title}`,
    title: 'Due within 48 hours',
    subtitle: `${d.company} · ${d.workstream}`,
    sentence: `This is due ${escapeHtml(formatDay(d.due_date, now))} and isn't in review yet.`,
    body: card(d.title, [`Status: ${d.status_label}`]),
    href: retainersLink(d.company_id),
    linkLabel: 'Open the deliverable',
  }
}

export function inputOverdueEmail({ d, days }) {
  return {
    subject: `${d.company} still owes us input: ${d.title}`,
    title: 'Client input overdue',
    subtitle: `${d.company} · ${d.workstream}`,
    sentence: `This has been waiting on ${escapeHtml(d.company)} for ${days} days or more.`,
    body: card(d.title, [d.due_date && `Due ${formatDay(d.due_date, today())}`], d.waiting_note && `We asked for: ${d.waiting_note}`),
    href: retainersLink(d.company_id),
    linkLabel: 'Open the deliverable',
  }
}

// ── Sending ──────────────────────────────────────────────────────────────────

// → notify()'s results, one per recipient. Never throws for a failed send.
async function send(sql, { kind, ownerId = null, companyId, email }) {
  const { to } = await loadRecipients(sql, { ownerId, companyId })
  const results = []
  for (const person of to) {
    const [r] = await notify(sql, {
      kind, to: { email: person.email, clerk_id: person.clerk_id, name: person.name },
      subject: email.subject,
      html: wrap({
        title: email.title, subtitle: email.subtitle, greeting: `${hello(person)}${email.sentence}`,
        bodyHtml: email.body, href: email.href, linkLabel: email.linkLabel,
      }),
    })
    results.push(r)
  }
  return results
}

// A deliverable with what an alert says about it.
export async function loadDeliverableContext(sql, id) {
  const [d] = await sql`
    SELECT d.id, d.title, d.owner_id, d.status, d.due_date::text AS due_date, d.waiting_note,
           w.title AS workstream, w.company_id, c.name AS company
    FROM deliverables d
    JOIN workstreams w ON w.id = d.workstream_id
    JOIN companies c ON c.id = w.company_id
    WHERE d.id = ${id}`
  return d ?? null
}

// Immediate alerts. Each is called after the change is saved, and a failed
// email never fails the change (the caller catches).

export async function alertNewRequest(sql, { request, companyName }) {
  const email = newRequestEmail({ request, company: companyName })
  // A request has no deliverable yet, so no owner: it goes to the company's lead.
  return send(sql, { kind: 'alert_new_request', companyId: request.company_id, email })
}

export async function alertChangesRequested(sql, { deliverableId, comment, by }) {
  const d = await loadDeliverableContext(sql, deliverableId)
  if (!d) return []
  return send(sql, { kind: 'alert_changes_requested', ownerId: d.owner_id, companyId: d.company_id, email: changesRequestedEmail({ d, comment, by }) })
}

export async function alertClientReply(sql, { deliverableId, reply, by }) {
  const d = await loadDeliverableContext(sql, deliverableId)
  if (!d) return []
  return send(sql, { kind: 'alert_client_reply', ownerId: d.owner_id, companyId: d.company_id, email: clientReplyEmail({ d, reply, by }) })
}

// ── The hourly run ───────────────────────────────────────────────────────────

const STATUS_LABEL = {
  planned: 'Planned', in_progress: 'In progress', waiting_on_client: 'Waiting on client',
  changes_requested: 'Changes requested',
}

// Takes the item's place in alert_log. False when someone already has.
async function claim(sql, kind, id, cycle) {
  const [row] = await sql`
    INSERT INTO alert_log (kind, subject_id, cycle) VALUES (${kind}, ${id}, ${cycle})
    ON CONFLICT DO NOTHING RETURNING kind`
  return !!row
}
const release = (sql, kind, id, cycle) =>
  sql`DELETE FROM alert_log WHERE kind = ${kind} AND subject_id = ${id} AND cycle = ${cycle}`

// A claim stands if someone was told, or chose not to be. If nothing could be
// sent (a mail failure, no mail set up, no one to tell) it is given back, so
// the next hourly run tries again.
export const claimStands = results => results.some(r => r.sent || r.skipped === 'setting')

async function alertOnce(sql, { kind, id, cycle, ownerId, companyId, email }) {
  if (!(await claim(sql, kind, id, cycle))) return { sent: 0 }
  let results = []
  try {
    results = await send(sql, { kind, ownerId, companyId, email })
  } finally {
    if (!claimStands(results)) await release(sql, kind, id, cycle)
  }
  return { sent: results.filter(r => r.sent).length }
}

// Sends every timed alert that is due and hasn't been sent for its cycle.
// `now` is injectable for tests. Outside 07:00–20:00 London it does nothing.
export async function runTimedAlerts(sql, { now = new Date(), env = process.env } = {}) {
  if (!inAlertWindow(now)) return { skipped: 'quiet_hours' }

  const ws = await workspaceId(sql)
  const day = londonDate(now)
  const days = inputAlertDays(env)
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString()
  const summary = { due_soon: 0, input_overdue: 0 }

  // Due within 48 hours (today, tomorrow or the day after) and not yet in
  // review. Already-late items are the digest's business, not an alert.
  const soon = await sql`
    SELECT d.id, d.title, d.owner_id, d.status, d.due_date::text AS due_date, d.waiting_note,
           w.title AS workstream, w.company_id, c.name AS company
    FROM deliverables d
    JOIN workstreams w ON w.id = d.workstream_id
    JOIN companies c ON c.id = w.company_id
    WHERE w.user_id = ${ws} AND w.status = 'active'
      AND d.status NOT IN ('in_review', 'approved')
      AND d.due_date BETWEEN ${day}::date AND ${addDays(day, 2)}::date
      AND NOT EXISTS (SELECT 1 FROM alert_log a WHERE a.kind = 'alert_due_soon' AND a.subject_id = d.id AND a.cycle = d.due_date::text)
    ORDER BY d.due_date`
  for (const d of soon) {
    const r = await alertOnce(sql, {
      kind: 'alert_due_soon', id: d.id, cycle: d.due_date, ownerId: d.owner_id, companyId: d.company_id,
      email: dueSoonEmail({ d: { ...d, status_label: STATUS_LABEL[d.status] ?? d.status }, now: day }),
    })
    summary.due_soon += r.sent
  }

  // Waiting on a client for `days` days or more. The cycle is waiting_since,
  // so an item that goes back to waiting starts over.
  const stale = await sql`
    SELECT d.id, d.title, d.owner_id, d.status, d.due_date::text AS due_date, d.waiting_note,
           d.waiting_since::text AS cycle,
           w.title AS workstream, w.company_id, c.name AS company
    FROM deliverables d
    JOIN workstreams w ON w.id = d.workstream_id
    JOIN companies c ON c.id = w.company_id
    WHERE w.user_id = ${ws} AND w.status = 'active'
      AND d.status = 'waiting_on_client' AND d.waiting_since <= ${cutoff}::timestamptz
      AND NOT EXISTS (SELECT 1 FROM alert_log a WHERE a.kind = 'alert_input_overdue' AND a.subject_id = d.id AND a.cycle = d.waiting_since::text)
    ORDER BY d.waiting_since`
  for (const d of stale) {
    const r = await alertOnce(sql, {
      kind: 'alert_input_overdue', id: d.id, cycle: d.cycle, ownerId: d.owner_id, companyId: d.company_id,
      email: inputOverdueEmail({ d, days }),
    })
    summary.input_overdue += r.sent
  }
  return summary
}
