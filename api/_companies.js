// api/_companies.js
// Routes behind /api/companies (see companies.js). Companies are new data, so
// the browser reaches them only through here, never through db/client.js.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { UUID, fail, invalid, readBody, workspaceId } from './_api.js'
import { isUuid } from './_retainer-rules.js'
import { PORTAL_ROUTES } from './_portal-access.js'
import { leadsShown } from './_leads.js'

export const NAME_MAX = 200

// Trim and collapse runs of whitespace, so "DMM " and "DMM" are one company.
// Case is kept as first typed; matching ignores it (companies_name_uidx is on
// lower(name)).
export function normaliseCompanyName(raw) {
  if (typeof raw !== 'string') return null
  const name = raw.replace(/\s+/g, ' ').trim()
  return name || null
}

export const ROUTES = [
  { method: 'GET',  pattern: /^companies$/, handler: listCompanies },
  { method: 'POST', pattern: /^companies$/, handler: findOrCreateCompany, access: 'editor' },
  { method: 'PATCH', pattern: new RegExp(`^companies/(?<id>${UUID})$`), handler: updateCompany, access: 'editor' },
  // A company's client portal access (superadmin): _portal-access.js.
  ...PORTAL_ROUTES,
]

// ── GET /api/companies ───────────────────────────────────────────────────────
// Every company, for the company field's suggestions. There are few enough to
// send them all rather than search server-side.
async function listCompanies(req, res, { sql }) {
  const ws = await workspaceId(sql)
  const companies = await sql`
    SELECT id, name, clerk_org_id, lead_id, created_at, updated_at
    FROM companies
    WHERE user_id = ${ws}
    ORDER BY lower(name)
  `
  return res.status(200).json({ companies })
}

// ── POST /api/companies ──────────────────────────────────────────────────────
// { name } → the existing company with that name (ignoring case), or a new one.
// This is what makes the company field feel like free text: whatever is typed
// resolves to exactly one company.
async function findOrCreateCompany(req, res, { sql, user }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')

  const name = normaliseCompanyName(body.name)
  if (!name) return invalid(res, 'name', 'Company name cannot be empty')
  if (name.length > NAME_MAX) return invalid(res, 'name', `Company name is over ${NAME_MAX} characters`)

  const ws = await workspaceId(sql)

  // The unique index makes match-or-create one race-free step: two people
  // saving the same new name at once still end up with one company. While
  // leads are switched on a new company's lead is whoever created it, so none
  // starts without one; with them off it isn't given one (api/_leads.js).
  const leadId = (await leadsShown(sql)) ? user.id : null
  const [created] = await sql`
    INSERT INTO companies (user_id, name, lead_id) VALUES (${ws}, ${name}, ${leadId})
    ON CONFLICT (user_id, lower(name)) DO NOTHING
    RETURNING id, name, clerk_org_id, lead_id, created_at, updated_at
  `
  if (created) return res.status(201).json({ company: created, created: true })

  const [existing] = await sql`
    SELECT id, name, clerk_org_id, lead_id, created_at, updated_at
    FROM companies
    WHERE user_id = ${ws} AND lower(name) = lower(${name})
    LIMIT 1
  `
  // Only reachable if the conflicting row vanished between the two statements.
  if (!existing) return fail(res, 409, 'conflict', 'That company changed while saving — try again')
  return res.status(200).json({ company: existing, created: false })
}

// ── PATCH /api/companies/:id ─────────────────────────────────────────────────
// { lead_id } — who hears about this company's work when a deliverable has no
// owner. It has to be a Slate user, and it can't be cleared: a lead is always
// set once someone has set it.
async function updateCompany(req, res, { sql, params }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  if (!isUuid(body.lead_id)) return invalid(res, 'lead_id', 'Choose who leads this company')

  const ws = await workspaceId(sql)
  const [lead] = await sql`SELECT id FROM app_users WHERE id = ${body.lead_id}`
  if (!lead) return invalid(res, 'lead_id', 'Choose someone on the team')

  const [company] = await sql`
    UPDATE companies SET lead_id = ${lead.id}, updated_at = NOW()
    WHERE id = ${params.id} AND user_id = ${ws}
    RETURNING id, name, clerk_org_id, lead_id, created_at, updated_at
  `
  if (!company) return fail(res, 404, 'not_found', 'Company not found')
  return res.status(200).json({ company })
}
