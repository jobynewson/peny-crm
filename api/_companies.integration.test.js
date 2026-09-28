// Runs /api/companies against a real Postgres. Skipped unless
// SLATE_TEST_DATABASE_URL is set — see _test-db.js for setup.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { TEST_DB, connectTestDb, fakeRes } from './_test-db.js'

let CURRENT = null
vi.mock('./_auth.js', () => ({
  verifyClerkUser: async () => (CURRENT
    ? { user: CURRENT }
    : { error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }),
}))

const { dispatch } = await import('./_api.js')
const { ROUTES } = await import('./_companies.js')

const describeDb = TEST_DB ? describe : describe.skip
let sql
const call = async (method, body) => {
  const res = fakeRes()
  await dispatch({ method, url: '/api/companies', query: {}, body, headers: {} }, res, { name: 'companies', routes: ROUTES, sql })
  return res
}

describeDb('companies', () => {
  beforeAll(async () => { sql = await connectTestDb() })
  beforeEach(async () => {
    // Worklists and requests hold on to their company (ON DELETE RESTRICT).
    await sql`DELETE FROM requests`
    await sql`DELETE FROM workstreams`
    await sql`UPDATE contacts SET company_id = NULL`
    await sql`UPDATE projects SET company_id = NULL`
    await sql`DELETE FROM companies`
    CURRENT = { id: 'x', role: 'user' }
  })

  it('creates a company, then matches it ignoring case and spacing', async () => {
    const a = await call('POST', { name: 'Kinetic  Brand Co.' })
    expect(a.statusCode).toBe(201)
    expect(a.body).toMatchObject({ created: true, company: { name: 'Kinetic Brand Co.' } })

    const b = await call('POST', { name: ' kinetic brand co. ' })
    expect(b.statusCode).toBe(200)
    expect(b.body.created).toBe(false)
    expect(b.body.company.id).toBe(a.body.company.id)
    expect(b.body.company.name).toBe('Kinetic Brand Co.')   // first spelling wins
  })

  it('makes one company when two saves race', async () => {
    const [a, b] = await Promise.all([call('POST', { name: 'DMM' }), call('POST', { name: 'dmm' })])
    expect(a.body.company.id).toBe(b.body.company.id)
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM companies`
    expect(count).toBe(1)
  })

  it('lists companies alphabetically, ignoring case', async () => {
    await call('POST', { name: 'beta' })
    await call('POST', { name: 'Alpha' })
    const r = await call('GET')
    expect(r.body.companies.map(c => c.name)).toEqual(['Alpha', 'beta'])
  })

  it('422s a blank name and 403s a viewer', async () => {
    const blank = await call('POST', { name: '   ' })
    expect(blank.statusCode).toBe(422)
    expect(blank.body.error.field).toBe('name')
    CURRENT = { id: 'v', role: 'viewer' }
    expect((await call('POST', { name: 'Nope' })).statusCode).toBe(403)
  })

  it('unlinks contacts and projects when a company is deleted', async () => {
    const { body } = await call('POST', { name: 'Gone Ltd' })
    const [ws] = await sql`SELECT owner_id FROM workspace LIMIT 1`
    const [c] = await sql`
      INSERT INTO contacts (user_id, first_name, last_name, company, company_id)
      VALUES (${ws.owner_id}, 'Sam', 'Lee', 'Gone Ltd', ${body.company.id}) RETURNING id
    `
    await sql`DELETE FROM companies WHERE id = ${body.company.id}`
    const [after] = await sql`SELECT company_id, company FROM contacts WHERE id = ${c.id}`
    expect(after).toEqual({ company_id: null, company: 'Gone Ltd' })
    await sql`DELETE FROM contacts WHERE id = ${c.id}`
  })
})
