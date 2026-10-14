// api/_request-mail.js
// The emails a client gets about a request they sent: we have it, we've
// confirmed it (the deadline and the capacity), or we can't take it on. They go
// to the person who sent it, through notify(), and only when that person signed
// in: a project-link request has a typed name and no address, so nobody is
// written to (the portal still shows where it stands). Clients have no settings
// page, so these kinds can't be switched off; Testing mode redirects them like
// the other client emails.
//
// A failed email never fails the request or the decision (the callers catch,
// and emailRequestUpdate never throws).
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { createClerkClient } from '@clerk/backend'
import { notify } from './_notify.js'
import { wrap, card } from './_alerts.js'
import { escapeHtml, appBaseUrl } from './_task-mail.js'
import { formatDay, londonDate } from './_dates.js'

const portalUrl = deliverableId => `${appBaseUrl()}/portal${deliverableId ? `#d-${deliverableId}` : ''}`

// What the deadline sentence says (pure). `wanted` is what they asked for, `due`
// the date we gave the work; both are 'YYYY-MM-DD' or null.
export function deadlineSentence({ wanted, due, today }) {
  const day = d => formatDay(d, today)
  if (due && wanted && due === wanted) return `We’ve confirmed your deadline of ${day(due)}, and we have the capacity to deliver it.`
  if (due && wanted) return `We have the capacity for this and can deliver it by ${day(due)}. You asked for ${day(wanted)}, so if that date is a problem, reply to this email and we’ll talk it through.`
  if (due) return `We have the capacity for this and can deliver it by ${day(due)}.`
  return 'We have the capacity for this. We’ll confirm a delivery date as soon as it’s scheduled.'
}

// Each returns { subject, title, subtitle, sentence, body, href, linkLabel },
// like the staff alerts in _alerts.js; the sender adds the greeting.

export function requestReceivedEmail({ request, company, studio, today = londonDate() }) {
  const subtitle = [company, studio].filter(Boolean).join(' · ')
  return {
    subject: `We’ve got your request: ${request.title}`,
    title: 'We’ve got your request',
    subtitle,
    sentence: `we’ve got your request. We’re checking ${request.wanted_by ? `your deadline of ${escapeHtml(formatDay(request.wanted_by, today))}` : 'the timing'} against the team’s capacity and will confirm with you shortly. There’s nothing you need to do.`,
    body: card(request.title, [request.wanted_by && `You asked for it by ${formatDay(request.wanted_by, today)}`]),
    href: portalUrl(),
    linkLabel: 'See where it stands in the portal',
  }
}

export function requestAcceptedEmail({ request, company, studio, deliverableId, due, today = londonDate() }) {
  const subtitle = [company, studio].filter(Boolean).join(' · ')
  return {
    subject: `Confirmed: ${request.title}`,
    title: 'Your request is confirmed',
    subtitle,
    sentence: `we’ve got this booked in. ${escapeHtml(deadlineSentence({ wanted: request.wanted_by, due, today }))} We’ll email you when the first version is ready for your review.`,
    body: card(request.title, [due && `Due ${formatDay(due, today)}`]),
    href: portalUrl(deliverableId),
    linkLabel: 'See it in the portal',
  }
}

export function requestDeclinedEmail({ request, company, studio, note }) {
  const subtitle = [company, studio].filter(Boolean).join(' · ')
  return {
    subject: `About your request: ${request.title}`,
    title: 'About your request',
    subtitle,
    sentence: 'thanks for sending this over. We can’t take it on as it stands, and wanted you to hear that from us straight away. Our note is below.',
    body: card(request.title, [], note),
    href: portalUrl(),
    linkLabel: 'Open the portal',
  }
}

const BUILD = {
  received: { kind: 'request_received', status: 'new', build: requestReceivedEmail },
  accepted: { kind: 'request_accepted', status: 'accepted', build: requestAcceptedEmail },
  declined: { kind: 'request_declined', status: 'declined', build: requestDeclinedEmail },
}

// A signed-in client's address and first name, from Clerk.
async function clerkContact(clerkId) {
  const user = await createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }).users.getUser(clerkId)
  return {
    email: user.primaryEmailAddress?.emailAddress ?? user.emailAddresses?.[0]?.emailAddress ?? null,
    first: user.firstName || null,
    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
  }
}

// Tells the person who sent a request how it stands. `stage` is 'received',
// 'accepted' or 'declined' and must match the request's status, so a stale call
// can't send the wrong email. Never throws.
//   → { sent: true } | { skipped: 'link' | 'no_address' | 'stage' | 'not_found' | 'not_sent' | 'error' }
export async function emailRequestUpdate(sql, { requestId, stage, lookup = clerkContact }) {
  try {
    const plan = BUILD[stage]
    if (!plan) throw new Error(`Unknown request email stage: ${stage}`)
    const [r] = await sql`
      SELECT r.id, r.title, r.wanted_by::text AS wanted_by, r.status, r.decline_note, r.submitted_by, r.submitted_via,
             r.deliverable_id, d.due_date::text AS due_date, d.client_visible,
             COALESCE(c.name, p.name) AS company,
             (SELECT s.company_name FROM settings s WHERE s.user_id = r.user_id LIMIT 1) AS studio
      FROM requests r
      LEFT JOIN deliverables d ON d.id = r.deliverable_id
      LEFT JOIN companies c ON c.id = r.company_id
      LEFT JOIN projects p ON p.id = r.project_id
      WHERE r.id = ${requestId}`
    if (!r) return { skipped: 'not_found' }
    if (r.status !== plan.status) return { skipped: 'stage' }
    if (r.submitted_via !== 'login' || !r.submitted_by) return { skipped: 'link' }

    const person = await lookup(r.submitted_by)
    if (!person?.email) return { skipped: 'no_address' }

    const request = { title: r.title, wanted_by: r.wanted_by }
    const mail = plan.build({
      request, company: r.company, studio: r.studio,
      // Only a date the client can see is one we can quote.
      ...(stage === 'accepted' ? { deliverableId: r.client_visible ? r.deliverable_id : null, due: r.client_visible ? r.due_date : null } : {}),
      ...(stage === 'declined' ? { note: r.decline_note } : {}),
    })
    const [out] = await notify(sql, {
      kind: plan.kind, to: { email: person.email, name: person.name }, subject: mail.subject,
      html: wrap({
        title: mail.title, subtitle: mail.subtitle, greeting: `Hi ${escapeHtml(person.first || 'there')}, ${mail.sentence}`,
        bodyHtml: mail.body, href: mail.href, linkLabel: mail.linkLabel,
      }),
    })
    return out?.sent ? { sent: true } : { skipped: 'not_sent' }
  } catch (err) {
    console.error('[request-mail] could not email the client:', err?.message)
    return { skipped: 'error' }
  }
}
