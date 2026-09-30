// Renaming and deleting a company, against a real Postgres (skipped unless
// SLATE_TEST_DATABASE_URL is set): what happens to its people and projects, what
// blocks it, and that its client portal's Clerk organisation goes with it.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { TEST_DB, connectTestDb, fakeRes } from './_test-db.js'

let CURRENT = null
vi.mock('./_auth.js', () => ({
  verifyClerkUser: async () => (CURRENT
    ? { user: CURRENT }
    : { error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }),
}))
const clerk = { deleted: [], fail: null }
vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({ organizations: { deleteOrganization: async id => {
    if (clerk.fail) throw clerk.fail
    clerk.deleted.push(id)
  } } }),
}))

const { dispatch, workspaceId } = await import('./_api.js')
const { ROUTES } = await import('./_companies.js')

const describeDb = TEST_DB ? describe : describe.skip
let sql, ws, boss, ana
const call = async (method, route, body) => {
  const res = fakeRes()
  await dispatch({ method, url: `/api/${route}`, query: { route }, body, headers: {} }, res, { name: 'companies', routes: ROUTES, sql })
  return res
}
const staff = u => ({ id: u.id, clerk_id: u.clerk_id, role: u.role, name: u.name, email: u.email })
const company = async (name, extra = {}) =>
  (await sql`INSERT INTO companies (user_id, name, clerk_org_id) VALUES (${ws}, ${name}, ${extra.org ?? null}) RETURNING id`)[0]
const person = async (company_id, last = 'CDLee', typed = 'CD Co') =>
  (await sql`INSERT INTO contacts (user_id, first_name, last_name, company, company_id) VALUES (${ws}, 'Sam', ${last}, ${typed}, ${company_id}) RETURNING id`)[0]

async function wipe() {
  await sql`DELETE FROM requests WHERE user_id = ${ws}`
  await sql`DELETE FROM workstreams WHERE user_id = ${ws} AND title LIKE 'CD %'`
  await sql`DELETE FROM contacts WHERE last_name LIKE 'CDLee%'`
  await sql`DELETE FROM projects WHERE user_id = ${ws} AND name LIKE 'CD %'`
  await sql`DELETE FROM companies WHERE name LIKE 'CD %'`
}

describeDb('renaming and deleting a company', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    await sql`INSERT INTO workspace (owner_id) SELECT 'user_cd_ws' WHERE NOT EXISTS (SELECT 1 FROM workspace)`
    ws = await workspaceId(sql)
    await sql`DELETE FROM app_users WHERE clerk_id IN ('cd_boss', 'cd_ana')`
    ;[boss] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('cd_boss', 'boss@cd.test', 'Boss', 'superadmin') RETURNING id, clerk_id, email, name, role`
    ;[ana] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('cd_ana', 'ana@cd.test', 'Ana', 'user') RETURNING id, clerk_id, email, name, role`
    await wipe()
  })
  afterAll(async () => {
    await wipe()
    await sql`DELETE FROM app_users WHERE clerk_id IN ('cd_boss', 'cd_ana')`
    await sql.end()
  })
  beforeEach(async () => { CURRENT = staff(ana); clerk.deleted = []; clerk.fail = null; await wipe() })

  it('renames a company, and the typed company on its people follows', async () => {
    const c = await company('CD Old')
    const p = await person(c.id, 'CDLee', 'CD Old')
    const r = await call('PATCH', `companies/${c.id}`, { name: '  CD   New ' })
    expect(r.statusCode).toBe(200)
    expect(r.body.company.name).toBe('CD New')
    expect((await sql`SELECT company FROM contacts WHERE id = ${p.id}`)[0].company).toBe('CD New')
  })

  it('will not rename onto another company\'s name (ignoring case), or to nothing', async () => {
    const c = await company('CD One'); await company('CD Two')
    const clash = await call('PATCH', `companies/${c.id}`, { name: 'cd two' })
    expect([clash.statusCode, clash.body.error.code]).toEqual([409, 'name_taken'])
    expect((await call('PATCH', `companies/${c.id}`, { name: '   ' })).body.error.field).toBe('name')
    expect((await call('PATCH', `companies/${c.id}`, { name: 'CD One' })).statusCode).toBe(200)   // its own name is fine
  })

  it('says what deleting would do before anything happens', async () => {
    const c = await company('CD Impact', { org: 'org_cd' })
    await person(c.id); await person(c.id, 'CDLee2')
    await sql`INSERT INTO projects (user_id, name, company_id) VALUES (${ws}, 'CD Film', ${c.id})`
    const r = await call('GET', `companies/${c.id}/impact`)
    expect(r.body).toEqual({ name: 'CD Impact', people: 2, projects: 1, has_portal: true, blocked_by: { workstreams: 0, requests: 0 } })
  })

  it('deletes it, keeping its people and projects with no company, and clearing the typed name on the people', async () => {
    const c = await company('CD Gone')
    const p = await person(c.id, 'CDLee', 'CD Gone')
    const [proj] = await sql`INSERT INTO projects (user_id, name, company_id) VALUES (${ws}, 'CD Film', ${c.id}) RETURNING id`
    const r = await call('DELETE', `companies/${c.id}`)
    expect(r.body).toEqual({ deleted: true, people: 1, projects: 1, portal_left: false })
    expect(await sql`SELECT 1 FROM companies WHERE id = ${c.id}`).toHaveLength(0)
    expect((await sql`SELECT company_id, company FROM contacts WHERE id = ${p.id}`)[0]).toEqual({ company_id: null, company: '' })
    expect((await sql`SELECT company_id FROM projects WHERE id = ${proj.id}`)[0].company_id).toBeNull()
    expect(clerk.deleted).toEqual([])
  })

  it('refuses while older workstreams or client requests still belong to it, and changes nothing', async () => {
    const c = await company('CD Busy')
    const p = await person(c.id)
    await sql`INSERT INTO workstreams (user_id, company_id, title) VALUES (${ws}, ${c.id}, 'CD Old stream')`
    const r = await call('DELETE', `companies/${c.id}`)
    expect([r.statusCode, r.body.error.code]).toEqual([409, 'company_in_use'])
    expect(r.body.error.message).toContain('1 older workstream')
    expect((await sql`SELECT company_id FROM contacts WHERE id = ${p.id}`)[0].company_id).toBe(c.id)
    expect((await call('GET', `companies/${c.id}/impact`)).body.blocked_by.workstreams).toBe(1)
  })

  it('deletes the client portal\'s Clerk organisation too, but only for a superadmin', async () => {
    const c = await company('CD Portal', { org: 'org_cd_portal' })
    const refused = await call('DELETE', `companies/${c.id}`)
    expect(refused.statusCode).toBe(403)
    expect(await sql`SELECT 1 FROM companies WHERE id = ${c.id}`).toHaveLength(1)
    expect(clerk.deleted).toEqual([])
    CURRENT = staff(boss)
    const r = await call('DELETE', `companies/${c.id}`)
    expect(r.statusCode).toBe(200)
    expect(clerk.deleted).toEqual(['org_cd_portal'])
  })

  it('still deletes the company if Clerk is down, and says the organisation is left', async () => {
    const c = await company('CD Outage', { org: 'org_cd_outage' })
    CURRENT = staff(boss)
    clerk.fail = Object.assign(new Error('down'), { status: 503 })
    const r = await call('DELETE', `companies/${c.id}`)
    expect(r.statusCode).toBe(200)
    expect(r.body.portal_left).toBe(true)
    expect(await sql`SELECT 1 FROM companies WHERE id = ${c.id}`).toHaveLength(0)
  })

  it('404s a stranger, and a viewer cannot delete', async () => {
    const c = await company('CD Viewer')
    expect((await call('DELETE', 'companies/11111111-1111-4111-8111-111111111111')).statusCode).toBe(404)
    CURRENT = { ...staff(ana), role: 'viewer' }
    expect((await call('DELETE', `companies/${c.id}`)).statusCode).toBe(403)
  })
})
