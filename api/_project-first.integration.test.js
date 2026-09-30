// What drizzle/0037 lets the database allow and refuse: a worklist that belongs
// to a project with no company, requests that belong to a project, and a
// project that can't be deleted out from under its worklist. Runs against a
// real Postgres; skipped unless SLATE_TEST_DATABASE_URL is set (_test-db.js).

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { TEST_DB, connectTestDb } from './_test-db.js'

const describeDb = TEST_DB ? describe : describe.skip
let sql, project, company
const WS = 'pf_ws'

const fails = async (query, pattern) => {
  let err
  try { await query } catch (e) { err = e }
  expect(err, 'the statement should have been refused').toBeTruthy()
  expect(String(err.message)).toMatch(pattern)
}

describeDb('project-first worklists', () => {
  beforeAll(async () => { sql = await connectTestDb() })
  afterAll(async () => { await clear(); await sql.end() })
  beforeEach(async () => {
    await clear()
    ;[company] = await sql`INSERT INTO companies (user_id, name) VALUES (${WS}, 'PF Co') RETURNING id`
    ;[project] = await sql`INSERT INTO projects (user_id, name) VALUES (${WS}, 'PF Project') RETURNING id`
  })
  async function clear() {
    await sql`DELETE FROM requests WHERE user_id = ${WS}`
    await sql`DELETE FROM workstreams WHERE user_id = ${WS}`
    await sql`DELETE FROM projects WHERE user_id = ${WS}`
    await sql`DELETE FROM companies WHERE user_id = ${WS}`
  }

  it('lets a project with no company have a workstream', async () => {
    const [w] = await sql`INSERT INTO workstreams (user_id, project_id, title) VALUES (${WS}, ${project.id}, 'Edit days') RETURNING company_id`
    expect(w.company_id).toBeNull()
  })

  it('still lets a company-only workstream stand (existing rows)', async () => {
    await sql`INSERT INTO workstreams (user_id, company_id, title) VALUES (${WS}, ${company.id}, 'Legacy')`
  })

  it('refuses a workstream with neither a company nor a project', async () => {
    await fails(sql`INSERT INTO workstreams (user_id, title) VALUES (${WS}, 'Nowhere')`, /workstreams_owner_chk/)
  })

  it('refuses to delete a project that has a worklist, and allows it once the worklist is gone', async () => {
    const [w] = await sql`INSERT INTO workstreams (user_id, project_id, title) VALUES (${WS}, ${project.id}, 'Edit days') RETURNING id`
    await fails(sql`DELETE FROM projects WHERE id = ${project.id}`, /workstreams_project_id_projects_id_fk/)
    await sql`DELETE FROM workstreams WHERE id = ${w.id}`
    await sql`DELETE FROM projects WHERE id = ${project.id}`
  })

  it('takes a request for a project with no company, marked as sent via link', async () => {
    const [r] = await sql`
      INSERT INTO requests (user_id, project_id, title, submitted_via, submitted_by_name)
      VALUES (${WS}, ${project.id}, 'A cutdown', 'link', 'Sam (unverified)') RETURNING company_id, submitted_via`
    expect(r).toEqual({ company_id: null, submitted_via: 'link' })
  })

  it('defaults a request to signed-in, and refuses an unknown source or no home', async () => {
    const [r] = await sql`INSERT INTO requests (user_id, company_id, title) VALUES (${WS}, ${company.id}, 'x') RETURNING submitted_via`
    expect(r.submitted_via).toBe('login')
    await fails(sql`INSERT INTO requests (user_id, company_id, title, submitted_via) VALUES (${WS}, ${company.id}, 'x', 'carrier-pigeon')`, /requests_source_chk/)
    await fails(sql`INSERT INTO requests (user_id, title) VALUES (${WS}, 'homeless')`, /requests_owner_chk/)
  })

  it('removes a project\'s requests with it', async () => {
    await sql`INSERT INTO requests (user_id, project_id, title, submitted_via) VALUES (${WS}, ${project.id}, 'x', 'link')`
    await sql`DELETE FROM projects WHERE id = ${project.id}`
    const left = await sql`SELECT id FROM requests WHERE user_id = ${WS}`
    expect(left).toHaveLength(0)
  })

  it('gives a company a type that must be one of the list, and a settings toggle that starts off', async () => {
    const [c] = await sql`SELECT type, type_reviewed FROM companies WHERE id = ${company.id}`
    expect(c).toEqual({ type: 'client', type_reviewed: false })
    await fails(sql`UPDATE companies SET type = 'brand' WHERE id = ${company.id}`, /companies_type_chk/)
    const [s] = await sql`SELECT column_default FROM information_schema.columns WHERE table_name = 'settings' AND column_name = 'show_leads'`
    expect(s.column_default).toBe('false')
  })

  it('keeps extra portal addresses on the project, empty by default', async () => {
    const [p] = await sql`SELECT portal_emails FROM projects WHERE id = ${project.id}`
    expect(p.portal_emails).toEqual([])
  })
})
