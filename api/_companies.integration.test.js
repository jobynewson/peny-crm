// Runs /api/companies against a real Postgres. Skipped unless
// SLATE_TEST_DATABASE_URL is set — see _test-db.js for setup.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { TEST_DB, connectTestDb, fakeRes, setShowLeads } from './_test-db.js'

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
const call = async (method, body, id = null) => {
  const res = fakeRes()
  const route = id ? `companies/${id}` : 'companies'
  await dispatch({ method, url: `/api/${route}`, query: { route }, body, headers: {} }, res, { name: 'companies', routes: ROUTES, sql })
  return res
}
let ana, bea

describeDb('companies', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    await sql`DELETE FROM companies`
    await sql`DELETE FROM app_users WHERE clerk_id IN ('co_ana', 'co_bea')`
    ;[ana] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('co_ana', 'ana@co.test', 'Ana', 'user') RETURNING id`
    ;[bea] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('co_bea', 'bea@co.test', 'Bea', 'user') RETURNING id`
  })
  afterAll(async () => {
    await sql`DELETE FROM companies`
    await sql`DELETE FROM app_users WHERE clerk_id IN ('co_ana', 'co_bea')`
  })
  beforeEach(async () => {
    // Worklists and requests hold on to their company (ON DELETE RESTRICT).
    await sql`DELETE FROM requests`
    await sql`DELETE FROM workstreams`
    await sql`UPDATE contacts SET company_id = NULL`
    await sql`UPDATE projects SET company_id = NULL`
    await sql`DELETE FROM companies`
    CURRENT = { id: ana.id, role: 'user' }
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
    CURRENT = { id: ana.id, role: 'viewer' }
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

  describe('the lead', () => {
    beforeEach(() => setShowLeads(sql, true))
    afterAll(() => setShowLeads(sql, false))

    it('with leads hidden, a new company is not given one', async () => {
      await setShowLeads(sql, false)
      const a = await call('POST', { name: 'Unled Ltd' })
      expect(a.body.company.lead_id).toBeNull()
      await setShowLeads(sql, true)
      const b = await call('POST', { name: 'Led Again Ltd' })
      expect(b.body.company.lead_id).toBe(ana.id)
    })

    it('a new company starts led by whoever created it, and matching it changes nothing', async () => {
      const a = await call('POST', { name: 'Led Ltd' })
      expect(a.body.company.lead_id).toBe(ana.id)
      CURRENT = { id: bea.id, role: 'user' }
      const b = await call('POST', { name: 'led ltd' })
      expect(b.body.company.lead_id).toBe(ana.id)
    })

    it('an editor sets the lead to a Slate user, and it is listed', async () => {
      const { body } = await call('POST', { name: 'Led Ltd' })
      const r = await call('PATCH', { lead_id: bea.id }, body.company.id)
      expect(r.statusCode).toBe(200)
      expect(r.body.company.lead_id).toBe(bea.id)
      const list = await call('GET')
      expect(list.body.companies[0].lead_id).toBe(bea.id)
    })

    it('cannot be cleared, or set to someone who is not a Slate user', async () => {
      const { body } = await call('POST', { name: 'Led Ltd' })
      for (const lead_id of [null, '', 'nope', '00000000-0000-4000-8000-000000000000']) {
        const r = await call('PATCH', { lead_id }, body.company.id)
        expect(r.statusCode, String(lead_id)).toBe(422)
        expect(r.body.error.field).toBe('lead_id')
      }
      const [{ lead_id }] = await sql`SELECT lead_id FROM companies WHERE id = ${body.company.id}`
      expect(lead_id).toBe(ana.id)
    })

    it('404s another company, and a viewer cannot change it', async () => {
      const { body } = await call('POST', { name: 'Led Ltd' })
      expect((await call('PATCH', { lead_id: bea.id }, '11111111-1111-4111-8111-111111111111')).statusCode).toBe(404)
      CURRENT = { id: ana.id, role: 'viewer' }
      expect((await call('PATCH', { lead_id: bea.id }, body.company.id)).statusCode).toBe(403)
    })

    it('the database refuses to delete a user who leads a company', async () => {
      await call('POST', { name: 'Led Ltd' })
      await expect(sql`DELETE FROM app_users WHERE id = ${ana.id}`).rejects.toMatchObject({ code: '23503' })
    })
  })
})
