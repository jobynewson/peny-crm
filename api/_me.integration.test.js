// Who becomes a Slate user (_me.js), against a real Postgres: the row a new
// starter gets, two tabs signing in at once, the very first user, and a
// client. Skipped unless SLATE_TEST_DATABASE_URL is set — see _test-db.js.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { TEST_DB, connectTestDb } from './_test-db.js'
import { slateUserFor } from './_me.js'

const describeDb = TEST_DB ? describe : describe.skip
const PEOPLE = {
  me_new:    { email: 'new@peny.test',    name: 'New Starter', orgs: 0 },
  me_next:   { email: 'next@peny.test',   name: 'Next Starter', orgs: 0 },
  me_client: { email: 'c@client.test',    name: 'A Client',    orgs: 1 },
}
const clerk = {
  users: {
    getUser: async id => ({ id, primaryEmailAddress: { emailAddress: PEOPLE[id].email }, fullName: PEOPLE[id].name }),
    getOrganizationMembershipList: async ({ userId }) => ({ data: [], totalCount: PEOPLE[userId].orgs }),
  },
}
let sql

describeDb('who becomes a Slate user', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    // Someone is already a Slate user, as in real life.
    await sql`INSERT INTO app_users (clerk_id, email, role) VALUES ('me_seed', 'seed@peny.test', 'superadmin') ON CONFLICT (clerk_id) DO NOTHING`
  })
  afterEach(async () => { await sql`DELETE FROM app_users WHERE clerk_id = ANY(${Object.keys(PEOPLE)})` })
  afterAll(async () => {
    await sql`DELETE FROM app_users WHERE clerk_id = 'me_seed'`
    await sql.end()
  })

  it('gives a new starter one row, even from two tabs at once', async () => {
    const [a, b] = await Promise.all([
      slateUserFor({ sql, clerkUserId: 'me_new', clerk }),
      slateUserFor({ sql, clerkUserId: 'me_new', clerk }),
    ])
    expect(a.user).toMatchObject({ clerk_id: 'me_new', email: 'new@peny.test', name: 'New Starter', role: 'user', google_calendar_connected: false })
    expect(b.user.id).toBe(a.user.id)
    expect(await sql`SELECT id FROM app_users WHERE clerk_id = 'me_new'`).toHaveLength(1)
  })

  it('never gives a client one', async () => {
    const result = await slateUserFor({ sql, clerkUserId: 'me_client', clerk })
    expect(result.error).toMatchObject({ status: 403, code: 'portal_account' })
    expect(await sql`SELECT id FROM app_users WHERE clerk_id = 'me_client'`).toEqual([])
  })

  it('makes the very first Slate user a superadmin, and the next one a user', async () => {
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
      expect((await slateUserFor({ sql: tx, clerkUserId: 'me_next', clerk })).user.role).toBe('user')
    } finally {
      await client.query('ROLLBACK')
      await client.end()
    }
  })
})
