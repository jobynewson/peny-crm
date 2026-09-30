// api/_delivery-mail.js
// The email a client gets when a round is sent for review: what it is, a link
// to watch it, and two buttons.
//   Approve          a one-time link that works without signing in. It opens a
//                    confirm page that asks first and then POSTs — the link
//                    itself never approves anything, because mail scanners open
//                    every link in a message.
//   Request changes  the portal, signed in: changes need a comment.
// One email per person in the company's Clerk organisation, each with their own
// link, so the record can say who approved. Sent through notify() (the
// delivery_ready kind, which clients can't switch off: they have no settings
// page, and this email is the point of sending a round).
//
// A link is 32 random bytes, kept only as a SHA-256 hash. It is used up when it
// approves, expires after LINK_DAYS, and dies when its round is answered, taken
// back or superseded (api/_worklist.js, respondViaLink) or when its person is
// removed from the portal (api/_portal-access.js).
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { createHash, randomBytes } from 'node:crypto'
import { createClerkClient } from '@clerk/backend'
import { notify } from './_notify.js'
import { escapeHtml, appBaseUrl } from './_task-mail.js'

export const LINK_DAYS = 14

export const hashToken = token => createHash('sha256').update(token).digest('hex')
export const newToken = () => randomBytes(32).toString('base64url')

// Who is in the company's portal, with the address each signs in with:
// [{ clerk_id, email, name }]. A Clerk failure is thrown to the caller.
export async function portalMembers(orgId) {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  const { data } = await clerk.organizations.getOrganizationMembershipList({ organizationId: orgId, limit: 100 })
  return data
    .map(m => ({
      clerk_id: m.publicUserData?.userId ?? null,
      email: m.publicUserData?.identifier ?? null,
      name: [m.publicUserData?.firstName, m.publicUserData?.lastName].filter(Boolean).join(' ') || null,
      first: m.publicUserData?.firstName || null,
    }))
    .filter(m => m.clerk_id && m.email && m.email.includes('@'))
}

export const approveUrl = token => `${appBaseUrl()}/portal/approve#${token}`
export const changesUrl = deliverableId => `${appBaseUrl()}/portal#d-${deliverableId}`

const button = (href, label, { primary = false } = {}) => `
  <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;margin:0 8px 8px 0;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;${primary ? 'background:#16a34a;color:#fff;border:1px solid #16a34a' : 'background:#fff;color:#111;border:1px solid #bbb'}">${escapeHtml(label)}</a>`

export function deliveryEmail({ studio, company, title, round, note, url, first, approve, changes, days = LINK_DAYS, expires }) {
  const expiry = expires ? new Date(expires).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/London' }) : null
  return {
    subject: `Ready for your review: ${title}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:32px 0">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08)">
    <div style="background:#111;padding:20px 28px">
      <h1 style="margin:0;font-size:18px;color:#fff;font-weight:600">Ready for your review</h1>
      <p style="margin:4px 0 0;font-size:13px;color:#999">${escapeHtml(company)}${studio ? ` · ${escapeHtml(studio)}` : ''}</p>
    </div>
    <div style="padding:24px 28px">
      <p style="margin:0 0 18px;font-size:14px;color:#444;line-height:1.5">Hi ${escapeHtml(first || 'there')}, round ${round} of <strong>${escapeHtml(title)}</strong> is ready for you.</p>
      ${note ? `<p style="margin:0 0 18px;font-size:14px;color:#444;line-height:1.5;white-space:pre-line;border-left:3px solid #ddd;padding-left:12px">${escapeHtml(note)}</p>` : ''}
      <p style="margin:0 0 20px"><a href="${escapeHtml(url)}" style="color:#3b82f6;font-size:15px;font-weight:600">Watch it ↗</a></p>
      <div>${button(approve, 'Approve', { primary: true })}${button(changes, 'Request changes')}</div>
      <p style="margin:18px 0 0;font-size:12px;color:#999;line-height:1.5">
        Approve asks you to confirm before anything happens. The button works once${expiry ? ` and stops working on ${escapeHtml(expiry)}` : ` and expires after ${days} days`}. Requesting changes takes you to the portal, where you sign in and say what needs to change.
      </p>
    </div>
  </div>
</body>
</html>`,
  }
}

// What to tell the person who sent the round: who was emailed, or why nobody
// was (so a round that reached no one never passes for one that did).
export function notifiedMessage({ sent, reason }, company = 'the client') {
  if (sent) return `emailed ${sent === 1 ? '1 person' : `${sent} people`} at ${company}`
  return {
    hidden:     `no one was emailed — it isn't shown to ${company} yet`,
    no_portal:  `no one was emailed — ${company} has no portal yet`,
    no_members: `no one was emailed — no one has joined ${company}'s portal yet`,
    not_sent:   'the email did not go out — check that email is set up',
  }[reason] ?? 'no one was emailed'
}

// Sends this round to everyone in the company's portal and reports what
// happened. Never throws: a failed email must not fail the sending of a round.
//   → { sent, reason? } — reason is why nobody was emailed, when sent is 0.
export async function emailDelivery(sql, { deliveryId, members = portalMembers, now = new Date() }) {
  try {
    const [dv] = await sql`
      SELECT dv.id, dv.round, dv.url, dv.note, d.id AS deliverable_id, d.title, d.client_visible,
             w.project_id, wc.company_id, COALESCE(c.name, p.name) AS company, c.clerk_org_id,
             (SELECT s.company_name FROM settings s WHERE s.user_id = w.user_id LIMIT 1) AS studio
      FROM deliveries dv
      JOIN deliverables d ON d.id = dv.deliverable_id
      JOIN workstreams w ON w.id = d.workstream_id
      JOIN workstream_company wc ON wc.workstream_id = w.id
      LEFT JOIN companies c ON c.id = wc.company_id
      LEFT JOIN projects p ON p.id = w.project_id
      WHERE dv.id = ${deliveryId}`
    if (!dv) return outcome(0, 'not_found')
    if (!dv.client_visible) return outcome(0, 'hidden', dv.company)
    if (!dv.clerk_org_id) return outcome(0, 'no_portal', dv.company)

    const people = await (typeof members === 'function' ? members(dv.clerk_org_id) : members)
    const staff = new Set((await sql`SELECT clerk_id FROM app_users`).map(u => u.clerk_id))
    const clients = people.filter(p => !staff.has(p.clerk_id))
    if (!clients.length) return outcome(0, 'no_members', dv.company)

    const expires = new Date(now.getTime() + LINK_DAYS * 86400000)
    let sent = 0
    for (const person of clients) {
      const token = newToken()
      await sql`
        INSERT INTO action_links (delivery_id, clerk_user_id, email, token_hash, expires_at)
        VALUES (${dv.id}, ${person.clerk_id}, ${person.email}, ${hashToken(token)}, ${expires.toISOString()})`
      const mail = deliveryEmail({
        studio: dv.studio, company: dv.company, title: dv.title, round: dv.round, note: dv.note, url: dv.url,
        first: person.first, approve: approveUrl(token), changes: changesUrl(dv.deliverable_id), expires,
      })
      const [r] = await notify(sql, {
        kind: 'delivery_ready', to: { email: person.email, name: person.name }, subject: mail.subject, html: mail.html,
      })
      if (r?.sent) sent++
      else await sql`DELETE FROM action_links WHERE token_hash = ${hashToken(token)}`   // nobody has this link
    }
    return sent ? outcome(sent, null, dv.company) : outcome(0, 'not_sent', dv.company)
  } catch (err) {
    console.error('[delivery-mail] could not email the client:', err?.message)
    return outcome(0, 'error')
  }
}

function outcome(sent, reason, company) {
  return { sent, ...(reason ? { reason } : {}), message: notifiedMessage({ sent, reason }, company) }
}
