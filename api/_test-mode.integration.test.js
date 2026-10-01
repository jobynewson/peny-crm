// Testing mode against the real settings table (skipped unless
// SLATE_TEST_DATABASE_URL is set): the switch and the chosen addresses are read
// back as notify() needs them, and a workspace with it off is untouched.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { TEST_DB, connectTestDb } from './_test-db.js'

const { testRouting } = await import('./_notify.js')
const { workspaceId } = await import('./_api.js')
const describeDb = TEST_DB ? describe : describe.skip
let sql, ws, before

describeDb('testing mode setting', () => {
  beforeAll(async () => {
    sql = await connectTestDb()
    await sql`INSERT INTO workspace (owner_id) SELECT 'user_tm_ws' WHERE NOT EXISTS (SELECT 1 FROM workspace)`
    ws = await workspaceId(sql)
    await sql`INSERT INTO settings (user_id) VALUES (${ws}) ON CONFLICT (user_id) DO NOTHING`
    ;[before] = await sql`SELECT test_mode, test_emails FROM settings WHERE user_id = ${ws}`
  })
  afterAll(async () => {
    await sql`UPDATE settings SET test_mode = ${before.test_mode}, test_emails = ${JSON.stringify(before.test_emails)}::jsonb WHERE user_id = ${ws}`
    await sql.end()
  })

  it('is off by default', async () => {
    await sql`UPDATE settings SET test_mode = false, test_emails = '[]'::jsonb WHERE user_id = ${ws}`
    expect(await testRouting(sql)).toBeNull()
  })
  it('reads the chosen addresses when on, cleaned and without repeats', async () => {
    await sql`UPDATE settings SET test_mode = true, test_emails = ${JSON.stringify(['joby@peny.com', ' joby@peny.com ', 'bad', 'sam@x.test'])}::jsonb WHERE user_id = ${ws}`
    expect(await testRouting(sql)).toEqual({ emails: ['joby@peny.com', 'sam@x.test'] })
  })
  it('is on with nobody chosen: an empty list, which holds the emails back', async () => {
    await sql`UPDATE settings SET test_mode = true, test_emails = '[]'::jsonb WHERE user_id = ${ws}`
    expect(await testRouting(sql)).toEqual({ emails: [] })
  })
})
