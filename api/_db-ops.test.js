import { describe, it, expect } from 'vitest'
import { runOp } from './_db-ops.js'

// A neon() double. Tagged-template calls are the membership lookups (and the
// migration DDL); plain calls are Drizzle's (text, params) queries. Every call
// is recorded so tests can see exactly what reached the database.
const fakeSql = ({ owner = 'owner_1', users = {}, fail = false } = {}) => {
  const calls = []
  const sql = (first, ...rest) => {
    if (Array.isArray(first?.raw)) {
      const text = first.join('?')
      calls.push({ text, params: rest })
      if (fail) return Promise.reject(new Error('connection refused'))
      if (text.includes('FROM workspace')) return Promise.resolve(owner ? [{ owner_id: owner }] : [])
      if (text.includes('FROM app_users')) return Promise.resolve(users[rest[0]] ? [users[rest[0]]] : [])
      return Promise.resolve([])
    }
    calls.push({ text: first, params: rest[0] })
    return Promise.resolve({ rows: [], fields: [] })
  }
  sql.calls = calls
  sql.drizzleCalls = () => calls.filter(c => !c.text.includes('FROM workspace') && !c.text.includes('FROM app_users'))
  return sql
}

const USERS = {
  admin_1:  { id: 'a0000000-0000-4000-8000-000000000001', role: 'superadmin' },
  user_1:   { id: 'a0000000-0000-4000-8000-000000000002', role: 'user' },
  viewer_1: { id: 'a0000000-0000-4000-8000-000000000003', role: 'viewer' },
}
const ID = 'c0000000-0000-4000-8000-000000000001'
const VAULT_OPS = [
  ['getCredentials', []],
  ['createCredential', [{ program: 'Xero' }]],
  ['updateCredential', [ID, { notes: 'n' }]],
  ['deleteCredential', [ID]],
]
const run = (sql, clerkUserId, op, args) => runOp({ op, args, clerkUserId, sql })

describe('runOp: who may call what', () => {
  it('refuses anonymous callers, unknown ops and bad args before touching the database', async () => {
    const sql = fakeSql({ users: USERS })
    await expect(run(sql, null, 'getCredentials', [])).rejects.toMatchObject({ status: 401 })
    for (const op of ['nope', '__proto__', 'constructor', 'hasOwnProperty', 42, undefined]) {
      await expect(run(sql, 'admin_1', op, [])).rejects.toMatchObject({ status: 400 })
    }
    await expect(run(sql, 'admin_1', 'getCredentials', 'owner_1')).rejects.toMatchObject({ status: 400 })
    expect(sql.calls).toEqual([])
  })

  it('keeps the vault to roles with the vault permission', async () => {
    for (const who of ['user_1', 'viewer_1', 'stranger']) {
      const sql = fakeSql({ users: USERS })
      for (const [op, args] of VAULT_OPS) {
        await expect(run(sql, who, op, args)).rejects.toMatchObject({ status: 403 })
      }
      expect(sql.drizzleCalls()).toEqual([])
    }
  })

  it('refuses member-only ops until the workspace exists', async () => {
    const sql = fakeSql({ owner: null, users: USERS })
    await expect(run(sql, 'admin_1', 'getCredentials', [])).rejects.toMatchObject({ status: 404 })
    expect(sql.drizzleCalls()).toEqual([])
  })
})

describe('runOp: credentials', () => {
  it('scopes reads to the workspace from the database, whatever the browser sends', async () => {
    const sql = fakeSql({ users: USERS })
    await run(sql, 'admin_1', 'getCredentials', ['someone_else'])
    const [q] = sql.drizzleCalls()
    expect(q.text).toMatch(/from "credentials" where "credentials"\."user_id" = \$1/)
    expect(q.params).toEqual(['owner_1'])
  })

  it('writes only allow-listed fields, into the caller\'s workspace', async () => {
    const sql = fakeSql({ users: USERS })
    await run(sql, 'admin_1', 'createCredential', [{
      program: 'Xero', password: 'pw', user_id: 'someone_else', id: ID, created_at: '2000-01-01',
    }])
    const [q] = sql.drizzleCalls()
    expect(q.text).toMatch(/^insert into "credentials"/)
    expect(q.params).toEqual(expect.arrayContaining(['owner_1', 'Xero', 'pw']))
    expect(q.params).not.toEqual(expect.arrayContaining(['someone_else']))
    expect(q.params).not.toEqual(expect.arrayContaining([ID]))
    expect(q.params).not.toEqual(expect.arrayContaining(['2000-01-01']))
  })

  it('updates and deletes by id within the caller\'s workspace only', async () => {
    const sql = fakeSql({ users: USERS })
    await run(sql, 'admin_1', 'updateCredential', [ID, { notes: 'n', user_id: 'someone_else' }])
    await run(sql, 'admin_1', 'deleteCredential', [ID])
    const [update, del] = sql.drizzleCalls()
    expect(update.text).toMatch(/^update "credentials" set "notes" = \$1, "updated_at" = \$2 where \("credentials"\."id" = \$3 and "credentials"\."user_id" = \$4\)/)
    expect(update.params.slice(2)).toEqual([ID, 'owner_1'])
    expect(update.params).not.toEqual(expect.arrayContaining(['someone_else']))
    expect(del.text).toMatch(/^delete from "credentials" where \("credentials"\."id" = \$1 and "credentials"\."user_id" = \$2\)/)
    expect(del.params).toEqual([ID, 'owner_1'])
  })

  it('rejects malformed ids and data', async () => {
    const sql = fakeSql({ users: USERS })
    await expect(run(sql, 'admin_1', 'updateCredential', ["1' OR '1'='1", {}])).rejects.toMatchObject({ status: 400 })
    await expect(run(sql, 'admin_1', 'updateCredential', [ID, 'notes'])).rejects.toMatchObject({ status: 400 })
    await expect(run(sql, 'admin_1', 'createCredential', [null])).rejects.toMatchObject({ status: 400 })
    await expect(run(sql, 'admin_1', 'createCredential', [['program']])).rejects.toMatchObject({ status: 400 })
    await expect(run(sql, 'admin_1', 'deleteCredential', [42])).rejects.toMatchObject({ status: 400 })
    expect(sql.drizzleCalls()).toEqual([])
  })
})

describe('runOp: runMigrations', () => {
  it('runs for any signed-in user, once per instance, and retries after a failure', async () => {
    const broken = fakeSql({ owner: null, fail: true })
    await expect(run(broken, 'new_user', 'runMigrations', [])).rejects.toThrow('connection refused')

    const first = fakeSql({ owner: null })
    await run(first, 'new_user', 'runMigrations', [])
    expect(first.calls.length).toBeGreaterThan(50)
    expect(first.calls.every(c => /^\s*(CREATE|ALTER|UPDATE|DO|DROP|INSERT|DELETE)\b/i.test(c.text))).toBe(true)

    const again = fakeSql({ owner: null })
    await run(again, 'someone_else', 'runMigrations', [])
    expect(again.calls).toEqual([])
  })
})
