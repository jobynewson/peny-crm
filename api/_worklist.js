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

  if (scope.kind === 'staff') return respondAsStaff(sql, scope, { deliveryId, response, comment, by })
  if (scope.kind === 'company') return respondAsClient(sql, scope, { deliveryId, response, comment, by })
  throw new Error(`Scope kind ${scope.kind} cannot respond`)
}

const notFound = () => ({ error: { status: 404, code: 'not_found', message: 'Delivery not found' } })

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
      AND w.user_id = ${scope.ws} AND w.company_id = ${scope.companyId} AND d.client_visible
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
        AND w.user_id = ${scope.ws} AND w.company_id = ${scope.companyId} AND d.client_visible
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
