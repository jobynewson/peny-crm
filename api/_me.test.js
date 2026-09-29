import { describe, it, expect, vi } from 'vitest'
import { slateUserFor, publicUser } from './_me.js'

// A stand-in for the Neon tagged template: answers by what the query says and
// records every query, so a test can check nothing was written.
function fakeSql(answers) {
  const sql = (strings, ...values) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim()
    sql.calls.push({ text, values })
    const hit = answers.find(([match]) => text.includes(match))
    return Promise.resolve(hit ? hit[1].shift() ?? [] : [])
  }
  sql.calls = []
  sql.writes = () => sql.calls.filter(c => !c.text.startsWith('SELECT'))
  return sql
}

const clerkFor = ({ orgs = 0, fail = false } = {}) => ({
  users: {
    getUser: vi.fn(async id => {
      if (fail) throw new Error('Clerk is down')
      return { id, primaryEmailAddress: { emailAddress: 'new@peny.test' }, fullName: 'New Starter', username: 'newbie' }
    }),
    getOrganizationMembershipList: vi.fn(async () => ({ data: Array(orgs).fill({}), totalCount: orgs })),
  },
})

const ROW = { id: 'u1', clerk_id: 'user_a', email: 'a@peny.test', name: 'Ana', role: 'user', google_tokens: { refresh_token: 'secret' }, gcal_calendar_id: 'cal' }

describe('slateUserFor', () => {
  it('returns an existing Slate user without asking Clerk', async () => {
    const sql = fakeSql([['FROM app_users', [[ROW]]]])
    const clerk = clerkFor({ orgs: 2 })
    const { user } = await slateUserFor({ sql, clerkUserId: 'user_a', clerk })
    expect(user).toEqual({ id: 'u1', clerk_id: 'user_a', email: 'a@peny.test', name: 'Ana', role: 'user', google_calendar_connected: true })
    expect(clerk.users.getUser).not.toHaveBeenCalled()
    expect(sql.writes()).toEqual([])
  })

  it('never gives a member of a Clerk organization a row', async () => {
    const sql = fakeSql([])
    const result = await slateUserFor({ sql, clerkUserId: 'client_1', clerk: clerkFor({ orgs: 1 }) })
    expect(result).toEqual({ error: { status: 403, code: 'portal_account', message: 'This account is for the client portal' } })
    expect(sql.writes()).toEqual([])
  })

  it('creates anyone else\'s row from what Clerk says about them', async () => {
    const created = { ...ROW, id: 'u2', clerk_id: 'newbie', google_tokens: null }
    const sql = fakeSql([['INSERT INTO app_users', [[created]]]])
    const { user } = await slateUserFor({ sql, clerkUserId: 'newbie', clerk: clerkFor() })
    expect(user.id).toBe('u2')
    const [insert] = sql.writes()
    expect(insert.values).toEqual(['newbie', 'new@peny.test', 'New Starter'])
    expect(insert.text).toContain("CASE WHEN EXISTS (SELECT 1 FROM app_users) THEN 'user' ELSE 'superadmin' END")
    expect(insert.text).toContain('ON CONFLICT (clerk_id) DO NOTHING')
  })

  it('reads back the row another tab created at the same moment', async () => {
    const sql = fakeSql([['SELECT * FROM app_users', [[], [ROW]]], ['INSERT INTO app_users', [[]]]])
    const { user } = await slateUserFor({ sql, clerkUserId: 'user_a', clerk: clerkFor() })
    expect(user.id).toBe('u1')
  })

  it('writes nothing when Clerk can\'t be asked', async () => {
    const sql = fakeSql([])
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await slateUserFor({ sql, clerkUserId: 'newbie', clerk: clerkFor({ fail: true }) })
    quiet.mockRestore()
    expect(result.error).toMatchObject({ status: 502, code: 'clerk_unavailable' })
    expect(sql.writes()).toEqual([])
  })
})

describe('publicUser', () => {
  it('keeps the OAuth tokens and calendar id on the server', () => {
    const shown = publicUser({ ...ROW, google_tokens: null })
    expect(shown).not.toHaveProperty('google_tokens')
    expect(shown).not.toHaveProperty('gcal_calendar_id')
    expect(shown.google_calendar_connected).toBe(false)
  })
})
