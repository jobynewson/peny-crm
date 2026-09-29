// api/_portal-access.js
// Portal access for a company: the Clerk organisation its client users belong
// to, who is in it and who has been invited. Superadmins only. The routes are
// part of /api/companies (merged into _companies.js's table):
//   GET    companies/:id/portal                            → { portal: null | { members, invitations }, invites_enabled }
//   POST   companies/:id/portal                            set it up: a Clerk organisation for the company
//   POST   companies/:id/portal/invitations                { email } → invited as org:member, lands on /portal
//   DELETE companies/:id/portal/invitations/:invitationId  revoke a pending invitation
//   DELETE companies/:id/portal/members/:userId            remove someone from the portal
//
// The organisation is always the one stored on the company
// (companies.clerk_org_id), never one named in the request — and that link is
// what the portal later scopes every query by. Staff are never members: the
// organisation is created with no one in it, and a Slate user's email can't be
// invited (a member of an organisation lands on the portal, not in Slate).
//
// Invitations are refused unless PORTAL_INVITES_ENABLED is 'true'. The browser
// still holds the database credential (see claude.md), so no client may get a
// login until the query-proxy fix is live; the switch makes that a setting
// rather than something to remember.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { createClerkClient } from '@clerk/backend'
import { UUID, fail, invalid, readBody, workspaceId } from './_api.js'
import { appBaseUrl } from './_task-mail.js'

const CLERK_ID = '[A-Za-z0-9_]{1,64}'
const PORTAL = `^companies/(?<id>${UUID})/portal`

export const PORTAL_ROUTES = [
  { method: 'GET',    pattern: new RegExp(`${PORTAL}$`),                                              handler: getPortal,        access: 'superadmin' },
  { method: 'POST',   pattern: new RegExp(`${PORTAL}$`),                                              handler: setUpPortal,      access: 'superadmin' },
  { method: 'POST',   pattern: new RegExp(`${PORTAL}/invitations$`),                                  handler: invite,           access: 'superadmin' },
  { method: 'DELETE', pattern: new RegExp(`${PORTAL}/invitations/(?<invitationId>${CLERK_ID})$`),     handler: revokeInvitation, access: 'superadmin' },
  { method: 'DELETE', pattern: new RegExp(`${PORTAL}/members/(?<userId>${CLERK_ID})$`),               handler: removeMember,     access: 'superadmin' },
]

export const invitesEnabled = () => process.env.PORTAL_INVITES_ENABLED === 'true'
const clerk = () => createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const toIso = ms => (ms ? new Date(ms).toISOString() : null)

async function loadCompany(sql, id) {
  const ws = await workspaceId(sql)
  const [company] = await sql`SELECT id, name, clerk_org_id FROM companies WHERE id = ${id} AND user_id = ${ws}`
  return company ?? null
}

// A Clerk failure in our error shape. Clerk's own message is kept when it's
// about the request (e.g. "already a member"); an outage is a 502.
function clerkFailure(res, err, fallback) {
  const first = err?.errors?.[0]
  console.error('[portal-access] Clerk error:', err?.status, first?.code, first?.longMessage || err?.message)
  if (err?.status === 404) return fail(res, 404, 'not_found', 'Clerk has no record of that')
  if ([400, 409, 422].includes(err?.status)) {
    return fail(res, 409, first?.code || 'clerk_refused', first?.longMessage || first?.message || fallback)
  }
  return fail(res, 502, 'clerk_unavailable', fallback)
}

async function portalState(company) {
  if (!company.clerk_org_id) return null
  const orgs = clerk().organizations
  const [members, invitations] = await Promise.all([
    orgs.getOrganizationMembershipList({ organizationId: company.clerk_org_id, limit: 100 }),
    orgs.getOrganizationInvitationList({ organizationId: company.clerk_org_id, status: ['pending'], limit: 100 }),
  ])
  return {
    members: members.data.map(m => ({
      user_id: m.publicUserData?.userId ?? null,
      name: [m.publicUserData?.firstName, m.publicUserData?.lastName].filter(Boolean).join(' ') || null,
      email: m.publicUserData?.identifier ?? null,
      joined_at: toIso(m.createdAt),
    })),
    invitations: invitations.data.map(i => ({ id: i.id, email: i.emailAddress, sent_at: toIso(i.createdAt) })),
  }
}

// ── GET companies/:id/portal ─────────────────────────────────────────────────
async function getPortal(req, res, { sql, params }) {
  const company = await loadCompany(sql, params.id)
  if (!company) return fail(res, 404, 'not_found', 'Company not found')
  try {
    return res.status(200).json({ portal: await portalState(company), invites_enabled: invitesEnabled() })
  } catch (err) {
    return clerkFailure(res, err, 'Could not reach Clerk')
  }
}

// ── POST companies/:id/portal ────────────────────────────────────────────────
// Creates the company's Clerk organisation — with nobody in it; the caller is
// not made a member — and links it. Doing it twice is harmless.
async function setUpPortal(req, res, { sql, params }) {
  const company = await loadCompany(sql, params.id)
  if (!company) return fail(res, 404, 'not_found', 'Company not found')
  if (company.clerk_org_id) {
    try { return res.status(200).json({ portal: await portalState(company), invites_enabled: invitesEnabled() }) } catch (err) { return clerkFailure(res, err, 'Could not reach Clerk') }
  }

  let org
  try {
    org = await clerk().organizations.createOrganization({ name: company.name, publicMetadata: { slate_company_id: company.id } })
  } catch (err) {
    return clerkFailure(res, err, 'Could not create the organisation in Clerk')
  }
  const [linked] = await sql`
    UPDATE companies SET clerk_org_id = ${org.id}, updated_at = NOW()
    WHERE id = ${company.id} AND clerk_org_id IS NULL
    RETURNING id
  `
  if (!linked) {
    // Someone set it up at the same moment: keep theirs, drop ours.
    await clerk().organizations.deleteOrganization(org.id).catch(err => console.error('[portal-access] could not delete a spare organisation', org.id, err?.message))
    const current = await loadCompany(sql, company.id)
    try { return res.status(200).json({ portal: await portalState(current), invites_enabled: invitesEnabled() }) } catch (err) { return clerkFailure(res, err, 'Could not reach Clerk') }
  }
  return res.status(201).json({ portal: { members: [], invitations: [] }, invites_enabled: invitesEnabled() })
}

// ── POST companies/:id/portal/invitations ────────────────────────────────────
// { email } → a Clerk invitation to the company's organisation as org:member.
// Accepting it lands on /portal.
async function invite(req, res, { sql, params }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (!EMAIL.test(email)) return invalid(res, 'email', 'Enter an email address')
  if (!invitesEnabled()) {
    return fail(res, 409, 'invites_disabled', 'Client logins stay switched off until the database access fix is live')
  }

  const company = await loadCompany(sql, params.id)
  if (!company) return fail(res, 404, 'not_found', 'Company not found')
  if (!company.clerk_org_id) return fail(res, 409, 'no_portal', 'Set up the portal first')
  const [staff] = await sql`SELECT 1 AS yes FROM app_users WHERE lower(email) = lower(${email}) LIMIT 1`
  if (staff) return invalid(res, 'email', "That's a Slate user — people at Peny can't be portal members")

  try {
    const inv = await clerk().organizations.createOrganizationInvitation({
      organizationId: company.clerk_org_id,
      emailAddress: email,
      role: 'org:member',
      redirectUrl: `${appBaseUrl()}/portal`,
      publicMetadata: { slate_company_id: company.id },
    })
    return res.status(201).json({ invitation: { id: inv.id, email: inv.emailAddress, sent_at: toIso(inv.createdAt) } })
  } catch (err) {
    return clerkFailure(res, err, 'Could not send the invitation')
  }
}

// ── DELETE companies/:id/portal/invitations/:invitationId ────────────────────
async function revokeInvitation(req, res, { sql, params }) {
  const company = await loadCompany(sql, params.id)
  if (!company?.clerk_org_id) return fail(res, 404, 'not_found', 'Company not found')
  try {
    await clerk().organizations.revokeOrganizationInvitation({ organizationId: company.clerk_org_id, invitationId: params.invitationId })
    return res.status(200).json({ ok: true })
  } catch (err) {
    return clerkFailure(res, err, 'Could not revoke the invitation')
  }
}

// ── DELETE companies/:id/portal/members/:userId ──────────────────────────────
// Their next session token no longer carries the organisation, so the portal
// stops answering them within a minute, and their unused Approve links from
// delivery emails are deleted straight away.
async function removeMember(req, res, { sql, params }) {
  const company = await loadCompany(sql, params.id)
  if (!company?.clerk_org_id) return fail(res, 404, 'not_found', 'Company not found')
  try {
    await clerk().organizations.deleteOrganizationMembership({ organizationId: company.clerk_org_id, userId: params.userId })
    // Their unused Approve links in delivery emails for this company stop
    // working with their access: a link is only as good as the person's place
    // in the portal.
    await sql`
      DELETE FROM action_links l
      USING deliveries dv, deliverables d, workstreams w
      WHERE l.clerk_user_id = ${params.userId} AND l.used_at IS NULL
        AND dv.id = l.delivery_id AND d.id = dv.deliverable_id AND w.id = d.workstream_id
        AND w.company_id = ${company.id}`
    return res.status(200).json({ ok: true })
  } catch (err) {
    return clerkFailure(res, err, 'Could not remove them')
  }
}
