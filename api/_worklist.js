// api/_worklist.js
// Recording a response on a delivery — approve, or request changes — is the
// one write the Peny side and the client portal share. Both come through
// respondToDelivery(), so the rule (api/_retainer-rules.js) is applied one way
// whoever answers: a client in the portal, or a Peny user recording an
// approval that came by email.
//
// Scopes decide which deliveries a caller can reach. They are made ONLY by the
// constructors below, from values the server already trusts (the workspace;
// in the portal, the company linked to the caller's Clerk organisation) and
// never from request input. respondToDelivery() refuses anything else, and
// each kind of scope has its own complete SQL with the scope's conditions
// inside the statement that writes, so there is no gap between checking and
// writing, and a delivery outside the scope reads as not found.
//
// NOT a Vercel function — the `_` prefix keeps it out of function detection.

import {
  RESPONSES, statusAfterResponse, statusPatch, validateResponse, isUuid,
  validateRequestInput, validateSenderName, validateReply, MAX_OPEN_REQUESTS, canAnswerDelivered, STATUS_AFTER_UNDO,
} from './_retainer-rules.js'

// Only the objects the constructors made count as scopes — not copies
// (`{ ...scope, ws: other }`) and not look-alikes — and they're frozen.
const SCOPES = new WeakSet()
const made = scope => { SCOPES.add(Object.freeze(scope)); return scope }
export const isScope = s => typeof s === 'object' && s !== null && SCOPES.has(s)

const need = (value, what) => {
  if (typeof value !== 'string' || !value) throw new Error(`A worklist scope needs ${what}`)
  return value
}

// Peny staff: every worklist in the workspace.
export function staffScope(ws) {
  return made({ kind: 'staff', ws: need(ws, 'the workspace id'), canRespond: true })
}

// A client signed in to the portal: one company's worklist — only what's
// shown to the client — made from the company linked to the Clerk
// organisation in their session (api/_client.js resolveScope). Someone
// viewing as the client through impersonation can look but not answer, so
// "the client approved" always means a client did.
export function companyScope({ ws, companyId, clerkUserId, impersonated = false }) {
  return made({
    kind: 'company', ws: need(ws, 'the workspace id'), companyId: need(companyId, 'the company id'),
    clerkUserId: need(clerkUserId, 'the signed-in user'), canRespond: !impersonated,
  })
}

// The Approve link in a delivery email: ONE round of one deliverable, and it
// can answer that round two ways: approve it (which uses the link up), or ask
// for changes with a comment (which doesn't — the round is answered either
// way, so there is nothing left for the link to do). It stands for whoever the
// email went to: someone with a login (`clerkUserId`), or someone without (a
// client contact or an address on the project), who is known by their address
// and `name`. Made only by api/_client.js from an unused, unexpired
// action_links row; `linkId` is what the answer is checked against, in the
// same statement that records it.
export function deliveryScope({ ws, deliveryId, linkId, clerkUserId = null, email, name = null }) {
  return made({
    kind: 'delivery', ws: need(ws, 'the workspace id'), deliveryId: need(deliveryId, 'the delivery id'),
    linkId: need(linkId, 'the link id'), clerkUserId: clerkUserId || null,
    email: need(email, 'the address the link was sent to'), name: name || null, canRespond: true,
  })
}

// A portal token link: one project, read-only.
export function projectScope({ ws, projectId }) {
  return made({ kind: 'project', ws: need(ws, 'the workspace id'), projectId: need(projectId, 'the project id'), canRespond: false })
}

// { delivery } on success, or { error: { status, code, message, field? } }.
//   deliveryId — from the route (already a uuid)
//   input      — the request body: { response, comment }
//   by         — who is answering: { clerkId, name }
export async function respondToDelivery(sql, scope, { deliveryId, input, by }) {
  if (!isScope(scope)) throw new Error('respondToDelivery needs a scope from _worklist.js')
  if (!scope.canRespond) return { error: { status: 403, code: 'read_only', message: 'This view can look but not answer' } }
  if (!isUuid(deliveryId)) return notFound()

  const bad = validateResponse(input)
  if (bad) return { error: { status: 422, code: 'validation_failed', ...bad } }
  const response = input.response
  // "Comments are in" carries no words: they are in Frame.io.
  const comment = response !== 'comments_in' && typeof input.comment === 'string' && input.comment.trim() ? input.comment.trim() : null
  if (!RESPONSES.includes(response)) return notFound()   // unreachable after validation

  if (scope.kind === 'delivery') {
    if (deliveryId !== scope.deliveryId) return notFound()
    return respondViaLink(sql, scope, { response, comment, by })
  }
  if (scope.kind === 'staff') return respondAsStaff(sql, scope, { deliveryId, response, comment, by })
  if (scope.kind === 'company') return respondAsClient(sql, scope, { deliveryId, response, comment, by })
  throw new Error(`Scope kind ${scope.kind} cannot respond`)
}

// The client taking back "comments are in" because they pressed it too soon:
// the round is open again and the deliverable is back in review. Only while it
// is still the latest round, still answered that way and the deliverable still
// reads Comments in (staff moving it on, or a newer round, ends the chance). A
// signed-in client of the company, or the link the round's email carried (while
// it is unused and unexpired). Conditions are inside the statement that writes.
// { delivery: { id, deliverable_id } } or { error }.
export async function undoCommentsIn(sql, scope, { deliveryId }) {
  if (!isScope(scope)) throw new Error('undoCommentsIn needs a scope from _worklist.js')
  if (!scope.canRespond || !['company', 'delivery'].includes(scope.kind)) return { error: { status: 403, code: 'read_only', message: 'This view can look but not answer' } }
  if (!isUuid(deliveryId)) return notFound()
  if (scope.kind === 'delivery' && deliveryId !== scope.deliveryId) return notFound()

  // One statement shape for both kinds of scope: only the matching half of the
  // condition can be true (no SQL is composed from fragments).
  const company = scope.kind === 'company'
  const companyId = scope.companyId ?? null
  const linkId = scope.linkId ?? null
  const [row] = await sql`
    SELECT dv.client_response, dv.round, d.status,
           (SELECT max(x.round) FROM deliveries x WHERE x.deliverable_id = dv.deliverable_id) AS latest_round
    FROM deliveries dv
    JOIN deliverables d ON d.id = dv.deliverable_id
    JOIN workstreams w ON w.id = d.workstream_id
    WHERE dv.id = ${deliveryId} AND w.user_id = ${scope.ws} AND d.client_visible AND ((${company}::boolean AND w.id IN (SELECT workstream_id FROM workstream_company WHERE company_id = ${companyId}::uuid))
           OR (NOT ${company}::boolean AND EXISTS (SELECT 1 FROM action_links l WHERE l.id = ${linkId}::uuid AND l.delivery_id = dv.id AND l.used_at IS NULL AND l.expires_at > NOW())))`
  if (!row) return notFound()
  if (row.client_response !== 'comments_in' || row.round !== row.latest_round || row.status !== 'comments_in') {
    return { error: { status: 409, code: 'cannot_undo', message: 'That can’t be taken back now — we’ve already picked it up' } }
  }
  const [done] = await sql`
    WITH target AS (
      SELECT dv.id
      FROM deliveries dv
      JOIN deliverables d ON d.id = dv.deliverable_id
      JOIN workstreams w ON w.id = d.workstream_id
      WHERE dv.id = ${deliveryId} AND w.user_id = ${scope.ws} AND d.client_visible AND ((${company}::boolean AND w.id IN (SELECT workstream_id FROM workstream_company WHERE company_id = ${companyId}::uuid))
           OR (NOT ${company}::boolean AND EXISTS (SELECT 1 FROM action_links l WHERE l.id = ${linkId}::uuid AND l.delivery_id = dv.id AND l.used_at IS NULL AND l.expires_at > NOW())))
        AND dv.client_response = 'comments_in' AND d.status = 'comments_in'
        AND dv.round = (SELECT max(x.round) FROM deliveries x WHERE x.deliverable_id = dv.deliverable_id)
      FOR UPDATE OF dv, d
    ), reopened AS (
      UPDATE deliveries SET client_response = 'pending', client_comment = NULL,
             responded_at = NULL, responded_by = NULL, responded_by_name = NULL
      FROM target WHERE deliveries.id = target.id
      RETURNING deliveries.id, deliveries.deliverable_id
    )
    UPDATE deliverables SET status = ${STATUS_AFTER_UNDO}::deliverable_status, updated_at = NOW()
    FROM reopened WHERE deliverables.id = reopened.deliverable_id
    RETURNING reopened.id AS delivery_id, deliverables.id AS deliverable_id`
  if (!done) return conflict()
  return { delivery: { id: done.delivery_id, deliverable_id: done.deliverable_id } }
}

// A client answering a deliverable staff have ticked as delivered, when no round
// is out for it (a round is answered on the round instead). Approve makes it
// approved; changes (a comment is needed) puts it back with Peny, clears the
// tick so it is ticked again once fixed, and keeps the comment for staff. Only a
// signed-in client of the company: a project's link can't answer, and someone
// viewing as the client can only look. The conditions sit in the statement that
// writes, so a change made in between reads as a conflict.
//   input — { response: 'approved' | 'changes_requested', comment }
//   by    — { clerkId, name }
// { deliverable: { id } } or { error }.
export async function respondToDeliverable(sql, scope, { deliverableId, input, by }) {
  if (!isScope(scope)) throw new Error('respondToDeliverable needs a scope from _worklist.js')
  if (scope.kind !== 'company' || !scope.canRespond) return { error: { status: 403, code: 'read_only', message: 'This view can look but not answer' } }
  if (!isUuid(deliverableId)) return notFound('Deliverable not found')
  const bad = validateResponse(input)
  if (bad) return { error: { status: 422, code: 'validation_failed', ...bad } }
  const response = input.response
  const comment = typeof input.comment === 'string' && input.comment.trim() ? input.comment.trim() : null

  const [row] = await sql`
    SELECT d.id, d.status, d.delivered_at,
           EXISTS (SELECT 1 FROM deliveries x WHERE x.deliverable_id = d.id AND x.client_response = 'pending'
                     AND x.round = (SELECT max(y.round) FROM deliveries y WHERE y.deliverable_id = d.id)) AS pending_round
    FROM deliverables d
    JOIN workstreams w ON w.id = d.workstream_id
    WHERE d.id = ${deliverableId} AND w.user_id = ${scope.ws} AND d.client_visible
      AND w.id IN (SELECT workstream_id FROM workstream_company WHERE company_id = ${scope.companyId})`
  if (!row) return notFound('Deliverable not found')
  if (row.status === 'approved') return { error: { status: 409, code: 'already_answered', message: 'This has already been approved' } }
  if (row.pending_round) return { error: { status: 409, code: 'use_round', message: 'A round is waiting on you — answer that one' } }
  if (!canAnswerDelivered(row)) return { error: { status: 409, code: 'not_delivered', message: 'This has not been delivered yet' } }

  const approving = response === 'approved'
  const patch = statusPatch({ from: row.status, to: statusAfterResponse(response) })
  const [done] = await sql`
    UPDATE deliverables d SET
      status            = ${patch.status}::deliverable_status,
      approved_at       = CASE WHEN ${approving} THEN NOW() ELSE approved_at END,
      approved_by_name  = CASE WHEN ${approving} THEN ${by.name} ELSE approved_by_name END,
      approved_comment  = CASE WHEN ${approving} THEN ${comment} ELSE approved_comment END,
      delivered_at      = CASE WHEN ${approving} THEN delivered_at ELSE NULL END,
      changes_note      = CASE WHEN ${approving} THEN NULL ELSE ${comment} END,
      changes_at        = CASE WHEN ${approving} THEN NULL ELSE NOW() END,
      waiting_since     = CASE WHEN ${'waiting_since' in patch} THEN ${patch.waiting_since ?? null}::timestamptz ELSE waiting_since END,
      waiting_note      = CASE WHEN ${'waiting_note' in patch} THEN ${patch.waiting_note ?? null}::text ELSE waiting_note END,
      client_reply      = CASE WHEN ${'client_reply' in patch} THEN NULL ELSE client_reply END,
      client_replied_at = CASE WHEN ${'client_reply' in patch} THEN NULL ELSE client_replied_at END,
      updated_at        = NOW()
    FROM workstreams w
    WHERE d.id = ${deliverableId} AND w.id = d.workstream_id
      AND w.user_id = ${scope.ws} AND w.id IN (SELECT workstream_id FROM workstream_company WHERE company_id = ${scope.companyId}) AND d.client_visible
      AND d.delivered_at IS NOT NULL AND d.status = ${row.status}::deliverable_status AND d.status <> 'approved'
      AND NOT EXISTS (SELECT 1 FROM deliveries x WHERE x.deliverable_id = d.id AND x.client_response = 'pending'
                        AND x.round = (SELECT max(y.round) FROM deliveries y WHERE y.deliverable_id = d.id))
    RETURNING d.id`
  if (!done) return conflict()
  return { deliverable: { id: done.id } }
}

// A client raising a request: a signed-in client (a company scope), or someone
// holding a project's link (a project scope). Not someone viewing as the
// client, who can only look.
//
// A link can't say who is holding it, so a request through one carries the
// name the sender typed (required, never checked) and is marked as sent via the
// link; triage shows that. Each has its own cap, in the statement that writes,
// so it holds for whoever calls: a company's signed-in clients (link requests
// don't count, so a forwarded link can't block them) and, separately, each
// project's link. A link stops taking requests once the project is Delivered.
//   input — the request body: { title, detail?, wanted_by?, name? (link only) }
//   by    — the signed-in client: { clerkId, name }
// { request } on success — { id, company_id, project_id, company_name, title,
// detail, wanted_by, submitted_by_name, submitted_via } — or
// { error: { status, code, message, field? } }.
export async function submitRequest(sql, scope, { input, by }) {
  if (!isScope(scope)) throw new Error('submitRequest needs a scope from _worklist.js')
  if (scope.kind === 'project') return submitViaLink(sql, scope, { input })
  if (scope.kind !== 'company') {
    return { error: { status: 403, code: 'not_allowed', message: 'This link can’t send requests' } }
  }
  if (!scope.canRespond) return { error: { status: 403, code: 'read_only', message: 'This view can look but not send requests' } }

  const bad = validateRequestInput(input)
  if (bad) return { error: { status: 422, code: 'validation_failed', ...bad } }
  const detail = typeof input.detail === 'string' && input.detail.trim() ? input.detail.trim() : null
  const wantedBy = input.wanted_by || null

  // The client can say which project it is for, so nobody at Peny has to. It
  // must be one of their company's (and not delivered); anything else is refused
  // rather than quietly dropped. None is fine: Peny choose when accepting.
  let projectId = null
  if (input.project_id != null && input.project_id !== '') {
    if (!isUuid(input.project_id)) return { error: { status: 422, code: 'validation_failed', field: 'project_id', message: 'Choose one of your projects' } }
    const [p] = await sql`
      SELECT id FROM projects
      WHERE id = ${input.project_id} AND user_id = ${scope.ws} AND company_id = ${scope.companyId} AND status <> 'Delivered'`
    if (!p) return { error: { status: 422, code: 'validation_failed', field: 'project_id', message: 'Choose one of your projects' } }
    projectId = p.id
  }

  const [request] = await sql`
    WITH co AS (
      SELECT id, name FROM companies WHERE id = ${scope.companyId} AND user_id = ${scope.ws}
    ), made AS (
      INSERT INTO requests (user_id, company_id, project_id, submitted_by, submitted_by_name, title, detail, wanted_by)
      SELECT ${scope.ws}, co.id, ${projectId}::uuid, ${scope.clerkUserId}, ${by?.name ?? null}, ${input.title.trim()}, ${detail}, ${wantedBy}::date
      FROM co
      WHERE (SELECT count(*) FROM requests r WHERE r.company_id = co.id AND r.status = 'new' AND r.submitted_via = 'login') < ${MAX_OPEN_REQUESTS}
      RETURNING id, company_id, project_id, submitted_via, title, detail, wanted_by::text AS wanted_by, submitted_by_name
    )
    SELECT made.*, co.name AS company_name FROM made, co
  `
  if (request) return { request }

  const [company] = await sql`SELECT id FROM companies WHERE id = ${scope.companyId} AND user_id = ${scope.ws}`
  if (!company) return { error: { status: 404, code: 'not_found', message: 'This portal is no longer available' } }
  return {
    error: {
      status: 429, code: 'too_many_open',
      message: `There are already ${MAX_OPEN_REQUESTS} requests waiting for us to answer. Once we have, you can send more.`,
    },
  }
}

async function submitViaLink(sql, scope, { input }) {
  const bad = validateSenderName(input) ?? validateRequestInput(input)
  if (bad) return { error: { status: 422, code: 'validation_failed', ...bad } }
  const name = input.name.replace(/\s+/g, ' ').trim()
  const detail = typeof input.detail === 'string' && input.detail.trim() ? input.detail.trim() : null
  const wantedBy = input.wanted_by || null

  const [request] = await sql`
    WITH pr AS (
      SELECT p.id, p.company_id, COALESCE((SELECT c.name FROM companies c WHERE c.id = p.company_id), p.name) AS name
      FROM projects p WHERE p.id = ${scope.projectId} AND p.user_id = ${scope.ws} AND p.status <> 'Delivered'
    ), made AS (
      INSERT INTO requests (user_id, company_id, project_id, submitted_via, submitted_by_name, title, detail, wanted_by)
      SELECT ${scope.ws}, pr.company_id, pr.id, 'link', ${name}, ${input.title.trim()}, ${detail}, ${wantedBy}::date
      FROM pr
      WHERE (SELECT count(*) FROM requests r WHERE r.project_id = pr.id AND r.status = 'new' AND r.submitted_via = 'link') < ${MAX_OPEN_REQUESTS}
      RETURNING id, company_id, project_id, submitted_via, title, detail, wanted_by::text AS wanted_by, submitted_by_name
    )
    SELECT made.*, pr.name AS company_name FROM made, pr
  `
  if (request) return { request }

  const [project] = await sql`SELECT status FROM projects WHERE id = ${scope.projectId} AND user_id = ${scope.ws}`
  if (!project) return { error: { status: 404, code: 'not_found', message: 'This page is no longer available' } }
  if (project.status === 'Delivered') {
    return { error: { status: 409, code: 'project_closed', message: 'This project has been delivered, so new requests can’t be sent from here. Get in touch with us directly.' } }
  }
  return {
    error: {
      status: 429, code: 'too_many_open',
      message: `There are already ${MAX_OPEN_REQUESTS} requests waiting for us to answer. Once we have, you can send more.`,
    },
  }
}

// A client's note on an item that is waiting on them — "the product shipped on
// Friday". One latest reply per item, replaced by the next; not a thread. It
// leaves the item where it is (still waiting on the client) and the caller
// tells the owner. Signed-in clients only, and only for an item shown to their
// company that is waiting on them, checked in the statement that writes.
//   input — the request body: { reply }
// { deliverable: { id } } on success, or { error: { status, code, message, field? } }.
export async function replyToWaiting(sql, scope, { deliverableId, input }) {
  if (!isScope(scope)) throw new Error('replyToWaiting needs a scope from _worklist.js')
  if (scope.kind !== 'company') {
    return { error: { status: 403, code: 'signed_in_only', message: 'Replies can only be sent by clients who are signed in' } }
  }
  if (!scope.canRespond) return { error: { status: 403, code: 'read_only', message: 'This view can look but not reply' } }
  if (!isUuid(deliverableId)) return notFound('Item not found')

  const bad = validateReply(input)
  if (bad) return { error: { status: 422, code: 'validation_failed', ...bad } }

  const [done] = await sql`
    UPDATE deliverables d SET client_reply = ${input.reply.trim()}, client_replied_at = NOW(), updated_at = NOW()
    FROM workstreams w
    WHERE d.id = ${deliverableId} AND w.id = d.workstream_id
      AND w.user_id = ${scope.ws} AND w.id IN (SELECT workstream_id FROM workstream_company WHERE company_id = ${scope.companyId}) AND d.client_visible
      AND d.status = 'waiting_on_client'
    RETURNING d.id`
  if (done) return { deliverable: { id: done.id } }

  const [seen] = await sql`
    SELECT d.id FROM deliverables d JOIN workstreams w ON w.id = d.workstream_id
    WHERE d.id = ${deliverableId} AND w.user_id = ${scope.ws} AND w.id IN (SELECT workstream_id FROM workstream_company WHERE company_id = ${scope.companyId}) AND d.client_visible`
  if (!seen) return notFound('Item not found')
  return { error: { status: 409, code: 'not_waiting', message: 'We’re not waiting on anything from you for this any more' } }
}

const notFound = (message = 'Delivery not found') => ({ error: { status: 404, code: 'not_found', message } })

// Why a response can't be taken, for a delivery the caller can see.
function refusal(row) {
  if (row.round !== row.latest_round) {
    return { status: 409, code: 'superseded', message: 'A newer round has been sent since — respond to that one' }
  }
  if (row.client_response !== 'pending') {
    return { status: 409, code: 'already_answered', message: 'This round has already been answered' }
  }
  return null
}

// Both writers finish the same way: the response on the round, and the
// deliverable's status from the rule.
const conflict = () => ({ error: { status: 409, code: 'conflict', message: 'This changed while you were answering — refresh and try again' } })

async function respondAsStaff(sql, scope, { deliveryId, response, comment, by }) {
  const [row] = await sql`
    SELECT dv.id, dv.round, dv.client_response, d.status,
           (SELECT max(x.round) FROM deliveries x WHERE x.deliverable_id = dv.deliverable_id) AS latest_round
    FROM deliveries dv
    JOIN deliverables d ON d.id = dv.deliverable_id
    JOIN workstreams w ON w.id = d.workstream_id
    WHERE dv.id = ${deliveryId} AND w.user_id = ${scope.ws}
  `
  if (!row) return notFound()
  const refused = refusal(row)
  if (refused) return { error: refused }

  const patch = statusPatch({ from: row.status, to: statusAfterResponse(response) })
  const [done] = await sql`
    WITH target AS (
      SELECT dv.id
      FROM deliveries dv
      JOIN deliverables d ON d.id = dv.deliverable_id
      JOIN workstreams w ON w.id = d.workstream_id
      WHERE dv.id = ${deliveryId} AND w.user_id = ${scope.ws}
        AND dv.client_response = 'pending'
        AND d.status = ${row.status}::deliverable_status
        AND dv.round = (SELECT max(x.round) FROM deliveries x WHERE x.deliverable_id = dv.deliverable_id)
      FOR UPDATE OF dv, d
    ), answered AS (
      UPDATE deliveries SET
        client_response   = ${response}::delivery_response,
        client_comment    = ${comment},
        responded_at      = NOW(),
        responded_by      = ${by.clerkId},
        responded_by_name = ${by.name}
      FROM target WHERE deliveries.id = target.id
      RETURNING deliveries.id, deliveries.deliverable_id
    )
    UPDATE deliverables SET
      status        = ${patch.status}::deliverable_status,
      waiting_since = CASE WHEN ${'waiting_since' in patch} THEN ${patch.waiting_since ?? null}::timestamptz ELSE waiting_since END,
      waiting_note  = CASE WHEN ${'waiting_note' in patch} THEN ${patch.waiting_note ?? null}::text ELSE waiting_note END,
      client_reply      = CASE WHEN ${'client_reply' in patch} THEN NULL ELSE client_reply END,
      client_replied_at = CASE WHEN ${'client_reply' in patch} THEN NULL ELSE client_replied_at END,
      updated_at    = NOW()
    FROM answered WHERE deliverables.id = answered.deliverable_id
    RETURNING answered.id AS delivery_id, deliverables.id AS deliverable_id
  `
  if (!done) return conflict()
  return { delivery: { id: done.delivery_id, deliverable_id: done.deliverable_id } }
}

// The client's own answer. Only rounds of deliverables shown to the client, in
// their company's workstreams — in the read and again inside the write — so a
// delivery id from anywhere else reads as not found.
async function respondAsClient(sql, scope, { deliveryId, response, comment, by }) {
  const [row] = await sql`
    SELECT dv.id, dv.round, dv.client_response, d.status,
           (SELECT max(x.round) FROM deliveries x WHERE x.deliverable_id = dv.deliverable_id) AS latest_round
    FROM deliveries dv
    JOIN deliverables d ON d.id = dv.deliverable_id
    JOIN workstreams w ON w.id = d.workstream_id
    WHERE dv.id = ${deliveryId}
      AND w.user_id = ${scope.ws} AND w.id IN (SELECT workstream_id FROM workstream_company WHERE company_id = ${scope.companyId}) AND d.client_visible
  `
  if (!row) return notFound()
  const refused = refusal(row)
  if (refused) return { error: refused }

  const patch = statusPatch({ from: row.status, to: statusAfterResponse(response) })
  const [done] = await sql`
    WITH target AS (
      SELECT dv.id
      FROM deliveries dv
      JOIN deliverables d ON d.id = dv.deliverable_id
      JOIN workstreams w ON w.id = d.workstream_id
      WHERE dv.id = ${deliveryId}
        AND w.user_id = ${scope.ws} AND w.id IN (SELECT workstream_id FROM workstream_company WHERE company_id = ${scope.companyId}) AND d.client_visible
        AND dv.client_response = 'pending'
        AND d.status = ${row.status}::deliverable_status
        AND dv.round = (SELECT max(x.round) FROM deliveries x WHERE x.deliverable_id = dv.deliverable_id)
      FOR UPDATE OF dv, d
    ), answered AS (
      UPDATE deliveries SET
        client_response   = ${response}::delivery_response,
        client_comment    = ${comment},
        responded_at      = NOW(),
        responded_by      = ${by.clerkId},
        responded_by_name = ${by.name}
      FROM target WHERE deliveries.id = target.id
      RETURNING deliveries.id, deliveries.deliverable_id
    )
    UPDATE deliverables SET
      status        = ${patch.status}::deliverable_status,
      waiting_since = CASE WHEN ${'waiting_since' in patch} THEN ${patch.waiting_since ?? null}::timestamptz ELSE waiting_since END,
      waiting_note  = CASE WHEN ${'waiting_note' in patch} THEN ${patch.waiting_note ?? null}::text ELSE waiting_note END,
      client_reply      = CASE WHEN ${'client_reply' in patch} THEN NULL ELSE client_reply END,
      client_replied_at = CASE WHEN ${'client_reply' in patch} THEN NULL ELSE client_replied_at END,
      updated_at    = NOW()
    FROM answered WHERE deliverables.id = answered.deliverable_id
    RETURNING answered.id AS delivery_id, deliverables.id AS deliverable_id
  `
  if (!done) return conflict()
  return { delivery: { id: done.delivery_id, deliverable_id: done.deliverable_id } }
}

// An answer from an emailed link: approve (the link is used up by the very
// statement that records it) or ask for changes (the link is checked the same
// way but left as it is; the round is answered, so it can't be used again
// anyway). Either only happens if the round is still the latest, still
// unanswered, on a deliverable still shown to the client, and the link unused
// and unexpired. Any of those failing leaves the link as it was. (A
// data-modifying CTE always runs, so the link's UPDATE joins the target and the
// answer joins the link.)
async function respondViaLink(sql, scope, { response, comment, by }) {
  const [row] = await sql`
    SELECT dv.id, dv.round, dv.client_response, d.status, d.client_visible,
           (SELECT max(x.round) FROM deliveries x WHERE x.deliverable_id = dv.deliverable_id) AS latest_round
    FROM deliveries dv
    JOIN deliverables d ON d.id = dv.deliverable_id
    JOIN workstreams w ON w.id = d.workstream_id
    WHERE dv.id = ${scope.deliveryId} AND w.user_id = ${scope.ws}
  `
  if (!row || !row.client_visible) return notFound()
  const refused = refusal(row)
  if (refused) return { error: refused }

  const patch = statusPatch({ from: row.status, to: statusAfterResponse(response) })
  // Someone with no login is recorded by their address.
  const respondedBy = scope.clerkUserId ?? 'email:' + scope.email
  const [done] = await sql`
    WITH target AS (
      SELECT dv.id
      FROM deliveries dv
      JOIN deliverables d ON d.id = dv.deliverable_id
      JOIN workstreams w ON w.id = d.workstream_id
      WHERE dv.id = ${scope.deliveryId}
        AND w.user_id = ${scope.ws} AND d.client_visible
        AND dv.client_response = 'pending'
        AND d.status = ${row.status}::deliverable_status
        AND dv.round = (SELECT max(x.round) FROM deliveries x WHERE x.deliverable_id = dv.deliverable_id)
      FOR UPDATE OF dv, d
    ), used AS (
      UPDATE action_links l SET used_at = CASE WHEN ${response === 'approved'} THEN NOW() ELSE l.used_at END
      FROM target
      WHERE l.id = ${scope.linkId} AND l.delivery_id = target.id AND l.used_at IS NULL AND l.expires_at > NOW()
      RETURNING l.id
    ), answered AS (
      UPDATE deliveries SET
        client_response   = ${response}::delivery_response,
        client_comment    = ${response === 'comments_in' ? null : comment},
        responded_at      = NOW(),
        responded_by      = ${respondedBy},
        responded_by_name = ${by.name}
      FROM target, used WHERE deliveries.id = target.id
      RETURNING deliveries.id, deliveries.deliverable_id
    )
    UPDATE deliverables SET
      status        = ${patch.status}::deliverable_status,
      waiting_since = CASE WHEN ${'waiting_since' in patch} THEN ${patch.waiting_since ?? null}::timestamptz ELSE waiting_since END,
      waiting_note  = CASE WHEN ${'waiting_note' in patch} THEN ${patch.waiting_note ?? null}::text ELSE waiting_note END,
      client_reply      = CASE WHEN ${'client_reply' in patch} THEN NULL ELSE client_reply END,
      client_replied_at = CASE WHEN ${'client_reply' in patch} THEN NULL ELSE client_replied_at END,
      updated_at    = NOW()
    FROM answered WHERE deliverables.id = answered.deliverable_id
    RETURNING answered.id AS delivery_id, deliverables.id AS deliverable_id
  `
  if (!done) {
    // Nothing was written. Say why if it was the link; otherwise the round moved.
    const [link] = await sql`SELECT used_at, expires_at < NOW() AS expired FROM action_links WHERE id = ${scope.linkId}`
    if (!link) return { error: { status: 404, code: 'not_found', message: 'This link is no longer valid' } }
    if (link.used_at) return { error: { status: 410, code: 'link_used', message: 'This link has already been used' } }
    if (link.expired) return { error: { status: 410, code: 'link_expired', message: 'This link has expired' } }
    return conflict()
  }
  return { delivery: { id: done.delivery_id, deliverable_id: done.deliverable_id } }
}
