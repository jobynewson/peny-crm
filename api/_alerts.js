// api/_alerts.js
// The urgent alerts: emails that go out as the thing happens (a new client
// request, changes requested, a client's reply) or on the hourly run (due
// within 48 hours and not in review, client input overdue, work with no owner
// for two working days). Everything else
// waits for the daily digest, approvals included.
//
// All of it goes through notify() in _notify.js, so each person's own settings
// apply and there is one sender. The kinds are the alert_* entries in KINDS;
// each can be muted, and none depends on the digest setting.
//
// Who hears: the deliverable's owner. If it has none, the company's lead — but
// only while leads are switched on (Settings › Company; api/_leads.js). Then
// whoever looks after unassigned work (settings.assignment_lead_id, Settings ›
// Unassigned work). With none of those, every superadmin — and the log says
// so. Nothing is ever sent to no one.
//
// Unassigned work has its own timed alert: a task or deliverable with no owner
// for two working days is mentioned once, to the assignment lead only (else
// the superadmins) — the company lead is for a client's work, not for who
// picks up what.
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
import { leadsShown } from './_leads.js'
import { worklistLink } from './_retainer-rules.js'
import { TIME_ZONE, londonDate, addDays, formatDay, workingDaysBetween } from './_dates.js'
import { isFinishedColumn } from './_due-feed.js'

// ── Who, and when ────────────────────────────────────────────────────────────

// { via, to } — owner, else lead, else the assignment lead, else the
// superadmins. Someone without an email address can't be told anything, so
// they don't count.
export function resolveRecipients({ owner = null, lead = null, assignmentLead = null, superadmins = [] }) {
  const usable = u => !!u?.email
  if (usable(owner)) return { via: 'owner', to: [owner] }
  if (usable(lead)) return { via: 'lead', to: [lead] }
  if (usable(assignmentLead)) return { via: 'assignment_lead', to: [assignmentLead] }
  return { via: 'superadmins', to: superadmins.filter(usable) }
}

// Whoever looks after unassigned work (Settings › Unassigned work), or null.
export async function loadAssignmentLead(sql) {
  const ws = await workspaceId(sql)
  const [lead] = await sql`
    SELECT u.id, u.clerk_id, u.name, u.email
    FROM settings s JOIN app_users u ON u.id = s.assignment_lead_id
    WHERE s.user_id = ${ws}`
  return lead ?? null
}

const loadSuperadmins = sql => sql`SELECT id, clerk_id, name, email FROM app_users WHERE role = 'superadmin' AND email IS NOT NULL`

export async function loadRecipients(sql, { ownerId = null, companyId = null }) {
  const [owner] = ownerId ? await sql`SELECT id, clerk_id, name, email FROM app_users WHERE id = ${ownerId}` : []
  const showLeads = await leadsShown(sql)
  const [lead] = companyId && showLeads
    ? await sql`
        SELECT u.id, u.clerk_id, u.name, u.email
        FROM companies c JOIN app_users u ON u.id = c.lead_id
        WHERE c.id = ${companyId}`
    : []
  const first = resolveRecipients({ owner, lead })
  if (first.via !== 'superadmins') return first
  const assignmentLead = await loadAssignmentLead(sql)
  const second = resolveRecipients({ owner, lead, assignmentLead })
  if (second.via !== 'superadmins') return second
  const out = resolveRecipients({ owner, lead, assignmentLead, superadmins: await loadSuperadmins(sql) })
  console.warn(`[alerts] no owner${showLeads ? ', lead' : ''} or assignment lead with an email for company ${companyId ?? '?'}; sending to ${out.to.length} superadmin(s)`)
  return out
}

// Who hears about unassigned work: the assignment lead, else the superadmins.
export async function loadOverseers(sql) {
  const assignmentLead = await loadAssignmentLead(sql)
  if (assignmentLead?.email) return { via: 'assignment_lead', to: [assignmentLead] }
  const out = resolveRecipients({ superadmins: await loadSuperadmins(sql) })
  console.warn(`[alerts] nobody looks after unassigned work; sending to ${out.to.length} superadmin(s)`)
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

export function wrap({ title, subtitle, greeting, bodyHtml, href, linkLabel }) {
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

export const card = (heading, lines = [], quote = null) => `
    <div style="border:1px solid #eee;border-left:3px solid #E5484D;border-radius:0 6px 6px 0;padding:12px 14px;margin:0 0 10px">
      <div style="font-size:15px;font-weight:600;color:#1a1a1a">${escapeHtml(heading)}</div>
      ${lines.filter(Boolean).map(l => `<div style="font-size:12px;color:#999;margin-top:4px">${escapeHtml(l)}</div>`).join('')}
      ${quote ? `<div style="font-size:14px;color:#333;margin-top:10px;white-space:pre-wrap">${escapeHtml(quote)}</div>` : ''}
    </div>`

// A deliverable's page: its project's Worklist tab (worklistLink), absolute for email.
const retainersLink = d => `${appBaseUrl()}/${worklistLink({ project_id: d.project_id, company_id: d.company_id, id: d.id })}`
const hello = person => `Hi ${escapeHtml(person.name || (person.email || '').split('@')[0])}, `
const today = () => londonDate()

// Each returns { subject, title, subtitle, sentence, body, href, linkLabel };
// send() puts the greeting on it. Pure, so the wording is testable.

export function newRequestEmail({ request, company }) {
  const viaLink = request.submitted_via === 'link'
  return {
    subject: `New request from ${company}: ${request.title}`,
    title: 'A new client request',
    subtitle: company,
    sentence: viaLink
      ? `Someone using the ${escapeHtml(company)} project link sent a request and gave the name ${escapeHtml(request.submitted_by_name || 'nothing')}. The name isn’t checked. It is waiting in New requests on the task board.`
      : `${escapeHtml(request.submitted_by_name || 'Someone')} at ${escapeHtml(company)} has sent a request. It is waiting in New requests on the task board.`,
    body: card(request.title, [request.wanted_by && `They'd like it by ${formatDay(request.wanted_by, today())}`], request.detail),
    // Opens the request itself, ready to accept or decline.
    href: request.id ? `${appBaseUrl()}/#tasks/request/${request.id}` : `${appBaseUrl()}/#tasks`,
    linkLabel: request.id ? 'Open the request' : 'Open the task board',
  }
}

export function changesRequestedEmail({ d, comment, by }) {
  return {
    subject: `${d.company} asked for changes: ${d.title}`,
    title: 'Changes requested',
    subtitle: `${d.company} · ${d.workstream}`,
    sentence: `${escapeHtml(by || 'The client')} has asked for changes to a delivery.`,
    body: card(d.title, [d.due_date && `Due ${formatDay(d.due_date, today())}`], comment),
    href: retainersLink(d),
    linkLabel: 'Open the deliverable',
  }
}

export function commentsInEmail({ d, by, undone = false }) {
  return {
    subject: undone ? `${d.company} is still adding feedback: ${d.title}` : `${d.company}'s comments are in: ${d.title}`,
    title: undone ? 'Feedback not finished' : 'Comments are in',
    subtitle: `${d.company} · ${d.workstream}`,
    sentence: undone
      ? `${escapeHtml(by || 'The client')} took back “comments are in” — they are still leaving feedback in Frame.io. Hold off on the next round.`
      : `${escapeHtml(by || 'The client')} has finished leaving feedback in Frame.io. It is over to you to act on it and send the next round.`,
    body: card(d.title, [d.due_date && `Due ${formatDay(d.due_date, today())}`]),
    href: retainersLink(d),
    linkLabel: 'Open the deliverable',
  }
}

export function approvedEmail({ d, by, comment = null }) {
  return {
    subject: `${d.company} approved: ${d.title}`,
    title: 'Approved',
    subtitle: `${d.company} · ${d.workstream}`,
    sentence: `${escapeHtml(by || 'The client')} has approved this.`,
    body: card(d.title, [d.due_date && `Due ${formatDay(d.due_date, today())}`], comment),
    href: retainersLink(d),
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
    href: retainersLink(d),
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
    href: retainersLink(d),
    linkLabel: 'Open the deliverable',
  }
}

// A planning-board card is not a deliverable: no company or worklist, and its
// link opens the board it sits on.
const boardLink = c => `${appBaseUrl()}/#planning/${c.board_id}`

export function cardDueSoonEmail({ c, now = today() }) {
  return {
    subject: `Due ${formatDay(c.due_date, now)}: ${c.title}`,
    title: 'Due within 48 hours',
    subtitle: `Board · ${c.board_name}`,
    sentence: `This card is due ${escapeHtml(formatDay(c.due_date, now))}.`,
    body: card(c.title, [`Column: ${c.column_name}`]),
    href: boardLink(c),
    linkLabel: 'Open the board',
  }
}

export function inputOverdueEmail({ d, days }) {
  return {
    subject: `${d.company} still owes us input: ${d.title}`,
    title: 'Client input overdue',
    subtitle: `${d.company} · ${d.workstream}`,
    sentence: `This has been waiting on ${escapeHtml(d.company)} for ${days} days or more.`,
    body: card(d.title, [d.due_date && `Due ${formatDay(d.due_date, today())}`], d.waiting_note && `We asked for: ${d.waiting_note}`),
    href: retainersLink(d),
    linkLabel: 'Open the deliverable',
  }
}

// Work with no owner, to whoever looks after it. `items` from staleUnassigned();
// `via` is loadOverseers()'s, so the superadmins are told why it's them.
export function unassignedEmail({ items, via = 'assignment_lead' }) {
  const one = items.length === 1
  const why = via === 'assignment_lead'
    ? 'You look after unassigned work, so it’s over to you: give it to someone, or take it yourself.'
    : 'Nobody has been chosen to look after unassigned work (Settings › Unassigned work), so this comes to the superadmins.'
  return {
    subject: one ? `No owner yet: ${items[0].title}` : `${items.length} things have no owner yet`,
    title: 'Unassigned work',
    subtitle: one ? '1 item' : `${items.length} items`,
    sentence: `${one ? 'This has' : 'These have'} had no owner for ${UNASSIGNED_WORKING_DAYS} working days or more. ${why}`,
    body: items.map(i => card(i.title, [
      [i.kind === 'task' ? 'Task' : 'Deliverable', i.context].filter(Boolean).join(' · '),
      `Unassigned for ${i.waited} working day${i.waited === 1 ? '' : 's'}`,
    ])).join(''),
    // One item opens that item; several open the board.
    href: one && items[0].link ? `${appBaseUrl()}/${items[0].link}` : `${appBaseUrl()}/#tasks`,
    linkLabel: one && items[0].link ? (items[0].kind === 'task' ? 'Open the task' : 'Open the deliverable') : 'Open the task board',
  }
}

// ── Sending ──────────────────────────────────────────────────────────────────

// → notify()'s results, one per recipient. Never throws for a failed send.
async function send(sql, { kind, ownerId = null, companyId, email }) {
  const { to } = await loadRecipients(sql, { ownerId, companyId })
  return deliver(sql, { kind, to, email })
}

// What an email says, as a push: its subject for the title, its first sentence
// for the body, and a tap opens the same page the email's link does.
const plain = html => String(html ?? '').replace(/<[^>]*>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
export function pushFor(email) {
  let url = '/'
  try { const u = new URL(email.href); url = `${u.pathname}${u.search}${u.hash}` } catch { /* keep '/' */ }
  return { title: email.subject, body: plain(email.sentence), url }
}

async function deliver(sql, { kind, to, email }) {
  const results = []
  for (const person of to) {
    const [r] = await notify(sql, {
      kind, to: { email: person.email, clerk_id: person.clerk_id, name: person.name },
      push: pushFor(email),
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
           w.title AS workstream, w.project_id, wc.company_id, COALESCE(c.name, p.name) AS company
    FROM deliverables d
    JOIN workstreams w ON w.id = d.workstream_id
    JOIN workstream_company wc ON wc.workstream_id = w.id
    LEFT JOIN companies c ON c.id = wc.company_id
    LEFT JOIN projects p ON p.id = w.project_id
    WHERE d.id = ${id}`
  return d ?? null
}

// Immediate alerts. Each is called after the change is saved, and a failed
// email never fails the change (the caller catches).

export async function alertNewRequest(sql, { request, companyName }) {
  const email = newRequestEmail({ request, company: companyName })
  // A request has no deliverable yet, so no owner: it goes to the company's
  // lead when leads are on, else whoever looks after unassigned work, else the
  // superadmins.
  return send(sql, { kind: 'alert_new_request', companyId: request.company_id, email })
}

export async function alertChangesRequested(sql, { deliverableId, comment, by }) {
  const d = await loadDeliverableContext(sql, deliverableId)
  if (!d) return []
  return send(sql, { kind: 'alert_changes_requested', ownerId: d.owner_id, companyId: d.company_id, email: changesRequestedEmail({ d, comment, by }) })
}

export async function alertCommentsIn(sql, { deliverableId, by, undone = false }) {
  const d = await loadDeliverableContext(sql, deliverableId)
  if (!d) return []
  return send(sql, { kind: 'alert_comments_in', ownerId: d.owner_id, companyId: d.company_id, email: commentsInEmail({ d, by, undone }) })
}

// An approval used to wait for the daily digest, which is paused, so it is
// said straight away like the other answers.
export async function alertApproved(sql, { deliverableId, by, comment = null }) {
  const d = await loadDeliverableContext(sql, deliverableId)
  if (!d) return []
  return send(sql, { kind: 'alert_approved', ownerId: d.owner_id, companyId: d.company_id, email: approvedEmail({ d, by, comment }) })
}

export async function alertClientReply(sql, { deliverableId, reply, by }) {
  const d = await loadDeliverableContext(sql, deliverableId)
  if (!d) return []
  return send(sql, { kind: 'alert_client_reply', ownerId: d.owner_id, companyId: d.company_id, email: clientReplyEmail({ d, reply, by }) })
}

// Not an alert but the same path: telling someone a deliverable is now theirs
// (accepted from a request, created for them, or handed over). It uses the
// "Tasks assigned to you" switch. Nothing is sent to the person who did the
// assigning, or when the deliverable has no owner.
export async function sendOwnerAssigned(sql, { deliverableId, assignedBy }) {
  const d = await loadDeliverableContext(sql, deliverableId)
  if (!d?.owner_id || d.owner_id === assignedBy?.id) return []
  const [owner] = await sql`SELECT id, clerk_id, name, email FROM app_users WHERE id = ${d.owner_id}`
  if (!owner?.email) return []
  const who = assignedBy?.name || assignedBy?.email || 'Someone'
  const email = {
    subject: `New deliverable: ${d.title}`,
    title: 'A deliverable for you',
    subtitle: `${d.company} · ${d.workstream}`,
    sentence: `${escapeHtml(who)} has given you a deliverable.`,
    body: card(d.title, [d.due_date && `Due ${formatDay(d.due_date, today())}`]),
    href: retainersLink(d),
    linkLabel: 'Open the deliverable',
  }
  const [r] = await notify(sql, {
    kind: 'task_assigned', to: { email: owner.email, clerk_id: owner.clerk_id, name: owner.name },
    push: pushFor(email),
    subject: email.subject,
    html: wrap({ title: email.title, subtitle: email.subtitle, greeting: `${hello(owner)}${email.sentence}`, bodyHtml: email.body, href: email.href, linkLabel: email.linkLabel }),
  })
  return [r]
}

// A planning-board card given to someone, with the same "Tasks assigned to
// you" switch as a task. Nothing is sent to the person who did the assigning,
// or when the card has no assignee. Call it only when the assignee changed.
export async function sendCardAssigned(sql, { cardId, assignedBy }) {
  const ws = await workspaceId(sql)
  const [c] = await sql`
    SELECT bc.id, bc.title, bc.assignee_id, bc.due_date::text AS due_date, b.id AS board_id, b.name AS board_name
    FROM board_cards bc JOIN boards b ON b.id = bc.board_id
    WHERE bc.id = ${cardId} AND b.user_id = ${ws}`
  if (!c?.assignee_id || c.assignee_id === assignedBy?.id) return []
  const [owner] = await sql`SELECT id, clerk_id, name, email FROM app_users WHERE id = ${c.assignee_id}`
  if (!owner?.email) return []
  const who = assignedBy?.name || assignedBy?.email || 'Someone'
  const email = {
    subject: `New card: ${c.title}`,
    title: 'A board card for you',
    subtitle: `Board · ${c.board_name}`,
    sentence: `${escapeHtml(who)} has given you a card.`,
    body: card(c.title, [c.due_date && `Due ${formatDay(c.due_date, today())}`]),
    href: boardLink(c),
    linkLabel: 'Open the board',
  }
  const [r] = await notify(sql, {
    kind: 'task_assigned', to: { email: owner.email, clerk_id: owner.clerk_id, name: owner.name },
    push: pushFor(email),
    subject: email.subject,
    html: wrap({ title: email.title, subtitle: email.subtitle, greeting: `${hello(owner)}${email.sentence}`, bodyHtml: email.body, href: email.href, linkLabel: email.linkLabel }),
  })
  return [r]
}

// ── Unassigned work ──────────────────────────────────────────────────────────
// A task or deliverable with no owner sits in To do on the board. Once it has
// waited this many working days (weekdays that aren't a public holiday) the
// assignment lead hears, once per spell without an owner.
export const UNASSIGNED_WORKING_DAYS = 2

// Open work with no owner, and since when. A task's spell starts when it was
// made or last had its owner removed; a deliverable keeps no history, so its
// spell is counted from when it was made. Deliverables in a paused or complete
// workstream are parked on purpose and left out.
export async function loadUnassigned(sql, ws) {
  const [tasks, deliverables, holidays, logged] = await Promise.all([
    sql`
      SELECT t.id, t.title, p.name AS context,
             COALESCE((SELECT max(e.created_at) FROM task_events e WHERE e.task_id = t.id AND e.type = 'unassigned'), t.created_at) AS since
      FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.user_id = ${ws} AND t.assignee_id IS NULL AND t.status <> 'done' AND t.archived_at IS NULL`,
    sql`
      SELECT d.id, d.title, d.created_at AS since, w.title AS workstream, w.project_id, wc.company_id,
             COALESCE(c.name, p.name) AS company
      FROM deliverables d
      JOIN workstreams w ON w.id = d.workstream_id
      JOIN workstream_company wc ON wc.workstream_id = w.id
      LEFT JOIN companies c ON c.id = wc.company_id
      LEFT JOIN projects p ON p.id = w.project_id
      WHERE w.user_id = ${ws} AND w.status = 'active' AND d.owner_id IS NULL AND d.status <> 'approved'`,
    sql`SELECT holiday_date::text AS day FROM public_holidays WHERE user_id = ${ws}`,
    sql`SELECT subject_id::text AS id, cycle FROM alert_log WHERE kind = 'alert_unassigned'`,
  ])
  return { tasks, deliverables, holidays: holidays.map(h => h.day), logged }
}

// The ones that have waited long enough and haven't been mentioned for this
// spell, longest-waiting first. Pure. `cycle` is the spell's start.
export function staleUnassigned({ tasks = [], deliverables = [], holidays = [], logged = [] }, today, days = UNASSIGNED_WORKING_DAYS) {
  const seen = new Set(logged.map(l => `${l.id}|${l.cycle}`))
  const iso = v => new Date(v).toISOString()
  const item = (kind, row, extra) => ({
    kind, id: row.id, title: row.title, cycle: iso(row.since),
    waited: workingDaysBetween(londonDate(row.since), today, holidays), ...extra,
  })
  return [
    ...tasks.map(t => item('task', t, { context: t.context || null, link: `#tasks/${t.id}` })),
    ...deliverables.map(d => item('deliverable', d, { context: [d.company, d.workstream].filter(Boolean).join(' · '), link: worklistLink(d) })),
  ]
    .filter(i => i.waited >= days && !seen.has(`${i.id}|${i.cycle}`))
    .sort((a, b) => b.waited - a.waited || a.title.localeCompare(b.title))
}

// One email for everything that crossed the line since the last run. Claims
// first (so two runs can't both send), gives them all back if nobody could be
// told.
async function alertUnassigned(sql, { ws, day }) {
  const items = staleUnassigned(await loadUnassigned(sql, ws), day)
  const claimed = []
  for (const i of items) if (await claim(sql, 'alert_unassigned', i.id, i.cycle)) claimed.push(i)
  if (!claimed.length) return { sent: 0 }
  let results = []
  try {
    const { via, to } = await loadOverseers(sql)
    results = await deliver(sql, { kind: 'alert_unassigned', to, email: unassignedEmail({ items: claimed, via }) })
  } finally {
    if (!claimStands(results)) for (const i of claimed) await release(sql, 'alert_unassigned', i.id, i.cycle)
  }
  return { sent: results.filter(r => r.sent).length }
}

// ── The hourly run ───────────────────────────────────────────────────────────

const STATUS_LABEL = {
  planned: 'Planned', in_progress: 'In progress', waiting_on_client: 'Waiting on client',
  changes_requested: 'Changes requested', comments_in: 'Comments in',
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
  const summary = { due_soon: 0, input_overdue: 0, unassigned: 0 }

  // Due within 48 hours (today, tomorrow or the day after) and not yet in
  // review. Already-late items are the digest's business, not an alert.
  const soon = await sql`
    SELECT d.id, d.title, d.owner_id, d.status, d.due_date::text AS due_date, d.waiting_note,
           w.title AS workstream, w.project_id, wc.company_id, COALESCE(c.name, p.name) AS company
    FROM deliverables d
    JOIN workstreams w ON w.id = d.workstream_id
    JOIN workstream_company wc ON wc.workstream_id = w.id
    LEFT JOIN companies c ON c.id = wc.company_id
    LEFT JOIN projects p ON p.id = w.project_id
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

  // Board cards due in the same window, to their assignee. A card with no
  // assignee, or one in a finished column, is left alone.
  const cards = await sql`
    SELECT bc.id, bc.title, bc.assignee_id, bc.due_date::text AS due_date,
           b.id AS board_id, b.name AS board_name, col.name AS column_name
    FROM board_cards bc
    JOIN boards b ON b.id = bc.board_id
    JOIN board_columns col ON col.id = bc.column_id
    JOIN app_users u ON u.id = bc.assignee_id AND u.email IS NOT NULL
    WHERE b.user_id = ${ws}
      AND bc.due_date BETWEEN ${day}::date AND ${addDays(day, 2)}::date
      AND NOT EXISTS (SELECT 1 FROM alert_log a WHERE a.kind = 'alert_due_soon' AND a.subject_id = bc.id AND a.cycle = bc.due_date::text)
    ORDER BY bc.due_date`
  for (const c of cards.filter(c => !isFinishedColumn(c.column_name))) {
    const r = await alertOnce(sql, {
      kind: 'alert_due_soon', id: c.id, cycle: c.due_date, ownerId: c.assignee_id, companyId: null,
      email: cardDueSoonEmail({ c, now: day }),
    })
    summary.due_soon += r.sent
  }

  // Waiting on a client for `days` days or more. The cycle is waiting_since,
  // so an item that goes back to waiting starts over.
  const stale = await sql`
    SELECT d.id, d.title, d.owner_id, d.status, d.due_date::text AS due_date, d.waiting_note,
           d.waiting_since::text AS cycle,
           w.title AS workstream, w.project_id, wc.company_id, COALESCE(c.name, p.name) AS company
    FROM deliverables d
    JOIN workstreams w ON w.id = d.workstream_id
    JOIN workstream_company wc ON wc.workstream_id = w.id
    LEFT JOIN companies c ON c.id = wc.company_id
    LEFT JOIN projects p ON p.id = w.project_id
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

  summary.unassigned = (await alertUnassigned(sql, { ws, day })).sent
  return summary
}

// ── Approvals, for the digest ────────────────────────────────────────────────
// An approval is not urgent: it waits for the daily digest, in an "Approved
// since your last digest" section. The digest runs at 09:00 UTC on weekdays,
// so the window is from the previous run to this one — three days on a Monday,
// which covers the weekend. Windows are fixed at 09:00 UTC on both ends, so
// nothing is listed twice and nothing falls between two digests.

const DIGEST_HOUR_UTC = 9

// [from, to) for the digest that runs at (or after) `now`.
export function digestApprovalWindow(now = new Date()) {
  const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DIGEST_HOUR_UTC))
  if (anchor > now) anchor.setUTCDate(anchor.getUTCDate() - 1)
  const days = anchor.getUTCDay() === 1 ? 3 : 1
  return { from: new Date(anchor.getTime() - days * 86400000), to: anchor }
}

export async function loadApprovals(sql, { ws, from, to }) {
  // A round's approval, and a delivered deliverable the client approved with no
  // round (round is null for those).
  return sql`
    SELECT * FROM (
    SELECT dv.id, dv.round, dv.responded_at, dv.responded_by_name, dv.client_comment AS comment, d.id AS deliverable_id, d.title, d.owner_id,
           w.project_id, wc.company_id, COALESCE(c.name, p.name) AS company, c.lead_id,
           EXISTS (SELECT 1 FROM app_users u WHERE u.clerk_id = dv.responded_by) AS recorded
    FROM deliveries dv
    JOIN deliverables d ON d.id = dv.deliverable_id
    JOIN workstreams w ON w.id = d.workstream_id
    JOIN workstream_company wc ON wc.workstream_id = w.id
    LEFT JOIN companies c ON c.id = wc.company_id
    LEFT JOIN projects p ON p.id = w.project_id
    WHERE w.user_id = ${ws} AND dv.client_response = 'approved'
      AND dv.responded_at >= ${from.toISOString()}::timestamptz AND dv.responded_at < ${to.toISOString()}::timestamptz
    UNION ALL
    SELECT d.id, NULL::int AS round, d.approved_at AS responded_at, d.approved_by_name AS responded_by_name, d.approved_comment AS comment, d.id AS deliverable_id, d.title, d.owner_id,
           w.project_id, wc.company_id, COALESCE(c.name, p.name) AS company, c.lead_id, false AS recorded
    FROM deliverables d
    JOIN workstreams w ON w.id = d.workstream_id
    JOIN workstream_company wc ON wc.workstream_id = w.id
    LEFT JOIN companies c ON c.id = wc.company_id
    LEFT JOIN projects p ON p.id = w.project_id
    WHERE w.user_id = ${ws} AND d.approved_at IS NOT NULL
      AND d.approved_at >= ${from.toISOString()}::timestamptz AND d.approved_at < ${to.toISOString()}::timestamptz
    ) approvals
    ORDER BY responded_at`
}

// Which digest each approval goes in: the deliverable's owner's, else the
// company lead's (only when leads are on), else every superadmin's — the same
// routing as the alerts. → { [app_users.id]: approval[] }
export function routeApprovals(approvals, users, { showLeads = false } = {}) {
  const byId = new Map(users.map(u => [u.id, u]))
  const superadmins = users.filter(u => u.role === 'superadmin' && u.email)
  const out = {}
  const give = (u, a) => { (out[u.id] ||= []).push(a) }
  for (const a of approvals) {
    const owner = a.owner_id ? byId.get(a.owner_id) : null
    const lead = showLeads && a.lead_id ? byId.get(a.lead_id) : null
    const { to } = resolveRecipients({ owner, lead, superadmins })
    for (const person of to) give(person, a)
  }
  return out
}

// The digest section. `link` is the app's base URL.
export function approvalsSectionHtml(items, baseUrl) {
  if (!items.length) return ''
  const day = d => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TIME_ZONE })
  return `
      <h3 style="margin:24px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#999">Approved since your last digest</h3>
      <table style="width:100%;border-collapse:collapse">
        <tbody>${items.map(a => `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:14px">
              <a href="${escapeHtml(baseUrl)}/${escapeHtml(worklistLink({ project_id: a.project_id, company_id: a.company_id, id: a.deliverable_id }))}" style="color:#1a1a1a;text-decoration:none">${escapeHtml(a.title)}</a>
              <div style="font-size:11px;color:#999;margin-top:2px">${escapeHtml(a.company)}${a.round ? ` · round ${a.round}` : ''}${a.recorded ? ' · recorded by the team' : a.responded_by_name ? ` · ${escapeHtml(a.responded_by_name)}` : ''}</div>
              ${a.comment ? `<div style="font-size:13px;color:#444;margin-top:6px;border-left:3px solid #ddd;padding-left:10px;white-space:pre-line">${escapeHtml(a.comment)}</div>` : ''}
            </td>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#16a34a;white-space:nowrap;font-weight:500;vertical-align:top">Approved ${escapeHtml(day(a.responded_at))}</td>
          </tr>`).join('')}</tbody>
      </table>`
}
