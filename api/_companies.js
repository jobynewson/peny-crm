// api/_companies.js
// Routes behind /api/companies (see companies.js). Companies are new data, so
// the browser reaches them only through here, never through db/client.js.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { UUID, fail, invalid, readBody, workspaceId } from './_api.js'
import { isUuid, validateCompanyType, COMPANY_TYPES } from './_retainer-rules.js'
import { PORTAL_ROUTES } from './_portal-access.js'
import { createClerkClient } from '@clerk/backend'
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
  { method: 'GET',  pattern: new RegExp(`^companies/(?<id>${UUID})/impact$`), handler: companyImpact },
  { method: 'DELETE', pattern: new RegExp(`^companies/(?<id>${UUID})$`), handler: deleteCompany, access: 'editor' },
  // A company's client portal access (superadmin): _portal-access.js.
  ...PORTAL_ROUTES,
]

// ── GET /api/companies ───────────────────────────────────────────────────────
// Every company, for the company field's suggestions. There are few enough to
// send them all rather than search server-side.
async function listCompanies(req, res, { sql }) {
  const ws = await workspaceId(sql)
  const companies = await sql`
    SELECT id, name, clerk_org_id, lead_id, type, sector, type_reviewed, created_at, updated_at
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
  // A type chosen when making it counts as confirmed; otherwise it starts as a
  // Client, unconfirmed, for someone to check.
  const chosen = body.type === undefined ? null : body.type
  if (chosen !== null && !COMPANY_TYPES.includes(chosen)) return invalid(res, 'type', 'Choose what kind of company this is')
  const [created] = await sql`
    INSERT INTO companies (user_id, name, lead_id, type, type_reviewed)
    VALUES (${ws}, ${name}, ${leadId}, ${chosen ?? 'client'}, ${chosen !== null})
    ON CONFLICT (user_id, lower(name)) DO NOTHING
    RETURNING id, name, clerk_org_id, lead_id, type, sector, type_reviewed, created_at, updated_at
  `
  if (created) return res.status(201).json({ company: created, created: true })

  const [existing] = await sql`
    SELECT id, name, clerk_org_id, lead_id, type, sector, type_reviewed, created_at, updated_at
    FROM companies
    WHERE user_id = ${ws} AND lower(name) = lower(${name})
    LIMIT 1
  `
  // Only reachable if the conflicting row vanished between the two statements.
  if (!existing) return fail(res, 409, 'conflict', 'That company changed while saving — try again')
  return res.status(200).json({ company: existing, created: false })
}

// ── PATCH /api/companies/:id ─────────────────────────────────────────────────
// Either or both of:
//   { lead_id }        who hears about this company's work when a deliverable
//                      has no owner. A Slate user; can't be cleared once set.
//   { type, sector? }  what kind of company it is (client, prospect,
//                      subcontractor, supplier, other) and an optional sector
//                      ("Sport", "NGO"). Setting the type confirms it.
//   { name }           rename it. Another company can't already have the name
//                      (ignoring case); the typed company on its people follows.
// Only what is sent is written.
async function updateCompany(req, res, { sql, params }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  const setsLead = Object.prototype.hasOwnProperty.call(body, 'lead_id')
  const setsType = Object.prototype.hasOwnProperty.call(body, 'type') || Object.prototype.hasOwnProperty.call(body, 'sector')
  const setsName = Object.prototype.hasOwnProperty.call(body, 'name')
  if (!setsLead && !setsType && !setsName) return invalid(res, 'body', 'Nothing to change')

  const name = setsName ? normaliseCompanyName(body.name) : null
  if (setsName) {
    if (!name) return invalid(res, 'name', 'Company name cannot be empty')
    if (name.length > NAME_MAX) return invalid(res, 'name', `Company name is over ${NAME_MAX} characters`)
  }

  if (setsLead && !isUuid(body.lead_id)) return invalid(res, 'lead_id', 'Choose who leads this company')
  if (setsType) {
    const bad = validateCompanyType(body)
    if (bad) return invalid(res, bad.field, bad.message)
  }

  const ws = await workspaceId(sql)
  if (setsLead) {
    const [lead] = await sql`SELECT id FROM app_users WHERE id = ${body.lead_id}`
    if (!lead) return invalid(res, 'lead_id', 'Choose someone on the team')
  }
  const sector = typeof body.sector === 'string' && body.sector.trim() ? body.sector.trim() : null

  let company
  try {
    ;[company] = await sql`
    UPDATE companies SET
      name          = CASE WHEN ${setsName} THEN ${name} ELSE name END,
      lead_id       = CASE WHEN ${setsLead} THEN ${setsLead ? body.lead_id : null}::uuid ELSE lead_id END,
      type          = CASE WHEN ${setsType} THEN ${setsType ? body.type : null} ELSE type END,
      sector        = CASE WHEN ${setsType} THEN ${sector} ELSE sector END,
      type_reviewed = CASE WHEN ${setsType} THEN true ELSE type_reviewed END,
      updated_at    = NOW()
    WHERE id = ${params.id} AND user_id = ${ws}
    RETURNING id, name, clerk_org_id, lead_id, type, sector, type_reviewed, created_at, updated_at
  `
  } catch (err) {
    if (err?.code === '23505') return fail(res, 409, 'name_taken', 'Another company already has that name')
    throw err
  }
  if (!company) return fail(res, 404, 'not_found', 'Company not found')
  // People keep the company's name as typed text too (other pickers read it).
  if (setsName) await sql`UPDATE contacts SET company = ${company.name} WHERE company_id = ${company.id} AND user_id = ${ws}`
  return res.status(200).json({ company })
}

// What deleting a company would do, so the screen can say so before it happens.
async function impactOf(sql, ws, id) {
  const [row] = await sql`
    SELECT c.id, c.name, c.clerk_org_id,
           (SELECT count(*)::int FROM contacts WHERE company_id = c.id AND user_id = ${ws}) AS people,
           (SELECT count(*)::int FROM projects WHERE company_id = c.id AND user_id = ${ws}) AS projects,
           (SELECT count(*)::int FROM workstreams WHERE company_id = c.id) AS workstreams,
           (SELECT count(*)::int FROM requests WHERE company_id = c.id) AS requests
    FROM companies c WHERE c.id = ${id} AND c.user_id = ${ws}`
  return row ?? null
}

// ── GET /api/companies/:id/impact ────────────────────────────────────────────
// { people, projects, has_portal, blocked_by: { workstreams, requests } }.
// People and projects stay (they lose the company); a company that still has
// older company-level workstreams or requests can't be deleted.
async function companyImpact(req, res, { sql, params }) {
  const row = await impactOf(sql, await workspaceId(sql), params.id)
  if (!row) return fail(res, 404, 'not_found', 'Company not found')
  return res.status(200).json({
    name: row.name, people: row.people, projects: row.projects, has_portal: !!row.clerk_org_id,
    blocked_by: { workstreams: row.workstreams, requests: row.requests },
  })
}

// ── DELETE /api/companies/:id ────────────────────────────────────────────────
// Deletes the company and nothing else that matters: its people stay, with no
// company (the company typed on them is cleared, or the page would offer to
// make it again), and its projects stay, with no company. Refused while
// company-level workstreams or requests still belong to it. The client portal's
// Clerk organisation is deleted with it, which ends those people's access, so a
// company that has one can only be deleted by a superadmin. The database goes
// first: if it refuses, the organisation is untouched.
async function deleteCompany(req, res, { sql, user, params }) {
  const ws = await workspaceId(sql)
  const row = await impactOf(sql, ws, params.id)
  if (!row) return fail(res, 404, 'not_found', 'Company not found')
  if (row.clerk_org_id && user.role !== 'superadmin') {
    return fail(res, 403, 'forbidden', 'This company has a client portal. Only a superadmin can delete it')
  }
  if (row.workstreams || row.requests) {
    const parts = [row.workstreams ? `${row.workstreams} older workstream${row.workstreams === 1 ? '' : 's'}` : '', row.requests ? `${row.requests} client request${row.requests === 1 ? '' : 's'}` : ''].filter(Boolean)
    return fail(res, 409, 'company_in_use', `${row.name} still has ${parts.join(' and ')}. Attach the workstreams to a project and clear the requests first`)
  }

  try {
    await sql`UPDATE contacts SET company = '' WHERE company_id = ${params.id} AND user_id = ${ws}`
    await sql`DELETE FROM companies WHERE id = ${params.id} AND user_id = ${ws}`
  } catch (err) {
    if (err?.code === '23503') return fail(res, 409, 'company_in_use', `${row.name} is still in use. Try again in a moment`)
    throw err
  }

  let portalLeft = false
  if (row.clerk_org_id) {
    try { await createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }).organizations.deleteOrganization(row.clerk_org_id) }
    catch (err) {
      if (err?.status !== 404) { portalLeft = true; console.error('[companies] deleted a company but could not delete its Clerk organisation', row.clerk_org_id, err?.message) }
    }
  }
  return res.status(200).json({ deleted: true, people: row.people, projects: row.projects, portal_left: portalLeft })
}
