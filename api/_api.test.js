import { describe, it, expect, vi, beforeEach } from 'vitest'

// dispatch() authenticates through verifyClerkUser; CURRENT stands in for the caller.
let CURRENT = null
vi.mock('./_auth.js', () => ({
  verifyClerkUser: async () => (CURRENT
    ? { user: CURRENT }
    : { error: { status: 401, code: 'unauthorised', message: 'Missing session token' } }),
}))

const { matchRoute, routePathFrom, readBody, accessDenied, dispatch, UUID } = await import('./_api.js')
const { fakeRes } = await import('./_test-db.js')

const ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const ok = (req, res, ctx) => res.status(200).json({ ok: true, user: ctx.user.id, params: ctx.params })
const routes = [
  { method: 'GET',    pattern: /^things$/, handler: ok },
  { method: 'POST',   pattern: /^things$/, handler: ok, access: 'editor' },
  { method: 'DELETE', pattern: new RegExp(`^things/(?<id>${UUID})$`), handler: ok, access: 'superadmin' },
  { method: 'GET',    pattern: /^boom$/, handler: () => { throw new Error('kaboom') } },
]
const call = (method, route, extra = {}) => {
  const res = fakeRes()
  return dispatch({ method, url: '/api/things', query: { route }, headers: {}, ...extra }, res, { name: 'test', routes, sql: null })
    .then(() => res)
}

describe('matchRoute', () => {
  it('hits, 405s with the allowed verbs, and 404s', () => {
    expect(matchRoute('GET', 'things', routes).route.method).toBe('GET')
    const wrong = matchRoute('PUT', 'things', routes)
    expect(wrong.status).toBe(405)
    expect(wrong.allow.sort()).toEqual(['GET', 'POST'])
    expect(matchRoute('GET', 'nope', routes).status).toBe(404)
  })
  it('only takes a uuid as an id', () => {
    expect(matchRoute('DELETE', `things/${ID}`, routes).params).toEqual({ id: ID })
    expect(matchRoute('DELETE', 'things/123', routes).status).toBe(404)
  })
})

describe('routePathFrom / readBody', () => {
  it('prefers ?route= and falls back to the URL', () => {
    expect(routePathFrom({ query: { route: '/things/' }, url: '/api/x' })).toBe('things')
    expect(routePathFrom({ query: {}, url: '/api/things?x=1' })).toBe('things')
  })
  it('parses a string body and flags bad JSON as null', () => {
    expect(readBody({ body: '{"a":1}' })).toEqual({ a: 1 })
    expect(readBody({ body: '{nope' })).toBe(null)
    expect(readBody({})).toEqual({})
  })
})

describe('accessDenied', () => {
  it('keeps viewers out of editor routes and non-superadmins out of superadmin ones', () => {
    expect(accessDenied(undefined, { role: 'viewer' })).toBe(null)
    expect(accessDenied('editor', { role: 'viewer' }).code).toBe('read_only')
    expect(accessDenied('editor', { role: 'user' })).toBe(null)
    expect(accessDenied('superadmin', { role: 'user' }).code).toBe('superadmin_only')
    expect(accessDenied('superadmin', { role: 'superadmin' })).toBe(null)
  })
})

describe('dispatch', () => {
  beforeEach(() => { CURRENT = { id: 'u1', role: 'user' } })

  it('answers an unknown route before checking the session', async () => {
    CURRENT = null
    const r = await call('GET', 'nope')
    expect(r.statusCode).toBe(404)
  })
  it('sets Allow on a 405', async () => {
    const r = await call('PATCH', 'things')
    expect(r.statusCode).toBe(405)
    expect(r.headers.Allow).toBe('GET, POST')
  })
  it('401s without a Slate session', async () => {
    CURRENT = null
    const r = await call('GET', 'things')
    expect(r.statusCode).toBe(401)
  })
  it('runs the handler with the user and params', async () => {
    const r = await call('DELETE', `things/${ID}`, {})
    expect(r.statusCode).toBe(403)
    CURRENT = { id: 'u2', role: 'superadmin' }
    const ok2 = await call('DELETE', `things/${ID}`)
    expect(ok2.body).toEqual({ ok: true, user: 'u2', params: { id: ID } })
  })
  it('403s a viewer on a write', async () => {
    CURRENT = { id: 'u3', role: 'viewer' }
    expect((await call('GET', 'things')).statusCode).toBe(200)
    const r = await call('POST', 'things')
    expect(r.statusCode).toBe(403)
    expect(r.body.error.code).toBe('read_only')
  })
  it('turns an exception into a JSON 500', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await call('GET', 'boom')
    expect(r.statusCode).toBe(500)
    expect(r.body.error.code).toBe('internal_error')
    spy.mockRestore()
  })
  it('answers OPTIONS without auth', async () => {
    CURRENT = null
    const r = await call('OPTIONS', 'things')
    expect(r.statusCode).toBe(204)
  })
})
