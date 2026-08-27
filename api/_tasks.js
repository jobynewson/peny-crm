// api/_tasks.js
// Task board API — every task and notification route behind one internal router.
//
// NOT its own Vercel function. The `_` prefix keeps this file out of Vercel's
// function detection: we are AT the Hobby plan's 12-function cap (see
// claude.md), so a new file under api/ would fail the deployment outright.
// Reached via vercel.json rewrites onto /api/portal?view=tasks, which passes the
// original sub-path through as ?route= and delegates here.
//
// >>> New task endpoints go in the ROUTES table below — never in a new file. <<<
//
// Contract:
//   - Clerk session verification runs ONCE, before dispatch (handlers can trust
//     `ctx.user` is a real app_users row).
//   - Unknown path      → 404
//   - Known path, wrong method → 405 + Allow header
//   - Every response is JSON. Errors are always { error: { code, message } };
//     validation failures add a `field` so the UI can point at the input.

import { verifyClerkUser } from './_auth.js'

// ── Response helpers ─────────────────────────────────────────────────────────
export const fail = (res, status, code, message, extra = {}) =>
  res.status(status).json({ error: { code, message, ...extra } })

// 422 with a field-level message, per the spec — never a bare 500 for bad input.
export const invalid = (res, field, message) =>
  fail(res, 422, 'validation_failed', message, { field })

// ── Route table ──────────────────────────────────────────────────────────────
// Matched against `${req.method} ${route}`, where `route` is the path with the
// /api/ prefix stripped (e.g. "tasks/<uuid>/acknowledge").
//
// :id is constrained to a uuid rather than a loose segment. That keeps garbage
// ids from ever reaching a query, and lets literal sub-paths (like tasks/_ping)
// coexist with tasks/:id without ordering games.
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

const notImplemented = (req, res) =>
  fail(res, 501, 'not_implemented', 'This route is not implemented yet')

export const ROUTES = [
  { method: 'GET',   pattern: /^tasks\/_ping$/,                                    handler: ping },
  { method: 'GET',   pattern: /^tasks$/,                                           handler: notImplemented },
  { method: 'POST',  pattern: /^tasks$/,                                           handler: notImplemented },
  { method: 'GET',   pattern: new RegExp(`^tasks/(?<id>${UUID})$`),                handler: notImplemented },
  { method: 'PATCH', pattern: new RegExp(`^tasks/(?<id>${UUID})$`),                handler: notImplemented },
  { method: 'POST',  pattern: new RegExp(`^tasks/(?<id>${UUID})/acknowledge$`),    handler: notImplemented },
  { method: 'POST',  pattern: new RegExp(`^tasks/(?<id>${UUID})/comments$`),       handler: notImplemented },
  { method: 'GET',   pattern: /^notifications$/,                                   handler: notImplemented },
  { method: 'POST',  pattern: /^notifications\/read$/,                             handler: notImplemented },
]

// ── Pure route matching (unit-tested in _tasks.test.js) ──────────────────────
// Returns { route, params } on a hit, or { status, code, message, allow? } for
// the 404 / 405 cases. Kept free of req/res so it can be tested directly.
export function matchRoute(method, path, routes = ROUTES) {
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
// The vercel.json rewrites hand us the full route in ?route=; parsing req.url is
// the fallback so /api/portal?view=tasks&route=… also works when called directly
// (and so a missing rewrite fails as a clean 404 rather than a crash).
export function routePathFrom(req) {
  const raw = typeof req.query?.route === 'string' ? req.query.route : ''
  if (raw) return raw.replace(/^\/+|\/+$/g, '')

  const pathname = (req.url || '').split('?')[0]
  return pathname.replace(/^\/api\//, '').replace(/^\/+|\/+$/g, '')
}

// ── Entry point ──────────────────────────────────────────────────────────────
export async function handleTasks(req, res, sql) {
  // Same-origin only: the SPA calls these with an Authorization header, which
  // does not preflight. Deliberately no CORS headers — unlike the public portal
  // routes in the host function, this API is not for third parties.
  if (req.method === 'OPTIONS') return res.status(204).end()

  const path = routePathFrom(req)
  const match = matchRoute(req.method, path)

  // Resolve the route BEFORE authenticating so an unknown path can't be used to
  // probe token validity — but still authenticate before running any handler.
  if (match.status) {
    if (match.allow) res.setHeader('Allow', match.allow.join(', '))
    return fail(res, match.status, match.code, match.message)
  }

  const { user, error } = await verifyClerkUser(req, sql)
  if (error) return fail(res, error.status, error.code, error.message)

  try {
    return await match.route.handler(req, res, { sql, user, params: match.params })
  } catch (err) {
    // Never let an exception escape as Vercel's HTML error page.
    console.error(`[tasks] ${req.method} ${path} failed:`, err)
    return fail(res, 500, 'internal_error', 'Something went wrong')
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

// Proves the whole pipe end to end: rewrite → host function → router → auth →
// handler → JSON. Cheap to curl after a deploy.
async function ping(req, res, { user }) {
  return res.status(200).json({
    ok: true,
    user: { id: user.id, name: user.name, email: user.email },
    server_time: new Date().toISOString(),
  })
}
