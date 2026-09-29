// Who becomes a Slate user (_me.js), against a real Postgres: invitations,
// what using one up means, two tabs signing in at once, the very first user
// and a client. Skipped unless SLATE_TEST_DATABASE_URL is set — see _test-db.js.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { TEST_DB, connectTestDb } from './_test-db.js'
import { slateUserFor } from './_me.js'

const describeDb = TEST_DB ? describe : describe.skip
const verified = emailAddress => ({ emailAddress, verification: { status: 'verified' } })
const PEOPLE = {
  me_new:      { emails: [verified('New@Peny.test')], name: 'New Starter' },
  me_next:     { emails: [verified('next@peny.test')], name: 'Next Starter' },
  me_stranger: { emails: [verified('stranger@example.test')], name: 'A Stranger' },
  me_sly:      { emails: [{ emailAddress: 'boss@peny.test', verification: { status: 'unverified' } }, verified('sly@example.test')], name: 'Sly' },
  me_client:   { emails: [verified('c@client.test')], name: 'A Client', orgs: 1 },
}
const clerk = {
  users: {
    getUser: async id => ({ id, emailAddresses: PEOPLE[id].emails, primaryEmailAddress: PEOPLE[id].emails.at(-1), fullName: PEOPLE[id].name }),
    getOrganizationMembershipList: async ({ userId }) => ({ data: [], totalCount: PEOPLE[userId].orgs ?? 0 }),
  },
}
const EMAILS = ['new@peny.test', 'next@peny.test', 'boss@peny.test', 'c@client.test']
const invite = email => sql`INSERT INTO staff_invitations (email, invited_by) VALUES (${email}, 'me_seed')`
let sql

describeDb('who becomes a Slate user', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    // Someone is already a Slate user, as in real life.
    await sql`INSERT INTO app_users (clerk_id, email, role) VALUES ('me_seed', 'seed@peny.test', 'superadmin') ON CONFLICT (clerk_id) DO NOTHING`
  })
  afterEach(async () => {
    await sql`DELETE FROM app_users WHERE clerk_id = ANY(${Object.keys(PEOPLE)})`
    await sql`DELETE FROM staff_invitations WHERE lower(email) = ANY(${EMAILS})`
  })
  afterAll(async () => {
    await sql`DELETE FROM app_users WHERE clerk_id = 'me_seed'`
    await sql.end()
  })

  it('lets an invited starter in once, even from two tabs at once, and uses the invitation up', async () => {
    await invite('new@peny.test')
    const [a, b] = await Promise.all([
      slateUserFor({ sql, clerkUserId: 'me_new', clerk }),
      slateUserFor({ sql, clerkUserId: 'me_new', clerk }),
    ])
    expect(a.user).toMatchObject({ clerk_id: 'me_new', email: 'New@Peny.test', name: 'New Starter', role: 'user', invited_by: 'me_seed' })
    expect(b.user.id).toBe(a.user.id)
    expect(await sql`SELECT id FROM app_users WHERE clerk_id = 'me_new'`).toHaveLength(1)
    const [spent] = await sql`SELECT used_at, used_by FROM staff_invitations WHERE email = 'new@peny.test'`
    expect(spent.used_by).toBe('me_new')
    expect(spent.used_at).not.toBeNull()
  })

  it('keeps someone out once they are removed, until they are invited again', async () => {
    await invite('new@peny.test')
    await slateUserFor({ sql, clerkUserId: 'me_new', clerk })
    await sql`DELETE FROM app_users WHERE clerk_id = 'me_new'`
    expect((await slateUserFor({ sql, clerkUserId: 'me_new', clerk })).error.code).toBe('not_invited')
    await invite('new@peny.test')
    expect((await slateUserFor({ sql, clerkUserId: 'me_new', clerk })).user.role).toBe('user')
  })

  it('turns away a signed-in stranger', async () => {
    const result = await slateUserFor({ sql, clerkUserId: 'me_stranger', clerk })
    expect(result.error).toMatchObject({ status: 403, code: 'not_invited' })
    expect(await sql`SELECT id FROM app_users WHERE clerk_id = 'me_stranger'`).toEqual([])
  })

  it('doesn\'t count an address the account hasn\'t verified', async () => {
    await invite('boss@peny.test')
    expect((await slateUserFor({ sql, clerkUserId: 'me_sly', clerk })).error.code).toBe('not_invited')
    const [open] = await sql`SELECT used_at FROM staff_invitations WHERE email = 'boss@peny.test'`
    expect(open.used_at).toBeNull()
  })

  it('never lets a client in, invited or not', async () => {
    await invite('c@client.test')
    expect((await slateUserFor({ sql, clerkUserId: 'me_client', clerk })).error.code).toBe('portal_account')
    expect(await sql`SELECT id FROM app_users WHERE clerk_id = 'me_client'`).toEqual([])
  })

  it('makes the very first Slate user a superadmin with no invitation; the next needs one', async () => {
    // An empty app_users of the same shape, just for this transaction: the
    // temporary schema is searched first, so it stands in for the real table.
    const { default: pg } = await import('pg')
    const client = new pg.Client({ connectionString: TEST_DB })
    await client.connect()
    const tx = (strings, ...values) => {
      let text = strings[0]
      for (let i = 0; i < values.length; i++) text += '$' + (i + 1) + strings[i + 1]
      return client.query(text, values).then(r => r.rows)
    }
    try {
      await client.query('BEGIN')
      await client.query('CREATE TEMP TABLE app_users (LIKE public.app_users INCLUDING ALL) ON COMMIT DROP')
      expect((await slateUserFor({ sql: tx, clerkUserId: 'me_new', clerk })).user.role).toBe('superadmin')
      expect((await slateUserFor({ sql: tx, clerkUserId: 'me_next', clerk })).error.code).toBe('not_invited')
    } finally {
      await client.query('ROLLBACK')
      await client.end()
    }
  })
})
