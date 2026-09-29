import { describe, it, expect, vi, afterEach } from 'vitest'

// A token is "good:<Clerk user id>"; anything else is refused.
vi.mock('@clerk/backend', () => ({
  verifyToken: async raw => {
    if (!raw.startsWith('good:')) throw new Error('bad token')
    return { sub: raw.slice(5) }
  },
}))
const { verifyClerkUser } = await import('./_auth.js')

const req = token => ({ headers: { authorization: `Bearer ${token}` } })
const countingSql = rows => {
  const sql = async () => { sql.calls++; return rows }
  sql.calls = 0
  return sql
}
const ROW = { id: 'u1', clerk_id: 'x', role: 'user' }

afterEach(() => { vi.useRealTimers() })

describe('verifyClerkUser', () => {
  it('looks the row up every time, unless asked to remember', async () => {
    const sql = countingSql([ROW])
    await verifyClerkUser(req('good:plain'), sql)
    expect(await verifyClerkUser(req('good:plain'), sql)).toEqual({ user: ROW })
    expect(sql.calls).toBe(2)
  })

  it('remembers a yes for a minute when asked', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-29T09:00:00Z'))
    const sql = countingSql([ROW])
    await verifyClerkUser(req('good:rem'), sql, { remember: true })
    expect(await verifyClerkUser(req('good:rem'), sql, { remember: true })).toEqual({ user: ROW })
    expect(sql.calls).toBe(1)
    vi.setSystemTime(new Date('2026-09-29T09:01:01Z'))
    await verifyClerkUser(req('good:rem'), sql, { remember: true })
    expect(sql.calls).toBe(2)
  })

  it('never remembers a no', async () => {
    const sql = countingSql([])
    expect((await verifyClerkUser(req('good:client'), sql, { remember: true })).error.code).toBe('not_provisioned')
    expect((await verifyClerkUser(req('good:client'), sql, { remember: true })).error.code).toBe('not_provisioned')
    expect(sql.calls).toBe(2)
  })

  it('checks the token every time, remembered or not', async () => {
    const sql = countingSql([ROW])
    await verifyClerkUser(req('good:tok'), sql, { remember: true })
    expect((await verifyClerkUser(req('forged:tok'), sql, { remember: true })).error.status).toBe(401)
  })
})
