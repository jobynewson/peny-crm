// api/_client.js
// The client portal's API — the only endpoints that serve people outside
// Peny. vercel.json rewrites /api/client/* to client.js with ?route=.
//   GET  /api/client/view                     everything this visitor may see
//   POST /api/client/deliveries/:id/response  { response, comment } — approve
//                                             or request changes (signed-in
//                                             clients only)
//   POST /api/client/deliverables/:id/reply   { reply } — a note on an item
//                                             that is waiting on them
//                                             (signed-in clients only)
//   POST /api/client/requests                 { title, detail?, wanted_by? } — a
//                                             request for us (signed-in
//                                             clients only)
//
// Who sees what is decided once, by resolveScope() — the ONLY place a portal
// scope is built from a request — before any handler runs:
//   - An X-Portal-Token header (a project's portal link) → that project,
//     read-only. If a session comes too, the token wins: the lesser view.
//   - Otherwise a Clerk session whose active organisation is linked to a
//     company (companies.clerk_org_id) → that company's visible worklist, able
//     to answer unless it's an impersonation. The organisation is read from
//     the verified session token — never from the request's body, query or
//     path — and Slate staff (anyone with an app_users row) are refused.
//   - Stage 2 will add a signed one-time link from an alert email as a third
//     kind of scope here (and POST only: mail scanners open GET links).
// Handlers get the scope and nothing else about the visitor; what they read
// comes from _client-view.js and what they write goes through _worklist.js,
// both of which take only a scope.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { createClerkClient } from '@clerk/backend'
import { UUID, fail, invalid, matchRoute, routePathFrom, readBody, workspaceId } from './_api.js'
import { verifyClerkSession } from './_auth.js'
import { isRateLimited, getClientIp } from './_ratelimit.js'
import { companyScope, projectScope, respondToDelivery, submitRequest, replyToWaiting } from './_worklist.js'
import { alertNewRequest, alertChangesRequested, alertClientReply } from './_alerts.js'
import { readClientView } from './_client-view.js'

export const ROUTES = [
  { method: 'GET',  pattern: /^client\/view$/,                                      handler: getView },
  { method: 'POST', pattern: new RegExp(`^client/deliveries/(?<id>${UUID})/response$`), handler: respond },
  { method: 'POST', pattern: new RegExp(`^client/deliverables/(?<id>${UUID})/reply$`), handler: reply },
  { method: 'POST', pattern: /^client\/requests$/,                                   handler: raiseRequest },
]

const TOKEN = /^[A-Za-z0-9_-]{8,128}$/
const refuse = (status, code, message) => ({ error: { status, code, message } })

// → { scope } or { error: { status, code, message } }.
export async function resolveScope(req, sql) {
  const token = req.headers?.['x-portal-token']
  if (token !== undefined) {
    if (typeof token !== 'string' || !TOKEN.test(token)) return refuse(404, 'not_found', 'Portal link not found')
    const [project] = await sql`SELECT id, user_id FROM projects WHERE portal_token = ${token} LIMIT 1`
    if (!project) return refuse(404, 'not_found', 'Portal link not found')
    return { scope: projectScope({ ws: project.user_id, projectId: project.id }) }
  }

  const { claims, error } = await verifyClerkSession(req)
  if (error) return { error }
  // The active organisation, from the signed token: v2 tokens carry it as
  // o.id, v1 as org_id.
  const orgId = claims.o?.id ?? claims.org_id ?? null

  const [staff] = await sql`SELECT 1 AS yes FROM app_users WHERE clerk_id = ${claims.sub} LIMIT 1`
  if (staff) return refuse(403, 'staff', 'People at Peny use Slate, not the client portal')
  if (!orgId) return refuse(403, 'no_organisation', 'Choose which company you’re signing in for')

  const ws = await workspaceId(sql)
  const [company] = await sql`SELECT id FROM companies WHERE clerk_org_id = ${orgId} AND user_id = ${ws} LIMIT 1`
  if (!company) return refuse(403, 'no_portal', 'There’s no portal for this organisation')

  return { scope: companyScope({ ws, companyId: company.id, clerkUserId: claims.sub, impersonated: !!claims.act }) }
}

// Like dispatch() in _api.js, but for portal visitors: the route is resolved
// first (so an unknown path can't probe credentials), then the scope, then
// the handler — which gets the scope and never the raw credentials.
export async function dispatchClient(req, res, { routes = ROUTES, sql }) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (isRateLimited(getClientIp(req))) return fail(res, 429, 'rate_limited', 'Too many requests — try again in a minute')

  const path = routePathFrom(req)
  const match = matchRoute(req.method, path, routes)
  if (match.status) {
    if (match.allow) res.setHeader('Allow', match.allow.join(', '))
    return fail(res, match.status, match.code, match.message)
  }

  const { scope, error } = await resolveScope(req, sql)
  if (error) return fail(res, error.status, error.code, error.message)

  try {
    return await match.route.handler(req, res, { sql, scope, params: match.params })
  } catch (err) {
    console.error(`[client] ${req.method} ${path} failed:`, err)
    return fail(res, 500, 'internal_error', 'Something went wrong')
  }
}

// ── GET /api/client/view ─────────────────────────────────────────────────────
// Everything the page renders. What's in it — a company's worklist, or a
// project's page — is decided by the scope; the page renders what comes.
async function getView(req, res, { sql, scope }) {
  const view = await readClientView(sql, scope)
  if (!view) return fail(res, 404, 'not_found', 'This portal is no longer available')
  return res.status(200).json(view)
}

// ── POST /api/client/deliveries/:id/response ─────────────────────────────────
// { response: 'approved' | 'changes_requested', comment } — a comment is needed
// to request changes. Only the latest round of a deliverable shown to this
// company can be answered; anything else reads as not found. Returns the
// fresh view.
async function respond(req, res, { sql, scope, params }) {
  if (!scope.canRespond) return fail(res, 403, 'read_only', 'This view can look but not answer')
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  const by = { clerkId: scope.clerkUserId, name: await clientName(scope.clerkUserId) }
  const result = await respondToDelivery(sql, scope, { deliveryId: params.id, input: body, by })
  if (result.error) {
    const { status, code, message, field } = result.error
    return fail(res, status, code, message, field ? { field } : {})
  }
  // Changes asked for are urgent; an approval waits for the digest.
  if (body.response === 'changes_requested') {
    try {
      await alertChangesRequested(sql, { deliverableId: result.delivery.deliverable_id, comment: body.comment.trim(), by: by.name })
    } catch (err) {
      console.error('[client] changes-requested alert failed:', err?.message)   // the answer is saved either way
    }
  }
  return res.status(200).json({ ok: true, view: await readClientView(sql, scope) })
}

// ── POST /api/client/deliverables/:id/reply ──────────────────────────────────
// { reply } — a short note on an item that is waiting on the client. It stays
// waiting; the owner (or the company's lead) is told each time. Returns the
// fresh view.
async function reply(req, res, { sql, scope, params }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  const result = await replyToWaiting(sql, scope, { deliverableId: params.id, input: body })
  if (result.error) {
    const { status, code, message, field } = result.error
    return fail(res, status, code, message, field ? { field } : {})
  }
  try {
    await alertClientReply(sql, { deliverableId: result.deliverable.id, reply: body.reply.trim(), by: await clientName(scope.clerkUserId) })
  } catch (err) {
    console.error('[client] client-reply alert failed:', err?.message)   // the reply is saved either way
  }
  return res.status(200).json({ ok: true, view: await readClientView(sql, scope) })
}

// ── POST /api/client/requests ────────────────────────────────────────────────
// { title, detail?, wanted_by? }. Tells the company's lead straight away (the
// request has no deliverable, so no owner, yet). Returns the fresh view.
async function raiseRequest(req, res, { sql, scope }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  const by = scope.kind === 'company' ? { clerkId: scope.clerkUserId, name: await clientName(scope.clerkUserId) } : null
  const result = await submitRequest(sql, scope, { input: body, by })
  if (result.error) {
    const { status, code, message, field } = result.error
    return fail(res, status, code, message, field ? { field } : {})
  }
  try {
    await alertNewRequest(sql, { request: result.request, companyName: result.request.company_name })
  } catch (err) {
    console.error('[client] new-request alert failed:', err?.message)   // the request is saved either way
  }
  return res.status(201).json({ ok: true, view: await readClientView(sql, scope) })
}

// Who answered, as a name the record can show without asking Clerk again.
async function clientName(clerkUserId) {
  try {
    const user = await createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }).users.getUser(clerkUserId)
    return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.primaryEmailAddress?.emailAddress || null
  } catch (err) {
    console.error('[client] could not read the user from Clerk:', err?.message)
    return null
  }
}
