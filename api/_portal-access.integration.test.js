// Runs the portal-access routes (/api/companies/:id/portal…) against a real
// Postgres with Clerk replaced by an in-memory fake. Skipped unless
// SLATE_TEST_DATABASE_URL is set — see _test-db.js.

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { TEST_DB, connectTestDb, fakeRes } from './_test-db.js'

let CURRENT = null
vi.mock('./_auth.js', () => ({
  verifyClerkUser: async () => (CURRENT ? { user: CURRENT } : { error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }),
}))

// Clerk, in memory. Records every call so the tests can see which organisation
// each one named.
const clerk = { orgs: new Map(), invitations: [], members: [], calls: [], seq: 0 }
vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({
    organizations: {
      createOrganization: async p => { clerk.calls.push(['createOrganization', p]); const id = `org_${++clerk.seq}`; clerk.orgs.set(id, p); return { id, name: p.name } },
      deleteOrganization: async id => { clerk.calls.push(['deleteOrganization', id]); clerk.orgs.delete(id); return { id } },
      getOrganizationMembershipList: async ({ organizationId }) => ({ data: clerk.members.filter(m => m.org === organizationId).map(m => ({ publicUserData: { userId: m.userId, identifier: m.email, firstName: m.first, lastName: m.last }, createdAt: 1790000000000 })) }),
      getOrganizationInvitationList: async ({ organizationId }) => ({ data: clerk.invitations.filter(i => i.organizationId === organizationId && i.status === 'pending') }),
      createOrganizationInvitation: async p => {
        clerk.calls.push(['createOrganizationInvitation', p])
        if (clerk.invitations.some(i => i.organizationId === p.organizationId && i.emailAddress === p.emailAddress && i.status === 'pending')) {
          throw Object.assign(new Error('duplicate'), { status: 400, errors: [{ code: 'duplicate_record', longMessage: 'There is already a pending invitation for this email address.' }] })
        }
        const inv = { id: `orginv_${++clerk.seq}`, ...p, status: 'pending', createdAt: 1790000000000 }
        clerk.invitations.push(inv)
        return inv
      },
      revokeOrganizationInvitation: async p => {
        clerk.calls.push(['revokeOrganizationInvitation', p])
        const inv = clerk.invitations.find(i => i.id === p.invitationId && i.organizationId === p.organizationId)
        if (!inv) throw Object.assign(new Error('not found'), { status: 404, errors: [{ code: 'resource_not_found' }] })
        inv.status = 'revoked'
        return inv
      },
      deleteOrganizationMembership: async p => {
        clerk.calls.push(['deleteOrganizationMembership', p])
        const before = clerk.members.length
        clerk.members = clerk.members.filter(m => !(m.org === p.organizationId && m.userId === p.userId))
        if (clerk.members.length === before) throw Object.assign(new Error('not found'), { status: 404, errors: [{ code: 'resource_not_found' }] })
        return {}
      },
    },
  }),
}))

const { dispatch, workspaceId } = await import('./_api.js')
const { ROUTES } = await import('./_companies.js')

const describeDb = TEST_DB ? describe : describe.skip
let sql, ws, admin, ana, company, other
const call = async (method, route, body) => {
  const res = fakeRes()
  await dispatch({ method, url: `/api/${route}`, query: { route }, body, headers: {} }, res, { name: 'companies', routes: ROUTES, sql })
  return res
}

describeDb('portal access', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    await sql`INSERT INTO workspace (owner_id) SELECT 'user_pa_ws' WHERE NOT EXISTS (SELECT 1 FROM workspace)`
    ws = await workspaceId(sql)
    await sql`DELETE FROM companies WHERE name LIKE 'PATest %'`
    await sql`DELETE FROM app_users WHERE clerk_id IN ('pa_admin', 'pa_ana')`
    ;[admin] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('pa_admin', 'boss@peny.test', 'Boss', 'superadmin') RETURNING id, clerk_id, email, name, role`
    ;[ana] = await sql`INSERT INTO app_users (clerk_id, email, name, role) VALUES ('pa_ana', 'Ana@Peny.test', 'Ana', 'user') RETURNING id, clerk_id, email, name, role`
    ;[company] = await sql`INSERT INTO companies (user_id, name) VALUES (${ws}, 'PATest DMM') RETURNING id`
    ;[other] = await sql`INSERT INTO companies (user_id, name, clerk_org_id) VALUES (${ws}, 'PATest Other', 'org_other') RETURNING id`
  })
  beforeEach(() => { CURRENT = admin; clerk.calls = []; process.env.PORTAL_INVITES_ENABLED = 'true' })
  afterAll(async () => {
    await sql`DELETE FROM companies WHERE name LIKE 'PATest %'`
    await sql`DELETE FROM app_users WHERE clerk_id IN ('pa_admin', 'pa_ana')`
    delete process.env.PORTAL_INVITES_ENABLED
    await sql.end()
  })

  it('is for superadmins only', async () => {
    CURRENT = ana
    for (const [method, route, body] of [
      ['GET', `companies/${company.id}/portal`],
      ['POST', `companies/${company.id}/portal`],
      ['POST', `companies/${company.id}/portal/invitations`, { email: 'x@client.test' }],
      ['DELETE', `companies/${company.id}/portal/invitations/orginv_1`],
      ['DELETE', `companies/${company.id}/portal/members/user_1`],
    ]) {
      const r = await call(method, route, body)
      expect([r.statusCode, r.body.error.code], `${method} ${route}`).toEqual([403, 'superadmin_only'])
    }
    expect(clerk.calls).toEqual([])
  })

  it('has no portal until it is set up — with nobody in the organisation', async () => {
    const before = await call('GET', `companies/${company.id}/portal`)
    expect(before.body).toEqual({ portal: null, invites_enabled: true })

    const up = await call('POST', `companies/${company.id}/portal`)
    expect(up.statusCode).toBe(201)
    const [created] = clerk.calls
    expect(created[0]).toBe('createOrganization')
    expect(created[1]).toMatchObject({ name: 'PATest DMM', publicMetadata: { slate_company_id: company.id } })
    expect(created[1].createdBy).toBeUndefined()   // the superadmin is not made a member
    const [row] = await sql`SELECT clerk_org_id FROM companies WHERE id = ${company.id}`
    expect(row.clerk_org_id).toMatch(/^org_/)

    const again = await call('POST', `companies/${company.id}/portal`)
    expect(again.statusCode).toBe(200)
    expect(clerk.calls.filter(c => c[0] === 'createOrganization')).toHaveLength(1)
  })

  it('invites to the company\'s own organisation, as a member, landing on /portal', async () => {
    const [{ clerk_org_id }] = await sql`SELECT clerk_org_id FROM companies WHERE id = ${company.id}`
    const r = await call('POST', `companies/${company.id}/portal/invitations`, { email: ' dana@client.test ', organizationId: 'org_other' })
    expect(r.statusCode).toBe(201)
    const [, p] = clerk.calls.find(c => c[0] === 'createOrganizationInvitation')
    expect(p).toMatchObject({ organizationId: clerk_org_id, emailAddress: 'dana@client.test', role: 'org:member' })
    expect(p.redirectUrl).toMatch(/\/portal$/)
    expect(p.inviterUserId).toBeUndefined()

    const state = await call('GET', `companies/${company.id}/portal`)
    expect(state.body.portal.invitations.map(i => i.email)).toEqual(['dana@client.test'])

    const dup = await call('POST', `companies/${company.id}/portal/invitations`, { email: 'dana@client.test' })
    expect([dup.statusCode, dup.body.error.code]).toEqual([409, 'duplicate_record'])
  })

  it('never invites someone from Peny, a bad address, or anyone while logins are switched off', async () => {
    const staff = await call('POST', `companies/${company.id}/portal/invitations`, { email: 'ana@peny.test' })
    expect([staff.statusCode, staff.body.error.field]).toEqual([422, 'email'])
    const bad = await call('POST', `companies/${company.id}/portal/invitations`, { email: 'not an email' })
    expect([bad.statusCode, bad.body.error.field]).toEqual([422, 'email'])

    process.env.PORTAL_INVITES_ENABLED = 'false'
    const off = await call('POST', `companies/${company.id}/portal/invitations`, { email: 'new@client.test' })
    expect([off.statusCode, off.body.error.code]).toEqual([409, 'invites_disabled'])
    expect((await call('GET', `companies/${company.id}/portal`)).body.invites_enabled).toBe(false)
    expect(clerk.calls.some(c => c[0] === 'createOrganizationInvitation')).toBe(false)
  })

  it('revokes and removes only within the company\'s organisation', async () => {
    const [{ clerk_org_id }] = await sql`SELECT clerk_org_id FROM companies WHERE id = ${company.id}`
    const inv = clerk.invitations.find(i => i.organizationId === clerk_org_id && i.status === 'pending')
    expect((await call('DELETE', `companies/${company.id}/portal/invitations/${inv.id}`)).statusCode).toBe(200)
    expect(inv.status).toBe('revoked')

    // Another organisation's invitation, named through this company: not found.
    clerk.invitations.push({ id: 'orginv_theirs', organizationId: 'org_other', emailAddress: 'x@other.test', status: 'pending' })
    expect((await call('DELETE', `companies/${company.id}/portal/invitations/orginv_theirs`)).statusCode).toBe(404)
    expect(clerk.invitations.find(i => i.id === 'orginv_theirs').status).toBe('pending')

    clerk.members.push({ org: clerk_org_id, userId: 'user_dana', email: 'dana@client.test', first: 'Dana', last: 'Morgan' })
    clerk.members.push({ org: 'org_other', userId: 'user_olu', email: 'olu@other.test' })
    const state = await call('GET', `companies/${company.id}/portal`)
    expect(state.body.portal.members).toEqual([{ user_id: 'user_dana', name: 'Dana Morgan', email: 'dana@client.test', joined_at: expect.any(String) }])
    expect((await call('DELETE', `companies/${company.id}/portal/members/user_olu`)).statusCode).toBe(404)
    expect((await call('DELETE', `companies/${company.id}/portal/members/user_dana`)).statusCode).toBe(200)
    expect(clerk.members.map(m => m.userId)).toEqual(['user_olu'])
  })

  it('takes away a removed person\'s unused Approve links for this company — and only theirs', async () => {
    const [{ clerk_org_id }] = await sql`SELECT clerk_org_id FROM companies WHERE id = ${company.id}`
    clerk.members.push({ org: clerk_org_id, userId: 'user_dana', email: 'dana@client.test' })
    const round = async (companyId, title) => {
      const [w] = await sql`INSERT INTO workstreams (user_id, company_id, title) VALUES (${ws}, ${companyId}, ${title}) RETURNING id`
      const [d] = await sql`INSERT INTO deliverables (workstream_id, title, status, client_visible) VALUES (${w.id}, ${title}, 'in_review', true) RETURNING id`
      const [dv] = await sql`INSERT INTO deliveries (deliverable_id, url, round) VALUES (${d.id}, 'https://f.io/x', 1) RETURNING id`
      return dv.id
    }
    const mine = await round(company.id, 'PA mine')
    const mineToo = await round(company.id, 'PA mine too')
    const theirs = await round(other.id, 'PA theirs')
    const link = (delivery, user, hash, used = false) => sql`
      INSERT INTO action_links (delivery_id, clerk_user_id, email, token_hash, expires_at, used_at)
      VALUES (${delivery}, ${user}, ${user + '@x.test'}, ${hash}, now() + interval '7 days', ${used ? new Date() : null})`
    await link(mine, 'user_dana', 'pa-hash-1')
    await link(mineToo, 'user_dana', 'pa-hash-2')
    await link(mineToo, 'user_dana', 'pa-hash-used', true)   // a spent one is history: it stays
    await link(mine, 'user_kim', 'pa-hash-kim')              // someone else in this company
    await link(theirs, 'user_dana', 'pa-hash-other-co')      // the same person, another company

    expect((await call('DELETE', `companies/${company.id}/portal/members/user_dana`)).statusCode).toBe(200)
    const left = (await sql`SELECT token_hash FROM action_links WHERE token_hash LIKE 'pa-hash-%' ORDER BY token_hash`).map(r => r.token_hash)
    expect(left).toEqual(['pa-hash-kim', 'pa-hash-other-co', 'pa-hash-used'])

    await sql`DELETE FROM workstreams WHERE title IN ('PA mine', 'PA mine too', 'PA theirs')`
  })

  it('treats a company without a portal, or another workspace\'s, as not found', async () => {
    const [bare] = await sql`INSERT INTO companies (user_id, name) VALUES (${ws}, 'PATest Bare') RETURNING id`
    expect((await call('DELETE', `companies/${bare.id}/portal/members/user_dana`)).statusCode).toBe(404)
    expect((await call('POST', `companies/${bare.id}/portal/invitations`, { email: 'a@b.test' })).body.error.code).toBe('no_portal')
    const [foreign] = await sql`INSERT INTO companies (user_id, name, clerk_org_id) VALUES ('someone_else', 'PATest Foreign', 'org_foreign') RETURNING id`
    expect((await call('GET', `companies/${foreign.id}/portal`)).statusCode).toBe(404)
    expect((await call('POST', `companies/${foreign.id}/portal/invitations`, { email: 'a@b.test' })).statusCode).toBe(404)
  })
})
