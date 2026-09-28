// api/_companies.js
// Routes behind /api/companies (see companies.js). Companies are new data, so
// the browser reaches them only through here, never through db/client.js.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { fail, invalid, readBody, workspaceId } from './_api.js'

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
]

// ── GET /api/companies ───────────────────────────────────────────────────────
// Every company, for the company field's suggestions. There are few enough to
// send them all rather than search server-side.
async function listCompanies(req, res, { sql }) {
  const ws = await workspaceId(sql)
  const companies = await sql`
    SELECT id, name, clerk_org_id, created_at, updated_at
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
async function findOrCreateCompany(req, res, { sql }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')

  const name = normaliseCompanyName(body.name)
  if (!name) return invalid(res, 'name', 'Company name cannot be empty')
  if (name.length > NAME_MAX) return invalid(res, 'name', `Company name is over ${NAME_MAX} characters`)

  const ws = await workspaceId(sql)

  // The unique index makes match-or-create one race-free step: two people
  // saving the same new name at once still end up with one company.
  const [created] = await sql`
    INSERT INTO companies (user_id, name) VALUES (${ws}, ${name})
    ON CONFLICT (user_id, lower(name)) DO NOTHING
    RETURNING id, name, clerk_org_id, created_at, updated_at
  `
  if (created) return res.status(201).json({ company: created, created: true })

  const [existing] = await sql`
    SELECT id, name, clerk_org_id, created_at, updated_at
    FROM companies
    WHERE user_id = ${ws} AND lower(name) = lower(${name})
    LIMIT 1
  `
  // Only reachable if the conflicting row vanished between the two statements.
  if (!existing) return fail(res, 409, 'conflict', 'That company changed while saving — try again')
  return res.status(200).json({ company: existing, created: false })
}
