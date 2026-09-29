// POST /api/invite against a real Postgres, with Clerk replaced: what gets
// recorded as a staff invitation (which is what lets someone in, see _me.js)
// and who is refused. Skipped unless SLATE_TEST_DATABASE_URL is set — see
// _test-db.js.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { TEST_DB, connectTestDb, fakeRes } from './_test-db.js'

const state = vi.hoisted(() => ({ sql: null, caller: null, accounts: {}, invitations: [], inviteError: null }))
vi.mock('./_auth.js', () => ({
  verifyClerkUser: async () => state.caller,
}))
vi.mock('@neondatabase/serverless', () => ({
  neon: () => (...args) => state.sql(...args),
}))
vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({
    users: {
      getUserList: async ({ emailAddress }) => {
        const found = state.accounts[emailAddress[0].toLowerCase()]
        return { data: found ? [found] : [], totalCount: found ? 1 : 0 }
      },
      getOrganizationMembershipList: async ({ userId }) => {
        const orgs = Object.values(state.accounts).find(a => a.id === userId)?.orgs ?? 0
        return { data: [], totalCount: orgs }
      },
    },
    invitations: {
      createInvitation: async (params) => {
        if (state.inviteError) throw { errors: [{ longMessage: state.inviteError }] }
        state.invitations.push(params)
        return { id: 'inv_1' }
      },
    },
  }),
}))

const { default: handler } = await import('./invite.js')
const describeDb = TEST_DB ? describe : describe.skip
const SUPERADMIN = { user: { id: 'u_sa', clerk_id: 'inv_boss', role: 'superadmin' } }
const EMAILS = ['fresh@peny.test', 'known@peny.test', 'client@client.test', 'member@peny.test']
const invite = async email => {
  const res = fakeRes()
  await handler({ method: 'POST', headers: { authorization: 'Bearer x' }, body: { email } }, res)
  return res
}
const open = email => state.sql`SELECT invited_by FROM staff_invitations WHERE lower(email) = ${email} AND used_at IS NULL`

describeDb('POST /api/invite', () => {
  beforeAll(async () => {
    state.sql = await connectTestDb()
    await state.sql`INSERT INTO app_users (clerk_id, email, role) VALUES ('inv_member', 'Member@peny.test', 'user') ON CONFLICT (clerk_id) DO NOTHING`
  })
  beforeEach(async () => {
    await state.sql`DELETE FROM staff_invitations WHERE lower(email) = ANY(${EMAILS})`
    Object.assign(state, { caller: SUPERADMIN, accounts: {}, invitations: [], inviteError: null })
  })
  afterAll(async () => {
    await state.sql`DELETE FROM staff_invitations WHERE lower(email) = ANY(${EMAILS})`
    await state.sql`DELETE FROM app_users WHERE clerk_id = 'inv_member'`
    await state.sql.end()
  })

  it('emails someone new a Clerk invitation and records what lets them in', async () => {
    const res = await invite(' Fresh@Peny.test ')
    expect(res.statusCode).toBe(200)
    expect(res.body.message).toBe('Invitation sent to Fresh@Peny.test')
    expect(state.invitations).toMatchObject([{ emailAddress: 'Fresh@Peny.test' }])
    expect(await open('fresh@peny.test')).toEqual([{ invited_by: 'inv_boss' }])
  })

  it('keeps one open invitation per address, however often it\'s sent', async () => {
    await invite('fresh@peny.test')
    state.inviteError = 'An invitation with this email address already exists'   // Clerk's, still pending
    const again = await invite('FRESH@peny.test')
    expect(again.statusCode).toBe(200)
    expect(await open('fresh@peny.test')).toHaveLength(1)
  })

  it('lets someone with an account just sign in', async () => {
    state.accounts['known@peny.test'] = { id: 'user_known' }
    const res = await invite('known@peny.test')
    expect(res.statusCode).toBe(200)
    expect(res.body.message).toBe('known@peny.test already has an account: they can sign in to Slate now')
    expect(state.invitations).toEqual([])
    expect(await open('known@peny.test')).toHaveLength(1)
  })

  it('refuses a client portal account, an existing Slate user and anyone but a superadmin', async () => {
    state.accounts['client@client.test'] = { id: 'user_cl', orgs: 1 }
    expect((await invite('client@client.test')).statusCode).toBe(409)
    expect((await invite('member@peny.test')).statusCode).toBe(409)
    state.caller = { user: { id: 'u_x', clerk_id: 'inv_user', role: 'user' } }
    expect((await invite('fresh@peny.test')).statusCode).toBe(403)
    for (const email of ['client@client.test', 'member@peny.test', 'fresh@peny.test']) expect(await open(email)).toEqual([])
  })

  it('records nothing when Clerk can\'t send the invitation', async () => {
    state.inviteError = 'Something broke'
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await invite('fresh@peny.test')
    quiet.mockRestore()
    expect(res.statusCode).toBe(500)
    expect(await open('fresh@peny.test')).toEqual([])
  })
})
