// api/_api.js
// Shared plumbing for Slate's JSON APIs: the route table matcher, the error
// shape and the staff-only dispatcher. First written for the task board
// (_tasks.js) and reused by every router since, so they all behave the same.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.
//
// Contract:
//   - Routes are matched against `${method} ${path}`, where `path` is the URL
//     with the /api/ prefix stripped. :id segments are constrained to uuids so
//     garbage never reaches a query.
//   - Unknown path → 404. Known path, wrong method → 405 + Allow header.
//   - Every response is JSON. Errors are always { error: { code, message } };
//     validation failures add a `field` so the UI can point at the input.
//   - An exception never escapes as Vercel's HTML error page.

import { verifyClerkUser } from './_auth.js'

export const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

export const fail = (res, status, code, message, extra = {}) =>
  res.status(status).json({ error: { code, message, ...extra } })

// 422 with a field-level message — never a bare 500 for bad input.
export const invalid = (res, field, message) =>
  fail(res, 422, 'validation_failed', message, { field })

// Returns { route, params } on a hit, or { status, code, message, allow? } for
// the 404 / 405 cases. Free of req/res so it can be unit-tested directly.
export function matchRoute(method, path, routes) {
  const allow = []

  for (const route of routes) {
    const m = route.pattern.exec(path)
    if (!m) continue
    if (route.method === method) return { route, params: m.groups ?? {} }
    if (!allow.includes(route.method)) allow.push(route.method)
  }

  if (allow.length) {
    return {
      status: 405, code: 'method_not_allowed',
      message: `${method} is not allowed on this route`, allow,
    }
  }
  return { status: 404, code: 'not_found', message: 'Unknown route' }
}

// Normalise the incoming request to a bare route path.
// vercel.json rewrites hand routers their full route in ?route=; parsing
// req.url is the fallback for a function called at its own URL (and so a
// missing rewrite fails as a clean 404 rather than a crash).
export function routePathFrom(req) {
  const raw = typeof req.query?.route === 'string' ? req.query.route : ''
  if (raw) return raw.replace(/^\/+|\/+$/g, '')

  const pathname = (req.url || '').split('?')[0]
  return pathname.replace(/^\/api\//, '').replace(/^\/+|\/+$/g, '')
}

// Body may arrive parsed (Vercel does it for application/json) or as a string.
// null means "not valid JSON".
export function readBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body) } catch { return null }
  }
  return req.body
}

// Every table in this app is scoped by the workspace owner's Clerk ID. There is
// exactly one workspace row (see getOrCreateWorkspace in src/db/client.js).
export async function workspaceId(sql) {
  const rows = await sql`SELECT owner_id FROM workspace LIMIT 1`
  if (!rows[0]) throw new Error('No workspace row')
  return rows[0].owner_id
}

// Per-route access on top of "is a Slate user" (an app_users row, which
// verifyClerkUser already requires). A route with no `access` is open to every
// Slate user, which is how the task board has always behaved.
//   editor     — anyone but a viewer (viewers are read-only everywhere)
//   superadmin — superadmins only
export function accessDenied(access, user) {
  if (access === 'editor' && user.role === 'viewer') {
    return { code: 'read_only', message: 'Viewers can look but not change anything' }
  }
  if (access === 'superadmin' && user.role !== 'superadmin') {
    return { code: 'superadmin_only', message: 'Only a superadmin can do this' }
  }
  return null
}

// Runs a request through a route table for Slate staff.
// Deliberately no CORS headers: the SPA calls these same-origin with an
// Authorization header, and no third party should.
export async function dispatch(req, res, { name, routes, sql }) {
  if (req.method === 'OPTIONS') return res.status(204).end()

  const path = routePathFrom(req)
  const match = matchRoute(req.method, path, routes)

  // Resolve the route BEFORE authenticating so an unknown path can't be used to
  // probe token validity — but still authenticate before running any handler.
  if (match.status) {
    if (match.allow) res.setHeader('Allow', match.allow.join(', '))
    return fail(res, match.status, match.code, match.message)
  }

  const { user, error } = await verifyClerkUser(req, sql)
  if (error) return fail(res, error.status, error.code, error.message)

  const denied = accessDenied(match.route.access, user)
  if (denied) return fail(res, 403, denied.code, denied.message)

  try {
    return await match.route.handler(req, res, { sql, user, params: match.params })
  } catch (err) {
    console.error(`[${name}] ${req.method} ${path} failed:`, err)
    return fail(res, 500, 'internal_error', 'Something went wrong')
  }
}
