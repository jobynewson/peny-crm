import { describe, it, expect, vi } from 'vitest'

// Clerk and the database are faked; runOp (api/_db-ops.js) is real.
const state = vi.hoisted(() => ({ sql: null }))
vi.mock('@clerk/backend', () => ({
  verifyToken: async token => {
    const sub = { 'admin-token': 'admin_1', 'viewer-token': 'viewer_1' }[token]
    if (!sub) throw new Error('invalid token')
    return { sub }
  },
}))
vi.mock('./_db.js', () => ({ getSql: () => state.sql }))

const { default: handler } = await import('./db.js')

const USERS = {
  admin_1:  { id: 'a0000000-0000-4000-8000-000000000001', role: 'superadmin' },
  viewer_1: { id: 'a0000000-0000-4000-8000-000000000003', role: 'viewer' },
}
// Membership lookups answer from USERS; Drizzle queries run `query`.
const fakeSql = (query = async () => ({ rows: [], fields: [] })) => (first, ...rest) => {
  if (!Array.isArray(first?.raw)) return query(first, rest[0])
  const text = first.join('?')
  if (text.includes('FROM workspace')) return Promise.resolve([{ owner_id: 'owner_1' }])
  if (text.includes('FROM app_users')) return Promise.resolve(USERS[rest[0]] ? [USERS[rest[0]]] : [])
  return Promise.reject(new Error('unexpected query ' + text))
}

const call = async ({ method = 'POST', token, body } = {}) => {
  const res = { statusCode: 200, headers: {} }
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v }
  res.status = code => { res.statusCode = code; return res }
  res.json = payload => { res.body = payload; return res }
  await handler({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res)
  return res
}

describe('POST /api/db', () => {
  it('only accepts POST with a valid Clerk session, and is never cached', async () => {
    state.sql = fakeSql()
    const body = { op: 'getCredentials', args: [] }
    for (const [req, status] of [
      [{ method: 'GET', token: 'admin-token', body }, 405],
      [{ body }, 401],
      [{ token: 'forged', body }, 401],
    ]) {
      const res = await call(req)
      expect(res.statusCode).toBe(status)
      expect(res.headers['cache-control']).toBe('no-store')
    }
  })

  it('returns the op result, and passes permission errors through', async () => {
    state.sql = fakeSql()
    const ok = await call({ token: 'admin-token', body: { op: 'getCredentials', args: [] } })
    expect(ok.statusCode).toBe(200)
    expect(ok.body).toEqual({ result: [] })
    expect(ok.headers['cache-control']).toBe('no-store')

    const denied = await call({ token: 'viewer-token', body: { op: 'getCredentials', args: [] } })
    expect(denied.statusCode).toBe(403)
    expect(denied.body).toEqual({ error: 'Not allowed' })

    const missing = await call({ token: 'admin-token' })
    expect(missing.statusCode).toBe(400)
  })

  it('does not leak database errors to the browser', async () => {
    const leak = 'password authentication failed for user "neondb_owner"'
    state.sql = fakeSql(async () => { throw new Error(leak) })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call({ token: 'admin-token', body: { op: 'getCredentials', args: [] } })
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Database request failed' })
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })
})
