// api/_client.js
// The client portal's API — the only endpoints that serve people outside
// Peny. vercel.json rewrites /api/client/* to client.js with ?route=.
//   GET  /api/client/view                     everything this visitor may see
//   POST /api/client/deliveries/:id/response  { response, comment } — approve
//                                             or request changes (signed-in
//                                             clients only)
//   POST /api/client/deliverables/:id/response { response, comment } — approve or
//     ask for changes on a deliverable marked delivered (no round)
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
//   - An X-Action-Token header (the Approve link in a delivery email, from the
//     confirm page — never from the email's own link) → that one round of that
//     one deliverable, and the only thing it can do is approve it. It stands
//     for the client the email was sent to, and is used up by the approval. It
//     never consults a session. Reading it (GET client/link) changes nothing;
//     approving is a POST, because mail scanners open every link in a message.
// Handlers get the scope and nothing else about the visitor; what they read
// comes from _client-view.js and what they write goes through _worklist.js,
// both of which take only a scope.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import { createClerkClient } from '@clerk/backend'
import { UUID, fail, invalid, matchRoute, routePathFrom, readBody, workspaceId } from './_api.js'
import { verifyClerkSession } from './_auth.js'
import { isRateLimited, getClientIp } from './_ratelimit.js'
import { companyScope, projectScope, deliveryScope, respondToDelivery, respondToDeliverable, undoCommentsIn, submitRequest, replyToWaiting } from './_worklist.js'
import { hashToken } from './_delivery-mail.js'
import { alertNewRequest, alertChangesRequested, alertClientReply, alertCommentsIn } from './_alerts.js'
import { readClientView, readLinkView } from './_client-view.js'

// `kinds` is which scopes a route serves (checked before its handler runs):
// the worklist routes serve a signed-in company or a project link; the two
// link routes serve only an Approve link.
const WORKLIST = ['company', 'project']
export const ROUTES = [
  { method: 'GET',  pattern: /^client\/link$/,                                      handler: getLink, kinds: ['delivery'] },
  { method: 'POST', pattern: /^client\/link\/approve$/,                              handler: approveViaLink, kinds: ['delivery'] },
  { method: 'POST', pattern: /^client\/link\/changes$/,                              handler: changesViaLink, kinds: ['delivery'] },
  { method: 'POST', pattern: /^client\/link\/comments$/,                             handler: commentsViaLink, kinds: ['delivery'] },
  { method: 'POST', pattern: /^client\/link\/undo$/,                                 handler: undoViaLink, kinds: ['delivery'] },
  { method: 'GET',  pattern: /^client\/view$/,                                      handler: getView },
  { method: 'POST', pattern: new RegExp(`^client/deliveries/(?<id>${UUID})/response$`), handler: respond },
  { method: 'POST', pattern: new RegExp(`^client/deliveries/(?<id>${UUID})/undo$`), handler: undoComments },
  { method: 'POST', pattern: new RegExp(`^client/deliverables/(?<id>${UUID})/reply$`), handler: reply },
  { method: 'POST', pattern: new RegExp(`^client/deliverables/(?<id>${UUID})/response$`), handler: respondDelivered },
  { method: 'POST', pattern: /^client\/requests$/,                                   handler: raiseRequest },
]

const TOKEN = /^[A-Za-z0-9_-]{8,128}$/
const ACTION_TOKEN = /^[A-Za-z0-9_-]{43}$/   // 32 random bytes, base64url
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

  const action = req.headers?.['x-action-token']
  if (action !== undefined) return resolveLink(sql, action)

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

// An Approve link → its delivery scope, or why not. Unknown reads as not
// found; a link that has been used or has expired says so, so the page can.
async function resolveLink(sql, token) {
  if (typeof token !== 'string' || !ACTION_TOKEN.test(token)) return refuse(404, 'not_found', 'This link is not valid')
  const [link] = await sql`
    SELECT l.id, l.delivery_id, l.clerk_user_id, l.email, l.name, l.used_at, l.expires_at < NOW() AS expired, w.user_id AS ws
    FROM action_links l
    JOIN deliveries dv ON dv.id = l.delivery_id
    JOIN deliverables d ON d.id = dv.deliverable_id
    JOIN workstreams w ON w.id = d.workstream_id
    WHERE l.token_hash = ${hashToken(token)}`
  if (!link) return refuse(404, 'not_found', 'This link is not valid')
  if (link.used_at) return refuse(410, 'link_used', 'This link has already been used')
  if (link.expired) return refuse(410, 'link_expired', 'This link has expired')
  return { scope: deliveryScope({ ws: link.ws, deliveryId: link.delivery_id, linkId: link.id, clerkUserId: link.clerk_user_id, email: link.email, name: link.name }) }
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
  if (!(match.route.kinds ?? WORKLIST).includes(scope.kind)) {
    return scope.kind === 'delivery'
      ? fail(res, 403, 'link_only', 'This link only opens the one delivery it was sent for')
      : fail(res, 404, 'not_found', 'Unknown route')
  }

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
  // Changes asked for, and comments being in, are urgent; an approval waits for the digest.
  if (body.response === 'changes_requested') {
    try {
      await alertChangesRequested(sql, { deliverableId: result.delivery.deliverable_id, comment: body.comment.trim(), by: by.name })
    } catch (err) {
      console.error('[client] changes-requested alert failed:', err?.message)   // the answer is saved either way
    }
  }
  if (body.response === 'comments_in') await tellCommentsIn(sql, result.delivery.deliverable_id, by.name)
  return res.status(200).json({ ok: true, view: await readClientView(sql, scope) })
}

// The owner hears straight away that feedback is complete (or that it is not).
async function tellCommentsIn(sql, deliverableId, name, undone = false) {
  try {
    await alertCommentsIn(sql, { deliverableId, by: name, undone })
  } catch (err) {
    console.error('[client] comments-in alert failed:', err?.message)   // the answer is saved either way
  }
}

// ── POST /api/client/deliveries/:id/undo ─────────────────────────────────────
// Takes back "comments are in" while we haven't picked it up. Returns the fresh view.
async function undoComments(req, res, { sql, scope, params }) {
  const result = await undoCommentsIn(sql, scope, { deliveryId: params.id })
  if (result.error) {
    const { status, code, message } = result.error
    return fail(res, status, code, message)
  }
  await tellCommentsIn(sql, result.delivery.deliverable_id, await clientName(scope.clerkUserId), true)
  return res.status(200).json({ ok: true, view: await readClientView(sql, scope) })
}

// ── POST /api/client/deliverables/:id/response ───────────────────────────────
// { response: 'approved' | 'changes_requested', comment } — the client's answer
// to a deliverable Peny have marked delivered, when there is no round to answer.
// Changes tell the owner straight away; an approval waits for the digest.
// Returns the fresh view.
async function respondDelivered(req, res, { sql, scope, params }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  const by = { clerkId: scope.clerkUserId, name: await clientName(scope.clerkUserId) }
  const result = await respondToDeliverable(sql, scope, { deliverableId: params.id, input: body, by })
  if (result.error) {
    const { status, code, message, field } = result.error
    return fail(res, status, code, message, field ? { field } : {})
  }
  if (body.response === 'changes_requested') {
    try {
      await alertChangesRequested(sql, { deliverableId: result.deliverable.id, comment: body.comment.trim(), by: by.name })
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

// ── GET /api/client/link ─────────────────────────────────────────────────────
// What the confirm page shows: the round the link is for, and whether it can
// still be approved. Reads only. Never approves.
async function getLink(req, res, { sql, scope }) {
  const link = await readLinkView(sql, scope)
  if (!link) return fail(res, 404, 'not_found', 'This link is not valid')
  return res.status(200).json(link)
}

// Who a link stands for, as a name the record can show: the Clerk account's
// name if they have one, else the name we have for them, else their address.
async function linkPerson(scope) {
  const name = (scope.clerkUserId ? await clientName(scope.clerkUserId) : null) || scope.name || scope.email
  return { clerkId: scope.clerkUserId, name }
}

// ── POST /api/client/link/approve ────────────────────────────────────────────
// Approves the round, as the person the email went to, and uses the link up.
async function approveViaLink(req, res, { sql, scope }) {
  const by = await linkPerson(scope)
  const result = await respondToDelivery(sql, scope, { deliveryId: scope.deliveryId, input: { response: 'approved' }, by })
  if (result.error) {
    const { status, code, message, field } = result.error
    return fail(res, status, code, message, field ? { field } : {})
  }
  return res.status(200).json({ ok: true, link: await readLinkView(sql, scope) })
}

// ── POST /api/client/link/changes ────────────────────────────────────────────
// { comment } — asks for changes to the round, as the person the email went to.
// The comment is needed. The link isn't used up (the round is answered, which is
// what stops it). Tells the owner straight away, like the portal does.
async function changesViaLink(req, res, { sql, scope }) {
  const body = readBody(req)
  if (!body) return invalid(res, 'body', 'Request body is not valid JSON')
  const by = await linkPerson(scope)
  const input = { response: 'changes_requested', comment: body.comment }
  const result = await respondToDelivery(sql, scope, { deliveryId: scope.deliveryId, input, by })
  if (result.error) {
    const { status, code, message, field } = result.error
    return fail(res, status, code, message, field ? { field } : {})
  }
  try {
    await alertChangesRequested(sql, { deliverableId: result.delivery.deliverable_id, comment: body.comment.trim(), by: by.name })
  } catch (err) {
    console.error('[client] changes-requested alert failed:', err?.message)   // the answer is saved either way
  }
  return res.status(200).json({ ok: true, link: await readLinkView(sql, scope) })
}

// ── POST /api/client/link/comments ───────────────────────────────────────────
// "Comments are in", as the person the email went to. The link isn't used up
// (the round is answered, which is what stops it). Tells the owner straight away.
async function commentsViaLink(req, res, { sql, scope }) {
  const by = await linkPerson(scope)
  const result = await respondToDelivery(sql, scope, { deliveryId: scope.deliveryId, input: { response: 'comments_in' }, by })
  if (result.error) {
    const { status, code, message, field } = result.error
    return fail(res, status, code, message, field ? { field } : {})
  }
  await tellCommentsIn(sql, result.delivery.deliverable_id, by.name)
  return res.status(200).json({ ok: true, link: await readLinkView(sql, scope) })
}

// ── POST /api/client/link/undo ───────────────────────────────────────────────
async function undoViaLink(req, res, { sql, scope }) {
  const by = await linkPerson(scope)
  const result = await undoCommentsIn(sql, scope, { deliveryId: scope.deliveryId })
  if (result.error) {
    const { status, code, message } = result.error
    return fail(res, status, code, message)
  }
  await tellCommentsIn(sql, result.delivery.deliverable_id, by.name, true)
  return res.status(200).json({ ok: true, link: await readLinkView(sql, scope) })
}

// ── POST /api/client/requests ────────────────────────────────────────────────
// { title, detail?, wanted_by?, name? }. A signed-in client's request, or one
// from a project link (which must give a name and is marked as sent via the
// link). Tells the company's lead — or the superadmins — straight away (the
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
