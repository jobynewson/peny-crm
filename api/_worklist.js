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
  validateRequestInput, validateReply, MAX_OPEN_REQUESTS,
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

// The Approve link in a delivery email: ONE round of one deliverable, and the
// one thing that can be done with it is approve it (there's no way to ask for
// changes without a comment, so that means signing in). It stands for the
// client the email went to. Made only by api/_client.js from an unused,
// unexpired action_links row; `linkId` is what the approval uses up, in the
// same statement that records it.
export function deliveryScope({ ws, deliveryId, linkId, clerkUserId, email }) {
  return made({
    kind: 'delivery', ws: need(ws, 'the workspace id'), deliveryId: need(deliveryId, 'the delivery id'),
    linkId: need(linkId, 'the link id'), clerkUserId: need(clerkUserId, 'the client the link was sent to'),
    email: need(email, 'the address the link was sent to'), canRespond: true,
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
  const comment = typeof input.comment === 'string' && input.comment.trim() ? input.comment.trim() : null
  if (!RESPONSES.includes(response)) return notFound()   // unreachable after validation

  if (scope.kind === 'delivery') {
    if (response !== 'approved') {
      return { error: { status: 403, code: 'approve_only', message: 'To ask for changes, sign in to the portal so you can say what needs to change' } }
    }
    if (deliveryId !== scope.deliveryId) return notFound()
    return respondViaLink(sql, scope, { by })
  }
  if (scope.kind === 'staff') return respondAsStaff(sql, scope, { deliveryId, response, comment, by })
  if (scope.kind === 'company') return respondAsClient(sql, scope, { deliveryId, response, comment, by })
  throw new Error(`Scope kind ${scope.kind} cannot respond`)
}

// A client raising a request. Signed-in clients only: a portal link (a
// project scope) can't, and neither can someone viewing as the client. The cap
// is in the statement that writes, so it holds for whoever calls.
//   input — the request body: { title, detail?, wanted_by? }
//   by    — the client: { clerkId, name }
// { request } on success — { id, company_id, company_name, title, detail,
// wanted_by, submitted_by_name } — or { error: { status, code, message, field? } }.
export async function submitRequest(sql, scope, { input, by }) {
  if (!isScope(scope)) throw new Error('submitRequest needs a scope from _worklist.js')
  if (scope.kind !== 'company') {
    return { error: { status: 403, code: 'signed_in_only', message: 'Requests can only be sent by clients who are signed in' } }
  }
  if (!scope.canRespond) return { error: { status: 403, code: 'read_only', message: 'This view can look but not send requests' } }

  const bad = validateRequestInput(input)
  if (bad) return { error: { status: 422, code: 'validation_failed', ...bad } }
  const detail = typeof input.detail === 'string' && input.detail.trim() ? input.detail.trim() : null
  const wantedBy = input.wanted_by || null

  const [request] = await sql`
    WITH co AS (
      SELECT id, name FROM companies WHERE id = ${scope.companyId} AND user_id = ${scope.ws}
    ), made AS (
      INSERT INTO requests (user_id, company_id, submitted_by, submitted_by_name, title, detail, wanted_by)
      SELECT ${scope.ws}, co.id, ${scope.clerkUserId}, ${by?.name ?? null}, ${input.title.trim()}, ${detail}, ${wantedBy}::date
      FROM co
      WHERE (SELECT count(*) FROM requests r WHERE r.company_id = co.id AND r.status = 'new') < ${MAX_OPEN_REQUESTS}
      RETURNING id, company_id, title, detail, wanted_by::text AS wanted_by, submitted_by_name
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

// An approval from an emailed link. The link is used up by the very statement
// that records the approval, and only if that statement approves something: the
// round must still be the latest, still unanswered, on a deliverable still
// shown to the client, and the link unused and unexpired. Any of those failing
// leaves the link as it was. (A data-modifying CTE always runs, so the link's
// UPDATE joins the target and the approval joins the link.)
async function respondViaLink(sql, scope, { by }) {
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

  const patch = statusPatch({ from: row.status, to: statusAfterResponse('approved') })
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
      UPDATE action_links l SET used_at = NOW()
      FROM target
      WHERE l.id = ${scope.linkId} AND l.delivery_id = target.id AND l.used_at IS NULL AND l.expires_at > NOW()
      RETURNING l.id
    ), answered AS (
      UPDATE deliveries SET
        client_response   = 'approved'::delivery_response,
        client_comment    = NULL,
        responded_at      = NOW(),
        responded_by      = ${scope.clerkUserId},
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
