import { describe, it, expect, vi } from 'vitest'
import { slateUserFor, publicUser, verifiedEmails } from './_me.js'

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

const ACCOUNT = {
  primaryEmailAddress: { emailAddress: 'New@Peny.test' },
  emailAddresses: [
    { emailAddress: 'New@Peny.test', verification: { status: 'verified' } },
    { emailAddress: 'maybe@peny.test', verification: { status: 'unverified' } },
  ],
  fullName: 'New Starter',
  username: 'newbie',
}
const clerkFor = ({ orgs = 0, fail = false } = {}) => ({
  users: {
    getUser: vi.fn(async id => {
      if (fail) throw new Error('Clerk is down')
      return { id, ...ACCOUNT }
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

  it('creates a row only with an invitation, which it uses up in the same statement', async () => {
    const created = { ...ROW, id: 'u2', clerk_id: 'newbie', google_tokens: null }
    const sql = fakeSql([['WITH invite AS', [[created]]]])
    const { user } = await slateUserFor({ sql, clerkUserId: 'newbie', clerk: clerkFor() })
    expect(user.id).toBe('u2')
    const [write] = sql.writes()
    expect(write.values).toEqual([['new@peny.test'], 'newbie', 'New@Peny.test', 'New Starter', 'newbie'])
    expect(write.text).toContain('FROM staff_invitations WHERE used_at IS NULL AND lower(email) = ANY(?::text[])')
    expect(write.text).toContain('WHERE EXISTS (SELECT 1 FROM invite) OR NOT EXISTS (SELECT 1 FROM app_users)')
    expect(write.text).toContain('UPDATE staff_invitations SET used_at = NOW(), used_by = ?')
  })

  it('turns away anyone without one', async () => {
    const sql = fakeSql([])
    const result = await slateUserFor({ sql, clerkUserId: 'stranger', clerk: clerkFor() })
    expect(result.error).toEqual({
      status: 403, code: 'not_invited',
      message: 'New@Peny.test hasn’t been invited to Slate. Ask a Slate admin to invite that address.',
    })
  })

  it('reads back the row another tab created at the same moment', async () => {
    const sql = fakeSql([['SELECT * FROM app_users', [[], [ROW]]]])
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

describe('verifiedEmails', () => {
  it('only the addresses Clerk has verified, lower case', () => {
    expect(verifiedEmails(ACCOUNT)).toEqual(['new@peny.test'])
    expect(verifiedEmails({})).toEqual([])
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
